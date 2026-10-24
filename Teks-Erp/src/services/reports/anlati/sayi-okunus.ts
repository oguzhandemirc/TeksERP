// =============================================================================
// Sayı okunuşu — Türkçe ek, rakamın YAZILIŞINA değil OKUNUŞUNA uyar ("3'te" = üç-te)
// =============================================================================
// Ek motoru yalnız son okunan sözcüğe bakar: 40 → kırk → "40'ta", 1.000 → bin → "1.000'de",
// 12,5 → "on iki virgül beş" → "12,5'te". Okunuş biçimli METİNDEN çıkarılır ki ek, ekranda
// görünen sayıyla (yuvarlanmış hâliyle) uyuşsun.

const BIRLER = ["", "bir", "iki", "üç", "dört", "beş", "altı", "yedi", "sekiz", "dokuz"] as const;
const ONLAR = ["", "on", "yirmi", "otuz", "kırk", "elli", "altmış", "yetmiş", "seksen", "doksan"] as const;
const BUYUKLER = ["", "bin", "milyon", "milyar"] as const;
const MAX_READABLE = 1e12;

function ucHane(n: number): string[] {
  const yuz = Math.floor(n / 100);
  const on = Math.floor((n % 100) / 10);
  const bir = n % 10;
  const s: string[] = [];
  if (yuz > 0) {
    if (yuz > 1) s.push(BIRLER[yuz]);
    s.push("yüz");
  }
  if (on > 0) s.push(ONLAR[on]);
  if (bir > 0) s.push(BIRLER[bir]);
  return s;
}

/** Tam sayının sözcükleri ("bin iki yüz otuz dört"); 0 → "sıfır"; tam sayı değilse ya da ≥ 10^12 ise `null`. */
export function tamSayiOkunus(n: number): string | null {
  if (!Number.isInteger(n) || Math.abs(n) >= MAX_READABLE) return null;
  if (n === 0) return "sıfır";
  if (n < 0) return `eksi ${tamSayiOkunus(-n)}`;
  const gruplar: number[] = [];
  for (let k = n; k > 0; k = Math.floor(k / 1000)) gruplar.push(k % 1000);
  const s: string[] = [];
  for (let i = gruplar.length - 1; i >= 0; i--) {
    const g = gruplar[i];
    if (g === 0) continue;
    // "bir bin" denmez: 1.000 → "bin", 1.000.000 → "bir milyon".
    if (!(i === 1 && g === 1)) s.push(...ucHane(g));
    if (BUYUKLER[i]) s.push(BUYUKLER[i]);
  }
  return s.join(" ");
}

const SAYI_METNI = /^-?%?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?$/;

/**
 * Biçimli sayı metninin ("42.300", "12,5", "%12", "-3") son okunan sözcüğü.
 * Ondalıkta ondalık kısmın okunuşu sayılır ("12,05" → "on iki virgül sıfır beş" → beş).
 * Sayı olarak çözülemeyen metin `null`.
 */
export function sonOkunanSozcuk(metin: string): string | null {
  const m = SAYI_METNI.exec(metin.trim());
  if (!m) return null;
  const kesir = m[2];
  const parca = kesir !== undefined ? kesir.replace(/^0+/, "") || "0" : m[1].replace(/\./g, "");
  if (parca.length > 12) return null;
  const okunus = tamSayiOkunus(Number(parca));
  if (!okunus) return null;
  const sozcukler = okunus.split(" ");
  return sozcukler[sozcukler.length - 1];
}
