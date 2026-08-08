import SwiftUI

// MARK: - Button Style (§1 Response + §4 Springs)
// press: 즉각 수축 / release: 살짝 튀어오르는 spring
struct ApplePressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.93 : 1.0)
            .animation(
                configuration.isPressed
                    ? .spring(response: 0.12, dampingFraction: 1.0)
                    : .spring(response: 0.30, dampingFraction: 0.65),
                value: configuration.isPressed
            )
    }
}

// MARK: - Color Palette
private extension Color {
    static let ink          = Color.white.opacity(0.92)
    static let muted        = Color(red: 0.557, green: 0.557, blue: 0.576)
    static let softBtn      = Color(red: 0.231, green: 0.231, blue: 0.239).opacity(0.80)
    static let accent       = Color(red: 0.188, green: 0.820, blue: 0.345)
    static let timerGreen   = Color(red: 0.290, green: 0.871, blue: 0.290)
    static let titleGreen   = Color(red: 0.667, green: 0.812, blue: 0.667)
    static let subGreen     = Color(red: 0.482, green: 0.686, blue: 0.482)
    static let appRed       = Color(red: 1.0, green: 0.271, blue: 0.227)
    static let appBG        = Color(red: 0.039, green: 0.039, blue: 0.047)
}

// MARK: - Animated Background
struct AnimatedBackground: View {
    @State private var p1 = CGPoint(x: 0.20, y: 0.50)
    @State private var p2 = CGPoint(x: 0.78, y: 0.42)
    @State private var p3 = CGPoint(x: 0.50, y: 0.58)

    var body: some View {
        ZStack {
            Color.appBG
            RadialGradient(
                colors: [Color(red: 0.10, green: 0.48, blue: 0.22).opacity(0.16), .clear],
                center: UnitPoint(x: p1.x, y: p1.y),
                startRadius: 0, endRadius: 190
            )
            RadialGradient(
                colors: [Color(red: 0.23, green: 0.68, blue: 0.32).opacity(0.10), .clear],
                center: UnitPoint(x: p2.x, y: p2.y),
                startRadius: 0, endRadius: 170
            )
            RadialGradient(
                colors: [Color(red: 0.06, green: 0.32, blue: 0.14).opacity(0.09), .clear],
                center: UnitPoint(x: p3.x, y: p3.y),
                startRadius: 0, endRadius: 150
            )
        }
        .ignoresSafeArea()
        .onAppear { randomDrift() }
        .task {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 1_500_000_000)
                randomDrift()
            }
        }
    }

    private func randomDrift() {
        withAnimation(.easeInOut(duration: 1.5)) {
            p1 = CGPoint(x: .random(in: 0.10...0.45), y: .random(in: 0.20...0.80))
            p2 = CGPoint(x: .random(in: 0.55...0.90), y: .random(in: 0.20...0.80))
            p3 = CGPoint(x: .random(in: 0.25...0.70), y: .random(in: 0.20...0.80))
        }
    }
}

// MARK: - Main View
struct ContentView: View {
    @EnvironmentObject var model: TimerModel

    // §3 Interruptibility: id가 바뀔 때마다 이전 뷰 제거 + 새 뷰 삽입 → 언제든 전환 가능
    private var viewID: String { "\(model.currentView)-\(model.showPicker)-\(model.showBreakPicker)" }

    var body: some View {
        ZStack {
            AnimatedBackground()
            HStack(spacing: 10) {
                Group {
                    switch model.currentView {
                    case .idle:
                        if model.showPicker { PickerView() } else { IdleView() }
                    case .focus:         FocusView()
                    case .complete:      CompleteView()
                    case .guide:
                        if model.showBreakPicker { BreakPickerView() } else { GuideView() }
                    case .breakTime:     BreakView()
                    case .breakComplete: BreakCompleteView()
                    }
                }
                // §3 + §4: id 교체로 전환 감지, spring으로 부드럽게
                .id(viewID)
                .transition(.asymmetric(
                    insertion: .opacity.combined(with: .scale(scale: 0.97, anchor: .center)),
                    removal:   .opacity.combined(with: .scale(scale: 0.97, anchor: .center))
                ))
            }
            .padding(.horizontal, 38)
            .padding(.vertical, 20)
            .animation(.spring(response: 0.28, dampingFraction: 0.85), value: viewID)
        }
        .frame(width: 460, height: 140)
        .clipShape(RoundedRectangle(cornerRadius: 25))
        .onAppear { model.loadTodayStats() }
    }
}

