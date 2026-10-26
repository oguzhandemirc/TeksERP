import { useEffect, useRef, type MouseEvent } from "react";
import { Sidebar } from "./Sidebar";
import { useTabsStore } from "@/store/tabs";

interface Props {
  /** Dar kabuk (≤1024 px): kenar çubuğu yerleşimden çıkar, hamburgerle açılan çekmece olur. */
  narrow: boolean;
  /** Geniş kabukta ikon rayı mı (kullanıcı tercihi, localStorage). */
  collapsed: boolean;
  drawerOpen: boolean;
  onCloseDrawer: () => void;
}

/**
 * Kabuk kenar çubuğu yerleşimi. Geniş ekranda bugünkü satır-içi çubuk; dar ekranda
 * içeriği daraltmayan, karartmalı çekmece. Çekmece seçimde/karartmada/Esc'te kapanır —
 * açık kalıp sekme diyaloğunun üstünde durmasın (UX-1 R1/R2).
 */
export function ShellSidebar({ narrow, collapsed, drawerOpen, onCloseDrawer }: Props) {
  const activePath = useTabsStore((s) => s.tabs.find((t) => t.id === s.activeId)?.path);

  // Yalnız sekme yolu DEĞİŞİNCE kapanır (açılış anında değil).
  const lastPath = useRef(activePath);
  useEffect(() => {
    if (lastPath.current === activePath) return;
    lastPath.current = activePath;
    if (narrow && drawerOpen) onCloseDrawer();
  }, [activePath, narrow, drawerOpen, onCloseDrawer]);

  useEffect(() => {
    if (!narrow || !drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseDrawer();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [narrow, drawerOpen, onCloseDrawer]);

  if (!narrow) return <Sidebar collapsed={collapsed} />;
  if (!drawerOpen) return null;

  // Menü satırına tıklama sekmeyi değiştirmese de (aynı sayfa) çekmece kapanır.
  const onNavClick = (e: MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("nav button")) onCloseDrawer();
  };

  return (
    <>
      <div
        data-testid="sidebar-drawer-backdrop"
        aria-hidden
        className="absolute inset-0 z-40 bg-black/50"
        onClick={onCloseDrawer}
      />
      <div
        data-testid="sidebar-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Menü"
        className="absolute inset-y-0 left-0 z-50 flex max-w-[85vw] bg-background shadow-2xl"
        onClick={onNavClick}
      >
        <Sidebar collapsed={false} />
      </div>
    </>
  );
}
