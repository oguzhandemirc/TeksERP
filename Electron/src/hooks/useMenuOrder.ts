import { useCallback } from "react";
import { usePreferences } from "@/providers/PreferencesProvider";

// Sidebar menü öğelerinin grup-içi sırası — kullanıcı tercihlerinde (backend,
// AppPreferences.menuOrder) saklanır. Sırada olmayan öğeler sona düşer.

export function useMenuOrder() {
  const { prefs, setPreference } = usePreferences();

  /** Bir grubun öğelerini kayıtlı sıraya göre dizer (stabil; eksikler sonda). */
  const orderItems = useCallback(
    <T extends { to: string }>(groupLabel: string, items: T[]): T[] => {
      const ord = prefs.menuOrder?.[groupLabel];
      if (!ord || ord.length === 0) return items;
      const rank = (to: string) => {
        const i = ord.indexOf(to);
        return i < 0 ? Number.MAX_SAFE_INTEGER : i;
      };
      return [...items].sort((a, b) => rank(a.to) - rank(b.to));
    },
    [prefs.menuOrder],
  );

  const setGroupOrder = useCallback(
    (groupLabel: string, order: string[]) => {
      setPreference({ menuOrder: { ...(prefs.menuOrder ?? {}), [groupLabel]: order } });
    },
    [prefs.menuOrder, setPreference],
  );

  return { orderItems, setGroupOrder };
}