// MARK: - Idle View
struct IdleView: View {
    @EnvironmentObject var model: TimerModel

    var body: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 5) {
                    Image(systemName: "checkmark.circle")
                        .font(.system(size: 13))
                        .foregroundColor(.accent)
                    Text("오늘 \(model.cycles)회 완료")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(.titleGreen)
                }
                Text(model.formatTime(model.focusSec))
                    .font(.system(size: 44, weight: .bold))
                    .foregroundColor(.timerGreen)
                    .monospacedDigit()
            }
            Spacer()
            HStack(spacing: 10) {
                // 시작하기 — 좌측, 글라스 accent
                Button { model.startFocus() } label: {
                    Image(systemName: "play.fill")
                        .font(.system(size: 18))
                        .foregroundColor(.black)
                        .frame(width: 47, height: 47)
                        .background(Color.accent, in: Circle())
                }
                .buttonStyle(ApplePressStyle())

                // 시간 설정 — 우측, 글라스 muted
                Button {
                    model.pickerH = model.focusSec / 3600
                    model.pickerM = (model.focusSec % 3600) / 60
                    model.pickerS = model.focusSec % 60
                    model.showPicker = true
                } label: {
                    Image(systemName: "timer")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundColor(Color.white.opacity(0.62))
                        .frame(width: 47, height: 47)
                        .background(.ultraThinMaterial, in: Circle())
                        .overlay(Circle().stroke(Color.white.opacity(0.18), lineWidth: 0.5))
                }
                .buttonStyle(ApplePressStyle())
            }
        }
    }
}

// MARK: - Picker View
struct PickerView: View {
    @EnvironmentObject var model: TimerModel
    @FocusState private var focused: PickerField?

    enum PickerField { case h, m, s }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Button { model.showPicker = false } label: {
                HStack(spacing: 3) {
                    Image(systemName: "chevron.left").font(.system(size: 10, weight: .semibold))
                    Text("이전").font(.system(size: 12, weight: .medium))
                }
                .foregroundColor(Color.white.opacity(0.75))
                .padding(.horizontal, 12)
                .padding(.vertical, 5)
                .background(.ultraThinMaterial, in: Capsule())
                .overlay(Capsule().stroke(Color.white.opacity(0.12), lineWidth: 0.5))
            }.buttonStyle(ApplePressStyle())

            HStack(spacing: 6) {
                pickerCell($model.pickerH, label: "시", field: .h)
                sep
                pickerCell($model.pickerM, label: "분", field: .m)
                sep
                pickerCell($model.pickerS, label: "초", field: .s)
                Button {
                    model.pickerH = 0
                    model.pickerM = 0
                    model.pickerS = 0
                } label: {
                    Image(systemName: "arrow.counterclockwise")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(Color.white.opacity(0.62))
                        .frame(width: 28, height: 28)
                        .background(.ultraThinMaterial, in: Circle())
                        .overlay(Circle().stroke(Color.white.opacity(0.10), lineWidth: 0.5))
                }
                .buttonStyle(ApplePressStyle())
                .padding(.bottom, 14)
                Spacer()
                ctaButton(label: "적용", icon: nil) {
                    let total = model.pickerH * 3600 + model.pickerM * 60 + model.pickerS
                    if total > 0 { model.focusSec = total; model.remaining = total }
                    model.showPicker = false
                }
                .padding(.bottom, 14)
            }
        }
        .onAppear {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { focused = .h }
        }
    }

    private func pickerCell(_ value: Binding<Int>, label: String, field: PickerField) -> some View {
        VStack(spacing: 4) {
            TextField("", value: value, format: .number)
                .font(.system(size: 26, weight: .bold))
                .foregroundColor(.ink)
                .multilineTextAlignment(.center)
                .frame(width: 54, height: 46)
                .background(Color.black)
                .cornerRadius(10)
                .textFieldStyle(.plain)
                .focused($focused, equals: field)
                .onSubmit { focused = field == .h ? .m : field == .m ? .s : nil }
            Text(label).font(.system(size: 10)).foregroundColor(.muted)
        }
    }

    private var sep: some View {
        Text(":").font(.system(size: 20, weight: .bold)).foregroundColor(.muted).padding(.bottom, 14)
    }
}

