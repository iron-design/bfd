import SwiftUI
import Combine

enum AppView: Equatable {
    case idle, focus, complete, guide, breakTime, checkin, feedback
}

enum CheckinKey: String, Codable {
    case good, bad
}

struct Guide {
    let systemIcon: String
    let text: String
    let short: String
    let tier: Int
}

struct Session: Codable {
    let timestamp: String
    let focusSec: Int
    let breakSec: Int
    let checkin: String
    let guide: String
}

class TimerModel: ObservableObject {
    @Published var currentView: AppView = .idle
    @Published var focusSec: Int = 50 * 60
    @Published var remaining: Int = 50 * 60
    @Published var paused: Bool = false
    @Published var guideIndex: Int = 0
    @Published var checkinKey: CheckinKey = .good
    @Published var lastCheckin: CheckinKey? = nil
    @Published var cycles: Int = 0
    @Published var goodCount: Int = 0
    @Published var badCount: Int = 0
    @Published var showPicker: Bool = false
    @Published var pickerH: Int = 0
    @Published var pickerM: Int = 50
    @Published var showExtend: Bool = false
    @Published var soundEnabled: Bool = true

    private var timerCancellable: AnyCancellable?

    let guides: [Guide] = [
        Guide(systemIcon: "eye",            text: "눈을 감고 20초, 또는 6미터 이상 먼 곳을 바라보세요", short: "먼 곳 바라보기",   tier: 1),
        Guide(systemIcon: "hand.raised",    text: "손목을 천천히 돌리고, 손가락을 쭉 펴보세요",          short: "손목 풀기",       tier: 1),
        Guide(systemIcon: "arrow.clockwise",text: "천천히 목을 좌우로 기울이고, 어깨를 크게 돌려보세요",  short: "목·어깨 풀기",   tier: 2),
        Guide(systemIcon: "wind",           text: "4초 들이쉬고, 4초 참고, 4초 내쉬세요 (박스 호흡)",    short: "박스 호흡",       tier: 2),
        Guide(systemIcon: "pause.circle",   text: "아무것도 하지 말고 멍하니 있어보세요. 폰 없이.",        short: "멍하니 있기",     tier: 3),
        Guide(systemIcon: "figure.walk",    text: "자리에서 일어나 물 한 잔 마시고 오세요",               short: "물 한 잔 마시기", tier: 3),
    ]

    let focusOptions: [(label: String, sec: Int)] = [
        ("5초", 5),
        ("50분", 50 * 60),
    ]

    var currentGuide: Guide { guides[guideIndex] }
    var elapsed: Int { focusSec - remaining }

    func calcBreakSec(tier: Int) -> Int {
        if focusSec <= 30 { return 5 }
        let table: [Int: [Int]] = [
            1: [3 * 60,  5 * 60, 10 * 60],
            2: [5 * 60, 10 * 60, 15 * 60],
            3: [7 * 60, 15 * 60, 20 * 60],
        ]
        let row = table[tier] ?? table[2]!
        if focusSec < 45 * 60 { return row[0] }
        if focusSec < 90 * 60 { return row[1] }
        return row[2]
    }

    func formatTime(_ sec: Int) -> String {
        let s = max(0, sec)
        if s >= 3600 {
            let h = s / 3600
            let m = (s % 3600) / 60
            return "\(h):\(String(format: "%02d", m)):00"
        }
        return "\(s / 60):\(String(format: "%02d", s % 60))"
    }

    func pickGuide(lastIdx: Int, prevCheckin: CheckinKey?) -> Int {
        let focusMin = focusSec / 60
        let focusTiers: [Int] = focusMin >= 90 ? [3] : focusMin >= 45 ? [2, 3] : focusMin >= 25 ? [1, 2, 3] : [1, 2]
        let checkinTiers: [Int] = prevCheckin == .good ? [1, 2] : prevCheckin == .bad ? [2, 3] : [1, 2, 3]
        let intersection = focusTiers.filter { checkinTiers.contains($0) }
        let allowed = intersection.isEmpty ? focusTiers : intersection
        var pool = guides.indices.filter { allowed.contains(guides[$0].tier) && $0 != lastIdx }
        if pool.isEmpty { pool = guides.indices.filter { $0 != lastIdx } }
        return pool.isEmpty ? 0 : pool[Int.random(in: 0..<pool.count)]
    }

    func startFocus() {
        paused = false
        currentView = .focus
        if soundEnabled { SoundManager.play(.focusStart) }
        startTick(initSec: focusSec) {
            if self.soundEnabled { SoundManager.play(.focusEnd) }
            self.guideIndex = self.pickGuide(lastIdx: self.guideIndex, prevCheckin: self.lastCheckin)
            self.currentView = .complete
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                if self.currentView == .complete { self.currentView = .guide }
            }
        }
    }

    func startBreak() {
        currentView = .breakTime
        startTick(initSec: calcBreakSec(tier: currentGuide.tier)) {
            if self.soundEnabled { SoundManager.play(.checkin) }
            self.currentView = .checkin
        }
    }

    func extendBreak(extraSec: Int) {
        currentView = .breakTime
        startTick(initSec: extraSec) {
            if self.soundEnabled { SoundManager.play(.checkin) }
            self.currentView = .checkin
        }
    }

    func doCheckin(_ key: CheckinKey) {
        checkinKey = key
        lastCheckin = key
        cycles += 1
        if key == .good { goodCount += 1 } else { badCount += 1 }
        saveSession(checkin: key)
        currentView = .feedback
    }

    func backToIdle() {
        stopTimer()
        paused = false
        currentView = .idle
    }

    private func startTick(initSec: Int, onDone: @escaping () -> Void) {
        stopTimer()
        remaining = initSec
        timerCancellable = Timer.publish(every: 1, on: .main, in: .common)
            .autoconnect()
            .sink { [weak self] _ in
                guard let self, !self.paused else { return }
                self.remaining -= 1
                if self.remaining <= 0 { self.stopTimer(); onDone() }
            }
    }

    func stopTimer() {
        timerCancellable?.cancel()
        timerCancellable = nil
    }

    private func saveSession(checkin: CheckinKey) {
        let fmt = DateFormatter()
        fmt.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
        fmt.timeZone = TimeZone(identifier: "Asia/Seoul")
        let session = Session(
            timestamp: fmt.string(from: Date()),
            focusSec: focusSec,
            breakSec: calcBreakSec(tier: currentGuide.tier),
            checkin: checkin.rawValue,
            guide: currentGuide.short
        )
        var sessions = loadSessions()
        sessions.append(session)
        if let data = try? JSONEncoder().encode(sessions) {
            UserDefaults.standard.set(data, forKey: "rp_sessions")
        }
    }

    func loadTodayStats() {
        let fmt = DateFormatter()
        fmt.dateFormat = "yyyy-MM-dd"
        fmt.timeZone = TimeZone(identifier: "Asia/Seoul")
        let today = fmt.string(from: Date())
        let sessions = loadSessions().filter { $0.timestamp.hasPrefix(today) }
        cycles = sessions.count
        goodCount = sessions.filter { $0.checkin == "good" }.count
        badCount = sessions.filter { $0.checkin == "bad" }.count
    }

    private func loadSessions() -> [Session] {
        guard let data = UserDefaults.standard.data(forKey: "rp_sessions"),
              let sessions = try? JSONDecoder().decode([Session].self, from: data) else { return [] }
        return sessions
    }
}
