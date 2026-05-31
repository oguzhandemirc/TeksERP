import { useCallback } from "react";
import { usePreferences } from "@/providers/PreferencesProvider";
import {
  DEFAULT_GROUP_ORDER,
  getDefaultItemOrder,
  type GroupKey,
} from "./widgetRegistry";

// Dashboard widget düzeni (gizli widget'lar + grup/öğe sırası) — kullanıcı
// tercihlerinde (backend, AppPreferences.dashboard) saklanır, cihazdan bağımsız.

type ItemOrders = Partial<Record<GroupKey, string[]>>;

/** Stored list + default list'i birleştirir; eksik öğeleri default sırada sona ekler. */
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
  const { prefs, setPreference } = usePreferences();
  const dash = prefs.dashboard;
  const storedGroupOrder = dash?.groupOrder as GroupKey[] | undefined;
  const itemOrders = dash?.itemOrders as ItemOrders | undefined;

  const patch = useCallback(
    (next: Partial<{ hidden: string[]; groupOrder: GroupKey[]; itemOrders: ItemOrders }>) => {
      setPreference({ dashboard: { ...(prefs.dashboard ?? {}), ...next } });
    },
    [prefs.dashboard, setPreference],
  );

  const groupOrder: GroupKey[] = mergeOrder<GroupKey>(storedGroupOrder, DEFAULT_GROUP_ORDER);

  const itemOrder = useCallback(
    (groupKey: GroupKey): string[] =>
      mergeOrder(itemOrders?.[groupKey], getDefaultItemOrder(groupKey)),
    [itemOrders],
  );

  const isVisible = useCallback(
    (key: string) => !(dash?.hidden ?? []).includes(key),
    [dash?.hidden],
  );

  const setVisible = useCallback(
    (key: string, visible: boolean) => {
      const set = new Set(dash?.hidden ?? []);
      if (visible) set.delete(key);
      else set.add(key);
      patch({ hidden: [...set] });
    },
    [dash?.hidden, patch],
  );

  const setGroupOrder = useCallback((order: GroupKey[]) => patch({ groupOrder: order }), [patch]);

  const setItemOrder = useCallback(
    (groupKey: GroupKey, order: string[]) =>
      patch({ itemOrders: { ...(itemOrders ?? {}), [groupKey]: order } }),
    [itemOrders, patch],
  );

  const reset = useCallback(() => setPreference({ dashboard: {} }), [setPreference]);

  const hidden = dash?.hidden ?? [];
  return {
    isVisible,
    setVisible,
    groupOrder,
    setGroupOrder,
    itemOrder,
    setItemOrder,
    reset,
    hiddenCount: hidden.length,
    customized:
      hidden.length > 0 ||
      storedGroupOrder !== undefined ||
      (itemOrders != null && Object.keys(itemOrders).length > 0),
  };
}
