// =============================================================================
// Kalite ROLÜ — "1./2./fire kalitesi bu fabrikada HANGİ SATIR?" (karar ①)
// =============================================================================
// Katalog kodu (`"1.KALITE"` / `"A1"` / `"FIRE"`) fabrikaya AÇIK bir alandır;
// kodu koda gömmek `schema.prisma` QualityGrade notunun yasakladığı kırılganlık.
// Bu helper o soruyu KATALOGDAN cevaplar.
//
// ⚠️ ÜÇ AYRI SORU, ÜÇ AYRI ALAN — biri ötekinin yerine geçmez:
//   1) KOVA  "bu kalite hangi RAFA iner / fire mi"  → `targetStatus`
//            (`roll-finalize.helper.ts` → `loadProducedBuckets`)
//   2) ROL   "aksiyon '1./2./fire' dedi, hangi satırı YAZAYIM"  → BU DOSYA
//   3) SUNUM "hangi rozet rengi / hangi sıra"  → `color` + `sortOrder`
//
// Kovayı role vekil yapmak bu fabrikada SESSİZCE YANLIŞTIR: `A1`in
// `targetStatus`u WAREHOUSE'tur (A1_STOCK değil) ⇒ `a1Codes` BOŞ döner. Rolü
// sunuma vekil yapmak da yanlıştır: dört kademeli katalogda üç rol vardır,
// dördüncü kademe rozetini kaybeder.
//
// ⚠️ `isActive` ASİMETRİSİ — bilinçli ve iki yönü de gerekli:
//   • YAZMA yolu (`find`/`require`) yalnız AKTİF satırı çözer: pasifleştirilmiş
//     kaliteyle yeni top üretilmez (`resolveQualityGradeIdStrict` ile aynı kural).
//   • OKUMA yolu (`roleOf`) TÜM satırları okur: pasife alınmış eski bir kod hâlâ
//     geçmiş topların üstünde durur ve "bu top 2. kalite mi" sorusu onlar için de
//     doğru cevaplanmalıdır (`loadProducedBuckets`in `isActive` süzgeci
//     olmamasıyla aynı gerekçe).
// =============================================================================
import { Prisma, QualityGradeRole, type PrismaClient } from "@prisma/client";
import prismaClient from "../../lib/prisma";
import { AppError } from "../../utils/app-error";

/** Hem havuz client'ı hem transaction client'ı kabul eden okuma tipi (any YOK). */
type ReadDb = PrismaClient | Prisma.TransactionClient;

export interface QualityRoleRow {
  id: string;
  code: string;
  name: string;
}

/** Rol → kullanıcıya gösterilecek Türkçe ad (yalnız hata metni için). */
const ROLE_LABEL: Record<QualityGradeRole, string> = {
  FIRST: "1. kalite",
  SECOND: "2. kalite",
  SCRAP: "fire",
};

/**
 * TAMBUR "kalan kumaş" sözleşmesi (`remainingAction`) → üretim rolü.
 *
 * Sözleşme adları katalog KODUNUN API'ye sızmış hâlidir (`keep_1kalite`) ve
 * BİLİNÇLİ OLARAK KORUNUR: sahadaki eski tablet bunları göndermeye devam eder,
 * `minVersion` gerekmez. Sunucu adı role çevirir, rol katalog satırını verir.
 * Yeni `remainingGradeId` (uuid) gelirse bu eşleme EZİLİR.
 *
 * ⚠️ TEK KAYNAK: iki çağıran var (`finishOpenFabric` · `cutRemaining`) ve ikisi
 * aynı soruyu soruyor — eşleme kopyalanırsa biri sessizce ayrışır.
 * `discard` da SCRAP'e düşer: bugünkü davranış budur ("keep_* değilse FIRE").
 */
export type RemainingAction = "keep_1kalite" | "keep_a1" | "scrap" | "discard";

export const ROLE_BY_REMAINING_ACTION: Record<RemainingAction, QualityGradeRole> = {
  keep_1kalite: QualityGradeRole.FIRST,
  keep_a1: QualityGradeRole.SECOND,
  scrap: QualityGradeRole.SCRAP,
  discard: QualityGradeRole.SCRAP,
};

export interface QualityRoles {
  /** Rolün AKTİF katalog satırı; yoksa null — çağıran kendi kararını verir. */
  find(role: QualityGradeRole): QualityRoleRow | null;
  /**
   * Rolün AKTİF katalog satırı; yoksa Türkçe 400 (FAIL-CLOSED).
   * Eskiden bu durumda kod literali yazılıp top sessizce Hazır Depo'ya
   * iniyordu — fire satılabilir stok sayılıyordu. Artık işlem DURUR.
   */
  require(role: QualityGradeRole): QualityRoleRow;
  /**
   * Kodun rolü — PASİF satırlar DA okunur (geçmiş topların kodu katalogda
   * pasifleşmiş olabilir). Katalogda hiç yoksa null.
   */
  roleOf(code: string | null | undefined): QualityGradeRole | null;
  /**
   * Bu rolü taşıyan TÜM kodlar (pasif dahil) — okuma/süzme yolları için.
   * Sed AKTİF satırlarda tekilliği garanti eder, pasif tarih satırlarıyla
   * birlikte liste birden uzun olabilir.
   */
  codesOf(role: QualityGradeRole): string[];
}

