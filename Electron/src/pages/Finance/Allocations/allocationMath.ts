// =============================================================================
// KAPAMA EKRANININ SAYI ARİTMETİĞİ — tamamı KURUŞ (tam sayı) üzerinden
// =============================================================================
// ⚠️ BURADAKİ HESAP BİR ÖNİZLEMEDİR, OTORİTE DEĞİLDİR. Gerçek tutar backend'de
// `Prisma.Decimal` ile hesaplanır; aşımı ham atomik UPDATE'in WHERE koşulu ve DB
// CHECK seddi engeller (409). Buradaki tek iş, kullanıcıyı kesin reddedilecek
// bir dağıtımı göndermekten korumak ve rakamı yazarken göstermek.
//
// ⚠️ FLOAT İLE TOPLAMA YASAK. `0.1 + 0.2 = 0.30000000000000004` ve bu sapma tam
// da "1 kuruş yüzünden beklenmedik 409" olarak geri döner: ekran "tam sığdı"
// derken uç reddeder ve kullanıcı sebebini göremez. Bu yüzden her tutar önce
// kuruşa (tam sayı) çevrilir, toplama tam sayıda yapılır, bölme YALNIZ gösterim
// anında olur.
//
// ⚠️ Girdi tipi `string | number` — bilinçli. `/allocations/*` uçları tutarları
// string, `/cheques` number döndürüyor (bkz. `service.ts` başlığı). Tek okuma
// noktası olması, iki şeklin karışıp sessiz `NaN` üretmesini engeller.

/** Ham değeri sayıya çevirir; okunamayan/boş değer 0'dır (NaN yayılmaz). */
export function num(v: string | number | null | undefined): number {
  if (v == null || v === "") return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Tutar → kuruş (tam sayı).
 *
 * `Math.round` zorunlu: `1.15 * 100 = 114.99999999999999` ve `Math.trunc` bunu
 * 114 kuruşa yuvarlardı — yani her gösterimde bir kuruş buharlaşırdı.
 */
export function toKurus(v: string | number | null | undefined): number {
  return Math.round(num(v) * 100);
}

/** Kuruş → tutar. YALNIZ gösterim/`money()` için; ara hesapta kullanma. */
export function fromKurus(k: number): number {
  return k / 100;
}

/**
 * Kuruş → `<input type="number">` ve uç gövdesi için metin ("1234.56").
 *
 * Ondalık ayırıcı NOKTA olmak zorunda: hem HTML sayı girdisinin hem backend
 * `Decimal` parse'ının beklediği budur. `toLocaleString("tr-TR")` burada
 * kullanılırsa "1.234,56" üretir ve uç onu 1,23 olarak okur.
 */
export function kurusToInput(k: number): string {
  return (k / 100).toFixed(2);
}

/** Vadesi bugünden önce mi — "geciken" işaretinin tek kaynağı. */
export function isOverdue(isoDate: string | null | undefined): boolean {
  if (!isoDate) return false;
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return false;
  // Gün sınırı CİHAZIN YEREL günüdür (panelin her yerinde aynı sözleşme):
  // saat karşılaştırması yapılsaydı bugün vadesi dolan fatura sabah "gecikmiş"
  // görünmezken öğleden sonra görünürdü.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d.getTime() < today.getTime();
}
