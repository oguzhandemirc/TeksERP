// =============================================================================
// "Faturala (iç)" düğmesi görünür mü — SAF YÜKLEM
// =============================================================================
// Bekçi: `invoiceDraftVisibility.test.ts`. Kural bileşenin içine dağılmış bir
// `&&` zinciri olarak kalsaydı (sayfa bir koşulu, kolon diğerini taşıyordu)
// birini tersine çevirmek hiçbir testi kırmazdı.
// =============================================================================

export interface InternalInvoiceLink {
  id: string;
  docNo: string;
  status: "DRAFT" | "CONFIRMED" | "CANCELLED";
}

interface DispatchRowLike {
  /** DIŞ muhasebe programındaki belgenin izi. */
  invoiceNo?: string | null;
  kind?: "SHIPMENT" | "DIRECT";
  /** İÇ faturalar — backend iptal edilmişleri zaten süzer. */
  invoices?: InternalInvoiceLink[];
}

/**
 * Bu sevkiyatın İÇ faturası (varsa) — "bir kaynak → tek aktif fatura" kuralı
 * gereği en fazla biri olabilir; yine de listenin İLKİ alınır (savunma).
 *
 * ⚠️ İPTAL EDİLMİŞ FATURA HESABA KATILMAZ ve süzgeç İKİ KATMANDA da vardır:
 * backend `status <> CANCELLED` ile gönderir, burada tekrar süzülür. Ayrışırsa
 * panel "faturası var" der, uç yeni faturayı kabul eder (ya da tersi).
 */
export function internalInvoiceOf(row: DispatchRowLike): InternalInvoiceLink | null {
  return (row.invoices ?? []).find((i) => i.status !== "CANCELLED") ?? null;
}

/**
 * ÜÇ koşul, üçü de gerekli:
 *  ① **TİCARET REJİMİ** (`finance.enabled`) — fabrikada ön muhasebe yoktur;
 *     düğme orada iç fatura üretecek bir modüle yol gösterirdi.
 *  ② **HENÜZ İÇ FATURASI YOK** — backend "bir sevkiyat → tek aktif fatura"
 *     kuralını partial unique ile uyguluyor. Düğmeyi gri çizmek yerine HİÇ
 *     çizmemek tercih edilir: devre dışı buton, var olmayan bir yolu vaat eder.
 *
 *     ⚠️ ÖLÇÜT `invoices` BAĞIDIR, `invoiceNo` DEĞİL (2026-08-15 düzeltmesi).
 *     `invoiceNo` DIŞ muhasebe programındaki belgenin izidir ve yalnız
 *     `confirm` sırasında ya da elle "İşaretle" ile damgalanır. Yükleminin ona
 *     bakması İKİ YÖNLÜ yanlıştı: (a) iç TASLAK varken düğme çıkıyor, kullanıcı
 *     bütün formu dolduruyor ve kaydederken *"Bu sevkiyat için zaten bir fatura
 *     var"* 409'unu yiyordu (emek çöpe); (b) yalnız dış numarası işaretlenmiş
 *     sevkiyatta iç faturalama yolu HİÇ görünmüyordu. Yorum ile davranış
 *     birbirini yalanlıyordu.
 *
 *  ③ **ÇUVAL SEVKİYATI** (`kind !== "DIRECT"`) — fasondan DOĞRUDAN sevk ayrı bir
 *     tablodur (`DirectShipment`) ve `Invoice.shipmentId` FK'sı `Shipment`e
 *     bakar. Düğme orada da çiziliyordu: kullanıcı diyaloğu açıyor, fiyatları
 *     giriyor ve KAYDET'te bir FK hatası alıyordu — yani sonu olmayan bir yol
 *     vaat ediliyordu. Satır kurucusu (`invoice-draft-lines` ucu) da yalnız
 *     `Shipment` tanır. Doğrudan sevkin faturalanması ayrı bir iştir (backend'de
 *     `directShipmentId` alanı hazır, satır kurucusu YOK); çözümü buraya bir
 *     `if` yazmak değil, o kurucuyu yazmaktır.
 *
 * ⚠️ Bu izin kontrolü DEĞİL. İzin ayrı bir katman (`finance:write`,
 * `PermissionGate`) ve bilinçli olarak listedeki "İşaretle" düğmesinin
 * izninden (`shipping:invoice`) FARKLIDIR: biri dış belgenin numarasını iz
 * olarak düşer, diğeri bu sistemde deftere işleyecek bir taslak doğurur.
 */
export function canDraftInvoice(row: DispatchRowLike, financeEnabled: boolean): boolean {
  return financeEnabled && row.kind !== "DIRECT" && internalInvoiceOf(row) === null;
}

/**
 * İç faturası olan satırda basılacak bağ metni — `null` ise bağ çizilmez.
 *
 * TASLAK ile ONAYLI ayrı kelimelerle söylenir: "Taslağı aç" bir İŞ vaat eder
 * (fiyatı gir, onayla), "Faturayı aç" ise bir KAYIT gösterir. Aynı metni
 * kullanmak, onay bekleyen taslakları görünmez kılardı.
 */
export function invoiceLinkLabel(row: DispatchRowLike, financeEnabled: boolean): string | null {
  if (!financeEnabled) return null;
  const inv = internalInvoiceOf(row);
  if (!inv) return null;
  return inv.status === "DRAFT" ? "Taslağı aç" : "Faturayı aç";
}
