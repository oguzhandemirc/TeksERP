import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ReferenceSelect } from "@/components/forms/ReferenceSelect";
import { customerService } from "@/pages/Customers/service";
import { useMultiWarehouse, useDefaultWarehouse, WAREHOUSES_QUERY_KEY } from "@/hooks/useWarehouses";
import type { Customer } from "@/pages/Customers/types";
import { createGoodsReceipt } from "./service";
import {
  ReceiptLineRows, emptyLine, expandLines, receiptTotals, type DraftLine,
} from "./ReceiptLineRows";
import { ReceiptImportButton } from "./ReceiptImportButton";
import { useItemTypes, yarnIdsFrom } from "./useItemTypes";
// TİCARET (D3) — alış siparişi bağı. Bölüm görünürlük kararını KENDİ verir
// (`showPurchaseOrderFields`) ve fabrikada tek bayt çizmez; burada bir `&&`
// zinciri YOK, çünkü zincir bir gün ters çevrilirse hiçbir test kırılmazdı.
import { GoodsReceiptOrderSection } from "../PurchaseOrders/GoodsReceiptOrderSection";
import { mergeFilledLines } from "../PurchaseOrders/receiptOrderFields";
import type { ReceiptPurchaseOrderSync } from "../PurchaseOrders/receiptSync";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Fiş oluştu.
   *
   * ⚠️ İkinci parametre YALNIZ bu yanıtta vardır ve hiçbir yere kaydedilmez
   * (bkz. `service.ts` → `GoodsReceiptCreateData`): "fazla mal geldi" / "bu ürün
   * siparişte yok" bilgisi burada yutulursa BİR DAHA ELDE EDİLEMEZ. Opsiyonel
   * bırakıldı ki sipariş bağı olmayan çağıran imzayı hiç bilmek zorunda kalmasın.
   */
  onCreated: (id: string, sync?: ReceiptPurchaseOrderSync | null) => void;
}

