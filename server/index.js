// server/index.js — local companion server for the web version
// Mirrors the Playwright scanning behaviour from electron/main.js
// Run with: node server/index.js
const express = require('express')
const path = require('path')
const fs = require('fs')
const os = require('os')
const crypto = require('crypto')

const PORT = process.env.PORT || 3001
const DATA_DIR = path.join(os.homedir(), '.igtracker-server')
const DB_PATH = path.join(DATA_DIR, 'igtracker.db')
const SESSIONS_DIR = path.join(DATA_DIR, 'sessions')

fs.mkdirSync(DATA_DIR, { recursive: true })
fs.mkdirSync(SESSIONS_DIR, { recursive: true })

// ─── DATABASE ────────────────────────────────────────────────────────────────
let db = null

async function initDatabase() {
  const initSqlJs = require('sql.js')
  const SQL = await initSqlJs()

  if (fs.existsSync(DB_PATH)) {
    db = new SQL.Database(fs.readFileSync(DB_PATH))
  } else {
    db = new SQL.Database()
  }

  db.run(`PRAGMA journal_mode=WAL;`)
  db.run(`CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );`)
  db.run(`CREATE TABLE IF NOT EXISTS snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    taken_at TEXT DEFAULT (datetime('now')),
    total_count INTEGER NOT NULL,
    FOREIGN KEY (account_id) REFERENCES accounts(id)
  );`)
  db.run(`CREATE TABLE IF NOT EXISTS members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL
  );`)
  db.run(`CREATE TABLE IF NOT EXISTS snapshot_members (
    snapshot_id INTEGER NOT NULL,
    member_id   INTEGER NOT NULL,
    PRIMARY KEY (snapshot_id, member_id),
    FOREIGN KEY (snapshot_id) REFERENCES snapshots(id),
    FOREIGN KEY (member_id)   REFERENCES members(id)
  );`)
  db.run(`CREATE TABLE IF NOT EXISTS events (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id       INTEGER NOT NULL,
    event_type       TEXT NOT NULL,
    username         TEXT NOT NULL,
    from_snapshot_id INTEGER NOT NULL,
    to_snapshot_id   INTEGER NOT NULL,
    created_at       TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (account_id) REFERENCES accounts(id)
  );`)
  persistDb()
  console.log('DB ready at', DB_PATH)
}

function persistDb() {
  if (!db) return
  try { fs.writeFileSync(DB_PATH, Buffer.from(db.export())) } catch (e) { console.error('Persist error:', e.message) }
}

function camel(str) { return str.replace(/_([a-z])/g, (_, c) => c.toUpperCase()) }
function camelRow(row) {
  const out = {}
  for (const k of Object.keys(row)) out[camel(k)] = row[k]
  return out
}

function all(sql, params = []) {
  const stmt = db.prepare(sql)
  stmt.bind(params)
  const rows = []
  while (stmt.step()) rows.push(camelRow(stmt.getAsObject()))
  stmt.free()
  return rows
}
function get(sql, params = []) { return all(sql, params)[0] || null }
function run(sql, params = []) {
  db.run(sql, params)
  return db.exec('SELECT last_insert_rowid() as id')[0]?.values[0][0]
}

function appTimestamp() { return new Date().toISOString() }

function snapshotSet(id) {
  return new Set(all(
    `SELECT m.username FROM snapshot_members sm
     JOIN members m ON sm.member_id = m.id WHERE sm.snapshot_id = ?`, [id]
  ).map(r => r.username))
}

function insertEvent({ accountId, eventType, username, fromSnapshotId = 0, toSnapshotId = 0 }) {
  return run(
    'INSERT INTO events (account_id,event_type,username,from_snapshot_id,to_snapshot_id,created_at) VALUES(?,?,?,?,?,?)',
    [accountId, eventType, username, fromSnapshotId, toSnapshotId, appTimestamp()]
  )
}

function normalizeUsername(value) {
  return String(value || '').trim().replace(/^@/, '').toLowerCase()
}

// ─── PLAYWRIGHT ──────────────────────────────────────────────────────────────
function getPlaywrightChromium() {
  try {
    const chromium = require('playwright').chromium
    const execPath = chromium.executablePath()
    if (!fs.existsSync(execPath)) throw new Error('not found')
    return chromium
  } catch (_) {
    return {
      error:
        'Chromium browser not found.\n\n' +
        'Run: npx playwright install chromium',
    }
  }
}