/**
 * TAMBUR kalan-kumaş kararını KATALOG KODUNA çevirir — iki çağıranın tek kapısı.
 *
 * Öncelik: açık `remainingGradeId` (yeni tablet, katalogdan SEÇTİ) → rol eşlemesi
 * (eski tablet, sözleşme adı gönderdi). Rolsüz katalogda FAIL-CLOSED 400 —
 * eskiden burada literal yazılıp top sessizce Hazır Depo'ya iniyordu.
 */
export async function resolveRemainingGradeCode(
  db: ReadDb,
  action: RemainingAction,
  remainingGradeId?: string | null,
): Promise<string> {
  if (remainingGradeId) {
    const row = await db.qualityGrade.findUnique({
      where: { id: remainingGradeId },
      select: { code: true, isActive: true },
    });
    if (!row) throw AppError.badRequest("Seçilen kalite sınıfı bulunamadı.");
    if (!row.isActive) throw AppError.badRequest("Seçilen kalite sınıfı pasif.");
    return row.code;
  }
  const roles = await loadQualityRoles(db);
  return roles.require(ROLE_BY_REMAINING_ACTION[action]).code;
}

/**
 * ÖNİZLEME/ÖRNEK yüklerinin kalite KODU — katalogdan, gömülü sabitten DEĞİL.
 *
 * Gömülü sabit iki ayrı kusur taşıyordu (ölçüldü 2026-09-13, üç çağrı yolu):
 *   1) fabrikanın kataloğu farklıysa kod hiç eşleşmiyordu;
 *   2) üç önizleme yolu KODU değil ADINI ("1. Kalite") basıyordu — oysa
 *      `LabelPayload.qualityGrade` gerçek topta `Roll.qualityGrade`, yani
 *      KODUN snapshot'ıdır. Sonuç: `showIf qualityGrade in ["1.KALITE"]`
 *      taşıyan şablonun koşullu elemanı ÖNİZLEMEDE HİÇ görünmüyor, tasarımcı
 *      onu yanlış konumlandırıyordu.
 *
 * ⚠️ `require` DEĞİL `find` — bilinçli: bu yol ÖNİZLEMEDİR. Rolsüz katalogda
 * 400 vermek yerine sırası en küçük aktif kaliteye, o da yoksa `null`a düşer
 * (çağıran `?? ""` ile "kalitesiz" sentinel'ine çevirir → koşullu eleman
 * fail-closed basılmaz). Yazma yolları `require` kullanır; aynı helper'ın iki
 * sertliği aynı gerekçeden doğar: yazma yanlış veri üretir, önizleme üretmez.
 */
export async function sampleQualityCode(db: ReadDb = prismaClient): Promise<string | null> {
  const roles = await loadQualityRoles(db);
  const rolLu = roles.find(QualityGradeRole.FIRST);
  if (rolLu) return rolLu.code;
  const ilk = await db.qualityGrade.findFirst({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
    select: { code: true },
  });
  return ilk?.code ?? null;
}

/**
 * Katalog rollerini TEK sorguda yükler. Çağrı başına bir gidiş-dönüş; tx içinde
 * de çağrılabilir (claim'den sonra taze okuma gerekiyorsa `tx` geçir).
 */
export async function loadQualityRoles(db: ReadDb = prismaClient): Promise<QualityRoles> {
  const rows = await db.qualityGrade.findMany({
    where: { role: { not: null } },
    select: { id: true, code: true, name: true, role: true, isActive: true },
  });

  const activeByRole = new Map<QualityGradeRole, QualityRoleRow>();
  const roleByCode = new Map<string, QualityGradeRole>();
  const codesByRole = new Map<QualityGradeRole, string[]>();

  for (const r of rows) {
    if (!r.role) continue;
    roleByCode.set(r.code, r.role);
    const bucket = codesByRole.get(r.role);
    if (bucket) bucket.push(r.code);
    else codesByRole.set(r.role, [r.code]);
    // Sed (partial unique) rol başına EN FAZLA BİR aktif satıra izin verir;
    // yine de ilk gelen kazanır diye yazmıyoruz — sed atlanmış bir kurulumda
    // (mükerrer temizliği bekleyen prod) davranış deterministik olsun.
    if (r.isActive && !activeByRole.has(r.role)) activeByRole.set(r.role, { id: r.id, code: r.code, name: r.name });
  }

  return {
    find(role) {
      return activeByRole.get(role) ?? null;
    },
    require(role) {
      const hit = activeByRole.get(role);
      if (!hit) {
        throw AppError.badRequest(
          `Kalite kataloğunda "${ROLE_LABEL[role]}" rolü atanmamış. ` +
            `Sistem → Kalite Sınıfları'nda bir kaliteye bu rolü verin.`,
        );
      }
      return hit;
    },
    roleOf(code) {
      if (!code) return null;
      return roleByCode.get(code) ?? null;
    },
    codesOf(role) {
      return codesByRole.get(role) ?? [];
    },
  };
}
