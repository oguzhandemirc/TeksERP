import { useMemo, useRef, useState } from "react";
import { ChartColumnBig } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { saveBlobAs } from "@/lib/file-save";
import { slugifyFileName } from "../../../_components/reportExport";
import type { GrafikBlok } from "../../sunum";
import { GRAFIK_VERI_YOK, grafikBosMu, unitText } from "../bicim";
import type { Egilim } from "../secenek";
import { ChartCanvas, type ChartCanvasHandle } from "./ChartCanvas";
import { ChartToolbar } from "./ChartToolbar";
import { chartHeight } from "./ekranSecenek";
import { chartShape, kindOptions, resolveKind, type ChartKind } from "./gorunum";

export interface ChartViewState {
  kind?: ChartKind;
  labels?: boolean;
  layout?: "side" | "stacked";
}

interface Props {
  blok: GrafikBlok;
  /** Rapor başlığı — kart başlığı, PNG dosya adı ve ekran okuyucu adı. */
  title: string;
  view: ChartViewState;
  onView: (patch: ChartViewState) => void;
  /** Tablo da çiziliyorsa yerleşim düğmesi görünür. */
  hasTable?: boolean;
  egilim?: Egilim | null;
  height?: number;
}

/** data URL → Blob (fetch'e gitmeden; CSP connect-src `data:` açmaz). */
function dataUrlBlob(url: string): Blob {
  const [head, body] = url.split(",");
  const bin = atob(body ?? "");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: /data:([^;]+)/.exec(head ?? "")?.[1] ?? "image/png" });
}

/** Kıyas serisinin görünmediği türler — kullanıcıya söylenir (seri sessizce kaybolmasın). */
const NO_COMPARE: readonly ChartKind[] = ["donut", "treemap", "pareto", "heatmap"];

/**
 * Rapor grafiği kartı (yalnız ekran): veri şekline uyan türler arasında seçim, veri etiketi, grafik/tablo
 * yerleşimi, tam ekran, PNG. PDF/Excel sunucunun `tur`unu çizer — burada seçilen tür çıktıya GİTMEZ.
 */
export function ReportChartCard({ blok, title, view, onView, hasTable = false, egilim, height = 320 }: Props) {
  const canvas = useRef<ChartCanvasHandle>(null);
  const [expanded, setExpanded] = useState(false);
  const empty = grafikBosMu(blok);
  const options = useMemo(() => kindOptions(blok), [blok]);
  const kind = resolveKind(blok, view.kind);
  const labels = view.labels === true;
  const shape = chartShape(blok);
  const unit = unitText(blok.eksen.y.birim);

  const savePng = async () => {
    const url = canvas.current?.toPng();
    if (!url) return;
    try {
      if (await saveBlobAs(dataUrlBlob(url), `${slugifyFileName(title)}-grafik.png`)) toast.success("Grafik kaydedildi.");
    } catch {
      toast.error("Grafik kaydedilemedi.");
    }
  };

  return (
    <section className="min-w-0 rounded-xl border border-card-border bg-card p-4 shadow-card" aria-label="Grafik" data-testid="report-chart-card">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold">
          <ChartColumnBig className="h-4 w-4 shrink-0 text-primary" aria-hidden />
          <span className="truncate">
            {blok.eksen.y.ad}
            {unit ? <span className="font-normal text-muted-foreground"> ({unit})</span> : null}
          </span>
        </h2>
        {empty ? null : (
          <ChartToolbar
            options={options}
            kind={kind}
            onKind={(k) => onView({ kind: k })}
            labels={labels}
            onLabels={() => onView({ labels: !labels })}
            layout={hasTable ? (view.layout ?? "side") : undefined}
            onLayout={hasTable ? () => onView({ layout: view.layout === "stacked" ? "side" : "stacked" }) : undefined}
            onExpand={() => setExpanded(true)}
            onPng={() => void savePng()}
          />
        )}
      </header>
      {empty ? (
        <div className="flex items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground" style={{ height: 180 }} data-testid="chart-empty">
          {GRAFIK_VERI_YOK}
        </div>
      ) : (
        <>
          <ChartCanvas ref={canvas} blok={blok} kind={kind} labels={labels} height={chartHeight(blok, kind, height)} title={title} egilim={egilim} />
          {shape.hasCompare && NO_COMPARE.includes(kind) ? (
            <p className="mt-2 text-xs text-muted-foreground">Kıyas dönemi serisi bu grafik türünde gösterilmez.</p>
          ) : null}
        </>
      )}
      {expanded ? (
        <Dialog open onOpenChange={(o) => !o && setExpanded(false)}>
          <DialogContent className="w-[min(96vw,1400px)] max-w-none sm:max-w-none">
            <DialogTitle>{title}</DialogTitle>
            <ChartCanvas blok={blok} kind={kind} labels={labels} height={Math.round(typeof window === "undefined" ? 600 : window.innerHeight * 0.72)} title={title} egilim={egilim} />
          </DialogContent>
        </Dialog>
      ) : null}
    </section>
  );
}
