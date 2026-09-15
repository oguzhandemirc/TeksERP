// =============================================================================
// RAPOR GÖRÜNÜRLÜK KAPISI (Raporlar K4)
// =============================================================================
// `module.middleware.ts`in kardeşi ama AYNI ŞEY DEĞİL ve ayrım adla taşınır:
// modül anahtarı bir REJİM anahtarıdır (kapalıyken deftere satır yazılamaz),
// rapor anahtarı bir GÖRÜNÜRLÜK kararıdır (kapalı rapor hiçbir şey yazmaz,
// yalnız okumaz). Yine de kapı BACKEND'dedir: menüyü gizlemek yetmez — adresi
// bilen ya da eski sekmesi açık kalan kullanıcı ucu yine çağırır ve kapattığını
// sandığı sayıyı görür.
//
// ⚠️ SIRA (K4): `verifyToken`DAN SONRA, izin guard'ından ÖNCE. Kimliksiz istek
// önce 401 almalı — rapor kapısı bir kurulum sırrını (hangi raporun kapalı
// olduğunu) anonim çağırana sızdırmaz. Modül kapısı (`requireDokumaEnabled` vb.)
// varsa o da kalır ve DAHA ÖNCE koşar: kapalı modülün raporu "rapor kapalı"
// değil "modül kapalı" demelidir.
//
// ⚠️ JENERİK FABRİKA YASAĞI (`requireModule("x")`) BURAYA UYGULANMAZ ve bu
// bilinçlidir: o yasağın gerekçesi "kapı varlığı middleware'in ADIYLA ölçülüyor"
// idi. Burada anahtar TİPLİ (`ReportKey`, katalogdan türetilmiş union — derleyici
// bilinmeyen anahtarı reddeder) ve bekçi her `router.get`i katalogla İKİ YÖNLÜ
// ölçer, yani kapının varlığı ada değil ÖLÇÜME bağlı.
//
// ⚠️ ÜÇ SONUÇ, İKİ DEĞİL: açık · kapalı · ÖLÇÜLEMEDİ. Listeyi okuyamadığımızda
// (bozuk satır, DB düşük) 403 veririz — ama AYRI bir kodla. "Ölçemedim"i
// "kapalı" diye basmak destek ekibini yanlış anahtara gönderirdi; "açık" diye
// basmak ise kapıyı fail-open yapardı.
// =============================================================================
import { Request, Response, NextFunction } from "express";
import type { ReportKey } from "../constants/report-catalog";
import { REPORT_BY_KEY } from "../constants/report-catalog";
import { readReportsClosedKeys } from "../services/system-setting.service";
import { AppError } from "../utils/app-error";

/**
 * Bu anahtarın raporu açık mı? `verifyToken` sonrası, izin guard'ı öncesi takılır.
 *
 * ⚠️ BAYAT ANAHTAR OKUMADA YOK SAYILIR (1e hükmü): listede katalogda olmayan bir
 * anahtar varsa kapı onu ATLAR — silinmiş bir rapor yüzünden 29 ucun hepsi
 * 500'e düşmemelidir. Tipo'yu yakalayan yer YAZMA ucudur (400 `REPORT_KEY_UNKNOWN`),
 * bayat anahtarı duyuran yer boot uyarısıdır.
 */
export function requireReportOpen(key: ReportKey) {
  return async function reportGate(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const visibility = await readReportsClosedKeys();
      if (visibility.durum === "olculemedi") {
        // FAIL-CLOSED ve AYRI KOD: bu rapor kapalı OLABİLİR, bilemiyoruz.
        throw AppError.forbidden(
          "Rapor görünürlük listesi okunamadı; rapor geçici olarak kapalı. " +
            "Sistem → Raporlar bölümünden liste yeniden kaydedilerek düzeltilir.",
          { code: "REPORT_GATE_UNAVAILABLE", rapor: key, neden: visibility.neden },
        );
      }
      if (visibility.kapali.includes(key)) {
        throw AppError.forbidden(
          `${REPORT_BY_KEY.get(key)?.baslik ?? key} raporu bu kurulumda kapalı.`,
          { code: "REPORT_DISABLED", rapor: key },
        );
      }
      next();
    } catch (e) {
      next(e);
    }
  };
}
