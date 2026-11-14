// Grup katlama durumu — görünüm tercihi, iş verisi değil: kullanıcı başına `localStorage`da (makineye bağlı).
// Depolama kapalıysa (gizli pencere) tercih tutulmaz, ekran yine çalışır.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { NotificationGroup } from "@/lib/bildirim/types";
import { useAuthStore } from "@/store/auth";
import { filterKinds, groupKinds } from "./model";

export function collapseStorageKey(scope: string, userId: string | null): string {
  return `bildirimProfil.daraltilan.${scope}.${userId ?? "anon"}`;
}

export function readCollapsed(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    const v: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function writeCollapsed(key: string, value: ReadonlySet<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify([...value].sort()));
  } catch {
    /* sessiz: kalıcılık kaybı ekranı bozmaz */
  }
}

/** Varsayılan: hepsi açık (bugünkü görünüm); kullanıcı daralttığını hatırlar. */
export function useCollapsedGroups(scope: string) {
  const userId = useAuthStore((s) => s.user?.userId ?? null);
  const key = collapseStorageKey(scope, userId);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => readCollapsed(key));
  useEffect(() => setCollapsed(readCollapsed(key)), [key]);

  const commit = useCallback(
    (next: Set<string>) => {
      setCollapsed(next);
      writeCollapsed(key, next);
    },
    [key],
  );
  const toggle = useCallback(
    (grup: string) => {
      const next = new Set(collapsed);
      if (next.has(grup)) next.delete(grup);
      else next.add(grup);
      commit(next);
    },
    [collapsed, commit],
  );
  const setAll = useCallback((groups: readonly string[], fold: boolean) => commit(fold ? new Set(groups) : new Set()), [commit]);
  return { collapsed, toggle, setAll };
}

/** İki sekmenin ortak gezinme durumu: arama + katlama. Arama varken eşleşen gruplar zorla açık gösterilir. */
export function useKindBrowse<T extends { tur: string; grup: NotificationGroup; ad: string }>(kinds: readonly T[], scope: string) {
  const [query, setQuery] = useState("");
  const { collapsed, toggle, setAll } = useCollapsedGroups(scope);
  const searching = query.trim().length > 0;
  const allGroups = useMemo(() => groupKinds(kinds).map((g) => g.grup), [kinds]);
  const groups = groupKinds(filterKinds(kinds, query));
  const shown = groups.reduce((n, g) => n + g.items.length, 0);
  const isOpen = (grup: string) => searching || !collapsed.has(grup);
  const foldAll = (fold: boolean) => setAll(allGroups, fold);
  return { query, setQuery, searching, groups, shown, isOpen, toggle, foldAll };
}