function getSessionPath(username) {
  const sessionPath = path.join(SESSIONS_DIR, `session_${username}`)
  fs.mkdirSync(sessionPath, { recursive: true })
  for (const lock of ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'lockfile']) {
    const p = path.join(sessionPath, lock)
    try { if (fs.existsSync(p)) fs.unlinkSync(p) } catch (_) {}
  }
  return sessionPath
}

async function withInstagramSession(username, task) {
  const chromium = getPlaywrightChromium()
  if (chromium.error) return { error: chromium.error }

  const sessionPath = getSessionPath(username)
  let ctx = null
  try {
    ctx = await chromium.launchPersistentContext(sessionPath, {
      headless: false,
      viewport: { width: 1080, height: 900 },
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    })
    const page = ctx.pages()[0] || await ctx.newPage()
    return await task(page, ctx)
  } catch (e) {
    console.error('Instagram session error:', e)
    return { error: e.message }
  } finally {
    try { if (ctx) await ctx.close() } catch (_) {}
  }
}

async function waitForLogin(page, ms = 120000) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    try {
      const loggedIn = await page.evaluate(() => {
        if (location.href.includes('/accounts/login')) return false
        return !!(
          document.querySelector('svg[aria-label="Home"]') ||
          document.querySelector('a[href="/direct/inbox/"]') ||
          document.querySelector('[aria-label="Profile"]') ||
          document.querySelector('nav a[href*="/direct/"]')
        )
      })
      if (loggedIn) return true
    } catch (_) {}
    await page.waitForTimeout(1500)
  }
  return false
}

async function getUserId(page, username) {
  try {
    const id = await page.evaluate(() => {
      try {
        for (const s of document.querySelectorAll('script')) {
          const m = (s.textContent || '').match(/"id"\s*:\s*"(\d+)"/)
          if (m) return m[1]
        }
      } catch (_) {}
      return null
    })
    if (id) return id

    const profileId = await page.evaluate(async (uname) => {
      try {
        const r = await fetch(`/api/v1/users/web_profile_info/?username=${uname}`, {
          headers: { 'x-ig-app-id': '936619743392459' },
        })
        const d = await r.json()
        return d?.data?.user?.id || null
      } catch (_) { return null }
    }, username)

    return profileId
  } catch (_) {
    return null
  }
}

async function paginateFriendships(page, userId, type, onProgress) {
  const endpoint = type === 'followers'
    ? `/api/v1/friendships/${userId}/followers/`
    : `/api/v1/friendships/${userId}/following/`

  const seen = new Set()
  let maxId = null
  let pageNum = 0
  let consecutiveErrors = 0

  while (true) {
    pageNum++
    const qs = maxId ? `?count=100&max_id=${maxId}` : `?count=100`

    const result = await page.evaluate(async (fetchUrl) => {
      try {
        const csrf = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1] || ''
        const r = await fetch(fetchUrl, {
          headers: {
            'x-ig-app-id': '936619743392459',
            'x-requested-with': 'XMLHttpRequest',
            'x-csrftoken': csrf,
          },
          credentials: 'include',
        })
        if (!r.ok) return { __error: `HTTP ${r.status}`, __status: r.status }
        const text = await r.text()
        try { return JSON.parse(text) }
        catch (_) { return { __error: 'bad json', __raw: text.slice(0, 300) } }
      } catch (e) { return { __error: e.message } }
    }, `${endpoint}${qs}`)

    if (result?.__error) {
      console.error(`Page ${pageNum} error:`, result.__error, result.__raw || '')
      if (result.__status === 429) await page.waitForTimeout(8000)
      consecutiveErrors++
      if (consecutiveErrors >= 3) break
      continue
    }

    consecutiveErrors = 0
    const users = result?.users || []
    users.forEach(u => { if (u?.username) seen.add(u.username.toLowerCase()) })

    onProgress({
      step: 'scrolling',
      message: `Page ${pageNum} — ${seen.size} ${type} so far…`,
      count: seen.size,
    })

    const rawCursor = result?.next_max_id
    const nextCursor = rawCursor != null ? String(rawCursor) : null

    if (!nextCursor || nextCursor === String(maxId)) break
    if (users.length === 0 && !result?.big_list) break

    maxId = nextCursor
    await page.waitForTimeout(1000 + Math.random() * 1200)
  }

  return [...seen]
}

