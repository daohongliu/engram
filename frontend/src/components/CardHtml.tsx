import { memo, useLayoutEffect, useRef } from "react";
import { prepareCardHtml } from "../lib/html";

/** Card HTML, sanitised, with media resolved and maths typeset. */
export const CardHtml = memo(function CardHtml({
  html,
  className = "",
  onReady,
  inline = false,
}: {
  html: string;
  className?: string;
  /** Typeset display maths as inline (for one-line table cells). */
  inline?: boolean;
  onReady?: (el: HTMLDivElement) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!ref.current) return;
    prepareCardHtml(ref.current, html, inline);
    onReady?.(ref.current);
    // onReady is intentionally not a dependency: re-render only on new HTML.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, inline]);
  return <div ref={ref} className={`card-html ${className}`} />;
});
