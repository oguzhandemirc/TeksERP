// =============================================================================
// Kalite ROLÜ — "1./2./fire kalitesi bu fabrikada HANGİ SATIR?" (karar ①)
// =============================================================================
// Katalog kodu (`"1.KALITE"` / `"A1"` / `"FIRE"`) fabrikaya AÇIK bir alandır;
// admin `1K / 2K / HURDA` da yazabilir. Kodu tablete gömmek, kataloğu farklı
// olan her kurulumda SESSİZCE yanlış davranış üretir: fire kesimi var olmayan
// bir kodla gider, sunucu onu çözemez ve top satılabilir stoka iner.
//
// ⚠️ ÜÇ AYRI SORU, ÜÇ AYRI ALAN — biri ötekinin yerine geçmez:
//   1) KOVA  "hangi RAFA iner / fire mi"          → `targetStatus`
//   2) ROL   "aksiyon '1./2./fire' dedi, hangi
//            satırı YAZAYIM"                      → BU DOSYA (`role`)
//   3) SUNUM "hangi rozet rengi / hangi sıra"      → `color` + `sortOrder`
//
// Kovayı role vekil yapmak bu fabrikada yanlıştır: `A1`in `targetStatus`u
// WAREHOUSE'tur (A1_STOCK değil). Rolü sunuma vekil yapmak da yanlıştır: dört
// kademeli bir katalogda üç rol vardır, dördüncü kademe rozetini kaybeder.
//
// ⚠️ NEDEN SAF FONKSİYON, KANCA DEĞİL (kullanıcı kararı 2026-09-13):
//   • ekranların çoğu kalite kataloğunu ZATEN `useQuery` ile çekiyor — kanca
//     ikinci bir sorgu doğururdu ("aynı soruyu iki kez soran iki yol");
//   • rolsüz / pasif-kademeli katalog senaryoları saf fonksiyona PARAMETRE
//     olarak verilebilir, kancada fixture kurmak gerekirdi.
//   `shortCutQuality.ts` ile aynı şekil (saf · `grades` alır · kendi testi).
//
// ⚠️ OKUMA YÜZEYİ: rol bulunamazsa `null` döner, FIRLATMAZ. Tablet bir ekrandır;
// backend yazma yolları aynı soruyu `require` ile sorar ve rolsüz katalogda
// 400 verir (fail-closed orada, burada değil). Çağıran `null`da ne yapacağına
// kendi karar verir — çoğu yerde "rozeti çizme" / "ön seçim yapma".
// =============================================================================
import type { QualityGrade, QualityGradeRole } from '../types/models';

/** Çözücünün ihtiyaç duyduğu en dar şekil — testler tam `QualityGrade` kurmasın. */
export interface QualityGradeLike {
  code: string;
  name: string;
  color?: string | null;
  role?: QualityGradeRole | null;
  isActive?: boolean;
}

/**
 * Rolün AKTİF katalog satırı; yoksa `null`.
 *
 * ⚠️ `isActive` ŞARTI bilinçli: pasifleştirilmiş bir kalite geçmiş topların
 * üstünde durmaya devam eder ama YENİ yazımda kullanılamaz (backend
 * `resolveQualityGradeIdStrict` ile aynı kural). `isActive` alanı gelmeyen
 * eski sunucu yanıtında `undefined` olur ve satır AKTİF sayılır — bugünkü
 * davranış korunur.
 */
export function findGradeByRole(
  grades: readonly QualityGradeLike[],
  role: QualityGradeRole,
): QualityGradeLike | null {
  return grades.find((g) => g.role === role && g.isActive !== false) ?? null;
}

/** Rolün kodu; rol atanmamışsa `null`. Yazma yükünde bu kod gider. */
export function codeByRole(
  grades: readonly QualityGradeLike[],
  role: QualityGradeRole,
): string | null {
  return findGradeByRole(grades, role)?.code ?? null;
}

/**
 * Bir KODUN rolü — PASİF satırlar DA okunur.
 *
 * ⚠️ Asimetri bilinçli ve iki yönü de gerekli: YAZMA yolu yalnız aktif satırı
 * çözer (yukarısı), OKUMA yolu tümünü okur — pasife alınmış eski bir kod hâlâ
 * geçmiş topların üstünde durur ve "bu top 2. kalite mi" sorusu onlar için de
 * doğru cevaplanmalıdır (backend `loadQualityRoles.roleOf` ile aynı gerekçe).
 */
export function roleOfCode(
  grades: readonly QualityGradeLike[],
  code: string | null | undefined,
): QualityGradeRole | null {
  if (!code) return null;
  return grades.find((g) => g.code === code)?.role ?? null;
}

/**
 * SUNUM — topun kalite rozeti için katalogtaki renk.
 *
 * Rol DEĞİL `color` okunur (üçüncü soru): dört kademeli bir katalogda üç rol
 * vardır ve rolsüz kademe de rozetini hak eder. Katalogda renk yoksa `null` —
 * çağıran nötr rozetine düşer.
 */
export function gradeColor(
  grades: readonly QualityGradeLike[],
  code: string | null | undefined,
): string | null {
  if (!code) return null;
  return grades.find((g) => g.code === code)?.color ?? null;
}

/** Ekranların elindeki tam `QualityGrade` dizisi de bu şekle uyar. */
export type { QualityGrade };
