/* Typed wrappers around the Python backend. */

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, headers: {} };
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
  }
  const res = await fetch(path, init);
  if (!res.ok) {
    let message = res.statusText;
    try {
      const data = await res.json();
      message = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail);
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, message);
  }
  return res.json() as Promise<T>;
}

const get = <T>(p: string) => request<T>("GET", p);
const post = <T>(p: string, b?: unknown) => request<T>("POST", p, b);
const put = <T>(p: string, b?: unknown) => request<T>("PUT", p, b);
const patch = <T>(p: string, b?: unknown) => request<T>("PATCH", p, b);
const del = <T>(p: string) => request<T>("DELETE", p);

export interface DeckNode {
  id: number;
  name: string;
  fullName: string;
  new: number;
  learn: number;
  review: number;
  total: number;
  filtered: boolean;
  collapsed: boolean;
  children: DeckNode[];
}

export interface Memory {
  stability: number;
  difficulty: number | null;
  retrievability: number | null;
}

export interface Due {
  state: string;
  days: number | null;
  label: string;
}

export interface ReviewCard {
  id: number;
  noteId: number;
  deck: string;
  notetype: string;
  template: string;
  tags: string[];
  flag: number;
  reps: number;
  lapses: number;
  isNew: boolean;
  lastReviewed: number | null;
  memory: Memory | null;
  question: string;
  answer: string;
  answerFull: string;
  answerRepeatsQuestion: boolean;
}

export interface UpcomingCard {
  id: number;
  deck: string;
  queue: "new" | "learn" | "review";
  question: string;
}

export interface Counts {
  new: number;
  learn: number;
  review: number;
}

export type NextCard =
  | {
      done: false;
      deckName: string;
      counts: Counts;
      queue: "new" | "learn" | "review";
      intervals: string[];
      card: ReviewCard;
      upcoming: UpcomingCard[];
    }
  | {
      done: true;
      deckName: string;
      counts: Counts;
      congrats: {
        learnRemaining: number;
        secsUntilNextLearn: number;
        nextLearnLabel: string | null;
        reviewRemaining: boolean;
        newRemaining: boolean;
        haveBuried: boolean;
        studiedToday: { cards: number; seconds: number };
      };
    };

export interface Row {
  id: number;
  noteId: number;
  deck: string;
  notetype: string;
  ord: number;
  question: string;
  answer: string;
  tags: string[];
  due: Due;
  interval: number;
  reps: number;
  lapses: number;
  flag: number;
  memory: Memory | null;
  modified: number;
  /** In notes view: every card of the note. */
  cardIds?: number[];
}

export interface SearchResult {
  total: number;
  offset: number;
  rows: Row[];
  ms: number;
}

export interface SearchParams {
  text?: string;
  deck?: string | null;
  tag?: string | null;
  state?: string | null;
  order?: string;
  desc?: boolean;
  offset?: number;
  limit?: number;
  cid?: number;
  /** One entry per note instead of per card. */
  notes?: boolean;
}

export interface Tag {
  name: string;
  notes: number;
}

export interface Field {
  name: string;
  source: string;
  html: string;
  kind: "md" | "html";
}

export interface RevlogEntry {
  time?: string;
  reviewKind?: string;
  buttonChosen?: number;
  interval?: number;
  ease?: number;
  takenSecs?: number;
  memoryState?: { stability?: number; difficulty?: number };
}

export interface CardDetail {
  id: number;
  noteId: number;
  deckId: number;
  deck: string;
  notetype: { id: number; name: string; isCloze: boolean };
  template: string;
  fields: Field[];
  tags: string[];
  flag: number;
  queue: number;
  due: Due;
  memory: Memory | null;
  stats: {
    added?: string;
    firstReview?: string;
    latestReview?: string;
    reviews?: number;
    lapses?: number;
    interval?: number;
    averageSecs?: number;
    totalSecs?: number;
    revlog?: RevlogEntry[];
    fsrsRetrievability?: number;
    desiredRetention?: number;
  };
  siblings: number[];
  question: string;
  answer: string;
}

