import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Printer, Ban, FileText } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { PermissionGate } from "@/components/PermissionGate";
import { PrintedDocDialog } from "@/components/print/PrintedDocDialog";
import { BulkRollLabelButton } from "@/components/print/BulkRollLabelButton";
import { cancelGoodsReceipt, createInvoiceFromReceipt, getGoodsReceipt } from "./service";
import type { ReceiptDetailYarnLine } from "./service";
import { PurchaseOrderSyncBand } from "../PurchaseOrders/PurchaseOrderSyncBand";
import type { ReceiptPurchaseOrderSync } from "../PurchaseOrders/receiptSync";
import { PO_STATUS_LABEL } from "../PurchaseOrders/labels";

/** Decimal JSON'da string gelir — görüntü için sayıya çevirip TR biçimler. */
const fmt = (v: string | number | null | undefined): string =>
  v == null ? "—" : Number(v).toLocaleString("tr-TR");

interface Props {
  id: string | null;
  onOpenChange: (open: boolean) => void;
  /**
   * Fiş AZ ÖNCE oluşturulduysa yanıttaki sipariş senkronu.
   *
   * ⚠️ Bu bilgi sunucuda SAKLANMAZ (`GET` ile geri alınamaz) — panel onu
   * kapatana kadar gösteren tek yüzey burasıdır. Listeden açılan fişte `null`
   * gelir ve bant TEK BAYT çizmez, yani mevcut görünüm bayt-bayt korunur.
   */
  sync?: ReceiptPurchaseOrderSync | null;
}

