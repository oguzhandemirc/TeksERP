// =============================================================================
// Operatöre özgü renk — SAF, deterministik (userId hash → palet)
// =============================================================================
// Operatör bandı, paylaşımlı tablette "şu an KİM giriş yapmış" bilgisini tek
// bakışta ayırt edilebilir bir renkle vurgular. Kullanıcı başına atanmış renk
// YOK; userId'den deterministik hash ile sabit bir palet rengi seçilir → aynı
// kullanıcı her zaman aynı rengi alır (cihazdan bağımsız).
//
// Palet: doygun, birbirinden uzak, koyu-zemin/beyaz-metin ile yüksek kontrastlı
// tonlar (fabrika ortamı, uzaktan/eldivenle okunur).
// =============================================================================

/** Operatör bandı vurgu paleti — birbirinden görsel olarak uzak 12 ton. */
export const OPERATOR_PALETTE = [
  '#2563eb', // blue-600
  '#059669', // emerald-600
  '#d97706', // amber-600
  '#7c3aed', // violet-600
  '#dc2626', // red-600
  '#0891b2', // cyan-600
  '#db2777', // pink-600
  '#65a30d', // lime-600
  '#c026d3', // fuchsia-600
  '#ea580c', // orange-600
  '#4f46e5', // indigo-600
  '#0d9488', // teal-600
] as const;

/** Kimlik yokken (yükleniyor/çıkış) nötr gri — palet rengi sızdırmaz. */
export const OPERATOR_NEUTRAL = '#475569'; // slate-600

/** djb2-xor string hash → unsigned 32-bit. Kriptografik değil, sadece dağıtım. */
function hashString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0;
  }
  return h >>> 0;
}

/**
 * userId → sabit palet rengi (deterministik). Boş/kimliksiz → nötr gri.
 */
export function operatorColor(userId: string | null | undefined): string {
  if (!userId) return OPERATOR_NEUTRAL;
  const idx = hashString(userId) % OPERATOR_PALETTE.length;
  return OPERATOR_PALETTE[idx];
}

/**
 * İsim baş harfleri (avatar). "Ali Veli" → "AV", "Ali" → "AL", boş → "?".
 */
export function operatorInitials(name: string | null | undefined): string {
  const n = (name ?? '').trim();
  if (!n) return '?';
  const parts = n.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
