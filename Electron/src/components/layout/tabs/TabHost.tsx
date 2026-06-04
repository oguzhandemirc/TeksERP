import { useEffect } from "react";
import { LayoutGrid } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTabsStore } from "@/store/tabs";
import { TabStrip } from "./TabStrip";
import { TabRouter } from "./TabRouter";

/**
 * Sekme barındırıcı. Açık tüm sekmeler aynı anda mount kalır; yalnız aktif olan
 * görünür (`visibility:hidden` ile pasifler layout/scroll/sorgularını korur).
 * Her sekme kendi memory router'ında yaşadığından konum/filtre izole olur.
 */
export function TabHost() {
  const tabs = useTabsStore((s) => s.tabs);
  const activeId = useTabsStore((s) => s.activeId);
  const openTab = useTabsStore((s) => s.openTab);

  // İlk açılış: sekme yoksa mevcut hash yolundan (yoksa Anasayfa) bir sekme aç.
  useEffect(() => {
    if (useTabsStore.getState().tabs.length > 0) return;
    const hash = window.location.hash.replace(/^#/, "");
    const usable =
      hash && hash !== "/" && !hash.startsWith("/login") && !hash.startsWith("/forbidden")
        ? hash
        : "/";
    openTab(usable);
  }, [openTab]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TabStrip />
      <div className="relative min-h-0 flex-1">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            aria-hidden={tab.id !== activeId}
            className={cn(
              "absolute inset-0 overflow-auto",
              tab.id === activeId ? "z-10" : "invisible pointer-events-none",
            )}
          >
            <TabRouter id={tab.id} path={tab.path} />
          </div>
        ))}
        {tabs.length === 0 && <EmptyTabs onOpen={() => openTab("/")} />}
      </div>
    </div>
  );
}

function EmptyTabs({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
      <LayoutGrid className="h-8 w-8 opacity-40" />
      <p className="text-sm">Açık sekme yok.</p>
      <button
        type="button"
        onClick={onOpen}
        className="rounded-md border border-border/60 px-3 py-1.5 text-sm transition-colors hover:bg-accent/60 hover:text-foreground"
      >
        Anasayfayı aç
      </button>
    </div>
  );
}
