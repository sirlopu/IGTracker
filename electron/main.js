// electron/main.js
const { app, BrowserWindow, ipcMain, shell, dialog, globalShortcut } = require('electron')
const path = require('path')
const fs = require('fs')

// Reliable dev detection — set explicitly by the npm script
const isDev = process.env.ELECTRON_DEV === '1'

const userDataPath = app.getPath('userData')
const dbPath = path.join(userDataPath, 'igtracker.db')

let mainWindow
let db

// ─── WINDOW ────────────────────────────────────────────────────────────────
async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    show: false, // prevent black flash — only show after content is painted
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#0b0b0e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: !isDev,
    },
  })

  // Show only once React has painted — eliminates black/white flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
    if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' })
  })

  // If Vite wasn't quite ready, retry once; in production show an error dialog
  mainWindow.webContents.on('did-fail-load', (_e, code, desc) => {
    console.error('Load failed:', code, desc)
    if (isDev) {
      setTimeout(() => mainWindow.loadURL('http://localhost:5173'), 2000)
    } else {
      dialog.showErrorBox('Failed to load app', `Error ${code}: ${desc}\n\nPlease reinstall the app.`)
    }
  })

  if (isDev) {
    await waitForVite('http://localhost:5173')
    mainWindow.loadURL('http://localhost:5173')
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

// Poll until Vite is serving (handles slow machines)
async function waitForVite(url, retries = 40) {
  const http = require('http')
  for (let i = 0; i < retries; i++) {
    const ok = await new Promise(resolve => {
      const req = http.get(url, res => resolve(res.statusCode < 500))
      req.on('error', () => resolve(false))
      req.setTimeout(1000, () => { req.destroy(); resolve(false) })
    })
    if (ok) { console.log('Vite ready'); return }
    await new Promise(r => setTimeout(r, 500))
  }
  console.warn('Vite did not respond — loading anyway')
}

app.whenReady().then(async () => {
  try { await initDatabase() } catch (e) { console.error('DB init failed:', e.message) }
  await createWindow()

  // Allow opening DevTools in production with Cmd/Ctrl+Shift+I for debugging
  globalShortcut.register('CommandOrControl+Shift+I', () => {
    mainWindow?.webContents.toggleDevTools()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  persistDb()
  if (process.platform !== 'darwin') app.quit()
})

// ─── SQL.JS DATABASE ────────────────────────────────────────────────────────
async function initDatabase() {
  const initSqlJs = require('sql.js')

  // In dev:        node_modules/sql.js/dist/sql-wasm.wasm (project root)
  // In production: extraResources copies the wasm to Resources/sql-wasm.wasm,
  //                accessible via process.resourcesPath — a plain filesystem
  //                path that works regardless of asar packaging.
  const wasmPath = isDev
    ? path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm')
    : path.join(process.resourcesPath, 'sql-wasm.wasm')

  const SQL = await initSqlJs({ locateFile: () => wasmPath })

  if (fs.existsSync(dbPath)) {
    const buf = fs.readFileSync(dbPath)
    db = new SQL.Database(buf)
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
  console.log('DB ready at', dbPath)
}

function persistDb() {
  if (!db) return
  try { fs.writeFileSync(dbPath, Buffer.from(db.export())) } catch (e) { console.error('Persist error:', e.message) }
}

// Convert snake_case keys to camelCase so React components get consistent names
function camel(str) { return str.replace(/_([a-z])/g, (_, c) => c.toUpperCase()) }
function camelRow(row) {
  const out = {}
  for (const k of Object.keys(row)) out[camel(k)] = row[k]
  return out
}

function all(sql, params = []) {
  try {
    const stmt = db.prepare(sql)
    stmt.bind(params)
    const rows = []
    while (stmt.step()) rows.push(camelRow(stmt.getAsObject()))
    stmt.free()
    return rows
  } catch (e) { console.error('SQL error (all):', e.message); return [] }
}
function get(sql, params = []) { return all(sql, params)[0] || null }
function run(sql, params = []) {
  db.run(sql, params)
  return db.exec('SELECT last_insert_rowid() as id')[0]?.values[0][0]
}

// ─── IPC: ACCOUNTS ──────────────────────────────────────────────────────────
ipcMain.handle('accounts:list', () =>
  all('SELECT * FROM accounts ORDER BY created_at ASC'))

ipcMain.handle('accounts:create', (_, username) => {
  const existing = get('SELECT * FROM accounts WHERE username = ?', [username])
  if (existing) return existing
  const id = run('INSERT INTO accounts (username) VALUES (?)', [username])
  persistDb()
  return get('SELECT * FROM accounts WHERE id = ?', [id])
})

ipcMain.handle('accounts:delete', (_, id) => {
  const snaps = all('SELECT id FROM snapshots WHERE account_id = ?', [id])
  for (const s of snaps) run('DELETE FROM snapshot_members WHERE snapshot_id = ?', [s.id])
  run('DELETE FROM snapshots WHERE account_id = ?', [id])
  run('DELETE FROM events WHERE account_id = ?', [id])
  run('DELETE FROM accounts WHERE id = ?', [id])
  persistDb()
  return { deleted: true }
})

// ─── IPC: SNAPSHOTS ─────────────────────────────────────────────────────────
ipcMain.handle('snapshots:list', (_, accountId) =>
  all('SELECT * FROM snapshots WHERE account_id = ? ORDER BY taken_at DESC LIMIT 30', [accountId]))

ipcMain.handle('snapshots:save', (_, { accountId, type, usernames }) => {
  const snapId = run(
    'INSERT INTO snapshots (account_id, type, total_count) VALUES (?, ?, ?)',
    [accountId, type, usernames.length]
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
  return get('SELECT * FROM snapshots WHERE id = ?', [snapId])
})

ipcMain.handle('snapshots:members', (_, snapshotId) =>
  all(`SELECT m.username FROM snapshot_members sm
       JOIN members m ON sm.member_id = m.id
       WHERE sm.snapshot_id = ?`, [snapshotId]).map(r => r.username))

// ─── IPC: DIFF ──────────────────────────────────────────────────────────────
ipcMain.handle('snapshots:diff', (_, { fromId, toId, accountId, type }) => {
  const fromSet = snapshotSet(fromId)
  const toSet   = snapshotSet(toId)
  const gained  = [...toSet].filter(u => !fromSet.has(u))
  const lost    = [...fromSet].filter(u => !toSet.has(u))
  const gainedType = type === 'followers' ? 'gained_follower' : 'new_following'
  const lostType   = type === 'followers' ? 'lost_follower'   : 'unfollowed'

  run('DELETE FROM events WHERE account_id=? AND from_snapshot_id=? AND to_snapshot_id=?', [accountId, fromId, toId])
  for (const u of gained)
    run('INSERT INTO events (account_id,event_type,username,from_snapshot_id,to_snapshot_id) VALUES(?,?,?,?,?)',
        [accountId, gainedType, u, fromId, toId])
  for (const u of lost)
    run('INSERT INTO events (account_id,event_type,username,from_snapshot_id,to_snapshot_id) VALUES(?,?,?,?,?)',
        [accountId, lostType, u, fromId, toId])
  persistDb()
  return { gained, lost, gainedCount: gained.length, lostCount: lost.length }
})

ipcMain.handle('snapshots:crossdiff', (_, { followersSnapshotId, followingSnapshotId }) => {
  const followers = snapshotSet(followersSnapshotId)
  const following = snapshotSet(followingSnapshotId)
  return {
    notFollowingBack: [...following].filter(u => !followers.has(u)),
    fans:             [...followers].filter(u => !following.has(u)),
    mutuals:          [...followers].filter(u =>  following.has(u)),
  }
})

function snapshotSet(id) {
  return new Set(all(
    `SELECT m.username FROM snapshot_members sm
     JOIN members m ON sm.member_id = m.id WHERE sm.snapshot_id = ?`, [id]
  ).map(r => r.username))
}

// ─── IPC: EVENTS ────────────────────────────────────────────────────────────
ipcMain.handle('events:list', (_, accountId) =>
  all('SELECT * FROM events WHERE account_id=? ORDER BY created_at DESC LIMIT 200', [accountId]))

// ─── IPC: EXPORT ────────────────────────────────────────────────────────────
ipcMain.handle('export:csv', async (_, { snapshotId, filename }) => {
  const { filePath } = await dialog.showSaveDialog(mainWindow, {
    defaultPath: filename,
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  })
  if (!filePath) return { cancelled: true }
  const rows = all(`SELECT m.username FROM snapshot_members sm
                    JOIN members m ON sm.member_id = m.id WHERE sm.snapshot_id = ?`, [snapshotId])
  fs.writeFileSync(filePath, 'username\n' + rows.map(r => r.username).join('\n'), 'utf8')
  return { saved: true, filePath }
})

// ─── IPC: SHELL ─────────────────────────────────────────────────────────────
ipcMain.handle('shell:openExternal', (_, url) => shell.openExternal(url))

// ─── PLAYWRIGHT SCANNING ────────────────────────────────────────────────────
ipcMain.handle('scan:followers', (_, { username }) => runScan(username, 'followers'))
ipcMain.handle('scan:following', (_, { username }) => runScan(username, 'following'))

async function runScan(username, type) {
  const { chromium } = require('playwright')
  const sessionPath = path.join(userDataPath, `session_${username}`)
  fs.mkdirSync(sessionPath, { recursive: true })

  // Remove stale Chromium lock files left by a previous crashed session
  for (const lock of ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'lockfile']) {
    const p = path.join(sessionPath, lock)
    try { if (fs.existsSync(p)) fs.unlinkSync(p) } catch (_) {}
  }

  let ctx = null
  try {
    mainWindow.webContents.send('scan:progress', { step: 'opening', message: 'Opening Instagram...' })

    ctx = await chromium.launchPersistentContext(sessionPath, {
      headless: false,
      viewport: { width: 1080, height: 900 },
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    })

    const page = ctx.pages()[0] || await ctx.newPage()

    // Navigate to profile — triggers login if needed
    await page.goto(`https://www.instagram.com/${username}/`, {
      waitUntil: 'domcontentloaded', timeout: 30000,
    })

    mainWindow.webContents.send('scan:progress', {
      step: 'opening', message: 'Waiting for login… sign in if prompted.',
    })

    const ok = await waitForLogin(page)
    if (!ok) {
      await ctx.close()
      return { error: 'Login timed out. Please try again and log in within 2 minutes.' }
    }

    mainWindow.webContents.send('scan:progress', {
      step: 'scrolling', message: `Fetching ${type} list…`,
    })

    // Get the numeric user ID we need for the API
    const userId = await getUserId(page, username)
    if (!userId) {
      await ctx.close()
      return { error: `Could not resolve user ID for @${username}. Make sure you are logged in and the profile loaded.` }
    }

    // Paginate through the full list using Instagram's internal REST API
    const usernames = await paginateFriendships(page, userId, type, username)

    await ctx.close()

    mainWindow.webContents.send('scan:progress', {
      step: 'done', message: `Found ${usernames.length} ${type}`, count: usernames.length,
    })
    return { usernames, count: usernames.length }

  } catch (e) {
    console.error('Scan error:', e)
    try { if (ctx) await ctx.close() } catch (_) {}
    return { error: e.message }
  }
}

// Extract the numeric Instagram user ID from the profile page JSON
async function getUserId(page, username) {
  try {
    // Instagram embeds user data in a <script> tag as window._sharedData or similar
    const id = await page.evaluate(() => {
      // Method 1: __additionalDataLoaded / profilePage data
      try {
        const scripts = [...document.querySelectorAll('script')]
        for (const s of scripts) {
          const t = s.textContent || ''
          const m = t.match(/"id"\s*:\s*"(\d+)"/)
          if (m) return m[1]
        }
      } catch (_) {}
      return null
    })
    if (id) return id

    // Method 2: fetch the profile JSON endpoint directly in-page
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

// Walk all pages of the friendships API and return every username
async function paginateFriendships(page, userId, type) {
  const endpoint = type === 'followers'
    ? `/api/v1/friendships/${userId}/followers/`
    : `/api/v1/friendships/${userId}/following/`

  const seen = new Set()
  let maxId = null
  let pageNum = 0
  let consecutiveErrors = 0

  while (true) {
    pageNum++

    // count=100 is more reliably honoured than 200
    const qs = maxId ? `?count=100&max_id=${maxId}` : `?count=100`
    const url = `${endpoint}${qs}`

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
    }, url)

    if (result?.__error) {
      console.error(`Page ${pageNum} error:`, result.__error, result.__raw || '')
      if (result.__status === 429) {
        // Rate limited — wait longer and retry once
        await page.waitForTimeout(8000)
        consecutiveErrors++
      } else {
        consecutiveErrors++
      }
      if (consecutiveErrors >= 3) break
      continue
    }

    consecutiveErrors = 0
    const users = result?.users || []
    users.forEach(u => { if (u?.username) seen.add(u.username.toLowerCase()) })

    mainWindow.webContents.send('scan:progress', {
      step: 'scrolling',
      message: `Page ${pageNum} — ${seen.size} ${type} so far…`,
      count: seen.size,
    })

    // Always coerce cursor to string — Instagram sometimes returns a number
    const rawCursor = result?.next_max_id
    const nextCursor = rawCursor != null ? String(rawCursor) : null

    console.log(`Page ${pageNum}: got ${users.length} users, cursor=${nextCursor}, big_list=${result?.big_list}`)

    // Stop when: no cursor returned, cursor unchanged, or empty page with no big_list flag
    if (!nextCursor || nextCursor === String(maxId)) {
      console.log(`Done after ${pageNum} pages, ${seen.size} total`)
      break
    }
    if (users.length === 0 && !result?.big_list) {
      console.log(`Empty page without big_list, stopping`)
      break
    }

    maxId = nextCursor

    // Randomised delay — 1.0–2.2s between pages
    await page.waitForTimeout(1000 + Math.random() * 1200)
  }

  return [...seen]
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
