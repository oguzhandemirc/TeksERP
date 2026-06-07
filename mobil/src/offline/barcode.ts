// Client-side TEKS barkod üretici (offline KK1 girişi için).
// Backend'in generateBarcode() ile aynı format: TEKS-YYYYMMDD-XXXXXXXX
// (8 hex char). UUID benzeri rastgelelik — collision riski pratikte sıfır
// (günlük 4 milyar permutasyon).
//
// Mutate her çağrıda BİR KEZ üretilmeli (mutate variables'ına gömülerek
// persist edilsin); aynı barkodla 2. çağrı backend tarafında P2002 → cached
// Roll döner (idempotent retry).

export function generateClientBarcode(): string {
  const now = new Date();
  const datePart =
    now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0');
  const randomPart = Array.from({ length: 8 }, () =>
    Math.floor(Math.random() * 16).toString(16).toUpperCase(),
  ).join('');
  return `TEKS-${datePart}-${randomPart}`;
}

// Client-üretimi UUID v4 — offline kayıtların (örn. RollError/leke) backend id'si.
// Backend Zod `z.string().uuid()` ile doğrular; bu fonksiyon geçerli v4 üretir.
// Aynı id mutate variables'ına gömülür → resume/retry'da backend idempotent
// (aynı id ile 2. çağrı mevcut kaydı döner). uuid paketi kurulu değil; KK1
// barkodu gibi Math.random yeterli (collision pratikte sıfır).
export function generateClientUuid(): string {
  const hex = (n: number) =>
    Array.from({ length: n }, () =>
      Math.floor(Math.random() * 16).toString(16),
    ).join('');
  // 4xxx → versiyon 4; y ∈ {8,9,a,b} → variant.
  const variant = (8 + Math.floor(Math.random() * 4)).toString(16);
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${variant}${hex(3)}-${hex(12)}`;
}
