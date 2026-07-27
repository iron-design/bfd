const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const zlib = require('zlib')


const NOTCH_W = 580         // 패널 전체 너비
const NOTCH_TRIGGER_W = 200 // 호버 감지 트리거 너비 (노치 하드웨어 영역)
const COLLAPSED_H = 38      // 축소 상태 높이
const EXPANDED_H = 200      // 펼침 상태 높이

let tray = null

// 모듈 레벨 상태 (IPC ↔ tracker 공유)
let notchExpanded = false
let collapseTimer = null
let panelLocked = false   // guide/checkin/feedback 중엔 자동 닫힘 방지
let soundEnabled = true

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
  const raw = Buffer.alloc((W * 4 + 1) * H, 0)
  for (let y = 0; y < H; y++) {
    raw[y * (W * 4 + 1)] = 0
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
  const S = 12
  return makePng(S, S, (x, y, W, H) => {
    const cx = (W - 1) / 2, cy = (H - 1) / 2, r = W / 2 - 0.5
    const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2)
    const aa = Math.max(0, Math.min(1, r - dist + 0.5))
    return [48, 209, 88, Math.round(alpha * aa)]
  })
}

function makePulseFrames() {
  const N = 60
  return Array.from({ length: N }, (_, i) => {
    const alpha = Math.round(90 + 165 * (0.5 + 0.5 * Math.sin((i / N) * 2 * Math.PI)))
    return nativeImage.createFromBuffer(makeGreenDot(alpha))
  })
}

function buildTodaySummary() {
  const filePath = getSessionsPath()
  if (!fs.existsSync(filePath)) return [{ label: '오늘 기록 없음', enabled: false }]
  const sessions = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  const todayStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
  const today = sessions.filter(s => s.timestamp?.startsWith(todayStr))
  if (!today.length) return [{ label: '오늘 기록 없음', enabled: false }]
  const good = today.filter(s => s.checkin === 'good').length
  const bad  = today.filter(s => s.checkin === 'bad').length
  return [
    { label: `오늘 ${today.length}사이클 완료`, enabled: false },
    { label: `잘 쉼 ${good}회  ·  부족 ${bad}회`, enabled: false },
  ]
}

function buildContextMenu() {
  return Menu.buildFromTemplate([
    ...buildTodaySummary(),
    { type: 'separator' },
    {
      label: '소리',
      type: 'checkbox',
      checked: soundEnabled,
      click: () => {
        soundEnabled = !soundEnabled
        const wins = BrowserWindow.getAllWindows()
        if (wins.length) wins[0].webContents.send('sound-toggle', soundEnabled)
      },
    },
    {
      label: '데이터 파일 열기',
      click: () => {
        const p = getSessionsPath()
        fs.existsSync(p) ? shell.showItemInFolder(p) : shell.openPath(path.dirname(p))
      },
    },
    { type: 'separator' },
    { label: '종료', click: () => app.quit() },
  ])
}

function getInternalDisplay() {
  const displays = screen.getAllDisplays()
  return displays.find(d => d.internal) || screen.getPrimaryDisplay()
}

function getNotchPos() {
  const { bounds } = getInternalDisplay()
  return { x: Math.round(bounds.x + bounds.width / 2 - NOTCH_W / 2), y: bounds.y }
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
    const { bounds } = getInternalDisplay()
    const centerX = Math.round(bounds.x + bounds.width / 2)
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

ipcMain.handle('update-tray', (_event, label) => {
  if (tray) tray.setTitle(label)
})

app.whenReady().then(() => {
  app.dock.hide()

  try {
    const pulseFrames = makePulseFrames()
    const emptyIcon = nativeImage.createFromBuffer(makeGreenDot(0))
    tray = new Tray(pulseFrames[0])
    tray.setToolTip('Recovery Pomodoro')

    let pulseIdx = 0
    let onInternal = true

    // 500ms마다 tray가 내장 디스플레이에 있는지 확인, 아니면 숨김
    setInterval(() => {
      if (!tray || tray.isDestroyed()) return
      const tb = tray.getBounds()
      const { bounds } = getInternalDisplay()
      onInternal = tb.x >= bounds.x && tb.x < bounds.x + bounds.width
      if (!onInternal) tray.setImage(emptyIcon)
    }, 500)

    // 펄스 애니메이션 (내장 디스플레이일 때만)
    setInterval(() => {
      if (!tray || tray.isDestroyed() || !onInternal) return
      tray.setImage(pulseFrames[pulseIdx % pulseFrames.length])
      pulseIdx++
    }, 20)

    const showMenu = () => tray.popUpContextMenu(buildContextMenu())
    tray.on('click', showMenu)
    tray.on('right-click', showMenu)
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
