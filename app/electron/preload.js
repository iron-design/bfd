const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electron', {
  sendNotification: (title, body) => ipcRenderer.invoke('send-notification', title, body),
})
