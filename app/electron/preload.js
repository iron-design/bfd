const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electron', {
  sendNotification: (title, body) => ipcRenderer.invoke('send-notification', title, body),
  saveSession: (session) => ipcRenderer.invoke('save-session', session),
  loadSessions: () => ipcRenderer.invoke('load-sessions'),
  updateTray: (label) => ipcRenderer.invoke('update-tray', label),
  resizeWindow: (width, height) => ipcRenderer.invoke('resize-window', width, height),
  moveWindow: (x, y) => ipcRenderer.invoke('move-window', x, y),
})
