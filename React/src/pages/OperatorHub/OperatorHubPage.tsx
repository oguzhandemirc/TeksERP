import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Cog,
  Ticket,
  Truck,
  PackageCheck,
  Shield,
  CircleDot,
  Boxes,
  ScanLine,
  LayoutGrid,
} from "lucide-react";
import StationPanel from "./panels/StationPanel";
import DispatchPanel from "./panels/DispatchPanel";
import ReceivePanel from "./panels/ReceivePanel";
import QC2Panel from "./panels/QC2Panel";
import SplitAllocatePanel from "./panels/SplitAllocatePanel";
import TamburPage from "@/pages/Tambur/TamburPage";
import KK1Page from "@/pages/KK1/KK1Page";
import TravelerCardScanPage from "@/pages/TravelerCards/TravelerCardScanPage";

type TabDef = {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  component: React.ComponentType;
};

const TABS: TabDef[] = [
  {
    id: "station",
    label: "İstasyon",
    description: "Top barkodu ile başlat/bitir/atla + planlama notu",
    icon: Cog,
    component: StationPanel,
  },
  {
    id: "traveler",
    label: "Refakat Kartı",
    description: "Refakat kartı barkodu ile gelış/gidiş taraması",
    icon: Ticket,
    component: TravelerCardScanPage,
  },
  {
    id: "dispatch",
    label: "Fason Sevk",
    description: "Toplar seç, fasona sevk belgesi üret",
    icon: Truck,
    component: DispatchPanel,
  },
  {
    id: "receive",
    label: "Fason Kabul",
    description: "Bekleyen iadeleri seç, irsaliye ile kabul et",
    icon: PackageCheck,
    component: ReceivePanel,
  },
  {
    id: "kursun",
    label: "Kurşun (KK2)",
    description: "Tuş takımı ile hata metrajı gir",
    icon: Shield,
    component: QC2Panel,
  },
  {
    id: "tambur",
    label: "Tambur",
    description: "Bekleyen top → kat/kartela/kesim/paylaştırma",
    icon: CircleDot,
    component: TamburPage,
  },
  {
    id: "allocate",
    label: "Paylaştırma",
    description: "Bir topu birden fazla siparişe ve/veya stoka böl",
    icon: Boxes,
    component: SplitAllocatePanel,
  },
  {
    id: "kk1",
    label: "Ham Stok (KK1)",
    description: "Yeni ham top girişi ve etiket basımı",
    icon: ScanLine,
    component: KK1Page,
  },
];

export default function OperatorHubPage() {
  const [activeId, setActiveId] = useState<string>("station");
  const activeTab = TABS.find((t) => t.id === activeId) ?? TABS[0];
  const ActiveComponent = activeTab.component;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <LayoutGrid className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Operatör Merkezi</h1>
          <p className="text-sm text-muted-foreground">
            Tüm saha/istasyon ekranları — admin kullanıcısı ile tek noktadan
            test edilir.
          </p>
        </div>
      </div>

      {/* Tab Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = t.id === activeId;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveId(t.id)}
              title={t.description}
              className={`flex flex-col items-center justify-center gap-1 rounded-lg border px-2 py-3 text-xs font-medium transition-colors cursor-pointer ${
                active
                  ? "border-primary bg-primary/10 ring-2 ring-primary/30 text-foreground"
                  : "bg-card hover:bg-muted/50 text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-5 w-5" />
              <span className="text-center leading-tight">{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* Active Panel */}
      <div className="rounded-lg border bg-card p-4 min-h-[50vh]">
        <div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
          <activeTab.icon className="h-4 w-4" />
          <span className="font-medium text-foreground">{activeTab.label}</span>
          <span className="truncate">— {activeTab.description}</span>
        </div>
        <ActiveComponent />
      </div>
    </div>
  );
}
