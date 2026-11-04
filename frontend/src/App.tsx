import { ReactNode, useEffect, useRef, useState } from "react";
import { CommandPalette } from "./components/CommandPalette";
import { HelpOverlay } from "./components/HelpOverlay";
import { Auto, Gear, Mark, Moon, Search, Sun } from "./components/Icons";
import { Lightbox } from "./components/Lightbox";
import { Toasts } from "./components/Toasts";
import { isTyping, MOD, useKeys } from "./lib/keys";
import { match, navigate, useLinkInterception, useLocation } from "./lib/router";
import { decks, settings } from "./lib/store";
import { cycleTheme, useTheme } from "./lib/theme";
import { undoLast } from "./lib/undo";
import { Add } from "./pages/Add";
import { Browse } from "./pages/Browse";
import { DeckOverview } from "./pages/DeckOverview";
import { Decks } from "./pages/Decks";
import { NotFound } from "./pages/NotFound";
import { Review } from "./pages/Review";
import { SettingsPage } from "./pages/Settings";
import { Stats } from "./pages/Stats";

const NAV = [
  { href: "/", label: "Decks", key: "d" },
  { href: "/add", label: "Add", key: "a" },
  { href: "/browse", label: "Browse", key: "b" },
  { href: "/stats", label: "Stats", key: "s" },
];

export function App() {
  useLinkInterception();
  const { path } = useLocation();
  const loaded = settings.use();
  const deckData = decks.use();
  const theme = useTheme();
  const [palette, setPalette] = useState(false);
  const [help, setHelp] = useState(false);
  const chord = useRef<number>(0);

  useKeys((e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      setPalette((p) => !p);
      return true;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !e.shiftKey && !isTyping(e)) {
      void undoLast();
      return true;
    }
    if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey || palette || help) return;
    if (e.key === "?") {
      setHelp(true);
      return true;
    }
    if (Date.now() - chord.current < 900) {
      chord.current = 0;
      const target = NAV.find((n) => n.key === e.key.toLowerCase());
      if (target) {
        navigate(target.href);
        return true;
      }
    }
    if (e.key === "g") {
      chord.current = Date.now();
      return true;
    }
    if (e.key === "/" && !path.startsWith("/browse")) {
      navigate("/browse");
      return true;
    }
  });

  useEffect(() => {
    const due = deckData ? deckData.totals.review + deckData.totals.learn + deckData.totals.new : 0;
    document.title = due && !path.startsWith("/study") ? `Engram (${due})` : "Engram";
  }, [deckData, path]);

  if (!loaded) return <div className="boot">Loading…</div>;

  let page: ReactNode;
  let params: Record<string, string> | null;
  if (path === "/") page = <Decks />;
  else if ((params = match("/deck/:deckId", path))) page = <DeckOverview key={params.deckId} deckId={Number(params.deckId)} />;
  else if ((params = match("/study/:deckId", path))) page = <Review key={params.deckId} deckId={params.deckId === "all" ? 0 : Number(params.deckId)} />;
  else if (path === "/browse") page = <Browse />;
  else if (path === "/add" || path === "/write") page = <Add />;
  else if (path === "/stats") page = <Stats />;
  else if (path === "/settings") page = <SettingsPage />;
  else page = <NotFound />;

  const section = path === "/" || path.startsWith("/deck") || path.startsWith("/study") ? "/" : path;

  return (
    <>
      <header className="topbar">
        <a href="/" className="brand">
          <Mark />
          <span>Engram</span>
        </a>
        <nav className="nav" aria-label="Main">
          {NAV.map((n) => (
            <a key={n.href} href={n.href} className={section === n.href || (n.href === "/add" && path === "/write") ? "active" : ""}>
              {n.label}
            </a>
          ))}
        </nav>
        <div className="topbar-tools">
          <button className="palette-trigger" onClick={() => setPalette(true)}>
            <Search width={14} height={14} />
            <span>Go to…</span>
            <kbd>{MOD} K</kbd>
          </button>
          <button className="icon-btn" onClick={cycleTheme} title={`Theme: ${theme}`} aria-label="Change theme">
            {theme === "dark" ? <Moon /> : theme === "light" ? <Sun /> : <Auto />}
          </button>
          <a href="/settings" className="icon-btn" title="Settings" aria-label="Settings">
            <Gear />
          </a>
        </div>
      </header>
      <main className="page">{page}</main>
      <Toasts />
      <Lightbox />
      {palette && <CommandPalette onClose={() => setPalette(false)} onHelp={() => setHelp(true)} />}
      {help && <HelpOverlay onClose={() => setHelp(false)} />}
    </>
  );
}
