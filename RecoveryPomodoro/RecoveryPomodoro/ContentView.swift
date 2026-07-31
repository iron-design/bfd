import SwiftUI

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

// MARK: - Main View
struct ContentView: View {
    @EnvironmentObject var model: TimerModel

    var body: some View {
        ZStack {
            Color.appBG.ignoresSafeArea()
            HStack(spacing: 10) {
                switch model.currentView {
                case .idle:
                    if model.showPicker { PickerView() } else { IdleView() }
                case .focus:     FocusView()
                case .complete:  CompleteView()
                case .guide:     GuideView()
                case .breakTime: BreakView()
                case .checkin:   CheckinView()
                case .feedback:  FeedbackView()
                }
            }
            .padding(.horizontal, 24)
            .padding(.vertical, 20)
        }
        .frame(width: 460, height: 140)
        .clipShape(RoundedRectangle(cornerRadius: 26))
        .onAppear { model.loadTodayStats() }
    }
}

// MARK: - Idle View
struct IdleView: View {
    @EnvironmentObject var model: TimerModel

    var body: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    Circle().fill(Color.accent).frame(width: 6, height: 6)
                    Text("Recovery Pomo")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(.titleGreen)
                    if model.cycles > 0 {
                        Text("· 오늘 \(model.cycles)회 완료")
                            .font(.system(size: 11))
                            .foregroundColor(.muted)
                    }
                }
                Text(model.formatTime(model.focusSec))
                    .font(.system(size: 44, weight: .bold))
                    .foregroundColor(.timerGreen)
                    .monospacedDigit()
                HStack(spacing: 6) {
                    ForEach(model.focusOptions, id: \.sec) { opt in
                        optionChip(label: opt.label, selected: model.focusSec == opt.sec) {
                            model.focusSec = opt.sec
                            model.remaining = opt.sec
                        }
                    }
                    optionChip(label: "시간 설정", selected: false) {
                        model.pickerH = model.focusSec / 3600
                        model.pickerM = (model.focusSec % 3600) / 60 == 0 ? 50 : (model.focusSec % 3600) / 60
                        model.showPicker = true
                    }
                }
            }
            Spacer()
            ctaButton(label: "시작하기", icon: "play.fill") { model.startFocus() }
        }
    }
}

// MARK: - Picker View
struct PickerView: View {
    @EnvironmentObject var model: TimerModel

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Button { model.showPicker = false } label: {
                    Image(systemName: "chevron.left").foregroundColor(.muted)
                }.buttonStyle(.plain)
                Text("시간 설정")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(.ink)
            }
            HStack(spacing: 12) {
                spinnerCol(value: $model.pickerH, label: "시", range: 0...5)
                Text(":")
                    .font(.system(size: 22, weight: .bold))
                    .foregroundColor(.ink)
                    .padding(.bottom, 14)
                spinnerCol(value: $model.pickerM, label: "분", range: 0...59)
                Spacer()
                ctaButton(label: "적용", icon: nil) {
                    let total = model.pickerH * 3600 + model.pickerM * 60
                    if total > 0 { model.focusSec = total; model.remaining = total }
                    model.showPicker = false
                }
                .padding(.leading, 8)
            }
        }
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
                Text(model.elapsed >= 60
                     ? "집중 시작 \(model.elapsed / 60)분째! 좋은 흐름이에요"
                     : "한 가지에만 머물러 보세요.")
                    .font(.system(size: 12))
                    .foregroundColor(.muted)
            }
            Spacer()
            VStack(spacing: 8) {
                circleButton(icon: "stop.fill")  { model.backToIdle() }
                circleButton(icon: model.paused ? "play.fill" : "pause.fill") { model.paused.toggle() }
            }
        }
        .onAppear { pulse = true }
    }
}

// MARK: - Complete View
struct CompleteView: View {
    var body: some View {
        VStack(spacing: 6) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 36))
                .foregroundColor(.accent)
            Text("집중 완료")
                .font(.system(size: 16, weight: .bold))
                .foregroundColor(.ink)
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Guide View
struct GuideView: View {
    @EnvironmentObject var model: TimerModel

