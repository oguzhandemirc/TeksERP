// =============================================================================
// BEKLEYEN BİÇİM DEĞİŞİKLİĞİ (K4, 2026-09-23)
// =============================================================================
// `series-write.helper.ts`ten AYRILDI (boyut tavanı). Bölme ekseni ZAMAN KİPİ:
// orada "bugünden itibaren geçerli olan yazılır", burada "henüz geçerli OLMAYAN
// kaldırılır". İkisi farklı defter sınıfına da düşer — biri defter satırı yazar,
// öteki bir TASLAĞI siler.
// =============================================================================
import { numberSeriesCatalogEntry } from "../../constants/number-series-catalog";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { AuditService } from "../audit.service";
import { refreshNumberSeriesCache } from "../number-series.service";

/**
 * BEKLEYEN BİÇİM DEĞİŞİKLİĞİNİ İPTAL ET (K4, 2026-09-23).
 *
 * ⚠️ NEDEN SERT SİLME ve bu defter.md'ye göre ölçülmüş bir karar: vadesi GELMEMİŞ
 * bir biçim satırı HİÇ YÜRÜRLÜĞE GİRMEDİ — onunla tek bir numara doğmadı, hiçbir
 * rapor onu okumuyor, silindiğinde raporlanan HİÇBİR SAYI DEĞİŞMİYOR. Bu, defter
 * doktrininin ④ sınıfıdır: "deftere hiç yazmamış TASLAK", ve o sınıfta sert silme
 * meşrudur (atomik claim şartıyla). `revokedAt` damgası burada YANLIŞ olurdu:
 * damga, satırın bir zamanlar GEÇERLİ olduğunu ima eder ve zaman çizgisinde hiç
 * yaşamamış bir rejimi geçmişe sokar.
 *
 * ⚠️ ATOMİK CLAIM: `effectiveFrom > now` koşulu WHERE'in İÇİNDEDİR. Önce okuyup
 * sonra silseydik, arada vadesi gelen bir satır (önbellek tazelemesi onu yürürlüğe
 * alır) SİLİNEBİLİRDİ — yani yürürlükteki bir defter satırı. Silinen satır sayısı
 * 0 ise 409: "bekleyen değişiklik yok ya da bu arada yürürlüğe girdi".
 *
 * İptal bir İŞ KARARIDIR (fabrika o biçime geçmekten vazgeçti) ⇒ audit'e yazılır.
 */
export async function cancelPendingSeriesFormat(key: string, userId?: string): Promise<number> {
  numberSeriesCatalogEntry(key); // tanınmayan anahtar → 404/400 (katalog kapısı)
  const simdi = new Date();
  const bekleyen = await prisma.numberSeriesLine.findMany({
    where: { seriesKey: key, effectiveFrom: { gt: simdi } },
    select: { id: true, effectiveFrom: true, prefix: true, dateSegment: true, digits: true, separator: true },
  });
  const { count } = await prisma.numberSeriesLine.deleteMany({
    where: { seriesKey: key, effectiveFrom: { gt: new Date() } },
  });
  if (count === 0) {
    throw AppError.conflict(
      "Bekleyen bir biçim değişikliği bulunamadı (iptal edilmiş ya da bu arada yürürlüğe girmiş olabilir).",
      { code: "NUMBER_SERIES_NO_PENDING", key },
    );
  }
  await refreshNumberSeriesCache();
  await AuditService.log({
    userId,
    action: "DELETE",
    tableName: "NumberSeriesLine",
    recordId: bekleyen[0]?.id ?? key,
    oldData: { key, iptalEdilen: bekleyen },
  });
  return count;
}
