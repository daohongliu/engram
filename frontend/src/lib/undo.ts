import { api } from "../api";
import { invalidate } from "./store";
import { toast } from "./toast";

const listeners = new Set<() => void>();

/** Pages that show collection data subscribe so they can refetch after an undo. */
export function onUndo(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export async function undoLast() {
  try {
    const { undid } = await api.undo();
    toast.info(`Undid “${undid}”.`);
    invalidate();
    listeners.forEach((l) => l());
  } catch (err) {
    toast.error((err as Error).message);
  }
}

/** A toast with an Undo button, for actions we do not ask permission for. */
export function doneWithUndo(message: string) {
  toast.success(message, { label: "Undo", run: () => void undoLast() });
}
