import SwiftUI
import AppKit
import Combine

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
        HStack(spacing: 4) {
            if isActive {
                Text(menuBarTime)
                    .font(.system(size: 11, weight: .semibold, design: .monospaced))
                    .foregroundColor(.white)
            }
            Image(systemName: isActive ? symbols[symbolIndex] : "sparkle")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(green)
                .scaleEffect(scale)
                .opacity(opacity)
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
        .padding(.trailing, 6)
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

class AppDelegate: NSObject, NSApplicationDelegate {
    var statusItem: NSStatusItem?
    var panel: NSPanel?
    let model = TimerModel()
    private var iconHostingView: NSHostingView<MenuBarIconLabel>?
    private var eventMonitor: Any?
    private var cancellables = Set<AnyCancellable>()

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        setupStatusItem()
        setupPanel()
        observeModel()
    }

    private func setupStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: 30)

        let hv = NSHostingView(rootView: MenuBarIconLabel(model: model))
        hv.frame = NSRect(x: 0, y: 0, width: 30, height: NSStatusBar.system.thickness)
        hv.autoresizingMask = [.width, .height]
        iconHostingView = hv

        if let button = statusItem?.button {
            button.addSubview(hv)
            button.action = #selector(togglePanel)
            button.target = self
        }
    }

    private func setupPanel() {
        let panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: 460, height: 140),
            styleMask: [.borderless, .nonactivatingPanel],
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
        hosting.layer?.cornerRadius = 26
        hosting.layer?.masksToBounds = true
        panel.contentView = hosting
        self.panel = panel
    }

    private func observeModel() {
        model.$currentView
            .receive(on: DispatchQueue.main)
            .sink { [weak self] view in
                let isActive = view == .focus || view == .breakTime
                let width: CGFloat = isActive ? 76 : 30
                self?.statusItem?.length = width
            }
            .store(in: &cancellables)
    }

    @objc private func togglePanel() {
        guard let panel = panel else { return }
        panel.isVisible ? hidePanel() : showPanel()
    }

    private func showPanel() {
        guard let panel = panel,
              let button = statusItem?.button,
              let buttonWindow = button.window else { return }

        let buttonFrame = buttonWindow.convertToScreen(button.frame)
        let panelW: CGFloat = 460
        let panelH: CGFloat = 140

        var x = buttonFrame.midX - panelW / 2
        if let screen = NSScreen.main {
            x = max(8, min(x, screen.visibleFrame.maxX - panelW - 8))
        }
        let y = buttonFrame.minY - panelH - 6

        panel.setFrameOrigin(NSPoint(x: x, y: y))
        panel.orderFrontRegardless()

        eventMonitor = NSEvent.addGlobalMonitorForEvents(
            matching: [.leftMouseDown, .rightMouseDown]
        ) { [weak self] _ in
            self?.hidePanel()
        }
    }

    private func hidePanel() {
        panel?.orderOut(nil)
        if let monitor = eventMonitor {
            NSEvent.removeMonitor(monitor)
            eventMonitor = nil
        }
    }
}