// MARK: - Focus View
struct FocusView: View {
    @EnvironmentObject var model: TimerModel
    @State private var pulse = false

    var body: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    Circle().fill(model.paused ? Color.muted : Color.appRed).frame(width: 6, height: 6)
                        .opacity(pulse ? 0.3 : 1.0)
                        .animation(model.paused ? .default : .easeInOut(duration: 0.7).repeatForever(autoreverses: true), value: pulse)
                    Text(model.paused ? "일시정지" : "집중 중")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(model.paused ? .muted : .titleGreen)
                }
                Text(model.formatTime(max(0, model.remaining)))
                    .font(.system(size: 44, weight: .bold))
                    .foregroundColor(.timerGreen)
                    .monospacedDigit()
                    .contentTransition(.numericText())
                    .animation(.spring(response: 0.2, dampingFraction: 1.0), value: model.remaining)
                if model.elapsed >= 60 {
                    Text("집중 시작 \(model.elapsed / 60)분째! 좋은 흐름이에요")
                        .font(.system(size: 12))
                        .foregroundColor(.muted)
                }
            }
            Spacer()
            HStack(spacing: 10) {
                // 정지 — 글라스 muted
                Button { model.backToIdle() } label: {
                    Image(systemName: "stop.fill")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundColor(Color.white.opacity(0.55))
                        .frame(width: 47, height: 47)
                        .background(.ultraThinMaterial, in: Circle())
                        .overlay(Circle().stroke(Color.white.opacity(0.10), lineWidth: 0.5))
                }
                .buttonStyle(ApplePressStyle())

                // 일시정지/재개 — solid
                Button { model.paused.toggle() } label: {
                    Image(systemName: model.paused ? "play.fill" : "pause.fill")
                        .font(.system(size: 17))
                        .foregroundColor(.black)
                        .frame(width: 47, height: 47)
                        .background(Color.accent, in: Circle())
                }
                .buttonStyle(ApplePressStyle())
            }
        }
        .onAppear { pulse = true }
    }
}

// MARK: - Complete View
struct CompleteView: View {
    @State private var appeared = false

    var body: some View {
        VStack(spacing: 6) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 36))
                .foregroundColor(.accent)
                .scaleEffect(appeared ? 1.0 : 0.5)
                .opacity(appeared ? 1.0 : 0.0)
            Text("집중 완료")
                .font(.system(size: 16, weight: .bold))
                .foregroundColor(.ink)
                .opacity(appeared ? 1.0 : 0.0)
                .offset(y: appeared ? 0 : 6)
        }
        .frame(maxWidth: .infinity)
        .onAppear {
            withAnimation(.spring(response: 0.45, dampingFraction: 0.65).delay(0.05)) {
                appeared = true
            }
        }
    }
}

// MARK: - Guide View
struct GuideView: View {
    @EnvironmentObject var model: TimerModel
    @State private var autoIdleTask: DispatchWorkItem?

    var body: some View {
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 5) {
                    Image(systemName: model.currentGuide.systemIcon)
                        .font(.system(size: 11))
                        .foregroundColor(.accent)
                    Text(model.currentGuide.short)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(.accent)
                }
                Text(model.currentGuide.text)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(.ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .lineLimit(2)
                HStack(spacing: 6) {
                    Button {
                        model.guideIndex = (model.guideIndex + 1) % model.guides.count
                        scheduleAutoIdle()
                    } label: {
                        Text("다른 안내")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundColor(Color.white.opacity(0.50))
                            .padding(.horizontal, 10)
                            .padding(.vertical, 4)
                            .background(.ultraThinMaterial, in: Capsule())
                            .overlay(Capsule().stroke(Color.white.opacity(0.12), lineWidth: 0.5))
                    }
                    .buttonStyle(ApplePressStyle())

                    Button {
                        autoIdleTask?.cancel()
                        model.startBreak()
                    } label: {
                        Text("시작하기")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundColor(.accent)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 4)
                            .background(Color.accent.opacity(0.15), in: Capsule())
                            .overlay(Capsule().stroke(Color.accent.opacity(0.35), lineWidth: 0.5))
                    }
                    .buttonStyle(ApplePressStyle())
                }
                .padding(.top, 5)
            }
            Spacer(minLength: 0)
            MarimoView(size: 96)
        }
        .onAppear { scheduleAutoIdle() }
        .onDisappear { autoIdleTask?.cancel() }
    }

    private func scheduleAutoIdle() {
        autoIdleTask?.cancel()
        let task = DispatchWorkItem { model.backToIdle() }
        autoIdleTask = task
        DispatchQueue.main.asyncAfter(deadline: .now() + 120, execute: task)
    }
}

