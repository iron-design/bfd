const { app, BrowserWindow, Notification, ipcMain, Tray, nativeImage } = require('electron')
const path = require('path')
const fs = require('fs')
const zlib = require('zlib')

let tray = null

function makeTrayIcon() {
  const W = 1, H = 1
  const raw = Buffer.alloc((W * 4 + 1) * H, 0)

  const deflated = zlib.deflateSync(raw)

  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
    table[i] = c
  }
  function crc32(buf) {
    let crc = 0xFFFFFFFF
    for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8)
    return (crc ^ 0xFFFFFFFF) >>> 0
  }
  function u32(n) { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b }
  function chunk(type, data) {
    const t = Buffer.from(type, 'ascii')
    return Buffer.concat([u32(data.length), t, data, u32(crc32(Buffer.concat([t, data])))])
  }

  const ihdr = Buffer.concat([u32(W), u32(H), Buffer.from([8, 6, 0, 0, 0])])
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflated),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function getSessionsPath() {
  return path.join(app.getPath('userData'), 'sessions.json')
}

const isDev = process.env.NODE_ENV === 'development'

function createWindow() {
  const win = new BrowserWindow({
    width: 360,
    height: 520,
    alwaysOnTop: true,
    frame: false,
    resizable: false,
    transparent: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  })

  if (isDev) {
    win.loadURL('http://localhost:3000')
  } else {
    win.loadFile(path.join(__dirname, '../out/index.html'))
  }
}

ipcMain.handle('save-session', (_event, session) => {
  const filePath = getSessionsPath()
  const sessions = fs.existsSync(filePath)
    ? JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    : []
  sessions.push(session)
  fs.writeFileSync(filePath, JSON.stringify(sessions, null, 2), 'utf-8')
})

ipcMain.handle('load-sessions', () => {
  const filePath = getSessionsPath()
  if (!fs.existsSync(filePath)) return []
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
})

ipcMain.handle('update-tray', (_event, label) => {
  if (tray) tray.setTitle(label)
})

ipcMain.handle('move-window', (event, x, y) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win) win.setPosition(Math.round(x), Math.round(y))
})

ipcMain.handle('resize-window', (event, width, height) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) { console.error('[resize-window] win not found'); return; }
  const [x, y] = win.getPosition()
  const [w, h] = win.getSize()
  const newX = Math.round(x + (w - width) / 2)
  const newY = Math.round(y + (h - height) / 2)
  win.setSize(width, height)
  win.setPosition(newX, newY)
  console.log('[resize-window]', width, height)
})

app.whenReady().then(() => {
  try {
    const iconBuf = makeTrayIcon()
    console.log('[tray] PNG buffer size:', iconBuf.length)
    const icon = nativeImage.createFromBuffer(iconBuf)
    console.log('[tray] icon size:', icon.getSize())
    tray = new Tray(icon)
    tray.setTitle('🍅')
    console.log('[tray] created, title set')
    console.log('[tray] bounds:', JSON.stringify(tray.getBounds()))
  } catch (e) {
    console.error('[tray] ERROR:', e)
  }

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
