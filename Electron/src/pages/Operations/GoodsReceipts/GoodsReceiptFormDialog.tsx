import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { SupplierSelect } from "@/components/forms/SupplierSelect";
import { supplierPartyPayload, type SupplierParty } from "@/components/forms/supplierParty";
import { useMultiWarehouse, useDefaultWarehouse, WAREHOUSES_QUERY_KEY } from "@/hooks/useWarehouses";
import { useDevereLotRequired, useFeatureFlags } from "@/hooks/usePricingEnabled";
import { expandLineKeys, localLineIssues, receiptLinesInvalidFrom, serverLineIssues } from "./receiptLineIssues";
import { createGoodsReceipt } from "./service";
import { receiptSuccessText } from "./receiptFeedback";
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
  // ⚠️ Başarı cümlesindeki SEKME ADI rejime bağlı ("Bitmiş Depo" ↔ "Depo") ve
  // bu ekran tam da adların değiştiği kurulumda yaşıyor. Bayrak yüklenmemişse
  // `false` = fabrika adlandırması (bugünkü davranış).
  const financeEnabled = useFeatureFlags().data?.data?.financeEnabled ?? false;

  const [warehouseId, setWarehouseId] = useState<string>("");
  // C4 — tedarikçi İKİ kaynaktan gelebilir (cari kart / fason firma); seçim
  // {kind, id} taşır ve gövdedeki XOR'u `supplierPartyPayload` kurar. Yalnız id
  // tutmak, fason firmayı sessizce müşteri-tipli cari olarak kaydederdi.
  const [supplier, setSupplier] = useState<SupplierParty | null>(null);
  // C2 — "işlenecek mal": toplar `WAREHOUSE` yerine `STOCK` doğar. VARSAYILAN
  // KAPALI = bugünkü davranış (satılabilir bitmiş mal alımı).
  const [rawStockEntry, setRawStockEntry] = useState(false);
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
  // C8: doğrulama sınıfı hata SATIRDA — yerel (bayrak biliniyorsa sunucuya gitmeden) + sunucu 400 `details.lines` (aynı alan).
  const lotRequired = useDevereLotRequired();
  const [serverIssues, setServerIssues] = useState<ReadonlyMap<string, string>>(new Map());
  const localIssues = localLineIssues(lines, yarnIds, lotRequired);
  const lineIssues = new Map([...serverIssues, ...localIssues]);
  const setLinesAndClear = (next: DraftLine[] | ((prev: DraftLine[]) => DraftLine[])) => {
    setServerIssues(new Map());
    setLines(next);
  };
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
        // XOR TEK NOKTADAN: iki anahtarı elle yazmak, bacak değiştiğinde
        // eskisini temizlemeyi unutmak demekti (iki tedarikçili kayıt).
        ...supplierPartyPayload(supplier),
        rawStockEntry,
        deliveryNoteNo: deliveryNoteNo || null,
        currency,
        // Fişin KENDİ idempotency anahtarı — çift tıklama/ağ kopması ikinci fiş
        // AÇMAZ ve satırları tekrar İŞLEMEZ (backend mevcut fişi döner).
        clientToken: crypto.randomUUID(),
        // Servis, değer yoksa anahtarı gövdeye HİÇ koymaz (bkz. service.ts).
        purchaseOrderId,
        lines: expandLines(lines, yarnIds),
      }),
    onError: (error) => {
      // C8: sunucu ön-uçuşu → satıra bağla, modal AÇIK kalır, toast yok. Başka hata → mevcut yol (interceptor toast'ı).
      const issues = receiptLinesInvalidFrom(error);
      if (issues) setServerIssues(serverLineIssues(issues, expandLineKeys(lines)));
    },
    onSuccess: (res) => {
      // Atlanan satır varsa SESSİZ GEÇME — sebebiyle söyle (yalnız KOŞU ANI hataları: yarış/409).
      const failed = res.data.failed ?? [];
      if (failed.length > 0) {
        toast.warning(`${failed.length} satır atlandı: ${failed.map((f) => f.reason).slice(0, 2).join(" · ")}`);
      } else {
        // B5 — "toplar nereye düştü" CÜMLESİ. ⚠️ Sayılar YANITTAN okunur,
        // taslaktan değil: backend satır atlayabilir ve taslaktan sayan bir
        // toast envanterde olmayan topu "eklendi" diye bildirirdi.
        toast.success(
          receiptSuccessText({
            receiptNo: res.data.receiptNo,
            rollCount: res.data.totals?.rollCount ?? 0,
            yarnLineCount: res.data.totals?.yarnLineCount ?? 0,
            rawStockEntry: res.data.rawStockEntry ?? rawStockEntry,
            financeEnabled,
          }),
        );
      }
      void qc.invalidateQueries({ queryKey: ["goods-receipts"] });
      void qc.invalidateQueries({ queryKey: ["rolls"] });
      // İplik satırı `YarnMovement` doğurur — İplik Stoku ekranı ["yarn", …]
      // anahtarlarını kullanır; invalidate edilmezse bakiye bayat kalır.
      void qc.invalidateQueries({ queryKey: ["yarn"] });
      void qc.invalidateQueries({ queryKey: WAREHOUSES_QUERY_KEY });
      setLines([emptyLine()]);
      setDeliveryNoteNo("");
      setSupplier(null);
      setRawStockEntry(false);
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
            supplier={supplier}
            onSupplierChange={setSupplier}
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
              {/* Sipariş seçiliyken tedarikçi SİPARİŞTEN gelir ve KİLİTLİDİR (kullanıcı testi C2, 2026-09-17):
                  bölüm "farklı olamaz" derken altta tıklanabilir + temizlenebilir bir kutu kalıyordu.
                  Sipariş kaldırılınca alan serbest kalır, değer korunur. */}
              <Label>{purchaseOrderId ? "Tedarikçi (siparişten)" : "Tedarikçi (opsiyonel)"}</Label>
              {/* C4 — cari kartlar VE fason firmalar tek kutuda aranır.
                  Kullanıcı firmanın adını bilir, hangi tabloda durduğunu değil. */}
              <SupplierSelect
                className="mt-1"
                value={supplier}
                onChange={setSupplier}
                nullable={!purchaseOrderId}
                noneLabel="— (tedarikçisiz)"
                disabled={createM.isPending || purchaseOrderId !== null}
                modalPicker
              />
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

          {/* ── C2 → EK 5: RAF SEÇİMİ fişin VARSAYILANI, satırda değiştirilebilir ──
              Ürünün niteliği kartındadır; buradaki soru topun hangi RAFA
              gireceğidir. Eski "fiş bir kaptır" okuması kullanıcı kararıyla
              (2026-09-17) satır bazına açıldı: kutu yeni kumaş satırlarının
              Ham/Bitmiş anahtarını doldurur, satır kendi seçimini gövdede
              `rawStock` olarak taşır (seçilmediyse gönderilmez → fiş kutusu).
              ⚠️ İPLİK BU SEÇİMDEN ETKİLENMEZ: `YarnStock` kalem × DEPO bazında
              kg tutar, raf/statü kavramı yoktur (backend'de de yazılı). */}
          <label className="flex cursor-pointer items-start gap-2 rounded-md border bg-muted/20 p-3">
            <Checkbox
              className="mt-0.5"
              checked={rawStockEntry}
              disabled={createM.isPending}
              onCheckedChange={(c) => setRawStockEntry(Boolean(c))}
            />
            <span className="text-sm">
              Yeni kumaş satırları ham stok olarak alınsın (işlenecek mal)
              <span className="mt-0.5 block text-[11px] text-muted-foreground">
                Kumaş satırlarındaki <b>Ham/Bitmiş</b> anahtarının varsayılanıdır; satırda değiştirilebilir. Ham toplar{" "}
                <b>Ham Stok</b> sekmesine düşer ve fasona sevk edilebilir; bitmiş toplar satılabilir mal olarak{" "}
                <b>Bitmiş Depo</b>ya girer (varsayılan).
              </span>
            </span>
          </label>

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
          <ReceiptLineRows lines={lines} onChange={setLinesAndClear} yarnItemIds={yarnIds} lineIssues={lineIssues} rawStockDefault={rawStockEntry} />

          {/* Satır ekleme düğmeleri grupların kendisinde (EK 5) — burada yalnız özet. */}
          <div className="flex items-center justify-end">
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
          <Button
            disabled={!valid || createM.isPending || localIssues.size > 0}
            title={localIssues.size > 0 ? `${localIssues.size} satırda lot eksik — Devere ayarı lot zorunlu` : undefined}
            onClick={() => createM.mutate()}
          >
            {createM.isPending ? "Kaydediliyor…" : `Fişi Oluştur (${submitSummary})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
