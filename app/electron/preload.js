const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electron', {
  saveSession: (session) => ipcRenderer.invoke('save-session', session),
  loadSessions: () => ipcRenderer.invoke('load-sessions'),
  updateTray: (label) => ipcRenderer.invoke('update-tray', label),
  notchExpand: () => ipcRenderer.invoke('notch-expand'),
  notchCollapse: () => ipcRenderer.invoke('notch-collapse'),
  lockPanel: (locked) => ipcRenderer.invoke('lock-panel', locked),
  onNotchState: (cb) => ipcRenderer.on('notch-state', (_e, expanded) => cb(expanded)),
  onSoundToggle: (cb) => ipcRenderer.on('sound-toggle', (_e, enabled) => cb(enabled)),
})
