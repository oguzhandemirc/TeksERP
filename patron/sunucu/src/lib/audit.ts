// Bulut denetimi (`account_audit`) — AYAK İZİ, defter değil: iş kararı buradan okunmaz; yazım
// best-effort ve iş tx'inin DIŞINDA (kendi kiracı kapsamında). Özete sır girmez: parola, TOTP,
// davet/oturum belirteci, gelen kutusu gövdesi, projeksiyon verisi.
import type { Prisma } from "@prisma/client";
import { withTesis } from "./tenant";
import type { TesisDbRouter } from "./tesis-db";

let failures = 0;

export function auditFailureCount(): number {
  return failures;
}

export interface AuditEntry {
  readonly tesisId: string;
  readonly actor: string;
  readonly event: string;
  readonly entity: string;
  readonly entityId?: string | null;
  readonly summary?: Prisma.InputJsonValue;
}

export async function recordAudit(db: TesisDbRouter, entry: AuditEntry): Promise<void> {
  try {
    await withTesis(db, { tesisId: entry.tesisId }, (tx) =>
      tx.accountAudit.create({
        data: {
          tesisId: entry.tesisId,
          actor: entry.actor,
          event: entry.event,
          entity: entry.entity,
          entityId: entry.entityId ?? null,
          ...(entry.summary === undefined ? {} : { summary: entry.summary }),
        },
      }),
    );
  } catch (err) {
    failures++;
    console.error(`[patron] denetim yazılamadı (${entry.event}): ${(err as Error).message}`);
  }
}

/** Aktör biçimi: `hesap:<id>` · `satici-cli` · `fabrika:<kurulumId>` · `sistem`. */
export const accountActor = (accountId: string): string => `hesap:${accountId}`;
