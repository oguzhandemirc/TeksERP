import { useEffect, useState } from "react";
import { LayoutGrid } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTabsStore, type TabItem } from "@/store/tabs";
import { TabStrip } from "./TabStrip";
import { TabRouter } from "./TabRouter";
import { TabActiveProvider } from "./tab-active";
import { TabPortalProvider } from "./tab-portal";

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
          <TabPane key={tab.id} tab={tab} active={tab.id === activeId} />
        ))}
        {tabs.length === 0 && <EmptyTabs onOpen={() => openTab("/")} />}
      </div>
    </div>
  );
}

/**
 * Tek sekme katmanı. Dış kutu (`container`) konumlu ama kaymaz — modal/sheet
 * portallarının hedefi budur; portallanan overlay `absolute inset-0` ile bu
 * kutuyu sabit kaplar (iç içerik kaysa bile yerinde kalır). Sayfanın kaydırması
 * iç katmanda olur. Pasif sekme `invisible` olduğundan içindeki açık modal da
 * sekmeyle birlikte gizlenir; mount kaldığı için geri dönülünce state korunur.
 */
function TabPane({ tab, active }: { tab: TabItem; active: boolean }) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  return (
    <div
      ref={setContainer}
      aria-hidden={!active}
      className={cn(
        "tab-pane absolute inset-0",
        active ? "z-10" : "invisible pointer-events-none",
      )}
    >
      <div className="absolute inset-0 overflow-auto">
        <TabActiveProvider value={active}>
          <TabPortalProvider value={container}>
            <TabRouter id={tab.id} path={tab.path} />
          </TabPortalProvider>
        </TabActiveProvider>
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
