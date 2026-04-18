// electron/main.js
const { app, BrowserWindow, ipcMain, shell, dialog, globalShortcut } = require('electron')
const path = require('path')
const fs = require('fs')

// Reliable dev detection — set explicitly by the npm script
const isDev = process.env.ELECTRON_DEV === '1'

// Resolved inside app.whenReady() — app.getPath() must not be called at
// module load time; on some systems it returns a stale/wrong value before
// the app is fully initialised.
let userDataPath
let dbPath

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
  // Resolve paths now that Electron is fully ready
  userDataPath = app.getPath('userData')
  dbPath = path.join(userDataPath, 'igtracker.db')

  // Guarantee the user-data directory exists on first run
  fs.mkdirSync(userDataPath, { recursive: true })

  try {
    // 15-second timeout guards against Emscripten hanging silently when
    // the wasm file is missing or unreadable — without it the window
    // would never appear.
    await Promise.race([
      initDatabase(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Database initialisation timed out')), 15000)
      ),
    ])
  } catch (e) {
    console.error('DB init failed:', e.message)
    dialog.showErrorBox(
      'Database error',
      `IGTracker could not initialise its database:\n\n${e.message}\n\nThe app will open but data will not be saved.`
    )
  }

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

function dbReady() {
  if (!db) throw new Error('Database is not available. Please restart the app.')
}

function all(sql, params = []) {
  try {
    dbReady()
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
  dbReady()
  db.run(sql, params)
  return db.exec('SELECT last_insert_rowid() as id')[0]?.values[0][0]
}

function appTimestamp() {
  return new Date().toISOString()
}

function insertEvent({ accountId, eventType, username, fromSnapshotId = 0, toSnapshotId = 0 }) {
  return run(
    'INSERT INTO events (account_id,event_type,username,from_snapshot_id,to_snapshot_id,created_at) VALUES(?,?,?,?,?,?)',
    [accountId, eventType, username, fromSnapshotId, toSnapshotId, appTimestamp()]
  )
}

// ─── IPC: ACCOUNTS ──────────────────────────────────────────────────────────
ipcMain.handle('accounts:list', () =>
  all('SELECT * FROM accounts ORDER BY created_at ASC'))

ipcMain.handle('accounts:create', (_, username) => {
  const existing = get('SELECT * FROM accounts WHERE username = ?', [username])
  if (existing) return existing
  const id = run('INSERT INTO accounts (username, created_at) VALUES (?, ?)', [username, appTimestamp()])
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
    insertEvent({ accountId, eventType: gainedType, username: u, fromSnapshotId: fromId, toSnapshotId: toId })
  for (const u of lost)
    insertEvent({ accountId, eventType: lostType, username: u, fromSnapshotId: fromId, toSnapshotId: toId })
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

// ─── IPC: RELATIONS ────────────────────────────────────────────────────────
ipcMain.handle('relations:unfollow', async (_, { accountUsername, usernames }) => {
  const normalizedAccount = normalizeUsername(accountUsername)
  const normalizedTargets = [...new Set((usernames || []).map(normalizeUsername).filter(Boolean))]
  const account = get('SELECT * FROM accounts WHERE username = ?', [normalizedAccount])

  if (!normalizedAccount) {
    return { error: 'Missing account username.', results: [] }
  }
  if (normalizedTargets.length === 0) {
    return { error: 'Choose at least one account to unfollow.', results: [] }
  }
  if (!account) {
    return { error: 'Could not find that tracked account.', results: [] }
  }

  return withInstagramSession(normalizedAccount, async (page) => {
    mainWindow?.webContents.send('scan:progress', {
      step: 'opening',
      message: 'Opening Instagram session...',
    })

    await page.goto('https://www.instagram.com/', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    })

    mainWindow?.webContents.send('scan:progress', {
      step: 'opening',
      message: 'Waiting for Instagram session… sign in if prompted.',
    })

    const ok = await waitForLogin(page)
    if (!ok) {
      return {
        error: 'Login timed out. Please try again and log in within 2 minutes.',
        results: normalizedTargets.map(username => ({
          username,
          ok: false,
          error: 'Login timed out.',
        })),
      }
    }

    const results = []

    for (let i = 0; i < normalizedTargets.length; i += 1) {
      const username = normalizedTargets[i]
      mainWindow?.webContents.send('scan:progress', {
        step: 'scrolling',
        message: `Unfollowing @${username} (${i + 1}/${normalizedTargets.length})...`,
        count: i + 1,
      })

      try {
        const unfollowResult = await unfollowUser(page, username)
        if (!unfollowResult.ok) {
          insertEvent({
            accountId: account.id,
            eventType: 'unfollow_failed',
            username,
          })
          results.push({ username, ok: false, error: unfollowResult.error || 'Instagram rejected the unfollow request.' })
          if (unfollowResult.rateLimited) break
          continue
        }

        insertEvent({
          accountId: account.id,
          eventType: 'unfollowed',
          username,
        })
        results.push({ username, ok: true })
        await page.waitForTimeout(2200 + Math.random() * 1800)
      } catch (error) {
        insertEvent({
          accountId: account.id,
          eventType: 'unfollow_failed',
          username,
        })
        results.push({ username, ok: false, error: error.message || 'Unfollow failed.' })
      }
    }

    persistDb()

    mainWindow?.webContents.send('scan:progress', {
      step: 'done',
      message: `Finished ${normalizedTargets.length} unfollow request${normalizedTargets.length === 1 ? '' : 's'}.`,
      count: results.filter(item => item.ok).length,
    })

    return { results }
  })
})

// ─── PLAYWRIGHT SCANNING ────────────────────────────────────────────────────
// scan:launch is the entry point exposed in the preload — it dispatches
// to the correct handler based on the type field in the payload.
ipcMain.handle('scan:launch',    (_, { username, type }) => runScan(username, type))
ipcMain.handle('scan:followers', (_, { username })       => runScan(username, 'followers'))
ipcMain.handle('scan:following', (_, { username })       => runScan(username, 'following'))

async function runScan(username, type) {
  const normalizedUsername = normalizeUsername(username)
  return withInstagramSession(normalizedUsername, async (page, ctx) => {
    mainWindow.webContents.send('scan:progress', { step: 'opening', message: 'Opening Instagram...' })

    // Navigate to profile — triggers login if needed
    await page.goto(`https://www.instagram.com/${normalizedUsername}/`, {
      waitUntil: 'domcontentloaded', timeout: 30000,
    })

    mainWindow.webContents.send('scan:progress', {
      step: 'opening', message: 'Waiting for login… sign in if prompted.',
    })

    const ok = await waitForLogin(page)
    if (!ok) {
      return { error: 'Login timed out. Please try again and log in within 2 minutes.' }
    }

    mainWindow.webContents.send('scan:progress', {
      step: 'scrolling', message: `Fetching ${type} list…`,
    })

    // Get the numeric user ID we need for the API
    const userId = await getUserId(page, normalizedUsername)
    if (!userId) {
      return { error: `Could not resolve user ID for @${normalizedUsername}. Make sure you are logged in and the profile loaded.` }
    }

    // Paginate through the full list using Instagram's internal REST API
    const usernames = await paginateFriendships(page, userId, type, normalizedUsername)

    mainWindow.webContents.send('scan:progress', {
      step: 'done', message: `Found ${usernames.length} ${type}`, count: usernames.length,
    })
    return { usernames, count: usernames.length }
  }, 'Scan error')
}

async function withInstagramSession(username, task, errorLabel = 'Instagram session error') {
  const chromium = getPlaywrightChromium()
  if (chromium.error) return { error: chromium.error }

  const sessionPath = getSessionPath(username)
  if (sessionPath.error) return { error: sessionPath.error }

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
    console.error(`${errorLabel}:`, e)
    return { error: e.message }
  } finally {
    try { if (ctx) await ctx.close() } catch (_) {}
  }
}

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
        'Please run the following command once and restart the app:\n\n' +
        '    npx playwright install chromium',
    }
  }
}

