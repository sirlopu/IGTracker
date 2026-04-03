# IGTracker

A local-first Instagram follower tracker. Runs entirely on your device via Electron + Playwright. No server, no API keys, no native compilation required.

## Quick start

```bash
# 1. Install — no native compilation, should succeed on macOS/Windows/Linux
npm install

# 2. Install Playwright's Chromium browser (first time only, ~150MB)
npx playwright install chromium

# 3. Run in dev mode
npm run dev
```

That's it. No database setup step — the SQLite DB is created automatically on first launch inside your Electron userData folder.

## Stack

| Layer      | Tech                                  |
|------------|---------------------------------------|
| Shell      | Electron 29                           |
| UI         | React 18 + Vite 5 + CSS Modules       |
| Automation | Playwright (persistent browser context) |
| Database   | sql.js (pure WebAssembly SQLite — **no native compilation**) |
| Fonts      | Syne + DM Mono (Google Fonts)         |

## Why sql.js instead of better-sqlite3?

`better-sqlite3` and similar packages require compiling native Node addons, which fails on many machines without the right Xcode/Visual Studio build tools. `sql.js` is pure WebAssembly — it runs identically everywhere with zero compilation.

The tradeoff is that sql.js loads the entire database into memory, which is fine for this use case (a few thousand usernames per snapshot).

## Project structure

```
igtracker/
├── electron/
│   ├── main.js       # Main process: sql.js DB + IPC handlers + Playwright scanning
│   └── preload.js    # Secure context bridge → window.api
├── src/
│   ├── App.jsx
│   ├── components/
│   │   └── Sidebar.jsx
│   └── pages/
│       ├── ConnectPage.jsx    # Add account
│       ├── DashboardPage.jsx  # Stats overview
│       ├── ScanPage.jsx       # Launch Playwright scan
│       ├── ComparePage.jsx    # Diff two snapshots
│       ├── RelationsPage.jsx  # Mutuals / fans / not-following-back
│       └── EventsPage.jsx     # Activity feed
└── package.json
```

## Database

- Location: `~/Library/Application Support/igtracker/igtracker.db` (macOS)
  - Windows: `%APPDATA%\igtracker\igtracker.db`
  - Linux: `~/.config/igtracker/igtracker.db`
- Plain SQLite file — open with DB Browser for SQLite or any SQLite viewer
- Automatically created and migrated on first launch

## How scanning works

1. Click **Add account** → enter your username (no password)
2. Go to **Scan** → click **Scan followers now**
3. A real Chromium window opens pointing at `instagram.com`
4. If not logged in, log in on Instagram's own page — IGTracker never sees your credentials
5. Session cookies are saved to `userData/session_<username>/` for future scans
6. The app scrolls through your followers modal automatically with random jitter delays
7. Usernames are extracted from the DOM via two independent selector strategies
8. Results are saved to SQLite; a diff is computed against the previous snapshot

## Updating selectors

Instagram changes their DOM periodically. If scans return 0 results, update the extraction logic in `extractList()` in `electron/main.js` — specifically the `querySelectorAll` calls inside the `page.evaluate()` block.

## Building for distribution

```bash
npm run build
# Output: dist-electron/
```

## Privacy

- No server, no cloud, no telemetry
- Your Instagram password is never entered in or stored by this app
- Session cookies live in your `userData` folder only
- The DB is a local file you fully control
- For accounts you own only — not for surveillance of others

## License

This project is licensed under the MIT License — see the LICENSE file for details.
