import type { KeyboardEvent, ReactNode } from "react";
import { ExternalLink, PanelTop, Star, StarOff } from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useTabsStore } from "@/store/tabs";
import { useFavorites } from "@/hooks/useFavorites";
import { useSidebarHold } from "./sidebar-hover";

const MOD = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform) ? "⌘" : "Ctrl";

/** Shift+F10 / menü tuşu → odaklı öğede `contextmenu` (mac yerelde üretmez; Windows'ta yerel üretim bastırılır). */
function openFromKeyboard(e: KeyboardEvent<HTMLElement>) {
  if (e.key !== "ContextMenu" && !(e.shiftKey && e.key === "F10")) return;
  e.preventDefault();
  const r = e.currentTarget.getBoundingClientRect();
  e.currentTarget.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.left + 24, clientY: r.bottom }));
}

/**
 * Menü öğesine sağ tık (ya da Shift+F10 / menü tuşu) → "Yeni sekmede aç · Bu sekmede aç · Favori".
 * Bilinçli eylemlerdir: sekme açma tercihinden (`decideTabOpen`) etkilenmez. Kapalı modül satırı sarılmaz.
 */
export function NavContextMenu({ to, label, disabled, children }: { to: string; label: string; disabled?: boolean; children: ReactNode }) {
  const openTab = useTabsStore((s) => s.openTab);
  const navigateActive = useTabsStore((s) => s.navigateActive);
  const hold = useSidebarHold();
  if (disabled) return <>{children}</>;
  return (
    <ContextMenu onOpenChange={hold}>
      <ContextMenuTrigger asChild onKeyDown={openFromKeyboard}>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent aria-label={`${label} seçenekleri`} className="min-w-52">
        <ContextMenuItem onSelect={() => openTab(to, { forceNew: true })}>
          <ExternalLink />
          Yeni sekmede aç
          <ContextMenuShortcut className="pl-4 tracking-normal">{MOD}+tık</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => navigateActive(to)}>
          <PanelTop />
          Bu sekmede aç
        </ContextMenuItem>
        <ContextMenuSeparator />
        <FavoriteItem to={to} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** Yalnız menü açıkken bağlanır — favori listesine her menü satırı abone olmasın. */
function FavoriteItem({ to }: { to: string }) {
  const { isFavorite, toggleFavorite } = useFavorites();
  const fav = isFavorite(to);
  return (
    <ContextMenuItem onSelect={() => toggleFavorite(to)}>
      {fav ? <StarOff /> : <Star />}
      {fav ? "Favorilerden çıkar" : "Favorilere ekle"}
    </ContextMenuItem>
  );
}