export function GoodsReceiptFormDialog({ open, onOpenChange, onCreated }: Props) {
  const { multiWarehouse, warehouses } = useMultiWarehouse();
  const defaultWarehouse = useDefaultWarehouse();
  const qc = useQueryClient();

  const [warehouseId, setWarehouseId] = useState<string>("");
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [deliveryNoteNo, setDeliveryNoteNo] = useState("");
  // Fiş TEK para birimlidir — satır fiyatları bu birimde. Karışık fiş, alış
  // faturasını iki para biriminde kesmeyi gerektirirdi (fatura tek birimli).
  const [currency, setCurrency] = useState<"TRY" | "USD" | "EUR" | "GBP" | "RUB">("TRY");
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()]);
  // Bağlanacak alış siparişi — ticaret rejimi kapalıyken DAİMA null kalır
  // (bölüm hiç çizilmez), yani istek gövdesi fabrikadaki bugünküyle aynıdır.
  const [purchaseOrderId, setPurchaseOrderId] = useState<string | null>(null);

  // ⚠️ TEK DEPOLU KURULUMDA SEÇİCİ ÇİZİLMEZ — depo otomatik varsayılandır.
  // Tek seçenekli bir liste, cevabı belli bir soruyu sormaktır.
  const effectiveWarehouseId = multiWarehouse ? warehouseId : (defaultWarehouse?.id ?? "");

  // Kalem türleri asenkron çözülür (Sınıf 5): iplik satırı kg'dir ve kumaşa
  // özgü alan taşımaz. ⚠️ Harita/küme kimliği her render'da değişir — totals
  // bu yüzden useMemo'suz hesaplanır (memo, lookup çözüldüğünde bayat kalırdı;
  // maliyet satır sayısıyla sınırlı ve önemsiz).
  const itemTypes = useItemTypes(lines.map((l) => l.itemId));
  const yarnIds = yarnIdsFrom(itemTypes);
  const totals = receiptTotals(lines, yarnIds);
  // İplik-only fiş MEŞRU — "top yok" diye kilitlemek 500 kg ipliği girilemez yapardı.
  const valid = Boolean(effectiveWarehouseId) && (totals.rolls > 0 || totals.yarnLines > 0);
  const submitSummary =
    [
      totals.rolls > 0 ? `${totals.rolls} top` : null,
      totals.yarnLines > 0 ? `${totals.yarnLines} iplik` : null,
    ]
      .filter(Boolean)
      .join(" + ") || "0 top";

  const createM = useMutation({
    mutationFn: () =>
      createGoodsReceipt({
        warehouseId: effectiveWarehouseId,
        supplierId,
        deliveryNoteNo: deliveryNoteNo || null,
        currency,
        // Fişin KENDİ idempotency anahtarı — çift tıklama/ağ kopması ikinci fiş
        // AÇMAZ ve satırları tekrar İŞLEMEZ (backend mevcut fişi döner).
        clientToken: crypto.randomUUID(),
        // Servis, değer yoksa anahtarı gövdeye HİÇ koymaz (bkz. service.ts).
        purchaseOrderId,
        lines: expandLines(lines, yarnIds),
      }),
    onSuccess: (res) => {
      // Atlanan satır varsa SESSİZ GEÇME — sebebiyle söyle.
      const failed = res.data.failed ?? [];
      if (failed.length > 0) {
        toast.warning(`${failed.length} satır atlandı: ${failed.map((f) => f.reason).slice(0, 2).join(" · ")}`);
      } else {
        toast.success(res.message ?? "Mal kabul fişi oluşturuldu.");
      }
      void qc.invalidateQueries({ queryKey: ["goods-receipts"] });
      void qc.invalidateQueries({ queryKey: ["rolls"] });
      // İplik satırı `YarnMovement` doğurur — İplik Stoku ekranı ["yarn", …]
      // anahtarlarını kullanır; invalidate edilmezse bakiye bayat kalır.
      void qc.invalidateQueries({ queryKey: ["yarn"] });
      void qc.invalidateQueries({ queryKey: WAREHOUSES_QUERY_KEY });
      setLines([emptyLine()]);
      setDeliveryNoteNo("");
      setSupplierId(null);
      setPurchaseOrderId(null);
      // ⚠️ SENKRON SONUCU YUKARI TAŞINIR, TOAST'A DEĞİL: toast birkaç saniyede
      // kaybolur ve "fazla mal geldi" / "bu ürün siparişte yok" bilgisi hiçbir
      // yere kaydedilmediği için bir daha ELDE EDİLEMEZ. Sayfa onu fişin detay
      // panelinde KALICI banda basar (`PurchaseOrderSyncBand`).
      onCreated(res.data.id, res.data.purchaseOrder ?? null);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl">
        <DialogHeader>
          <DialogTitle>Yeni Mal Kabul</DialogTitle>
          <DialogDescription>
            Aynı üründen birden fazla top geldiyse <b>Adet</b> yazmanız yeter — her top kendi
            barkoduyla ayrı ayrı doğar. Benzer bir satır için <b>kopyala</b> düğmesini kullanın.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* ⚠️ TEDARİKÇİDEN ÖNCE: sipariş seçimi tedarikçiyi DEVRALIR (backend,
              fişin tedarikçisi ile siparişinki farklıysa 400 verir; ekran o reddi
              seçim ANINDA söyler). Bölüm fabrikada `null` döndüğü için buradaki
              yerleşim de bugünküyle bayt-bayt aynı kalır. */}
          <GoodsReceiptOrderSection
            value={purchaseOrderId}
            onChange={setPurchaseOrderId}
            supplierId={supplierId}
            onSupplierChange={setSupplierId}
            // Satırlar EKLENİR, üstüne yazılmaz — kural saf katmanda.
            onFillLines={(filled) => setLines((ls) => mergeFilledLines(ls, filled))}
            disabled={createM.isPending}
          />

          <div className="grid grid-cols-4 gap-3">
            {multiWarehouse && (
              <div>
                <Label>Depo</Label>
                <select
                  className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm"
                  value={warehouseId}
                  onChange={(e) => setWarehouseId(e.target.value)}
                >
                  <option value="">Depo seçin…</option>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <Label>Tedarikçi (opsiyonel)</Label>
              <div className="mt-1">
                <ReferenceSelect<Customer>
                  value={supplierId}
                  onChange={setSupplierId}
                  service={customerService}
                  queryKey="customers"
                  getLabel={(c) => `${c.code} — ${c.name}`}
                  placeholder="Tedarikçi ara..."
                />
              </div>
            </div>
            <div>
              <Label>Para Birimi</Label>
              <select
                className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm"
                value={currency}
                onChange={(e) => setCurrency(e.target.value as typeof currency)}
              >
                {(["TRY", "USD", "EUR", "GBP", "RUB"] as const).map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <Label>Tedarikçi İrsaliye No (opsiyonel)</Label>
              <Input
                className="mt-1"
                value={deliveryNoteNo}
                onChange={(e) => setDeliveryNoteNo(e.target.value)}
                placeholder="IRS-..."
              />
            </div>
          </div>

          {/* İçe aktarma satırları EKLER, üstüne yazmaz — elle girilmiş bir
              kalem yüklemeyle sessizce kaybolmasın. */}
          <ReceiptImportButton
            onImported={(imported) =>
              setLines((ls) => {
                const kept = ls.filter((l) => l.itemId && l.initialQty > 0);
                return [...kept, ...imported];
              })
            }
          />

          {/* ⚠️ `yarnItemIds` GEÇİLMEK ZORUNDA — verilmezse satır editörü tüm
              kalemleri kumaş sayar: iplik satırı renk/en/kat sorar, backend
              400 verir ve "kg" rozeti hiç çizilmez (sözleşme ReceiptLineRows
              Props yorumunda). */}
          <ReceiptLineRows lines={lines} onChange={setLines} yarnItemIds={yarnIds} />

          <div className="flex items-center justify-between">
            <Button variant="ghost" size="sm" onClick={() => setLines((ls) => [...ls, emptyLine()])}>
              <Plus className="mr-1 h-4 w-4" />
              Satır ekle
            </Button>
            {/* Canlı özet: operatör "20 tane" yazdığında kaç TOP doğacağını
                kaydetmeden görsün — yanlış çarpan en pahalı hatadır. */}
            <p className="text-sm text-muted-foreground">
              Toplam: <b className="text-foreground">{totals.rolls}</b> top ·{" "}
              <b className="text-foreground">{totals.meters.toLocaleString("tr-TR")}</b> m
              {/* İplik AYRI birimde eklenir — kg metreye TOPLANMAZ (backend
                  `ReceiptTotals` sözleşmesi). İplik yokken çıktı bayt-bayt eski. */}
              {totals.yarnLines > 0 && (
                <>
                  {" + "}
                  <b className="text-foreground">{totals.yarnKg.toLocaleString("tr-TR")}</b> kg iplik
                </>
              )}
              {totals.amount > 0 && (
                <>
                  {" · "}
                  <b className="text-foreground">
                    {totals.amount.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </b>{" "}
                  {currency}
                </>
              )}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>İptal</Button>
          {/* Düğme İÇERİĞİ söyler — yalnız-iplik fişte "0 top" yazmak operatöre
              "kaydedilecek bir şey yok" derdi (submitSummary iplik dalını taşır). */}
          <Button disabled={!valid || createM.isPending} onClick={() => createM.mutate()}>
            {createM.isPending ? "Kaydediliyor…" : `Fişi Oluştur (${submitSummary})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
