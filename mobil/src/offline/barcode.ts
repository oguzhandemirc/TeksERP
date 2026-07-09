// Client-üretimi idempotency anahtarı (UUID v4) — offline/ağ-retry'de mükerrer
// kayıt (KK1 top, Tambur kesim, RollError vb.) önler. Backend `z.string().uuid()`
// ile doğrular. Aynı token mutate variables'ına gömülür → resume/retry'da backend
// idempotent (aynı token ile 2. çağrı mevcut kaydı döner).
//
// NOT: Top barkodu artık SUNUCU'da sıralı atanır (TEKS+YYMMDD+H/F+A001..) — offline
// istemci sırayı üretemez; bu yüzden eski client-üretimi TEKS barkod kaldırıldı.
// uuid paketi kurulu değil; Math.random yeterli (collision pratikte sıfır).

export function generateClientUuid(): string {
  const hex = (n: number) =>
    Array.from({ length: n }, () =>
      Math.floor(Math.random() * 16).toString(16),
    ).join('');
  // 4xxx → versiyon 4; y ∈ {8,9,a,b} → variant.
  const variant = (8 + Math.floor(Math.random() * 4)).toString(16);
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${variant}${hex(3)}-${hex(12)}`;
}
