import SwiftUI
import AppKit
import Combine
import UserNotifications

// MARK: - Menu Bar Icon
struct MenuBarIconLabel: View {
    @ObservedObject var model: TimerModel
    @State private var scale: CGFloat = 1.0

    private let ticker = Timer.publish(every: 2.0, on: .main, in: .common).autoconnect()

    private var isActive: Bool {
        model.currentView == .focus || model.currentView == .breakTime || model.breakActive
    }

    private var menuBarTime: String {
        let sec = max(0, model.remaining)
        return "\(sec / 60):\(String(format: "%02d", sec % 60))"
    }

    var body: some View {
        HStack(spacing: 3) {
            if isActive {
                Text(menuBarTime)
                    .font(.system(size: 12, weight: .medium))
                    .monospacedDigit()
                    .foregroundColor(.white)
                    .fixedSize()
            }
            Image("pomodoro")
                .resizable()
                .scaledToFit()
                .frame(width: 16, height: 16)
                .scaleEffect(scale)
        }
        .frame(maxWidth: .infinity, alignment: isActive ? .trailing : .center)
        .padding(.trailing, isActive ? 2 : 0)
        .onReceive(ticker) { _ in
            guard isActive else { return }
            withAnimation(.spring(response: 0.35, dampingFraction: 0.5)) {
                scale = 1.15
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                withAnimation(.spring(response: 0.3, dampingFraction: 0.6)) {
                    scale = 1.0
                }
            }
        }
    }
}

@main
struct RecoveryPomodoroApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    var body: some Scene {
        Settings { EmptyView() }
    }
}

// borderless NSPanel은 기본 canBecomeKey = false → 키보드 입력 불가
// 이 서브클래스로 강제 허용
class KeyablePanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }

    override func becomeKey() {
        super.becomeKey()
        makeFirstResponder(self)
    }

    override func makeFirstResponder(_ responder: NSResponder?) -> Bool {
        // 텍스트 입력 계열만 포커스 허용, 버튼/컨트롤은 윈도우로 redirect
        guard let r = responder, r !== self else {
            return super.makeFirstResponder(responder)
        }
        if r is NSTextField || r is NSTextView || r is NSText {
            return super.makeFirstResponder(r)
        }
        return super.makeFirstResponder(self)
    }
}

