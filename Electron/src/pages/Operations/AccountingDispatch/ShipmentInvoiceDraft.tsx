// =============================================================================
// SEVKİYATTAN İÇ FATURA TASLAĞI
// =============================================================================
// "Sevk ettim, şimdi faturasını keseyim" — muhasebecinin ürün/metraj dökümünü
// elle yeniden yazmasını bitirir.
//
// ⚠️⚠️ SATIRLARI BACKEND KURAR (C1, 2026-08-15): `GET /api/finance/shipments/
// :id/invoice-draft-lines`. Bu diyalog eskiden sevk fişi raporundan (`products`)
// kendi satırlarını kuruyordu ve FİYATI HİÇ ÇÖZMÜYORDU (hepsi 0) — oysa sevk
// onayındaki OTOMATİK kanca aynı sevkiyat için sipariş (sözleşme) fiyatı > D2
// zinciriyle dolu satırlar üretiyordu. Yani aynı sevkiyatın faturası, hangi
// yoldan üretildiğine göre farklı çıkıyordu. Satır kurma kodu bu yüzden
// SİLİNDİ; panelin işi artık yalnız GÖSTERMEK.
//
// ⚠️ ÇELİŞKİ SESSİZ KALMAZ: aynı ürüne farklı fiyatlı sipariş kalemleri
// düşerse backend ortalama ALMAZ (uydurma fiyat yasak), kart fiyatına düşer ve
// sayacı döndürür — diyalog onu amber notla basar. Otomatik kanca aynı bilgiyi
// mesajında söylüyor; elle yolda söylenmezse muhasebeci sözleşme fiyatı
// sandığı bir kart fiyatını onaylar.
//
// ⚠️ YALNIZ ÇUVAL SEVKİYATI (`kind === "SHIPMENT"`). Fasondan DOĞRUDAN sevk
// ayrı bir tablodur (`DirectShipment`) ve `Invoice.shipmentId` FK'sı onu kabul
// etmez; düğme de o satırlarda çizilmez (`canDraftInvoice`). Burada ikinci bir
// kapı durmasının sebebi, kapının UI'dan bağımsız olması gerektiğidir.
// =============================================================================
import { useQuery } from "@tanstack/react-query";
import { getShipmentInvoiceDraftLines } from "@/pages/Finance/service";
import { InvoiceFormDialog, type InvoicePrefill } from "@/pages/Finance/InvoiceFormDialog";
import { draftPriceNotice, toPrefillLines } from "./invoiceDraftLines";
import type { DispatchListItem } from "./types";

interface Props {
  row: DispatchListItem | null;
  onClose: () => void;
  onCreated: () => void;
}

export function ShipmentInvoiceDraft({ row, onClose, onCreated }: Props) {
  const draft = useQuery({
    queryKey: ["finance", "shipment-invoice-draft", row?.id],
    queryFn: () => getShipmentInvoiceDraftLines(row!.id),
    enabled: Boolean(row) && row?.kind === "SHIPMENT",
  });

  if (!row || row.kind !== "SHIPMENT") return null;
  // Satırlar gelmeden form AÇILMAZ: boş satırla açıp sonradan doldurmak,
  // kullanıcının o arada yazdığını ezmek demekti (ön-dolum yalnız BAŞLANGIÇ
  // değeridir — diyalog koşullu mount ediliyor).
  if (draft.isLoading || !draft.data) return null;

  const dto = draft.data;
  const prefill: InvoicePrefill = {
    shipmentId: row.id,
    customerId: row.customer.id,
    // Para birimi de kancayla AYNI kuraldan gelir (cari kartının ön-dolum
    // tercihi, yoksa TRY) — form TRY'ye sabitlenirse USD'li cariye sessizce
    // TRY fatura kesilirdi.
    currency: dto.currency,
    // Satır = ÜRÜN kırılımı, top değil: fatura kalemi ticari birimdir; 40 topu
    // 40 satır yazmak faturayı okunmaz yapar ve müşteri de öyle beklemez.
    // Top dökümü zaten irsaliyede/çeki listesinde duruyor.
    lines: toPrefillLines(dto),
    sourceLabel: row.shipmentNo,
    notice: draftPriceNotice(dto),
  };

  return (
    // Koşullu mount: prefill `useState` başlangıcı olarak girer, prop senkronu yok.
    <InvoiceFormDialog
      open
      onOpenChange={(o) => !o && onClose()}
      onCreated={() => {
        onCreated();
        onClose();
      }}
      prefill={prefill}
    />
  );
}
