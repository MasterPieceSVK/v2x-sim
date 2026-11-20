"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { PRESETS, type Preset } from "./presets";
import s from "./Guide.module.css";

interface Props {
  onClose: () => void;
  onPreset: (p: Preset) => void;
}

interface Page {
  title: string;
  art: ReactNode;
  body: ReactNode;
}

/** A short, illustrated introduction for people who have never heard of V2X. */
export function Guide({ onClose, onPreset }: Props) {
  const [page, setPageState] = useState(0);
  const [focus, setFocus] = useState<number | null>(null); // spotlighted part on "Reading the screen"
  const setPage = (n: number) => {
    setPageState(n);
    setFocus(null);
  };
  const pages = PAGES(onPreset, onClose, focus, setFocus);
  const last = pages.length - 1;

  // Keyboard: Esc closes, arrows page. One listener (capture phase) that reads the latest state
  // from refs, so a key press is never lost to a re-render and does not reach the player behind.
  const state = useRef({ page, last, onClose });
  useEffect(() => {
    state.current = { page, last, onClose };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { page: p, last: l, onClose: close } = state.current;
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") setPage(Math.min(l, p + 1));
      else if (e.key === "ArrowLeft") setPage(Math.max(0, p - 1));
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const p = pages[page];
  return (
    <div className={s.backdrop} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={s.dialog} role="dialog" aria-label="Guide">
        <button className={s.close} onClick={onClose} aria-label="Close the guide">
          ✕
        </button>
        <div className={s.step}>
          {page + 1} / {pages.length}
        </div>
        <div className={s.art}>{p.art}</div>
        <h2>{p.title}</h2>
        <div className={s.body}>{p.body}</div>
        <div className={s.nav}>
          <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}>
            Back
          </button>
          <div className={s.dots}>
            {pages.map((_, i) => (
              <button
                key={i}
                className={i === page ? s.dotOn : s.dot}
                onClick={() => setPage(i)}
                aria-label={`Page ${i + 1}`}
              />
            ))}
          </div>
          {page < last ? (
            <button className="primary" onClick={() => setPage(page + 1)}>
              Next
            </button>
          ) : (
            <button className="primary" onClick={onClose}>
              Start exploring
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const PAGES = (
  onPreset: (p: Preset) => void,
  onClose: () => void,
  focus: number | null,
  setFocus: (n: number | null) => void,
): Page[] => {
  // Hovering (or focusing) a list item spotlights its part of the screen miniature.
  const item = (n: number, children: ReactNode) => (
    <li
      className={focus !== null && focus !== n ? s.dimmed : focus === n ? s.lit : undefined}
      tabIndex={0}
      onMouseEnter={() => setFocus(n)}
      onMouseLeave={() => setFocus(null)}
      onFocus={() => setFocus(n)}
      onBlur={() => setFocus(null)}
    >
      <span className={s.num}>{n}</span>
      <span>{children}</span>
    </li>
  );
  const tryPreset = (id: string, label: string, hint: string) => {
    const p = PRESETS.find((x) => x.id === id);
    if (!p) return null;
    return (
      <button
        className={s.tryCard}
        onClick={() => {
          onPreset(p);
          onClose();
        }}
      >
        <b>{label}</b>
        <span>{hint}</span>
      </button>
    );
  };

  return [
    {
      title: "Cars that talk to each other",
      art: <ArtTalk />,
      body: (
        <>
          <p>
            Connected cars send a tiny radio message several times per second: <b>where I am, how fast I go, and
            whether I brake</b>. It is called a <b>CAM</b> (Cooperative Awareness Message).
          </p>
          <p>Every car nearby receives it, even one that cannot see the sender, for example around a corner.</p>
        </>
      ),
    },
    {
      title: "A message is a snapshot, and it gets old",
      art: <ArtGhost />,
      body: (
        <>
          <p>
            Between two messages a car only knows where the other car <i>was</i>. It guesses the rest. In this app
            that guess is the <b>dashed “ghost” car</b>.
          </p>
          <p>
            At 50 km/h a car covers <b>14 m in one second</b>. Old or lost messages make the guess wrong, and wrong
            guesses lead to sudden braking or crashes.
          </p>
        </>
      ),
    },
    {
      title: "But the radio channel is a shared pipe",
      art: <ArtPipe />,
      body: (
        <>
          <p>
            All cars share <b>one radio channel</b>. Each message occupies it for about half a millisecond, so roughly{" "}
            <b>200 messages fit into every 0.1 s</b>.
          </p>
          <p>
            If many cars send very often, the pipe <b>overflows</b>: messages collide and get lost, and suddenly
            nobody knows where anybody is.
          </p>
        </>
      ),
    },
    {
      title: "Finding the sweet spot",
      art: <ArtCurve />,
      body: (
        <>
          <p>
            <b>Too few messages</b> means old information. <b>Too many</b> means an overloaded channel. The best rate
            in between depends on how busy the road is.
          </p>
          <p>
            The European standard (<b>ETSI</b>) adapts the rate on its own. This simulator measures how well each
            choice works.
          </p>
        </>
      ),
    },
    {
      title: "Reading the screen",
      art: <ArtScreen focus={focus} onFocus={setFocus} />,
      body: (
        <ol className={s.spotList}>
          {item(
            1,
            <>
              <b>Top bar</b>: play, pause and scrub through time; pick a scenario or a ready-made <b>preset</b>.
            </>,
          )}
          {item(
            2,
            <>
              <b>Map</b>: click a car to see what it knows and why it acts. Drag to move, scroll to zoom.
            </>,
          )}
          {item(
            3,
            <>
              <b>Side panel</b>: every crash and emergency brake, with a <b>Why?</b> button, plus the settings.
            </>,
          )}
          {item(
            4,
            <>
              <b>Packet tracer</b>: every message on a timeline. <span className={s.ok}>Green</span> = received,{" "}
              <span className={s.bad}>red</span> = lost.
            </>,
          )}
        </ol>
      ),
    },
    {
      title: "Try it yourself",
      art: <ArtTry />,
      body: (
        <div className={s.tries}>
          {tryPreset("lost-cam", "One lost message", "watch a car brake hard because a single CAM got lost")}
          {tryPreset("stale-platoon", "Messages too rare", "a column of cars crashes because news of braking arrives late")}
          {tryPreset("compare-platoon", "Too many messages", "side by side: 10 per second overloads the channel, ETSI does not")}
          <p className={s.hint}>
            Underlined words explain themselves when you hover them. You can reopen this guide with <b>?</b> in the
            top bar.
          </p>
        </div>
      ),
    },
  ];
};

// ---------------------------------------------------------------------------- illustrations
// Simple inline SVGs, coloured with the app's palette and lightly animated.

function Car({ x, y, color = "#4ea1ff", ghost = false }: { x: number; y: number; color?: string; ghost?: boolean }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      {ghost ? (
        <rect x={-22} y={-10} width={44} height={20} rx={6} fill="rgba(245,185,66,0.12)" stroke="#f5b942" strokeWidth={2} strokeDasharray="5 4" />
      ) : (
        <>
          <rect x={-21} y={-8} width={44} height={20} rx={6} fill="rgba(0,0,0,0.4)" />
          <rect x={-22} y={-10} width={44} height={20} rx={6} fill={color} />
          <rect x={6} y={-7} width={7} height={14} rx={2} fill="rgba(8,12,20,0.75)" />
          <rect x={-17} y={-6} width={5} height={12} rx={2} fill="rgba(8,12,20,0.75)" />
        </>
      )}
    </g>
  );
}

function Road({ y = 70 }: { y?: number }) {
  return (
    <>
      <rect x={0} y={y - 22} width={420} height={44} fill="#252b33" />
      <line x1={0} x2={420} y1={y - 21} y2={y - 21} stroke="#c8ccd2" strokeWidth={1.5} />
      <line x1={0} x2={420} y1={y + 21} y2={y + 21} stroke="#c8ccd2" strokeWidth={1.5} />
    </>
  );
}

function ArtTalk() {
  return (
    <svg viewBox="0 0 420 140" className={s.svg}>
      <Road />
      <Car x={110} y={70} />
      <Car x={320} y={70} color="#3ccf8e" />
      {[0, 1, 2].map((i) => (
        <circle key={i} cx={110} cy={70} r={20} className={s.wave} style={{ animationDelay: `${i * 0.6}s` }} />
      ))}
      <g className={s.bubble}>
        {/* text is ~178 px wide at 13 px; 206 px leaves ~14 px padding each side */}
        <rect x={122} y={8} width={206} height={34} rx={8} fill="#1b2130" stroke="#4ea1ff" />
        <text x={225} y={30} textAnchor="middle" className={s.svgText}>
          “I&apos;m here · 50 km/h · braking”
        </text>
      </g>
    </svg>
  );
}

function ArtGhost() {
  return (
    <svg viewBox="0 0 420 140" className={s.svg}>
      <Road />
      <Car x={170} y={70} ghost />
      <Car x={290} y={70} />
      <line x1={192} x2={268} y1={100} y2={100} stroke="#f5b942" strokeWidth={2} markerEnd="url(#arrow)" markerStart="url(#arrow)" />
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX={5} refY={5} markerWidth={6} markerHeight={6} orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" fill="#f5b942" />
        </marker>
      </defs>
      <text x={230} y={124} textAnchor="middle" className={s.svgText}>
        1 s old message → 14 m wrong
      </text>
      <text x={170} y={34} textAnchor="middle" className={s.svgMuted}>
        where it thinks the car is
      </text>
      <text x={290} y={34} textAnchor="middle" className={s.svgMuted}>
        where it really is
      </text>
    </svg>
  );
}

function ArtPipe() {
  const blocks = (n: number, y: number, overflow = 0) => (
    <>
      {/* 20 slots: 3 px padding + 20 × 15 px pitch (12 px block + 3 px gap) = 303 px wide */}
      <rect x={60} y={y} width={303} height={26} rx={5} fill="#0d1216" stroke="#8a94a6" />
      {Array.from({ length: n }, (_, i) => (
        <rect key={i} x={63 + i * 15} y={y + 3} width={12} height={20} rx={2} fill="#3ccf8e" className={s.block} style={{ animationDelay: `${i * 0.05}s` }} />
      ))}
      {Array.from({ length: overflow }, (_, i) => (
        <g key={i} transform={`translate(${371 + i * 15} ${y + 3})`}>
          <rect width={12} height={20} rx={2} fill="#ff5c5c" opacity={0.85} />
          <path d="M2 4l8 12M10 4l-8 12" stroke="#fff" strokeWidth={1.5} />
        </g>
      ))}
    </>
  );
  return (
    <svg viewBox="0 0 420 140" className={s.svg}>
      <text x={60} y={22} className={s.svgMuted}>
        light traffic: plenty of room
      </text>
      {blocks(6, 28)}
      <text x={60} y={82} className={s.svgMuted}>
        heavy traffic at 10 messages/s: full, the rest collides
      </text>
      {blocks(20, 88, 3)}
    </svg>
  );
}

function ArtCurve() {
  return (
    <svg viewBox="0 0 420 150" className={s.svg}>
      <line x1={50} x2={390} y1={120} y2={120} stroke="#3a4250" />
      <line x1={50} x2={50} y1={14} y2={120} stroke="#3a4250" />
      <text x={220} y={142} textAnchor="middle" className={s.svgMuted}>
        messages per second →
      </text>
      <text x={18} y={68} textAnchor="middle" className={s.svgMuted} transform="rotate(-90 18 68)">
        accidents
      </text>
      <path d="M60 30 C 130 100, 180 112, 220 110 S 330 80, 380 22" fill="none" stroke="#4ea1ff" strokeWidth={3} className={s.draw} />
      <circle cx={220} cy={110} r={6} fill="#3ccf8e" />
      <text x={220} y={94} textAnchor="middle" className={s.svgText}>
        sweet spot
      </text>
      <text x={74} y={24} className={s.svgBad}>
        too rare: old info
      </text>
      {/* Ends left of the steep right branch of the curve, above its low part, so it never crosses the line. */}
      <text x={336} y={30} textAnchor="end" className={s.svgBad}>
        too many: channel full
      </text>
    </svg>
  );
}

/** A miniature of the real interface with numbered callouts matching the list below it. */
/** The four parts of the miniature, in its own coordinates (viewBox 420 × 236). */
const SCREEN_REGIONS: Record<number, { x: number; y: number; w: number; h: number }> = {
  1: { x: 10, y: 8, w: 400, h: 37 },
  2: { x: 10, y: 46, w: 302, h: 110 },
  3: { x: 316, y: 46, w: 94, h: 110 },
  4: { x: 10, y: 160, w: 400, h: 68 },
};

function ArtScreen({ focus, onFocus }: { focus: number | null; onFocus: (n: number | null) => void }) {
  // Callouts are drawn in an annotation colour the app itself never uses, with a soft glow.
  const tag = (n: number, x: number, y: number) => (
    <g
      transform={`translate(${x} ${y})`}
      className={s.callout}
      onMouseEnter={() => onFocus(n)}
      onMouseLeave={() => onFocus(null)}
    >
      <circle r={13} className={s.calloutGlow} />
      <circle r={9} className={s.calloutDot} />
      <text y={3.6} textAnchor="middle" className={s.calloutText}>
        {n}
      </text>
    </g>
  );
  const r = focus !== null ? SCREEN_REGIONS[focus] : null;
  const pill = (x: number, y: number, w: number, label: string, on = false) => (
    <g>
      <rect x={x} y={y} width={w} height={9} rx={2.5} fill={on ? "rgba(78,161,255,0.18)" : "#1b2130"} stroke={on ? "#4ea1ff" : "#2f3744"} strokeWidth={0.6} />
      <text x={x + w / 2} y={y + 6.4} textAnchor="middle" className={s.mini}>
        {label}
      </text>
    </g>
  );
  const car = (x: number, y: number, color: string, vertical = false) =>
    vertical ? <rect x={x} y={y} width={5} height={10} rx={1.5} fill={color} /> : <rect x={x} y={y} width={10} height={5} rx={1.5} fill={color} />;

  return (
    <svg viewBox="0 0 420 236" className={s.svg}>
      {/* window */}
      <rect x={6} y={4} width={408} height={228} rx={6} fill="#0b0e13" stroke="#2f3744" />

      {/* 1 — top bar */}
      <rect x={10} y={8} width={400} height={18} rx={3} fill="#12161d" />
      <circle cx={19} cy={17} r={2} fill="#4ea1ff" />
      <path d="M15.5 13.5a5 5 0 0 0 0 7M22.5 13.5a5 5 0 0 1 0 7" fill="none" stroke="#4ea1ff" strokeWidth={1} strokeLinecap="round" />
      {pill(28, 12.5, 44, "Intersection")}
      {pill(76, 12.5, 32, "★ Presets")}
      <rect x={150} y={10.5} width={112} height={13} rx={6.5} fill="#0b0e13" stroke="#2f3744" strokeWidth={0.6} />
      <path d="M160 14.5v6M166 14.5l-3.5 3 3.5 3z" fill="#8a94a6" stroke="#8a94a6" strokeWidth={0.6} />
      <circle cx={179} cy={17} r={5.5} fill="#4ea1ff" />
      <path d="M177.4 14.4l4.3 2.6-4.3 2.6z" fill="#06101d" />
      <path d="M190 14.5l3.5 2.5-3.5 2.5z" fill="#8a94a6" />
      <text x={200} y={19.4} className={s.miniStrong}>
        12.40
      </text>
      <text x={221} y={19.4} className={s.mini}>
        / 120 s
      </text>
      <rect x={200} y={21} width={50} height={1} fill="#2f3744" />
      <rect x={200} y={21} width={6} height={1} fill="#4ea1ff" />
      {pill(298, 12.5, 34, "Compare")}
      {pill(335, 12.5, 26, "Guide")}
      {pill(364, 12.5, 30, "Results")}
      {/* metrics strip */}
      {[
        ["SAFETY", 12, ["0", "2", "1"]],
        ["INFORMATION", 92, ["250", "96%"]],
        ["CHANNEL", 152, ["84%", "18%"]],
      ].map(([title, x, vals]) => (
        <g key={title as string}>
          <text x={(x as number) + 2} y={33} className={s.miniAccent}>
            {title as string}
          </text>
          {(vals as string[]).map((v, i) => (
            <text key={i} x={(x as number) + 2 + i * 24} y={41} className={s.miniValue}>
              {v}
            </text>
          ))}
        </g>
      ))}

      {/* 2 — map */}
      <rect x={10} y={46} width={302} height={110} fill="#0d1216" />
      <rect x={10} y={95} width={302} height={14} fill="#252b33" />
      <rect x={160} y={46} width={14} height={110} fill="#252b33" />
      <line x1={10} x2={160} y1={102} y2={102} stroke="#d6a72c" strokeWidth={0.5} strokeDasharray="3 3" />
      <line x1={174} x2={312} y1={102} y2={102} stroke="#d6a72c" strokeWidth={0.5} strokeDasharray="3 3" />
      <line x1={167} x2={167} y1={46} y2={95} stroke="#d6a72c" strokeWidth={0.5} strokeDasharray="3 3" />
      <line x1={167} x2={167} y1={109} y2={156} stroke="#d6a72c" strokeWidth={0.5} strokeDasharray="3 3" />
      {/* ghost of where the selected car thinks car 8 is */}
      <rect x={108} y={103} width={10} height={5} rx={1.5} fill="rgba(245,185,66,0.15)" stroke="#f5b942" strokeWidth={0.7} strokeDasharray="1.5 1" />
      <line x1={118} x2={129} y1={105.5} y2={105.5} stroke="#f5b942" strokeWidth={0.6} />
      {car(129, 103, "#4ea1ff")}
      {car(60, 103, "#4ea1ff")}
      {car(230, 96.5, "#3ccf8e")}
      {car(168.5, 66, "#f5b942", true)}
      {car(161.5, 128, "#ff5c5c", true)}
      <rect x={160} y={126} width={9} height={14} rx={2} fill="none" stroke="#fff" strokeWidth={0.8} />
      {/* selected-car card */}
      <rect x={14} y={50} width={70} height={36} rx={3} fill="#12161d" stroke="#2f3744" strokeWidth={0.6} />
      <text x={18} y={57.5} className={s.miniStrong}>
        car12
      </text>
      <rect x={38} y={53} width={34} height={6} rx={3} fill="#ff5c5c" />
      <text x={55} y={57.4} textAnchor="middle" className={s.miniDark}>
        braking
      </text>
      <rect x={18} y={63} width={60} height={2} rx={1} fill="#3a4250" />
      <rect x={18} y={68} width={46} height={2} rx={1} fill="#3a4250" />
      <rect x={18} y={74} width={60} height={2} rx={1} fill="#2a313c" />
      <rect x={18} y={79} width={52} height={2} rx={1} fill="#2a313c" />
      {/* layers box + channel bar */}
      <rect x={262} y={50} width={46} height={22} rx={3} fill="#12161d" stroke="#2f3744" strokeWidth={0.6} />
      {[55, 60, 65].map((y) => (
        <g key={y}>
          <rect x={266} y={y - 2.5} width={3} height={3} rx={0.6} fill="#4ea1ff" />
          <rect x={272} y={y - 1.5} width={30} height={1.6} rx={0.8} fill="#3a4250" />
        </g>
      ))}
      <rect x={244} y={143} width={64} height={9} rx={2.5} fill="#12161d" stroke="#2f3744" strokeWidth={0.6} />
      <text x={248} y={149.4} className={s.mini}>
        CHANNEL
      </text>
      <rect x={275} y={145.5} width={20} height={4} rx={1} fill="#0b0e13" stroke="#8a94a6" strokeWidth={0.4} />
      <rect x={275.5} y={146} width={7.5} height={3} fill="#3ccf8e" />
      <text x={297.5} y={149.4} className={s.miniOk}>
        18%
      </text>

      {/* 3 — side panel */}
      <rect x={316} y={46} width={94} height={110} fill="#12161d" />
      <text x={322} y={55} className={s.miniStrong}>
        Events
      </text>
      <circle cx={345} cy={53} r={3.2} fill="#ff5c5c" />
      <text x={345} y={54.6} textAnchor="middle" className={s.miniBadge}>
        3
      </text>
      <text x={356} y={55} className={s.mini}>
        Settings
      </text>
      <rect x={320} y={57.5} width={30} height={0.9} fill="#4ea1ff" />
      {[
        ["#ff5c5c", "Collision"],
        ["#ff8a4c", "Emerg. brake"],
        ["#f5b942", "Near-miss"],
        ["#ff8a4c", "Emerg. brake"],
      ].map(([c, label], i) => (
        <g key={i} transform={`translate(0 ${66 + i * 13})`}>
          <circle cx={324} cy={0} r={2} fill={c} />
          <text x={329} y={2} className={s.mini}>
            {label}
          </text>
          <rect x={385} y={-3.6} width={20} height={7.2} rx={3.6} fill={i === 0 ? "#4ea1ff" : "none"} stroke="#4ea1ff" strokeWidth={0.6} />
          <text x={395} y={1.6} textAnchor="middle" className={i === 0 ? s.miniDark : s.miniAccent}>
            Why?
          </text>
        </g>
      ))}
      <rect x={320} y={118} width={86} height={32} rx={3} fill="#0b0e13" stroke="#4ea1ff" strokeWidth={0.5} />
      {[124, 130, 136, 142].map((y, i) => (
        <rect key={y} x={324} y={y} width={[72, 64, 70, 50][i]} height={2} rx={1} fill={i === 3 ? "#ff5c5c" : "#3a4250"} />
      ))}

      {/* 4 — packet tracer */}
      <rect x={10} y={160} width={400} height={68} fill="#12161d" />
      <text x={14} y={167} className={s.miniStrong}>
        PACKET TRACER
      </text>
      {pill(62, 161.5, 22, "CAM", true)}
      {pill(87, 161.5, 26, "DENM", true)}
      <rect x={52} y={171} width={354} height={7} fill="#1a1f26" />
      <path d="M52 176 L120 175.5 L180 173.5 L240 172.5 L300 174 L406 175" fill="none" stroke="#3ccf8e" strokeWidth={0.8} />
      {[0, 1, 2].map((r) => (
        <g key={r}>
          <text x={14} y={185 + r * 7} className={s.mini}>
            car{r + 1}
          </text>
          {Array.from({ length: 34 }, (_, i) => (
            <rect
              key={i}
              x={54 + i * 10.3 + r * 3}
              y={181 + r * 7}
              width={2}
              height={4.5}
              fill={(i * 3 + r * 5) % 11 === 4 ? "#ff5c5c" : (i * 7 + r) % 13 === 2 ? "#f5b942" : "#3ccf8e"}
            />
          ))}
        </g>
      ))}
      <line x1={250} x2={250} y1={171} y2={202} stroke="#e8ecf2" strokeWidth={0.8} />
      {/* list + inspector */}
      {[206, 211, 216, 221].map((y, i) => (
        <g key={y}>
          <rect x={14} y={y} width={40} height={2} rx={1} fill="#3a4250" />
          <rect x={60} y={y} width={30} height={2} rx={1} fill="#3a4250" />
          <rect x={96} y={y} width={22} height={2} rx={1} fill={i === 1 ? "#ff5c5c" : "#3ccf8e"} />
        </g>
      ))}
      <rect x={180} y={204} width={226} height={22} rx={2} fill="#0b0e13" />
      {["Summary", "Layers", "Bits"].map((l, i) => (
        <g key={l}>{pill(330 + i * 26 - (i === 0 ? 6 : 0), 206, i === 0 ? 30 : 22, l, i === 2)}</g>
      ))}
      {Array.from({ length: 30 }, (_, i) => (
        <rect key={i} x={184 + i * 4.6} y={217} width={3.6} height={5} rx={0.6} fill={i >= 9 && i <= 13 ? "#e8ecf2" : i < 6 ? "#4ea1ff" : i < 18 ? "#b48cff" : "#f5b942"} opacity={0.85} />
      ))}

      {/* hover areas for the four parts */}
      {Object.entries(SCREEN_REGIONS).map(([n, g]) => (
        <rect
          key={n}
          x={g.x}
          y={g.y}
          width={g.w}
          height={g.h}
          fill="transparent"
          onMouseEnter={() => onFocus(Number(n))}
          onMouseLeave={() => onFocus(null)}
        />
      ))}

      {/* spotlight: dim everything except the focused part, and outline it */}
      <path
        className={s.spotDim}
        style={{ opacity: r ? 1 : 0 }}
        fillRule="evenodd"
        d={`M0 0H420V236H0Z${r ? `M${r.x} ${r.y}h${r.w}v${r.h}h${-r.w}Z` : ""}`}
      />
      {r && <rect x={r.x - 1} y={r.y - 1} width={r.w + 2} height={r.h + 2} rx={3} className={s.spotRing} />}

      {tag(1, 140, 17)}
      {tag(2, 200, 130)}
      {tag(3, 398, 51)}
      {tag(4, 128, 165)}
    </svg>
  );
}

function ArtTry() {
  return (
    <svg viewBox="0 0 420 110" className={s.svg}>
      <Road y={55} />
      <Car x={90} y={55} />
      <Car x={170} y={55} color="#ff5c5c" />
      <Car x={250} y={55} color="#f5b942" />
      <Car x={330} y={55} color="#3ccf8e" />
      <circle cx={330} cy={55} r={20} className={s.wave} />
    </svg>
  );
}