// MARK: - Break Picker View
struct BreakPickerView: View {
    @EnvironmentObject var model: TimerModel
    @FocusState private var focused: BreakField?

    enum BreakField { case m, s }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Button { model.showBreakPicker = false } label: {
                HStack(spacing: 3) {
                    Image(systemName: "chevron.left").font(.system(size: 10, weight: .semibold))
                    Text("이전").font(.system(size: 12, weight: .medium))
                }
                .foregroundColor(Color.white.opacity(0.75))
                .padding(.horizontal, 12)
                .padding(.vertical, 5)
                .background(.ultraThinMaterial, in: Capsule())
                .overlay(Capsule().stroke(Color.white.opacity(0.12), lineWidth: 0.5))
            }.buttonStyle(ApplePressStyle())

            HStack(spacing: 6) {
                breakCell($model.breakPickerM, label: "분", field: .m)
                Text(":").font(.system(size: 20, weight: .bold)).foregroundColor(.muted).padding(.bottom, 14)
                breakCell($model.breakPickerS, label: "초", field: .s)
                Button {
                    model.breakPickerM = 0
                    model.breakPickerS = 0
                } label: {
                    Image(systemName: "arrow.counterclockwise")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(Color.white.opacity(0.62))
                        .frame(width: 28, height: 28)
                        .background(.ultraThinMaterial, in: Circle())
                        .overlay(Circle().stroke(Color.white.opacity(0.10), lineWidth: 0.5))
                }
                .buttonStyle(ApplePressStyle())
                .padding(.bottom, 14)
                Spacer()
                ctaButton(label: "적용", icon: nil) {
                    let total = model.breakPickerM * 60 + model.breakPickerS
                    if total > 0 { model.breakOverrideSec = total }
                    model.showBreakPicker = false
                }
                .padding(.bottom, 14)
            }
        }
        .onAppear {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { focused = .m }
        }
    }

    private func breakCell(_ value: Binding<Int>, label: String, field: BreakField) -> some View {
        VStack(spacing: 4) {
            TextField("", value: value, format: .number)
                .font(.system(size: 26, weight: .bold))
                .foregroundColor(.ink)
                .multilineTextAlignment(.center)
                .frame(width: 54, height: 46)
                .background(Color.black)
                .cornerRadius(10)
                .textFieldStyle(.plain)
                .focused($focused, equals: field)
                .onSubmit { focused = field == .m ? .s : nil }
            Text(label).font(.system(size: 10)).foregroundColor(.muted)
        }
    }
}

// MARK: - Break View
struct BreakView: View {
    @EnvironmentObject var model: TimerModel
    @State private var pulse = false

    var body: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    Circle().fill(Color.accent).frame(width: 6, height: 6)
                        .opacity(pulse ? 0.3 : 1.0)
                        .animation(.easeInOut(duration: 0.7).repeatForever(autoreverses: true), value: pulse)
                    Text("휴식 중")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(.titleGreen)
                }
                Text(model.formatTime(max(0, model.remaining)))
                    .font(.system(size: 44, weight: .bold))
                    .foregroundColor(.timerGreen)
                    .monospacedDigit()
                    .contentTransition(.numericText())
                    .animation(.spring(response: 0.2, dampingFraction: 1.0), value: model.remaining)
                HStack(spacing: 6) {
                    Image(systemName: model.currentGuide.systemIcon)
                        .font(.system(size: 12))
                        .foregroundColor(.subGreen)
                    Text(model.currentGuide.short)
                        .font(.system(size: 12))
                        .foregroundColor(.subGreen)
                }
            }
            Spacer(minLength: 0)
            MarimoView(size: 72)
            grayButton(label: "건너뛰기") {
                model.stopTimer()
                model.cycles += 1
                model.currentView = .breakComplete
                DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                    if model.currentView == .breakComplete { model.backToIdle() }
                }
            }
        }
        .onAppear { pulse = true }
    }
}