export function GoodsReceiptDetailSheet({ id, onOpenChange, sync }: Props) {
  const qc = useQueryClient();
  const [confirmCancel, setConfirmCancel] = useState(false);
  // #2 (saha isteği): "Bas" doğrudan yazdırmaz — ÖNİZLEME açar. Operatör ne
  // basacağını görmeden kâğıt harcamasın. Genel bileşen versiyon çubuğunu,
  // revizyonu ve PDF'i de getirir (ShipmentDispatchNote ile aynı yüzey).
  const [docOpen, setDocOpen] = useState(false);

  // Fişten alış faturası taslağı — satırları backend gruplar (ürün+renk+FİYAT).
  // Hata toast'ı apiClient interceptor'undan gelir (onError eklenmez).
  const invoiceM = useMutation({
    // `id` sheet kapalıyken null; mutation yalnız açıkken tetiklenir.
    mutationFn: () => createInvoiceFromReceipt(id as string),
    onSuccess: (res) => {
      toast.success(res.message ?? `${res.data.docNo} taslağı oluşturuldu.`);
      void qc.invalidateQueries({ queryKey: ["finance"] });
    },
  });

  const q = useQuery({
    queryKey: ["goods-receipt", id],
    queryFn: () => getGoodsReceipt(id!),
    enabled: Boolean(id),
  });
  const r = q.data;

  // İPLİK YÜZEYİ TEK KAYNAKTAN (Sınıf 5): satırlar assembler union'ından
  // (`lines`) okunur, `yarnMovements` ham dizisinden DEĞİL — beşinci tüketici
  // de aynı kapıdan geçsin. Ters kayıtlar (fiş iptali, movementKind !== "IN")
  // LİSTEDE KALIR: defter "ne oldu"yu anlatır; satır soluk + "İptal" rozetli.
  const yarnLines = (r?.lines ?? []).filter((l): l is ReceiptDetailYarnLine => l.kind === "YARN");
  const yarnKgNet = r?.totals.totalYarnKg ?? 0;
  // Fiyat kolonu yalnız EN AZ BİR satır fiyat taşıyorsa çizilir — fiyatsız
  // fişte boş "—" kolonu göstermek soruyu sorup cevabı vermemektir.
  const yarnHasPrice = yarnLines.some((l) => l.unitPrice != null);

  const cancelM = useMutation({
    mutationFn: (reason: string) => cancelGoodsReceipt(id!, reason),
    onSuccess: (res) => {
      toast.success(res.message ?? "Fiş iptal edildi.");
      void qc.invalidateQueries({ queryKey: ["goods-receipts"] });
      void qc.invalidateQueries({ queryKey: ["goods-receipt", id] });
      void qc.invalidateQueries({ queryKey: ["rolls"] });
      // İptal, iplik satırlarını ters kayıtla (ADJUST_OUT) düşer — İplik Stoku
      // ekranı ["yarn", …] anahtarlarını kullanır; bakiye bayat kalmasın.
      void qc.invalidateQueries({ queryKey: ["yarn"] });
      setConfirmCancel(false);
    },
  });

  return (
    <>
      <Sheet open={Boolean(id)} onOpenChange={onOpenChange}>
        <SheetContent className="w-[640px] sm:max-w-[640px]">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <span className="font-mono">{r?.receiptNo ?? "…"}</span>
              {r?.status === "CANCELLED" && <Badge variant="outline">İptal</Badge>}
            </SheetTitle>
          </SheetHeader>

          {/* ⚠️ YÜKLEME DALININ DIŞINDA: uyarı, fişin detayı gelmeden de
              basılabilmeli — sunucu yavaşken kaybolan bir uyarı, hiç basılmayan
              uyarıdır. Sipariş bağı/uyarı yoksa hiçbir şey çizilmez. */}
          <PurchaseOrderSyncBand sync={sync} className="mt-4" />

          {q.isLoading ? (
            <p className="mt-4 text-sm text-muted-foreground">Yükleniyor…</p>
          ) : !r ? null : (
            <div className="mt-4 space-y-4">
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">Depo</dt>
                  <dd>{r.warehouse.name}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Tedarikçi</dt>
                  <dd>{r.supplier?.name ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Tedarikçi İrsaliyesi</dt>
                  <dd>{r.deliveryNoteNo ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Toplam</dt>
                  <dd>
                    {r.totals.rollCount} top · {r.totals.totalQty} m
                    {/* İplik AYRI birimde — kg metreye TOPLANMAZ (backend
                        `totalYarnKg` NET'tir: ters kayıtlar düşülmüş). */}
                    {yarnLines.length > 0 && <> + {fmt(yarnKgNet)} kg iplik</>}
                  </dd>
                </div>
                {/* BAĞLI ALIŞ SİPARİŞİ — yalnız bağ VARSA satır çizilir.
                    Siparişsiz fişte boş bir "—" satırı basmak, olmayan bir alanı
                    varmış gibi gösterip fabrikadaki görünümü de değiştirirdi. */}
                {r.purchaseOrder && (
                  <div className="col-span-2">
                    <dt className="text-xs text-muted-foreground">Alış siparişi</dt>
                    <dd className="flex flex-wrap items-center gap-2">
                      <span className="font-mono">{r.purchaseOrder.orderNo}</span>
                      <span className="text-xs text-muted-foreground">
                        ({PO_STATUS_LABEL[r.purchaseOrder.status]})
                      </span>
                      {/* ⚠️ PARA BİRİMİ ÇELİŞKİSİ SESSİZ KALMAZ. Backend yalnız
                          TEDARİKÇİ çelişkisini reddediyor; para birimi farkı
                          serbesttir ve fark, fişten üretilen ALIŞ FATURASINA
                          fişin birimiyle geçer — yani anlaşılan fiyat sessizce
                          başka bir para biriminde faturalanır. */}
                      {r.purchaseOrder.currency !== r.currency && (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                          Sipariş {r.purchaseOrder.currency}, fiş {r.currency} — fiyatlar fişin para
                          biriminde faturalanır
                        </span>
                      )}
                    </dd>
                  </div>
                )}
              </dl>

              {/* Kumaş tablosu — YALNIZ-İPLİK fişte çizilmez (boş başlıklı tablo
                  "toplar kaybolmuş" okunur); iplik de yoksa eski görünüm aynen
                  durur (boş fişte boş tablo, bugünkü davranış). */}
              {(r.rolls.length > 0 || yarnLines.length === 0) && (
                <div className="overflow-hidden rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="p-2 text-left">Barkod</th>
                        <th className="p-2 text-left">Ürün / Renk</th>
                        <th className="p-2 text-right">Metre</th>
                        <th className="p-2 text-left">Durum</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.rolls.map((roll) => (
                        <tr key={roll.id} className="border-t">
                          <td className="p-2 font-mono text-xs">{roll.barcode ?? "—"}</td>
                          <td className="p-2">
                            {roll.item.name}
                            {roll.color ? ` · ${roll.color.name}` : ""}
                          </td>
                          <td className="p-2 text-right tabular-nums">{String(roll.currentQty)}</td>
                          <td className="p-2 text-xs text-muted-foreground">{roll.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* KABUL EDİLEN İPLİK — koşullu ikinci tablo (Sınıf 5). Ters kayıt
                  (movementKind !== "IN") soluk satır + amber "İptal" rozeti:
                  gizlense fiş "hiç iplik girmemiş" gibi okunur, üstü çizilse
                  "rakam geçersiz" derdi — oysa defter satırı geçerli bir OLAYDIR. */}
              {yarnLines.length > 0 && (
                <div className="overflow-hidden rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="p-2 text-left">Kabul Edilen İplik</th>
                        <th className="p-2 text-right">Kg</th>
                        {yarnHasPrice && <th className="p-2 text-right">Birim Fiyat</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {yarnLines.map((l) => {
                        const reversed = l.movementKind !== "IN";
                        return (
                          <tr key={l.id} className={`border-t ${reversed ? "opacity-50" : ""}`}>
                            <td className="p-2">
                              {l.itemName}
                              {l.itemCode ? (
                                <span className="ml-1 font-mono text-xs text-muted-foreground">{l.itemCode}</span>
                              ) : null}
                              {reversed && (
                                <Badge
                                  variant="outline"
                                  className="ml-2 border-amber-400 text-amber-700 dark:text-amber-400"
                                  title={l.reason ?? "Ters kayıt — fiş iptalinin defter düşümü"}
                                >
                                  İptal
                                </Badge>
                              )}
                            </td>
                            {/* Kg POZİTİF basılır — yönü rozet söyler (backend
                                sözleşmesi: qtyKg her zaman pozitif). */}
                            <td className="p-2 text-right tabular-nums">{fmt(l.qtyKg)}</td>
                            {yarnHasPrice && (
                              <td className="p-2 text-right tabular-nums">{fmt(l.unitPrice)}</td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => setDocOpen(true)}>
                  <Printer className="mr-1 h-4 w-4" />
                  Fişi Görüntüle / Bas
                </Button>
                {/* ⚠️ Etiket basmak ZORUNLU DEĞİLDİR — barkod topun DB kimliği
                    olarak zaten doğdu; bu düğme yalnız bir kolaylıktır.
                    İptal edilmiş toplar dışarıda (etiketi basılacak mal yok). */}
                <PermissionGate permission="label:read">
                  <BulkRollLabelButton
                    rollIds={(r.rolls ?? []).filter((x) => x.status !== "CANCELLED").map((x) => x.id)}
                    label="Etiketleri Bas"
                  />
                </PermissionGate>
                {r.status === "ACTIVE" && (
                  <PermissionGate permission="finance:write">
                    <Button
                      variant="outline"
                      disabled={invoiceM.isPending}
                      onClick={() => invoiceM.mutate()}
                      title="Fişin toplarını ürün+renk+fiyat kırılımında gruplayıp alış faturası taslağı üretir"
                    >
                      <FileText className="mr-1 h-4 w-4" />
                      {invoiceM.isPending ? "Oluşturuluyor…" : "Alış Faturası Oluştur"}
                    </Button>
                  </PermissionGate>
                )}
                {r.status === "ACTIVE" && (
                  <PermissionGate permission="goods-receipt:write">
                    <Button variant="destructive" onClick={() => setConfirmCancel(true)}>
                      <Ban className="mr-1 h-4 w-4" />
                      Fişi İptal Et
                    </Button>
                  </PermissionGate>
                )}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <PrintedDocDialog
        docType="GOODS_RECEIPT"
        sourceId={id}
        open={docOpen}
        onOpenChange={setDocOpen}
        title={`Mal Kabul Fişi — ${r?.receiptNo ?? ""}`}
        description="Belge İLK BASKIDA donar (fiş bir kaptır; satırlar sonradan eklenebilir)."
        writePermission="goods-receipt:write"
      />

      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title="Mal kabul fişi iptal edilsin mi?"
        description={
          // Yıkıcı-işlem kuralı: etkilenen İÇERİK somut söylenir — yalnız-iplik
          // fişte "0 top iptal edilecek" yazmak operatöre "iplik etkilenmez" derdi.
          `${r?.receiptNo}: fişteki ${[
            // "0 top" yalnız iplik de yokken yazılır (eski metin korunur);
            // yalnız-iplik fişte "0 top + …" gürültüsü basılmaz.
            ...((r?.totals.rollCount ?? 0) > 0 || yarnLines.length === 0
              ? [`${r?.totals.rollCount ?? 0} top`]
              : []),
            ...(yarnLines.length > 0 ? [`${fmt(yarnKgNet)} kg iplik (ters kayıtla düşülür)`] : []),
          ].join(" + ")} da İPTAL edilecek ("mal hiç girmedi" kaydı). ` +
          `İşlem görmüş (üretime girmiş / sevk edilmiş) top varsa iptal reddedilir.`
        }
        confirmLabel="Fişi İptal Et"
        onConfirm={() => cancelM.mutate("Mal kabul fişi iptali")}
        isPending={cancelM.isPending}
        destructive
      />
    </>
  );
}
