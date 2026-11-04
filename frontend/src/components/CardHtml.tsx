import { memo, useLayoutEffect, useRef } from "react";
import { prepareCardHtml } from "../lib/html";

/** Card HTML, sanitised, with media resolved and maths typeset. */
export const CardHtml = memo(function CardHtml({
  html,
  className = "",
  onReady,
}: {
  html: string;
  className?: string;
  onReady?: (el: HTMLDivElement) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!ref.current) return;
    prepareCardHtml(ref.current, html);
    onReady?.(ref.current);
    // onReady is intentionally not a dependency: re-render only on new HTML.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html]);
  return <div ref={ref} className={`card-html ${className}`} />;
});
