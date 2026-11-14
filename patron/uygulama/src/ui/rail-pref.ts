// Geniş ekran rayının açık/dar tercihi — cihazda (`patron.ray`), uygulama genelinde tek değer. Depo erişimi
// hata verirse (test, web gizli kip) tercih yalnız bellekte yaşar; ray yine açılır/kapanır.
import { useSyncExternalStore } from "react";
import type { KeyValue } from "../state/store";

export const RAIL_PREF_KEY = "patron.ray";

let open = true;
let loaded = false;
const listeners = new Set<() => void>();

function store(): Pick<KeyValue, "get" | "set"> | null {
  try {
    return (require("../state/store") as typeof import("../state/store")).plainStore;
  } catch {
    return null;
  }
}

function emit(): void {
  for (const l of listeners) l();
}

function load(): void {
  if (loaded) return;
  loaded = true;
  store()
    ?.get(RAIL_PREF_KEY)
    .then((v) => {
      if (v === "dar" && open) {
        open = false;
        emit();
      }
    })
    .catch(() => undefined);
}

export function setRailOpen(next: boolean): void {
  if (next === open) return;
  open = next;
  emit();
  void store()?.set(RAIL_PREF_KEY, next ? "acik" : "dar").catch(() => undefined);
}

function subscribe(l: () => void): () => void {
  load();
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Ray açık mı + değiştirici. */
export function useRailOpen(): { open: boolean; toggle: () => void } {
  const value = useSyncExternalStore(subscribe, () => open, () => open);
  return { open: value, toggle: () => setRailOpen(!value) };
}
