// =============================================================================
// JOB STATE — zamanlanmış işin son durumu (`JobState`, iş başına tek satır)
// =============================================================================
// Süpürücü gibi işler sonucu bellekte tutuyordu: reboot'ta "henüz koşmadı"ya
// dönüyor, panel yalnız SON turu görüyordu — "3 saattir mi 3 gündür mü düşüyor"
// sorusunun cevabı yoktu (19.09 internet kesintisi, 2 tur sessiz). Bu helper
// son başarıyı ve ardışık hata sayısını kalıcı satıra yazar; bayatlık kararı
// `offsite-state.helper.ts`te (saf, DB'siz) yaşar, panel yalnız sonucu gösterir.
// =============================================================================
import type { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import type { JobStateSnapshot } from "./offsite-state.helper";

export interface JobRunOutcome {
  ok: boolean;
  /** Başarısızlıkta kısa neden — 1000 karakterde kesilir (kolon sınırı). */
  error?: string | null;
  /** Son koşumun özet sonucu (sayılar/uyarılar); şema işe göre değişir. */
  result?: Prisma.InputJsonValue;
}

const LAST_ERROR_MAX = 1000;

/** Koşum sonucunu yazar. Tek process + iş içi yeniden-giriş kilidi ⇒ yarış yok. */
export async function recordJobRun(job: string, outcome: JobRunOutcome, now = new Date()): Promise<void> {
  const error = outcome.ok ? null : (outcome.error ?? "bilinmeyen hata").slice(0, LAST_ERROR_MAX);
  await prisma.jobState.upsert({
    where: { job },
    create: {
      job,
      lastRunAt: now,
      lastOkAt: outcome.ok ? now : null,
      lastError: error,
      consecutiveFailures: outcome.ok ? 0 : 1,
      lastResult: outcome.result,
    },
    update: {
      lastRunAt: now,
      lastError: error,
      lastResult: outcome.result,
      ...(outcome.ok
        ? { lastOkAt: now, consecutiveFailures: 0 }
        : { consecutiveFailures: { increment: 1 } }),
    },
  });
}

export async function readJobState(job: string): Promise<JobStateSnapshot | null> {
  const row = await prisma.jobState.findUnique({
    where: { job },
    select: { lastRunAt: true, lastOkAt: true, lastError: true, consecutiveFailures: true },
  });
  return row ?? null;
}
