import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Info, SplitSquareHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { upTo3Text } from "@/lib/number-format";
import { RaporGrafik } from "../grafik/RaporGrafik";
import { ReportTable } from "../ReportTable";
import { SmallMultiples } from "../SmallMultiples";
import { customReportApi, type CatalogCube } from "../custom/custom-api";
import { tableOf, variantOf } from "../custom/result-model";
import type { DefinitionBlock, DefinitionBody } from "../custom/layout/layout-model";
import { Scatter } from "./Scatter";
import {
  CAUSALITY_TEXT,
  analysisCube,
  analysisVerdict,
  confounderBody,
  confoundersFor,
  type AnalysisOutcome,
  type Confounder,
} from "./analysis-model";

interface Props {
  analysis: AnalysisOutcome;
  title?: string | null;
  /** Gövdedeki analiz bloğu ve gövde: karıştırıcı önizlemesi aynı ölçü/süzgeç/dönemle kurulur. */
  block?: DefinitionBlock;
  body?: DefinitionBody;
  cubes?: readonly CatalogCube[];
}

function ConfounderDialog({ open, title, body, onClose }: { open: boolean; title: string; body: DefinitionBody | null; onClose: () => void }) {
  const preview = useQuery({ queryKey: ["analysis-confounder", body], queryFn: () => customReportApi.preview(body), enabled: open && body !== null, retry: false });
  const [variant, table] = preview.data?.bloklar ?? [];
  const v = variant?.durum === "tamam" && variant.sonuclar[0] ? variantOf(variant.sonuclar[0]) : null;
  const t = table?.durum === "tamam" && table.sonuclar[0] ? tableOf(table.sonuclar[0]) : null;
  return (
    <Dialog open={open} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Aynı dönem ve süzgeçle; her değer ayrı kartta. Fark her kartta sürüyorsa bu etken tek başına açıklamıyor.</DialogDescription>
        </DialogHeader>
        {preview.isLoading ? <p className="text-sm text-muted-foreground">Hazırlanıyor…</p> : null}
        {preview.isError ? <p className="text-sm text-destructive">Hazırlanamadı; biraz sonra yeniden deneyin.</p> : null}
        {v ? <SmallMultiples block={v} /> : null}
        {t ? <ReportTable table={t} /> : null}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Analiz kartı (plan §4.7): başlık + n, solda görsel, sağda özet tablo, altta sunucunun sonuç cümlesi
 * AYNEN (örneklem küçükse yerine sarı uyarı), her kartta sabit nedensellik notu ve karıştırıcı düğmeleri.
 */
export function AnalysisCard({ analysis, title, block, body, cubes }: Props) {
  const [open, setOpen] = useState<Confounder | null>(null);
  const { sunum, istatistik } = analysis;
  const verdict = analysisVerdict(analysis);
  const cube = block ? analysisCube(block, cubes) : undefined;
  const confounders = block ? confoundersFor(block, cube) : [];
  const chart = sunum.grafik;
  return (
    <article aria-label={title ?? sunum.baslik} className="flex flex-col gap-3" data-testid="analysis-card">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-sm font-semibold">Analiz: {title ?? sunum.baslik}</h4>
        {istatistik ? <span className="text-xs tabular-nums text-muted-foreground">n = {upTo3Text(istatistik.n)}</span> : null}
      </header>
      {verdict.kind !== "empty" ? (
        <div className="grid gap-4 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="min-w-0">
            {chart?.tur === "sacilim" ? <Scatter chart={chart} stats={istatistik} /> : chart ? <RaporGrafik blok={chart} yukseklik={240} baslik={sunum.soru} /> : null}
          </div>
          <div className="min-w-0">{sunum.tablo ? <ReportTable table={sunum.tablo} /> : null}</div>
        </div>
      ) : null}
      {verdict.kind === "warning" ? (
        <p role="status" data-testid="analysis-warning" className="flex items-start gap-2 rounded-md border border-amber-300/70 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700/50 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> {verdict.text}
        </p>
      ) : (
        <p data-testid={verdict.kind === "result" ? "analysis-result" : "analysis-empty"} className={verdict.kind === "result" ? "text-sm" : "text-sm text-muted-foreground"}>
          {verdict.kind === "result" ? <span className="font-medium">Sonuç: </span> : null}
          {verdict.text}
        </p>
      )}
      <div className="flex flex-col gap-2 rounded-md bg-muted/50 px-3 py-2 text-sm">
        <p className="flex items-start gap-2" data-testid="analysis-causality">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span>
            {CAUSALITY_TEXT}
            {confounders.length ? " Tezgah ve iplik partisi de etkili olabilir:" : null}
          </span>
        </p>
        {confounders.length ? (
          <div className="flex flex-wrap gap-2">
            {confounders.map((c) => (
              <Button key={c.dimension} type="button" size="sm" variant="outline" className="gap-1.5" disabled={c.unavailable !== null} title={c.unavailable ?? undefined} onClick={() => setOpen(c)}>
                <SplitSquareHorizontal className="h-4 w-4" aria-hidden="true" /> {c.label}
              </Button>
            ))}
            {confounders.filter((c) => c.unavailable).map((c) => (
              <span key={`${c.dimension}-why`} className="self-center text-xs text-muted-foreground">
                {c.unavailable}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      {block && cube ? (
        <ConfounderDialog
          open={open !== null}
          title={open?.label ?? ""}
          body={open ? confounderBody(block, body, open.dimension, cube) : null}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </article>
  );
}