class AppDelegate: NSObject, NSApplicationDelegate {
    var statusItem: NSStatusItem?
    var panel: NSPanel?
    let model = TimerModel()
    private var iconHostingView: NSHostingView<MenuBarIconLabel>?
    private var eventMonitor: Any?
    private var notchMouseMonitor: Any?
    private var cancellables = Set<AnyCancellable>()
    private var animTimer: Timer?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        setupStatusItem()
        setupPanel()
        observeModel()
        setupNotchHover()
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
    }

    private func setupStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: 20)

        let hv = NSHostingView(rootView: MenuBarIconLabel(model: model))
        hv.frame = NSRect(x: 0, y: 0, width: 20, height: NSStatusBar.system.thickness)
        hv.autoresizingMask = [.width, .height]
        iconHostingView = hv

        if let button = statusItem?.button {
            button.addSubview(hv)
            button.action = #selector(handleStatusClick)
            button.sendAction(on: [.leftMouseDown, .rightMouseDown])
            button.target = self
        }
    }

    private func setupNotchHover() {
        guard let screen = NSScreen.main, screen.safeAreaInsets.top > 0 else { return }
        notchMouseMonitor = NSEvent.addGlobalMonitorForEvents(matching: .mouseMoved) { [weak self] _ in
            guard self?.panel?.isVisible == false else { return }
            let mouse = NSEvent.mouseLocation
            let sf = screen.frame
            let menuH = NSStatusBar.system.thickness
            // 노치 실제 높이 = safeAreaInsets.top, 히트 영역은 메뉴바 전체 높이로
            let hitW: CGFloat = 230
            let notchRect = NSRect(
                x: (sf.width - hitW) / 2,
                y: sf.maxY - menuH,
                width: hitW,
                height: menuH
            )
            if notchRect.contains(mouse) {
                self?.showPanel(overrideCenterX: sf.midX)
            }
        }
    }

    private func setupPanel() {
        let panel = KeyablePanel(
            contentRect: NSRect(x: 0, y: 0, width: 460, height: 140),
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        panel.backgroundColor = .clear
        panel.isOpaque = false
        panel.hasShadow = true
        panel.level = .statusBar
        panel.collectionBehavior = [.canJoinAllSpaces, .ignoresCycle]

        let hosting = NSHostingView(rootView: ContentView().environmentObject(model))
        hosting.wantsLayer = true
        hosting.layer?.cornerRadius = 25
        hosting.layer?.masksToBounds = true  // 직사각형이 아닌 rounded rect로 클리핑
        panel.contentView = hosting
        self.panel = panel
    }

    private static let defaultPanelH: CGFloat  = 140
    private static let settingsPanelH: CGFloat = 230

    private func panelHeight(for view: AppView) -> CGFloat {
        if view == .settings && !model.showGuideBreakPicker && !model.showAutoIdlePicker {
            return Self.settingsPanelH
        }
        return Self.defaultPanelH
    }

    private func observeModel() {
        Publishers.CombineLatest(model.$currentView, model.$breakActive)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] view, breakActive in
                let isActive = view == .focus || view == .breakTime || breakActive
                let width: CGFloat = isActive ? 52 : 20
                self?.statusItem?.length = width
            }
            .store(in: &cancellables)

        model.$currentView
            .receive(on: DispatchQueue.main)
            .removeDuplicates()
            .sink { [weak self] view in
                if view == .focus {
                    self?.hidePanel()
                } else if view == .complete {
                    self?.sendFocusCompleteNotification()
                    if self?.panel?.isVisible == false {
                        self?.showPanel()
                    }
                }
                self?.animatePanelResize(for: view)
            }
            .store(in: &cancellables)

        model.$showPicker
            .receive(on: DispatchQueue.main)
            .sink { [weak self] show in
                guard let panel = self?.panel else { return }
                if show {
                    NSApp.activate(ignoringOtherApps: true)
                    panel.makeKeyAndOrderFront(nil)
                }
            }
            .store(in: &cancellables)

        Publishers.Merge(model.$showGuideBreakPicker, model.$showAutoIdlePicker)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                guard self?.model.currentView == .settings else { return }
                self?.animatePanelResize(for: .settings)
            }
            .store(in: &cancellables)
    }

    private func sendFocusCompleteNotification() {
        let content = UNMutableNotificationContent()
        content.title = "집중 세션 완료"
        content.body = "잠깐 쉬어가세요."
        content.sound = .default
        let request = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request)
    }

    @objc private func handleStatusClick() {
        guard let event = NSApp.currentEvent else { return }
        if event.type == .rightMouseDown {
            let menu = NSMenu()
            menu.addItem(NSMenuItem(title: "Recovery Pomodoro 종료", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
            // statusItem.menu에 세팅 후 performClick하면 macOS가 메뉴바 바로 아래에 정확히 위치시킴
            statusItem?.menu = menu
            statusItem?.button?.performClick(nil)
            statusItem?.menu = nil
        } else {
            guard let panel = panel else { return }
            panel.isVisible ? hidePanel() : showPanel()
        }
    }

    private func animatePanelResize(for view: AppView) {
        guard let panel = panel, panel.isVisible else { return }
        let targetH = panelHeight(for: view)
        guard abs(panel.frame.height - targetH) > 1 else { return }

        if targetH > panel.frame.height {
            // 확장: NSPanel을 즉시 키움 → SwiftUI 스프링이 내부를 시각적으로 채움
            let topEdge = panel.frame.maxY
            let newFrame = NSRect(x: panel.frame.origin.x, y: topEdge - targetH,
                                  width: panel.frame.width, height: targetH)
            panel.setFrame(newFrame, display: true)
        } else {
            // 축소: SwiftUI 스프링(~0.45s)이 끝난 뒤 패널을 조용히 줄임
            // 패널이 항상 SwiftUI 콘텐츠 크기 이상 유지 → masksToBounds 직각 클리핑 방지
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.50) { [weak self, weak panel] in
                guard let self, let panel, panel.isVisible else { return }
                let currentTargetH = self.panelHeight(for: self.model.currentView)
                let topEdge = panel.frame.maxY
                let frame = NSRect(x: panel.frame.origin.x, y: topEdge - currentTargetH,
                                   width: panel.frame.width, height: currentTargetH)
                panel.setFrame(frame, display: true)
            }
        }
    }

    private func showPanel(overrideCenterX: CGFloat? = nil) {
        guard let panel = panel, let screen = NSScreen.main else { return }

        let panelW: CGFloat = 460
        let panelH = panelHeight(for: model.currentView)
        let menuBarBottom = screen.frame.maxY - NSStatusBar.system.thickness

        let centerX: CGFloat
        if let override = overrideCenterX {
            centerX = override
        } else if screen.safeAreaInsets.top > 0 {
            // 노치 있는 맥북: 항상 노치 중앙에서 내려오도록
            centerX = screen.frame.midX
        } else if let button = statusItem?.button, let bw = button.window {
            centerX = bw.convertToScreen(button.frame).midX
        } else {
            centerX = screen.frame.midX
        }

        var x = centerX - panelW / 2
        x = max(8, min(x, screen.visibleFrame.maxX - panelW - 8))

        let finalY = menuBarBottom - panelH - 16
        let startY  = menuBarBottom

        panel.setFrameOrigin(NSPoint(x: x, y: startY))
        panel.alphaValue = 0
        NSApp.activate(ignoringOtherApps: true)
        panel.makeKeyAndOrderFront(nil)

        animTimer?.invalidate()
        let startTime = Date()
        animTimer = Timer.scheduledTimer(withTimeInterval: 1.0 / 60.0, repeats: true) { [weak self, weak panel] timer in
            let elapsed = Date().timeIntervalSince(startTime)
            let spring  = AppDelegate.springEase(elapsed, zeta: 0.72, omega: 20.0)
            let settled = abs(spring - 1.0) < 0.001 && elapsed > 0.3
            panel?.setFrameOrigin(NSPoint(x: x, y: startY + (finalY - startY) * CGFloat(spring)))
            panel?.alphaValue = CGFloat(min(elapsed / 0.14, 1.0))
            if settled {
                panel?.setFrameOrigin(NSPoint(x: x, y: finalY))
                panel?.alphaValue = 1.0
                timer.invalidate()
                self?.animTimer = nil
            }
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { [weak self] in
            guard self?.panel?.isVisible == true else { return }
            self?.eventMonitor = NSEvent.addGlobalMonitorForEvents(
                matching: [.leftMouseDown, .rightMouseDown]
            ) { [weak self] _ in
                self?.hidePanel()
            }
        }
    }

    private static func springEase(_ t: Double, zeta: Double, omega: Double) -> Double {
        guard t > 0 else { return 0 }
        let wd = omega * sqrt(1 - zeta * zeta)
        return 1 - exp(-zeta * omega * t) * (cos(wd * t) + (zeta / sqrt(1 - zeta * zeta)) * sin(wd * t))
    }

    private func hidePanel() {
        guard let panel = panel else { return }
        if let monitor = eventMonitor { NSEvent.removeMonitor(monitor); eventMonitor = nil }

        animTimer?.invalidate()
        let startOrigin = panel.frame.origin
        let startAlpha  = panel.alphaValue
        let targetY     = startOrigin.y + panel.frame.height
        let startTime   = Date()
        let duration: TimeInterval = 0.18

        animTimer = Timer.scheduledTimer(withTimeInterval: 1.0 / 60.0, repeats: true) { [weak self, weak panel] timer in
            let t = min(Date().timeIntervalSince(startTime) / duration, 1.0)
            let eased = t * t * t  // ease-in cubic
            panel?.setFrameOrigin(NSPoint(x: startOrigin.x, y: startOrigin.y + (targetY - startOrigin.y) * CGFloat(eased)))
            panel?.alphaValue = startAlpha * CGFloat(1.0 - eased)
            if t >= 1.0 { timer.invalidate(); self?.animTimer = nil; panel?.orderOut(nil) }
        }
    }
}
