// src/pages/RelationsPage.jsx
import { useState, useEffect } from 'react'
import s from './RelationsPage.module.css'

const VIEWS = [
  { id: 'notFollowingBack', label: 'Not following back', color: 'var(--red)', desc: 'You follow them · they don\'t follow you back' },
  { id: 'fans',            label: 'Fans',               color: 'var(--gold)', desc: 'They follow you · you don\'t follow them back' },
  { id: 'mutuals',         label: 'Mutuals',            color: 'var(--green)', desc: 'You both follow each other' },
]

export default function RelationsPage({ account }) {
  const [snapshots, setSnapshots] = useState([])
  const [followerSnapId, setFollowerSnapId] = useState('')
  const [followingSnapId, setFollowingSnapId] = useState('')
  const [result, setResult] = useState(null)
  const [view, setView] = useState('notFollowingBack')
  const [filter, setFilter] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (account) loadSnaps()
  }, [account])

  async function loadSnaps() {
    const snaps = await window.api.snapshots.list(account.id)
    setSnapshots(snaps)
    const fols = snaps.find(ss => ss.type === 'followers')
    const fing = snaps.find(ss => ss.type === 'following')
    if (fols) setFollowerSnapId(String(fols.id))
    if (fing) setFollowingSnapId(String(fing.id))
  }

  async function runCrossDiff() {
    if (!followerSnapId || !followingSnapId) return
    setLoading(true)
    try {
      const res = await window.api.snapshots.crossDiff({
        followersSnapshotId: parseInt(followerSnapId),
        followingSnapshotId: parseInt(followingSnapId),
      })
      setResult(res)
    } finally {
      setLoading(false)
    }
  }

  const followerSnaps = snapshots.filter(ss => ss.type === 'followers')
  const followingSnaps = snapshots.filter(ss => ss.type === 'following')

  const current = result ? result[view] : []
  const filtered = current.filter(u => u.toLowerCase().includes(filter.toLowerCase()))

  const canRun = followerSnapId && followingSnapId

  return (
    <div className={s.page}>
      <div className={s.hdr}>
        <div className={s.eyebrow}>Relations</div>
        <h1 className={s.title}>Follower relationships</h1>
        <p className={s.sub}>Cross-reference your followers and following to see mutuals, fans, and who isn't following back.</p>
      </div>

      {/* Snapshot selectors */}
      <div className={s.selRow}>
        <div className={s.selGroup}>
          <label className={s.selLabel}>Followers snapshot</label>
          <select className={s.sel} value={followerSnapId} onChange={e => setFollowerSnapId(e.target.value)}>
            <option value="">— select —</option>
            {followerSnaps.map(ss => (
              <option key={ss.id} value={ss.id}>{ss.totalCount.toLocaleString()} · {fmtDate(ss.takenAt)}</option>
            ))}
          </select>
        </div>
        <div className={s.selGroup}>
          <label className={s.selLabel}>Following snapshot</label>
          <select className={s.sel} value={followingSnapId} onChange={e => setFollowingSnapId(e.target.value)}>
            <option value="">— select —</option>
            {followingSnaps.map(ss => (
              <option key={ss.id} value={ss.id}>{ss.totalCount.toLocaleString()} · {fmtDate(ss.takenAt)}</option>
            ))}
          </select>
        </div>
        <button className={s.runBtn} onClick={runCrossDiff} disabled={!canRun || loading}>
          {loading ? 'Analyzing...' : 'Analyze →'}
        </button>
      </div>

      {!canRun && (
        <div className={s.needBoth}>
          You need at least one <strong>followers</strong> scan and one <strong>following</strong> scan to use this page.
        </div>
      )}

      {result && (
        <>
          {/* Summary cards */}
          <div className={s.cards}>
            {VIEWS.map(v => (
              <button
                key={v.id}
                className={`${s.card} ${view === v.id ? s.cardActive : ''}`}
                onClick={() => setView(v.id)}
                style={view === v.id ? { borderColor: v.color } : {}}
              >
                <div className={s.cardNum} style={{ color: v.color }}>{result[v.id].length.toLocaleString()}</div>
                <div className={s.cardLabel}>{v.label}</div>
                <div className={s.cardDesc}>{v.desc}</div>
              </button>
            ))}
          </div>

          {/* Search */}
          <div className={s.searchBar}>
            <SearchIcon />
            <input
              className={s.searchInput}
              placeholder={`Search ${view === 'notFollowingBack' ? 'not following back' : view}...`}
              value={filter}
              onChange={e => setFilter(e.target.value)}
            />
            {filter && <button className={s.clearBtn} onClick={() => setFilter('')}>×</button>}
          </div>

          {/* List */}
          <div className={s.list}>
            {filtered.length === 0 ? (
              <div className={s.empty}>{filter ? 'No matches' : `No users in this category`}</div>
            ) : (
              filtered.map(u => (
                <RelationRow
                  key={u}
                  username={u}
                  view={view}
                />
              ))
            )}
          </div>

          <div className={s.listCount}>
            Showing {filtered.length.toLocaleString()} of {current.length.toLocaleString()}
          </div>
        </>
      )}
    </div>
  )
}

function RelationRow({ username, view }) {
  const colors = {
    notFollowingBack: { bg: 'var(--red-dim)', color: 'var(--red)', tag: '← not following back' },
    fans:             { bg: 'var(--gold-dim)', color: 'var(--gold)', tag: '→ fan' },
    mutuals:          { bg: 'var(--green-dim)', color: 'var(--green)', tag: '↔ mutual' },
  }
  const { bg, color, tag } = colors[view]

  function openProfile() {
    window.api.shell.openExternal(`https://instagram.com/${username}`)
  }

  return (
    <div className={s.row}>
      <div className={s.avatar} style={{ background: bg, color }}>
        {username.slice(0, 2).toUpperCase()}
      </div>
      <span className={s.username}>@{username}</span>
      <span className={s.tag} style={{ background: bg, color }}>{tag}</span>
      <button className={s.extBtn} onClick={openProfile} title="Open on Instagram">
        <ExternalIcon />
      </button>
    </div>
  )
}

function fmtDate(dt) {
  return new Date(dt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function SearchIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{flexShrink:0,color:'var(--text3)'}}><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg> }
function ExternalIcon() { return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/></svg> }
