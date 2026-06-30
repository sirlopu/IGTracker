// server/index.js — single-process server: serves the React app + API + Playwright
// Usage: node server/index.js
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

function upsertAccount(username) {
  const existing = get('SELECT * FROM accounts WHERE username = ?', [username])
  if (existing) return existing
  const id = run('INSERT INTO accounts (username, created_at) VALUES (?, ?)', [username, appTimestamp()])
  persistDb()
  return get('SELECT * FROM accounts WHERE id = ?', [id])
}

// ─── BROWSER CONNECTION ───────────────────────────────────────────────────────
// Use the user's existing Chrome profile (cookies) so Instagram is already
// logged in — no remote debugging flags, no extra setup.

function findChromeProfile() {
  const candidates = {
    darwin: path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome', 'Default'),
    win32: path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'User Data', 'Default'),
    linux: path.join(os.homedir(), '.config', 'google-chrome', 'Default'),
  }
  const p = candidates[process.platform]
  return p && fs.existsSync(p) ? p : null
}

function copyChromeSession(srcProfile, destDir) {
  fs.mkdirSync(destDir, { recursive: true })
  // Copy only the files that carry authentication — skip cache (can be GBs)
  for (const file of ['Cookies', 'Cookies-journal']) {
    const src = path.join(srcProfile, file)
    if (fs.existsSync(src)) try { fs.copyFileSync(src, path.join(destDir, file)) } catch (_) {}
  }
  for (const dir of ['Local Storage', 'Session Storage']) {
    const src = path.join(srcProfile, dir)
    if (fs.existsSync(src)) try { fs.cpSync(src, path.join(destDir, dir), { recursive: true }) } catch (_) {}
  }
}

async function withInstagramPage(sessionId, task) {
  const { chromium } = require('playwright')

  // ── Prefer user's Chrome profile (already logged in, no setup needed) ────
  const srcProfile = findChromeProfile()
  if (srcProfile) {
    const sessionDir = path.join(SESSIONS_DIR, `chrome_${sessionId}`)
    try {
      copyChromeSession(srcProfile, sessionDir)
      // Remove stale lock files from the copy
      for (const lock of ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'lockfile']) {
        const p = path.join(sessionDir, lock)
        try { if (fs.existsSync(p)) fs.unlinkSync(p) } catch (_) {}
      }
      let ctx = null
      try {
        ctx = await chromium.launchPersistentContext(sessionDir, {
          channel: 'chrome',          // actual Chrome binary — same Keychain key → cookies decrypt
          headless: false,
          args: ['--no-first-run', '--no-default-browser-check', '--no-sandbox'],
        })
        const page = ctx.pages()[0] || await ctx.newPage()
        console.log('[browser] launched Chrome with profile copy')
        return await task(page)
      } finally {
        try { if (ctx) await ctx.close() } catch (_) {}
      }
    } catch (e) {
      console.log('[browser] Chrome profile launch failed:', e.message, '— falling back to Playwright Chromium')
    }
  }

  // ── Fallback: Playwright's own Chromium with a persistent session ─────────
  console.log('[browser] using Playwright Chromium')
  const sessionPath = path.join(SESSIONS_DIR, `pw_${sessionId}`)
  fs.mkdirSync(sessionPath, { recursive: true })
  for (const lock of ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'lockfile']) {
    const p = path.join(sessionPath, lock)
    try { if (fs.existsSync(p)) fs.unlinkSync(p) } catch (_) {}
  }
  let ctx = null
  try {
    ctx = await chromium.launchPersistentContext(sessionPath, {
      headless: false,
      viewport: { width: 1080, height: 900 },
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    })
    const page = ctx.pages()[0] || await ctx.newPage()
    return await task(page)
  } catch (e) {
    console.error('Playwright error:', e.message)
    return { error: e.message }
  } finally {
    try { if (ctx) await ctx.close() } catch (_) {}
  }
}

// Returns true once the user is logged in, false on timeout.
// Detects login by URL (not on /accounts/login or /challenge) AND
// presence of any recognisable logged-in UI element.
async function waitForLogin(page, ms = 120000) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    try {
      const state = await page.evaluate(() => {
        const url = location.href
        if (/\/(accounts\/login|challenge|accounts\/suspended)/.test(url)) return 'login_page'
        // Broad set of selectors that work across Instagram UI versions
        const loggedInSignals = [
          'svg[aria-label="Home"]',
          'a[href="/direct/inbox/"]',
          '[aria-label="Profile"]',
          'nav a[href*="/direct/"]',
          'a[href="/"]',           // home link in nav
          '[role="navigation"]',   // nav exists = logged in
        ]
        if (loggedInSignals.some(sel => document.querySelector(sel))) return 'logged_in'
        return 'loading'
      })
      if (state === 'logged_in') return true
    } catch (_) {}
    await page.waitForTimeout(1500)
  }
  return false
}

