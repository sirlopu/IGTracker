// src/pages/ScanPage.jsx
import { useState, useEffect } from 'react'
import s from './ScanPage.module.css'

const STEPS = {
  idle: null,
  opening: { label: 'Opening Instagram...', pct: 15 },
  scrolling: { label: 'Scrolling through list...', pct: 50 },
  saving: { label: 'Saving snapshot...', pct: 90 },
  done: { label: 'Done!', pct: 100 },
}

export default function ScanPage({ account, onNavigate }) {
  const [scanType, setScanType] = useState('followers')
  const [scanning, setScanning] = useState(false)
  const [progress, setProgress] = useState(null) // { step, message, count }
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [snapshots, setSnapshots] = useState([])

  useEffect(() => {
    if (account) loadSnaps()
    // Listen for scan progress from main process
    window.api.scan.onProgress(p => setProgress(p))
    return () => window.api.scan.offProgress()
  }, [account])

  async function loadSnaps() {
    const s = await window.api.snapshots.list(account.id)
    setSnapshots(s)
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

      setProgress({ step: 'saving', message: 'Saving snapshot...' })

      const snap = await window.api.snapshots.save({
        accountId: account.id,
        type: scanType,
        usernames: res.usernames,
      })

      // Run diff if we have a previous snapshot of same type
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

      setResult({ count: res.usernames.length, diff, snap })
      setProgress({ step: 'done', message: 'Scan complete!' })
      await loadSnaps()
    } catch (e) {
      setError(e.message || 'Scan failed')
    } finally {
      setScanning(false)
    }
  }

  const pct = progress ? (STEPS[progress.step]?.pct ?? 50) : 0

  const followerSnaps = snapshots.filter(ss => ss.type === 'followers')
  const followingSnaps = snapshots.filter(ss => ss.type === 'following')

  return (
    <div className={s.page}>
      <div className={s.hdr}>
        <div className={s.eyebrow}>Scan</div>
        <h1 className={s.title}>Run a scan</h1>
        <p className={s.sub}>A browser window will open. Log into Instagram there if prompted — your session is saved locally for next time.</p>
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

      {/* Scan button */}
      {!scanning && !result && (
        <button className={s.bigScanBtn} onClick={startScan}>
          <ScanIcon />
          Scan {scanType} now
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
          <div className={s.progressHint}>Keep this window open. Do not close the browser.</div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className={s.errorCard}>
          <ErrorIcon />
          <div>
            <div className={s.errorTitle}>Scan failed</div>
            <div className={s.errorMsg}>{error}</div>
          </div>
          <button className={s.retryBtn} onClick={startScan}>Retry</button>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className={s.resultCard}>
          <div className={s.resultHdr}>
            <CheckIcon />
            <div>
              <div className={s.resultTitle}>Scan complete</div>
              <div className={s.resultSub}>{result.count.toLocaleString()} {scanType} captured</div>
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
            <button className={s.resultBtn} onClick={() => { setResult(null); setProgress(null) }}>Scan again</button>
            {result.diff && <button className={s.resultBtnPrimary} onClick={() => onNavigate('compare')}>View diff →</button>}
          </div>
        </div>
      )}

      {/* How Playwright works */}
      <div className={s.infoCard}>
        <div className={s.infoTitle}>How scanning works</div>
        <div className={s.infoGrid}>
          {[
            { icon: '🪟', t: 'Real browser', d: 'Uses Playwright to open a real Chromium window — not a hidden headless session.' },
            { icon: '🔐', t: 'Your login', d: 'You log in on Instagram\'s own page. Your password is never seen or stored by this app.' },
            { icon: '💾', t: 'Local session', d: 'Login cookies are saved on this device so future scans are one-click.' },
            { icon: '🐢', t: 'Slow by design', d: 'Random delays between scrolls to avoid triggering Instagram\'s rate limits.' },
          ].map(item => (
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

function fmtDate(dt) {
  return new Date(dt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function FollowerIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> }
function FollowingIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><polyline points="16 11 18 13 22 9"/></svg> }
function ScanIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9V5a2 2 0 012-2h4M3 15v4a2 2 0 002 2h4M15 3h4a2 2 0 012 2v4M15 21h4a2 2 0 002-2v-4"/><path d="M7 12h10"/></svg> }
function CheckIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg> }
function ErrorIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> }
