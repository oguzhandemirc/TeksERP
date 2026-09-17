// =============================================================================
// MAL KABUL FORMUNA TAKILAN "ALIŞ SİPARİŞİ" BÖLÜMÜ
// =============================================================================
// Mal kabul ekranı FABRİKADA DA kullanılıyor; alış siparişi ise TİCARET
// paketine ait. Bu bölüm kendi görünürlük kararını `showPurchaseOrderFields`
// (SAF fonksiyon, bekçili) ile verir ve rejim kapalıysa TEK BAYT çizmez — yani
// çağıran formun içine bir `&&` zinciri yazmasına gerek yoktur ve o zincirin
// bir gün ters çevrilmesi de mümkün değildir.
//
// ⚠️ TEDARİKÇİ SİPARİŞTEN MİRAS ALINIR. Backend, fişin tedarikçisi ile
// siparişin tedarikçisi farklıysa 400 veriyor ("birini düzeltin") — hangisinin
// doğru olduğunu yalnız operatör bilir ve yanlış tarafa yazmak alış faturası
// mutabakatını yanlış cariye bağlardı. Sipariş seçildiğinde tedarikçiyi ondan
// almak, çelişkiyi seçim ANINDA kapatır ve bu ekranda AÇIKÇA yazılır (sessiz
// düzeltme, kullanıcının girdiğini haber vermeden değiştirmektir).
//
// ⚠️⚠️ MİRAS/KARŞILAŞTIRMA İKİ BACAĞI BİRDEN TAŞIR (C4). Backend uyumu artık
// "bacak + kimlik" (`samePartyAs`): yalnız `supplierId` karşılaştıran eski
// satır İKİ NULL'u "eşit" sayardı — yani fason tedarikçili bir siparişe
// müşteri-tipli tedarikçili fiş bağlanabilir görünürdü ve red ancak KAYDET'te,
// hiç dokunulmamış bir alandan gelirdi.
//
// ⚠️⚠️ "KALEMLERİ SİPARİŞTEN DOLDUR" METRAJI DOLDURMAZ (kumaşta). Fiş formunda
// metre TOP BAŞINA, siparişteki kalan ise TOPLAMDIR: 500 m bekleyen kalemi tek
// satıra yazmak sisteme 500 metrelik TEK bir top girmek demektir (gerçekte 5 top
// × ~100 m) ve bundan sonraki her akış — barkod, kesim, sevk, iade — sessizce
// yanlış olur. Kural `fillLinesFromOrder` içinde, bekçisi
// `receiptOrderFields.test.ts`. Bekleyen miktarlar bu yüzden ekranda REFERANS
// TABLOSU olarak durur: depocu neyi ne kadar gireceğini görür, sistem onun
// yerine tahmin etmez.
// =============================================================================
import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useFeatureFlags } from "@/hooks/usePricingEnabled";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import {
  sameSupplierParty, supplierPartyOf, supplierRefOf, type SupplierParty,
} from "@/components/forms/supplierParty";
import type { DraftLine } from "../GoodsReceipts/ReceiptLineRows";
import { PurchaseOrderPicker } from "./PurchaseOrderPicker";
import { fmtQty, getPurchaseOrder } from "./service";
import { fulfillmentOf, remainingText } from "./fulfillment";
import { describeFill, fillLinesFromOrder, showPurchaseOrderFields } from "./receiptOrderFields";

interface Props {
  /** Seçili alış siparişi — fiş gövdesinde `purchaseOrderId` olarak gider. */
  value: string | null;
  onChange: (id: string | null) => void;
  /** Fişteki tedarikçi TARAFI — sipariş seçilince ondan MİRAS ALINIR. */
  supplier: SupplierParty | null;
  onSupplierChange: (party: SupplierParty | null) => void;
  /** Üretilen taslak satırlar — çağıran bunları MEVCUT satırlara EKLER. */
  onFillLines: (lines: DraftLine[]) => void;
  disabled?: boolean;
}

