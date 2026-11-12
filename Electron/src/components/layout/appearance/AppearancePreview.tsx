import { Bell, Boxes, Factory, Home, ShoppingCart, Truck } from "lucide-react";
import { IconTile, type IconTileTone } from "@/components/ui/icon-tile";
import { appearanceAttributes, customColorVars, type Appearance } from "@/lib/theme/appearance";
import { cn } from "@/lib/utils";

const NAV: { label: string; icon: typeof Home; tone: IconTileTone }[] = [
  { label: "Anasayfa", icon: Home, tone: "violet" },
  { label: "Satış", icon: ShoppingCart, tone: "blue" },
  { label: "Üretim", icon: Factory, tone: "orange" },
  { label: "Depo", icon: Boxes, tone: "teal" },
  { label: "Sevkiyat", icon: Truck, tone: "green" },
];
const ROWS = [
  ["SP-1042", "Hazırlanıyor"],
  ["SP-1041", "Sevk edildi"],
  ["SP-1040", "Bekliyor"],
];

/**
 * Canlı önizleme — seçimler kökten bağımsız bu kutunun `data-*` kapsamında çizilir (index.css her
 * eksenin varsayılanını da açıkça yazar). Yazı boyutu kök font ölçeğidir; önizlemede değil, panelde görünür.
 */
export function AppearancePreview({ appearance }: { appearance: Appearance }) {
  const vars = appearance.preset === "custom" ? customColorVars(appearance.customColor) : null;
  return (
    <div
      {...appearanceAttributes(appearance)}
      style={vars ?? undefined}
      aria-hidden="true"
      data-testid="appearance-preview"
      className="app-bg flex h-64 overflow-hidden rounded-xl border border-card-border text-foreground"
    >
      <div data-sidebar-root className="flex w-32 shrink-0 flex-col gap-1 border-r border-sidebar-border bg-sidebar p-2 text-sidebar-foreground">
        {NAV.map((n, i) => (
          <div
            key={n.label}
            data-nav-active={i === 1 ? "true" : undefined}
            className={cn("flex items-center gap-2 rounded-md px-1.5 py-1 text-[11px]", i === 1 ? "nav-active-fill font-semibold" : "")}
          >
            <IconTile icon={n.icon} tone={n.tone} size="xs" />
            {n.label}
          </div>
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2 p-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-bold">Siparişler</p>
            <p className="text-[10px] text-muted-foreground">Açık siparişler ve durumları</p>
          </div>
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-card-border bg-card">
            <Bell className="h-3 w-3" />
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <MiniStat label="Açık sipariş" value="24" tone="blue" />
          <MiniStat label="Bu hafta sevk" value="9" tone="green" />
        </div>
        <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-card-border bg-card">
          {ROWS.map(([no, st], i) => (
            <div key={no} className="flex items-center justify-between border-b border-card-border px-2 text-[10px] last:border-0" style={{ paddingBlock: "calc(var(--cell-py) / 2)" }}>
              <span className="font-medium">{no}</span>
              <span className={cn("rounded-full px-1.5 py-0.5", i === 1 ? "bg-success-soft text-success-soft-foreground" : "bg-primary-soft text-primary-soft-foreground")}>{st}</span>
            </div>
          ))}
        </div>
        <div className="flex justify-end">
          <span className="rounded-md bg-primary px-2.5 py-1 text-[10px] font-semibold text-primary-foreground">Yeni sipariş</span>
        </div>
      </div>
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone: IconTileTone }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-card-border bg-card p-2">
      <IconTile icon={tone === "blue" ? ShoppingCart : Truck} tone={tone} size="xs" />
      <div>
        <p className="text-[9px] text-muted-foreground">{label}</p>
        <p className="text-sm font-bold leading-none">{value}</p>
      </div>
    </div>
  );
}
