import { useEffect, useRef, useState } from "react";

/**
 * Small tooltips that name a control and its keyboard shortcut.
 *
 * Any element can opt in with `data-tip` (what it does) and `data-kbd`
 * (the keys, separated by spaces; "then" and "or" are shown as words, so
 * "G then D" reads as a sequence). One listener on the document drives
 * them all, so controls need no wrapper component.
 */

const DELAY = 450;
// Moving from one control to the next within this time shows the next tip at once.
const WARM = 400;

interface Tip {
  label: string;
  keys: string[];
  rect: DOMRect;
}

export function tip(label: string, kbd?: string) {
  return { "data-tip": label, ...(kbd ? { "data-kbd": kbd } : {}) };
}

function tipFor(el: HTMLElement): Tip | null {
  const label = el.dataset.tip ?? "";
  const keys = (el.dataset.kbd ?? "").split(" ").filter(Boolean);
  if (!label && !keys.length) return null;
  return { label, keys, rect: el.getBoundingClientRect() };
}

export function Tooltips() {
  const [shown, setShown] = useState<Tip | null>(null);
  const timer = useRef<number | null>(null);
  const target = useRef<HTMLElement | null>(null);
  const hiddenAt = useRef(0);
  const visible = useRef(false);
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; below: boolean } | null>(null);

  useEffect(() => {
    const clear = () => {
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = null;
    };
    const hide = () => {
      clear();
      if (visible.current) hiddenAt.current = Date.now();
      visible.current = false;
      target.current = null;
      setShown(null);
    };
    const show = (el: HTMLElement, immediate: boolean) => {
      clear();
      target.current = el;
      const open = () => {
        if (target.current !== el || !el.isConnected) return;
        visible.current = true;
        setShown(tipFor(el));
      };
      // Once one tip is up, moving to the next control swaps it straight away.
      if (immediate || visible.current || Date.now() - hiddenAt.current < WARM) open();
      else timer.current = window.setTimeout(open, DELAY);
    };
    const find = (node: EventTarget | null) =>
      node instanceof Element ? (node.closest("[data-tip], [data-kbd]") as HTMLElement | null) : null;

    const over = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const el = find(e.target);
      if (el === target.current) return;
      if (el) show(el, false);
      else hide();
    };
    const focus = (e: FocusEvent) => {
      const el = find(e.target);
      // Only for keyboard focus, so a click does not leave a tip behind.
      if (el && (e.target as HTMLElement).matches(":focus-visible")) show(el, true);
    };
    const blur = (e: FocusEvent) => {
      if (find(e.target) === target.current) hide();
    };
    const leaveWindow = (e: PointerEvent) => {
      if (!e.relatedTarget) hide();
    };

    document.addEventListener("pointerover", over);
    document.addEventListener("pointerout", leaveWindow);
    document.addEventListener("focusin", focus);
    document.addEventListener("focusout", blur);
    document.addEventListener("pointerdown", hide, true);
    window.addEventListener("keydown", hide, true);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    window.addEventListener("popstate", hide);
    return () => {
      clear();
      document.removeEventListener("pointerover", over);
      document.removeEventListener("pointerout", leaveWindow);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("focusout", blur);
      document.removeEventListener("pointerdown", hide, true);
      window.removeEventListener("keydown", hide, true);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
      window.removeEventListener("popstate", hide);
    };
  }, []);

  // Place it above the control, or below when there is no room, and keep
  // it inside the window.
  useEffect(() => {
    if (!shown || !box.current) {
      setPos(null);
      return;
    }
    const { width, height } = box.current.getBoundingClientRect();
    const r = shown.rect;
    const gap = 6;
    const below = r.top - height - gap < 8;
    const top = below ? r.bottom + gap : r.top - height - gap;
    const left = Math.min(Math.max(8, r.left + r.width / 2 - width / 2), window.innerWidth - width - 8);
    setPos({ left, top, below });
  }, [shown]);

  if (!shown) return null;
  return (
    <div
      ref={box}
      className={`tooltip ${pos ? "is-placed" : ""} ${pos?.below ? "is-below" : ""}`}
      role="tooltip"
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: 0 }}
    >
      {shown.label && <span>{shown.label}</span>}
      {shown.keys.length > 0 && (
        <span className="tooltip-keys">
          {shown.keys.map((k, i) => (k === "then" || k === "or" ? <span key={i}>{k}</span> : <kbd key={i}>{k}</kbd>))}
        </span>
      )}
    </div>
  );
}