// Try every known method to extract the logged-in username.
// Retries for up to `ms` milliseconds to handle slow page renders.
async function getLoggedInUsername(page, ms = 15000) {
  const deadline = Date.now() + ms

  while (Date.now() < deadline) {
    // Method 1: internal REST API — fastest when it works
    try {
      const result = await page.evaluate(async () => {
        try {
          const r = await fetch('/api/v1/accounts/current_user/?edit=true', {
            headers: { 'x-ig-app-id': '936619743392459' },
            credentials: 'include',
          })
          if (!r.ok) return null
          const d = await r.json()
          return d?.user?.username || null
        } catch { return null }
      })
      if (result) { console.log('[username] found via API:', result); return result }
    } catch (_) {}

    // Method 2: read username from the profile edit page input
    try {
      if (!page.url().includes('/accounts/edit')) {
        await page.goto('https://www.instagram.com/accounts/edit/', {
          waitUntil: 'domcontentloaded', timeout: 10000,
        })
        await page.waitForTimeout(2000)
      }
      const result = await page.evaluate(() => {
        for (const el of document.querySelectorAll('input, [name="username"]')) {
          const name = el.getAttribute('name') || ''
          const label = (el.getAttribute('aria-label') || '').toLowerCase()
          const val = el.value || el.textContent || ''
          if ((name === 'username' || label.includes('username')) && val.trim()) return val.trim()
        }
        return null
      })
      if (result) { console.log('[username] found via edit page:', result); return result }
    } catch (_) {}

    // Method 3: profile link in the left nav (href="/username/")
    try {
      await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 10000 })
      await page.waitForTimeout(2000)
      const result = await page.evaluate(() => {
        const SKIP = new Set(['explore','reels','direct','stories','accounts','p','tv','reel',''])
        // aria-label="Profile" is the most reliable signal
        for (const a of document.querySelectorAll('a[href]')) {
          if ((a.getAttribute('aria-label') || '').toLowerCase() === 'profile') {
            const u = (a.getAttribute('href') || '').replace(/\//g, '')
            if (u) return u
          }
        }
        // Fallback: any /word/ link that isn't a known route
        for (const a of document.querySelectorAll('a[href]')) {
          const m = (a.getAttribute('href') || '').match(/^\/([a-zA-Z0-9._]+)\/$/)
          if (m && !SKIP.has(m[1])) return m[1]
        }
        return null
      })
      if (result) { console.log('[username] found via nav:', result); return result }
    } catch (_) {}

    await page.waitForTimeout(2000)
  }

  console.log('[username] all methods exhausted')
  return null
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

    return page.evaluate(async (uname) => {
      try {
        const r = await fetch(`/api/v1/users/web_profile_info/?username=${uname}`, {
          headers: { 'x-ig-app-id': '936619743392459' },
        })
        const d = await r.json()
        return d?.data?.user?.id || null
      } catch { return null }
    }, username)
  } catch { return null }
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
        catch (_) { return { __error: 'bad json' } }
      } catch (e) { return { __error: e.message } }
    }, `${endpoint}${qs}`)

    if (result?.__error) {
      if (result.__status === 429) await page.waitForTimeout(8000)
      consecutiveErrors++
      if (consecutiveErrors >= 3) break
      continue
    }

    consecutiveErrors = 0
    const users = result?.users || []
    users.forEach(u => { if (u?.username) seen.add(u.username.toLowerCase()) })

    onProgress({ step: 'scrolling', message: `Page ${pageNum} — ${seen.size} ${type} so far…`, count: seen.size })

    const rawCursor = result?.next_max_id
    const nextCursor = rawCursor != null ? String(rawCursor) : null
    if (!nextCursor || nextCursor === String(maxId)) break
    if (users.length === 0 && !result?.big_list) break

    maxId = nextCursor
    await page.waitForTimeout(1000 + Math.random() * 1200)
  }

  return [...seen]
}

