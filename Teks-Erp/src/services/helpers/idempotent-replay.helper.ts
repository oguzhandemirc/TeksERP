// =============================================================================
// İDEMPOTENT REPLAY — "aynı token, FARKLI gövde" kapısı (BULGU-T4-003)
// =============================================================================
// Bir `clientToken`ın anlamı "bu MANTIKSAL denemeyi bir kez uygula"dır. Token
// eşleşince mevcut kaydı döndürmek, ancak gelen gövde o kayıtla ÖZDEŞSE
// doğrudur. Özdeş değilse istemci farklı bir işi aynı kimlikle göndermiştir ve
// sunucunun "başarılı" demesi, operatörün DÜZELTMESİNİ sessizce yutar:
//
//   Operatör 40 m keser → istek zaman aşımına uğrar (ama COMMIT olmuştur) →
//   yeniden ölçüp 25 m yazar → aynı token gider → sunucu ilk kesimin 40 m'lik
//   çocuğunu "Kesim zaten kaydedilmiş" diye döndürür. 25 m hiç yazılmaz, hata
//   görünmez, fark ancak envanterde aranırsa anlaşılır.
//
// Doğru kalıp repoda ZATEN VARDI ama tek bir yerde (`inventory.createInitialEntry`,
// F117). Bu dosya onu ortaklaştırır; dört replay noktası buradan geçer.
//
// ⚠️ KAPI DAR OLMALI — "gövdenin tamamı aynı mı" DEĞİL. Karşılaştırılan şey
// KİMLİK-KİLİT alanlarıdır (kesimde ebeveyn + metraj, çuvalda müşteri + şube).
// Not/etiket/açıklama gibi yan alanları kıyaslamak, operatörün bir yazım
// hatasını düzeltip yeniden göndermesini 409'a düşürürdü — yani korumayı tam da
// en çok gerektiği anda ters yönde çalıştırırdı (fason `receiveFingerprint`
// ile aynı gerekçe, BULGU-T2-007).
// =============================================================================
import { Prisma } from "@prisma/client";
import { AppError } from "../../utils/app-error";

/**
 * İki kimlik alanı aynı mı?
 *
 * ⚠️ `Decimal` ÖZEL: `===` iki `Decimal` nesnesini ASLA eşit saymaz ve metraj
 * karşılaştırması sessizce "hep farklı"ya düşerdi — yani kapı her replay'i
 * 409'a çevirirdi (koruma değil, arıza). `null`/`undefined` aynı sayılır:
 * "alan yok" ile "alan boş" bu bağlamda aynı gerçeği anlatır.
 */
export function replayAlaniAyni(mevcut: unknown, gelen: unknown): boolean {
  const a = mevcut ?? null;
  const b = gelen ?? null;
  if (a === null || b === null) return a === b;
  if (a instanceof Prisma.Decimal || b instanceof Prisma.Decimal) {
    try {
      return new Prisma.Decimal(a as Prisma.Decimal.Value).equals(
        new Prisma.Decimal(b as Prisma.Decimal.Value),
      );
    } catch {
      return false; // sayıya çevrilemiyorsa "aynı" DEME (fail-closed)
    }
  }
  return a === b;
}

export interface ReplayAlani {
  /** Hata gövdesinde görünecek ad — operatöre değil, log/destek için. */
  ad: string;
  mevcut: unknown;
  gelen: unknown;
}

/**
 * Kimlik-kilit alanları uyuşmuyorsa 409 `CLIENT_TOKEN_COLLISION` fırlatır.
 * Uyuşuyorsa sessizce döner → çağıran mevcut kaydı idempotent yanıt olarak verir.
 *
 * @param alanlar karşılaştırılacak kimlik alanları (BOŞ VERİLEMEZ — boş liste
 *                her gövdeyi "aynı" sayar ve kapı vakumen açılır)
 * @param mesaj   operatörün göreceği Türkçe cümle: NE olduğu + NE yapacağı
 */
export function assertReplayPayloadMatches(
  alanlar: ReplayAlani[],
  mesaj: string,
  ek: Record<string, unknown> = {},
): void {
  if (alanlar.length === 0) {
    // Programlama hatası: kimlik alanı vermeden çağırmak korumayı kapatır.
    throw new Error("assertReplayPayloadMatches: kimlik alanı listesi boş olamaz");
  }
  const farkli = alanlar.filter((a) => !replayAlaniAyni(a.mevcut, a.gelen));
  if (farkli.length === 0) return;
  throw AppError.conflict(mesaj, {
    code: "CLIENT_TOKEN_COLLISION",
    ...ek,
    farkliAlanlar: farkli.map((f) => f.ad),
    existing: Object.fromEntries(farkli.map((f) => [f.ad, String(f.mevcut ?? "")])),
    incoming: Object.fromEntries(farkli.map((f) => [f.ad, String(f.gelen ?? "")])),
  });
}
