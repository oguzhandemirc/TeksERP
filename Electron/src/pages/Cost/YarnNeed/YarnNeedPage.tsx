import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageShell } from "@/components/layout/PageShell";
import { REPORT_BY_KEY } from "@/lib/report-catalog";
import { cn } from "@/lib/utils";
import { useReportV2 } from "@/pages/Reports/_v2/useReportV2";
import { ReportV2Frame } from "@/pages/Reports/_v2/view/ReportV2Frame";
import { fmtDec } from "../shared/format";
import { excludedText, missingText, rawBasisText, reservationText, sourceBadges, wasteSourceText, YARN_NEED_KEY, type YarnNeedMeta, type YarnNeedPresentation } from "./yarn-need-model";

const ENTRY = REPORT_BY_KEY.get(YARN_NEED_KEY)!;

/**
 * İplik İhtiyaç Planı (MAL-7) — v2 rapor çerçevesinde; süzgeçler (netle, levent, müşteri, ürün) URL'den
 * sunucuya gider. Ekran, Excel ve PDF aynı `tablo`dan; kapalı modülün hücresi sunucudan "bilinmiyor" gelir.
 */
export function YarnNeedPage() {
  const query = useReportV2(ENTRY);
  const data = query.data as YarnNeedPresentation | undefined;
  const meta = data?.detay?.meta;
  return (
    <PageShell className="overflow-hidden">
      <ReportV2Frame
        entry={ENTRY}
        query={query}
        parent={{ label: "Maliyet", to: "/cost" }}
        personNamed={false}
        questionExtra={meta ? <MetaStrip meta={meta} basis={rawBasisText(meta, data?.detay?.ozet)} notes={[reservationText(meta), wasteSourceText(data?.detay?.satirlar)]} /> : null}
      />
    </PageShell>
  );
}

function MetaStrip({ meta, basis, notes }: { meta: YarnNeedMeta; basis: string | null; notes: Array<string | null> }) {
  const [open, setOpen] = useState(false);
  const excluded = excludedText(meta);
  return (
    <div className="mt-2 flex flex-col gap-2">
      <ul className="flex flex-wrap gap-1.5" aria-label="Hesaba giren kaynaklar">
        {sourceBadges(meta.kaynaklar).map((b) => (
          <li
            key={b.key}
            className={cn(
              "rounded-badge border px-2.5 py-0.5 text-xs",
              b.on ? "border-success/40 bg-success-soft text-success" : "border-muted-foreground/30 bg-muted text-muted-foreground",
            )}
          >
            {b.label}
          </li>
        ))}
      </ul>
      {basis ? <p className="text-xs text-muted-foreground" data-testid="yarn-need-basis">{basis}</p> : null}
      {notes.map((n) => (n ? <p key={n} className="text-xs text-muted-foreground" data-testid="yarn-need-note">{n}</p> : null))}
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
