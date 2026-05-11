import { useState } from "react";
import { Package, Cog, Send, Truck, Archive, Palette } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { RefreshButton } from "@/components/RefreshButton";
import { RollsTable } from "./RollsTable";
import { SwatchesPanel } from "./SwatchesPanel";
import type { RollStatusTabKey } from "./service";

type RollTabKey = RollStatusTabKey | "SWATCH";

const QUERY_KEY = "rolls";

const TABS: Array<{ key: RollTabKey; label: string; Icon: typeof Package }> = [
  { key: "STOCK",         label: "Stokta",      Icon: Package },
  { key: "PRODUCTION",    label: "Üretimde",    Icon: Cog },
  { key: "SUBCONTRACTOR", label: "Fasonda",     Icon: Send },
  { key: "READY",         label: "Sevke Hazır", Icon: Truck },
  { key: "ARCHIVE",       label: "Arşiv",       Icon: Archive },
  { key: "SWATCH",        label: "Kartela",     Icon: Palette },
];

export function RollsPage() {
  const [tab, setTab] = useState<RollTabKey>("STOCK");

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Toplar"
        description="Envanterdeki ve üretimdeki tüm topların listesi."
        actions={<RefreshButton queryKey={QUERY_KEY} />}
      />
      <div className="flex items-center gap-1 border-b px-3 pt-2">
        {TABS.map(({ key, label, Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 border-b-2 px-3 py-1.5 text-xs font-medium transition-colors ${
              tab === key
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>
      {tab === "SWATCH" ? <SwatchesPanel /> : <RollsTable tab={tab} />}
    </div>
  );
}
