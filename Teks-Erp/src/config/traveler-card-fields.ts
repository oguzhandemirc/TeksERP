// =============================================================================
// Refakat Kartı — UZMAN MODU alan kataloğu (tek kaynak)
// =============================================================================
// `TravelerCardTemplate.mode = RAW_HTML` iken admin kartın TÜM HTML'ini kendisi
// yazar; veriyi bu katalogdaki anahtarlarla çağırır. Katalog üç yeri birden
// besler: (1) motorun ne çözebildiği, (2) stüdyodaki alan paleti, (3) kayıt
// anındaki "bilinmeyen alan" uyarısı.
//
// TASARIM: bilinmeyen anahtar HATA DEĞİL, boş string (etiket `label-rawcode`
// emsali). Sebep saha: kart üretimi durursa vardiya durur — bir yazım hatası
// yüzünden baskıyı 400'e düşürmek, o alanı boş basmaktan çok daha pahalı.
// Stüdyo kayıt anında UYARIR (kırmızı değil sarı), böylece hata sessiz kalmaz.
//
// Yeni alan eklerken: buraya bir satır + `traveler-card-raw.ts` içindeki
// `buildRawContext` tarafına değer üretimi. İkisi ayrı kalırsa katalogda görünen
// ama hiç dolmayan bir alan doğar (paletten seçilir, boş basar).
// =============================================================================

export type TravelerFieldGroup = "kart" | "urun" | "plan" | "rota" | "liste";

export interface TravelerFieldDef {
  /** Şablonda {{key}} olarak yazılır. */
  key: string;
  /** Stüdyo paletinde görünen ad. */
  label: string;
  /** Palet gruplaması. */
  group: TravelerFieldGroup;
  /** Örnek değer — palette ipucu + önizleme. */
  sample: string;
  /** HTML olarak HAM gömülür (kaçırılmaz). Yalnız sunucu-üretimi güvenilir SVG. */
  raw?: boolean;
}

/** Tekil (skaler) alanlar — {{key}} ile çağrılır. */
export const TRAVELER_FIELDS: TravelerFieldDef[] = [
  // ── kart kimliği ────────────────────────────────────────────────────────
  { key: "cardNumber", label: "Kart No", group: "kart", sample: "IE0308260007" },
  { key: "barcode", label: "Barkod / karekod metni", group: "kart", sample: "IE0308260007" },
  { key: "workOrderNumber", label: "İş Emri No", group: "kart", sample: "IE0308260007" },
  { key: "version", label: "Versiyon", group: "kart", sample: "1" },
  { key: "printedAt", label: "Basım tarihi", group: "kart", sample: "03.08.2026 09:12" },
  { key: "companyName", label: "Firma adı", group: "kart", sample: "Adnan Şahin Tekstil" },
  { key: "addressLine", label: "Firma adresi", group: "kart", sample: "OSB 5. Cad. No:12 Bursa" },
  { key: "phone", label: "Firma telefonu", group: "kart", sample: "0224 000 00 00" },
  { key: "footerNote", label: "Alt not (ayardan)", group: "kart", sample: "Bu kart mal ile hareket eder." },
  { key: "qrSvg", label: "Karekod görseli (SVG)", group: "kart", sample: "<svg…>", raw: true },

  // ── ürün ────────────────────────────────────────────────────────────────
  { key: "itemCode", label: "Kumaş kodu", group: "urun", sample: "KMS-001" },
  { key: "itemName", label: "Kumaş adı", group: "urun", sample: "Pamuklu Astar" },
  { key: "colorName", label: "Renk", group: "urun", sample: "Bej" },
  { key: "width", label: "En (cm)", group: "urun", sample: "150" },
  { key: "foldType", label: "Kat tipi", group: "urun", sample: "Top" },
  { key: "properties", label: "Özellikler (virgüllü)", group: "urun", sample: "Su İticilik, Zımparalı" },

  // ── plan ────────────────────────────────────────────────────────────────
  { key: "typeText", label: "Tür + rota", group: "plan", sample: "Siparişe Özel · Rota: Standart" },
  { key: "routeName", label: "Rota adı", group: "plan", sample: "Standart Boyama Rotası" },
  { key: "targetQuantity", label: "Hedef metraj", group: "plan", sample: "4.850" },
  { key: "targetWeight", label: "Hedef ağırlık", group: "plan", sample: "810" },
  { key: "startDate", label: "Planlanan başlangıç", group: "plan", sample: "03.08.2026" },
  { key: "endDate", label: "Planlanan bitiş", group: "plan", sample: "11.08.2026" },

  // ── toplamlar ───────────────────────────────────────────────────────────
  { key: "batchCount", label: "Parti sayısı", group: "liste", sample: "3" },
  { key: "batchRollTotal", label: "Toplam top adedi", group: "liste", sample: "12" },
  { key: "batchQtyTotal", label: "Partilerin toplam metrajı", group: "liste", sample: "2.565" },
  { key: "orderCount", label: "Bağlı sipariş sayısı", group: "liste", sample: "2" },
  { key: "orderQtyTotal", label: "Siparişlerin toplam miktarı", group: "liste", sample: "1.240" },
];

