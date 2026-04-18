// src/pages/ConnectPage.jsx
import { useState } from 'react'
import s from './ConnectPage.module.css'

export default function ConnectPage({ onAdd, dbError, platform = 'electron' }) {
  const [username, setUsername] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const isWeb = platform === 'web'

  async function handleConnect() {
    const u = username.trim().replace(/^@/, '')
    if (!u) { setError('Enter your Instagram username.'); return }
    setLoading(true)
    setError('')
    try {
      await onAdd(u)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={s.page}>
      <div className={s.wrap}>

        {dbError && (
          <div className={s.dbErrorBanner}>
            <div className={s.dbErrorIcon}><AlertIcon /></div>
            <div>
              <div className={s.dbErrorTitle}>Database unavailable</div>
              <div className={s.dbErrorBody}>
                IGTracker could not initialise its local database. Your data cannot be saved until this is resolved.
                Try <strong>restarting the app</strong>. If the problem persists, reinstall the application.
              </div>
            </div>
          </div>
        )}

        <div className={s.hero}>
          <div className={s.heroIcon}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="white">
              <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
            </svg>
          </div>
          <h1 className={s.heroTitle}>Connect Instagram</h1>
          <p className={s.heroSub}>Your data stays entirely on this device. IGTracker never sees your password.</p>
        </div>

        <div className={s.card}>
          <div className={s.field}>
            <label className={s.label}>Instagram username</label>
            <div className={s.inputWrap}>
              <span className={s.inputAt}>@</span>
              <input
                className={s.input}
                type="text"
                placeholder="yourhandle"
                value={username}
                onChange={e => setUsername(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleConnect()}
                autoFocus
              />
            </div>
            {error && <p className={s.error}>{error}</p>}
          </div>

          <button
            className={s.btn}
            onClick={handleConnect}
            disabled={loading || dbError}
            title={dbError ? 'Database unavailable — restart the app' : undefined}
          >
            {loading ? 'Adding...' : 'Add account →'}
          </button>
        </div>

        <div className={s.howItWorks}>
          <h3 className={s.hiwTitle}>How it works</h3>
          <div className={s.steps}>
              {[
                { n: '1', t: 'Add your username', d: 'No password needed here. Just your handle.' },
              { n: '2', t: isWeb ? 'Import a list' : 'Scan followers', d: isWeb ? 'Paste or upload exported follower usernames from your browser.' : 'A browser window opens. You log in on Instagram\'s own site.' },
              { n: '3', t: isWeb ? 'Save locally in your browser' : 'Session saved locally', d: isWeb ? 'Accounts, snapshots, and events stay in this browser only.' : 'Your login cookies stay on this device only.' },
              { n: '4', t: 'Track changes', d: isWeb ? 'Import a fresh list later to see new followers, losses, and relationship changes.' : 'One click re-scans and shows you exactly who changed.' },
            ].map(step => (
              <div key={step.n} className={s.step}>
                <div className={s.stepNum}>{step.n}</div>
                <div>
                  <div className={s.stepTitle}>{step.t}</div>
                  <div className={s.stepDesc}>{step.d}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className={s.privacyNote}>
          <ShieldIcon />
          <span>{isWeb ? 'Runs entirely in your browser with local storage. Import only data you control.' : 'Runs locally via Playwright. No credentials leave your machine. Not for scraping third-party accounts.'}</span>
        </div>
      </div>
    </div>
  )
}

function ShieldIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={{flexShrink:0}}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
}
function AlertIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{flexShrink:0}}><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
}
