// =============================================================================
// ALIŞ SİPARİŞİ DETAYI — "ne ısmarladım, ne geldi, ne kaldı"
// =============================================================================
// ⚠️ TOPLAM MİKTAR TEK SAYI OLARAK BASILMAZ. Backend `totals.totalQty` döner ama
// o toplam, 500 METRE kumaş ile 200 KİLO ipliği aynı torbaya atar; ekranda "700"
// yazmak anlamsız bir rakamdır (`goods-receipt.loadDetail`'in metre ↔ kg ayrımı
// ile aynı gerekçe). İlerleme bu yüzden KALEM SAYAR, miktar toplamaz.
//
// ⚠️ FAZLA KABUL BİR HATA DEĞİL: kalan hiçbir yerde eksi basılmaz, fazlalık
// "N fazla geldi" cümlesiyle ve BİLGİ tonuyla (kırmızı değil) söylenir. Fiziksel
// olarak fazla mal gelir; kayıt gerçeği yazmak zorundadır.
//
// ⚠️ İKİ UYARI BANDI SESSİZLİĞİ ÖNLER:
//   ① `drift` — saklanan karşılanma ile o an kaynaktan hesaplanan değer farklı.
//      Rollup'ı tazeleyen olaylar (fiş açılışı/iptali) senkronu çağırır ama topun
//      TEKİL iptali çağırmaz. Fark varsa RAKAM BAYATTIR ve bu söylenir.
//   ② `unmatchedItemIds` — fişte gelen ama bu siparişte HİÇ OLMAYAN ürün. Mal
//      depoya girdi (kayıt doğru), yanlış olan yalnız BAĞ: en olası sebep depocunun
//      açılır listeden YANLIŞ siparişi seçmesidir.
//
// ⚠️ EŞLEME ÜRÜN BAZINDADIR ve bu KESİN DEĞİL, VARSAYIMDIR (şemada top ↔ sipariş
// KALEMİ bağı yok). Ekran bunu `FIFO_HINT` ile açıkça söyler; kesinmiş gibi
// sunmak, iki terminli bir siparişte satın almacıyı yanlış termini kapattığına
// ikna ederdi.
// =============================================================================
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Info, Pencil, Ban } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PermissionGate } from "@/components/PermissionGate";
import { cn } from "@/lib/utils";
import { money } from "@/pages/Finance/service";
import { fmtQty, getPurchaseOrder, toNum } from "./service";
import { FIFO_HINT, FULFILLMENT_TONE, fulfillmentOf, orderProgress, remainingText } from "./fulfillment";
import { PO_STATUS_BADGE, PO_STATUS_HINT, PO_STATUS_LABEL, RECEIPT_STATUS_LABEL } from "./labels";
import { EXPECTED_TONE_CLASS, expectedHint, expectedTone, fmtDate } from "./dates";

interface Props {
  id: string | null;
  onOpenChange: (open: boolean) => void;
  onEdit: (id: string) => void;
  onCancel: (id: string) => void;
}

