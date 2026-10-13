// =============================================================================
// DOFF KAYDI — koşum uyarıları (tek kaynak) + indirme kodu (sayaç satırı)
// =============================================================================
// İki şeyi servisten ayırır ki iki yol aynı cevabı versin:
//   • `deriveRunWarnings` — "iş emri metresine GİRMİYOR" uyarısı hem ilk kayıtta
//     hem REPLAY'de döner. Çevrimdışı yeniden gönderimde operatörün gördüğü tek
//     cevap replay cevabıdır; uyarı orada susarsa kayıp görünmez olur
//     (DOKUMA-IS-EMRI-VE-TABLET-TASARIMI §3.8 "sessiz atlama görünmezliktir").
//   • `reserveDoffCode` — günlük sıra sayaç satırından (`number_series_counters`),
//     tx AÇILMADAN ÖNCE tek ifadeyle (Perf-4 B-03). Eski yol 8029 altında günün
//     bütün kodlarını tarıyordu ve kilit commit'e kadar sürüyordu (doff-50 p95
//     484 ms). Retry yalnız `code_key` P2002 kemeri kalır (kapsam değişimi anı).
// =============================================================================
import prisma from "../../lib/prisma";
import { reserveSeriesNo } from "./series-counter-store.helper";

/** Fiziksel etiket kodu: `DF` + GGAAYY + NNNN (≤ 32). */
export const DOFF_CODE_PREFIX = "DF";
export const WARN_RUN_MISSING = "Koşum açılmadığı için bu indirme dokuma iş emri metresine GİRMİYOR.";
export const WARN_RUN_WITHOUT_ORDER = "Koşum bir dokuma iş emrine bağlı değil — bu indirme dokuma iş emri metresine GİRMİYOR.";

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
 * Sıradaki indirme kodu — tx DIŞINDA çağrılır (taban `prisma`); tx geri dönerse
 * numara boşta kalır (boşluk serbest, tekillik `doff_events_code_key`). Tohum
 * okuması en yeni önce sıralı: sarmalı seride sayacın kaynağı en son doğan koddur.
 */
export async function reserveDoffCode(date: Date): Promise<string> {
  return reserveSeriesNo(
    "doffEvent",
    date,
    async (prefix) =>
      prisma.doffEvent.findMany({
        where: { code: { gte: prefix, startsWith: prefix } },
        select: { code: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      }),
    async (code) => (await prisma.doffEvent.findUnique({ where: { code }, select: { id: true } })) !== null,
  );
}
