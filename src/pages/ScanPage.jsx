// src/pages/ScanPage.jsx
import { useState, useEffect } from 'react'
import s from './ScanPage.module.css'
import { formatSystemDate } from '../lib/datetime'

const STEPS = {
  idle: null,
  opening: { label: 'Opening Instagram...', pct: 15 },
  scrolling: { label: 'Scrolling through list...', pct: 50 },
  saving: { label: 'Saving snapshot...', pct: 90 },
  done: { label: 'Done!', pct: 100 },
}

export default function ScanPage({ account, onNavigate, platform = 'electron' }) {
  const isWeb = platform === 'web'
  const [scanType, setScanType] = useState('followers')
  const [scanning, setScanning] = useState(false)
  const [progress, setProgress] = useState(null) // { step, message, count }
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [snapshots, setSnapshots] = useState([])
  const [manualInput, setManualInput] = useState('')
  const [importSource, setImportSource] = useState('')

  useEffect(() => {
    if (account) loadSnaps()
    if (!isWeb) {
      window.api.scan.onProgress(p => setProgress(p))
      return () => window.api.scan.offProgress()
    }
  }, [account, isWeb])

  useEffect(() => {
    setResult(null)
    setError('')
    setProgress(null)
    setManualInput('')
    setImportSource('')
  }, [account])

  async function loadSnaps() {
    const s = await window.api.snapshots.list(account.id)
    setSnapshots(s)
  }

  async function finishSnapshot(usernames, sourceLabel) {
    const normalized = normalizeImportedUsernames(usernames)
    if (normalized.length === 0) {
      setError('Add at least one username before saving a snapshot.')
      setProgress(null)
      setScanning(false)
      return
    }

    setScanning(true)
    setResult(null)
    setError('')
    setProgress({ step: isWeb ? 'opening' : 'saving', message: isWeb ? 'Preparing imported usernames...' : 'Saving snapshot...' })

    try {
      setProgress({ step: 'saving', message: 'Saving snapshot...' })

      const snap = await window.api.snapshots.save({
        accountId: account.id,
        type: scanType,
        usernames: normalized,
      })

      const prevSnap = snapshots.find(ss => ss.type === scanType)
      let diff = null
      if (prevSnap) {
        diff = await window.api.snapshots.diff({
          fromId: prevSnap.id,
          toId: snap.id,
          accountId: account.id,
          type: scanType,
        })
      }

      setResult({ count: normalized.length, diff, snap, sourceLabel })
      setProgress({ step: 'done', message: isWeb ? 'Import complete!' : 'Scan complete!' })
      await loadSnaps()
    } catch (e) {
      setError(e.message || (isWeb ? 'Import failed' : 'Scan failed'))
    } finally {
      setScanning(false)
    }
  }

  async function startScan() {
    setScanning(true)
    setResult(null)
    setError('')
    setProgress({ step: 'opening', message: 'Launching browser...' })

    try {
      const fn = scanType === 'followers' ? window.api.scan.followers : window.api.scan.following
      const res = await fn({ username: account.username })

      if (res.error) {
        setError(res.error)
        setScanning(false)
        setProgress(null)
        return
      }

      await finishSnapshot(res.usernames, 'Instagram scan')
    } catch (e) {
      setError(e.message || 'Scan failed')
      setScanning(false)
    }
  }

  async function handleImport() {
    await finishSnapshot(parseImportedText(manualInput), importSource || 'pasted list')
  }

  async function handleFileSelect(event) {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      const text = await file.text()
      setManualInput(text)
      setImportSource(file.name)
      setError('')
    } catch (e) {
      setError(e.message || 'Could not read that file.')
    } finally {
      event.target.value = ''
    }
  }

  const pct = progress ? (STEPS[progress.step]?.pct ?? 50) : 0

  const followerSnaps = snapshots.filter(ss => ss.type === 'followers')
  const followingSnaps = snapshots.filter(ss => ss.type === 'following')

  return (
    <div className={s.page}>
      <div className={s.hdr}>
        <div className={s.eyebrow}>Scan</div>
        <h1 className={s.title}>{isWeb ? 'Import a snapshot' : 'Run a scan'}</h1>
        <p className={s.sub}>
          {isWeb
            ? 'Paste usernames or upload a plain text or CSV export to save a follower or following snapshot directly in your browser.'
            : 'A browser window will open. Log into Instagram there if prompted — your session is saved locally for next time.'}
        </p>
      </div>

      {/* Type selector */}
      <div className={s.typeSel}>
        {['followers', 'following'].map(type => (
          <button
            key={type}
            className={`${s.typeBtn} ${scanType === type ? s.typeActive : ''}`}
            onClick={() => !scanning && setScanType(type)}
            disabled={scanning}
          >
            <div className={s.typeBtnIcon}>{type === 'followers' ? <FollowerIcon /> : <FollowingIcon />}</div>
            <div>
              <div className={s.typeBtnLabel}>{type === 'followers' ? 'Followers' : 'Following'}</div>
              <div className={s.typeBtnCount}>
                {type === 'followers'
                  ? followerSnaps.length > 0 ? `Last: ${followerSnaps[0].totalCount.toLocaleString()} · ${fmtDate(followerSnaps[0].takenAt)}` : 'No scans yet'
                  : followingSnaps.length > 0 ? `Last: ${followingSnaps[0].totalCount.toLocaleString()} · ${fmtDate(followingSnaps[0].takenAt)}` : 'No scans yet'
                }
              </div>
            </div>
          </button>
        ))}
      </div>

      {isWeb && !scanning && !result && (
        <div className={s.importCard}>
          <div className={s.importHeader}>
            <div>
              <div className={s.importTitle}>Paste or upload usernames</div>
              <div className={s.importSub}>One username per line works best. Commas, spaces, and `@handles` are fine too.</div>
            </div>
            <label className={s.fileBtn}>
              Upload file
              <input
                className={s.fileInput}
                type="file"
                accept=".txt,.csv,.json"
                onChange={handleFileSelect}
              />
            </label>
          </div>

          <textarea
            className={s.importTextarea}
            value={manualInput}
            onChange={e => {
              setManualInput(e.target.value)
              if (!importSource) setImportSource('pasted list')
            }}
            placeholder={`username\nanother_user\n@thirduser`}
            spellCheck={false}
          />

          <div className={s.importFooter}>
            <div className={s.importMeta}>
              {importSource ? `Source: ${importSource}` : 'Source: pasted list'}
            </div>
            <div className={s.importMeta}>
              {normalizeImportedUsernames(parseImportedText(manualInput)).length.toLocaleString()} usernames ready
            </div>
          </div>
        </div>
      )}

      {!scanning && !result && (
        <button className={s.bigScanBtn} onClick={isWeb ? handleImport : startScan}>
          <ScanIcon />
          {isWeb ? `Save ${scanType} snapshot` : `Scan ${scanType} now`}
        </button>
      )}

      {/* Progress */}
      {scanning && (
        <div className={s.progressCard}>
          <div className={s.progressTop}>
            <div className={s.progressLabel}>{progress?.message || 'Starting...'}</div>
            {progress?.count && <div className={s.progressCount}>{progress.count.toLocaleString()} found</div>}
          </div>
          <div className={s.progressBar}>
            <div className={s.progressFill} style={{ width: `${pct}%` }} />
          </div>
          <div className={s.progressHint}>{isWeb ? 'Your imported data stays in this browser only.' : 'Keep this window open. Do not close the browser.'}</div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className={s.errorCard}>
          <ErrorIcon />
          <div>
            <div className={s.errorTitle}>{isWeb ? 'Import failed' : 'Scan failed'}</div>
            <div className={s.errorMsg}>{error}</div>
          </div>
          <button className={s.retryBtn} onClick={isWeb ? handleImport : startScan}>{isWeb ? 'Try again' : 'Retry'}</button>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className={s.resultCard}>
          <div className={s.resultHdr}>
            <CheckIcon />
            <div>
              <div className={s.resultTitle}>{isWeb ? 'Snapshot saved' : 'Scan complete'}</div>
              <div className={s.resultSub}>
                {result.count.toLocaleString()} {scanType} captured{result.sourceLabel ? ` · ${result.sourceLabel}` : ''}
              </div>
            </div>
          </div>

          {result.diff ? (
            <div className={s.diffRow}>
              <div className={`${s.diffBadge} ${s.diffGained}`}>+{result.diff.gainedCount} new</div>
              <div className={`${s.diffBadge} ${s.diffLost}`}>−{result.diff.lostCount} lost</div>
              <div className={s.diffNet} style={{ color: result.diff.gainedCount - result.diff.lostCount >= 0 ? 'var(--green)' : 'var(--red)' }}>
                Net {result.diff.gainedCount - result.diff.lostCount >= 0 ? '+' : ''}{result.diff.gainedCount - result.diff.lostCount}
              </div>
            </div>
          ) : (
            <div className={s.firstScan}>First scan — no comparison yet. Run another scan later to see changes.</div>
          )}

          <div className={s.resultActions}>
            <button className={s.resultBtn} onClick={() => { setResult(null); setProgress(null) }}>{isWeb ? 'Import another' : 'Scan again'}</button>
            {result.diff && <button className={s.resultBtnPrimary} onClick={() => onNavigate('compare')}>View diff →</button>}
          </div>
        </div>
      )}

      <div className={s.infoCard}>
        <div className={s.infoTitle}>{isWeb ? 'How web imports work' : 'How scanning works'}</div>
        <div className={s.infoGrid}>
          {(isWeb
            ? [
                { icon: '📥', t: 'Manual import', d: 'Paste usernames or upload a file from any workflow you trust.' },
                { icon: '💾', t: 'Browser-local storage', d: 'Accounts, snapshots, and diffs are saved in this browser only.' },
                { icon: '📊', t: 'Same analytics', d: 'Compare snapshots, inspect gains/losses, and analyze relationships like the desktop app.' },
                { icon: '🔐', t: 'No login handling', d: 'The web version never requests Instagram credentials or automation access.' },
              ]
            : [
                { icon: '🪟', t: 'Real browser', d: 'Uses Playwright to open a real Chromium window — not a hidden headless session.' },
                { icon: '🔐', t: 'Your login', d: 'You log in on Instagram\'s own page. Your password is never seen or stored by this app.' },
                { icon: '💾', t: 'Local session', d: 'Login cookies are saved on this device so future scans are one-click.' },
                { icon: '🐢', t: 'Slow by design', d: 'Random delays between scrolls to avoid triggering Instagram\'s rate limits.' },
              ]
          ).map(item => (
            <div key={item.t} className={s.infoItem}>
              <span className={s.infoItemIcon}>{item.icon}</span>
              <div>
                <div className={s.infoItemTitle}>{item.t}</div>
                <div className={s.infoItemDesc}>{item.d}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function parseImportedText(text) {
  const trimmed = String(text || '').trim()
  if (!trimmed) return []

  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) return parsed
      if (Array.isArray(parsed?.usernames)) return parsed.usernames
    } catch {
      return trimmed.split(/[\s,]+/)
    }
  }

  return trimmed
    .split(/[\n\r,]+/)
    .flatMap(part => part.split(/\s+/))
    .filter(Boolean)
}

function normalizeImportedUsernames(values) {
  return [...new Set(
    values
      .map(value => String(value || '').trim().replace(/^@/, '').toLowerCase())
      .filter(value => value && value !== 'username')
  )]
}

function fmtDate(dt) {
  return formatSystemDate(dt, { month: 'short', day: 'numeric' })
}

function FollowerIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> }
function FollowingIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><polyline points="16 11 18 13 22 9"/></svg> }
function ScanIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9V5a2 2 0 012-2h4M3 15v4a2 2 0 002 2h4M15 3h4a2 2 0 012 2v4M15 21h4a2 2 0 002-2v-4"/><path d="M7 12h10"/></svg> }
function CheckIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg> }
function ErrorIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> }