async function runScan(username, type, onProgress) {
  const normalizedUsername = normalizeUsername(username)
  return withInstagramSession(normalizedUsername, async (page) => {
    onProgress({ step: 'opening', message: 'Opening Instagram...' })

    await page.goto(`https://www.instagram.com/${normalizedUsername}/`, {
      waitUntil: 'domcontentloaded', timeout: 30000,
    })

    onProgress({ step: 'opening', message: 'Waiting for login… sign in if prompted.' })

    // Bring the Playwright window to the front so the user sees it
    await page.bringToFront().catch(() => {})

    const ok = await waitForLogin(page)
    if (!ok) {
      return { error: 'Login timed out. Please try again and log in within 2 minutes.' }
    }

    onProgress({ step: 'scrolling', message: `Fetching ${type} list…` })

    const userId = await getUserId(page, normalizedUsername)
    if (!userId) {
      return { error: `Could not resolve user ID for @${normalizedUsername}. Make sure you are logged in and the profile loaded.` }
    }

    const usernames = await paginateFriendships(page, userId, type, onProgress)

    onProgress({ step: 'done', message: `Found ${usernames.length} ${type}`, count: usernames.length })
    return { usernames, count: usernames.length }
  })
}

// ─── SCAN JOB QUEUE ──────────────────────────────────────────────────────────
const scanJobs = new Map()

function createScanJob() {
  const scanId = crypto.randomUUID()
  const job = { status: 'pending', clients: new Set(), buffer: [] }
  scanJobs.set(scanId, job)
  setTimeout(() => scanJobs.delete(scanId), 10 * 60 * 1000)
  return scanId
}

