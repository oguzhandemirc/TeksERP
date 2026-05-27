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
