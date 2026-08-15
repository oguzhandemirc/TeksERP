// =============================================================================
// "Faturala (iç)" düğmesi görünür mü — SAF YÜKLEM
// =============================================================================
// Bekçi: `invoiceDraftVisibility.test.ts`. Kural bileşenin içine dağılmış bir
// `&&` zinciri olarak kalsaydı (sayfa bir koşulu, kolon diğerini taşıyordu)
// birini tersine çevirmek hiçbir testi kırmazdı.
// =============================================================================

/**
 * ÜÇ koşul, üçü de gerekli:
 *  ① **TİCARET REJİMİ** (`finance.enabled`) — fabrikada ön muhasebe yoktur;
 *     düğme orada iç fatura üretecek bir modüle yol gösterirdi.
 *  ② **HENÜZ FATURALANMAMIŞ** — backend "bir sevkiyat → tek aktif fatura"
 *     kuralını partial unique ile uyguluyor. Düğmeyi gri çizmek yerine HİÇ
 *     çizmemek tercih edilir: devre dışı buton, var olmayan bir yolu vaat eder.
 *
 * ③ **ÇUVAL SEVKİYATI** (`kind !== "DIRECT"`) — fasondan DOĞRUDAN sevk ayrı bir
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
export function canDraftInvoice(
  row: { invoiceNo?: string | null; kind?: "SHIPMENT" | "DIRECT" },
  financeEnabled: boolean,
): boolean {
  return financeEnabled && !row.invoiceNo && row.kind !== "DIRECT";
}
