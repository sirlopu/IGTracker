// src/pages/EventsPage.jsx
import { useState, useEffect } from 'react'
import s from './EventsPage.module.css'
import { formatSystemDate, formatSystemTime } from '../lib/datetime'

const EVENT_META = {
  gained_follower: { label: 'Followed you',   color: 'var(--green)', bg: 'var(--green-dim)', icon: '+' },
  lost_follower:   { label: 'Unfollowed you', color: 'var(--red)',   bg: 'var(--red-dim)',   icon: '−' },
  new_following:   { label: 'You followed',   color: 'var(--blue)',  bg: 'var(--blue-dim)',  icon: '→' },
  unfollowed:      { label: 'You unfollowed', color: 'var(--gold)',  bg: 'var(--gold-dim)',  icon: '←' },
  unfollow_failed: { label: 'Unfollow failed', color: 'var(--red)',  bg: 'var(--red-dim)',   icon: '!' },
}

export default function EventsPage({ account }) {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (account) load()
  }, [account])

  async function load() {
    setLoading(true)
    try {
      const evs = await window.api.events.list(account.id)
      setEvents(evs)
    } finally {
      setLoading(false)
    }
  }

  const filtered = events
    .filter(e => filter === 'all' || e.eventType === filter)
    .filter(e => !search || e.username.toLowerCase().includes(search.toLowerCase()))

  const counts = {
    all: events.length,
    gained_follower: events.filter(e => e.eventType === 'gained_follower').length,
    lost_follower:   events.filter(e => e.eventType === 'lost_follower').length,
    new_following:   events.filter(e => e.eventType === 'new_following').length,
    unfollowed:      events.filter(e => e.eventType === 'unfollowed').length,
    unfollow_failed: events.filter(e => e.eventType === 'unfollow_failed').length,
  }

  // Group by date
  const grouped = filtered.reduce((acc, ev) => {
    const day = formatSystemDate(ev.createdAt, { weekday: 'long', month: 'long', day: 'numeric' })
    if (!acc[day]) acc[day] = []
    acc[day].push(ev)
    return acc
  }, {})

  return (
    <div className={s.page}>
      <div className={s.hdr}>
        <div className={s.eyebrow}>Events</div>
        <h1 className={s.title}>Activity feed</h1>
        <p className={s.sub}>All follower changes and unfollow action results in one timeline.</p>
      </div>

      <div className={s.toolbar}>
        <button
          className={s.refreshBtn}
          onClick={load}
          disabled={loading}
          title={loading ? 'Refreshing events' : 'Refresh events'}
          aria-label={loading ? 'Refreshing events' : 'Refresh events'}
        >
          <RefreshIcon spinning={loading} />
        </button>
      </div>

      {/* Filter chips */}
      <div className={s.filters}>
        <button className={`${s.chip} ${filter === 'all' ? s.chipActive : ''}`} onClick={() => setFilter('all')}>
          All <span className={s.chipCount}>{counts.all}</span>
        </button>
        {Object.entries(EVENT_META).map(([key, meta]) => (
          <button
            key={key}
            className={`${s.chip} ${filter === key ? s.chipActive : ''}`}
            onClick={() => setFilter(key)}
            style={filter === key ? { borderColor: meta.color, color: meta.color } : {}}
          >
            {meta.label} <span className={s.chipCount}>{counts[key]}</span>
          </button>
        ))}
      </div>

      {/* Search */}
      <div className={s.searchBar}>
        <SearchIcon />
        <input
          className={s.searchInput}
          placeholder="Search by username..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {search && <button className={s.clearBtn} onClick={() => setSearch('')}>×</button>}
      </div>

      {/* Event groups */}
      {loading ? (
        <div className={s.loading}>Loading events...</div>
      ) : Object.keys(grouped).length === 0 ? (
        <div className={s.empty}>
          {events.length === 0
            ? 'No events yet. Run two scans of the same type to generate a diff.'
            : 'No events match your filter.'}
        </div>
      ) : (
        Object.entries(grouped).map(([day, dayEvents]) => (
          <div key={day} className={s.group}>
            <div className={s.groupDate}>{day}</div>
            <div className={s.groupList}>
              {dayEvents.map(ev => {
                const meta = EVENT_META[ev.eventType] || {}
                return (
                  <div key={ev.id} className={s.eventRow}>
                    <div className={s.eventIcon} style={{ background: meta.bg, color: meta.color }}>
                      {meta.icon}
                    </div>
                    <div className={s.eventInfo}>
                      <span className={s.eventUser}>@{ev.username}</span>
                      <span className={s.eventLabel} style={{ color: meta.color }}>{meta.label}</span>
                    </div>
                    <span className={s.eventTime}>{fmtTime(ev.createdAt)}</span>
                    <button
                      className={s.extBtn}
                      onClick={() => window.api.shell.openExternal(`https://instagram.com/${ev.username}`)}
                      title="Open on Instagram"
                    >
                      <ExternalIcon />
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        ))
      )}
    </div>
  )
}

function fmtTime(dt) {
  return formatSystemTime(dt, { hour: '2-digit', minute: '2-digit' })
}

function SearchIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{flexShrink:0,color:'var(--text3)'}}><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg> }
function ExternalIcon() { return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/></svg> }
function RefreshIcon({ spinning = false }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      style={spinning ? { animation: 'spin 1s linear infinite' } : undefined}
    >
      <path d="M21 2v6h-6" />
      <path d="M3 12a9 9 0 0 1 15.55-6.36L21 8" />
      <path d="M3 22v-6h6" />
      <path d="M21 12a9 9 0 0 1-15.55 6.36L3 16" />
    </svg>
  )
}
