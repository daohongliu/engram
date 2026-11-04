import rough from "roughjs";
import type { Options } from "roughjs/bin/core";
import { CSSProperties, useMemo } from "react";

/**
 * Hand-drawn primitives built on rough.js. Shapes are seeded, so a given
 * line wobbles the same way on every render instead of shimmering.
 */
const gen = rough.generator();

type PathInfo = { d: string; stroke: string; strokeWidth: number; fill?: string };

function paths(drawable: ReturnType<typeof gen.line>): PathInfo[] {
  return gen.toPaths(drawable) as PathInfo[];
}

export function seedFrom(text: string | number) {
  const s = String(text);
  let h = 7;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 2147483647;
  return (h % 9999) + 1;
}

function Paths({ ps, className, style }: { ps: PathInfo[]; className?: string; style?: CSSProperties }) {
  return (
    <>
      {ps.map((p, i) => (
        <path
          key={i}
          d={p.d}
          strokeWidth={p.strokeWidth}
          strokeLinecap="round"
          pathLength={1}
          className={className}
          // CSS custom properties work in style, not in SVG attributes.
          style={{ stroke: p.stroke || "none", fill: p.fill || "none", ...style }}
        />
      ))}
    </>
  );
}

/** A horizontal pencil line that draws itself in. */
export function DrawnRule({ width = 600, seed = 3, color = "var(--rule-strong)", animate = false, className }: { width?: number; seed?: number; color?: string; animate?: boolean; className?: string }) {
  const ps = useMemo(
    () => paths(gen.line(2, 5, width - 2, 5, { seed, stroke: color, roughness: 1.1, bowing: 1.4, strokeWidth: 1.3, disableMultiStroke: true })),
    [width, seed, color],
  );
  return (
    <svg className={`drawn-rule ${className ?? ""}`} viewBox={`0 0 ${width} 10`} preserveAspectRatio="none" aria-hidden>
      <Paths ps={ps} className={animate ? "draw-in" : undefined} />
    </svg>
  );
}

/** A loose underline for emphasis, sized to its container. */
export function Scribble({ seed = 5, color = "var(--accent)", width = 120 }: { seed?: number; color?: string; width?: number }) {
  const ps = useMemo(
    () =>
      paths(
        gen.curve(
          [
            [2, 6],
            [width * 0.35, 3],
            [width * 0.7, 7],
            [width - 2, 4],
          ],
          { seed, stroke: color, roughness: 0.8, strokeWidth: 1.6 },
        ),
      ),
    [seed, width, color],
  );
  return (
    <svg className="scribble" viewBox={`0 0 ${width} 10`} preserveAspectRatio="none" aria-hidden>
      <Paths ps={ps} className="draw-in" />
    </svg>
  );
}

export function RoughRect({ x, y, w, h, seed, color, fill, options, className }: { x: number; y: number; w: number; h: number; seed: number; color: string; fill?: string; options?: Options; className?: string }) {
  const ps = useMemo(
    () => paths(gen.rectangle(x, y, w, h, { seed, stroke: color, roughness: 0.9, strokeWidth: 1, fill, ...options })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [x, y, w, h, seed, color, fill, JSON.stringify(options)],
  );
  return (
    <g className={className}>
      <Paths ps={ps} />
    </g>
  );
}

export function RoughCircle({ cx, cy, d, seed, color, fill, options }: { cx: number; cy: number; d: number; seed: number; color: string; fill?: string; options?: Options }) {
  const ps = useMemo(
    () => paths(gen.circle(cx, cy, d, { seed, stroke: color, roughness: 0.8, strokeWidth: 1.2, fill, ...options })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cx, cy, d, seed, color, fill, JSON.stringify(options)],
  );
  return <Paths ps={ps} />;
}

export function RoughPath({ d, seed, color, options, className }: { d: string; seed: number; color: string; options?: Options; className?: string }) {
  const ps = useMemo(
    () => paths(gen.path(d, { seed, stroke: color, roughness: 0.7, strokeWidth: 1.3, ...options })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [d, seed, color, JSON.stringify(options)],
  );
  return <Paths ps={ps} className={className} />;
}

/** A steaming teacup, for when the day's work is done. */
export function Teacup({ size = 140 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 140 140" className="teacup" aria-hidden>
      <g className="steam">
        <RoughPath d="M58 40 C 50 30, 66 24, 58 12" seed={11} color="var(--ink-4)" />
        <RoughPath d="M72 42 C 64 30, 80 24, 72 10" seed={12} color="var(--ink-4)" />
        <RoughPath d="M86 40 C 78 30, 94 24, 86 14" seed={13} color="var(--ink-4)" />
      </g>
      <RoughPath d="M34 56 L 106 56 C 104 90, 92 104, 70 104 C 48 104, 36 90, 34 56 Z" seed={4} color="var(--ink-2)" options={{ fill: "var(--accent-wash)", fillStyle: "hachure", hachureGap: 5, fillWeight: 0.8, hachureAngle: 60 }} />
      <RoughPath d="M104 64 C 124 62, 124 86, 100 86" seed={5} color="var(--ink-2)" />
      <RoughPath d="M22 110 C 50 118, 90 118, 118 110" seed={6} color="var(--ink-3)" />
    </svg>
  );
}

/** A small owl in the margin. It watches you study. It has opinions. */
export function Owl({ size = 64, blink = true }: { size?: number; blink?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={`owl ${blink ? "owl-blink" : ""}`} aria-hidden>
      <RoughPath d="M16 50 C 10 36, 12 18, 20 12 L 24 18 C 28 15, 36 15, 40 18 L 44 12 C 52 18, 54 36, 48 50 C 42 58, 22 58, 16 50 Z" seed={21} color="var(--ink-2)" options={{ roughness: 0.9 }} />
      <g className="owl-eyes">
        <RoughCircle cx={25} cy={28} d={11} seed={22} color="var(--ink-2)" />
        <RoughCircle cx={39} cy={28} d={11} seed={23} color="var(--ink-2)" />
        <circle cx={25} cy={28.5} r={2} fill="var(--ink)" className="pupil" />
        <circle cx={39} cy={28.5} r={2} fill="var(--ink)" className="pupil" />
      </g>
      <RoughPath d="M30 35 L 32 39 L 34 35" seed={24} color="var(--accent)" />
      <RoughPath d="M24 44 C 28 46, 36 46, 40 44" seed={25} color="var(--ink-4)" options={{ strokeWidth: 0.8 }} />
      <RoughPath d="M26 48 C 30 50, 34 50, 38 48" seed={26} color="var(--ink-4)" options={{ strokeWidth: 0.8 }} />
      <RoughPath d="M12 58 L 52 58" seed={27} color="var(--ink-3)" />
    </svg>
  );
}

/** Two index cards, slightly askew: the logo. */
export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="logo-mark">
      <g transform="rotate(-7 15 16)">
        <RoughRect x={4} y={8} w={20} h={15} seed={31} color="var(--ink-2)" fill="var(--paper-raised)" options={{ fillStyle: "solid" }} />
      </g>
      <g transform="rotate(5 18 17)">
        <RoughRect x={8} y={10} w={20} h={15} seed={32} color="var(--accent)" fill="var(--paper-raised)" options={{ fillStyle: "solid" }} />
        <RoughPath d="M12 16 L 23 16" seed={33} color="var(--ink-3)" options={{ strokeWidth: 0.9 }} />
        <RoughPath d="M12 20 L 20 20" seed={34} color="var(--ink-3)" options={{ strokeWidth: 0.9 }} />
      </g>
    </svg>
  );
}
