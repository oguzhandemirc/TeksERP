// YAZARAK ETKİNLEŞTİRME — geçici açılış kodunun (TG- + 23 × 5) yazım yardımı ve geçici etkinlik bandı.
// Biçim denetimi yalnız yazım yardımıdır; sağlamayı ve imzayı backend denetler. Sabitler backend protokolünün
// aynasıdır (`Teks-Erp/src/lib/license/protocol/gecici-kod.ts`; ayna testi temp-code.test.ts).
import type { LicenseStatusSummary } from "@/types/license";

/** Crockford base32 (I/L/O/U yok). */
export const TEMP_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const TEMP_CODE_PREFIX = "TG";
export const TEMP_CODE_GROUP = 5;
export const TEMP_CODE_LENGTH = 115;
export const TEMP_CODE_GROUPS = TEMP_CODE_LENGTH / TEMP_CODE_GROUP;

/** Backend `normalizeTempText` aynası: ön ek, tire/boşluk atılır; büyük harf; O→0, I/L→1. Alfabe dışı karakter korunur. */
export function normalizeTempCode(raw: string): string {
  let t = raw.toUpperCase().replace(/[\s\-_.]/g, "");
  if (t.startsWith(TEMP_CODE_PREFIX)) t = t.slice(TEMP_CODE_PREFIX.length);
  return t.replace(/O/g, "0").replace(/[IL]/g, "1");
}

/** Tek kutunun yazımı: ön ek atılmaz (kutu 5 karakterdir), yalnız büyük harf + O/I/L düzeltmesi + boşluk/tire atımı. */
export function normalizeTempGroup(raw: string): string {
  return raw.toUpperCase().replace(/[\s\-_.]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
}

/** Yapıştırılan (ya da tek kutuya taşan) metni 23 kutuya böler; fazlası atılır. */
export function splitTempGroups(raw: string): string[] {
  const t = normalizeTempCode(raw).slice(0, TEMP_CODE_LENGTH);
  return Array.from({ length: TEMP_CODE_GROUPS }, (_, i) => t.slice(i * TEMP_CODE_GROUP, (i + 1) * TEMP_CODE_GROUP));
}

/** Kutularda alfabe dışı karakteri olanların sırası (kırmızı kutu). */
export function invalidTempGroups(groups: readonly string[]): number[] {
  const out: number[] = [];
  groups.forEach((g, i) => {
    if ([...g].some((ch) => !TEMP_ALPHABET.includes(ch))) out.push(i);
  });
  return out;
}

export type TempCodeCheck =
  | { readonly ok: true; readonly kod: string }
  | { readonly ok: false; readonly kind: "BOS" | "KARAKTER" | "EKSIK"; readonly message: string | null; readonly group: number | null };

/** Boşsa ileti yok; geçersiz karakter ya da eksik kutu Türkçe ileti + kutu sırası; geçerliyse `TG-…` gruplu kod. */
export function checkTempGroups(groups: readonly string[]): TempCodeCheck {
  const filled = groups.join("");
  if (filled.length === 0) return { ok: false, kind: "BOS", message: null, group: null };
  const bad = invalidTempGroups(groups)[0];
  if (bad !== undefined) {
    const ch = [...(groups[bad] ?? "")].find((c) => !TEMP_ALPHABET.includes(c));
    return { ok: false, kind: "KARAKTER", message: `${bad + 1}. grupta geçersiz karakter: “${ch}”`, group: bad };
  }
  const short = groups.findIndex((g) => g.length !== TEMP_CODE_GROUP);
  if (short >= 0) {
    return { ok: false, kind: "EKSIK", message: `${short + 1}. grup eksik: her grup ${TEMP_CODE_GROUP} karakter, toplam ${TEMP_CODE_GROUPS} grup.`, group: short };
  }
  return { ok: true, kod: [TEMP_CODE_PREFIX, ...groups].join("-") };
}

/** Backend'in döndürdüğü karakter konumu (0 tabanlı, ön eksiz) → kutu sırası. */
export const tempGroupOfPosition = (konum: number): number => Math.floor(konum / TEMP_CODE_GROUP);

/**
 * Geçici etkinlik bandı: kurulum geçici açılış koduyla açıkken kabuk bunu çizer. Bitişe ≤7 gün ve sonrası backend'in
 * kendi bandıdır (`bantlar`); o varken panel ikinci metin üretmez, yalnız gün rozetini ekler. Gözlem kipinde çizilmez
 * (gözlem = sıfır fark).
 */
export function tempOpeningBand(status: Pick<LicenseStatusSummary, "gecici" | "kip"> | null): { metin: string; gun: string } | null {
  const g = status?.gecici;
  if (!g || status.kip !== "zorla") return null;
  return {
    metin: `Program geçici açılış koduyla çalışıyor (kod …${g.kodSonu}); lisansı karekodla ya da internetle etkinleştirin.`,
    gun: g.kalanGun > 0 ? `Geçici kod: ${g.kalanGun} gün` : "Geçici kod süresi doldu",
  };
}
