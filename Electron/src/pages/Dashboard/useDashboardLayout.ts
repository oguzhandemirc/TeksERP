import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_GROUP_ORDER,
  getDefaultItemOrder,
  type GroupKey,
} from "./widgetRegistry";

const STORAGE_KEY = "dashboard.layout.v2";
const EVENT_NAME = "dashboard-layout-changed";

interface LayoutState {
  /** Görünmeyen widget key'leri. */
  hidden: string[];
  /** Grup sırası — eksik gruplar default sıraya göre sona eklenir. */
  groupOrder?: GroupKey[];
  /** Grup içi item sırası — eksik itemlar default sıraya göre sona eklenir. */
  itemOrders?: Partial<Record<GroupKey, string[]>>;
}

const EMPTY: LayoutState = { hidden: [] };

function load(): LayoutState {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<LayoutState>;
    return {
      hidden: Array.isArray(parsed.hidden) ? parsed.hidden : [],
      groupOrder: Array.isArray(parsed.groupOrder) ? (parsed.groupOrder as GroupKey[]) : undefined,
      itemOrders:
        parsed.itemOrders && typeof parsed.itemOrders === "object"
          ? (parsed.itemOrders as Partial<Record<GroupKey, string[]>>)
          : undefined,
    };
  } catch {
    return EMPTY;
  }
}

function save(state: LayoutState): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  window.dispatchEvent(new Event(EVENT_NAME));
}

/** Stored list + default list'i birleştirip eksik öğeleri default sırada sonuna ekler. */
function mergeOrder<T extends string>(stored: T[] | undefined, defaults: T[]): T[] {
  if (!stored || stored.length === 0) return defaults;
  const inDefault = new Set(defaults);
  const seen = new Set<T>();
  const merged: T[] = [];
  for (const k of stored) {
    if (inDefault.has(k) && !seen.has(k)) {
      merged.push(k);
      seen.add(k);
    }
  }
  for (const k of defaults) {
    if (!seen.has(k)) merged.push(k);
  }
  return merged;
}

export function useDashboardLayout() {
  const [state, setState] = useState<LayoutState>(() => load());

  useEffect(() => {
    const handler = () => setState(load());
    window.addEventListener("storage", handler);
    window.addEventListener(EVENT_NAME, handler);
    return () => {
      window.removeEventListener("storage", handler);
      window.removeEventListener(EVENT_NAME, handler);
    };
  }, []);

  const groupOrder: GroupKey[] = mergeOrder<GroupKey>(state.groupOrder, DEFAULT_GROUP_ORDER);

  const itemOrder = useCallback(
    (groupKey: GroupKey): string[] =>
      mergeOrder(state.itemOrders?.[groupKey], getDefaultItemOrder(groupKey)),
    [state.itemOrders],
  );

  const isVisible = useCallback(
    (key: string) => !state.hidden.includes(key),
    [state.hidden],
  );

  const setVisible = useCallback((key: string, visible: boolean) => {
    const current = load();
    const set = new Set(current.hidden);
    if (visible) set.delete(key);
    else set.add(key);
    const next: LayoutState = { ...current, hidden: [...set] };
    save(next);
    setState(next);
  }, []);

  const setGroupOrder = useCallback((order: GroupKey[]) => {
    const current = load();
    const next: LayoutState = { ...current, groupOrder: order };
    save(next);
    setState(next);
  }, []);

  const setItemOrder = useCallback((groupKey: GroupKey, order: string[]) => {
    const current = load();
    const next: LayoutState = {
      ...current,
      itemOrders: { ...(current.itemOrders ?? {}), [groupKey]: order },
    };
    save(next);
    setState(next);
  }, []);

  const reset = useCallback(() => {
    save(EMPTY);
    setState(EMPTY);
  }, []);

  return {
    isVisible,
    setVisible,
    groupOrder,
    setGroupOrder,
    itemOrder,
    setItemOrder,
    reset,
    hiddenCount: state.hidden.length,
    customized:
      state.hidden.length > 0 ||
      state.groupOrder !== undefined ||
      (state.itemOrders && Object.keys(state.itemOrders).length > 0),
  };
}
