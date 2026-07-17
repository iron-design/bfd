"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const GUIDES = [
  { emoji: "👁", text: "눈을 감고 20초, 또는 6미터 이상 먼 곳을 바라보세요", short: "👁 먼 곳 바라보기" },
  { emoji: "🧘", text: "아무것도 하지 말고 멍하니 있어보세요. 폰 없이.", short: "🧘 멍하니 있기" },
  { emoji: "🤸", text: "천천히 목을 좌우로 기울이고, 어깨를 크게 돌려보세요", short: "🤸 목·어깨 풀기" },
  { emoji: "🖐", text: "손목을 천천히 돌리고, 손가락을 쭉 펴보세요", short: "🖐 손목 풀기" },
  { emoji: "🌬", text: "4초 들이쉬고, 4초 참고, 4초 내쉬세요 (박스 호흡)", short: "🌬 박스 호흡" },
  { emoji: "🚶", text: "자리에서 일어나 물 한 잔 마시고 오세요", short: "🚶 물 한 잔 마시기" },
];

const FEEDBACK = {
  good: { emoji: "😌", title: "충분히 쉬었군요.", body: "좋아요. 그 상태로 다음 블록 들어가세요." },
  meh:  { emoji: "😐", title: "애매했군요.", body: "애매한 휴식은 반쪽짜리예요. 다음엔 폰을 멀리 해보세요." },
  bad:  { emoji: "😵", title: "못 쉬었군요.", body: "방금 그건 회복이 아니었어요. 다음 휴식엔 다르게 해볼까요?" },
};

const DURATION_OPTIONS = [
  { label: "5초", sec: 5 },
  { label: "10초", sec: 10 },
  { label: "25분", sec: 25 * 60 },
];

const BREAK_SECONDS = 5;

type View = "idle" | "focus" | "guide" | "break" | "checkin" | "feedback";
type CheckinKey = "good" | "meh" | "bad";

function formatTime(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function sendNotification(title: string, body: string) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission === "granted") {
    new Notification(title, { body });
  } else if (Notification.permission !== "denied") {
    Notification.requestPermission();
  }
}

