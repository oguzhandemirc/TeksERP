import {
  ChartArea,
  ChartBarBig,
  ChartColumnBig,
  ChartColumnStacked,
  ChartLine,
  ChartNoAxesCombined,
  ChartScatter,
  Columns2,
  Donut,
  Grid3x3,
  ImageDown,
  LayoutGrid,
  Maximize2,
  Rows2,
  Tags,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { KIND_LABEL, type ChartKind, type KindOption } from "./gorunum";

const KIND_ICON: Readonly<Record<ChartKind, LucideIcon>> = {
  line: ChartLine,
  area: ChartArea,
  bar: ChartColumnBig,
  hbar: ChartBarBig,
  stacked: ChartColumnStacked,
  donut: Donut,
  treemap: LayoutGrid,
  heatmap: Grid3x3,
  pareto: ChartNoAxesCombined,
  scatter: ChartScatter,
  native: ChartColumnBig,
};

interface Props {
  options: KindOption[];
  kind: ChartKind;
  onKind: (k: ChartKind) => void;
  labels: boolean;
  onLabels: () => void;
  /** Tablo varsa yerleşim düğmesi: yan yana ↔ üst üste. */
  layout?: "side" | "stacked";
  onLayout?: () => void;
  onExpand?: () => void;
  onPng?: () => void;
}

const ICON_BTN = "h-7 w-7 rounded-md text-muted-foreground hover:text-foreground";

/** Grafik kartının araç çubuğu: tür seçici (uymayan tür pasif + neden), etiket, yerleşim, büyüt, PNG. */
export function ChartToolbar({ options, kind, onKind, labels, onLabels, layout, onLayout, onExpand, onPng }: Props) {
  const selectable = options.length > 1;
  return (
    <div className="flex flex-wrap items-center gap-1" role="toolbar" aria-label="Grafik seçenekleri">
      {selectable ? (
        <div className="flex items-center gap-0.5 rounded-lg border bg-muted/40 p-0.5" role="radiogroup" aria-label="Grafik türü">
          {options.map((o) => {
            const Icon = KIND_ICON[o.kind];
            const active = o.kind === kind;
            return (
              <button
                key={o.kind}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={KIND_LABEL[o.kind]}
                title={o.enabled ? KIND_LABEL[o.kind] : `${KIND_LABEL[o.kind]} — ${o.reason}`}
                disabled={!o.enabled}
                onClick={() => onKind(o.kind)}
                data-kind={o.kind}
                className={cn(
                  "inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-card hover:text-foreground",
                  !o.enabled && "cursor-not-allowed opacity-30 hover:bg-transparent hover:text-muted-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
              </button>
            );
          })}
        </div>
      ) : null}
      <Button type="button" variant="ghost" size="icon" className={cn(ICON_BTN, labels && "bg-primary/10 text-primary")} aria-pressed={labels} aria-label="Veri etiketleri" title="Veri etiketleri" onClick={onLabels}>
        <Tags className="h-4 w-4" />
      </Button>
      {onLayout ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={ICON_BTN}
          aria-label={layout === "stacked" ? "Grafik ve tablo yan yana" : "Grafik ve tablo üst üste"}
          title={layout === "stacked" ? "Grafik ve tablo yan yana" : "Grafik ve tablo üst üste"}
          onClick={onLayout}
        >
          {layout === "stacked" ? <Columns2 className="h-4 w-4" /> : <Rows2 className="h-4 w-4" />}
        </Button>
      ) : null}
      {onExpand ? (
        <Button type="button" variant="ghost" size="icon" className={ICON_BTN} aria-label="Grafiği büyüt" title="Grafiği büyüt" onClick={onExpand}>
          <Maximize2 className="h-4 w-4" />
        </Button>
      ) : null}
      {onPng ? (
        <Button type="button" variant="ghost" size="icon" className={ICON_BTN} aria-label="PNG olarak indir" title="PNG olarak indir" onClick={onPng}>
          <ImageDown className="h-4 w-4" />
        </Button>
      ) : null}
    </div>
  );
}
