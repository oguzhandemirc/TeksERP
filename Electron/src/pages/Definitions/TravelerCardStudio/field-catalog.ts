// =============================================================================
// Uzman modu alan paleti — backend `config/traveler-card-fields.ts` AYNASI
// =============================================================================
// Electron bağımsız bir projedir ve backend'in TS kataloğunu import edemez
// (mobil `permissions.ts` ile aynı durum). Bu yüzden liste burada ELLE tutulur.
//
// ⚠️ Backend'e yeni alan eklerken buraya da ekle. Aksi halde alan çalışır ama
// palette görünmez — yani yalnız anahtarı ezbere bilen kullanabilir. Ters yön
// daha kötü: burada olup backend'de olmayan bir anahtar palette görünür,
// tıklanır ve BOŞ basar. Bekçi taraması yok; tek koruma bu not.
// =============================================================================

export interface PaletteField {
  key: string;
  label: string;
  sample: string;
}

export const FIELD_GROUPS: { title: string; fields: PaletteField[] }[] = [
  {
    title: "Kart",
    fields: [
      { key: "cardNumber", label: "Kart No", sample: "IE0308260007" },
      { key: "barcode", label: "Barkod metni", sample: "IE0308260007" },
      { key: "workOrderNumber", label: "İş Emri No", sample: "IE0308260007" },
      { key: "version", label: "Versiyon", sample: "1" },
      { key: "printedAt", label: "Basım tarihi", sample: "03.08.2026 09:12" },
      { key: "companyName", label: "Firma adı", sample: "Adnan Şahin Tekstil" },
      { key: "addressLine", label: "Firma adresi", sample: "OSB 5. Cad." },
      { key: "phone", label: "Telefon", sample: "0224 000 00 00" },
      { key: "footerNote", label: "Alt not", sample: "Bu kart mal ile hareket eder." },
      { key: "qrSvg", label: "Karekod görseli", sample: "<svg…>" },
    ],
  },
  {
    title: "Ürün",
    fields: [
      { key: "itemCode", label: "Kumaş kodu", sample: "KMS-001" },
      { key: "itemName", label: "Kumaş adı", sample: "Pamuklu Astar" },
      { key: "colorName", label: "Renk", sample: "Bej" },
      { key: "width", label: "En (cm)", sample: "150" },
      { key: "foldType", label: "Kat tipi", sample: "Top" },
      { key: "properties", label: "Özellikler", sample: "Su İticilik, Zımparalı" },
    ],
  },
  {
    title: "Plan",
    fields: [
      { key: "typeText", label: "Tür + rota", sample: "Siparişe Özel · Rota: Standart" },
      { key: "routeName", label: "Rota adı", sample: "Standart Boyama" },
      { key: "targetQuantity", label: "Hedef metraj", sample: "4.850" },
      { key: "targetWeight", label: "Hedef ağırlık", sample: "810" },
      { key: "startDate", label: "Başlangıç", sample: "03.08.2026" },
      { key: "endDate", label: "Bitiş", sample: "11.08.2026" },
    ],
  },
  {
    title: "Toplamlar",
    fields: [
      { key: "batchCount", label: "Parti sayısı", sample: "3" },
      { key: "batchRollTotal", label: "Toplam top", sample: "12" },
      { key: "batchQtyTotal", label: "Toplam metraj", sample: "2.565" },
      { key: "orderCount", label: "Sipariş sayısı", sample: "2" },
      { key: "orderQtyTotal", label: "Sipariş toplamı", sample: "1.240" },
    ],
  },
];

export const LOOP_GROUPS: { key: string; label: string; fields: PaletteField[] }[] = [
  {
    key: "steps",
    label: "Rota adımları",
    fields: [
      { key: "seq", label: "Sıra", sample: "1" },
      { key: "stationName", label: "İstasyon", sample: "Boyahane" },
      { key: "subcontractorName", label: "Fason firma", sample: "Yıldız Boyahane" },
      { key: "notes", label: "Adım talimatı", sample: "Yıkama yapma" },
    ],
  },
  {
    key: "batches",
    label: "Partiler",
    fields: [
      { key: "seq", label: "Sıra", sample: "1" },
      { key: "batchNumber", label: "Parti no", sample: "P0308260001" },
      { key: "rollCount", label: "Top adedi", sample: "4" },
      { key: "quantity", label: "Metraj", sample: "1.240" },
      { key: "dispatchNo", label: "İrsaliye no", sample: "FS0308260001" },
      { key: "subcontractorName", label: "Sevk firması", sample: "Yıldız Boyahane" },
    ],
  },
  {
    key: "orders",
    label: "Bağlı siparişler",
    fields: [
      { key: "seq", label: "Sıra", sample: "1" },
      { key: "orderNumber", label: "Sipariş no", sample: "SIP-2026-0110" },
      { key: "customerName", label: "Müşteri", sample: "Örnek Tekstil A.Ş." },
      { key: "itemName", label: "Ürün", sample: "Pamuklu Astar" },
      { key: "colorName", label: "Renk", sample: "Bej" },
      { key: "quantity", label: "Miktar", sample: "600" },
    ],
  },
];
