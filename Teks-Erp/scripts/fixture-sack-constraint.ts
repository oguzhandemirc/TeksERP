// =============================================================================
// Test yardımcısı — `rolls_sackId_status_present` CHECK'ini GEÇİCİ olarak askıya al
// (`test_` prefix'i YOK → run-all-tests bunu test dosyası saymaz)
// =============================================================================
// NEDEN VAR: bazı testler "çuvalda kayıtlı ama fiziksel olarak binada olmayan top"
// (hayalet) durumunu KASTEN üretir — çünkü sayım/belge yüzeylerinin bu satırları
// DIŞLADIĞINI kanıtlamanın başka yolu yok. Bu, ileride eklenecek DB emniyet kilidi
// (`rolls_sackId_status_present`) ile ÇELİŞİR: kilit tam da bu satırı imkânsız kılar.
//
// Kilit henüz EKLENMEDİ (ön koşulu: production taraması 0 satır). Bu yardımcı ikisini
// de destekler:
//   • Kilit YOKSA  → hiçbir şey yapmaz, `fn` doğrudan koşar (bugünkü durum).
//   • Kilit VARSA  → DROP → `fn` → yeniden ADD (NOT VALID; tarama yapmaz, hızlı).
// Böylece kilit eklendiği gün testler DEĞİŞMEDEN çalışmaya devam eder ve bu dosya
// "kilidi eklemeden önce çözülmesi gereken ön koşul" olmaktan çıkar.
//
// ⚠️ DAYANIKLILIK: `finally` kilidi geri koyar. Süreç SERT öldürülürse (SIGKILL —
// finally koşmaz) kilit askıda kalırdı; bu yüzden `ensureSackStatusConstraint()`
// her koşumun BAŞINDA çağrılabilir ve eksikse geri kurar. Ayrıca `withSackConstraintSuspended`
// kendi başında da bunu yapmaz — çünkü kilidin VAR OLMAMASI bugün NORMAL durumdur;
// "eksikse kur" davranışı yalnız kilit ARTIK BEKLENİYORSA (envanterde) anlamlıdır.
// =============================================================================
import prisma from "../src/lib/prisma";

/** Kilidin adı — `test_db_invariants.ts` envanteri ve migration ile AYNI olmalı. */
export const SACK_STATUS_CONSTRAINT = "rolls_sackId_status_present";

/**
 * Kilit tanımı — migration ile BİREBİR aynı olmalı (yardımcı onu geri kurarken
 * kullanır). Statü listesi: `helpers/sack-invariants.helper.SACK_ABSENT_STATUSES`.
 * `NOT VALID`: mevcut satırları TARAMAZ (hızlı + canlıda ihlal varsa patlamaz).
 */
const CONSTRAINT_SQL =
  `ALTER TABLE "rolls" ADD CONSTRAINT "${SACK_STATUS_CONSTRAINT}" ` +
  `CHECK ("sackId" IS NULL OR "status" NOT IN (` +
  `'CANCELLED','SCRAP','IN_PRODUCTION','AT_SUBCONTRACTOR',` +
  `'SUBCONTRACTOR_CONSUMED','AT_KARTELA','KARTELA_CONSUMED','TAMBUR_CONSUMED')) NOT VALID`;

/** Kilit şu an DB'de var mı? */
export async function sackStatusConstraintExists(): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ conname: string }[]>`
    SELECT conname FROM pg_constraint WHERE conname = ${SACK_STATUS_CONSTRAINT}`;
  return rows.length > 0;
}

/** Kilit eksikse geri kur (SIGKILL sonrası onarım için). */
export async function ensureSackStatusConstraint(): Promise<void> {
  if (await sackStatusConstraintExists()) return;
  await prisma.$executeRawUnsafe(CONSTRAINT_SQL);
}

/**
 * `fn` boyunca kilidi askıya al. Kilit yoksa hiçbir şey yapmaz (bugünkü durum).
 *
 * Kullanım:
 * ```ts
 * await withSackConstraintSuspended(async () => {
 *   await prisma.roll.update({ where: { id }, data: { status: "AT_KARTELA" } }); // hayalet
 * });
 * ```
 */
export async function withSackConstraintSuspended<T>(fn: () => Promise<T>): Promise<T> {
  const had = await sackStatusConstraintExists();
  if (!had) return fn();
  await prisma.$executeRawUnsafe(`ALTER TABLE "rolls" DROP CONSTRAINT "${SACK_STATUS_CONSTRAINT}"`);
  try {
    return await fn();
  } finally {
    // IF NOT EXISTS yok (ADD CONSTRAINT desteklemez) → var mı diye bak, sonra kur.
    if (!(await sackStatusConstraintExists())) {
      await prisma.$executeRawUnsafe(CONSTRAINT_SQL);
    }
  }
}