export default function Home() {
  const [view, setView] = useState<View>("idle");
  const [focusSec, setFocusSec] = useState(5);
  const [remaining, setRemaining] = useState(5);
  const [paused, setPaused] = useState(false);
  const [guideIndex, setGuideIndex] = useState(0);
  const [checkinKey, setCheckinKey] = useState<CheckinKey>("good");
  const [stats, setStats] = useState({ cycles: 0, good: 0, meh: 0, bad: 0 });

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pausedRef = useRef(false);
  pausedRef.current = paused;

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

  const pickGuide = useCallback((lastIdx: number) => {
    if (GUIDES.length === 1) return 0;
    let next: number;
    do { next = Math.floor(Math.random() * GUIDES.length); } while (next === lastIdx);
    return next;
  }, []);

  const startFocus = useCallback(() => {
    setPaused(false);
    setView("focus");
    startTick(focusSec, () => {
      sendNotification("집중 끝", "쉬는 안내를 확인해 주세요.");
      setGuideIndex((prev) => pickGuide(prev));
      setView("guide");
    });
  }, [focusSec, startTick, pickGuide]);

  const startBreak = useCallback((currentGuideIdx: number) => {
    setView("break");
    startTick(BREAK_SECONDS, () => {
      sendNotification("휴식 끝", "지금 회복됐나요?");
      setView("checkin");
    });
  }, [startTick]);

  const doCheckin = useCallback((key: CheckinKey) => {
    setCheckinKey(key);
    setStats((prev) => ({ ...prev, cycles: prev.cycles + 1, [key]: prev[key] + 1 }));
    setView("feedback");
  }, []);

  const backToIdle = useCallback(() => {
    clearTimer();
    setPaused(false);
    setView("idle");
  }, [clearTimer]);

  useEffect(() => () => clearTimer(), [clearTimer]);

  const guide = GUIDES[guideIndex];
  const fb = FEEDBACK[checkinKey];

  const summaryParts: string[] = [];
  if (stats.cycles > 0 || stats.good + stats.meh + stats.bad > 0) {
    summaryParts.push(`🍅×${stats.cycles}`);
    if (stats.good) summaryParts.push(`😌×${stats.good}`);
    if (stats.meh) summaryParts.push(`😐×${stats.meh}`);
    if (stats.bad) summaryParts.push(`😵×${stats.bad}`);
  }

  const widget: React.CSSProperties = {
    width: "min(320px, calc(100vw - 32px))",
    minHeight: 280,
    background: "var(--widget)",
    borderRadius: 22,
    boxShadow: "var(--shadow)",
    padding: "22px 22px 18px",
    animation: "rise 0.55s cubic-bezier(0.22, 1, 0.36, 1)",
    display: "flex",
    flexDirection: "column",
    gap: 14,
  };

  const timerStyle: React.CSSProperties = {
    fontFamily: "Fraunces, serif",
    fontSize: 64,
    fontWeight: 500,
    letterSpacing: "-0.03em",
    lineHeight: 1,
    textAlign: "center",
    margin: "8px 0 4px",
  };

  const hintStyle: React.CSSProperties = { textAlign: "center", color: "var(--muted)", fontSize: 13 };

  const btnPrimary: React.CSSProperties = {
    width: "100%", border: "none", borderRadius: 14, padding: "13px 14px",
    fontSize: 14, fontWeight: 600, cursor: "pointer", background: "var(--accent)", color: "#fff",
    WebkitAppRegion: "no-drag" as never,
  };

  const btnGhost: React.CSSProperties = {
    flex: 1, border: "none", borderRadius: 14, padding: "13px 14px",
    fontSize: 14, fontWeight: 600, cursor: "pointer", background: "var(--soft)", color: "var(--widget-ink)",
    WebkitAppRegion: "no-drag" as never,
  };

  const dot = (color: string): React.CSSProperties => ({
    width: 8, height: 8, borderRadius: "50%", background: color, display: "inline-block",
    animation: "pulse-dot 1.4s ease infinite",
  });

  const statusRow: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 500 };

  return (
    <div style={{ display: "grid", placeItems: "center", minHeight: "100vh" }}>
      <div style={widget} className="drag-region">

        {/* 1. 대기 */}
        {view === "idle" && (<>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 500, color: "var(--muted)" }}>
            <span>🍅</span>
            <strong style={{ fontFamily: "Fraunces, serif", fontWeight: 650, color: "var(--widget-ink)", fontSize: 15 }}>Recovery Pomo</strong>
          </div>
          <div style={timerStyle}>{formatTime(focusSec)}</div>
          <p style={hintStyle}>테스트용 집중 시간</p>
          <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
            {DURATION_OPTIONS.map((opt) => (
              <button key={opt.sec} onClick={() => { setFocusSec(opt.sec); setRemaining(opt.sec); }}
                style={{
                  border: `1px solid ${focusSec === opt.sec ? "var(--accent)" : "var(--line)"}`,
                  background: focusSec === opt.sec ? "var(--accent)" : "transparent",
                  color: focusSec === opt.sec ? "#fff" : "var(--muted)",
                  borderRadius: 999, padding: "7px 12px", fontSize: 13, fontWeight: 500, cursor: "pointer",
                  WebkitAppRegion: "no-drag" as never,
                }}>{opt.label}</button>
            ))}
          </div>
          <div style={{ marginTop: "auto" }}>
            <button onClick={startFocus} style={btnPrimary}>▶ 시작하기</button>
          </div>
          {summaryParts.length > 0 && (
            <p style={{ textAlign: "center", fontSize: 13, color: "var(--muted)" }}>오늘: {summaryParts.join("  ")}</p>
          )}
        </>)}

        {/* 2. 집중 중 */}
        {view === "focus" && (<>
          <div style={statusRow}><span style={dot("var(--focus-color)")} /> 집중 중</div>
          <div style={timerStyle}>{formatTime(Math.max(0, remaining))}</div>
          <p style={hintStyle}>끝날 때까지 한 가지에만 머물러 보세요</p>
          <div style={{ display: "flex", gap: 8, marginTop: "auto" }}>
            <button onClick={() => setPaused((p) => !p)} style={btnGhost}>{paused ? "▶ 계속" : "⏸ 일시정지"}</button>
            <button onClick={backToIdle}
              style={{ flex: "0 0 46px", border: "none", borderRadius: 14, padding: 13, fontSize: 14, fontWeight: 600, cursor: "pointer", background: "#f3e4e1", color: "var(--focus-color)", WebkitAppRegion: "no-drag" as never }}>✕</button>
          </div>
        </>)}

        {/* 3. 쉬는 안내 */}
        {view === "guide" && (<>
          <div style={statusRow}><span style={{ ...dot("var(--rest)"), animation: "none" }} /> 쉬는 시간</div>
          <div style={{ background: "linear-gradient(180deg,#eaf4ef,#e1eee7)", border: "1px solid rgba(31,107,85,0.12)", borderRadius: 16, padding: "16px 14px", textAlign: "center" }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--accent)", marginBottom: 10, letterSpacing: "0.02em" }}>💡 이번 쉬는 안내</div>
            <div style={{ fontSize: 28, lineHeight: 1, marginBottom: 8 }}>{guide.emoji}</div>
            <p style={{ fontFamily: "Fraunces, serif", fontSize: 17, fontWeight: 500, lineHeight: 1.35 }}>{guide.text}</p>
          </div>
          <button onClick={() => setGuideIndex((i) => (i + 1) % GUIDES.length)}
            style={{ background: "transparent", border: "none", color: "var(--muted)", fontSize: 14, fontWeight: 500, cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 3, padding: 6, WebkitAppRegion: "no-drag" as never }}>
            다른 안내 보기
          </button>
          <div style={{ marginTop: "auto" }}>
            <button onClick={() => startBreak(guideIndex)}
              style={{ ...btnPrimary, lineHeight: 1.25 }}>
              확인했어요
              <small style={{ display: "block", fontSize: 12, fontWeight: 500, opacity: 0.85, marginTop: 2 }}>쉬는 시간 시작할 준비 됐어요</small>
            </button>
          </div>
        </>)}

        {/* 4. 휴식 중 */}
        {view === "break" && (<>
          <div style={statusRow}><span style={dot("var(--rest)")} /> 휴식 중</div>
          <p style={{ textAlign: "center", fontSize: 14, fontWeight: 500, color: "var(--rest)" }}>{guide.short}</p>
          <div style={timerStyle}>{formatTime(Math.max(0, remaining))}</div>
          <p style={hintStyle}>안내대로 천천히 쉬어보세요</p>
          <div style={{ marginTop: "auto" }}>
            <button onClick={() => { clearTimer(); setView("checkin"); }} style={{ ...btnGhost, width: "100%" }}>건너뛰기</button>
          </div>
        </>)}

        {/* 5. 체크인 */}
        {view === "checkin" && (<>
          <p style={{ fontFamily: "Fraunces, serif", fontSize: 24, fontWeight: 650, textAlign: "center", lineHeight: 1.25, marginTop: 8 }}>지금 회복됐나요?</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
            {(["good", "meh", "bad"] as CheckinKey[]).map((key) => (
              <button key={key} onClick={() => doCheckin(key)}
                style={{ width: "100%", textAlign: "left", border: "1px solid var(--line)", background: "#fff", borderRadius: 14, padding: "13px 14px", fontSize: 14, fontWeight: 500, cursor: "pointer", WebkitAppRegion: "no-drag" as never }}>
                {FEEDBACK[key].emoji} {key === "good" ? "충분히 쉬었어요" : key === "meh" ? "애매해요" : "못 쉬었어요"}
              </button>
            ))}
          </div>
        </>)}

        {/* 6. 피드백 */}
        {view === "feedback" && (<>
          <div style={{ fontSize: 36, textAlign: "center", marginTop: 8 }}>{fb.emoji}</div>
          <p style={{ fontFamily: "Fraunces, serif", fontSize: 22, fontWeight: 650, textAlign: "center", lineHeight: 1.25 }}>{fb.title}</p>
          <p style={{ textAlign: "center", color: "var(--muted)", fontSize: 14, lineHeight: 1.5, padding: "0 4px" }}>{fb.body}</p>
          <div style={{ marginTop: "auto" }}>
            <button onClick={backToIdle} style={btnPrimary}>다음 집중 시작 →</button>
          </div>
        </>)}

      </div>
    </div>
  );
}
