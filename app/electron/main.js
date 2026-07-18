const { app, BrowserWindow, Notification, ipcMain, Tray, nativeImage, screen } = require('electron')
const path = require('path')
const fs = require('fs')
const zlib = require('zlib')

let tray = null

const NOTCH_W = 280
const COLLAPSED_H = 38
const EXPANDED_H = 430

function getNotchPos() {
  const { bounds } = screen.getPrimaryDisplay()
  return { x: Math.round(bounds.width / 2 - NOTCH_W / 2), y: 0 }
}

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

function startNotchTracker(win) {
  let expanded = false
  let collapseTimeout = null

  setInterval(() => {
    if (win.isDestroyed()) return
    const cursor = screen.getCursorScreenPoint()
    const { x: wx } = getNotchPos()
    const maxY = expanded ? EXPANDED_H : COLLAPSED_H + 4
    const inZone = cursor.x >= wx && cursor.x <= wx + NOTCH_W && cursor.y >= 0 && cursor.y <= maxY

    if (inZone && !expanded) {
      if (collapseTimeout) { clearTimeout(collapseTimeout); collapseTimeout = null }
      expanded = true
      win.setIgnoreMouseEvents(false)
      win.setSize(NOTCH_W, EXPANDED_H)
      win.setPosition(wx, 0)
      win.webContents.send('notch-state', true)
    } else if (!inZone && expanded && !collapseTimeout) {
      collapseTimeout = setTimeout(() => {
        expanded = false
        collapseTimeout = null
        win.webContents.send('notch-state', false)
        setTimeout(() => {
          if (!win.isDestroyed()) {
            win.setSize(NOTCH_W, COLLAPSED_H)
            win.setPosition(getNotchPos().x, 0)
            win.setIgnoreMouseEvents(true, { forward: true })
          }
        }, 300)
      }, 400)
    }
  }, 80)
}

function createWindow() {
  const { x, y } = getNotchPos()
  const win = new BrowserWindow({
    width: NOTCH_W,
    height: COLLAPSED_H,
    x, y,
    alwaysOnTop: true,
    frame: false,
    resizable: false,
    transparent: true,
    hasShadow: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.setIgnoreMouseEvents(true, { forward: true })

  if (isDev) {
    win.loadURL('http://localhost:3000')
  } else {
    win.loadFile(path.join(__dirname, '../out/index.html'))
  }

  win.webContents.on('did-finish-load', () => startNotchTracker(win))
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

ipcMain.handle('notch-expand', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return
  win.setIgnoreMouseEvents(false)
  const { x } = getNotchPos()
  win.setSize(NOTCH_W, EXPANDED_H)
  win.setPosition(x, 0)
})

ipcMain.handle('notch-collapse', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return
  const { x } = getNotchPos()
  win.setSize(NOTCH_W, COLLAPSED_H)
  win.setPosition(x, 0)
  win.setIgnoreMouseEvents(true, { forward: true })
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
