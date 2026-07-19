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

// 직전 체크인 결과 → 다음 가이드 허용 티어
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
  if (focusSec <= 30) return 5;           // 테스트용
  if (focusSec < 45 * 60) return 5 * 60;  // 25분 이하 → 5분
  if (focusSec < 90 * 60) return 10 * 60; // 45분 이상 → 10분
  return 20 * 60;                          // 90분 이상 → 20분
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

export default function Home() {
  const [view, setView] = useState<View>("idle");
  const [focusSec, setFocusSec] = useState(5);
  const [remaining, setRemaining] = useState(5);
  const [paused, setPaused] = useState(false);
  const [guideIndex, setGuideIndex] = useState(0);
  const [checkinKey, setCheckinKey] = useState<CheckinKey>("good");
  const [lastCheckin, setLastCheckin] = useState<CheckinKey | null>(null);
  const [stats, setStats] = useState({ cycles: 0, good: 0, meh: 0, bad: 0 });
  const [customFocus, setCustomFocus] = useState("");
  const [showPicker, setShowPicker] = useState(false);
  const [pickerH, setPickerH] = useState(0);
  const [pickerM, setPickerM] = useState(25);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pausedRef = useRef(false);
  pausedRef.current = paused;

  useEffect(() => {
    if (typeof window === "undefined" || !(window as any).electron?.updateTray) return;
    const el = (window as any).electron;
    if (view === "focus" || view === "break") el.updateTray(formatTime(remaining));
    else el.updateTray("●");
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

  const el = typeof window !== "undefined" ? (window as any).electron : null;
  const [isCompact, setIsCompact] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const minimize = useCallback(() => setIsCompact(true), []);
  const expand = useCallback(() => setIsCompact(false), []);

  const startFocus = useCallback(() => {
    setPaused(false);
    setView("focus");
    playSound("focus-start");
    minimize();
    startTick(focusSec, () => {
      playSound("focus-end");
      sendNotification("집중 끝", "쉬는 안내를 확인해 주세요.");
      setIsCompact(false);
      setGuideIndex((prev) => pickGuide(prev, lastCheckin, focusSec));
      setView("guide");
    });
  }, [focusSec, startTick, pickGuide, lastCheckin]);

  const startBreak = useCallback((currentGuideIdx: number) => {
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
    setIsCompact(false);
    setView("idle");
  }, [clearTimer]);

  useEffect(() => () => clearTimer(), [clearTimer]);

  const isMounted = useRef(false);
  useEffect(() => {
    if (!isMounted.current) { isMounted.current = true; return; }
    (window as any).electron?.resizeWindow(isCompact ? 80 : 360, isCompact ? 80 : 520);
  }, [isCompact]);

  const guide = GUIDES[guideIndex];
  const fb = FEEDBACK[checkinKey];

  const hasSummary = stats.cycles > 0 || stats.good + stats.meh + stats.bad > 0;

  const widget: React.CSSProperties = isCompact ? {
    width: 80, height: 80,
    background: "#000",
    borderRadius: "50%",
    boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  } : {
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
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif",
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
      <div style={widget} className={isCompact ? "" : "drag-region"}>

        {/* 1. 대기 */}
        {view === "idle" && !showPicker && (<>
          <div style={{ height: 12 }} />
          <div style={timerStyle}>{formatTime(focusSec)}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <p style={{ ...hintStyle, fontSize: 11, marginBottom: 2 }}>집중</p>
            <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
              {FOCUS_OPTIONS.map((opt) => (
                <button key={opt.sec} onClick={() => { setFocusSec(opt.sec); setRemaining(opt.sec); setCustomFocus(""); }}
                  style={{
                    border: `1px solid ${focusSec === opt.sec && !customFocus ? "var(--accent)" : "var(--line)"}`,
                    background: focusSec === opt.sec && !customFocus ? "var(--accent)" : "transparent",
                    color: focusSec === opt.sec && !customFocus ? "#fff" : "var(--muted)",
                    borderRadius: 999, padding: "7px 14px", fontSize: 13, fontWeight: 500, cursor: "pointer",
                    WebkitAppRegion: "no-drag" as never,
                  }}>{opt.label}</button>
              ))}
              <button
                onClick={() => {
                  const h = Math.floor(focusSec / 3600);
                  const m = Math.floor((focusSec % 3600) / 60) || 25;
                  setPickerH(h); setPickerM(m);
                  setShowPicker(true);
                }}
                style={{
                  border: `1px solid ${customFocus ? "var(--accent)" : "var(--line)"}`,
                  background: customFocus ? "var(--accent)" : "transparent",
                  color: customFocus ? "#fff" : "var(--muted)",
                  borderRadius: 999, padding: "7px 14px", fontSize: 13, fontWeight: 500, cursor: "pointer",
                  WebkitAppRegion: "no-drag" as never,
                }}>시간 설정</button>
            </div>
          </div>
          <div style={{ marginTop: "auto" }}>
            <button onClick={startFocus} style={btnPrimary}>▶ 시작하기</button>
          </div>
          {hasSummary && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, fontSize: 13 }}>
              {/* 초록 구체 × 사이클 수 */}
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{
                  display: "inline-block", width: 10, height: 10, borderRadius: "50%",
                  background: "#30d158", boxShadow: "0 0 6px rgba(48,209,88,0.7)",
                }} />
                <span style={{ color: "var(--widget-ink)", fontWeight: 500 }}>×{stats.cycles}</span>
              </span>
              {/* 구분선 */}
              <span style={{ color: "var(--line)", fontSize: 16 }}>|</span>
              {/* 휴식 결과 이모지 3종 */}
              <span style={{ display: "flex", gap: 6, color: "var(--muted)" }}>
                <span>😌<span style={{ fontSize: 11, marginLeft: 1 }}>{stats.good}</span></span>
                <span>😐<span style={{ fontSize: 11, marginLeft: 1 }}>{stats.meh}</span></span>
                <span>😵<span style={{ fontSize: 11, marginLeft: 1 }}>{stats.bad}</span></span>
              </span>
            </div>
          )}
        </>)}

        {/* 시간 설정 피커 */}
        {view === "idle" && showPicker && (<>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
            <button onClick={() => setShowPicker(false)}
              style={{ background: "var(--soft)", border: "none", borderRadius: 999, width: 32, height: 32, fontSize: 16, cursor: "pointer", WebkitAppRegion: "no-drag" as never }}>‹</button>
            <span style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif", fontWeight: 650, fontSize: 15 }}>시간 설정</span>
            <div style={{ width: 32 }} />
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, flex: 1 }}>
            {/* 시 */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
              <button onClick={() => setPickerH((h) => Math.min(5, h + 1))}
                style={{ background: "var(--soft)", border: "none", borderRadius: 999, width: 36, height: 36, fontSize: 18, cursor: "pointer", WebkitAppRegion: "no-drag" as never }}>▲</button>
              <input
                type="number" min={0} max={5} value={pickerH}
                onChange={(e) => setPickerH(Math.min(5, Math.max(0, parseInt(e.target.value) || 0)))}
                style={{ width: 72, height: 72, background: "var(--soft)", border: "2px solid transparent", borderRadius: 16,
                  fontFamily: "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif", fontSize: 34, fontWeight: 600, textAlign: "center",
                  color: "var(--widget-ink)", outline: "none", cursor: "text",
                  WebkitAppRegion: "no-drag" as never }}
              />
              <button onClick={() => setPickerH((h) => Math.max(0, h - 1))}
                style={{ background: "var(--soft)", border: "none", borderRadius: 999, width: 36, height: 36, fontSize: 18, cursor: "pointer", WebkitAppRegion: "no-drag" as never }}>▼</button>
              <span style={{ fontSize: 11, color: "var(--muted)" }}>시</span>
            </div>

            <span style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif", fontSize: 34, fontWeight: 600, marginBottom: 28 }}>:</span>

            {/* 분 */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
              <button onClick={() => setPickerM((m) => Math.min(59, m + 1))}
                style={{ background: "var(--soft)", border: "none", borderRadius: 999, width: 36, height: 36, fontSize: 18, cursor: "pointer", WebkitAppRegion: "no-drag" as never }}>▲</button>
              <input
                type="number" min={0} max={59} value={pickerM}
                onChange={(e) => setPickerM(Math.min(59, Math.max(0, parseInt(e.target.value) || 0)))}
                style={{ width: 72, height: 72, background: "var(--soft)", border: "2px solid transparent", borderRadius: 16,
                  fontFamily: "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif", fontSize: 34, fontWeight: 600, textAlign: "center",
                  color: "var(--widget-ink)", outline: "none", cursor: "text",
                  WebkitAppRegion: "no-drag" as never }}
              />
              <button onClick={() => setPickerM((m) => Math.max(0, m - 1))}
                style={{ background: "var(--soft)", border: "none", borderRadius: 999, width: 36, height: 36, fontSize: 18, cursor: "pointer", WebkitAppRegion: "no-drag" as never }}>▼</button>
              <span style={{ fontSize: 11, color: "var(--muted)" }}>분</span>
            </div>
          </div>

          <button
            onClick={() => {
              const total = pickerH * 3600 + pickerM * 60;
              if (total > 0) { setFocusSec(total); setRemaining(total); setCustomFocus("custom"); }
              setShowPicker(false);
            }}
            style={{ ...btnPrimary }}>적용</button>
        </>)}

        {/* 2-A. 집중 중 — 마리모 구체 */}
        {view === "focus" && isCompact && (() => {
          const total = focusSec;
          const elapsed = total - Math.max(0, remaining);
          const progress = total > 0 ? elapsed / total : 0;
          // 프로그레스 링: r=37, 바깥쪽에 붙게
          const R = 37; const C = 2 * Math.PI * R;
          return (
            <div
              style={{ width: 80, height: 80, position: "relative", cursor: "grab" }}
              onMouseEnter={() => setIsHovered(true)}
              onMouseLeave={() => setIsHovered(false)}
              onMouseDown={(e) => {
                if ((e.target as HTMLElement).closest("button")) return;
                e.preventDefault();
                const startX = e.screenX, startY = e.screenY;
                const onMove = (ev: MouseEvent) => {
                  if (Math.abs(ev.screenX - startX) > 4 || Math.abs(ev.screenY - startY) > 4) {
                    (window as any).electron?.moveWindow(ev.screenX - 40, ev.screenY - 40);
                  }
                };
                const onUp = () => {
                  document.removeEventListener("mousemove", onMove);
                  document.removeEventListener("mouseup", onUp);
                };
                document.addEventListener("mousemove", onMove);
                document.addEventListener("mouseup", onUp);
              }}
            >
              {/* 프로그레스 링 */}
              <svg width="80" height="80" style={{ position: "absolute", top: 0, left: 0, transform: "rotate(-90deg)", zIndex: 2, pointerEvents: "none" }}>
                {/* 트랙 */}
                <circle cx="40" cy="40" r={R} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3" />
                {/* 진행 */}
                <circle cx="40" cy="40" r={R} fill="none"
                  stroke="#30d158" strokeWidth="3"
                  strokeDasharray={C} strokeDashoffset={C * (1 - progress)}
                  strokeLinecap="round"
                  style={{
                    transition: "stroke-dashoffset 1s linear",
                    filter: "drop-shadow(0 0 4px rgba(48,209,88,0.9))",
                  }} />
              </svg>

              {/* 마리모 — fluid blob */}
              <div style={{
                position: "absolute",
                inset: 16,
                overflow: "hidden",
                background: "#000",
                animation: "fluid-morph 9s ease-in-out infinite",
                zIndex: 1,
              }}>
                {/* blob 1 — 형광 그린 메인 */}
                <div style={{
                  position: "absolute", width: "90%", height: "90%",
                  top: "15%", left: "-5%",
                  borderRadius: "50%",
                  background: "#30d158",
                  filter: "blur(10px)",
                  opacity: 0.9,
                  animation: "blob-drift1 11s ease-in-out infinite",
                }} />
                {/* blob 2 — 밝은 형광 */}
                <div style={{
                  position: "absolute", width: "65%", height: "65%",
                  top: "-10%", left: "30%",
                  borderRadius: "50%",
                  background: "#4fffaa",
                  filter: "blur(8px)",
                  opacity: 0.6,
                  animation: "blob-drift2 13s ease-in-out infinite",
                }} />
                {/* blob 3 — 딥 그린 포인트 */}
                <div style={{
                  position: "absolute", width: "50%", height: "50%",
                  top: "55%", left: "35%",
                  borderRadius: "50%",
                  background: "#00e04a",
                  filter: "blur(7px)",
                  opacity: 0.7,
                  animation: "blob-drift3 8s ease-in-out infinite",
                }} />
              </div>

              {/* hover 시 확장 아이콘 */}
              {isHovered && (
                <div style={{
                  position: "absolute", inset: 0, borderRadius: "50%",
                  background: "rgba(0,0,0,0.42)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 3,
                }}>
                  <button
                    onClick={() => setIsCompact(false)}
                    style={{ background: "transparent", border: "none", color: "#fff", cursor: "pointer", lineHeight: 1, WebkitAppRegion: "no-drag" as never }}>
                    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round">
                      <line x1="3" y1="15" x2="15" y2="3"/>
                      <polyline points="3,8 3,15 10,15"/>
                      <polyline points="8,3 15,3 15,10"/>
                    </svg>
                  </button>
                </div>
              )}
            </div>
          );
        })()}

        {/* 2-B. 집중 중 — 풀 뷰 */}
        {view === "focus" && !isCompact && (<>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={statusRow}><span style={dot("var(--focus-color)")} /> 집중 중</div>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => setPaused((p) => !p)}
                style={{ background: "var(--soft)", border: "none", borderRadius: 999, width: 32, height: 32, fontSize: 13, cursor: "pointer", WebkitAppRegion: "no-drag" as never }}>
                {paused ? "▶" : "⏸"}
              </button>
              <button onClick={minimize}
                style={{ background: "var(--soft)", border: "none", borderRadius: 999, width: 32, height: 32, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", WebkitAppRegion: "no-drag" as never }}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <line x1="1" y1="13" x2="13" y2="1"/>
                  <polyline points="1,7 1,13 7,13"/>
                  <polyline points="7,1 13,1 13,7"/>
                </svg>
              </button>
            </div>
          </div>
          <div style={timerStyle}>{formatTime(Math.max(0, remaining))}</div>
          <p style={hintStyle}>끝날 때까지 한 가지에만 머물러 보세요</p>
          <div style={{ marginTop: "auto" }}>
            <button onClick={backToIdle}
              style={{ ...btnGhost, width: "100%", color: "var(--muted)", fontSize: 13 }}>집중 종료</button>
          </div>
        </>)}

        {/* 3. 쉬는 안내 */}
        {view === "guide" && (<>
          <div style={statusRow}><span style={{ ...dot("var(--rest)"), animation: "none" }} /> 쉬는 시간</div>
          <div style={{ background: "var(--soft)", border: "1px solid var(--line)", borderRadius: 16, padding: "16px 14px", textAlign: "center" }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--accent)", marginBottom: 10, letterSpacing: "0.02em" }}>이번 쉬는 안내</div>
            <div style={{ fontSize: 28, lineHeight: 1, marginBottom: 8 }}>{guide.emoji}</div>
            <p style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif", fontSize: 17, fontWeight: 500, lineHeight: 1.35, color: "var(--widget-ink)" }}>{guide.text}</p>
          </div>
          <button onClick={() => setGuideIndex((i) => (i + 1) % GUIDES.length)}
            style={{ background: "transparent", border: "none", color: "var(--muted)", fontSize: 14, fontWeight: 500, cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 3, padding: 6, WebkitAppRegion: "no-drag" as never }}>
            다른 안내 보기
          </button>
          <div style={{ marginTop: "auto" }}>
            <button onClick={() => startBreak(guideIndex)}
              style={{ ...btnPrimary, lineHeight: 1.25 }}>
              휴식 시작
              <small style={{ display: "block", fontSize: 12, fontWeight: 500, opacity: 0.85, marginTop: 2 }}>쉬는 시간 시작할 준비 됐어요</small>
            </button>
          </div>
        </>)}

        {/* 4. 휴식 중 */}
        {view === "break" && (<>
          <div style={statusRow}><span style={dot("var(--rest)")} /> 휴식 중</div>
          <div style={{ textAlign: "center", flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
            <div style={{ fontSize: 48, animation: "breathe 4s ease-in-out infinite" }}>{guide.emoji}</div>
            <p style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif", fontSize: 20, fontWeight: 600, color: "var(--rest)", lineHeight: 1.35, animation: "breathe 4s ease-in-out infinite" }}>{guide.text}</p>
            <p style={{ fontSize: 13, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>{formatTime(Math.max(0, remaining))}</p>
          </div>
          <div style={{ marginTop: "auto" }}>
            <button onClick={() => { clearTimer(); setView("checkin"); }} style={{ ...btnGhost, width: "100%" }}>건너뛰기</button>
          </div>
        </>)}

        {/* 5. 체크인 */}
        {view === "checkin" && (<>
          <p style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif", fontSize: 24, fontWeight: 650, textAlign: "center", lineHeight: 1.25, marginTop: 8 }}>지금 회복됐나요?</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
            {(["good", "meh", "bad"] as CheckinKey[]).map((key) => (
              <button key={key} onClick={() => doCheckin(key)}
                style={{ width: "100%", textAlign: "left", border: "1px solid var(--line)", background: "var(--soft)", borderRadius: 14, padding: "13px 14px", fontSize: 14, fontWeight: 500, cursor: "pointer", color: "var(--widget-ink)", WebkitAppRegion: "no-drag" as never }}>
                {FEEDBACK[key].emoji} {key === "good" ? "충분히 쉬었어요" : key === "meh" ? "애매해요" : "못 쉬었어요"}
              </button>
            ))}
          </div>
        </>)}

        {/* 6. 피드백 */}
        {view === "feedback" && (<>
          <div style={{ fontSize: 36, textAlign: "center", marginTop: 8 }}>{fb.emoji}</div>
          <p style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif", fontSize: 22, fontWeight: 650, textAlign: "center", lineHeight: 1.25 }}>{fb.title}</p>
          <p style={{ textAlign: "center", color: "var(--muted)", fontSize: 14, lineHeight: 1.5, padding: "0 4px" }}>{fb.body}</p>
          <div style={{ marginTop: "auto" }}>
            <button onClick={backToIdle} style={btnPrimary}>다음 집중 시작 →</button>
          </div>
        </>)}

      </div>
    </div>
  );
}