/**
 * Tekrar (döngü) blokları — {{#anahtar}} … {{/anahtar}} arası HER SATIR için
 * bir kez basılır; blok İÇİNDE o satırın alanları {{alan}} ile çağrılır.
 * Boş listede blok hiç basılmaz (koşul + döngü aynı yapı).
 */
export interface TravelerLoopDef {
  key: string;
  label: string;
  /** Blok içinde kullanılabilen alanlar. */
  fields: TravelerFieldDef[];
}

export const TRAVELER_LOOPS: TravelerLoopDef[] = [
  {
    key: "steps",
    label: "Rota adımları",
    fields: [
      { key: "seq", label: "Sıra", group: "rota", sample: "1" },
      { key: "stationName", label: "İstasyon", group: "rota", sample: "Boyahane" },
      { key: "subcontractorName", label: "Planlanan fason firma", group: "rota", sample: "Yıldız Boyahane" },
      { key: "notes", label: "Adım talimatı", group: "rota", sample: "Yıkama yapma" },
    ],
  },
  {
    key: "batches",
    label: "Partiler",
    fields: [
      { key: "seq", label: "Sıra", group: "liste", sample: "1" },
      { key: "batchNumber", label: "Parti no", group: "liste", sample: "P0308260001" },
      { key: "rollCount", label: "Top adedi", group: "liste", sample: "4" },
      { key: "quantity", label: "Metraj", group: "liste", sample: "1.240" },
      { key: "dispatchNo", label: "Sevk irsaliye no", group: "liste", sample: "FS0308260001" },
      { key: "subcontractorName", label: "Sevk edilen firma", group: "liste", sample: "Yıldız Boyahane" },
    ],
  },
  {
    key: "orders",
    label: "Bağlı siparişler",
    fields: [
      { key: "seq", label: "Sıra", group: "liste", sample: "1" },
      { key: "orderNumber", label: "Sipariş no", group: "liste", sample: "SIP-2026-0110" },
      { key: "customerName", label: "Müşteri", group: "liste", sample: "Örnek Tekstil A.Ş." },
      { key: "itemName", label: "Ürün", group: "liste", sample: "Pamuklu Astar" },
      { key: "colorName", label: "Renk", group: "liste", sample: "Bej" },
      { key: "quantity", label: "Miktar", group: "liste", sample: "600" },
    ],
  },
];

export const TRAVELER_FIELD_KEYS = new Set(TRAVELER_FIELDS.map((f) => f.key));
export const TRAVELER_LOOP_KEYS = new Set(TRAVELER_LOOPS.map((l) => l.key));
/** Ham (kaçırılmadan) gömülen anahtarlar — yalnız sunucu-üretimi SVG. */
export const TRAVELER_RAW_KEYS = new Set(TRAVELER_FIELDS.filter((f) => f.raw).map((f) => f.key));