function getSessionPath(username) {
  const sessionPath = path.join(userDataPath, `session_${username}`)
  try {
    fs.mkdirSync(sessionPath, { recursive: true })
  } catch (e) {
    return { error: `Could not create session directory: ${e.message}` }
  }

  for (const lock of ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'lockfile']) {
    const p = path.join(sessionPath, lock)
    try { if (fs.existsSync(p)) fs.unlinkSync(p) } catch (_) {}
  }

  return sessionPath
}

function normalizeUsername(value) {
  return String(value || '').trim().replace(/^@/, '').toLowerCase()
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

async function unfollowUser(page, userId) {
  return unfollowViaProfileUi(page, userId)
}

async function unfollowViaProfileUi(page, username) {
  try {
    const profileResponse = await page.goto(`https://www.instagram.com/${username}/`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    })

    const profileRedirect = getInstagramRedirectError(page, profileResponse)
    if (profileRedirect) return profileRedirect

    const ok = await waitForLogin(page, 15000)
    if (!ok) {
      return { ok: false, error: 'Login timed out.' }
    }

    const beforeState = await getProfileActionState(page)
    if (beforeState.rateLimited) {
      return {
        ok: false,
        rateLimited: true,
        error: 'Instagram rate-limited the unfollow flow. Wait a few minutes before trying again.',
      }
    }
    if (beforeState.following === false) {
      return { ok: false, error: 'This profile is already not followed.' }
    }

    const followingButton = await findVisibleLocator(page, [
      () => page.locator('header button').filter({ hasText: /^(following|requested)$/i }),
      () => page.locator('header [role="button"]').filter({ hasText: /^(following|requested)$/i }),
      () => page.getByRole('button', { name: /^(following|requested)$/i }),
      () => page.getByRole('button', { name: /^following/i }),
    ], 8000)

    if (!followingButton) {
      return { ok: false, error: 'Could not find the Following button on that profile.' }
    }

    await followingButton.click()
    await page.waitForTimeout(900)

    const unfollowButton = await findVisibleLocator(page, [
      () => page.getByRole('button', { name: /^unfollow$/i }),
      () => page.locator('[role="dialog"] button').filter({ hasText: /^unfollow$/i }),
      () => page.locator('[role="dialog"] [role="button"]').filter({ hasText: /^unfollow$/i }),
      () => page.locator('[role="menu"] button').filter({ hasText: /^unfollow$/i }),
      () => page.locator('[role="menu"] [role="button"]').filter({ hasText: /^unfollow$/i }),
      () => page.locator('button').filter({ hasText: /^unfollow$/i }),
      () => page.locator('[role="button"]').filter({ hasText: /^unfollow$/i }),
      () => page.getByText(/^unfollow$/i),
    ], 8000)

    if (!unfollowButton) {
      await page.keyboard.press('Escape').catch(() => {})
      return { ok: false, error: 'Could not find the Unfollow confirmation button.' }
    }

    await unfollowButton.click()
    await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {})

    const confirmationRedirect = getInstagramRedirectError(page)
    if (confirmationRedirect) return confirmationRedirect

    const verifiedState = await waitForProfileActionState(page, state => state.following === false, 12000)
    if (verifiedState?.following === false) {
      return { ok: true }
    }
    if (verifiedState?.rateLimited) {
      return {
        ok: false,
        rateLimited: true,
        error: 'Instagram rate-limited the verification step. Wait a few minutes before trying again.',
      }
    }

    return { ok: false, error: 'Instagram did not confirm the profile changed to Follow/Follow Back.' }
  } catch (error) {
    return { ok: false, error: error.message || 'UI unfollow failed.' }
  }
}

