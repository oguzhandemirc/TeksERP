// =============================================================================
// Sunum zarfı yardımcıları — ana sayı, kıyas yönü, dönem etiketi (saf; DB'siz)
// =============================================================================
// Ölçülemeyen değer `null` kalır: 0'a çökertilseydi "ölçemedim" ile "hiç yoktu" aynı kartı
// basardı ve kıyas sahte bir %100 düşüş gösterirdi. Gün sınırı FABRİKA günüdür (`factoryYmd`).

import { factoryYmd } from "../../../constants/time";
import type { DateRange } from "../_shared";
import type { SuffixInput } from "../anlati/ek";
import type { AnaSayi, AnaSayiKiyas, Birim, IyiYon, ComparisonTone, KiyasYonu } from "./sunum.types";

export const AY_ADLARI = [
  "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
] as const;
/** Cümle içi (cins ad) yazım; büyük/küçük dönüşümü yerine tablo — yerel ayara bağımlı değil. */
export const AY_ADLARI_KUCUK = [
  "ocak", "şubat", "mart", "nisan", "mayıs", "haziran",
  "temmuz", "ağustos", "eylül", "ekim", "kasım", "aralık",
] as const;

/** Eşik altı göreli değişim "değişmedi" sayılır (plan §3.5: ±%2). */
export const VARSAYILAN_ESIK_YUZDE = 2;

const yuvarla = (n: number, hane: number): number => {
  const k = 10 ** hane;
  return Math.round(n * k) / k;
};

function verdictOf(yon: KiyasYonu | null, iyiYon: IyiYon): ComparisonTone {
  if (yon === null || yon === "degismedi" || iyiYon === "notr") return "notr";
  const yukariIyi = iyiYon === "yukari";
  return (yon === "artti") === yukariIyi ? "iyi" : "kotu";
}

/**
 * Şimdiki değeri öncekiyle kıyaslar. Bölen 0 → `yuzde:null` (yön farkın işaretinden);
 * `|yuzde| < esikYuzde` → "degismedi"; iki taraftan biri `null` → fark/yüzde/yön `null`.
 */
export function kiyasHesapla(
  simdi: number | null,
  once: number | null,
  secenek: { iyiYon: IyiYon; esikYuzde?: number },
): AnaSayiKiyas {
  const esik = secenek.esikYuzde ?? VARSAYILAN_ESIK_YUZDE;
  if (simdi === null || once === null) {
    return { deger: once, fark: null, yuzde: null, yon: null, durum: "notr" };
  }
  const fark = simdi - once;
  const yuzdeHam = once !== 0 ? (fark / Math.abs(once)) * 100 : null;
  let yon: KiyasYonu;
  if (yuzdeHam !== null) yon = Math.abs(yuzdeHam) < esik ? "degismedi" : fark > 0 ? "artti" : "azaldi";
  else yon = fark === 0 ? "degismedi" : fark > 0 ? "artti" : "azaldi";
  return {
    deger: once,
    fark: yuvarla(fark, 4),
    yuzde: yuzdeHam === null ? null : yuvarla(yuzdeHam, 1),
    yon,
    durum: verdictOf(yon, secenek.iyiYon),
  };
}

/** Ana sayı kartı. `onceki` verilmezse kıyas YOK; `null` verilirse kıyas "ölçülemedi" taşır. */
export function anaSayiKur(g: {
  olcu: string;
  ad: string;
  deger: number | null;
  birim: Birim;
  olculemedi?: string;
  onceki?: number | null;
  iyiYon: IyiYon;
  esikYuzde?: number;
}): AnaSayi {
  const a: AnaSayi = { olcu: g.olcu, ad: g.ad, deger: g.deger, birim: g.birim };
  if (g.deger === null) a.olculemedi = g.olculemedi ?? "Bu dönem için hesaplanamadı";
  if (g.onceki !== undefined) a.kiyas = kiyasHesapla(g.deger, g.onceki, { iyiYon: g.iyiYon, esikYuzde: g.esikYuzde });
  return a;
}

interface Gun { y: number; m: number; d: number }

function gunOf(at: Date): Gun {
  const [y, m, d] = factoryYmd(at).split("-").map(Number);
  return { y, m, d };
}

const ayinSonGunu = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();
const tamAyMi = (a: Gun, b: Gun): boolean => a.y === b.y && a.m === b.m && a.d === 1 && b.d === ayinSonGunu(b.y, b.m);

/** "Ekim 2026" (tam ay) · "2026" (tam yıl) · "1–24 Ekim 2026" · "28 Eylül – 24 Ekim 2026" · fabrika günüyle. */
export function donemEtiketi(range: DateRange): string {
  const a = gunOf(range.from);
  const b = gunOf(range.to);
  if (a.y === b.y && a.m === 1 && a.d === 1 && b.m === 12 && b.d === 31) return String(a.y);
  if (tamAyMi(a, b)) return `${AY_ADLARI[a.m - 1]} ${a.y}`;
  if (a.y === b.y && a.m === b.m) {
    return a.d === b.d ? `${a.d} ${AY_ADLARI[a.m - 1]} ${a.y}` : `${a.d}–${b.d} ${AY_ADLARI[a.m - 1]} ${a.y}`;
  }
  if (a.y === b.y) return `${a.d} ${AY_ADLARI[a.m - 1]} – ${b.d} ${AY_ADLARI[b.m - 1]} ${b.y}`;
  return `${a.d} ${AY_ADLARI[a.m - 1]} ${a.y} – ${b.d} ${AY_ADLARI[b.m - 1]} ${b.y}`;
}

/**
 * Cümlede dönemin ve kıyas döneminin adı: "Ekim'de … eylüle göre". Adlandırılamayan dönem
 * `null` → anlatı "Bu dönemde" / "önceki döneme göre" yedeğine düşer.
 */
export function donemSozleri(
  donem: DateRange,
  kiyas?: DateRange | null,
): { donem: SuffixInput | null; kiyas: SuffixInput | null } {
  const a = gunOf(donem.from);
  const b = gunOf(donem.to);
  let d: SuffixInput | null = null;
  if (a.y === b.y && a.m === b.m) {
    const ay = AY_ADLARI[a.m - 1];
    const metin = tamAyMi(a, b) ? ay : a.d === b.d ? `${a.d} ${ay}` : `${a.d}–${b.d} ${ay}`;
    d = { tur: "ad", metin, kesme: true };
  }
  let k: SuffixInput | null = null;
  if (kiyas) {
    const ka = gunOf(kiyas.from);
    const kb = gunOf(kiyas.to);
    // Ay adı yalnız yıl karışmıyorsa: aynı yıl ya da hemen önceki ay (Aralık → Ocak).
    const bitisik = (ka.y === a.y) || (ka.m === 12 && a.m === 1 && ka.y === a.y - 1);
    if (tamAyMi(ka, kb) && bitisik) k = { tur: "ad", metin: AY_ADLARI_KUCUK[ka.m - 1], kesme: false, yumusamaz: true };
  }
  return { donem: d, kiyas: k };
}
