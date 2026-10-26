import { useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageBody, PageShell } from "@/components/layout/PageShell";
import { REPORT_BY_KEY } from "@/lib/report-catalog";
import { cn } from "@/lib/utils";
import { ReportExportBar } from "@/pages/Reports/_components/ReportExportBar";
import { buildExportSpec } from "@/pages/Reports/_v2/export-spec";
import { ParamChips } from "@/pages/Reports/_v2/ParamChips";
import { ReportBody } from "@/pages/Reports/_v2/ReportBody";
import { ReportFailureState, ReportLoadingState } from "@/pages/Reports/_v2/ReportStates";
import { failureOf, useReportV2 } from "@/pages/Reports/_v2/useReportV2";
import { fmtDec } from "../shared/format";
import { excludedText, missingText, sourceBadges, YARN_NEED_KEY, type YarnNeedMeta, type YarnNeedPresentation } from "./yarn-need-model";

const ENTRY = REPORT_BY_KEY.get(YARN_NEED_KEY)!;

/**
 * İplik İhtiyaç Planı (MAL-7) — v2 sunum zarfını çizer; süzgeçler (netle, levent, müşteri, ürün) URL'den
 * sunucuya gider. Ekran, Excel ve PDF aynı `tablo`dan; kapalı modülün hücresi sunucudan "bilinmiyor" gelir.
 */
export function YarnNeedPage() {
  const query = useReportV2(ENTRY);
  const data = query.data as YarnNeedPresentation | undefined;
  const failure = query.isError ? failureOf(query.error) : null;
  const meta = data?.detay?.meta;

  return (
    <PageShell className="overflow-hidden">
      <PageHeader
        title={ENTRY.baslik}
        parent={{ label: "Maliyet & Teklif", to: "/cost" }}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={query.isFetching} onClick={() => void query.refetch()} aria-label="Yenile">
              <RefreshCw className={cn("h-4 w-4", query.isFetching && "animate-spin")} /> <span className="hidden lg:inline">Yenile</span>
            </Button>
            <ReportExportBar buildSpec={() => (data ? buildExportSpec(data) : null)} disabled={!data} />
          </div>
        }
      />
      <p className="border-b bg-muted/20 px-4 py-2 text-sm">
        <span className="font-medium">{ENTRY.soru}</span>
      </p>
      <ParamChips entry={ENTRY} params={data?.parametreler ?? []} personNamed={false} />
      <PageBody className="p-4">
        <div className="mx-auto flex max-w-7xl flex-col gap-4">
          {failure ? (
            <ReportFailureState failure={failure} error={query.error} onRetry={() => void query.refetch()} />
          ) : data ? (
            <>
              {meta ? <MetaStrip meta={meta} /> : null}
              <ReportBody presentation={data} fetchedAt={query.dataUpdatedAt} />
            </>
          ) : (
            <ReportLoadingState />
          )}
        </div>
      </PageBody>
    </PageShell>
  );
}

function MetaStrip({ meta }: { meta: YarnNeedMeta }) {
  const [open, setOpen] = useState(false);
  const excluded = excludedText(meta);
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-wrap gap-1.5" aria-label="Hesaba giren kaynaklar">
        {sourceBadges(meta.kaynaklar).map((b) => (
          <li
            key={b.key}
            className={cn(
              "rounded-full border px-2.5 py-0.5 text-xs",
              b.on ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300" : "border-muted-foreground/30 bg-muted text-muted-foreground",
            )}
          >
            {b.label}
          </li>
        ))}
      </ul>
      {excluded ? (
        <div>
          <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
            <AlertTriangle className="h-4 w-4 text-warning" />
            {excluded}
          </Button>
        </div>
      ) : null}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[80vh] max-w-2xl overflow-auto">
          <DialogHeader>
            <DialogTitle>İhtiyaca girmeyen ürünler</DialogTitle>
            <DialogDescription>Bu ürünlerin açık siparişleri iplik ihtiyacına katılmadı; eksik bilgi tamamlanınca rapor kendiliğinden sayar.</DialogDescription>
          </DialogHeader>
          {meta.yapisiEksik.length > 0 ? (
            <section className="space-y-1">
              <h3 className="text-sm font-medium">Kumaş yapısı eksik</h3>
              <ul className="space-y-1 text-sm">
                {meta.yapisiEksik.map((u) => (
                  <li key={u.urunId} className="rounded border px-3 py-1.5">
                    <span className="font-medium">{u.urunKodu} · {u.urun}</span>
                    <span className="text-muted-foreground"> — {u.kalemSayisi} sipariş kalemi · {fmtDec(u.metre, 1)} m</span>
                    <ul className="mt-0.5 list-disc pl-5 text-xs text-muted-foreground">
                      {u.eksikler.map((c) => <li key={c}>{missingText(c)}</li>)}
                    </ul>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {meta.olculemeyen.length > 0 ? (
            <section className="space-y-1">
              <h3 className="text-sm font-medium">Metre dışı birimde sipariş (iplik ihtiyacı hesaplanamaz)</h3>
              <ul className="space-y-1 text-sm">
                {meta.olculemeyen.map((u) => (
                  <li key={`${u.urunId}-${u.birim}`} className="rounded border px-3 py-1.5">
                    <span className="font-medium">{u.urunKodu} · {u.urun}</span>
                    <span className="text-muted-foreground"> — {u.kalemSayisi} kalem · {fmtDec(u.miktar, 1)} {u.birim}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
