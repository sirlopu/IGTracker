// src/pages/DashboardPage.jsx
import { useState, useEffect } from 'react'
import s from './DashboardPage.module.css'
import { formatSystemDate, parseAppDate } from '../lib/datetime'

export default function DashboardPage({ account, onNavigate }) {
  const [snapshots, setSnapshots] = useState([])
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (account) load()
  }, [account])

  async function load() {
    setLoading(true)
    try {
      const [snaps, evs] = await Promise.all([
        window.api.snapshots.list(account.id),
        window.api.events.list(account.id),
      ])
      setSnapshots(snaps)
      setEvents(evs)
    } finally {
      setLoading(false)
    }
  }

  const followerSnaps = snapshots.filter(s => s.type === 'followers')
  const followingSnaps = snapshots.filter(s => s.type === 'following')
  const latest = followerSnaps[0]
  const prev = followerSnaps[1]

  const recentGained = events.filter(e => e.eventType === 'gained_follower').slice(0, 8)
  const recentLost = events.filter(e => e.eventType === 'lost_follower').slice(0, 8)

  return (
    <div className={s.page}>
      <div className={s.hdr}>
        <div>
          <div className={s.eyebrow}>Dashboard</div>
          <h1 className={s.title}>@{account.username}</h1>
        </div>
        <button className={s.scanBtn} onClick={() => onNavigate('scan')}>
          <ScanIcon /> Run scan
        </button>
      </div>

      {!loading && followerSnaps.length === 0 && (
        <div className={s.empty}>
          <div className={s.emptyIcon}><ScanIcon /></div>
          <h3>No scans yet</h3>
          <p>Run your first scan to start tracking followers.</p>
          <button className={s.emptyBtn} onClick={() => onNavigate('scan')}>Scan now →</button>
        </div>
      )}

      {followerSnaps.length > 0 && (
        <>
          {/* Stat cards */}
          <div className={s.stats}>
            <StatCard label="Followers" value={latest?.totalCount ?? '—'} sub={`as of ${latest ? fmtDate(latest.takenAt) : '—'}`} accent="pink" />
            <StatCard label="Following" value={followingSnaps[0]?.totalCount ?? '—'} sub={`as of ${followingSnaps[0] ? fmtDate(followingSnaps[0].takenAt) : '—'}`} accent="blue" />
            <StatCard
              label="Net change"
              value={latest && prev ? fmt(latest.totalCount - prev.totalCount, true) : '—'}
              sub={prev ? `vs ${fmtDate(prev.takenAt)}` : 'need 2 scans'}
              accent="gold"
            />
            <StatCard label="Total scans" value={snapshots.length} sub={`${followerSnaps.length} follower · ${followingSnaps.length} following`} accent="green" />
          </div>

          {/* Recent events */}
          <div className={s.cols}>
            <EventList title="Recent gains" items={recentGained} type="gained" onNavigate={onNavigate} />
            <EventList title="Recent losses" items={recentLost} type="lost" onNavigate={onNavigate} />
          </div>

          {/* Snapshot history */}
          <div className={s.section}>
            <div className={s.sectionHdr}>
              <span className={s.sectionTitle}>Scan history</span>
              <button className={s.seeAll} onClick={() => onNavigate('compare')}>Compare →</button>
            </div>
            <div className={s.table}>
              <div className={s.tableHead}>
                <span>Date</span><span>Type</span><span>Count</span><span>Change</span>
              </div>
              {snapshots.slice(0, 12).map((snap, i) => {
                const typeSnaps = snapshots.filter(ss => ss.type === snap.type)
                const idx = typeSnaps.indexOf(snap)
                const prevSnap = typeSnaps[idx + 1]
                const delta = prevSnap ? snap.totalCount - prevSnap.totalCount : null
                return (
                  <div key={snap.id} className={s.tableRow}>
                    <span>{fmtDate(snap.takenAt)}</span>
                    <span>
                      <span className={snap.type === 'followers' ? s.badgePink : s.badgeBlue}>
                        {snap.type}
                      </span>
                    </span>
                    <span>{snap.totalCount.toLocaleString()}</span>
                    <span style={{ color: delta === null ? 'var(--text3)' : delta > 0 ? 'var(--green)' : delta < 0 ? 'var(--red)' : 'var(--text3)' }}>
                      {delta === null ? '—' : fmt(delta, true)}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function StatCard({ label, value, sub, accent }) {
  const colors = { pink: 'var(--pink)', blue: 'var(--blue)', gold: 'var(--gold)', green: 'var(--green)' }
  return (
    <div className={s.statCard}>
      <div className={s.statLabel}>{label}</div>
      <div className={s.statValue} style={{ color: typeof value === 'string' && value.startsWith('+') ? 'var(--green)' : typeof value === 'string' && value.startsWith('-') ? 'var(--red)' : colors[accent] }}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
      <div className={s.statSub}>{sub}</div>
    </div>
  )
}

function EventList({ title, items, type, onNavigate }) {
  const color = type === 'gained' ? 'var(--green)' : 'var(--red)'
  const dot = type === 'gained' ? s.dotGreen : s.dotRed
  return (
    <div className={s.eventCard}>
      <div className={s.eventHdr}>
        <div className={s.eventTitle}>
          <div className={`${s.dot} ${dot}`} />
          {title}
        </div>
        <button className={s.seeAll} onClick={() => onNavigate('events')}>All →</button>
      </div>
      {items.length === 0 ? (
        <div className={s.eventEmpty}>No recent events</div>
      ) : (
        items.map(ev => (
          <div key={ev.id} className={s.eventRow}>
            <div className={s.eventAvatar} style={{ background: type === 'gained' ? 'var(--green-dim)' : 'var(--red-dim)', color }}>
              {ev.username.slice(0, 2).toUpperCase()}
            </div>
            <span className={s.eventUser}>@{ev.username}</span>
            <span className={s.eventTime}>{fmtRelative(ev.createdAt)}</span>
          </div>
        ))
      )}
    </div>
  )
}

function fmt(n, sign = false) {
  if (n === null || n === undefined) return '—'
  return (sign && n > 0 ? '+' : '') + n.toLocaleString()
}

function fmtDate(dt) {
  return formatSystemDate(dt, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function fmtRelative(dt) {
  const diff = Date.now() - parseAppDate(dt).getTime()
  const h = Math.floor(diff / 3600000)
  if (h < 1) return 'just now'
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function ScanIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9V5a2 2 0 012-2h4M3 15v4a2 2 0 002 2h4M15 3h4a2 2 0 012 2v4M15 21h4a2 2 0 002-2v-4"/><path d="M7 12h10"/></svg> }