// ─── JOB HELPERS ─────────────────────────────────────────────────────────────
function createJob(store) {
  const id = crypto.randomUUID()
  const job = { status: 'pending', clients: new Set(), buffer: [] }
  store.set(id, job)
  setTimeout(() => store.delete(id), 10 * 60 * 1000)
  return { id, job }
}

function broadcast(job, eventName, data) {
  const msg = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`
  job.buffer.push(msg)
  for (const client of job.clients) client.write(msg)
}

function sseStream(req, res, job) {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()
  for (const msg of job.buffer) res.write(msg)
  if (job.status === 'done') { res.end(); return }
  job.clients.add(res)
  req.on('close', () => job.clients.delete(res))
}

function finishJob(job) {
  job.status = 'done'
  for (const client of job.clients) try { client.end() } catch (_) {}
  job.clients.clear()
}

// ─── LOGIN JOBS ──────────────────────────────────────────────────────────────
const loginJobs = new Map()

async function executeLoginJob(jobId, job) {
  const send = (name, data) => broadcast(job, name, data)

  try {
    const tempSessionId = `_login_${jobId}`

    const result = await withInstagramPage(tempSessionId, async (page) => {
      send('progress', { message: 'Opening Instagram…' })

      // Go to the home page — if cookies are valid Instagram redirects straight to the feed
      await page.goto('https://www.instagram.com/', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      })
      await page.bringToFront().catch(() => {})

      // Quick check: are we already logged in via saved cookies?
      const alreadyIn = await waitForLogin(page, 4000).catch(() => false)

      if (!alreadyIn) {
        // Navigate to login page and wait up to 3 minutes for the user to sign in
        await page.goto('https://www.instagram.com/accounts/login/', {
          waitUntil: 'domcontentloaded', timeout: 15000,
        }).catch(() => {})
        await page.bringToFront().catch(() => {})
        send('progress', { message: 'Please log in to Instagram in the browser window.' })

        const ok = await waitForLogin(page, 3 * 60 * 1000)
        if (!ok) return { error: 'Login timed out. Please try again.' }
      }

      send('progress', { message: 'Detecting your username…' })

      // Retry username extraction for up to 20 seconds to handle slow page renders
      const username = await getLoggedInUsername(page, 20000)
      if (!username) return { error: 'Logged in but could not read your username. Please try again.' }

      return { username }
    })

    if (result.error) {
      send('login_error', { error: result.error })
    } else {
      // Move temp session to the username-keyed session directory
      const tempPath = path.join(SESSIONS_DIR, `session__login_${jobId}`)
      const userPath = path.join(SESSIONS_DIR, `session_${result.username}`)
      if (fs.existsSync(tempPath)) {
        if (!fs.existsSync(userPath)) {
          fs.renameSync(tempPath, userPath)
        } else {
          fs.rmSync(tempPath, { recursive: true, force: true })
        }
      }

      const account = upsertAccount(result.username)
      send('done', { username: result.username, account })
    }
  } catch (e) {
    broadcast(job, 'login_error', { error: e.message || 'Login failed' })
  } finally {
    finishJob(job)
  }
}

// ─── SCAN JOBS ───────────────────────────────────────────────────────────────
const scanJobs = new Map()

async function executeScanJob(jobId, job, username, type) {
  const send = (name, data) => broadcast(job, name, data)

  try {
    const result = await withInstagramPage(username, async (page) => {
      send('progress', { step: 'opening', message: 'Opening Instagram…' })

      await page.goto(`https://www.instagram.com/${username}/`, {
        waitUntil: 'domcontentloaded', timeout: 30000,
      })

      await page.bringToFront().catch(() => {})

      // If session is valid, waitForLogin returns immediately; otherwise user sees the login page
      send('progress', { step: 'opening', message: 'Checking session… sign in if prompted.' })
      const ok = await waitForLogin(page)
      if (!ok) return { error: 'Login timed out. Please try again.' }

      send('progress', { step: 'scrolling', message: `Fetching ${type} list…` })

      const userId = await getUserId(page, username)
      if (!userId) return { error: `Could not resolve user ID for @${username}.` }

      const usernames = await paginateFriendships(page, userId, type, (p) => send('progress', p))

      send('progress', { step: 'done', message: `Found ${usernames.length} ${type}`, count: usernames.length })
      return { usernames, count: usernames.length }
    })

    if (result.error) {
      send('scan_error', { error: result.error })
    } else {
      send('done', result)
    }
  } catch (e) {
    send('scan_error', { error: e.message || 'Scan failed' })
  } finally {
    finishJob(job)
  }
}

