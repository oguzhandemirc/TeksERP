// Denetim (audit) — AYAK İZİ. İş kararı buradan okunmaz; yazım best-effort ve tx DIŞINDA.
// Özet alanına sır girmez: parola, özel anahtar, etkinleştirme kodunun düz metni, imzalı belge.
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

let failures = 0;

export function auditFailureCount(): number {
  return failures;
}

export async function recordAudit(entry: {
  readonly event: string;
  readonly entity: string;
  readonly entityId?: string | null;
  readonly actor: string;
  readonly summary?: Prisma.InputJsonValue;
}): Promise<void> {
  try {
    await prisma.denetim.create({
      data: {
        olay: entry.event,
        varlik: entry.entity,
        varlikId: entry.entityId ?? null,
        yapan: entry.actor,
        ...(entry.summary === undefined ? {} : { ozet: entry.summary }),
      },
    });
  } catch (err) {
    failures++;
    console.error(`[satici] denetim yazılamadı (${entry.event}): ${(err as Error).message}`);
  }
}
