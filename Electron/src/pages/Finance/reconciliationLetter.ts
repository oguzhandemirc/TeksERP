// =============================================================================
// CARİ MUTABAKAT MEKTUBU — istek gövdesi + kapı yüklemi (saf katman)
// =============================================================================
// NE ÜRETİR: `POST /api/finance/reconciliation-letters` gövdesi. Kâğıdı bu dosya
// ÜRETMEZ — bakiye fotoğrafı backend'de `txnDate <= asOf` ile TÜRETİLİR ve
// `PrintedDocument` olarak DONAR; ekrana mevcut `PrintedDocDialog` ile gelir.
//
// ⚠️⚠️ `asOf` GÜN SONUDUR, gün başı DEĞİL — bu dosyanın tek load-bearing satırı.
// Backend süzgeci `txnDate <= asOf` ve "31 Temmuz itibarıyla" denince 31
// Temmuz'un hareketleri DAHİLDİR. Yerel gün BAŞI gönderilseydi (00:00) o günün
// bütün hareketleri sessizce dışarıda kalır, mektup DOĞRU GÖRÜNEN ama EKSİK bir
// bakiye ile karşı tarafa gider ve fark ancak mutabakat reddedilince anlaşılırdı.
// Hata yok, log yok, kâğıt basılmış olur.
//
// ⚠️ TARİH `Cheques/dates.ts` YARDIMCILARIYLA çözülür, `new Date("YYYY-MM-DD")`
// ile DEĞİL: o biçim ECMAScript'te UTC gece yarısı sayılır ve negatif UTC farkı
// olan bir makinede günü bir geri kaydırır. (`StatementDialog`in kendi yerel
// `dayEnd` yardımcısı tam bu deseni kullanıyor; yeni kod onu kopyalamaz.)
//
// ⚠️ MEKTUP TÜM PARA BİRİMLERİNİ BASAR. Ekstre ekranı tek para birimi gösterir
// (iki para birimini tek yürüyen bakiyede toplamak anlamsız olduğu için); mektup
// ise carinin bütün bakiyelerini AYRI SATIRLARDA döker. Ekran bunu kullanıcıya
// SÖYLEMELİ, yoksa "USD satırı nereden çıktı" sorusu kâğıt gittikten sonra gelir.
// =============================================================================

import { dayEndIso } from "./Cheques/dates";

export const RECONCILIATION_DATE_ERROR =
  "Bakiye tarihi gerekli — mektubun anlattığı kesit odur.";

export const RECONCILIATION_INACTIVE_ERROR =
  "Bu carinin hesabı pasif durumda — mutabakat mektubu için önce Cari Hesaplar ekranından aktifleştirin.";

/** Ekranın topladığı ham taslak (kutulardaki metinler dahil, kırpılmamış). */
export interface ReconciliationDraft {
  cariId: string;
  /** Kartın aktifliği — backend pasif cariyi 409 ile reddeder. */
  cariIsActive: boolean;
  /** `<input type="date">` değeri (YYYY-MM-DD, yerel gün). */
  asOfYmd: string;
  notes: string;
}

/** `POST /api/finance/reconciliation-letters` gövdesi (backend Zod `.strict()`). */
export interface ReconciliationLetterBody {
  cariId: string;
  asOf: string;
  notes?: string;
}

/**
 * Bu taslaktan mektup kesilemiyorsa sebebi; kesilebiliyorsa `null`.
 *
 * ⚠️ Pasif cari kontrolü ekranda TEKRAR edilir çünkü backend'in 409'u kâğıdı
 * bastıktan sonra değil, düğmeye basınca gelir; sebebi ÖNCEDEN yazmak
 * kullanıcıyı hata mesajı avlamaktan kurtarır. Kuralı koruyan taraf yine
 * sunucudur (ekran nezaket).
 */
export function reconciliationBlockReason(
  draft: Pick<ReconciliationDraft, "cariIsActive" | "asOfYmd">,
): string | null {
  if (!draft.cariIsActive) return RECONCILIATION_INACTIVE_ERROR;
  if (!dayEndIso(draft.asOfYmd)) return RECONCILIATION_DATE_ERROR;
  return null;
}

/**
 * İstek gövdesi.
 *
 * ⚠️ FAIL-CLOSED: kabul edilemez taslakta `null` DÖNMEZ, FIRLATIR — `null`
 * çağıran tarafta sessizce "hiçbir şey yapmayan düğme"ye dönüşür.
 *
 * ⚠️ Boş not GÖNDERİLMEZ: backend `.strict()` şemada `nullable().optional()`
 * ve boş string kâğıda başlıksız bir "Not:" satırı doğururdu.
 */
export function buildReconciliationLetterBody(
  draft: ReconciliationDraft,
): ReconciliationLetterBody {
  if (!draft.cariIsActive) throw new Error(RECONCILIATION_INACTIVE_ERROR);

  // GÜN SONU — dosya başlığındaki tek load-bearing karar.
  const asOf = dayEndIso(draft.asOfYmd);
  if (!asOf) throw new Error(RECONCILIATION_DATE_ERROR);

  const notes = draft.notes.trim();
  return { cariId: draft.cariId, asOf, ...(notes ? { notes } : {}) };
}
