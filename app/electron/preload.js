const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electron', {
  saveSession: (session) => ipcRenderer.invoke('save-session', session),
  updateTray: (label) => ipcRenderer.invoke('update-tray', label),
  loadSessions: () => ipcRenderer.invoke('load-sessions'),
  notchExpand: () => ipcRenderer.invoke('notch-expand'),
  notchCollapse: () => ipcRenderer.invoke('notch-collapse'),
  lockPanel: (locked) => ipcRenderer.invoke('lock-panel', locked),
  onNotchState: (cb) => ipcRenderer.on('notch-state', (_e, expanded) => cb(expanded)),
  onSoundToggle: (cb) => ipcRenderer.on('sound-toggle', (_e, enabled) => cb(enabled)),
})