export function PurchaseOrderDetailSheet({ id, onOpenChange, onEdit, onCancel }: Props) {
  const q = useQuery({
    queryKey: ["purchase-order", id],
    queryFn: () => getPurchaseOrder(id as string),
    enabled: Boolean(id),
  });
  const po = q.data;

  const progress = po ? orderProgress(po.lines) : null;
  const tone = po ? expectedTone(po.expectedDate, po.status) : "none";
  const hint = expectedHint(tone);

  return (
    <Sheet open={Boolean(id)} onOpenChange={onOpenChange}>
      <SheetContent className="w-[760px] overflow-y-auto sm:max-w-[760px]">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <span className="font-mono">{po?.orderNo ?? "…"}</span>
            {po && <Badge className={PO_STATUS_BADGE[po.status]}>{PO_STATUS_LABEL[po.status]}</Badge>}
          </SheetTitle>
        </SheetHeader>

        {q.isLoading ? (
          <p className="mt-4 text-sm text-muted-foreground">Yükleniyor…</p>
        ) : q.isError ? (
          <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
            <p className="font-medium text-destructive">Sipariş yüklenemedi.</p>
            <p className="mt-1 text-muted-foreground">
              Bu bir “sipariş yok” cevabı DEĞİLDİR — istek sunucuya ulaşamadı ya da reddedildi.
            </p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => void q.refetch()}>
              Tekrar dene
            </Button>
          </div>
        ) : !po ? null : (
          <div className="mt-4 space-y-4">
            {/* ── BAŞLIK BİLGİLERİ ─────────────────────────────────────── */}
            <dl className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Tedarikçi</dt>
                <dd className="font-medium">{po.supplier?.name ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Sipariş tarihi</dt>
                <dd>{fmtDate(po.orderDate)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Beklenen tarih</dt>
                <dd className={EXPECTED_TONE_CLASS[tone]}>
                  {fmtDate(po.expectedDate)}
                  {hint && <span className="ml-1 text-xs">({hint})</span>}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Para birimi</dt>
                <dd>{po.currency}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Açan</dt>
                <dd>{po.createdBy?.fullName ?? po.createdBy?.username ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Durum</dt>
                <dd className="text-muted-foreground">{PO_STATUS_HINT[po.status]}</dd>
              </div>
            </dl>

            {po.notes && (
              <p className="rounded-md bg-muted/40 px-3 py-2 text-sm">{po.notes}</p>
            )}

            {po.status === "CANCELLED" && (
              <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
                <p className="font-medium">İptal edildi — {fmtDate(po.cancelledAt)}</p>
                <p className="text-xs text-muted-foreground">
                  {po.cancelledBy?.fullName ?? po.cancelledBy?.username ?? "—"} ·{" "}
                  {po.cancelReason ?? "sebep yazılmamış"}
                </p>
              </div>
            )}

            {/* ── İLERLEME (KALEM BAZINDA) ─────────────────────────────── */}
            {progress && progress.lineCount > 0 && (
              <div className="rounded-md border p-3">
                <div className="flex items-baseline justify-between text-sm">
                  <span className="font-medium">Karşılanma</span>
                  <span className="tabular-nums text-muted-foreground">
                    {progress.completeLines + progress.overLines} / {progress.lineCount} kalem tamam
                  </span>
                </div>
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${progress.percent}%` }}
                  />
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {progress.waitingLines} bekliyor · {progress.partialLines} kısmen geldi ·{" "}
                  {progress.completeLines} tamamlandı
                  {progress.overLines > 0 && ` · ${progress.overLines} kalemde fazla geldi`}
                </p>
              </div>
            )}

            {/* ── SESSİZLİK YOK: bayat rakam ve eşleşmeyen ürün bantları ─ */}
            {po.totals.driftLineCount > 0 && (
              <p className="flex items-start gap-2 rounded-md bg-amber-100 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  {po.totals.driftLineCount} kalemde kayıtlı “gelen” rakamı, o anki gerçek kayıtlarla
                  uyuşmuyor (aşağıda ⟳ ile işaretli). En olası sebep: fişteki bir topun tek tek iptal
                  edilmesi. Rakam bir sonraki mal kabul işleminde kendini düzeltir.
                </span>
              </p>
            )}

            {po.totals.unmatchedItemCount > 0 && (
              <p className="flex items-start gap-2 rounded-md bg-amber-100 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Bu siparişe bağlı fişlerde, siparişte HİÇ OLMAYAN {po.totals.unmatchedItemCount} ürün
                  var. Mal depoya girdi ve kaydı doğru — yanlış olan yalnız BAĞ olabilir (fişte yanlış
                  sipariş seçilmiş). Aşağıdaki fişleri açıp kontrol edin.
                </span>
              </p>
            )}

            {/* ── KALEMLER ─────────────────────────────────────────────── */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-medium">Kalemler</h3>
              </div>
              <div className="overflow-hidden rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-[11px] uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">#</th>
                      <th className="px-3 py-2 text-left">Ürün</th>
                      <th className="px-3 py-2 text-right">Sipariş</th>
                      <th className="px-3 py-2 text-right">Gelen</th>
                      <th className="px-3 py-2 text-left">Durum</th>
                      <th className="px-3 py-2 text-right">Birim Fiyat</th>
                    </tr>
                  </thead>
                  <tbody>
                    {po.lines.map((l) => {
                      const f = fulfillmentOf(l);
                      return (
                        <tr key={l.id} className="border-t align-top">
                          <td className="px-3 py-2 text-xs text-muted-foreground">{l.lineNo}</td>
                          <td className="px-3 py-2">
                            <div className="font-medium">{l.item.name}</div>
                            <div className="text-[11px] text-muted-foreground">{l.item.code}</div>
                            {l.notes && <div className="mt-0.5 text-[11px]">{l.notes}</div>}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {fmtQty(l.qty, l.item.unit)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {fmtQty(l.receivedQty, l.item.unit)}
                            {l.drift && (
                              <span
                                className="ml-1 text-amber-700 dark:text-amber-500"
                                title={`Kaynaktan hesaplanan: ${fmtQty(l.liveReceivedQty, l.item.unit)}`}
                              >
                                ⟳
                              </span>
                            )}
                          </td>
                          <td className={cn("px-3 py-2", FULFILLMENT_TONE[f.state])}>
                            {remainingText(f, l.item.unit)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {l.unitPrice != null ? money(toNum(l.unitPrice), po.currency) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 flex items-start gap-1.5 text-[11px] text-muted-foreground">
                <Info className="mt-0.5 h-3 w-3 shrink-0" />
                {FIFO_HINT}
              </p>
            </div>

            {/* ── BAĞLI MAL KABUL FİŞLERİ ─────────────────────────────── */}
            <div>
              <h3 className="mb-2 text-sm font-medium">Bağlı mal kabul fişleri</h3>
              {po.goodsReceipts.length === 0 ? (
                <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                  Henüz mal gelmemiş. Mal geldiğinde <b>Mal Kabul</b> ekranında fişi açarken bu siparişi
                  seçin — kalan miktarlar kendiliğinden hesaplanır.
                </p>
              ) : (
                <ul className="divide-y rounded-md border text-sm">
                  {po.goodsReceipts.map((r) => (
                    <li key={r.id} className="flex items-center justify-between px-3 py-2">
                      <span className="font-mono text-xs">{r.receiptNo}</span>
                      <span className="flex items-center gap-2 text-xs text-muted-foreground">
                        {r.deliveryNoteNo && <span>İrs: {r.deliveryNoteNo}</span>}
                        <span>{fmtDate(r.createdAt)}</span>
                        <Badge variant={r.status === "CANCELLED" ? "muted" : "secondary"}>
                          {RECEIPT_STATUS_LABEL[r.status]}
                        </Badge>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* ── AKSİYONLAR ──────────────────────────────────────────── */}
            <PermissionGate permission="purchase-order:write">
              <div className="flex justify-end gap-2 border-t pt-3">
                {po.status === "OPEN" && (
                  <Button variant="outline" onClick={() => onEdit(po.id)}>
                    <Pencil className="mr-1 h-4 w-4" />
                    Düzenle
                  </Button>
                )}
                {po.status !== "CANCELLED" && (
                  <Button variant="outline" className="text-destructive" onClick={() => onCancel(po.id)}>
                    <Ban className="mr-1 h-4 w-4" />
                    Siparişi iptal et
                  </Button>
                )}
              </div>
            </PermissionGate>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
