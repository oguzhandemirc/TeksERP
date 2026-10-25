import { useState } from "react";
import { cn } from "@/lib/utils";
import type { DesignerRefs } from "./useDesignerEditor";

type TabKey = "style" | "traits" | "layers";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "style", label: "Stil" },
  { key: "traits", label: "Özellikler" },
  { key: "layers", label: "Katmanlar" },
];

/**
 * Sağ panel. Sekme içerikleri DOM'da KALIR (yalnız gizlenir): GrapesJS
 * yöneticileri bu kaplara bir kez çizilir; sökülürse editörün görünümü kopar.
 */
export function DesignerSidebar({ refs }: { refs: DesignerRefs }) {
  const [tab, setTab] = useState<TabKey>("style");
  return (
    <aside className="flex w-80 shrink-0 flex-col border-l bg-card" aria-label="Tasarım paneli">
      <div role="tablist" className="flex border-b">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "flex-1 px-2 py-2 text-xs font-medium transition-colors",
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
        <div ref={refs.traits} className={cn(tab !== "traits" && "hidden")} />
        <div ref={refs.layers} className={cn(tab !== "layers" && "hidden")} />
      </div>
    </aside>
  );
}
