"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  View, TouchInteraction, Rotate, WindStream, Pause, Pedestrian,
  PlayFilled, CaretUp, CaretDown, ChevronLeft, StopFilled,
  CheckmarkFilled, FaceSatisfiedFilled, FaceDissatisfiedFilled,
} from "@carbon/icons-react";

const GUIDES = [
  { Icon: View,             text: "눈을 감고 20초, 또는 6미터 이상 먼 곳을 바라보세요", short: "먼 곳 바라보기", tier: 1 },
  { Icon: TouchInteraction, text: "손목을 천천히 돌리고, 손가락을 쭉 펴보세요",          short: "손목 풀기",     tier: 1 },
  { Icon: Rotate,           text: "천천히 목을 좌우로 기울이고, 어깨를 크게 돌려보세요",  short: "목·어깨 풀기", tier: 2 },
  { Icon: WindStream,       text: "4초 들이쉬고, 4초 참고, 4초 내쉬세요 (박스 호흡)",    short: "박스 호흡",    tier: 2 },
  { Icon: Pause,            text: "아무것도 하지 말고 멍하니 있어보세요. 폰 없이.",        short: "멍하니 있기",  tier: 3 },
  { Icon: Pedestrian,       text: "자리에서 일어나 물 한 잔 마시고 오세요",               short: "물 한 잔 마시기", tier: 3 },
];

const TIER_BY_CHECKIN: Record<string, number[]> = {
  good: [1, 2],
  bad:  [2, 3],
};

const FEEDBACK = {
  good: { Icon: FaceSatisfiedFilled,    iconColor: "#4ADE4A", title: "잘 쉬었군요.",         body: "그 상태로 다음 블록 들어가세요." },
  bad:  { Icon: FaceDissatisfiedFilled, iconColor: "#ff453a", title: "이번엔 조금 부족했어요.", body: "다음 휴식엔 폰을 멀리 해보세요." },
};

const FOCUS_OPTIONS = [
  { label: "5초", sec: 5 },
  { label: "25분", sec: 25 * 60 },
];

function calcBreakSec(focusSec: number, tier = 2): number {
  if (focusSec <= 30) return 5;
  const table: Record<number, [number, number, number]> = {
    1: [3 * 60,  5 * 60, 10 * 60],
    2: [5 * 60, 10 * 60, 15 * 60],
    3: [7 * 60, 15 * 60, 20 * 60],
  };
  const [a, b, c] = table[tier] ?? table[2];
  if (focusSec < 45 * 60) return a;
  if (focusSec < 90 * 60) return b;
  return c;
}

type View = "idle" | "focus" | "complete" | "guide" | "break" | "checkin" | "feedback";
type CheckinKey = "good" | "bad";

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
  } else {
    [0, 0.35].forEach((delay) => playTone(660, delay));
  }
}

const el = () => typeof window !== "undefined" ? (window as any).electron : null;

const C = {
  ink:      "rgba(255,255,255,0.92)",
  muted:    "#8E8E93",
  line:     "rgba(255,255,255,0.10)",
  soft:     "rgba(59,59,61,0.55)",
  softBtn:  "rgba(59,59,61,0.80)",
  accent:   "#30D158",
  timer:    "#4ADE4A",
  title:    "#AACFAA",
  subtext:  "#7BAF7B",
  red:      "#ff453a",
};

const SF: React.CSSProperties = {
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif",
};