    var body: some View {
        HStack(spacing: 10) {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: model.currentGuide.systemIcon)
                    .font(.system(size: 32))
                    .foregroundColor(.accent)
                    .frame(width: 40)
                VStack(alignment: .leading, spacing: 3) {
                    Text(model.currentGuide.short)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(.titleGreen)
                    Text(model.currentGuide.text)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(.ink)
                        .fixedSize(horizontal: false, vertical: true)
                    HStack(spacing: 8) {
                        Text(model.formatTime(model.calcBreakSec(tier: model.currentGuide.tier)) + " 휴식")
                            .font(.system(size: 11))
                            .foregroundColor(.subGreen)
                        Button("다른 안내") {
                            model.guideIndex = (model.guideIndex + 1) % model.guides.count
                        }
                        .buttonStyle(.plain)
                        .font(.system(size: 11))
                        .foregroundColor(.muted)
                        .underline()
                    }
                }
            }
            Spacer()
            ctaButton(label: "휴식 시작", icon: nil) { model.startBreak() }
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
                HStack(spacing: 6) {
                    Image(systemName: model.currentGuide.systemIcon)
                        .font(.system(size: 12))
                        .foregroundColor(.subGreen)
                    Text(model.currentGuide.short)
                        .font(.system(size: 12))
                        .foregroundColor(.subGreen)
                }
            }
            Spacer()
            grayButton(label: "건너뛰기") {
                model.stopTimer()
                model.currentView = .checkin
            }
        }
        .onAppear { pulse = true }
    }
}

// MARK: - Checkin View
struct CheckinView: View {
    @EnvironmentObject var model: TimerModel

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !model.showExtend {
                Text("충분히 쉬었나요?")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(.ink)
                HStack(spacing: 8) {
                    ctaButton(label: "네, 시작할게요", icon: nil) { model.doCheckin(.good) }
                    grayButton(label: "더 쉴게요") { model.showExtend = true }
                }
            } else {
                Text("얼마나 더 쉬어요?")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(.ink)
                HStack(spacing: 6) {
                    grayButton(label: "+2분") { model.extendBreak(extraSec: 2 * 60) }
                    grayButton(label: "+5분") { model.extendBreak(extraSec: 5 * 60) }
                    Button("그냥 넘어갈게요") { model.doCheckin(.bad) }
                        .buttonStyle(.plain)
                        .font(.system(size: 11))
                        .foregroundColor(.muted)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear { model.showExtend = false }
    }
}

// MARK: - Feedback View
struct FeedbackView: View {
    @EnvironmentObject var model: TimerModel

    var body: some View {
        HStack(spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: model.checkinKey == .good ? "face.smiling.fill" : "face.dashed.fill")
                    .font(.system(size: 28))
                    .foregroundColor(model.checkinKey == .good ? Color.timerGreen : Color.appRed)
                VStack(alignment: .leading, spacing: 2) {
                    Text(model.checkinKey == .good ? "잘 쉬었군요." : "이번엔 조금 부족했어요.")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundColor(.ink)
                    Text(model.checkinKey == .good ? "그 상태로 다음 블록 들어가세요." : "다음 휴식엔 폰을 멀리 해보세요.")
                        .font(.system(size: 12))
                        .foregroundColor(.muted)
                }
            }
            Spacer()
            ctaButton(label: "다음 집중 →", icon: nil) { model.backToIdle() }
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
    .buttonStyle(.plain)
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
    .buttonStyle(.plain)
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
    .buttonStyle(.plain)
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
    .buttonStyle(.plain)
}

private func spinnerCol(value: Binding<Int>, label: String, range: ClosedRange<Int>) -> some View {
    VStack(spacing: 2) {
        Button { value.wrappedValue = min(range.upperBound, value.wrappedValue + 1) } label: {
            Image(systemName: "chevron.up").foregroundColor(.muted)
        }.buttonStyle(.plain)
        TextField("", value: value, format: .number)
            .font(.system(size: 24, weight: .bold))
            .foregroundColor(.ink)
            .frame(width: 52, height: 44)
            .multilineTextAlignment(.center)
            .background(Color.softBtn)
            .cornerRadius(10)
            .monospacedDigit()
            .textFieldStyle(.plain)
            .onSubmit {
                value.wrappedValue = max(range.lowerBound, min(range.upperBound, value.wrappedValue))
            }
        Button { value.wrappedValue = max(range.lowerBound, value.wrappedValue - 1) } label: {
            Image(systemName: "chevron.down").foregroundColor(.muted)
        }.buttonStyle(.plain)
        Text(label).font(.system(size: 10)).foregroundColor(.muted).padding(.top, 2)
    }
}
