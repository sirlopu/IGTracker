// src/pages/RelationsPage.jsx
import { useState, useEffect } from 'react'
import s from './RelationsPage.module.css'
import { formatSystemDate } from '../lib/datetime'

const VIEWS = [
  { id: 'notFollowingBack', label: 'Not following back', color: 'var(--red)', desc: 'You follow them · they don\'t follow you back' },
  { id: 'fans',            label: 'Fans',               color: 'var(--gold)', desc: 'They follow you · you don\'t follow them back' },
  { id: 'mutuals',         label: 'Mutuals',            color: 'var(--green)', desc: 'You both follow each other' },
]

export default function RelationsPage({ account, platform = 'electron' }) {
  const isWeb = platform === 'web'
  const [snapshots, setSnapshots] = useState([])
  const [followerSnapId, setFollowerSnapId] = useState('')
  const [followingSnapId, setFollowingSnapId] = useState('')
  const [result, setResult] = useState(null)
  const [view, setView] = useState('notFollowingBack')
  const [filter, setFilter] = useState('')
  const [loading, setLoading] = useState(false)
  const [selectedUsers, setSelectedUsers] = useState([])
  const [busyUsers, setBusyUsers] = useState([])
  const [actionStatus, setActionStatus] = useState('')

  useEffect(() => {
    if (account) loadSnaps()
  }, [account])

  useEffect(() => {
    setSelectedUsers([])
    setBusyUsers([])
    setActionStatus('')
  }, [account, result, view])

  useEffect(() => {
    setResult(null)
    setSelectedUsers([])
    setBusyUsers([])
    setActionStatus('')
  }, [followerSnapId, followingSnapId])

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
  const selectedFollowerSnap = followerSnaps.find(ss => String(ss.id) === followerSnapId) || null
  const selectedFollowingSnap = followingSnaps.find(ss => String(ss.id) === followingSnapId) || null

  const current = result ? result[view] : []
  const filtered = current.filter(u => u.toLowerCase().includes(filter.toLowerCase()))
  const selectable = view === 'notFollowingBack'
  const allVisibleSelected = selectable && filtered.length > 0 && filtered.every(username => selectedUsers.includes(username))
  const selectedVisibleCount = selectable ? filtered.filter(username => selectedUsers.includes(username)).length : 0

  const canRun = followerSnapId && followingSnapId

  function toggleSelected(username) {
    setSelectedUsers(currentSelected =>
      currentSelected.includes(username)
        ? currentSelected.filter(value => value !== username)
        : [...currentSelected, username]
    )
  }

  function toggleSelectAllVisible() {
    if (!selectable) return
    setSelectedUsers(currentSelected => {
      if (allVisibleSelected) {
        return currentSelected.filter(username => !filtered.includes(username))
      }
      return [...new Set([...currentSelected, ...filtered])]
    })
  }

  function removeUsersFromResult(usernames) {
    if (usernames.length === 0) return
    setResult(currentResult => {
      if (!currentResult) return currentResult
      return {
        ...currentResult,
        notFollowingBack: currentResult.notFollowingBack.filter(username => !usernames.includes(username)),
      }
    })
  }

  async function unfollowUsers(usernames) {
    if (usernames.length === 0) return

    setBusyUsers(currentBusy => [...new Set([...currentBusy, ...usernames])])
    setActionStatus('')

    try {
      const res = await window.api.relations.unfollow({
        accountUsername: account.username,
        usernames,
      })

      if (res.error) {
        setActionStatus(res.error)
        return
      }

      const succeeded = res.results.filter(item => item.ok).map(item => item.username)
      const failed = res.results.filter(item => !item.ok)

      removeUsersFromResult(succeeded)
      setSelectedUsers(currentSelected => currentSelected.filter(username => !succeeded.includes(username)))
      if (failed.length > 0) {
        setActionStatus(
          failed
            .slice(0, 3)
            .map(item => `@${item.username}: ${item.error || 'Unfollow failed'}`)
            .join(' ')
        )
      }
    } catch (e) {
      setActionStatus(e.message || 'Could not unfollow those accounts.')
    } finally {
      setBusyUsers(currentBusy => currentBusy.filter(username => !usernames.includes(username)))
    }
  }

  async function handleSingleUnfollow(username) {
    const ok = window.confirm(`Unfollow @${username}?`)
    if (!ok) return
    await unfollowUsers([username])
  }

  async function handleBulkUnfollow() {
    const usernames = selectedUsers.filter(username => filtered.includes(username))
    if (usernames.length === 0) return
    const ok = window.confirm(
      usernames.length === 1
        ? `Unfollow @${usernames[0]}?`
        : `Unfollow ${usernames.length} selected accounts?`
    )
    if (!ok) return
    await unfollowUsers(usernames)
  }

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

      {canRun && !result && (
        <div className={s.analysisHint}>
          Ready to analyze
          <span className={s.analysisMeta}>
            {selectedFollowerSnap ? ` followers ${selectedFollowerSnap.totalCount.toLocaleString()}` : ''}
            {selectedFollowingSnap ? ` · following ${selectedFollowingSnap.totalCount.toLocaleString()}` : ''}
          </span>
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

          <div className={s.analysisHint}>
            Relation totals
            <span className={s.analysisMeta}>
              {selectedFollowingSnap
                ? ` following ${selectedFollowingSnap.totalCount.toLocaleString()} = ${result.notFollowingBack.length.toLocaleString()} not following back + ${result.mutuals.length.toLocaleString()} mutuals`
                : ''}
            </span>
            <span className={s.analysisMeta}>
              {selectedFollowerSnap
                ? ` followers ${selectedFollowerSnap.totalCount.toLocaleString()} = ${result.fans.length.toLocaleString()} fans + ${result.mutuals.length.toLocaleString()} mutuals`
                : ''}
            </span>
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

          {selectable && (
            <div className={s.bulkBar}>
              <label className={s.selectAll}>
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={toggleSelectAllVisible}
                  disabled={filtered.length === 0 || busyUsers.length > 0}
                />
                <span>
                  {allVisibleSelected ? 'Clear visible' : 'Select all visible'}
                  <span className={s.bulkMeta}>
                    {selectedVisibleCount > 0
                      ? ` · ${selectedVisibleCount.toLocaleString()} selected`
                      : ` · ${filtered.length.toLocaleString()} visible`}
                  </span>
                </span>
              </label>

              <button
                className={s.bulkBtn}
                onClick={handleBulkUnfollow}
                disabled={isWeb || selectedVisibleCount === 0 || busyUsers.length > 0}
              >
                Unfollow selected
              </button>
            </div>
          )}

          {selectable && isWeb && (
            <div className={s.helperNote}>
              Bulk unfollow is only available in the desktop app because it needs your local Instagram session.
            </div>
          )}

          {actionStatus && (
            <div className={s.helperNote}>
              {actionStatus}
            </div>
          )}

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
                  selectable={selectable}
                  selected={selectedUsers.includes(u)}
                  busy={busyUsers.includes(u)}
                  canUnfollow={!isWeb}
                  onToggleSelected={() => toggleSelected(u)}
                  onUnfollow={() => handleSingleUnfollow(u)}
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

function RelationRow({ username, view, selectable, selected, busy, canUnfollow, onToggleSelected, onUnfollow }) {
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
      {selectable && (
        <label className={s.checkboxWrap}>
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelected}
            disabled={busy}
          />
        </label>
      )}
      <div className={s.avatar} style={{ background: bg, color }}>
        {username.slice(0, 2).toUpperCase()}
      </div>
      <span className={s.username}>@{username}</span>
      <span className={s.tag} style={{ background: bg, color }}>{tag}</span>
      {selectable && canUnfollow && (
        <button
          className={s.unfollowBtn}
          onClick={onUnfollow}
          disabled={busy}
          title={`Unfollow @${username}`}
        >
          {busy ? 'Unfollowing...' : 'Unfollow'}
        </button>
      )}
      <button className={s.extBtn} onClick={openProfile} title="Open on Instagram">
        <ExternalIcon />
      </button>
    </div>
  )
}

function fmtDate(dt) {
  return formatSystemDate(dt, { month: 'short', day: 'numeric' })
}

function SearchIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{flexShrink:0,color:'var(--text3)'}}><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg> }
function ExternalIcon() { return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/></svg> }
