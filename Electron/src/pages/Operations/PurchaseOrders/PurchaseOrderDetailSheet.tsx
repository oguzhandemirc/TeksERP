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
//      Rollup'ı tazeleyen olayların hepsi senkronu çağırır (2026-08-14'ten beri
//      topun TEKİL iptali de) ama drift yine mümkündür (çökme penceresi, elle
//      veri düzeltmesi). Fark varsa RAKAM BAYATTIR, bu söylenir ve bandın
//      üstünde ÇIKIŞ YOLU vardır: "Tazele" (POST /:id/resync).
//   ② `unmatchedItemIds` — fişte gelen ama bu siparişte HİÇ OLMAYAN ürün. Mal
//      depoya girdi (kayıt doğru), yanlış olan yalnız BAĞ: en olası sebep depocunun
//      açılır listeden YANLIŞ siparişi seçmesidir.
//
// ⚠️ SHORT-CLOSE ("Kalanı Kapat", G2) İPTAL DEĞİLDİR ve ayrımı EKRAN anlatır:
//   iptal "bu sipariş hiç olmadı" der (kabul görmüşse backend reddeder);
//   short-close "olan KALIR, kalanı gelmeyecek" der. Yıkıcı-işlem kuralı gereği
//   onay diyaloğu gelmeyecek kalemleri MİKTARIYLA tek tek listeler ve sebep
//   ZORUNLUDUR (backend min 3 dayatıyor, ekran da). Kapatılmış siparişte durum
//   rozeti CLOSED gösterir ama ipucu metni "tüm kalemler karşılandı" YALANINI
//   basmaz — `shortClosedAt` doluysa kendi cümlesi vardır ve kalem satırları
//   "gelmeyecek (kapatıldı)" yazar (`remainingText` opts).
//
// ⚠️ EŞLEME ÜRÜN BAZINDADIR ve bu KESİN DEĞİL, VARSAYIMDIR (şemada top ↔ sipariş
// KALEMİ bağı yok). Ekran bunu `FIFO_HINT` ile açıkça söyler; kesinmiş gibi
// sunmak, iki terminli bir siparişte satın almacıyı yanlış termini kapattığına
// ikna ederdi.
// =============================================================================
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Info, Pencil, Ban, PackageX, RefreshCw, Undo2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PermissionGate } from "@/components/PermissionGate";
import { cn } from "@/lib/utils";
import {
  SUPPLIER_KIND_TAG, supplierDisplayName, supplierRefOf,
} from "@/components/forms/supplierParty";
import { money } from "@/pages/Finance/service";
import {
  fmtQty, getPurchaseOrder, reopenShortClosePurchaseOrder, resyncPurchaseOrder,
  shortClosePurchaseOrder, toNum, type PurchaseOrderDetail,
} from "./service";
import { FIFO_HINT, FULFILLMENT_TONE, fulfillmentOf, orderProgress, remainingText } from "./fulfillment";
import { PO_STATUS_BADGE, PO_STATUS_HINT, PO_STATUS_LABEL, RECEIPT_STATUS_LABEL } from "./labels";
import { EXPECTED_TONE_CLASS, expectedHint, expectedTone, fmtDate } from "./dates";
import { toastServerSuccess } from "@/lib/serverNotes";

interface Props {
  id: string | null;
  onOpenChange: (open: boolean) => void;
  /**
   * Düzenleme / iptal — sipariş SAYFASININ formlarını açar.
   *
   * ⚠️ OPSİYONEL: bu sheet artık başka bağlamlardan da açılıyor (mal kabul
   * fişi → sipariş). Orada düzenleme formu MOUNT EDİLMEMİŞTİR; düğmeyi yine de
   * çizmek, basınca hiçbir şey olmayan bir yol vaat ederdi — verilmezse
   * ÇİZİLMEZ (gri buton da aynı yalanın yumuşak hâli).
   */
  onEdit?: (id: string) => void;
  onCancel?: (id: string) => void;
  /**
   * Bağlı mal kabul fişini açar (sipariş → fiş tıkla-git).
   *
   * ⚠️ Geri çağrı, doğrudan import DEĞİL: fiş sheet'i bu bileşeni import
   * ediyor (fiş → sipariş yönü) ve karşılıklı import bir modül döngüsü olurdu.
   * Sağlayan taraf sayfadır (`PurchaseOrdersPage`), yani fiş sheet'ini zaten
   * mount edebilen katman.
   */
  onOpenReceipt?: (id: string) => void;
}

