"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const GUIDES = [
  { emoji: "👁", text: "눈을 감고 20초, 또는 6미터 이상 먼 곳을 바라보세요", short: "👁 먼 곳 바라보기", tier: 1 },
  { emoji: "🖐", text: "손목을 천천히 돌리고, 손가락을 쭉 펴보세요", short: "🖐 손목 풀기", tier: 1 },
  { emoji: "🤸", text: "천천히 목을 좌우로 기울이고, 어깨를 크게 돌려보세요", short: "🤸 목·어깨 풀기", tier: 2 },
  { emoji: "🌬", text: "4초 들이쉬고, 4초 참고, 4초 내쉬세요 (박스 호흡)", short: "🌬 박스 호흡", tier: 2 },
  { emoji: "🧘", text: "아무것도 하지 말고 멍하니 있어보세요. 폰 없이.", short: "🧘 멍하니 있기", tier: 3 },
  { emoji: "🚶", text: "자리에서 일어나 물 한 잔 마시고 오세요", short: "🚶 물 한 잔 마시기", tier: 3 },
];

const TIER_BY_CHECKIN: Record<string, number[]> = {
  good: [1, 2],
  meh:  [2, 3],
  bad:  [3],
};

const FEEDBACK = {
  good: { emoji: "😌", title: "충분히 쉬었군요.", body: "좋아요. 그 상태로 다음 블록 들어가세요." },
  meh:  { emoji: "😐", title: "애매했군요.", body: "애매한 휴식은 반쪽짜리예요. 다음엔 폰을 멀리 해보세요." },
  bad:  { emoji: "😵", title: "못 쉬었군요.", body: "방금 그건 회복이 아니었어요. 다음 휴식엔 다르게 해볼까요?" },
};

const FOCUS_OPTIONS = [
  { label: "5초", sec: 5 },
  { label: "25분", sec: 25 * 60 },
];

function calcBreakSec(focusSec: number): number {
  if (focusSec <= 30) return 5;
  if (focusSec < 45 * 60) return 5 * 60;
  if (focusSec < 90 * 60) return 10 * 60;
  return 20 * 60;
}

type View = "idle" | "focus" | "guide" | "break" | "checkin" | "feedback";
type CheckinKey = "good" | "meh" | "bad";

function formatTime(sec: number) {
  if (sec >= 3600) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return `${h}:${String(m).padStart(2, "0")}:00`;
  }
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function playSound(type: "focus-start" | "focus-end" | "checkin") {
  if (typeof window === "undefined") return;
  const ctx = new AudioContext();
  const playTone = (freq: number, delay: number) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = freq;
    osc.type = "sine";
    gain.gain.setValueAtTime(0, ctx.currentTime + delay);
    gain.gain.linearRampToValueAtTime(0.3, ctx.currentTime + delay + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.8);
    osc.start(ctx.currentTime + delay);
    osc.stop(ctx.currentTime + delay + 0.8);
  };
  if (type === "focus-start") {
    [0, 0.4, 0.8].forEach((delay, i) => playTone([523, 659, 784][i], delay));
  } else if (type === "focus-end") {
    [0, 0.5, 1.0].forEach((delay, i) => playTone([784, 659, 523][i], delay));
  } else if (type === "checkin") {
    [0, 0.35].forEach((delay) => playTone(660, delay));
  }
}

function sendNotification(title: string, body: string) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission === "granted") {
    new Notification(title, { body });
  } else if (Notification.permission !== "denied") {
    Notification.requestPermission();
  }
}

// 다크 글래스 테마
const C = {
  ink:    "rgba(255,255,255,0.92)",
  muted:  "rgba(255,255,255,0.45)",
  line:   "rgba(255,255,255,0.10)",
  soft:   "rgba(255,255,255,0.08)",
  accent: "#30d158",
  red:    "#ff453a",
};