export default function Home() {
  const [view, setView]               = useState<View>("idle");
  const [focusSec, setFocusSec]       = useState(25 * 60);
  const [remaining, setRemaining]     = useState(25 * 60);
  const [paused, setPaused]           = useState(false);
  const [guideIndex, setGuideIndex]   = useState(0);
  const [checkinKey, setCheckinKey]   = useState<CheckinKey>("good");
  const [lastCheckin, setLastCheckin] = useState<CheckinKey | null>(null);
  const [stats, setStats]             = useState({ cycles: 0, good: 0, meh: 0, bad: 0 });
  const [showPicker, setShowPicker]   = useState(false);
  const [pickerH, setPickerH]         = useState(0);
  const [pickerM, setPickerM]         = useState(25);
  const [isExpanded, setIsExpanded]   = useState(false);
  const [panelVisible, setPanelVisible] = useState(false);
  const [showExtend, setShowExtend]   = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const soundRef = useRef(true);
  soundRef.current = soundEnabled;

  const timerRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const pausedRef = useRef(false);
  pausedRef.current = paused;

  useEffect(() => {
    el()?.onSoundToggle?.((enabled: boolean) => setSoundEnabled(enabled));
  }, []);

  useEffect(() => {
    el()?.onNotchState((expanded: boolean) => {
      if (expanded) {
        setPanelVisible(true);
        requestAnimationFrame(() => requestAnimationFrame(() => setIsExpanded(true)));
      } else {
        setIsExpanded(false);
        setTimeout(() => setPanelVisible(false), 260);
      }
    });
  }, []);

  useEffect(() => {
    el()?.loadSessions?.().then((sessions: any[]) => {
      if (!sessions?.length) return;
      const todayStr = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
      const today = sessions.filter((s) => s.timestamp?.startsWith(todayStr));
      if (!today.length) return;
      setStats({
        cycles: today.length,
        good:   today.filter((s) => s.checkin === "good").length,
        meh:    today.filter((s) => s.checkin === "meh").length,
        bad:    today.filter((s) => s.checkin === "bad").length,
      });
    });
  }, []);

  useEffect(() => {
    const e = el();
    if (!e?.updateTray) return;
    if (view === "focus" || view === "break") e.updateTray(formatTime(remaining));
    else e.updateTray("");
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

  useEffect(() => {
    if (view !== "complete") return;
    const t = setTimeout(() => setView("guide"), 2000);
    return () => clearTimeout(t);
  }, [view]);

  useEffect(() => {
    if (view === "checkin") setShowExtend(false);
  }, [view]);

  const startFocus = useCallback(() => {
    setPaused(false);
    setView("focus");
    if (soundRef.current) playSound("focus-start");
    el()?.notchCollapse();
    startTick(focusSec, () => {
      if (soundRef.current) playSound("focus-end");
      setGuideIndex((prev) => pickGuide(prev, lastCheckin, focusSec));
      setView("complete");
      el()?.lockPanel(true);
      el()?.notchExpand();
    });
  }, [focusSec, startTick, pickGuide, lastCheckin]);

  const extendBreak = useCallback((extraSec: number) => {
    setView("break");
    el()?.lockPanel(false);
    el()?.notchCollapse();
    startTick(extraSec, () => {
      if (soundRef.current) playSound("checkin");
      setView("checkin");
      el()?.lockPanel(true);
      el()?.notchExpand();
    });
  }, [startTick]);

  const startBreak = useCallback(() => {
    setView("break");
    el()?.lockPanel(true);
    startTick(calcBreakSec(focusSec, GUIDES[guideIndex].tier), () => {
      if (soundRef.current) playSound("checkin");
      setView("checkin");
      el()?.lockPanel(true);
      el()?.notchExpand();
    });
  }, [startTick, focusSec, guideIndex]);

  const doCheckin = useCallback((key: CheckinKey) => {
    setCheckinKey(key);
    setLastCheckin(key);
    setStats((prev) => ({ ...prev, cycles: prev.cycles + 1, [key]: prev[key] + 1 }));
    el()?.saveSession({
      timestamp: new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).replace(" ", "T"),
      focusSec,
      breakSec: calcBreakSec(focusSec),
      checkin: key,
      guide: GUIDES[guideIndex].short,
    });
    setView("feedback");
  }, [focusSec, guideIndex]);

  const backToIdle = useCallback(() => {
    clearTimer();
    setPaused(false);
    el()?.lockPanel(false);
    setView("idle");
  }, [clearTimer]);

  useEffect(() => () => clearTimer(), [clearTimer]);

  const guide = GUIDES[guideIndex];
  const fb    = FEEDBACK[checkinKey];
  const elapsed = focusSec - remaining;

  // 버튼 스타일
  const btnCTA: React.CSSProperties = {
    ...SF, border: "none", borderRadius: 22,
    padding: "0 18px", height: 44, minWidth: 100,
    fontSize: 13, fontWeight: 700, cursor: "pointer",
    background: C.accent, color: "#000",
    WebkitAppRegion: "no-drag" as never,
    display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
    whiteSpace: "nowrap" as const, flexShrink: 0,
  };
  const btnGray: React.CSSProperties = { ...btnCTA, background: C.softBtn, color: C.ink };
  const btnCircle: React.CSSProperties = {
    border: "none", borderRadius: "50%", width: 44, height: 44,
    cursor: "pointer", background: C.softBtn, color: C.ink,
    WebkitAppRegion: "no-drag" as never,
    display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
  };

  // 상태 도트
  const dot = (color: string, pulse = false): React.CSSProperties => ({
    width: 6, height: 6, borderRadius: "50%", background: color,
    display: "inline-block", flexShrink: 0,
    ...(pulse ? { animation: "pulse-dot 1.4s ease infinite" } : {}),
  });

  const panelPadding = view === "idle" && showPicker ? "26px 24px 12px" : "26px 24px 14px";

  return (
    <div style={{ position: "fixed", inset: 0, WebkitAppRegion: "no-drag" as never }}>
      {panelVisible && <div style={{
        position: "absolute", inset: 0,
        background: "rgba(10,10,12,0.94)",
        backdropFilter: "saturate(160%) blur(32px)",
        WebkitBackdropFilter: "saturate(160%) blur(32px)" as never,
        borderRadius: 20,
        padding: panelPadding,
        display: "flex", flexDirection: "row", alignItems: "center", gap: 10,
        opacity: isExpanded ? 1 : 0,
        transform: isExpanded ? "translateY(0)" : "translateY(-8px)",
        transition: "opacity 0.22s ease, transform 0.22s ease",
        overflow: "hidden",
        pointerEvents: isExpanded ? "auto" : "none",
      }}>

        {/* ── 대기 화면 ── */}
        {view === "idle" && !showPicker && (<>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 5, overflow: "hidden" }}>
            {/* 상단 상태 행 */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, ...SF }}>
              <span style={dot(C.accent)} />
              <span style={{ fontSize: 12, fontWeight: 500, color: C.title }}>Recovery Pomo</span>
              {stats.cycles > 0 && (
                <span style={{ fontSize: 11, color: C.muted }}>· 오늘 {stats.cycles}회 완료</span>
              )}
            </div>
            {/* 타이머 */}
            <div style={{ fontSize: 44, fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1, color: C.timer, ...SF }}>
              {formatTime(focusSec)}
            </div>
            {/* 옵션 칩 */}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" as const }}>
              {FOCUS_OPTIONS.map((opt) => (
                <button key={opt.sec}
                  onClick={() => { setFocusSec(opt.sec); setRemaining(opt.sec); }}
                  style={{
                    ...SF, border: `1px solid ${focusSec === opt.sec ? C.accent : C.line}`,
                    background: focusSec === opt.sec ? "rgba(48,209,88,0.15)" : "transparent",
                    color: focusSec === opt.sec ? C.accent : C.muted,
                    borderRadius: 999, padding: "4px 12px",
                    fontSize: 11, fontWeight: 500, cursor: "pointer",
                    WebkitAppRegion: "no-drag" as never,
                  }}>{opt.label}</button>
              ))}
              <button
                onClick={() => { setPickerH(Math.floor(focusSec / 3600)); setPickerM(Math.floor((focusSec % 3600) / 60) || 25); setShowPicker(true); }}
                style={{
                  ...SF, border: `1px solid ${C.line}`, background: "transparent", color: C.muted,
                  borderRadius: 999, padding: "4px 12px",
                  fontSize: 11, fontWeight: 500, cursor: "pointer",
                  WebkitAppRegion: "no-drag" as never,
                }}>시간 설정</button>
            </div>
          </div>
          {/* 우측 CTA */}
          <button onClick={startFocus} style={btnCTA}>
            <PlayFilled size={14} /> 시작하기
          </button>
        </>)}

        {/* ── 시간 피커 ── */}
        {view === "idle" && showPicker && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 5, overflow: "hidden" }}>
            {/* 헤더 */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button onClick={() => setShowPicker(false)}
                style={{ background: "none", border: "none", cursor: "pointer", color: C.muted, WebkitAppRegion: "no-drag" as never, display: "flex", padding: 0 }}>
                <ChevronLeft size={18} />
              </button>
              <span style={{ ...SF, fontWeight: 600, fontSize: 13, color: C.ink }}>시간 설정</span>
            </div>
            {/* 스피너 + 적용 버튼 가로 배열 */}
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {/* 시 */}
              <div className="picker-col" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                <button className="caret-btn" onClick={() => setPickerH((v) => Math.min(5, v + 1))}
                  style={{ background: "none", border: "none", cursor: "pointer", color: C.muted, WebkitAppRegion: "no-drag" as never, display: "flex", padding: 2 }}>
                  <CaretUp size={14} />
                </button>
                <input type="number" min={0} max={5} value={pickerH}
                  onChange={(e) => setPickerH(Math.min(5, Math.max(0, parseInt(e.target.value) || 0)))}
                  style={{ width: 52, height: 44, background: C.softBtn, border: "none", borderRadius: 10,
                    fontFamily: "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif",
                    fontSize: 24, fontWeight: 700, textAlign: "center",
                    color: C.ink, outline: "none", WebkitAppRegion: "no-drag" as never }} />
                <button className="caret-btn" onClick={() => setPickerH((v) => Math.max(0, v - 1))}
                  style={{ background: "none", border: "none", cursor: "pointer", color: C.muted, WebkitAppRegion: "no-drag" as never, display: "flex", padding: 2 }}>
                  <CaretDown size={14} />
                </button>
                <span style={{ ...SF, fontSize: 10, color: C.muted, marginTop: 2 }}>시</span>
              </div>
              <span style={{ ...SF, fontSize: 22, fontWeight: 700, color: C.ink, marginBottom: 14 }}>:</span>
              {/* 분 */}
              <div className="picker-col" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                <button className="caret-btn" onClick={() => setPickerM((v) => Math.min(59, v + 1))}
                  style={{ background: "none", border: "none", cursor: "pointer", color: C.muted, WebkitAppRegion: "no-drag" as never, display: "flex", padding: 2 }}>
                  <CaretUp size={14} />
                </button>
                <input type="number" min={0} max={59} value={pickerM}
                  onChange={(e) => setPickerM(Math.min(59, Math.max(0, parseInt(e.target.value) || 0)))}
                  style={{ width: 52, height: 44, background: C.softBtn, border: "none", borderRadius: 10,
                    fontFamily: "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif",
                    fontSize: 24, fontWeight: 700, textAlign: "center",
                    color: C.ink, outline: "none", WebkitAppRegion: "no-drag" as never }} />
                <button className="caret-btn" onClick={() => setPickerM((v) => Math.max(0, v - 1))}
                  style={{ background: "none", border: "none", cursor: "pointer", color: C.muted, WebkitAppRegion: "no-drag" as never, display: "flex", padding: 2 }}>
                  <CaretDown size={14} />
                </button>
                <span style={{ ...SF, fontSize: 10, color: C.muted, marginTop: 2 }}>분</span>
              </div>
              {/* 적용 버튼 */}
              <button
                onClick={() => {
                  const total = pickerH * 3600 + pickerM * 60;
                  if (total > 0) { setFocusSec(total); setRemaining(total); }
                  setShowPicker(false);
                }}
                style={{ ...btnCTA, marginLeft: 8 }}>적용</button>
            </div>
          </div>
        )}

        {/* ── 집중 중 ── */}
        {view === "focus" && (<>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 5, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, ...SF }}>
              <span style={dot(C.red, true)} />
              <span style={{ fontSize: 12, fontWeight: 500, color: C.title }}>집중 중</span>
            </div>
            <div style={{ fontSize: 44, fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1, color: C.timer, ...SF }}>
              {formatTime(Math.max(0, remaining))}
            </div>
            <div style={{ fontSize: 12, color: C.muted, ...SF }}>
              {elapsed >= 60
                ? `집중 시작 ${Math.floor(elapsed / 60)}분째! 좋은 흐름이에요`
                : "한 가지에만 머물러 보세요."}
            </div>
          </div>
          {/* 우측 원형 버튼 2개 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <button onClick={backToIdle} style={btnCircle} title="집중 종료">
              <StopFilled size={20} />
            </button>
            <button onClick={() => setPaused((p) => !p)} style={btnCircle} title="일시정지">
              {paused ? <PlayFilled size={20} /> : <Pause size={20} />}
            </button>
          </div>
        </>)}

        {/* ── 집중 완료 ── */}
        {view === "complete" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6 }}>
            <CheckmarkFilled size={36} style={{ color: C.accent }} />
            <div style={{ fontSize: 16, fontWeight: 700, color: C.ink, ...SF }}>집중 완료</div>
            <div style={{ fontSize: 12, color: C.muted, ...SF }}>{formatTime(focusSec)}</div>
          </div>
        )}

        {/* ── 쉬는 안내 ── */}
        {view === "guide" && (<>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <guide.Icon size={40} style={{ color: C.accent, flexShrink: 0, animation: "breathe 3s ease-in-out infinite" }} />
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <span style={{ ...SF, fontSize: 11, fontWeight: 500, color: C.title }}>{guide.short}</span>
                <div style={{ fontSize: 14, fontWeight: 600, color: C.ink, lineHeight: 1.4, ...SF }}>
                  {guide.text}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11, color: C.subtext, ...SF }}>{formatTime(calcBreakSec(focusSec, guide.tier))} 휴식</span>
              <button onClick={() => setGuideIndex((i) => (i + 1) % GUIDES.length)}
                style={{ ...SF, background: "none", border: "none", color: C.muted, fontSize: 11, cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 3, WebkitAppRegion: "no-drag" as never, padding: 0 }}>
                다른 안내
              </button>
            </div>
          </div>
          <button onClick={startBreak} style={btnCTA}>휴식 시작</button>
        </>)}

        {/* ── 휴식 중 ── */}
        {view === "break" && (<>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 5, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, ...SF }}>
              <span style={dot(C.accent, true)} />
              <span style={{ fontSize: 12, fontWeight: 500, color: C.title }}>휴식 중</span>
            </div>
            <div style={{ fontSize: 44, fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1, color: C.timer, ...SF }}>
              {formatTime(Math.max(0, remaining))}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <guide.Icon size={12} style={{ color: C.subtext, flexShrink: 0, animation: "breathe 4s ease-in-out infinite" }} />
              <span style={{ fontSize: 12, color: C.subtext, ...SF }}>{guide.short}</span>
            </div>
          </div>
          <button onClick={() => { clearTimer(); setView("checkin"); el()?.notchExpand(); }} style={btnGray}>
            건너뛰기
          </button>
        </>)}

        {/* ── 체크인 ── */}
        {view === "checkin" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8, overflow: "hidden" }}>
            {!showExtend ? (<>
              <span style={{ ...SF, fontSize: 13, fontWeight: 600, color: C.ink }}>충분히 쉬었나요?</span>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => doCheckin("good")}
                  style={{ ...btnCTA, flex: 1, background: C.accent }}>
                  네, 준비됐어요
                </button>
                <button onClick={() => setShowExtend(true)}
                  style={{ ...btnGray, flex: 1 }}>
                  조금 더 쉴게요
                </button>
              </div>
            </>) : (<>
              <span style={{ ...SF, fontSize: 13, fontWeight: 600, color: C.ink }}>얼마나 더 쉬어요?</span>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => extendBreak(2 * 60)} style={{ ...btnGray, flex: 1 }}>+2분</button>
                <button onClick={() => extendBreak(5 * 60)} style={{ ...btnGray, flex: 1 }}>+5분</button>
                <button onClick={() => doCheckin("bad")}
                  style={{ ...SF, border: "none", background: "none", color: C.muted, fontSize: 11,
                    cursor: "pointer", WebkitAppRegion: "no-drag" as never, flexShrink: 0 }}>
                  그냥 넘어갈게요
                </button>
              </div>
            </>)}
          </div>
        )}

        {/* ── 피드백 ── */}
        {view === "feedback" && (<>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 5, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <fb.Icon size={28} style={{ color: fb.iconColor, flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: C.ink, ...SF }}>{fb.title}</div>
                <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.5, ...SF }}>{fb.body}</div>
              </div>
            </div>
          </div>
          <button onClick={backToIdle} style={btnCTA}>다음 집중 →</button>
        </>)}

      </div>}
    </div>
  );
}
