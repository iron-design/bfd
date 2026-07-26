const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen } = require('electron')
const path = require('path')
const fs = require('fs')
const zlib = require('zlib')

let tray = null

const NOTCH_W = 680         // 패널 전체 너비
const NOTCH_TRIGGER_W = 200 // 호버 감지 트리거 너비 (노치 하드웨어 영역)
const COLLAPSED_H = 38      // 축소 상태 높이
const EXPANDED_H = 200      // 펼침 상태 높이

// 모듈 레벨 상태 (IPC ↔ tracker 공유)
let notchExpanded = false
let collapseTimer = null
let panelLocked = false   // guide/checkin/feedback 중엔 자동 닫힘 방지

function getNotchPos() {
  const { bounds } = screen.getPrimaryDisplay()
  return { x: Math.round(bounds.width / 2 - NOTCH_W / 2), y: 0 }
}

function makePng(W, H, pixelFn) {
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
  // raw image data: each row has 1 filter byte + W*4 RGBA bytes
  const raw = Buffer.alloc((W * 4 + 1) * H, 0)
  for (let y = 0; y < H; y++) {
    raw[y * (W * 4 + 1)] = 0 // filter type None
    for (let x = 0; x < W; x++) {
      const [r, g, b, a] = pixelFn(x, y, W, H)
      const off = y * (W * 4 + 1) + 1 + x * 4
      raw[off] = r; raw[off+1] = g; raw[off+2] = b; raw[off+3] = a
    }
  }
  const deflated = zlib.deflateSync(raw)
  const ihdr = Buffer.concat([u32(W), u32(H), Buffer.from([8, 6, 0, 0, 0])])
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflated),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function makeGreenDot(alpha) {
  // 12x12 초록 원 (anti-alias 포함)
  const S = 12
  return makePng(S, S, (x, y, W, H) => {
    const cx = (W - 1) / 2, cy = (H - 1) / 2, r = W / 2 - 0.5
    const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2)
    const aa = Math.max(0, Math.min(1, r - dist + 0.5))
    return [48, 209, 88, Math.round(alpha * aa)]
  })
}

// 사인 파형으로 부드러운 깜빡임 프레임 (60단계)
function makePulseFrames() {
  const N = 60
  const frames = []
  for (let i = 0; i < N; i++) {
    const t = i / N
    const alpha = Math.round(90 + 165 * (0.5 + 0.5 * Math.sin(t * 2 * Math.PI)))
    frames.push(nativeImage.createFromBuffer(makeGreenDot(alpha)))
  }
  return frames
}

function getSessionsPath() {
  return path.join(app.getPath('userData'), 'sessions.json')
}

const isDev = process.env.NODE_ENV === 'development'

function doExpand(win) {
  if (collapseTimer) { clearTimeout(collapseTimer); collapseTimer = null }
  notchExpanded = true
  const { x } = getNotchPos()
  win.setIgnoreMouseEvents(false)
  win.setSize(NOTCH_W, EXPANDED_H)
  win.setPosition(x, 0)
  win.webContents.send('notch-state', true)
}

// mode: 'normal' = 400ms 대기 후 페이드, 'fast' = 즉시 페이드
function doCollapse(win, mode = 'normal') {
  if (collapseTimer) { clearTimeout(collapseTimer); collapseTimer = null }

  const collapse = () => {
    notchExpanded = false
    collapseTimer = null
    win.webContents.send('notch-state', false)
    // 페이드 아웃 애니메이션(0.22s) 완료 후 창 축소
    setTimeout(() => {
      if (!win.isDestroyed()) {
        const { x } = getNotchPos()
        win.setSize(NOTCH_W, COLLAPSED_H)
        win.setPosition(x, 0)
        win.setIgnoreMouseEvents(true, { forward: true })
      }
    }, 260)
  }

  if (mode === 'normal') collapseTimer = setTimeout(collapse, 400)
  else collapse()
}

function startNotchTracker(win) {
  setInterval(() => {
    if (win.isDestroyed()) return
    const cursor = screen.getCursorScreenPoint()
    const { bounds } = screen.getPrimaryDisplay()
    const centerX = Math.round(bounds.width / 2)
    const { x: wx } = getNotchPos()

    let inZone
    if (notchExpanded) {
      // 펼쳐진 상태: 패널 전체 영역 내에 있으면 유지
      inZone = cursor.x >= wx && cursor.x <= wx + NOTCH_W
               && cursor.y >= 0 && cursor.y <= EXPANDED_H
    } else {
      // 축소 상태: 노치 하드웨어 영역 최상단에만 반응
      inZone = Math.abs(cursor.x - centerX) <= NOTCH_TRIGGER_W / 2
               && cursor.y >= 0 && cursor.y <= 20
    }

    if (inZone && !notchExpanded) {
      doExpand(win)
    } else if (!inZone && notchExpanded && !collapseTimer && !panelLocked) {
      doCollapse(win)
    }
  }, 80)
}

function createWindow() {
  const { x } = getNotchPos()
  const win = new BrowserWindow({
    width: NOTCH_W,
    height: COLLAPSED_H,
    x, y: 0,
    alwaysOnTop: true,
    frame: false,
    resizable: false,
    movable: false,
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
  win.setPosition(x, 0)

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

ipcMain.handle('notch-expand', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win) doExpand(win)
})

ipcMain.handle('notch-collapse', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win) doCollapse(win, 'fast')
})

ipcMain.handle('lock-panel', (_event, locked) => {
  panelLocked = locked
})

app.whenReady().then(() => {
  try {
    const pulseFrames = makePulseFrames()
    tray = new Tray(pulseFrames[0])
    tray.setTitle('')

    // 부드러운 사인 파형 펄스 (60프레임 / 1200ms = 50ms 간격)
    let pulseIdx = 0
    setInterval(() => {
      if (!tray || tray.isDestroyed()) return
      tray.setImage(pulseFrames[pulseIdx % pulseFrames.length])
      pulseIdx++
    }, 20)

    const contextMenu = Menu.buildFromTemplate([
      { label: '설정', enabled: false },
      { type: 'separator' },
      { label: '종료', click: () => app.quit() },
    ])
    tray.setContextMenu(contextMenu)
    tray.on('click', () => tray.popUpContextMenu())
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
