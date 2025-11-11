import React, { useEffect, useMemo, useRef, useState } from "react";

// ===== Tunables =====
const ROWS_VISIBLE = 23; // decreased by 1
const SCROLL_SECONDS = 8;
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

function makeRows(count) {
  return Array.from({ length: count }, (_, i) => i);
}

export default function OakleyTripleScroller() {
  const gridRef = useRef(null);
  const leftRef = useRef(null);
  const centerRef = useRef(null);
  const rightRef = useRef(null);
  const [isPhone, setIsPhone] = useState(() => (typeof window !== "undefined" ? window.innerWidth <= 640 : false));
  const [colScale, setColScale] = useState({ left: 1, center: 1, right: 1 });
  const rows = useMemo(() => makeRows(ROWS_VISIBLE * 2), []);

  const mouse = useRef({ x: -9999, y: -9999, inside: false });
  const lettersRef = useRef([]);
  const rAF = useRef(null);

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

  useEffect(() => {
    const onResize = () => {
      setIsPhone(window.innerWidth <= 640);
      requestAnimationFrame(() => {
        if (leftRef.current) fitColumn(leftRef.current, "left");
        if (centerRef.current) fitColumn(centerRef.current, "center");
        if (rightRef.current) fitColumn(rightRef.current, "right");
      });
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const collect = () => {
      const nodes = Array.from((gridRef.current && gridRef.current.querySelectorAll(".oak-ch")) || []);
      lettersRef.current = nodes;
      for (const el of nodes) {
        el.style.transition = "none";
        el.style.transform = "translate3d(0,0,0)";
        el._animating = false;
        el._coolUntil = 0;
      }
    };
    collect();
    const t = setTimeout(collect, 50);
    return () => clearTimeout(t);
  }, [isPhone, colScale.left, colScale.center, colScale.right]);

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
    window.addEventListener("mouseleave", onLeave);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseleave", onLeave);
    };
  }, []);

  useEffect(() => {
    const loop = () => {
      if (mouse.current.inside && lettersRef.current.length) {
        const gridWidth = (gridRef.current && gridRef.current.clientWidth) || 1000;
        const effRadius = Math.max(
          BASE_RADIUS,
          Math.max(24, Math.floor(gridWidth / (isPhone ? 6 : 20)))
        );
        let targetWord = getWordUnderCursor(mouse.current.x, mouse.current.y) ||
          getNearestWordWithinRadius(mouse.current.x, mouse.current.y, effRadius * 1.1);
        if (targetWord) {
          const picks = pickClosestInWord(targetWord, mouse.current.x, mouse.current.y, effRadius, AFFECTED_PER_WORD);
          const now = Date.now();
          for (const el of picks) {
            if (!el) continue;
            if (el._animating) continue;
            if (el._coolUntil && now < el._coolUntil) continue;
            triggerSequenceRandom(el, effRadius, isPhone, gridRef.current);
            el._coolUntil = now + COOLDOWN_MS;
          }
        }
      }
      rAF.current = requestAnimationFrame(loop);
    };
    rAF.current = requestAnimationFrame(loop);
    return () => { if (rAF.current) cancelAnimationFrame(rAF.current); };
  }, [isPhone]);

  function triggerSequenceRandom(el, radius, isPhoneLocal, gridEl) {
    const r = el.getBoundingClientRect();
    const cx = (r.left + r.right) / 2;
    const cy = (r.top + r.bottom) / 2;
    const dx = cx - mouse.current.x;
    const dy = cy - mouse.current.y;
    const dist = Math.max(1, Math.hypot(dx, dy));
    const proximity = Math.max(0, 1 - dist / radius);

    const maxPush = Math.min(
      MAX_PUSH_PX,
      Math.max(24, ((gridEl && gridEl.clientWidth) || 1000) / (isPhoneLocal ? 10 : 30))
    );
    const push = maxPush * (0.4 + 0.6 * proximity);

    const angle = Math.random() * Math.PI * 2;
    const x = Math.cos(angle) * push;
    const y = Math.sin(angle) * push;

    el._animating = true;

    el.style.transition = `transform ${OUT_MS}ms cubic-bezier(.25,.9,.35,1)`;
    el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;

    setTimeout(() => {
      el.style.transition = `transform 1ms linear`;
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;

      setTimeout(() => {
        const bx = (-x * OVERSHOOT).toFixed(1);
        const by = (-y * OVERSHOOT).toFixed(1);
        el.style.transition = `transform ${MID_MS}ms cubic-bezier(.3,1.05,.4,1)`;
        el.style.transform = `translate3d(${bx}px, ${by}px, 0)`;

        setTimeout(() => {
          el.style.transition = `transform ${BACK_MS}ms cubic-bezier(.2,1,.3,1)`;
          el.style.transform = `translate3d(0, 0, 0)`;
          setTimeout(() => { el._animating = false; }, BACK_MS + 20);
        }, MID_MS);
      }, PAUSE_MS);
    }, OUT_MS);
  }

  function resetAllLetters(withBounce = false) {
    for (const el of lettersRef.current) {
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
      el._animating = false;
      el._coolUntil = 0;
    }
  }

  function getWordUnderCursor(x, y) {
    if (!document || typeof document.elementsFromPoint !== 'function') return getNearestWordWithinRadius(x, y, BASE_RADIUS);
    const elems = document.elementsFromPoint(x, y);
    for (const el of elems) {
      const word = el.closest && el.closest('.oak-word');
      if (word) return word;
    }
    return null;
  }

  function getNearestWordWithinRadius(x, y, radius) {
    const words = Array.from(document.querySelectorAll('.oak-word'));
    let best = null;
    let bestD = Infinity;
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
    const ranked = letters.map((el) => {
      const r = el.getBoundingClientRect();
      const cx = (r.left + r.right) / 2;
      const cy = (r.top + r.bottom) / 2;
      const d = Math.hypot(cx - x, cy - y);
      return { el, d };
    }).sort((a, b) => a.d - b.d);
    return ranked.filter(item => item.d <= radius).slice(0, n).map(item => item.el);
  }

  const Word = () => (
    <span className="oak-word inline-block select-none whitespace-nowrap will-change-transform" style={{ transform: "scale(1)" }}>
      {Array.from(TEXT).map((ch, i) => (
        <span key={i} className="oak-ch inline-block will-change-transform" style={{ transform: "translate3d(0,0,0)", position: "relative", zIndex: 10 }}>
          {ch === " " ? "\u00A0" : ch}
        </span>
      ))}
    </span>
  );

  const Column = React.forwardRef(({ dir, scale, id }, ref) => (
    <div className="col relative text-white font-black text-center overflow-visible z-[1]" ref={ref}>
      <div
        id={id}
        className={`column-inner absolute w-full h-[200%] will-change-transform ${dir === "up" ? "animate-oak-up" : "animate-oak-down"}`}
        style={{ animationDuration: `${SCROLL_SECONDS}s` }}
      >
        <div className="w-full h-full">
          {rows.map((r) => (
            <div key={r} className="row flex items-center justify-center" style={{ height: `${100 / ROWS_VISIBLE}%` }}>
              <div style={{ transform: `scale(${scale})`, transformOrigin: "center center" }}>
                <Word />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  ));

  Column.displayName = "Column";

  useEffect(() => {
    requestAnimationFrame(() => {
      if (leftRef.current) fitColumn(leftRef.current, "left");
      if (centerRef.current) fitColumn(centerRef.current, "center");
      if (rightRef.current) fitColumn(rightRef.current, "right");
    });
  }, []);

  return (
    <div className="relative h-svh w-svw overflow-hidden bg-black" ref={gridRef}>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[18vh]" style={{ background: "linear-gradient(to bottom, #000 0%, rgba(0,0,0,0) 75%)", zIndex: 5 }} />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[18vh]" style={{ background: "linear-gradient(to top, #000 0%, rgba(0,0,0,0) 75%)", zIndex: 5 }} />

      <div className={`grid h-full ${isPhone ? "grid-cols-1" : "grid-cols-3"} gap-0`}>
        {!isPhone && <Column dir="down" scale={colScale.left} id="col-left" ref={leftRef} />}
        <Column dir="up" scale={colScale.center} id="col-center" ref={centerRef} />
        {!isPhone && <Column dir="down" scale={colScale.right} id="col-right" ref={rightRef} />}
      </div>

      <style>{`
        .column-inner.animate-oak-up { animation-name: oak-scroll-up; animation-timing-function: linear; animation-iteration-count: infinite; }
        .column-inner.animate-oak-down { animation-name: oak-scroll-down; animation-timing-function: linear; animation-iteration-count: infinite; }
        @keyframes oak-scroll-up { from { transform: translate3d(0,0,0);} to { transform: translate3d(0,-50%,0);} }
        @keyframes oak-scroll-down { from { transform: translate3d(0,-50%,0);} to { transform: translate3d(0,0,0);} }
        .col { color: #fff; font-family: 'Arial Black', system-ui, sans-serif; font-weight: 900; line-height: 0.1; user-select: none; }
        .oak-ch { user-select: none; position: relative; z-index: 10; will-change: transform; }
      `}</style>
    </div>
  );
}