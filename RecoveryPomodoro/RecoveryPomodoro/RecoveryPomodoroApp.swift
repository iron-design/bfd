import SwiftUI
import AppKit
import Combine
import UserNotifications

// MARK: - Menu Bar Icon
struct MenuBarIconLabel: View {
    @ObservedObject var model: TimerModel
    @State private var symbolIndex: Int = 0
    @State private var scale: CGFloat = 1.0
    @State private var opacity: Double = 1.0

    private let symbols = ["sparkle", "seal.fill"]
    private let ticker = Timer.publish(every: 1.4, on: .main, in: .common).autoconnect()
    private let green = Color(red: 0.188, green: 0.820, blue: 0.345)

    private var isActive: Bool {
        model.currentView == .focus || model.currentView == .breakTime
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
            Image(systemName: isActive ? symbols[symbolIndex] : "sparkle")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(green)
                .frame(width: 12)
                .scaleEffect(scale)
                .opacity(opacity)
        }
        .frame(maxWidth: .infinity, alignment: isActive ? .trailing : .center)
        .padding(.trailing, isActive ? 2 : 0)
        .onReceive(ticker) { _ in
            guard isActive else { return }
            withAnimation(.easeOut(duration: 0.22)) {
                scale = 0.55
                opacity = 0.15
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.26) {
                symbolIndex = (symbolIndex + 1) % symbols.count
                withAnimation(.spring(response: 0.38, dampingFraction: 0.58)) {
                    scale = 1.0
                    opacity = 1.0
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
}

class AppDelegate: NSObject, NSApplicationDelegate {
    var statusItem: NSStatusItem?
    var panel: NSPanel?
    let model = TimerModel()
    private var iconHostingView: NSHostingView<MenuBarIconLabel>?
    private var eventMonitor: Any?
    private var cancellables = Set<AnyCancellable>()
    private var animTimer: Timer?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        setupStatusItem()
        setupPanel()
        observeModel()
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
            button.action = #selector(togglePanel)
            button.target = self
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
        hosting.layer?.masksToBounds = true
        panel.contentView = hosting
        self.panel = panel
    }

    private func observeModel() {
        model.$currentView
            .receive(on: DispatchQueue.main)
            .sink { [weak self] view in
                let isActive = view == .focus || view == .breakTime
                let width: CGFloat = isActive ? 52 : 20
                self?.statusItem?.length = width
            }
            .store(in: &cancellables)

        model.$currentView
            .receive(on: DispatchQueue.main)
            .removeDuplicates()
            .sink { [weak self] view in
                guard view == .complete else { return }
                self?.sendFocusCompleteNotification()
                if self?.panel?.isVisible == false {
                    self?.showPanel()
                }
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
    }

    private func sendFocusCompleteNotification() {
        let content = UNMutableNotificationContent()
        content.title = "집중 세션 완료"
        content.body = "잠깐 쉬어가세요."
        content.sound = .default
        let request = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request)
    }

    @objc private func togglePanel() {
        guard let panel = panel else { return }
        panel.isVisible ? hidePanel() : showPanel()
    }

    private func showPanel() {
        guard let panel = panel,
              let button = statusItem?.button,
              let buttonWindow = button.window,
              let screen = NSScreen.main else { return }

        let buttonFrame = buttonWindow.convertToScreen(button.frame)
        let panelW: CGFloat = 460
        let panelH: CGFloat = 140

        var x = buttonFrame.midX - panelW / 2
        x = max(8, min(x, screen.visibleFrame.maxX - panelW - 8))

        // buttonFrame.minY = 메뉴바 버튼 하단 (원래 작동하던 기준값)
        let finalY = buttonFrame.minY - panelH - 6
        let startY  = buttonFrame.minY  // 패널 origin이 메뉴바 하단, 패널 본체는 위로 숨겨짐

        panel.setFrameOrigin(NSPoint(x: x, y: startY))
        panel.alphaValue = 0
        NSApp.activate(ignoringOtherApps: true)
        panel.makeKeyAndOrderFront(nil)

        animTimer?.invalidate()
        let startTime = Date()
        let duration: TimeInterval = 0.28
        animTimer = Timer.scheduledTimer(withTimeInterval: 1.0 / 60.0, repeats: true) { [weak self, weak panel] timer in
            let t = min(Date().timeIntervalSince(startTime) / duration, 1.0)
            let eased = 1 - pow(1 - t, 3)  // ease-out cubic
            panel?.setFrameOrigin(NSPoint(x: x, y: startY + (finalY - startY) * eased))
            panel?.alphaValue = CGFloat(eased)
            if t >= 1.0 { timer.invalidate(); self?.animTimer = nil }
        }

        eventMonitor = NSEvent.addGlobalMonitorForEvents(
            matching: [.leftMouseDown, .rightMouseDown]
        ) { [weak self] _ in
            self?.hidePanel()
        }
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
            panel?.setFrameOrigin(NSPoint(x: startOrigin.x, y: startOrigin.y + (targetY - startOrigin.y) * eased))
            panel?.alphaValue = startAlpha * CGFloat(1.0 - eased)
            if t >= 1.0 { timer.invalidate(); self?.animTimer = nil; panel?.orderOut(nil) }
        }
    }
}