// MARK: - Break Complete View
struct BreakCompleteView: View {
    @State private var appeared = false

    var body: some View {
        VStack(spacing: 6) {
            MarimoView(size: 80)
                .scaleEffect(appeared ? 1.0 : 0.5)
                .opacity(appeared ? 1.0 : 0.0)
            Text("휴식 종료")
                .font(.system(size: 16, weight: .bold))
                .foregroundColor(.ink)
                .opacity(appeared ? 1.0 : 0.0)
                .offset(y: appeared ? 0 : 6)
        }
        .frame(maxWidth: .infinity)
        .onAppear {
            withAnimation(.spring(response: 0.45, dampingFraction: 0.65).delay(0.05)) {
                appeared = true
            }
        }
    }
}

// MARK: - Marimo
struct MarimoView: View {
    var size: CGFloat = 72

    @State private var floatY: CGFloat = 0
    @State private var scale: CGFloat = 1.0
    @State private var glowRadius: CGFloat = 6

    var body: some View {
        Image("marimo")
            .resizable()
            .scaledToFit()
            .frame(width: size, height: size)
            .hueRotation(.degrees(22))
            .scaleEffect(scale)
            .offset(y: floatY)
            .shadow(color: Color(red: 0.11, green: 0.72, blue: 0.31).opacity(0.28),
                    radius: glowRadius, x: 0, y: 2)
            .onAppear {
                withAnimation(.easeInOut(duration: 3.2).repeatForever(autoreverses: true)) {
                    floatY = -7
                }
                withAnimation(.easeInOut(duration: 4.1).repeatForever(autoreverses: true)) {
                    scale = 1.05
                }
                withAnimation(.easeInOut(duration: 2.5).repeatForever(autoreverses: true)) {
                    glowRadius = 12
                }
            }
    }
}

// MARK: - Shared Helpers
private func ctaButton(label: String, icon: String?, action: @escaping () -> Void) -> some View {
    Button(action: action) {
        HStack(spacing: 5) {
            if let icon { Image(systemName: icon).font(.system(size: 13)) }
            Text(label).font(.system(size: 13, weight: .bold))
        }
        .foregroundColor(.black)
        .padding(.horizontal, 18)
        .frame(height: 44)
        .frame(minWidth: 100)
        .background(Color.accent)
        .cornerRadius(22)
    }
    .buttonStyle(ApplePressStyle())
}

private func grayButton(label: String, action: @escaping () -> Void) -> some View {
    Button(action: action) {
        Text(label)
            .font(.system(size: 13, weight: .bold))
            .foregroundColor(.ink)
            .padding(.horizontal, 18)
            .frame(height: 44)
            .frame(minWidth: 80)
            .background(Color.softBtn)
            .cornerRadius(22)
    }
    .buttonStyle(ApplePressStyle())
}

private func circleButton(icon: String, action: @escaping () -> Void) -> some View {
    Button(action: action) {
        Image(systemName: icon)
            .font(.system(size: 18))
            .foregroundColor(.ink)
            .frame(width: 44, height: 44)
            .background(Color.softBtn)
            .clipShape(Circle())
    }
    .buttonStyle(ApplePressStyle())
}

private func optionChip(label: String, selected: Bool, action: @escaping () -> Void) -> some View {
    Button(action: action) {
        Text(label)
            .font(.system(size: 11, weight: .medium))
            .foregroundColor(selected ? .accent : .muted)
            .padding(.horizontal, 12)
            .padding(.vertical, 4)
            .overlay(
                RoundedRectangle(cornerRadius: 999)
                    .stroke(selected ? Color.accent : Color.white.opacity(0.10), lineWidth: 1)
            )
    }
    .buttonStyle(ApplePressStyle())
}

