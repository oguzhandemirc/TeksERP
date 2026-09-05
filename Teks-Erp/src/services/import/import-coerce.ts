// =============================================================================
// HÜCRE DÖNÜŞTÜRME — metin → tip'li değer (Türkçe yerelleştirme dahil)
// =============================================================================
// Tek kural, üç durum (D3 — "üçlü sözleşme", `foldType` dersinin ikizi):
//   • hücre YOK / boş        → alan payload'a HİÇ girmez ("dokunma")
//   • hücre `NULL`           → alan `null` yazılır ("temizle")
//   • hücre dolu             → dönüştürülüp yazılır
// Boş hücreyi "temizle" saymak, kısmi bir dosya yükleyen kullanıcının farkında
// olmadan veri SİLMESİ demekti; "temizle" niyeti açıkça yazılmalı.

import { AppError } from "../../utils/app-error";
import { FACTORY_TIMEZONE } from "../../constants/time";

/** "Temizle" niyetinin açık yazımı. Şablonun Açıklama sayfasında anlatılır. */
const NULL_LITERAL = "NULL";

export const isClearLiteral = (raw: string): boolean =>
  raw.trim().toLocaleUpperCase("en-US") === NULL_LITERAL;

/**
 * TR/EN karışık sayı metnini çözer. Fabrikadaki dosyalar iki yerelden de gelir
 * (bizim CSV'miz TR yazar, bir müşterinin dosyası EN olabilir) — biçimi dayatmak
 * yerine TESPİT et; belirsiz kalan tek durumu (tek ayraç, üç haneli grup) kural
 * ile çöz ve kuralı şablona yaz.
 *
 *   "1.234,56" → 1234.56   (TR: nokta binlik, virgül ondalık)
 *   "1,234.56" → 1234.56   (EN: virgül binlik, nokta ondalık)
 *   "1234,5"   → 1234.5    (tek virgül → ondalık)
 *   "1.234"    → 1234      (tek nokta + tam 3 hane → BİNLİK; "1.5" ise 1.5)
 *   "%12" / "12 m" → 12    (birim/işaret ayıklanır)
 */
export function parseLocaleNumber(raw: string): number | null {
  const s = raw.replace(/\s/g, "").replace(/[^\d.,+-]/g, "");
  if (!s || s === "-" || s === "+") return null;
  const hasDot = s.includes(".");
  const hasComma = s.includes(",");
  let normalized = s;
  if (hasDot && hasComma) {
    // İki ayraç birlikte: SONDAKİ ondalıktır, diğeri binliktir.
    const decimalSep = s.lastIndexOf(".") > s.lastIndexOf(",") ? "." : ",";
    const thousandSep = decimalSep === "." ? "," : ".";
    normalized = s.split(thousandSep).join("").replace(decimalSep, ".");
  } else if (hasComma) {
    // Tek virgül → ondalık (TR). "1,234" burada 1.234 olur; binlik yazan bir
    // kullanıcı TR'de virgülü binlik için kullanmaz.
    normalized = s.replace(/,/g, ".");
  } else if (hasDot) {
    // Tek nokta: "1.234" gibi TAM üç haneli grupsa binlik, değilse ondalık.
    normalized = /^[+-]?\d{1,3}(\.\d{3})+$/.test(s) ? s.split(".").join("") : s;
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

const TRUE_WORDS = new Set(["EVET", "E", "TRUE", "1", "AKTIF", "AKTİF", "VAR", "X", "YES", "Y"]);
const FALSE_WORDS = new Set(["HAYIR", "H", "FALSE", "0", "PASIF", "PASİF", "YOK", "NO", "N"]);

/** "Evet/Hayır", "Aktif/Pasif", "1/0", "true/false"… → boolean. Tanınmazsa null. */
export function parseBool(raw: string): boolean | null {
  const s = raw.trim().toLocaleUpperCase("tr-TR");
  if (TRUE_WORDS.has(s)) return true;
  if (FALSE_WORDS.has(s)) return false;
  return null;
}

/**
 * Tarih metni → Date. Kabul edilen biçimler: `dd.MM.yyyy`, `dd/MM/yyyy`,
 * `yyyy-MM-dd` ve tam ISO. Saat verilmezse gün FABRİKA gününün başıdır
 * (Europe/Istanbul 00:00) — UTC gece yarısı almak, gece vardiyasında girilen
 * tarihi bir gün kaydırırdı (`constants/time.ts` dersi).
 */
export function parseDateCell(raw: string): Date | null {
  const s = raw.trim();
  if (!s) return null;
  const dmy = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(s);
  const ymd = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  let y: number;
  let m: number;
  let d: number;
  if (dmy) {
    d = Number(dmy[1]);
    m = Number(dmy[2]);
    y = Number(dmy[3]);
  } else if (ymd) {
    y = Number(ymd[1]);
    m = Number(ymd[2]);
    d = Number(ymd[3]);
  } else {
    const parsed = new Date(s);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  // Fabrika gününün başı: yerel 00:00'ın MUTLAK karşılığı. Ofset yaz/kış
  // değişebildiği için sabit "+03:00" yazılmaz — o günün ofseti hesaplanır.
  const utcGuess = Date.UTC(y, m - 1, d, 0, 0, 0);
  const offsetMs = istanbulOffsetMs(new Date(utcGuess));
  const at = new Date(utcGuess - offsetMs);
  return Number.isNaN(at.getTime()) ? null : at;
}

/** Verilen andaki Europe/Istanbul UTC ofseti (ms). DST'yi Intl üzerinden çözer. */
function istanbulOffsetMs(at: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: FACTORY_TIMEZONE,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(at);
  const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value ?? "0");
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - at.getTime();
}

/** `;` (veya `,`) ile ayrılmış kod listesi → temizlenmiş dizi. Boşlar düşer. */
export function splitList(raw: string): string[] {
  return raw
    .split(/[;,\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Gövde tavanı — 10.000 satır (panel de aynı sınırı uygular, mesajla). */
export const MAX_IMPORT_ROWS = 10000;

export function assertRowLimit(count: number): void {
  if (count > MAX_IMPORT_ROWS) {
    throw AppError.badRequest(
      `Tek seferde en fazla ${MAX_IMPORT_ROWS.toLocaleString("tr-TR")} satır aktarılabilir (gönderilen: ${count.toLocaleString("tr-TR")}). Dosyayı bölerek yükleyin.`,
    );
  }
}
