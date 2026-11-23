import { useLayoutEffect } from "react";
import { useTabsStore, selectActivePath } from "@/store/tabs";
import type { NavGroup } from "./nav-config";
import {
  bindPendingMenuClick,
  effectiveMenuContext,
  groupOwner,
  resolveMenuPlacement,
  useMenuContextStore,
  type MenuPlacement,
} from "./menu-context";

/**
 * Menünün bütün tıklanabilir konumları, kanonik öncelik sırasıyla: ekranın kendi kökü önce, çapraz listelendiği
 * kök sonra, Favoriler en sonda — bağlamsız açılışta (komut paleti, doğrudan adres) ekran kendi yerinde yanar.
 */
export function menuPlacements(groups: readonly NavGroup[]): MenuPlacement[] {
  const ordered = [...groups.filter((g) => g.label !== "Favoriler"), ...groups.filter((g) => g.label === "Favoriler")];
  const home: MenuPlacement[] = [];
  const cross: MenuPlacement[] = [];
  const fav: MenuPlacement[] = [];
  for (const g of ordered) {
    for (const i of g.items) {
      (g.label === "Favoriler" ? fav : home).push({ owner: groupOwner(g.label), to: i.to });
      for (const c of i.children ?? []) (c.crossListed ? cross : home).push({ owner: i.to, to: c.to });
    }
  }
  return [...home, ...cross, ...fav];
}

/** Etkin menü konumu + bekleyen tıkı etkin sekmeye bağlama (boyamadan önce: titreme yok). */
export function useMenuPlacement(groups: readonly NavGroup[]): MenuPlacement | null {
  const activeId = useTabsStore((s) => s.activeId);
  const activePath = useTabsStore(selectActivePath);
  const tabIds = useTabsStore((s) => s.tabs).map((t) => t.id).join(",");
  const ctx = useMenuContextStore((s) => effectiveMenuContext(s, activeId, activePath));
  const pending = useMenuContextStore((s) => s.pending);
  useLayoutEffect(() => {
    if (pending) bindPendingMenuClick(activeId, activePath, tabIds ? tabIds.split(",") : []);
  }, [pending, activeId, activePath, tabIds]);

  return resolveMenuPlacement(menuPlacements(groups), activePath, ctx);
}
