// electron/preload.js
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  // Accounts
  accounts: {
    list: () => ipcRenderer.invoke('accounts:list'),
    create: (username) => ipcRenderer.invoke('accounts:create', username),
    delete: (id) => ipcRenderer.invoke('accounts:delete', id),
  },

  // Snapshots
  snapshots: {
    list: (accountId) => ipcRenderer.invoke('snapshots:list', accountId),
    save: (data) => ipcRenderer.invoke('snapshots:save', data),
    members: (snapshotId) => ipcRenderer.invoke('snapshots:members', snapshotId),
    diff: (data) => ipcRenderer.invoke('snapshots:diff', data),
    crossDiff: (data) => ipcRenderer.invoke('snapshots:crossdiff', data),
  },

  // Events
  events: {
    list: (accountId) => ipcRenderer.invoke('events:list', accountId),
  },

  // Scanning
  scan: {
    launch: (data) => ipcRenderer.invoke('scan:launch', data),
    followers: (data) => ipcRenderer.invoke('scan:followers', data),
    following: (data) => ipcRenderer.invoke('scan:following', data),
    onProgress: (cb) => ipcRenderer.on('scan:progress', (_, data) => cb(data)),
    offProgress: () => ipcRenderer.removeAllListeners('scan:progress'),
  },

  // Export
  export: {
    csv: (data) => ipcRenderer.invoke('export:csv', data),
  },

  // Shell
  shell: {
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  },
})
