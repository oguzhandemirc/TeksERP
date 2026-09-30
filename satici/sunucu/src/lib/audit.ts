// Denetim (audit) — AYAK İZİ. İş kararı buradan okunmaz; yazım best-effort ve tx DIŞINDA.
// Özet alanına sır girmez: parola, özel anahtar, etkinleştirme kodunun düz metni, imzalı belge.
// ERİŞİM (Cloudflare Access) kapsamında yazılan HER satırın özetine Access e-postası (`erisimKimligi`) eklenir.
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { currentScope } from "./request-scope";

let failures = 0;

export function auditFailureCount(): number {
  return failures;
}

function withAccessIdentity(summary: Prisma.InputJsonValue | undefined, email: string): Prisma.InputJsonValue {
  if (summary === undefined) return { erisimKimligi: email };
  if (typeof summary === "object" && summary !== null && !Array.isArray(summary)) return { ...(summary as Prisma.InputJsonObject), erisimKimligi: email };
  return { deger: summary, erisimKimligi: email };
}

export async function recordAudit(entry: {
  readonly event: string;
  readonly entity: string;
  readonly entityId?: string | null;
  readonly actor: string;
  readonly summary?: Prisma.InputJsonValue;
}): Promise<void> {
  const scope = currentScope();
  if (scope) scope.audits++;
  const email = scope?.origin === "ERISIM" ? scope.accessEmail : undefined;
  const summary = email === undefined ? entry.summary : withAccessIdentity(entry.summary, email);
  try {
    await prisma.denetim.create({
      data: {
        olay: entry.event,
        varlik: entry.entity,
        varlikId: entry.entityId ?? null,
        yapan: entry.actor,
        ...(summary === undefined ? {} : { ozet: summary }),
      },
    });
  } catch (err) {
    failures++;
    console.error(`[satici] denetim yazılamadı (${entry.event}): ${(err as Error).message}`);
  }
}