function broadcastScanEvent(scanId, eventName, data) {
  const job = scanJobs.get(scanId)
  if (!job) return
  const msg = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`
  job.buffer.push(msg)
  for (const client of job.clients) client.write(msg)
}

async function executeScanJob(scanId, username, type) {
  const job = scanJobs.get(scanId)
  if (!job) return
  job.status = 'running'

  try {
    const result = await runScan(username, type, (progress) => {
      broadcastScanEvent(scanId, 'progress', progress)
    })

    if (result.error) {
      broadcastScanEvent(scanId, 'scan_error', { error: result.error })
    } else {
      broadcastScanEvent(scanId, 'done', result)
    }
  } catch (e) {
    broadcastScanEvent(scanId, 'scan_error', { error: e.message || 'Scan failed' })
  } finally {
    job.status = 'done'
    for (const client of job.clients) {
      try { client.end() } catch (_) {}
    }
    job.clients.clear()
  }
}

// ─── EXPRESS APP ─────────────────────────────────────────────────────────────
const app = express()
app.use(express.json())

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

// Serve built web app in production
const distDir = path.join(__dirname, '..', 'dist')
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir))
}

// ── Health
app.get('/api/ping', (_req, res) => res.json({ ok: true }))
app.get('/api/meta', (_req, res) => res.json({
  platform: 'server',
  capabilities: { automatedScan: true, unfollow: true },
}))

// ── Accounts
app.get('/api/accounts', (_req, res) => {
  res.json(all('SELECT * FROM accounts ORDER BY created_at ASC'))
})

app.post('/api/accounts', (req, res) => {
  const username = normalizeUsername(req.body.username)
  if (!username) return res.status(400).json({ error: 'Username required' })
  const existing = get('SELECT * FROM accounts WHERE username = ?', [username])
  if (existing) return res.json(existing)
  const id = run('INSERT INTO accounts (username, created_at) VALUES (?, ?)', [username, appTimestamp()])
  persistDb()
  res.json(get('SELECT * FROM accounts WHERE id = ?', [id]))
})

app.delete('/api/accounts/:id', (req, res) => {
  const id = Number(req.params.id)
  const snaps = all('SELECT id FROM snapshots WHERE account_id = ?', [id])
  for (const s of snaps) run('DELETE FROM snapshot_members WHERE snapshot_id = ?', [s.id])
  run('DELETE FROM snapshots WHERE account_id = ?', [id])
  run('DELETE FROM events WHERE account_id = ?', [id])
  run('DELETE FROM accounts WHERE id = ?', [id])
  persistDb()
  res.json({ deleted: true })
})

// ── Snapshots
app.get('/api/snapshots', (req, res) => {
  const accountId = Number(req.query.accountId)
  res.json(all('SELECT * FROM snapshots WHERE account_id = ? ORDER BY taken_at DESC LIMIT 30', [accountId]))
})

app.post('/api/snapshots', (req, res) => {
  const { accountId, type, usernames } = req.body
  const takenAt = appTimestamp()
  const snapId = run(
    'INSERT INTO snapshots (account_id, type, taken_at, total_count) VALUES (?, ?, ?, ?)',
    [accountId, type, takenAt, usernames.length]
  )
  for (const username of usernames) {
    let member = get('SELECT id FROM members WHERE username = ?', [username])
    if (!member) {
      const mid = run('INSERT INTO members (username) VALUES (?)', [username])
      member = { id: mid }
    }
    db.run('INSERT OR IGNORE INTO snapshot_members (snapshot_id, member_id) VALUES (?, ?)', [snapId, member.id])
  }
  persistDb()
  res.json(get('SELECT * FROM snapshots WHERE id = ?', [snapId]))
})

app.get('/api/snapshots/:id/members', (req, res) => {
  const id = Number(req.params.id)
  res.json(all(
    `SELECT m.username FROM snapshot_members sm
     JOIN members m ON sm.member_id = m.id WHERE sm.snapshot_id = ?`, [id]
  ).map(r => r.username))
})

app.post('/api/snapshots/diff', (req, res) => {
  const { fromId, toId, accountId, type } = req.body
  const fromSet = snapshotSet(fromId)
  const toSet = snapshotSet(toId)
  const gained = [...toSet].filter(u => !fromSet.has(u))
  const lost = [...fromSet].filter(u => !toSet.has(u))
  const gainedType = type === 'followers' ? 'gained_follower' : 'new_following'
  const lostType = type === 'followers' ? 'lost_follower' : 'unfollowed'

  run('DELETE FROM events WHERE account_id=? AND from_snapshot_id=? AND to_snapshot_id=?', [accountId, fromId, toId])
  for (const u of gained) insertEvent({ accountId, eventType: gainedType, username: u, fromSnapshotId: fromId, toSnapshotId: toId })
  for (const u of lost) insertEvent({ accountId, eventType: lostType, username: u, fromSnapshotId: fromId, toSnapshotId: toId })
  persistDb()
  res.json({ gained, lost, gainedCount: gained.length, lostCount: lost.length })
})

app.post('/api/snapshots/crossdiff', (req, res) => {
  const { followersSnapshotId, followingSnapshotId } = req.body
  const followers = snapshotSet(followersSnapshotId)
  const following = snapshotSet(followingSnapshotId)
  res.json({
    notFollowingBack: [...following].filter(u => !followers.has(u)),
    fans: [...followers].filter(u => !following.has(u)),
    mutuals: [...followers].filter(u => followers.has(u)),
  })
})

// ── Events
app.get('/api/events', (req, res) => {
  const accountId = Number(req.query.accountId)
  res.json(all('SELECT * FROM events WHERE account_id=? ORDER BY created_at DESC LIMIT 200', [accountId]))
})

// ── Scan
app.post('/api/scan', (req, res) => {
  const { username, type } = req.body
  if (!username || !type) return res.status(400).json({ error: 'username and type required' })
  const scanId = createScanJob()
  res.json({ scanId })
  // Start scan asynchronously after response is sent
  setImmediate(() => executeScanJob(scanId, username, type))
})

app.get('/api/scan/:scanId/stream', (req, res) => {
  const job = scanJobs.get(req.params.scanId)
  if (!job) return res.status(404).json({ error: 'Unknown scan ID' })

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  // Replay any events that arrived before the client connected
  for (const msg of job.buffer) res.write(msg)

  if (job.status === 'done') {
    res.end()
    return
  }

  job.clients.add(res)
  req.on('close', () => job.clients.delete(res))
})

// ── Export
app.get('/api/export/csv/:snapshotId', (req, res) => {
  const snapshotId = Number(req.params.snapshotId)
  const snap = get('SELECT * FROM snapshots WHERE id = ?', [snapshotId])
  if (!snap) return res.status(404).json({ error: 'Snapshot not found' })
  const rows = all(
    `SELECT m.username FROM snapshot_members sm
     JOIN members m ON sm.member_id = m.id WHERE sm.snapshot_id = ?`, [snapshotId]
  )
  const csv = 'username\n' + rows.map(r => r.username).join('\n')
  res.setHeader('Content-Type', 'text/csv')
  res.setHeader('Content-Disposition', `attachment; filename="snapshot_${snapshotId}.csv"`)
  res.send(csv)
})

// SPA fallback
if (fs.existsSync(distDir)) {
  app.get('*', (_req, res) => res.sendFile(path.join(distDir, 'index.html')))
}

// ── Start
initDatabase().then(() => {
  const server = app.listen(PORT, () => {
    console.log(`IGTracker server running at http://localhost:${PORT}`)
    console.log(`Data directory: ${DATA_DIR}`)
  })
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use. Is another instance of the server already running?`)
      console.error(`Kill it with: lsof -ti :${PORT} | xargs kill`)
    } else {
      console.error('Server error:', e.message)
    }
    process.exit(1)
  })
}).catch(e => {
  console.error('Failed to start server:', e.message)
  process.exit(1)
})
