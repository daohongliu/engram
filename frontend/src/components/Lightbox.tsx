import { useEffect, useState } from "react";

/**
 * Click an image on a card (while studying or previewing) to see it at full
 * size. Scroll or pinch to look closer; click or press Esc to put it back.
 */
export function Lightbox() {
  const [img, setImg] = useState<{ src: string; alt: string } | null>(null);
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName !== "IMG" || !target.closest(".card-sheet .card-html")) return;
      e.preventDefault();
      e.stopPropagation();
      setZoomed(false);
      setImg({ src: (target as HTMLImageElement).src, alt: (target as HTMLImageElement).alt });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  // Capture phase, so that while a picture is open no key reaches the
  // review screen underneath (space must not answer the card).
  useEffect(() => {
    if (!img) return;
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Escape" || e.key === " " || e.key === "Enter") {
        e.preventDefault();
        setImg(null);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [img]);

  if (!img) return null;
  return (
    <div className={`lightbox ${zoomed ? "is-zoomed" : ""}`} onClick={() => setImg(null)} role="dialog" aria-label="Image">
      <img
        src={img.src}
        alt={img.alt}
        onClick={(e) => {
          e.stopPropagation();
          setZoomed(!zoomed);
        }}
      />
      {img.alt && <p className="lightbox-caption">{img.alt}</p>}
    </div>
  );
}
