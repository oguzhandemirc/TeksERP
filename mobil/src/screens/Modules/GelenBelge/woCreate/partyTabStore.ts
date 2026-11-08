// Parti sekmelerinin not başına durumu (etkin sekme + bakılan partiler). Modül düzeyinde: İE formu ile belge önizlemesi aynı
// sekmeyi ve aynı "bakıldı" bilgisini paylaşır; satır bileşeni yeniden bağlansa da kaybolmaz.
import { useCallback, useSyncExternalStore } from 'react';
import type { PartyTabKey } from './partyTabs';

export interface PartyTabState {
  active: PartyTabKey;
  visited: ReadonlySet<number>;
}

const EMPTY: PartyTabState = { active: 'all', visited: new Set() };
const states = new Map<string, PartyTabState>();
const listeners = new Set<() => void>();

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Sekmeye geç; parti sekmesi açılınca o parti "bakıldı" sayılır ("Tümü" saymaz). */
export function selectPartyTab(noteId: string, key: PartyTabKey): void {
  const cur = states.get(noteId) ?? EMPTY;
  const visited = key === 'all' || cur.visited.has(key) ? cur.visited : new Set([...cur.visited, key]);
  if (cur.active === key && visited === cur.visited) return;
  states.set(noteId, { active: key, visited });
  listeners.forEach((l) => l());
}

export function usePartyTabState(noteId: string): [PartyTabState, (key: PartyTabKey) => void] {
  const state = useSyncExternalStore(subscribe, () => states.get(noteId) ?? EMPTY, () => states.get(noteId) ?? EMPTY);
  const select = useCallback((key: PartyTabKey) => selectPartyTab(noteId, key), [noteId]);
  return [state, select];
}

/** Yalnız testler. */
export function resetPartyTabStore(): void {
  states.clear();
  listeners.forEach((l) => l());
}
