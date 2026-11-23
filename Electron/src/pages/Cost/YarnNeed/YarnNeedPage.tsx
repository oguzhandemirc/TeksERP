import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageShell } from "@/components/layout/PageShell";
import { REPORT_BY_KEY } from "@/lib/report-catalog";
import { InfoPopover } from "@/components/ui/info-popover";
import { useReportV2 } from "@/pages/Reports/_v2/useReportV2";
import { ReportV2Frame } from "@/pages/Reports/_v2/view/ReportV2Frame";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { useOpenTarget } from "@/components/layout/tabs/use-tab-target";
import { YARN_AT_SUB_PATH } from "@/pages/Operations/YarnAtSubcontractor/service";
import { fmtQtyDec } from "../shared/format";

/** Fasondaki İplik route'unun izni (`content-routes.tsx` ile aynı). */
const YARN_AT_SUB_PERMISSION = "warping-order:read";
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

/** D8b: "Deverecide" sütununun ayrıntısı — hangi deverecide hangi lot; route izni yoksa bağ çizilmez. */
function YarnAtSubLink() {
  const open = useOpenTarget();
  const { hasPermission } = useRoleAccess();
  if (!hasPermission(YARN_AT_SUB_PERMISSION)) return null;
  return (
    <p className="text-xs text-muted-foreground">
      · Deverecideki ipliğin lot ayrıntısı:{" "}
      <a
        href={YARN_AT_SUB_PATH}
        className="font-medium text-primary underline-offset-2 hover:underline"
        onClick={(e) => { e.preventDefault(); open(YARN_AT_SUB_PATH, e); }}
        onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); open(YARN_AT_SUB_PATH, e); } }}
      >
        Fasondaki İplik
      </a>
    </p>
  );
}

function MetaStrip({ meta, basis, notes }: { meta: YarnNeedMeta; basis: string | null; notes: Array<string | null> }) {
  const [open, setOpen] = useState(false);
  const excluded = excludedText(meta);
  const badgeList = sourceBadges(meta.kaynaklar, meta.deverecideDus);
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      {/* M17: kaynak çipleri + açıklama satırları içeriği itiyordu → tek satır özet, ayrıntı ⓘ baloncuğunda. */}
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" aria-label="Hesaba giren kaynaklar">
        Hesaba giren kaynaklar: {badgeList.filter((x) => x.on).length} / {badgeList.length}
        <InfoPopover label="Hesaba giren kaynaklar" desc={
          <div className="space-y-2">
            <ul className="space-y-0.5">
              {badgeList.map((x) => <li key={x.key} className={x.on ? "text-success" : "text-muted-foreground"}>{x.on ? "✓" : "–"} {x.label}</li>)}
            </ul>
            {basis ? <p data-testid="yarn-need-basis">{basis}</p> : null}
            {notes.map((n) => (n ? <p key={n} data-testid="yarn-need-note">{n}</p> : null))}
          </div>
        } />
      </span>
      {meta.kaynaklar.deverecide ? <YarnAtSubLink /> : null}
      {excluded ? (
        <Button type="button" variant="outline" size="sm" className="h-7 gap-1.5" onClick={() => setOpen(true)}>
            <AlertTriangle className="h-4 w-4 text-warning" />
            {excluded}
          </Button>
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
                    <span className="text-muted-foreground"> — {u.kalemSayisi} sipariş kalemi · {fmtQtyDec(u.metre, 1)} m</span>
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
                    <span className="text-muted-foreground"> — {u.kalemSayisi} kalem · {fmtQtyDec(u.miktar, 1)} {u.birim}</span>
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
