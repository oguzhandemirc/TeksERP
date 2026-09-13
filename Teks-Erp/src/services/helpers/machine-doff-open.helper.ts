// =============================================================================
// DOFF KAYDI — koşum uyarıları (tek kaynak) + indirme kodu (8029 altında)
// =============================================================================
// İki şeyi servisten ayırır ki iki yol aynı cevabı versin:
//   • `deriveRunWarnings` — "iş emri metresine GİRMİYOR" uyarısı hem ilk kayıtta
//     hem REPLAY'de döner. Çevrimdışı yeniden gönderimde operatörün gördüğü tek
//     cevap replay cevabıdır; uyarı orada susarsa kayıp görünmez olur
//     (DOKUMA-IS-EMRI-VE-TABLET-TASARIMI §3.8 "sessiz atlama görünmezliktir").
//   • `nextDoffCodeTx` — günlük sıra oku-sonra-yaz'dır; 25 paralel kayıtta
//     `withBarcodeRetry` tükeniyordu (ölçüldü 2026-09-13, §3.8c W9). Sıra 8029
//     "kod tekilliği" uzayında serileşir; kilit tx'in İLK ifadesidir, sonra
//     alınan kilit TOCTOU'yu kapatmaz. Retry yalnız `code_key` P2002 kemeri kalır.
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { buildDailyCode, dailyCodePrefix, nextDailySeq } from "../../utils/code-format";
import { lockCodeScopeTx } from "./code-unique.helper";

/** Fiziksel etiket kodu: `DF` + GGAAYY + NNNN (≤ 32). */
export const DOFF_CODE_PREFIX = "DF";
/** 8029 uzayında bu tablonun kapsam adı — başka tablonun günlük sırasıyla beklemesin. */
const DOFF_CODE_SCOPE = "doffEvent";

export const WARN_RUN_MISSING = "Koşum açılmadığı için bu indirme iş emri metresine GİRMİYOR.";
export const WARN_RUN_WITHOUT_ORDER = "Koşum bir dokuma işine bağlı değil — bu indirme iş emri metresine GİRMİYOR.";

/**
 * Koşum bağının kaybını ADIYLA söyler. Koşumsuz → kayıp; koşumlu ama işsiz →
 * kayıp (dördüncü kova: "koşumlu ama işsiz doff"). Koşum satırı yoksa da kayıp
 * sayılır — bu yol replay'de koşar, koşum o arada silinmiş/geri alınmış olabilir
 * ve uyarı susmamalıdır.
 */
export async function deriveRunWarnings(machineRunId: string | null | undefined): Promise<string[]> {
  if (!machineRunId) return [WARN_RUN_MISSING];
  const run = await prisma.machineRun.findUnique({ where: { id: machineRunId }, select: { weavingOrderId: true } });
  return run?.weavingOrderId ? [] : [WARN_RUN_WITHOUT_ORDER];
}

/**
 * Sıradaki indirme kodu — 8029 kilidi bu fonksiyonun İLK ifadesidir; çağıran
 * tx'te bundan önce başka ifade koşturmaz (`nextWeavingOrderNumberTx` emsali).
 */
export async function nextDoffCodeTx(tx: Prisma.TransactionClient, date: Date): Promise<string> {
  const prefix = dailyCodePrefix(DOFF_CODE_PREFIX, date);
  await lockCodeScopeTx(tx, DOFF_CODE_SCOPE, prefix);
  const codes = await tx.doffEvent.findMany({
    where: { code: { gte: prefix, startsWith: prefix } },
    select: { code: true },
  });
  return buildDailyCode(DOFF_CODE_PREFIX, nextDailySeq(codes.map((c) => c.code), prefix), date);
}
