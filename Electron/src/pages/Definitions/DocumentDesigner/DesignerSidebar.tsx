import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { DesignerRefs } from "./useDesignerEditor";

export type SidebarTab = "style" | "traits" | "data" | "page" | "settings" | "layers";

const TABS: Array<{ key: SidebarTab; label: string }> = [
  { key: "style", label: "Stil" },
  { key: "traits", label: "Özellikler" },
  { key: "data", label: "Veri" },
  { key: "page", label: "Sayfa" },
  { key: "settings", label: "Belge ayarları" },
  { key: "layers", label: "Katmanlar" },
];

interface Props {
  refs: DesignerRefs;
  tab: SidebarTab;
  onTab: (t: SidebarTab) => void;
  /** Özellikler sekmesinin üstü: yönerge bağlama paneli (GrapesJS öznitelikleri altında kalır). */
  binding: ReactNode;
  panels: Partial<Record<"data" | "page" | "settings", ReactNode>>;
}

/**
 * Sağ panel. GrapesJS kapları DOM'da KALIR (yalnız gizlenir): yöneticiler bu kaplara
 * bir kez çizilir; sökülürse editörün görünümü kopar. React panelleri sekmeyle çizilir.
 */
export function DesignerSidebar({ refs, tab, onTab, binding, panels }: Props) {
  return (
    <aside className="flex w-[22rem] shrink-0 flex-col border-l bg-card" aria-label="Tasarım paneli">
      <div role="tablist" className="grid grid-cols-3 border-b">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => onTab(t.key)}
            className={cn(
              "px-2 py-2 text-xs font-medium transition-colors",
              tab === t.key ? "border-b-2 border-primary text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={cn(tab !== "style" && "hidden")}>
          <div ref={refs.selectors} />
          <div ref={refs.styles} />
        </div>
        <div className={cn(tab !== "traits" && "hidden")}>
          {binding}
          <h4 className="px-3 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Öznitelikler</h4>
          <div ref={refs.traits} />
        </div>
        {tab === "data" && panels.data}
        {tab === "page" && panels.page}
        {tab === "settings" && panels.settings}
        <div ref={refs.layers} className={cn(tab !== "layers" && "hidden")} />
      </div>
    </aside>
  );
}
