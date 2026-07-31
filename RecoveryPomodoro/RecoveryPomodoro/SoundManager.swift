import AppKit

class SoundManager {
    enum SoundType { case focusStart, focusEnd, checkin }

    static func play(_ type: SoundType) {
        DispatchQueue.main.async {
            switch type {
            case .focusStart: NSSound(named: "Ping")?.play()
            case .focusEnd:   NSSound(named: "Glass")?.play()
            case .checkin:    NSSound(named: "Pop")?.play()
            }
        }
    }
}
