// Kutu görünüm meta verisi — simge, ton ve önizleme iskeleti türü. Katalog (başlık/açıklama/boyut) sunucudan gelir;
// burada olmayan yeni bir sunucu kutusu genel simgeyle çekmecede görünür ama çizicisi yoksa panoda çizilmez.
import {
  Activity, BarChart3, Boxes, CalendarDays, ClipboardList, Coins, Factory, FileClock, Gauge, LayoutGrid, LineChart, ListOrdered,
  PackageOpen, PieChart, Send, ShieldCheck, Trophy, Truck, Users, Wallet, Warehouse, Waves, Workflow, Zap, type LucideIcon,
} from "lucide-react";
import type { IconTileTone } from "@/components/ui/icon-tile";
import type { PanoBoxGroup } from "./box-types";

export type PreviewKind = "kpi" | "area" | "bars" | "hbars" | "donut" | "list" | "calendar" | "tiles";

export interface BoxMeta { icon: LucideIcon; tone: IconTileTone; preview: PreviewKind }

export const BOX_META: Record<string, BoxMeta> = {
  uretim: { icon: Factory, tone: "violet", preview: "kpi" },
  sevk: { icon: Truck, tone: "green", preview: "kpi" },
  siparis: { icon: ClipboardList, tone: "blue", preview: "kpi" },
  fason: { icon: Send, tone: "orange", preview: "kpi" },
  stok: { icon: Boxes, tone: "teal", preview: "kpi" },
  ciro: { icon: Coins, tone: "amber", preview: "kpi" },
  tahsilat: { icon: Wallet, tone: "sky", preview: "kpi" },
  egilim: { icon: LineChart, tone: "violet", preview: "area" },
  dagilim: { icon: PieChart, tone: "blue", preview: "donut" },
  enCok: { icon: Trophy, tone: "amber", preview: "list" },
  enCokMusteri: { icon: Users, tone: "rose", preview: "list" },
  uretimIstasyon: { icon: Workflow, tone: "violet", preview: "hbars" },
  isEmriDurum: { icon: Gauge, tone: "orange", preview: "donut" },
  kalite: { icon: ShieldCheck, tone: "green", preview: "donut" },
  tezgah: { icon: Waves, tone: "teal", preview: "list" },
  stokOzeti: { icon: Warehouse, tone: "teal", preview: "list" },
  stokHareket: { icon: BarChart3, tone: "sky", preview: "bars" },
  fasonOzeti: { icon: Send, tone: "orange", preview: "list" },
  emanet: { icon: PackageOpen, tone: "amber", preview: "list" },
  bekleyen: { icon: FileClock, tone: "sky", preview: "list" },
  ajanda: { icon: CalendarDays, tone: "blue", preview: "calendar" },
  finans: { icon: Wallet, tone: "violet", preview: "list" },
  nakitAkisi: { icon: Coins, tone: "green", preview: "bars" },
  sonHareketler: { icon: ListOrdered, tone: "blue", preview: "list" },
  hizliIslemler: { icon: Zap, tone: "amber", preview: "tiles" },
  istasyonDoluluk: { icon: Activity, tone: "teal", preview: "tiles" },
};

export const FALLBACK_META: BoxMeta = { icon: LayoutGrid, tone: "primary", preview: "list" };

export const metaOf = (key: string): BoxMeta => BOX_META[key] ?? FALLBACK_META;

export const GROUP_LABEL: Record<PanoBoxGroup, string> = {
  uretim: "Üretim",
  satis: "Satış ve sevk",
  stok: "Stok",
  fason: "Fason",
  finans: "Finans",
  genel: "Genel",
};

export const GROUP_ORDER: readonly PanoBoxGroup[] = ["uretim", "satis", "stok", "fason", "finans", "genel"];
