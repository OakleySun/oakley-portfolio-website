import React, { useEffect, useMemo, useRef, useState, useLayoutEffect } from "react";

/** ===== Tunables (unchanged) ===== */
const ROWS_VISIBLE = 13;          // visible rows per column
const SCROLL_SECONDS = 8;         // time for one full pass of the visible band
const TEXT = "oakley sun.";
const BASE_RADIUS = 160;
const MAX_PUSH_PX = 240;
const AFFECTED_PER_WORD = 2;
const COOLDOWN_MS = 60;

const OUT_MS = 420;
const PAUSE_MS = 180;
const MID_MS = 320;
const BACK_MS = 720;
const OVERSHOOT = 0.2;

function makeRows(n) {
  return Array.from({ length: n }, (_, i) => i);
}

export default function OakleyTripleScroller() {
  const gridRef = useRef(null);

  // Column wrappers (visible band areas)
  const leftColRef = useRef(null);
  const centerColRef = useRef(null);
  const rightColRef = useRef(null);

  // Each column uses TWO clones (A/B) that tile seamlessly
  const leftARef = useRef(null),   leftBRef = useRef(null);
  const centerARef = useRef(null), centerBRef = useRef(null);
  const rightARef = useRef(null),  rightBRef = useRef(null);

  const [isPhone, setIsPhone] = useState(
    () => (typeof window !== "undefined" ? window.innerWidth <= 640 : false)
  );
  const [colScale, setColScale] = useState({ left: 1, center: 1, right: 1 });

  // Exactly one band worth of rows per clone
  const rows = useMemo(() => makeRows(ROWS_VISIBLE), []);

  // Letter interaction state
  const mouse = useRef({ x: -9999, y: -9999, inside: false });

  // Global per-letter state mirrored across both clones in a column
  // key: `${colId}|${rowIndex}|${charIndex}` -> { animating:boolean, coolUntil:number }
  const letterStateRef = useRef(new Map());

  // Epoch used to compute phase from wall-clock (never “restarts” visually)
  const epochRef = useRef(0);

  // Fit a word to the column width (keeps your word size behavior unchanged)
  const fitColumn = (colEl, which) => {
    if (!colEl) return;
    const word = colEl.querySelector(".oak-word");
    if (!word) return;
    word.style.transform = "scale(1)";
    const colWidth = colEl.clientWidth;
    const natural = word.scrollWidth || 1;
    const scale = colWidth / natural;
    setColScale((s) => ({ ...s, [which]: scale }));
  };

  /** Initial layout before paint */
  useLayoutEffect(() => {
    if (leftColRef.current)  fitColumn(leftColRef.current, "left");
    if (centerColRef.current)fitColumn(centerColRef.current, "center");
    if (rightColRef.current) fitColumn(rightColRef.current, "right");
  }, []);

  /** Handle resize; only toggle grid layout when truly crossing breakpoint */
  useEffect(() => {
    const onResize = () => {
      const next = window.innerWidth <= 640;
      setIsPhone(prev => (prev !== next ? next : prev));
      requestAnimationFrame(() => {
        if (leftColRef.current)  fitColumn(leftColRef.current, "left");
        if (centerColRef.current)fitColumn(centerColRef.current, "center");
        if (rightColRef.current) fitColumn(rightColRef.current, "right");
      });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  /** Mouse tracking (scoped leave) */
  useEffect(() => {
    const onMove = (e) => {
      mouse.current.inside = true;
      mouse.current.x = e.clientX;
      mouse.current.y = e.clientY;
    };
    const onLeave = () => {
      mouse.current.inside = false;
      resetAllLetters(true);
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    const grid = gridRef.current;
    grid?.addEventListener("mouseleave", onLeave);
    return () => {
      window.removeEventListener("mousemove", onMove);
      grid?.removeEventListener("mouseleave", onLeave);
    };
  }, []);

  /** Letter dodge/bounce loop */
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      if (mouse.current.inside) {
        const gw = gridRef.current?.clientWidth || 1000;
        const effRadius = Math.max(
          BASE_RADIUS,
          Math.max(24, Math.floor(gw / (isPhone ? 6 : 20)))
        );
        const target =
          getWordUnderCursor(mouse.current.x, mouse.current.y) ||
          getNearestWordWithinRadius(mouse.current.x, mouse.current.y, effRadius * 1.1);
        if (target) {
          const picks = pickClosestInWord(target, mouse.current.x, mouse.current.y, effRadius, AFFECTED_PER_WORD);
          const now = Date.now();
          for (const el of picks) {
            if (!el) continue;
            const key = letterKey(el);
            const state = letterStateRef.current.get(key) || { animating: false, coolUntil: 0 };
            if (state.animating) continue;
            if (state.coolUntil && now < state.coolUntil) continue;
            triggerSequenceMirrored(key, effRadius);
            letterStateRef.current.set(key, { animating: true, coolUntil: now + COOLDOWN_MS });
          }
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [isPhone]);

  /** ===== Dual-clone, wall-clock, percent-based infinite scroll (no jumps) ===== */
  useEffect(() => {
    const start = () => { if (!epochRef.current) epochRef.current = Date.now(); };
    if (document?.fonts?.ready && document.fonts.ready.then) {
      document.fonts.ready.then(start);
    } else {
      start();
    }

    let raf = 0;
    const durMs = Math.max(1, SCROLL_SECONDS * 1000);

    const step = () => {
      const t0 = epochRef.current || Date.now();
      const t = Date.now() - t0;
      const p = ((t % durMs) / durMs) * 100; // 0..100 (% of band)

      // Helpers to place the two clones seamlessly
      const placeUp = (A, B) => {
        if (!A || !B) return;
        const yA = -p;         //  0 -> -100
        const yB = yA + 100;   // 100 ->   0 (adjacent)
        A.style.transform = `translate3d(0, ${yA.toFixed(3)}%, 0)`;
        B.style.transform = `translate3d(0, ${yB.toFixed(3)}%, 0)`;
      };
      const placeDown = (A, B) => {
        if (!A || !B) return;
        const yB = p;          //  0 -> 100
        const yA = yB - 100;   // -100 -> 0
        A.style.transform = `translate3d(0, ${yA.toFixed(3)}%, 0)`;
        B.style.transform = `translate3d(0, ${yB.toFixed(3)}%, 0)`;
      };

      // Left & Right scroll DOWN; Center scrolls UP
      placeDown(leftARef.current, leftBRef.current);
      placeUp(centerARef.current, centerBRef.current);
      placeDown(rightARef.current, rightBRef.current);

      raf = requestAnimationFrame(step);
    };

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);

  /** ===== Helpers ===== */

  // Build a stable key for a letter: `${colId}|${rowIndex}|${charIndex}`
  function letterKey(el) {
    const letter = el.closest(".oak-ch");
    const row = el.closest(".oak-row");
    const col = el.closest(".oak-col");
    const colId = col?.getAttribute("data-col") || "center";
    const rowIndex = row?.getAttribute("data-row");
    const charIndex = letter?.getAttribute("data-char");
    return `${colId}|${rowIndex}|${charIndex}`;
  }

  // Apply transform to ALL clones of the same letter key in the same column
  function applyToMirrors(key, fn) {
    const [colId, rowIndex, charIndex] = key.split("|");
    const selector = `.oak-col[data-col="${colId}"] .oak-ch[data-row="${rowIndex}"][data-char="${charIndex}"]`;
    const nodes = Array.from(document.querySelectorAll(selector));
    for (const n of nodes) fn(n);
  }

  function triggerSequenceMirrored(key, radius) {
    // compute push direction for the *specific* element under cursor (closest of the mirrors)
    const [colId, rowIndex, charIndex] = key.split("|");
    const selector = `.oak-col[data-col="${colId}"] .oak-ch[data-row="${rowIndex}"][data-char="${charIndex}"]`;
    const nodes = Array.from(document.querySelectorAll(selector));
    if (nodes.length === 0) return;

    // pick the one closest to cursor to compute angle/push
    let best = nodes[0], bestD = Infinity;
    for (const el of nodes) {
      const r = el.getBoundingClientRect();
      const cx = (r.left + r.right) / 2;
      const cy = (r.top + r.bottom) / 2;
      const d = Math.hypot(cx - mouse.current.x, cy - mouse.current.y);
      if (d < bestD) { bestD = d; best = el; }
    }

    const gridEl = gridRef.current;
    const r = best.getBoundingClientRect();
    const cx = (r.left + r.right) / 2;
    const cy = (r.top + r.bottom) / 2;
    const dx = cx - mouse.current.x;
    const dy = cy - mouse.current.y;
    const dist = Math.max(1, Math.hypot(dx, dy));
    const proximity = Math.max(0, 1 - dist / radius);

    const maxPush = Math.min(
      MAX_PUSH_PX,
      Math.max(24, (gridEl?.clientWidth || 1000) / (isPhone ? 10 : 30))
    );
    const push = maxPush * (0.4 + 0.6 * proximity);

    const angle = Math.random() * Math.PI * 2;
    const x = Math.cos(angle) * push;
    const y = Math.sin(angle) * push;

    // Start animation on all mirrors with identical key
    applyToMirrors(key, (el) => {
      el.style.transition = `transform ${OUT_MS}ms cubic-bezier(.25,.9,.35,1)`;
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    });

    // small pause, then overshoot, then return, all mirrored
    setTimeout(() => {
      applyToMirrors(key, (el) => {
        el.style.transition = `transform 1ms linear`;
        el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      });

      setTimeout(() => {
        const bx = (-x * OVERSHOOT).toFixed(1);
        const by = (-y * OVERSHOOT).toFixed(1);
        applyToMirrors(key, (el) => {
          el.style.transition = `transform ${MID_MS}ms cubic-bezier(.3,1.05,.4,1)`;
          el.style.transform = `translate3d(${bx}px, ${by}px, 0)`;
        });

        setTimeout(() => {
          applyToMirrors(key, (el) => {
            el.style.transition = `transform ${BACK_MS}ms cubic-bezier(.2,1,.3,1)`;
            el.style.transform = `translate3d(0, 0, 0)`;
          });
          // clear animating flag slightly after finishing
          setTimeout(() => {
            const now = Date.now();
            const state = letterStateRef.current.get(key) || {};
            letterStateRef.current.set(key, { animating: false, coolUntil: now + COOLDOWN_MS });
          }, BACK_MS + 20);
        }, MID_MS);
      }, PAUSE_MS);
    }, OUT_MS);
  }

  function resetAllLetters(withBounce = false) {
    // Reset every visible letter in all columns/clones
    const nodes = Array.from(document.querySelectorAll(".oak-ch"));
    for (const el of nodes) {
      const current = el.style.transform || "";
      if (withBounce && current && current !== "translate3d(0, 0, 0)") {
        const m = current.match(/translate3d\(([-\d\.]+)px,\s*([-\d\.]+)px/);
        const ox = m ? parseFloat(m[1]) : 0;
        const oy = m ? parseFloat(m[2]) : 0;
        const bx = (-ox * OVERSHOOT).toFixed(1);
        const by = (-oy * OVERSHOOT).toFixed(1);
        el.style.transition = `transform 280ms cubic-bezier(.3,1.4,.4,1)`;
        el.style.transform = `translate3d(${bx}px, ${by}px, 0)`;
        setTimeout(() => {
          el.style.transition = `transform 520ms cubic-bezier(.22,1.2,.36,1)`;
          el.style.transform = `translate3d(0, 0, 0)`;
        }, 280);
      } else {
        el.style.transition = `transform 420ms cubic-bezier(.22,1.2,.36,1)`;
        el.style.transform = `translate3d(0, 0, 0)`;
      }
    }
    // clear state map
    letterStateRef.current.clear();
  }

  function getWordUnderCursor(x, y) {
    if (!document || typeof document.elementsFromPoint !== "function")
      return getNearestWordWithinRadius(x, y, BASE_RADIUS);
    const elems = document.elementsFromPoint(x, y);
    for (const el of elems) {
      const word = el.closest && el.closest(".oak-word");
      if (word) return word;
    }
    return null;
  }

  function getNearestWordWithinRadius(x, y, radius) {
    const words = Array.from(document.querySelectorAll(".oak-word"));
    let best = null, bestD = Infinity;
    for (const w of words) {
      const r = w.getBoundingClientRect();
      const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
      const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
      const d = Math.hypot(dx, dy);
      if (d < bestD) { bestD = d; best = w; }
    }
    return bestD <= radius ? best : null;
  }

  function pickClosestInWord(wordEl, x, y, radius, n) {
    const letters = Array.from(wordEl.querySelectorAll('.oak-ch'));
    const ranked = letters
      .map((el) => {
        const r = el.getBoundingClientRect();
        const cx = (r.left + r.right) / 2;
        const cy = (r.top + r.bottom) / 2;
        const d = Math.hypot(cx - x, cy - y);
        return { el, d };
      })
      .sort((a, b) => a.d - b.d);
    return ranked.filter(it => it.d <= radius).slice(0, n).map(it => it.el);
  }

  /** One “band” of content (used twice per column as A and B) */
  const Band = ({ scale, colId }) => (
    <div className="w-full h-full">
      {rows.map((r) => (
        <div
          key={r}
          className="oak-row row flex items-center justify-center"
          data-row={r}
          style={{ height: `${100 / ROWS_VISIBLE}%` }}
        >
          <div style={{ transform: `scale(${scale})`, transformOrigin: "center center" }}>
            <span className="oak-word inline-block select-none whitespace-nowrap will-change-transform" style={{ transform: "scale(1)" }}>
              {Array.from(TEXT).map((ch, i) => (
                <span
                  key={i}
                  className="oak-ch inline-block will-change-transform"
                  data-row={r}
                  data-char={i}
                  style={{ transform: "translate3d(0,0,0)", position: "relative", zIndex: 10 }}
                >
                  {ch === " " ? "\u00A0" : ch}
                </span>
              ))}
            </span>
          </div>
        </div>
      ))}
    </div>
  );

  const Column = React.forwardRef(({ dir, scale, colId, ARef, BRef }, ref) => (
    <div
      className="oak-col col relative text-white font-black text-center overflow-visible z-[1]"
      data-col={colId}
      ref={ref}
    >
      {/* Clone A */}
      <div ref={ARef} className="clone absolute inset-x-0 top-0 w-full h-full will-change-transform pointer-events-none">
        <Band scale={scale} colId={colId} />
      </div>
      {/* Clone B (second tile) */}
      <div ref={BRef} className="clone absolute inset-x-0 top-0 w-full h-full will-change-transform pointer-events-none">
        <Band scale={scale} colId={colId} />
      </div>
    </div>
  ));
  Column.displayName = "Column";

  return (
    <div className="fixed inset-0 overflow-hidden bg-black" ref={gridRef}>
      {/* Top/Bottom fades */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[18vh]" style={{ background: "linear-gradient(to bottom, #000 0%, rgba(0,0,0,0) 75%)", zIndex: 5 }} />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[18vh]" style={{ background: "linear-gradient(to top, #000 0%, rgba(0,0,0,0) 75%)", zIndex: 5 }} />

      {/* Grid — allow overlap across columns, but page itself never scrolls */}
      <div className={`grid h-full ${isPhone ? "grid-cols-1" : "grid-cols-3"} gap-0 overflow-visible`}>
        {!isPhone && (
          <Column
            dir="down"
            scale={colScale.left}
            colId="left"
            ref={leftColRef}
            ARef={leftARef}
            BRef={leftBRef}
          />
        )}
        <Column
          dir="up"
          scale={colScale.center}
          colId="center"
          ref={centerColRef}
          ARef={centerARef}
          BRef={centerBRef}
        />
        {!isPhone && (
          <Column
            dir="down"
            scale={colScale.right}
            colId="right"
            ref={rightColRef}
            ARef={rightARef}
            BRef={rightBRef}
          />
        )}
      </div>

      {/* Global no-scroll + tidy scrollbar hiding */}
      <style>{`
        html, body, #root { height: 100%; overflow: hidden; margin: 0; padding: 0; }
        /* Optional: hide webkit scrollbars just in case */
        *::-webkit-scrollbar { width: 0px; height: 0px; }
        .col { color: #fff; font-family: 'Arial Black', system-ui, sans-serif; font-weight: 900; line-height: 0.1; user-select: none; }
        .oak-ch { user-select: none; position: relative; z-index: 10; will-change: transform; }
        .clone { /* each clone is exactly one band */ }
      `}</style>
    </div>
  );
}
