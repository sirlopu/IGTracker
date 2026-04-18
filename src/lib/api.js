import { getAppTimestamp, parseAppDate } from './datetime'

const STORAGE_KEY = 'igtracker.web.db.v1'

function defaultState() {
  return {
    nextIds: {
      account: 1,
      snapshot: 1,
      event: 1,
    },
    accounts: [],
    snapshots: [],
    events: [],
  }
}

function loadState() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultState()
    const parsed = JSON.parse(raw)
    return {
      ...defaultState(),
      ...parsed,
      nextIds: {
        ...defaultState().nextIds,
        ...(parsed?.nextIds || {}),
      },
    }
  } catch {
    return defaultState()
  }
}

function saveState(state) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

function withState(mutator) {
  const state = loadState()
  const result = mutator(state)
  saveState(state)
  return result
}

function nextId(state, key) {
  const id = state.nextIds[key]
  state.nextIds[key] += 1
  return id
}

function sortByDateDesc(items, key) {
  return [...items].sort((a, b) => parseAppDate(b[key]).getTime() - parseAppDate(a[key]).getTime())
}

function normalizeUsername(value) {
  return String(value || '')
    .trim()
    .replace(/^@/, '')
    .toLowerCase()
}

function normalizeUsernames(values) {
  return [...new Set(
    values
      .map(normalizeUsername)
      .filter(Boolean)
  )]
}

function getSnapshot(state, snapshotId) {
  return state.snapshots.find(snapshot => snapshot.id === snapshotId) || null
}

function snapshotSet(state, snapshotId) {
  return new Set(getSnapshot(state, snapshotId)?.usernames || [])
}

function buildCsv(usernames) {
  return `username\n${usernames.join('\n')}`
}

function downloadTextFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType })
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  window.URL.revokeObjectURL(url)
}

function createWebApi() {
  return {
    meta: {
      platform: 'web',
      capabilities: {
        automatedScan: false,
        unfollow: false,
      },
    },

    accounts: {
      async list() {
        return loadState().accounts
          .slice()
          .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      },

      async create(username) {
        return withState(state => {
          const normalized = normalizeUsername(username)
          const existing = state.accounts.find(account => account.username === normalized)
          if (existing) return existing

          const account = {
            id: nextId(state, 'account'),
            username: normalized,
            createdAt: getAppTimestamp(),
          }
          state.accounts.push(account)
          return account
        })
      },

      async delete(id) {
        withState(state => {
          state.accounts = state.accounts.filter(account => account.id !== id)
          state.snapshots = state.snapshots.filter(snapshot => snapshot.accountId !== id)
          state.events = state.events.filter(event => event.accountId !== id)
        })
        return { deleted: true }
      },
    },

    snapshots: {
      async list(accountId) {
        return sortByDateDesc(
          loadState().snapshots.filter(snapshot => snapshot.accountId === accountId),
          'takenAt'
        ).slice(0, 30)
      },

      async save({ accountId, type, usernames }) {
        return withState(state => {
          const normalizedUsernames = normalizeUsernames(usernames)
          const snapshot = {
            id: nextId(state, 'snapshot'),
            accountId,
            type,
            totalCount: normalizedUsernames.length,
            takenAt: getAppTimestamp(),
            usernames: normalizedUsernames,
          }
          state.snapshots.push(snapshot)
          return snapshot
        })
      },

      async members(snapshotId) {
        return [...(getSnapshot(loadState(), snapshotId)?.usernames || [])]
      },

      async diff({ fromId, toId, accountId, type }) {
        return withState(state => {
          const fromSet = snapshotSet(state, fromId)
          const toSet = snapshotSet(state, toId)
          const gained = [...toSet].filter(username => !fromSet.has(username))
          const lost = [...fromSet].filter(username => !toSet.has(username))
          const gainedType = type === 'followers' ? 'gained_follower' : 'new_following'
          const lostType = type === 'followers' ? 'lost_follower' : 'unfollowed'
          const createdAt = getAppTimestamp()

          state.events = state.events.filter(event =>
            !(event.accountId === accountId && event.fromSnapshotId === fromId && event.toSnapshotId === toId)
          )

          for (const username of gained) {
            state.events.push({
              id: nextId(state, 'event'),
              accountId,
              eventType: gainedType,
              username,
              fromSnapshotId: fromId,
              toSnapshotId: toId,
              createdAt,
            })
          }

          for (const username of lost) {
            state.events.push({
              id: nextId(state, 'event'),
              accountId,
              eventType: lostType,
              username,
              fromSnapshotId: fromId,
              toSnapshotId: toId,
              createdAt,
            })
          }

          return {
            gained,
            lost,
            gainedCount: gained.length,
            lostCount: lost.length,
          }
        })
      },

      async crossDiff({ followersSnapshotId, followingSnapshotId }) {
        const state = loadState()
        const followers = snapshotSet(state, followersSnapshotId)
        const following = snapshotSet(state, followingSnapshotId)
        return {
          notFollowingBack: [...following].filter(username => !followers.has(username)),
          fans: [...followers].filter(username => !following.has(username)),
          mutuals: [...followers].filter(username => following.has(username)),
        }
      },
    },

    events: {
      async list(accountId) {
        return sortByDateDesc(
          loadState().events.filter(event => event.accountId === accountId),
          'createdAt'
        ).slice(0, 200)
      },
    },

    scan: {
      async launch() {
        return { error: 'Automated Instagram scanning is only available in the desktop app.' }
      },

      async followers() {
        return { error: 'Automated Instagram scanning is only available in the desktop app.' }
      },

      async following() {
        return { error: 'Automated Instagram scanning is only available in the desktop app.' }
      },

      onProgress() {},
      offProgress() {},
    },

    relations: {
      async unfollow() {
        return { error: 'Unfollow actions are only available in the desktop app.' }
      },
    },

    export: {
      async csv({ snapshotId, filename }) {
        const usernames = getSnapshot(loadState(), snapshotId)?.usernames || []
        downloadTextFile(filename, buildCsv(usernames), 'text/csv;charset=utf-8')
        return { saved: true, filePath: filename }
      },
    },

    shell: {
      async openExternal(url) {
        window.open(url, '_blank', 'noopener,noreferrer')
        return { opened: true }
      },
    },
  }
}

export function ensureApi() {
  if (typeof window === 'undefined') return null
  if (!window.api) {
    window.api = createWebApi()
  }
  return window.api
}
