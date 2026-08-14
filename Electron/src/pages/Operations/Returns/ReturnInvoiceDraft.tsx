// =============================================================================
// İADEDEN SATIŞ İADE FATURASI TASLAĞI
// =============================================================================
// "Müşteri malı geri gönderdi, şimdi iade faturasını keseyim" — muhasebecinin
// ürün/metraj dökümünü elle yeniden yazmasını bitirir. Sevkiyat emsali:
// `Operations/AccountingDispatch/ShipmentInvoiceDraft.tsx`.
//
// ⚠️ YENİ BACKEND UCU YOK ve gerekmiyor: `invoice.createDraft` `returnGroupId`yi
// zaten alıyor (`finance.routes.ts` şeması + `assertSourceFree` "bir iade grubu →
// tek aktif fatura" seddi). Buradaki iş yalnız ÖN-DOLDURMA.
//
// ⚠️ FİYAT UYDURULMAZ. Satır fiyatı BOŞ (0) gelir; kalem bağı (`itemId`) taşındığı
// için diyaloğun kendi SALE fiyat zinciri (`useItemPriceSuggestion` → müşteri
// istisnası > kart varsayılanı) devreye girer. Çözülemezse alan boş kalır ve
// onay zaten fiyatsız satırı geçirmez ("fiyatsız fatura onaylanamaz").
// KAYNAK SEVKİN faturasından çekme BİLİNÇLİ OLARAK YAPILMADI: `Shipment.invoiceNo`
// ne iade satırında ne de `getShipmentById` select'inde var ve faturalar
// `shipmentId` ile sorgulanamıyor → backend okuması gerekirdi (kapsam dışı).
//
// ⚠️⚠️ DİKİŞ BEKLİYOR — `InvoicePrefill` bugün `type` ve `returnGroupId` TAŞIMIYOR
// (`Electron/src/pages/Finance/InvoiceFormDialog.tsx`, o dosya bu ajanın sahipliği
// dışında). Dikiş uygulanana kadar taslak SALES olarak ve KAYNAK BAĞI OLMADAN
// doğar; kullanıcı türü diyalogdan "Satış İade"ye çevirebilir ama grup bağı
// yazılmadığı için mükerrer-fatura seddi devreye girmez. Gereken tam diff sonuç
// JSON'undaki `dikisIhtiyaci` maddesinde.
// =============================================================================
import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { InvoiceFormDialog, type InvoicePrefill } from "@/pages/Finance/InvoiceFormDialog";
import { returnsService, type ReturnRow } from "./service";
import { buildReturnInvoiceLines } from "./returnInvoice";

/** Dikiş uygulanınca bu iki alan `InvoicePrefill`'e taşınır ve bu tip silinir. */
// `InvoicePrefill` 2026-08-14 dikişiyle `type` + `returnGroupId` alanlarını
// NATİF taşıyor — yerel genişletme tipine gerek kalmadı (ilk yazımda buradaydı;
// alanlar tipte yokken form onları sessizce düşürüyordu — dikişle kapandı).
interface Props {
  /** Tıklanan iade satırı — grup ÜYESİ de olabilir (belge lidere bağlıdır). */
  row: ReturnRow | null;
  onClose: () => void;
  onCreated: () => void;
}

export function ReturnInvoiceDraft({ row, onClose, onCreated }: Props) {
  // Grubun AKTİF kalemleri — iade irsaliyesindeki kalem kümesiyle birebir.
  const members = useQuery({
    queryKey: ["return-invoice-group", row?.documentSourceId],
    queryFn: () => returnsService.listGroupMembers(row!),
    enabled: Boolean(row),
    // ⚠️ App varsayılanı 5 dk BAYAT TOLERANSI. Aynı iade bu pencere içinde ikinci
    // kez açılırsa (arada bir kalem İPTAL edilmiş olabilir) fatura, defterde
    // artık olmayan bir satırla doğardı → her açılışta taze oku.
    staleTime: 0,
  });

  // Kalemler okunamazsa SESSİZ KALINMAZ. Bileşen yükleme boyunca `null` döndüğü
  // için hata da "tıkladım, hiçbir şey olmadı" olarak görünürdü; üstelik sayfa
  // tavanı hatası apiClient interceptor'ından geçmez (axios değil, bizim
  // `Error`'ımız) → tek yüzey bu toast.
  // ⚠️ `onClose` çağıran taraftan inline arrow olarak geliyor → her render'da
  // KİMLİĞİ değişir. Bağımlılığa koymak toast'ı her render'da tekrar bastırırdı;
  // ref ile sabitlenir ve effect yalnız hata DEĞİŞİNCE koşar.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const loadError = members.error;
  useEffect(() => {
    if (!loadError) return;
    toast.error(
      loadError instanceof Error
        ? loadError.message
        : "İadenin kalemleri okunamadı — fatura taslağı açılamıyor.",
    );
    closeRef.current();
  }, [loadError]);

  if (!row) return null;
  // Kalemler okunmadan diyalog AÇILMAZ: `prefill` yalnız ilk mount'ta okunur
  // (`useState` başlangıcı), sonradan gelen satırlar forma hiç düşmezdi.
  if (members.isLoading || !members.data) return null;

  const lines = buildReturnInvoiceLines(members.data);
  // Kalem çözülemediyse (beklenmedik veri) diyaloğu boş satırla açmak yerine
  // hiç açma — kullanıcı 1 satırlık boş taslakla baş başa kalmasın.
  if (lines.length === 0) return null;

  const rollCount = members.data.length;
  const prefill: InvoicePrefill = {
    type: "SALES_RETURN",
    // Kaynak bağı = belgenin kaynağı (`returnGroupId ?? id`), satırın kendi id'si
    // DEĞİL: tekil iadede ikisi aynıdır, grup iadesinde üye id'siyle yazmak aynı
    // gruba ikinci bir fatura açardı.
    returnGroupId: row.documentSourceId,
    customerId: row.customer?.id ?? null,
    lines,
    // Diyalog başlığının altında "Kaynak: …" rozeti — hangi iadeyi faturaladığı
    // top adediyle birlikte görünsün (grup iadesinde tek satırdan açılıyor).
    sourceLabel: `İade${row.fromShipment ? ` · ${row.fromShipment.shipmentNo}` : ""} · ${rollCount} top`,
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