export function GoodsReceiptOrderSection({
  value,
  onChange,
  supplier,
  onSupplierChange,
  onFillLines,
  disabled,
}: Props) {
  const flags = useFeatureFlags();
  const { hasAnyPermission } = useRoleAccess();
  const visible = showPurchaseOrderFields({
    financeEnabled: flags.data?.data?.financeEnabled ?? false,
    canReadPurchaseOrders: hasAnyPermission(["purchase-order:read", "purchase-order:write"]),
  });

  const detailQ = useQuery({
    queryKey: ["purchase-order", value],
    queryFn: () => getPurchaseOrder(value as string),
    enabled: visible && Boolean(value),
  });
  const po = detailQ.data;

  // Siparişin tedarikçi TARAFI — dolu bacak (cari kart ya da fason firma).
  const poParty = supplierPartyOf(po);
  const poSupplierRef = supplierRefOf(po);

  // Tedarikçiyi siparişten devral. Etki, prop geri döndüğü an kendini kapatır
  // (koşul false olur) → döngü yok. `ref` yalnız "hangi sipariş için devrettik"
  // bilgisini tutar; kullanıcı tedarikçiyi ELLE değiştirirse üstüne yazmayız.
  const inheritedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!po || !poParty) return;
    if (inheritedFor.current === po.id) return;
    inheritedFor.current = po.id;
    if (!sameSupplierParty(supplier, poParty)) onSupplierChange(poParty);
  }, [po, poParty, supplier, onSupplierChange]);

  // Kalanı 0'ın üstünde olan kalemler — doldurmanın da referans tablosunun da
  // kaynağı. Kalan hesabı ortak fonksiyondan gelir (backend'in `remainingQty`
  // alanı 0'a kırpılmıştır ve fazlalığı göstermez).
  const pending = (po?.lines ?? [])
    .map((l) => ({ line: l, f: fulfillmentOf(l) }))
    .filter((x) => x.f.remaining > 0);

  const handleFill = () => {
    const result = fillLinesFromOrder(
      pending.map((x) => ({
        item: x.line.item,
        remainingQty: x.f.remaining,
        unitPrice: x.line.unitPrice,
      })),
    );
    if (result.lines.length > 0) onFillLines(result.lines);
    // Sessiz başarı YOK: metrajın neden boş kaldığı cümlede yazar.
    if (result.lines.length === 0) toast.info(describeFill(result));
    else toast.success(describeFill(result));
  };
  // OTOMATİK DOLDURMA (kullanıcı isteği 2026-09-17): sipariş SEÇİLDİĞİ anda bekleyen kalemler fiş satırı olur —
  // tedarikçi devralmayla aynı an, sipariş başına BİR KEZ (kullanıcı satırları sonra silerse yeniden dayatılmaz;
  // `mergeFilledLines` elle girileni silmez). "Siparişsiz"e dönüş satırları SİLMEZ. Düğme kalır, ikincil: yeniden ekler.
  const autoFilledFor = useRef<string | null>(null);
  useEffect(() => {
    if (!po || disabled) return;
    if (autoFilledFor.current === po.id) return;
    autoFilledFor.current = po.id;
    if (pending.length > 0) handleFill();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- yalnız sipariş DEĞİŞİNCE bir kez; pending o anki kalanlardır
  }, [po?.id, disabled]);

  if (!visible) return null;


  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[280px] flex-1">
          <Label>Alış siparişi (opsiyonel)</Label>
          <PurchaseOrderPicker
            className="mt-1"
            value={value}
            onChange={(id) => {
              // Sipariş DEĞİŞTİ → devralma izni yeniden doğar.
              inheritedFor.current = null;
              onChange(id);
            }}
            supplier={supplier}
            disabled={disabled}
          />
        </div>
        {po && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled || pending.length === 0}
            onClick={handleFill}
            title={
              pending.length === 0
                ? "Bu siparişte bekleyen kalem kalmamış"
                : "Bekleyen kalemleri yeniden ekler; girdiğin satırlar korunur"
            }
          >
            <Download className="mr-1 h-4 w-4" />
            Siparişten yeniden doldur
          </Button>
        )}
      </div>

      {po && (
        <>
          {/* ⚠️ CÜMLE DURUMU ANLATIR, NİYETİ DEĞİL. Devralma yalnız sipariş
              SEÇİLDİĞİ anda yapılır ve kullanıcı tedarikçiyi sonradan elle
              değiştirirse üstüne YAZILMAZ (sessiz düzeltme, kullanıcının
              girdiğini haber vermeden değiştirmektir). O yüzden koşulsuz
              "tedarikçi siparişten alındı" demek, tam da çeliştikleri anda
              ekranda duran bir yalan olurdu — backend ise kaydı 400 ile
              reddedecek. İki hâl AYRI cümle kurar. */}
          {supplier && poParty && !sameSupplierParty(supplier, poParty) ? (
            <p className="mt-2 flex items-start gap-2 rounded-md bg-amber-100 px-3 py-2 text-[11px] text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              <Info className="mt-0.5 h-3 w-3 shrink-0" />
              <span>
                Fişteki tedarikçi ile <b>{po.orderNo}</b> siparişinin tedarikçisi (
                <b>{poSupplierRef?.name ?? "—"}</b>) aynı değil — bu fiş <b>kaydedilemez</b>.
                Hangisinin doğru olduğunu yalnız siz bilirsiniz: ya fişin tedarikçisini düzeltin ya
                da siparişi bırakın.
              </span>
            </p>
          ) : (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Tedarikçi siparişten alındı: <b>{poSupplierRef?.name ?? "—"}</b>
              {poSupplierRef?.kind === "SUBCONTRACTOR" && " (fason firma)"}. Fişteki tedarikçi ile
              siparişinki farklı olamaz — sistem hangisinin doğru olduğunu bilemez.
            </p>
          )}

          {pending.length === 0 ? (
            <p className="mt-2 text-[11px] text-muted-foreground">
              {po.orderNo} siparişinde bekleyen kalem kalmamış. Fişi yine bu siparişe bağlayabilirsiniz —
              fazla gelen mal engellenmez, siparişte “fazla geldi” olarak görünür.
            </p>
          ) : (
            <div className="mt-3">
              <p className="mb-1 flex items-start gap-1.5 text-[11px] text-muted-foreground">
                <Info className="mt-0.5 h-3 w-3 shrink-0" />
                Bekleyen miktarlar TOPLAMDIR. Fiş satırındaki <b>Metre</b> ise TOP BAŞINA girilir —
                bu yüzden kumaş kalemlerinde metre otomatik doldurulmaz.
              </p>
              <div className="overflow-hidden rounded-md border bg-background">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 text-[10px] uppercase text-muted-foreground">
                    <tr>
                      <th className="px-2 py-1 text-left">Ürün</th>
                      <th className="px-2 py-1 text-right">Ismarlanan</th>
                      <th className="px-2 py-1 text-right">Gelen</th>
                      <th className="px-2 py-1 text-right">Bekleyen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pending.map(({ line, f }) => (
                      <tr key={line.id} className="border-t">
                        <td className="px-2 py-1">
                          {line.lineNo}. {line.item.name}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums">
                          {fmtQty(line.qty, line.item.unit)}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">
                          {fmtQty(line.receivedQty, line.item.unit)}
                        </td>
                        <td className="px-2 py-1 text-right font-medium tabular-nums">
                          {remainingText(f, line.item.unit)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {value && detailQ.isError && (
        <p className="mt-2 text-[11px] text-destructive">
          Sipariş bilgisi okunamadı — bekleyen kalemler gösterilemiyor. Fişi yine kaydedebilirsiniz;
          karşılanma sunucuda hesaplanır.
        </p>
      )}
    </div>
  );
}
