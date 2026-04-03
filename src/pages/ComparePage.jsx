// src/pages/ComparePage.jsx
import { useState, useEffect } from 'react'
import s from './ComparePage.module.css'

export default function ComparePage({ account }) {
  const [snapshots, setSnapshots] = useState([])
  const [fromId, setFromId] = useState('')
  const [toId, setToId] = useState('')
  const [diff, setDiff] = useState(null)
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('')
  const [tab, setTab] = useState('gained') // gained | lost

  useEffect(() => {
    if (account) loadSnaps()
  }, [account])

  async function loadSnaps() {
    const s = await window.api.snapshots.list(account.id)
    setSnapshots(s)
    // Default: compare two most recent of same type
    const fol = s.filter(ss => ss.type === 'followers')
    if (fol.length >= 2) {
      setToId(String(fol[0].id))
      setFromId(String(fol[1].id))
    }
  }

  async function runDiff() {
    if (!fromId || !toId || fromId === toId) return
    setLoading(true)
    try {
      const from = snapshots.find(ss => ss.id === parseInt(fromId))
      const to = snapshots.find(ss => ss.id === parseInt(toId))
      const result = await window.api.snapshots.diff({
        fromId: parseInt(fromId),
        toId: parseInt(toId),
        accountId: account.id,
        type: from?.type || 'followers',
      })
      setDiff(result)
    } finally {
      setLoading(false)
    }
  }

  async function handleExport() {
    await window.api.export.csv({
      snapshotId: parseInt(toId),
      filename: `followers_${new Date().toISOString().slice(0,10)}.csv`,
    })
  }

  const filteredGained = diff?.gained.filter(u => u.includes(filter.toLowerCase())) || []
  const filteredLost = diff?.lost.filter(u => u.includes(filter.toLowerCase())) || []

  const followerSnaps = snapshots.filter(ss => ss.type === 'followers')
  const followingSnaps = snapshots.filter(ss => ss.type === 'following')

  return (
    <div className={s.page}>
      <div className={s.hdr}>
        <div className={s.eyebrow}>Compare</div>
        <h1 className={s.title}>Snapshot diff</h1>
      </div>

      <div className={s.controls}>
        <div className={s.snapSelWrap}>
          <div className={s.snapSel}>
            <label className={s.selLabel}>From (older)</label>
            <select className={s.sel} value={fromId} onChange={e => setFromId(e.target.value)}>
              <option value="">— select snapshot —</option>
              {snapshots.map(snap => (
                <option key={snap.id} value={snap.id}>
                  {snap.type} · {snap.totalCount.toLocaleString()} · {fmtDate(snap.takenAt)}
                </option>
              ))}
            </select>
          </div>
          <div className={s.arrow}>→</div>
          <div className={s.snapSel}>
            <label className={s.selLabel}>To (newer)</label>
            <select className={s.sel} value={toId} onChange={e => setToId(e.target.value)}>
              <option value="">— select snapshot —</option>
              {snapshots.map(snap => (
                <option key={snap.id} value={snap.id}>
                  {snap.type} · {snap.totalCount.toLocaleString()} · {fmtDate(snap.takenAt)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <button className={s.diffBtn} onClick={runDiff} disabled={!fromId || !toId || fromId === toId || loading}>
          {loading ? 'Comparing...' : 'Compare →'}
        </button>
      </div>

      {diff && (
        <>
          <div className={s.summary}>
            <div className={s.summaryItem}>
              <div className={s.summaryNum} style={{ color: 'var(--green)' }}>+{diff.gainedCount}</div>
              <div className={s.summaryLabel}>gained</div>
            </div>
            <div className={s.summarySep} />
            <div className={s.summaryItem}>
              <div className={s.summaryNum} style={{ color: 'var(--red)' }}>−{diff.lostCount}</div>
              <div className={s.summaryLabel}>lost</div>
            </div>
            <div className={s.summarySep} />
            <div className={s.summaryItem}>
              <div className={s.summaryNum} style={{ color: diff.gainedCount - diff.lostCount >= 0 ? 'var(--green)' : 'var(--red)' }}>
                {diff.gainedCount - diff.lostCount >= 0 ? '+' : ''}{diff.gainedCount - diff.lostCount}
              </div>
              <div className={s.summaryLabel}>net</div>
            </div>
            <button className={s.exportBtn} onClick={handleExport}>↓ Export CSV</button>
          </div>

          <div className={s.searchBar}>
            <SearchIcon />
            <input
              className={s.searchInput}
              placeholder="Search usernames..."
              value={filter}
              onChange={e => setFilter(e.target.value)}
            />
            {filter && <button className={s.clearSearch} onClick={() => setFilter('')}>×</button>}
          </div>

          <div className={s.tabs}>
            <button className={`${s.tab} ${tab === 'gained' ? s.tabActive : ''}`} onClick={() => setTab('gained')}>
              <span className={s.tabDotGreen} />
              New followers <span className={s.tabCount}>{diff.gainedCount}</span>
            </button>
            <button className={`${s.tab} ${tab === 'lost' ? s.tabActive : ''}`} onClick={() => setTab('lost')}>
              <span className={s.tabDotRed} />
              Unfollowed you <span className={s.tabCount}>{diff.lostCount}</span>
            </button>
          </div>

          <div className={s.list}>
            {tab === 'gained' && (
              filteredGained.length === 0
                ? <div className={s.empty}>{filter ? 'No matches' : 'No new followers'}</div>
                : filteredGained.map(u => <UserRow key={u} username={u} type="gained" />)
            )}
            {tab === 'lost' && (
              filteredLost.length === 0
                ? <div className={s.empty}>{filter ? 'No matches' : 'No unfollows'}</div>
                : filteredLost.map(u => <UserRow key={u} username={u} type="lost" />)
            )}
          </div>
        </>
      )}

      {!diff && snapshots.length === 0 && (
        <div className={s.noSnaps}>No snapshots yet. Run at least two scans to compare.</div>
      )}
    </div>
  )
}

function UserRow({ username, type }) {
  const color = type === 'gained' ? 'var(--green)' : 'var(--red)'
  const bgColor = type === 'gained' ? 'var(--green-dim)' : 'var(--red-dim)'
  const label = type === 'gained' ? '+ followed' : '− unfollowed'

  function openProfile() {
    window.api.shell.openExternal(`https://instagram.com/${username}`)
  }

  return (
    <div className={s.userRow}>
      <div className={s.userAvatar} style={{ background: bgColor, color }}>
        {username.slice(0, 2).toUpperCase()}
      </div>
      <span className={s.userName}>@{username}</span>
      <span className={s.userTag} style={{ color, background: bgColor }}>{label}</span>
      <button className={s.profileBtn} onClick={openProfile} title="Open on Instagram">
        <ExternalIcon />
      </button>
    </div>
  )
}

function fmtDate(dt) {
  return new Date(dt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function SearchIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{flexShrink:0,color:'var(--text3)'}}><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg> }
function ExternalIcon() { return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/></svg> }