export default function Home() {
  const [view, setView]             = useState<View>("idle");
  const [focusSec, setFocusSec]     = useState(5);
  const [remaining, setRemaining]   = useState(5);
  const [paused, setPaused]         = useState(false);
  const [guideIndex, setGuideIndex] = useState(0);
  const [checkinKey, setCheckinKey] = useState<CheckinKey>("good");
  const [lastCheckin, setLastCheckin] = useState<CheckinKey | null>(null);
  const [stats, setStats]           = useState({ cycles: 0, good: 0, meh: 0, bad: 0 });
  const [customFocus, setCustomFocus] = useState("");
  const [showPicker, setShowPicker] = useState(false);
  const [pickerH, setPickerH]       = useState(0);
  const [pickerM, setPickerM]       = useState(25);
  const [isExpanded, setIsExpanded] = useState(false);

  const timerRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const pausedRef  = useRef(false);
  pausedRef.current    = paused;

  // Tray 업데이트
  useEffect(() => {
    if (typeof window === "undefined" || !(window as any).electron?.updateTray) return;
    const el = (window as any).electron;
    if (view === "focus" || view === "break") el.updateTray(formatTime(remaining));
    else el.updateTray("🍅");
  }, [view, remaining]);

  const clearTimer = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  const startTick = useCallback((initSec: number, onDone: () => void) => {
    clearTimer();
    setRemaining(initSec);
    let rem = initSec;
    timerRef.current = setInterval(() => {
      if (pausedRef.current) return;
      rem -= 1;
      setRemaining(rem);
      if (rem <= 0) { clearTimer(); onDone(); }
    }, 1000);
  }, [clearTimer]);

  const pickGuide = useCallback((lastIdx: number, prevCheckin: CheckinKey | null, currentFocusSec: number) => {
    const focusMin = currentFocusSec / 60;
    const focusTiers = focusMin >= 90 ? [3] : focusMin >= 45 ? [2, 3] : focusMin >= 25 ? [1, 2, 3] : [1, 2];
    const checkinTiers = prevCheckin ? TIER_BY_CHECKIN[prevCheckin] : [1, 2, 3];
    const intersection = focusTiers.filter((t) => checkinTiers.includes(t));
    const allowedTiers = intersection.length > 0 ? intersection : focusTiers;
    const candidates = GUIDES.map((_, i) => i).filter(
      (i) => allowedTiers.includes(GUIDES[i].tier) && i !== lastIdx
    );
    const pool = candidates.length > 0 ? candidates : GUIDES.map((_, i) => i).filter((i) => i !== lastIdx);
    let next: number;
    do { next = pool[Math.floor(Math.random() * pool.length)]; } while (pool.length > 1 && next === lastIdx);
    return next;
  }, []);

  const startFocus = useCallback(() => {
    setPaused(false);
    setView("focus");
    playSound("focus-start");
    startTick(focusSec, () => {
      playSound("focus-end");
      sendNotification("집중 끝", "쉬는 안내를 확인해 주세요.");
      setGuideIndex((prev) => pickGuide(prev, lastCheckin, focusSec));
      setView("guide");
    });
  }, [focusSec, startTick, pickGuide, lastCheckin]);

  const startBreak = useCallback(() => {
    setView("break");
    startTick(calcBreakSec(focusSec), () => {
      playSound("checkin");
      sendNotification("휴식 끝", "지금 회복됐나요?");
      setView("checkin");
    });
  }, [startTick, focusSec]);

  const doCheckin = useCallback((key: CheckinKey) => {
    setCheckinKey(key);
    setLastCheckin(key);
    setStats((prev) => ({ ...prev, cycles: prev.cycles + 1, [key]: prev[key] + 1 }));
    if (typeof window !== "undefined" && (window as any).electron?.saveSession) {
      (window as any).electron.saveSession({
        timestamp: new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).replace(" ", "T"),
        focusSec,
        breakSec: calcBreakSec(focusSec),
        checkin: key,
        guide: GUIDES[guideIndex].short,
      });
    }
    setView("feedback");
  }, [focusSec, guideIndex]);

  const backToIdle = useCallback(() => {
    clearTimer();
    setPaused(false);
    setView("idle");
  }, [clearTimer]);

  useEffect(() => () => clearTimer(), [clearTimer]);

  // main.js 커서 추적 → notch-state 수신
  useEffect(() => {
    (window as any).electron?.onNotchState((expanded: boolean) => {
      setIsExpanded(expanded);
    });
  }, []);

  const guide = GUIDES[guideIndex];
  const fb    = FEEDBACK[checkinKey];

  const summaryParts: string[] = [];
  if (stats.cycles > 0) {
    summaryParts.push(`🍅×${stats.cycles}`);
    if (stats.good) summaryParts.push(`😌×${stats.good}`);
    if (stats.meh)  summaryParts.push(`😐×${stats.meh}`);
    if (stats.bad)  summaryParts.push(`😵×${stats.bad}`);
  }

  const timerStyle: React.CSSProperties = {
    fontFamily: "Fraunces, serif",
    fontSize: 52,
    fontWeight: 500,
    letterSpacing: "-0.03em",
    lineHeight: 1,
    textAlign: "center",
    margin: "2px 0",
    color: C.ink,
  };

  const btnPrimary: React.CSSProperties = {
    width: "100%", border: "none", borderRadius: 12, padding: "11px 14px",
    fontSize: 14, fontWeight: 600, cursor: "pointer",
    background: C.accent, color: "#fff",
    WebkitAppRegion: "no-drag" as never,
  };

  const btnGhost: React.CSSProperties = {
    width: "100%", border: "none", borderRadius: 12, padding: "11px 14px",
    fontSize: 14, fontWeight: 600, cursor: "pointer",
    background: C.soft, color: C.ink,
    WebkitAppRegion: "no-drag" as never,
  };

  const dot = (color: string): React.CSSProperties => ({
    width: 7, height: 7, borderRadius: "50%", background: color, display: "inline-block",
    animation: "pulse-dot 1.4s ease infinite",
  });

  const statusRow: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: 8,
    fontSize: 13, fontWeight: 500, color: C.ink,
  };

  return (
    <div style={{ position: "fixed", inset: 0 }}>
      {/* 노치 글래스 패널 */}
      <div style={{
        position: "absolute",
        inset: 0,
        background: "rgba(20,20,22,0.88)",
        backdropFilter: "saturate(180%) blur(24px)",
        WebkitBackdropFilter: "saturate(180%) blur(24px)" as never,
        borderRadius: "0 0 20px 20px",
        padding: "46px 18px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        opacity: isExpanded ? 1 : 0,
        transform: isExpanded ? "translateY(0)" : "translateY(-12px)",
        transition: "opacity 0.25s ease, transform 0.25s ease",
        overflow: "hidden",
        pointerEvents: isExpanded ? "auto" : "none",
      }}>

        {/* 1. 대기 */}
        {view === "idle" && !showPicker && (<>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span>🍅</span>
            <strong style={{ fontFamily: "Fraunces, serif", fontWeight: 650, color: C.ink, fontSize: 15 }}>
              Recovery Pomo
            </strong>
            {summaryParts.length > 0 && (
              <span style={{ marginLeft: "auto", fontSize: 11, color: C.muted }}>
                {summaryParts.join("  ")}
              </span>
            )}
          </div>
          <div style={timerStyle}>{formatTime(focusSec)}</div>
          <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
            {FOCUS_OPTIONS.map((opt) => (
              <button key={opt.sec}
                onClick={() => { setFocusSec(opt.sec); setRemaining(opt.sec); setCustomFocus(""); }}
                style={{
                  border: `1px solid ${focusSec === opt.sec && !customFocus ? C.accent : C.line}`,
                  background: focusSec === opt.sec && !customFocus ? C.accent : "transparent",
                  color: focusSec === opt.sec && !customFocus ? "#fff" : C.muted,
                  borderRadius: 999, padding: "6px 12px",
                  fontSize: 12, fontWeight: 500, cursor: "pointer",
                  WebkitAppRegion: "no-drag" as never,
                }}>{opt.label}</button>
            ))}
            <button
              onClick={() => {
                setPickerH(Math.floor(focusSec / 3600));
                setPickerM(Math.floor((focusSec % 3600) / 60) || 25);
                setShowPicker(true);
              }}
              style={{
                border: `1px solid ${customFocus ? C.accent : C.line}`,
                background: customFocus ? C.accent : "transparent",
                color: customFocus ? "#fff" : C.muted,
                borderRadius: 999, padding: "6px 12px",
                fontSize: 12, fontWeight: 500, cursor: "pointer",
                WebkitAppRegion: "no-drag" as never,
              }}>시간 설정</button>
          </div>
          <button onClick={startFocus} style={btnPrimary}>▶ 시작하기</button>
        </>)}

        {/* 시간 설정 피커 */}
        {view === "idle" && showPicker && (<>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <button onClick={() => setShowPicker(false)}
              style={{ background: C.soft, border: "none", borderRadius: 999, width: 28, height: 28, fontSize: 16, cursor: "pointer", color: C.ink, WebkitAppRegion: "no-drag" as never }}>‹</button>
            <span style={{ fontFamily: "Fraunces, serif", fontWeight: 650, fontSize: 14, color: C.ink }}>시간 설정</span>
            <div style={{ width: 28 }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, flex: 1 }}>
            {/* 시 */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
              <button onClick={() => setPickerH((h) => Math.min(5, h + 1))}
                style={{ background: C.soft, border: "none", borderRadius: 999, width: 30, height: 30, fontSize: 14, cursor: "pointer", color: C.ink, WebkitAppRegion: "no-drag" as never }}>▲</button>
              <input type="number" min={0} max={5} value={pickerH}
                onChange={(e) => setPickerH(Math.min(5, Math.max(0, parseInt(e.target.value) || 0)))}
                style={{ width: 60, height: 60, background: C.soft, border: "2px solid transparent", borderRadius: 12,
                  fontFamily: "Fraunces, serif", fontSize: 28, fontWeight: 600, textAlign: "center",
                  color: C.ink, outline: "none", WebkitAppRegion: "no-drag" as never }} />
              <button onClick={() => setPickerH((h) => Math.max(0, h - 1))}
                style={{ background: C.soft, border: "none", borderRadius: 999, width: 30, height: 30, fontSize: 14, cursor: "pointer", color: C.ink, WebkitAppRegion: "no-drag" as never }}>▼</button>
              <span style={{ fontSize: 10, color: C.muted }}>시</span>
            </div>
            <span style={{ fontFamily: "Fraunces, serif", fontSize: 28, fontWeight: 600, color: C.ink, marginBottom: 24 }}>:</span>
            {/* 분 */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
              <button onClick={() => setPickerM((m) => Math.min(59, m + 1))}
                style={{ background: C.soft, border: "none", borderRadius: 999, width: 30, height: 30, fontSize: 14, cursor: "pointer", color: C.ink, WebkitAppRegion: "no-drag" as never }}>▲</button>
              <input type="number" min={0} max={59} value={pickerM}
                onChange={(e) => setPickerM(Math.min(59, Math.max(0, parseInt(e.target.value) || 0)))}
                style={{ width: 60, height: 60, background: C.soft, border: "2px solid transparent", borderRadius: 12,
                  fontFamily: "Fraunces, serif", fontSize: 28, fontWeight: 600, textAlign: "center",
                  color: C.ink, outline: "none", WebkitAppRegion: "no-drag" as never }} />
              <button onClick={() => setPickerM((m) => Math.max(0, m - 1))}
                style={{ background: C.soft, border: "none", borderRadius: 999, width: 30, height: 30, fontSize: 14, cursor: "pointer", color: C.ink, WebkitAppRegion: "no-drag" as never }}>▼</button>
              <span style={{ fontSize: 10, color: C.muted }}>분</span>
            </div>
          </div>
          <button
            onClick={() => {
              const total = pickerH * 3600 + pickerM * 60;
              if (total > 0) { setFocusSec(total); setRemaining(total); setCustomFocus("custom"); }
              setShowPicker(false);
            }}
            style={btnPrimary}>적용</button>
        </>)}

        {/* 집중 중 */}
        {view === "focus" && (<>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={statusRow}><span style={dot(C.red)} /> 집중 중</div>
            <button onClick={() => setPaused((p) => !p)}
              style={{ background: C.soft, border: "none", borderRadius: 999, width: 28, height: 28, fontSize: 12, cursor: "pointer", color: C.ink, WebkitAppRegion: "no-drag" as never }}>
              {paused ? "▶" : "⏸"}
            </button>
          </div>
          <div style={timerStyle}>{formatTime(Math.max(0, remaining))}</div>
          <p style={{ textAlign: "center", color: C.muted, fontSize: 13 }}>한 가지에만 머물러 보세요</p>
          <button onClick={backToIdle} style={{ ...btnGhost, color: C.muted, fontSize: 12 }}>집중 종료</button>
        </>)}

        {/* 쉬는 안내 */}
        {view === "guide" && (<>
          <div style={statusRow}><span style={{ ...dot(C.accent), animation: "none" }} /> 쉬는 시간</div>
          <div style={{ background: "rgba(255,255,255,0.06)", border: `1px solid ${C.line}`, borderRadius: 12, padding: "12px 14px", textAlign: "center" }}>
            <div style={{ fontSize: 26, marginBottom: 8 }}>{guide.emoji}</div>
            <p style={{ fontFamily: "Fraunces, serif", fontSize: 15, fontWeight: 500, lineHeight: 1.4, color: C.ink }}>{guide.text}</p>
          </div>
          <button onClick={() => setGuideIndex((i) => (i + 1) % GUIDES.length)}
            style={{ background: "transparent", border: "none", color: C.muted, fontSize: 12, fontWeight: 500, cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 3, WebkitAppRegion: "no-drag" as never }}>
            다른 안내 보기
          </button>
          <button onClick={() => startBreak()} style={btnPrimary}>휴식 시작</button>
        </>)}

        {/* 휴식 중 */}
        {view === "break" && (<>
          <div style={statusRow}><span style={dot(C.accent)} /> 휴식 중</div>
          <div style={{ textAlign: "center", flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10 }}>
            <div style={{ fontSize: 36, animation: "breathe 4s ease-in-out infinite" }}>{guide.emoji}</div>
            <p style={{ fontFamily: "Fraunces, serif", fontSize: 16, fontWeight: 600, color: C.ink, lineHeight: 1.35 }}>{guide.text}</p>
            <p style={{ fontSize: 12, color: C.muted, fontVariantNumeric: "tabular-nums" }}>{formatTime(Math.max(0, remaining))}</p>
          </div>
          <button onClick={() => { clearTimer(); setView("checkin"); }} style={btnGhost}>건너뛰기</button>
        </>)}

        {/* 체크인 */}
        {view === "checkin" && (<>
          <p style={{ fontFamily: "Fraunces, serif", fontSize: 20, fontWeight: 650, textAlign: "center", lineHeight: 1.25, color: C.ink }}>
            지금 회복됐나요?
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {(["good", "meh", "bad"] as CheckinKey[]).map((key) => (
              <button key={key} onClick={() => doCheckin(key)}
                style={{ width: "100%", textAlign: "left", border: `1px solid ${C.line}`, background: C.soft, borderRadius: 12, padding: "11px 14px", fontSize: 13, fontWeight: 500, cursor: "pointer", color: C.ink, WebkitAppRegion: "no-drag" as never }}>
                {FEEDBACK[key].emoji} {key === "good" ? "충분히 쉬었어요" : key === "meh" ? "애매해요" : "못 쉬었어요"}
              </button>
            ))}
          </div>
        </>)}

        {/* 피드백 */}
        {view === "feedback" && (<>
          <div style={{ fontSize: 32, textAlign: "center" }}>{fb.emoji}</div>
          <p style={{ fontFamily: "Fraunces, serif", fontSize: 20, fontWeight: 650, textAlign: "center", lineHeight: 1.25, color: C.ink }}>{fb.title}</p>
          <p style={{ textAlign: "center", color: C.muted, fontSize: 13, lineHeight: 1.5 }}>{fb.body}</p>
          <button onClick={backToIdle} style={btnPrimary}>다음 집중 시작 →</button>
        </>)}

      </div>
    </div>
  );
}
