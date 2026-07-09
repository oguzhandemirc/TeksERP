// =============================================================================
// Saha donanım eşleme — taranan BT cihaz adı ↔ cihaz kaydı (PeripheralDevice)
// benzerliği. HC-06'lar isimlendirilmişse (AT+NAME=TAMBUR-METRE-2KAT) yüksek
// skor → "önerilen" olarak üstte çıkar; hepsi jenerik "HC-06" ise skor 0 →
// operatör elle seçer (isim kimlik taşımaz). Saf/native-bağımsız — birim test edilir.
// =============================================================================

export interface MatchablePeripheral {
  name: string;
  code: string;
  role?: string | null;
  kind: string;
}

/**
 * Eşleştirme için kanonikleştir: TR büyük harf + Türkçe harfleri ASCII'ye katla
 * (İ/I/ı/i→I, Ş→S, Ğ→G, Ü→U, Ö→O, Ç→C). Kritik: TR upper 'i'→'İ' ama saklanan
 * kodlar ASCII 'I' taşır (örn. "TARTI") — katlama olmadan "tarti" hiç eşleşmezdi.
 * Bu SADECE eşleştirme anahtarıdır (görüntüleme değil), agresif katlama uygun.
 */
function canon(s: string): string {
  return (s || '')
    .toLocaleUpperCase('tr-TR')
    .replace(/İ/g, 'I')
    .replace(/Ş/g, 'S')
    .replace(/Ğ/g, 'G')
    .replace(/Ü/g, 'U')
    .replace(/Ö/g, 'O')
    .replace(/Ç/g, 'C');
}

/** Alfanümerik-dışını at — birleşik karşılaştırma anahtarı ("Tambur-2 Kat" → "TAMBUR2KAT"). */
function norm(s: string): string {
  return canon(s).replace(/[^0-9A-Z]/g, '');
}

/** ≥2 karakter alfanümerik token'lar. */
function tokens(s: string): string[] {
  return canon(s)
    .split(/[^0-9A-Z]+/)
    .filter((t) => t.length >= 2);
}

const KIND_WORDS: Record<string, string[]> = {
  METER: ['METRE', 'METER', 'METRAJ'],
  SCALE: ['KANTAR', 'SCALE', 'TARTI'],
  LABEL_PRINTER: ['YAZICI', 'PRINT', 'PRINTER', 'ARGOX', 'BIXOLON'],
};

/** Jenerik modül adı (kimlik taşımaz) — "HC06", "HC-06", "HC05", boş, "BT", "SPP". */
function isGeneric(nameNorm: string): boolean {
  return nameNorm === '' || nameNorm === 'BT' || nameNorm === 'SPP' || /^HC0?[56]$/.test(nameNorm);
}

/**
 * 0..1 — taranan cihaz adının bir kayda ne kadar uyduğu. role tam eşleşmesi (+0.5),
 * kod eşleşmesi (+0.6), ad token örtüşmesi (≤+0.4), tür anahtar kelimesi (+0.2);
 * jenerik/HC-06 adları 0. Skor 1'de doyurulur.
 */
export function matchScore(scannedName: string, p: MatchablePeripheral): number {
  const scanned = norm(scannedName);
  if (isGeneric(scanned)) return 0;

  let score = 0;
  const roleN = norm(p.role ?? '');
  if (roleN && scanned.includes(roleN)) score += 0.5;

  // Kod eşleşmesi: taranan ad tam kodu içeriyor → güçlü. Ters yön (kod, taranan
  // adı içeriyor) yalnız taranan ad kodun anlamlı bir oranıysa sayılır — yoksa
  // kısa bir ad ("TAM") uzun kodun alt-dizisi olup yanlış-pozitif +0.6 verirdi.
  const codeN = norm(p.code);
  if (codeN.length >= 3 && scanned.length >= 3) {
    if (scanned.includes(codeN)) score += 0.6;
    else if (codeN.includes(scanned) && scanned.length >= codeN.length / 2) score += 0.6;
  }

  const nameToks = tokens(p.name);
  if (nameToks.length) {
    const hit = nameToks.filter((t) => scanned.includes(t)).length;
    score += 0.4 * (hit / nameToks.length);
  }

  const kw = KIND_WORDS[p.kind] ?? [];
  if (kw.some((w) => scanned.includes(w))) score += 0.2;

  return Math.min(1, score);
}

/** ≥ bu skor → güçlü eşleşme (otomatik "önerilen" vurgusu). */
export const MATCH_STRONG = 0.5;

export interface ScoredDevice<T> {
  device: T;
  score: number;
}

/** Cihaz listesini kayda göre skorlayıp azalan sırala (en olası üstte). Stabil sıra. */
export function sortByMatch<T extends { name: string }>(
  devices: T[],
  p: MatchablePeripheral,
): ScoredDevice<T>[] {
  return devices
    .map((device, i) => ({ device, score: matchScore(device.name, p), i }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map(({ device, score }) => ({ device, score }));
}
