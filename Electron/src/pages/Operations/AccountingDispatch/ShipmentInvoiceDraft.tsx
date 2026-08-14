// =============================================================================
// SEVKİYATTAN İÇ FATURA TASLAĞI
// =============================================================================
// "Sevk ettim, şimdi faturasını keseyim" — muhasebecinin ürün/metraj dökümünü
// elle yeniden yazmasını bitirir.
//
// ⚠️ YENİ BACKEND UCU YOK ve gerekmiyor (ölçüldü): `createDraft` `shipmentId`yi
// zaten alıyor, `assertSourceFree` çift faturayı reddediyor, onay sevkiyatı
// damgalıyor. Buradaki iş yalnız ÖN-DOLDURMA.
//
// ⚠️ FİYAT UYDURULMAZ. Bugün satır fiyatı BOŞ (0) gelir ve kullanıcı girer;
// kart/müşteri fiyatı (D2 `ItemPrice`) yazıldığında çözüm sırası buraya
// bağlanır. Sıfırı "fiyat" diye sunmak, onaylanınca cari defteri sessizce
// yanlışlardı — bu yüzden diyalog fiyatsız satırı zaten geçirmiyor.
// =============================================================================
import { useQuery } from "@tanstack/react-query";
import { accountingDispatchService } from "./service";
import { InvoiceFormDialog, type InvoicePrefill } from "@/pages/Finance/InvoiceFormDialog";
import type { DispatchListItem } from "./types";

interface Props {
  row: DispatchListItem | null;
  onClose: () => void;
  onCreated: () => void;
}

export function ShipmentInvoiceDraft({ row, onClose, onCreated }: Props) {
  // Fiş zaten ekranda kullanılan uç — ürün kırılımı (ad · top · metre) oradan
  // gelir. DIRECT (fasondan doğrudan sevk) kendi raporunu kullanır; ikisi AYNI
  // şekli döndürüyor, bu yüzden tek eşleme yeter.
  const report = useQuery({
    queryKey: ["accounting-dispatch", "report", row?.id, row?.kind],
    queryFn: () =>
      row?.kind === "DIRECT"
        ? accountingDispatchService.getDirectReport(row.id)
        : accountingDispatchService.getReport(row!.id),
    enabled: Boolean(row),
  });

  if (!row) return null;
  if (report.isLoading || !report.data?.data) return null;

  const rep = report.data.data;
  const prefill: InvoicePrefill = {
    shipmentId: row.id,
    customerId: row.customer.id,
    // Satır = ÜRÜN kırılımı, top değil: fatura kalemi ticari birimdir; 40 topu
    // 40 satır yazmak faturayı okunmaz yapar ve müşteri de öyle beklemez.
    // Top dökümü zaten irsaliyede/çeki listesinde duruyor.
    lines: rep.products.map((p) => ({
      description: p.name,
      qty: p.totalMeters,
      unit: "m",
    })),
    sourceLabel: rep.header.shipmentNo,
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
