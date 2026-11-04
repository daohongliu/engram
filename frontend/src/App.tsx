import { ReactNode, useEffect, useRef, useState } from "react";
import { CommandPalette } from "./components/CommandPalette";
import { HelpOverlay } from "./components/HelpOverlay";
import { Logo } from "./components/Sketch";
import { Toasts } from "./components/Toasts";
import { isTyping, MOD, useKeys } from "./lib/keys";
import { match, navigate, useLinkInterception, useLocation } from "./lib/router";
import { decks, settings } from "./lib/store";
import { cycleTheme, setTheme, useTheme } from "./lib/theme";
import { toast } from "./lib/toast";
import { undoLast } from "./lib/undo";
import { Almanac } from "./pages/Almanac";
import { Browse } from "./pages/Browse";
import { Contents } from "./pages/Contents";
import { NotFound } from "./pages/NotFound";
import { Review } from "./pages/Review";
import { SettingsPage } from "./pages/Settings";
import { Write } from "./pages/Write";

const NAV = [
  { href: "/", label: "Contents", key: "c" },
  { href: "/browse", label: "Browse", key: "b" },
  { href: "/write", label: "Write", key: "w" },
  { href: "/almanac", label: "Almanac", key: "a" },
];

const KONAMI = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];

export function App() {
  useLinkInterception();
  const { path } = useLocation();
  const loaded = settings.use();
  const deckData = decks.use();
  const theme = useTheme();
  const [palette, setPalette] = useState(false);
  const [help, setHelp] = useState(false);
  const chord = useRef<{ key: string; at: number } | null>(null);
  const konami = useRef(0);

  useKeys((e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      setPalette((p) => !p);
      return true;
    }
    // Konami code: a theme for people who miss the smell of chalk.
    konami.current = e.key === KONAMI[konami.current] ? konami.current + 1 : e.key === KONAMI[0] ? 1 : 0;
    if (konami.current === KONAMI.length) {
      konami.current = 0;
      const on = theme !== "chalkboard";
      setTheme(on ? "chalkboard" : "auto");
      toast.info(on ? "Chalkboard mode. Mind the dust." : "Back to paper.");
      return true;
    }
    if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !e.shiftKey && !isTyping(e)) {
        void undoLast();
        return true;
      }
      return;
    }
    if (palette || help) return;
    if (e.key === "?") {
      setHelp(true);
      return true;
    }
    const now = Date.now();
    if (chord.current?.key === "g" && now - chord.current.at < 900) {
      chord.current = null;
      const target = NAV.find((n) => n.key === e.key.toLowerCase());
      if (target) {
        navigate(target.href);
        return true;
      }
      if (e.key === "s") {
        navigate("/settings");
        return true;
      }
    }
    if (e.key === "g") {
      chord.current = { key: "g", at: now };
      return true;
    }
    if (e.key === "/" && !path.startsWith("/browse")) {
      navigate("/browse");
      requestAnimationFrame(() => document.querySelector<HTMLInputElement>(".search-input")?.focus());
      return true;
    }
    if (e.key === "n" && !path.startsWith("/write") && !path.startsWith("/study")) {
      navigate("/write");
      return true;
    }
  });

  useEffect(() => {
    const due = deckData ? deckData.totals.review + deckData.totals.learn + deckData.totals.new : 0;
    document.title = due && !path.startsWith("/study") ? `(${due}) Better Anki` : "Better Anki";
  }, [deckData, path]);

  if (!loaded) return <div className="boot">Opening your collection…</div>;

  let page: ReactNode;
  let params: Record<string, string> | null;
  if (path === "/") page = <Contents />;
  else if ((params = match("/study/:deckId", path))) page = <Review key={params.deckId} deckId={Number(params.deckId)} />;
  else if (path === "/browse") page = <Browse />;
  else if (path === "/write") page = <Write />;
  else if (path === "/almanac") page = <Almanac />;
  else if (path === "/settings") page = <SettingsPage />;
  else page = <NotFound />;

  const studying = path.startsWith("/study");

  return (
    <div className={`app ${studying ? "is-studying" : ""}`}>
      <header className="topbar">
        <a href="/" className="wordmark" aria-label="Better Anki, contents">
          <Logo />
          <span>
            Better <em>Anki</em>
          </span>
        </a>
        <nav className="topnav" aria-label="Main">
          {NAV.map((n) => (
            <a
              key={n.href}
              href={n.href}
              className={(n.href === "/" ? path === "/" : path.startsWith(n.href)) ? "active" : ""}
              title={`g then ${n.key}`}
            >
              {n.label}
            </a>
          ))}
        </nav>
        <div className="topbar-tools">
          <button className="kbd-button" onClick={() => setPalette(true)} title="Command palette">
            <kbd>{MOD}</kbd>
            <kbd>K</kbd>
          </button>
          <button
            className="icon-button"
            onClick={cycleTheme}
            title={`Theme: ${theme}. Click to change.`}
            aria-label="Change theme"
          >
            <ThemeGlyph theme={theme} />
          </button>
          <a href="/settings" className="icon-button" title="Settings (g s)" aria-label="Settings">
            ⚙
          </a>
        </div>
      </header>
      <main className="page">{page}</main>
      {!studying && (
        <footer className="colophon">
          <p>
            Set in Newsreader and Fraunces. Scheduled by FSRS inside the Anki engine. Your cards live in{" "}
            <code>{loaded.collectionPath.split("/").slice(-2).join("/")}</code> and nowhere else.
          </p>
          <p className="colophon-aside">
            Press <kbd>?</kbd> for shortcuts. No committees were consulted.
          </p>
        </footer>
      )}
      <Toasts />
      {palette && <CommandPalette onClose={() => setPalette(false)} onHelp={() => setHelp(true)} />}
      {help && <HelpOverlay onClose={() => setHelp(false)} />}
    </div>
  );
}

function ThemeGlyph({ theme }: { theme: string }) {
  // auto: half paper, half ink. light: an open circle. dark: a crescent.
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.4" />
      {theme === "auto" && <path d="M8 2 A6 6 0 0 1 8 14 Z" fill="currentColor" />}
      {(theme === "dark" || theme === "chalkboard") && <path d="M8 2 A6 6 0 1 0 14 9 A4.5 4.5 0 0 1 8 2 Z" fill="currentColor" />}
    </svg>
  );
}