export interface Notetype {
  id: number;
  name: string;
  fields: string[];
  templates: string[];
  isCloze: boolean;
  useCount: number;
}

export interface Stats {
  calendar: { date: string; count: number; seconds: number }[];
  streak: number;
  forecast: { day: number; count: number }[];
  counts: Record<"new" | "learning" | "young" | "mature" | "suspended" | "buried", number>;
  totalCards: number;
  totalNotes: number;
  retention: number | null;
  retentionSample: number;
  hours: number[];
  today: { cards: number; seconds: number; again: number };
  secsPerCard: number;
}

export interface Settings {
  preamble: string;
  collectionPath: string;
  mediaPath: string;
  fsrs: boolean;
}

export interface DeckOptions {
  filtered: boolean;
  preset?: string;
  sharedWith?: number;
  newPerDay?: number;
  reviewsPerDay?: number;
  desiredRetention?: number;
  fsrs?: boolean;
}

export type BulkAction =
  | "suspend"
  | "unsuspend"
  | "bury"
  | "unbury"
  | "delete"
  | "move"
  | "addTags"
  | "removeTags"
  | "flag"
  | "forget"
  | "setDue";

export const api = {
  decks: () => get<{ decks: DeckNode[]; totals: Counts }>("/api/decks"),
  createDeck: (name: string) => post<{ id: number; name: string }>("/api/decks", { name }),
  renameDeck: (id: number, name: string) => patch(`/api/decks/${id}`, { name }),
  deleteDeck: (id: number) => del<{ removedCards: number }>(`/api/decks/${id}`),
  deckOptions: (id: number) => get<DeckOptions>(`/api/decks/${id}/options`),
  setDeckOptions: (id: number, o: Partial<DeckOptions>) => put<DeckOptions>(`/api/decks/${id}/options`, o),

  /**
   * `decks` is one deck id, several joined by commas, or "0" for every deck.
   * With cardId, that card is shown now if it is waiting.
   */
  next: (decks: string, cardId?: number) =>
    get<NextCard>(`/api/review/${decks}/next${cardId ? `?cardId=${cardId}` : ""}`),
  answer: (decks: string, cardId: number, rating: number, ms: number) =>
    post(`/api/review/${decks}/answer`, { cardId, rating, ms }),

  search: (p: SearchParams) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
    return get<SearchResult>(`/api/search?${qs}`);
  },
  tags: () => get<Tag[]>("/api/tags"),
  card: (id: number) => get<CardDetail>(`/api/cards/${id}`),
  bulk: (ids: number[], action: BulkAction, extra: Record<string, unknown> = {}) =>
    post<{ ok: boolean; count: number; undo?: string }>("/api/cards/bulk", { ids, action, ...extra }),

  notetypes: () => get<Notetype[]>("/api/notetypes"),
  addNote: (body: { notetypeId: number; deckId: number; fields: string[]; tags: string[] }) =>
    post<{ noteId: number; cardIds: number[]; warning: string | null }>("/api/notes", body),
  note: (id: number) =>
    get<{ id: number; notetype: { id: number; name: string; isCloze: boolean }; fields: Field[]; tags: string[]; cardIds: number[] }>(
      `/api/notes/${id}`,
    ),
  updateNote: (id: number, body: { fields: string[]; tags: string[]; deckId?: number }) =>
    put<{ ok: boolean; changed: boolean }>(`/api/notes/${id}`, body),
  deleteNote: (id: number) => del(`/api/notes/${id}`),
  preview: (notetypeId: number, fields: string[]) =>
    post<{ cards: { label: string; question: string; answer: string }[] }>("/api/notes/preview", {
      notetypeId,
      fields,
    }),

  stats: () => get<Stats>("/api/stats"),
  undoStatus: () => get<{ undo: string | null; redo: string | null }>("/api/undo"),
  undo: () => post<{ undid: string }>("/api/undo"),

  settings: () => get<Settings>("/api/settings"),
  saveSettings: (s: Partial<Settings>) => put<Settings>("/api/settings", s),

  uploadMedia: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return post<{ filename: string; isImage: boolean; bytes: number }>("/api/media", fd);
  },
};