function getInstagramRedirectError(page, response = null) {
  const status = response?.status?.()
  const url = page.url()

  if (status && status >= 300 && status < 400) {
    return {
      ok: false,
      error: `Instagram redirected the request with HTTP ${status}. Open the Instagram window and finish any login, challenge, or verification prompt, then try again.`,
    }
  }

  if (/\/accounts\/login\b/.test(url)) {
    return {
      ok: false,
      error: 'Instagram redirected to login. Sign in in the opened Instagram window, then try again.',
    }
  }

  if (/\/challenge\b|\/challenge\//.test(url)) {
    return {
      ok: false,
      error: 'Instagram redirected to a verification challenge. Complete it in the opened Instagram window, then try again.',
    }
  }

  if (/\/accounts\/onetap\b|\/accounts\/suspended\b|\/accounts\/disabled\b/.test(url)) {
    return {
      ok: false,
      error: 'Instagram redirected away from the profile. Resolve the prompt in the opened Instagram window, then try again.',
    }
  }

  return null
}

async function getProfileActionState(page) {
  try {
    return await page.evaluate(() => {
      const getText = (element) => (element?.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase()
      const root = document.querySelector('header') || document
      const candidates = [...root.querySelectorAll('button, [role="button"]')]
      const texts = candidates.map(getText).filter(Boolean)

      if (texts.some(text => text.includes('try again later'))) {
        return { following: null, rateLimited: true }
      }
      if (texts.some(text => /^following$/.test(text) || /^requested$/.test(text))) {
        return { following: true, rateLimited: false }
      }
      if (texts.some(text => /^follow back$/.test(text) || /^follow$/.test(text))) {
        return { following: false, rateLimited: false }
      }

      try {
        const bodyText = (document.body?.innerText || '').toLowerCase()
        if (bodyText.includes('try again later')) {
          return { following: null, rateLimited: true }
        }
      } catch (_) {}

      return {
        following: null,
        rateLimited: false,
      }
    })
  } catch (error) {
    return { error: error.message || 'Could not inspect the profile.' }
  }
}

async function waitForProfileActionState(page, predicate, timeout = 8000) {
  const deadline = Date.now() + timeout
  let latest = null

  while (Date.now() < deadline) {
    latest = await getProfileActionState(page)
    if (predicate(latest)) return latest
    if (latest.rateLimited) return latest
    await page.waitForTimeout(400)
  }

  return latest
}

async function findVisibleLocator(page, locatorFactories, timeout = 5000) {
  const deadline = Date.now() + timeout

  while (Date.now() < deadline) {
    for (const createLocator of locatorFactories) {
      try {
        const locator = createLocator().first()
        if (await locator.isVisible().catch(() => false)) {
          return locator
        }
      } catch (_) {}
    }

    await page.waitForTimeout(250)
  }

  return null
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