export function PurchaseOrderDetailSheet({ id, onOpenChange, onEdit, onCancel, onOpenReceipt }: Props) {
  const qc = useQueryClient();
  const [shortCloseOpen, setShortCloseOpen] = useState(false);
  const q = useQuery({
    queryKey: ["purchase-order", id],
    queryFn: () => getPurchaseOrder(id as string),
    enabled: Boolean(id),
  });
  const po = q.data;

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["purchase-orders"] });
    void qc.invalidateQueries({ queryKey: ["purchase-order"] });
    void qc.invalidateQueries({ queryKey: ["purchase-order-open-lines"] });
  };

  // Drift bandındaki "Tazele" — rollup kaynaktan yeniden yazılır. Mesaj
  // BACKEND'İN cümlesidir ("güncellendi" / "zaten günceldi"), ezilmez.
  const resyncM = useMutation({
    mutationFn: () => resyncPurchaseOrder(id as string),
    onSuccess: (res) => {
      toastServerSuccess(res, "Rakamlar yeniden hesaplandı.");
      invalidate();
    },
  });

  // Geri alma yıkıcı DEĞİL (bayrak temizlenir, durum kaynaktan yeniden
  // türetilir — veri kaybı yok) → ayrı onay diyaloğu çizilmez.
  const reopenM = useMutation({
    mutationFn: () => reopenShortClosePurchaseOrder(id as string),
    onSuccess: (res) => {
      toast.success(res.message ?? "Sipariş yeniden açıldı.");
      invalidate();
    },
  });

  const progress = po ? orderProgress(po.lines) : null;
  const tone = po ? expectedTone(po.expectedDate, po.status) : "none";
  const hint = expectedHint(tone);
  const shortClosed = Boolean(po?.shortClosedAt);

  return (
    <Sheet open={Boolean(id)} onOpenChange={onOpenChange}>
      <SheetContent className="w-[760px] overflow-y-auto sm:max-w-[760px]">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <span className="font-mono">{po?.orderNo ?? "…"}</span>
            {po && <Badge className={PO_STATUS_BADGE[po.status]}>{PO_STATUS_LABEL[po.status]}</Badge>}
            {/* CLOSED rozeti tek başına "tüm kalemler geldi" okunur — kapatma
                kararı AYRI rozetle söylenir, yoksa liste yalan söylemiş olur. */}
            {shortClosed && (
              <Badge className="border-transparent bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200">
                Kalanı gelmeyecek
              </Badge>
            )}
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
                <dd className="font-medium">
                  {supplierDisplayName(po)}
                  {supplierRefOf(po)?.kind === "SUBCONTRACTOR" && (
                    <span className="ml-1.5 rounded bg-muted px-1 py-0.5 text-[10px] uppercase text-muted-foreground">
                      {SUPPLIER_KIND_TAG.SUBCONTRACTOR}
                    </span>
                  )}
                </dd>
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
                {/* Short-closed CLOSED'da katalog ipucu ("tüm kalemler
                    karşılandı") YALAN olur — kendi cümlesi basılır. */}
                <dd className="text-muted-foreground">
                  {shortClosed ? "kalanı gelmeyecek olarak kapatıldı" : PO_STATUS_HINT[po.status]}
                </dd>
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

            {shortClosed && (
              <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">
                      Kapatıldı (kalanı gelmeyecek) — {fmtDate(po.shortClosedAt)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {po.shortClosedBy?.fullName ?? po.shortClosedBy?.username ?? "—"} ·{" "}
                      {po.shortCloseReason ?? "sebep yazılmamış"}
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Bu bir iptal DEĞİL: gelen malın kaydı duruyor, yalnız kalan beklenmiyor.
                    </p>
                  </div>
                  <PermissionGate permission="purchase-order:write">
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      disabled={reopenM.isPending}
                      onClick={() => reopenM.mutate()}
                    >
                      <Undo2 className="mr-1 h-3.5 w-3.5" />
                      {reopenM.isPending ? "Açılıyor…" : "Kapatmayı geri al"}
                    </Button>
                  </PermissionGate>
                </div>
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
              <div className="flex items-start gap-2 rounded-md bg-amber-100 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span className="flex-1">
                  {po.totals.driftLineCount} kalemde kayıtlı “gelen” rakamı, o anki gerçek kayıtlarla
                  uyuşmuyor (aşağıda ⟳ ile işaretli). Rakam bir sonraki mal kabul işleminde kendini
                  düzeltir — ya da beklemeden şimdi tazeleyin.
                </span>
                <PermissionGate permission="purchase-order:write">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 shrink-0 border-amber-300 bg-transparent px-2 text-[11px] dark:border-amber-800"
                    disabled={resyncM.isPending}
                    onClick={() => resyncM.mutate()}
                  >
                    <RefreshCw className={cn("mr-1 h-3 w-3", resyncM.isPending && "animate-spin")} />
                    {resyncM.isPending ? "Tazeleniyor…" : "Tazele"}
                  </Button>
                </PermissionGate>
              </div>
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
                            {remainingText(f, l.item.unit, { shortClosed })}
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
                      {/* ⭐ Yukarıdaki uyarı bandı "aşağıdaki fişleri AÇIP
                          kontrol edin" diyor; o eylem ekranda YOKTU (satır düz
                          metindi) — `id` ise zaten yanıtta geliyordu. Geri
                          çağrı verilmediğinde (fişten açılan sipariş) satır düz
                          metin kalır: kullanıcının zaten baktığı fişi ikinci kez
                          açan bir döngü kurulmasın. */}
                      {onOpenReceipt ? (
                        <button
                          type="button"
                          className="font-mono text-xs text-primary underline-offset-2 hover:underline"
                          title="Mal kabul fişini aç"
                          onClick={() => onOpenReceipt(r.id)}
                        >
                          {r.receiptNo}
                        </button>
                      ) : (
                        <span className="font-mono text-xs">{r.receiptNo}</span>
                      )}
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
                {po.status === "OPEN" && onEdit && (
                  <Button variant="outline" onClick={() => onEdit(po.id)}>
                    <Pencil className="mr-1 h-4 w-4" />
                    Düzenle
                  </Button>
                )}
                {/* "Kalanı Kapat" yalnız OPEN/PARTIAL'da: CLOSED'da kapatılacak
                    kalan yok, CANCELLED'da taahhüt yok (backend de 409 der). */}
                {(po.status === "OPEN" || po.status === "PARTIAL") && (
                  <Button variant="outline" onClick={() => setShortCloseOpen(true)}>
                    <PackageX className="mr-1 h-4 w-4" />
                    Kalanı Kapat
                  </Button>
                )}
                {po.status !== "CANCELLED" && onCancel && (
                  <Button variant="outline" className="text-destructive" onClick={() => onCancel(po.id)}>
                    <Ban className="mr-1 h-4 w-4" />
                    Siparişi iptal et
                  </Button>
                )}
              </div>
            </PermissionGate>
          </div>
        )}

        {po && shortCloseOpen && (
          <ShortCloseDialog
            po={po}
            onOpenChange={setShortCloseOpen}
            onClosed={invalidate}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

// =============================================================================
// KALANI KAPAT — YIKICI İŞLEM, SOMUT ONAY (CancelPurchaseOrderDialog kalıbı)
// =============================================================================
// Kök kural: onay, etkilenen her kaydı SOMUT listeler — "N kalem kapanacak"
// gibi soyut sayı YETMEZ. Diyalog gelmeyecek kalemleri MİKTARIYLA tek tek
// basar. Sebep ZORUNLU (backend min 3 dayatıyor; buradaki eşik aynı) çünkü
// "kalan neden gelmeyecek" tedarikçi değerlendirmesinin verisidir ve kaydın
// KENDİ satırına yazılır.
//
// ⚠️ İPTALLE FARKI DİYALOGDA AÇIKÇA YAZILIR: kapatma gelen malın kaydını
// KORUR; "bu sipariş hiç olmadı" demek isteyen İPTAL yolunu kullanır.
function ShortCloseDialog({
  po,
  onOpenChange,
  onClosed,
}: {
  po: PurchaseOrderDetail;
  onOpenChange: (open: boolean) => void;
  onClosed: () => void;
}) {
  const [reason, setReason] = useState("");

  // Gelmeyecek olanlar = kalanı olan kalemler. Fazla gelen / tamamlanan kalem
  // bu karardan etkilenmez ve listeye GİRMEZ — girseydi "tamamlanmış kalem de
  // kapanıyor" gibi okunurdu.
  const openLines = po.lines
    .map((l) => ({ line: l, f: fulfillmentOf(l) }))
    .filter((x) => x.f.remaining > 0);

  const canSubmit = openLines.length > 0 && reason.trim().length >= 3;

  const closeM = useMutation({
    mutationFn: () => shortClosePurchaseOrder(po.id, reason.trim()),
    onSuccess: (res) => {
      toast.success(res.message ?? "Sipariş kapatıldı.");
      onClosed();
      onOpenChange(false);
    },
  });

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Kalanı kapat</DialogTitle>
          <DialogDescription>
            Aşağıdaki kalan miktarlar <b>GELMEYECEK</b> olarak işaretlenecek ve sipariş kapanacak.
            Bu bir iptal DEĞİLDİR — gelen malın kaydı ve karşılanma rakamları aynen durur.
            Karar geri alınabilir (“Kapatmayı geri al”).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <p>
              <b className="font-mono">{po.orderNo}</b> · {supplierDisplayName(po)}
            </p>
            {openLines.length === 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Kapatılacak kalan yok — tüm kalemler zaten karşılanmış.
              </p>
            ) : (
              <ul className="mt-2 space-y-1 text-xs">
                {openLines.map(({ line, f }) => (
                  <li key={line.id} className="flex items-baseline justify-between gap-3">
                    <span className="truncate">
                      {line.lineNo}. {line.item.name}
                    </span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {fmtQty(line.qty, line.item.unit)} ısmarlandı · {fmtQty(f.received, line.item.unit)} geldi ·{" "}
                      <b className="text-foreground">{fmtQty(f.remaining, line.item.unit)} gelmeyecek</b>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <Label>Kapatma sebebi</Label>
            <Textarea
              className="mt-1"
              rows={2}
              maxLength={300}
              placeholder="Örn. tedarikçi kalan 60 metreyi üretmeyecek, yerine AS1408260021 açıldı."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Zorunlu (en az 3 karakter). “Kalan neden gelmeyecek” sorusunun cevabı kaydın kendi
              satırına yazılır — tedarikçi değerlendirmesinin verisidir.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Vazgeç
          </Button>
          <Button disabled={!canSubmit || closeM.isPending} onClick={() => closeM.mutate()}>
            {closeM.isPending ? "Kapatılıyor…" : "Kalanı kapat"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