// ─── EXPRESS APP ─────────────────────────────────────────────────────────────
const app = express()
app.use(express.json())

// ── Health / meta
app.get('/api/ping', (_req, res) => res.json({ ok: true }))


app.get('/api/meta', (_req, res) => res.json({
  platform: 'server',
  capabilities: { automatedScan: true, unfollow: true, loginAtConnect: true },
}))

// ── Accounts
app.get('/api/accounts', (_req, res) => res.json(all('SELECT * FROM accounts ORDER BY created_at ASC')))

app.post('/api/accounts', (req, res) => {
  const username = normalizeUsername(req.body.username)
  if (!username) return res.status(400).json({ error: 'Username required' })
  res.json(upsertAccount(username))
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

// ── Instagram login (at account-add time)
app.post('/api/accounts/login', (_req, res) => {
  const { id, job } = createJob(loginJobs)
  res.json({ loginId: id })
  setImmediate(() => executeLoginJob(id, job))
})

app.get('/api/accounts/login/:loginId/stream', (req, res) => {
  const job = loginJobs.get(req.params.loginId)
  if (!job) return res.status(404).json({ error: 'Unknown login session' })
  sseStream(req, res, job)
})

// ── Snapshots
app.get('/api/snapshots', (req, res) => {
  res.json(all('SELECT * FROM snapshots WHERE account_id = ? ORDER BY taken_at DESC LIMIT 30', [Number(req.query.accountId)]))
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
  res.json(all(
    `SELECT m.username FROM snapshot_members sm
     JOIN members m ON sm.member_id = m.id WHERE sm.snapshot_id = ?`, [Number(req.params.id)]
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
  res.json(all('SELECT * FROM events WHERE account_id=? ORDER BY created_at DESC LIMIT 200', [Number(req.query.accountId)]))
})

// ── Scan
app.post('/api/scan', (req, res) => {
  const { username, type } = req.body
  if (!username || !type) return res.status(400).json({ error: 'username and type required' })
  const { id, job } = createJob(scanJobs)
  res.json({ scanId: id })
  setImmediate(() => executeScanJob(id, job, normalizeUsername(username), type))
})

app.get('/api/scan/:scanId/stream', (req, res) => {
  const job = scanJobs.get(req.params.scanId)
  if (!job) return res.status(404).json({ error: 'Unknown scan ID' })
  sseStream(req, res, job)
})

// ── Export
app.get('/api/export/csv/:snapshotId', (req, res) => {
  const rows = all(
    `SELECT m.username FROM snapshot_members sm
     JOIN members m ON sm.member_id = m.id WHERE sm.snapshot_id = ?`, [Number(req.params.snapshotId)]
  )
  res.setHeader('Content-Type', 'text/csv')
  res.setHeader('Content-Disposition', `attachment; filename="snapshot_${req.params.snapshotId}.csv"`)
  res.send('username\n' + rows.map(r => r.username).join('\n'))
})

// ─── FRONTEND (Vite middleware in dev, static files in prod) ─────────────────
async function setupFrontend() {
  const distDir = path.join(__dirname, '..', 'dist')
  const isProd = fs.existsSync(path.join(distDir, 'index.html'))

  if (isProd) {
    app.use(express.static(distDir))
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) return next()
      res.sendFile(path.join(distDir, 'index.html'))
    })
    console.log('Serving built app from', distDir)
  } else {
    // Dev mode: embed Vite as middleware (HMR, instant reload, no separate process)
    const { createServer: createViteServer } = await import('vite')
    const vite = await createViteServer({
      configFile: path.join(__dirname, '..', 'vite.config.js'),
      server: { middlewareMode: true },
      appType: 'spa',
    })
    app.use(vite.middlewares)
    console.log('Vite dev middleware active — HMR enabled')
  }
}

// ─── START ───────────────────────────────────────────────────────────────────
initDatabase()
  .then(() => setupFrontend())
  .then(() => {
    const server = app.listen(PORT, () => {
      console.log(`\nIGTracker running at http://localhost:${PORT}`)
      console.log(`Data: ${DATA_DIR}\n`)
    })
    server.on('error', (e) => {
      if (e.code === 'EADDRINUSE') {
        console.error(`\nPort ${PORT} is already in use.`)
        console.error(`Kill it with: lsof -ti :${PORT} | xargs kill\n`)
      } else {
        console.error('Server error:', e.message)
      }
      process.exit(1)
    })
  })
  .catch(e => {
    console.error('Failed to start:', e.message)
    process.exit(1)
  })
