// İŞLEM KİMLİĞİ (clientToken) — tek boğaz (kök `tokenReplay` sözleşmesinin bulut karşılığı).
// Sıra (tek tx): kiracı + kilit (İLK ifade) → makbuz okuması → VARSA tekrar (iş kuralı yeniden KOŞMAZ,
// cevap makbuzdan) → YOKSA eylem + makbuz AYNI tx'te → COMMIT sonrası denetim (best-effort).
// Gövde kapısı: aynı kimlik başka hesap/eylem/gövdeyle gelirse 409 ISLEM_KIMLIGI_CAKISTI.
// Sır alanları gövde özetine GİRMEZ; saklanan yanıt sırsızdır (`stored`).
import { createHash } from "node:crypto";
import type { OperationReceipt, Prisma } from "@prisma/client";
import { recordAudit, type AuditEntry } from "./audit";
import type { Tx } from "./db";
import { CloudError } from "./errors";
import type { LockSpec } from "./locks";
import { isUniqueViolation } from "./prisma-errors";
import { withTesis } from "./tenant";
import type { TesisDbRouter } from "./tesis-db";

/** Gövde özetine ve hiçbir kayda girmeyen alanlar. */
export const SECRET_BODY_KEYS: ReadonlySet<string> = new Set(["parola", "mevcutParola", "yeniParola", "totp", "davet"]);

export interface WriteSpec<R> {
  readonly tesisId: string;
  readonly accountId: string;
  readonly action: string;
  readonly clientToken: string;
  readonly body: object;
  readonly lock: LockSpec;
  /** Eylemin okuyacağı projeksiyonlar (RLS alan izni; ör. rapor sonucu önbelleği). */
  readonly projections?: readonly string[];
  readonly run: (tx: Tx) => Promise<R>;
  /** Canlı yanıt; `stored` verilirse tekrar yanıtı odur (sır taşıyan alan orada olmaz). */
  readonly respond: (result: R) => { readonly data: unknown; readonly stored?: unknown; readonly status?: number };
  readonly audit?: (result: R) => readonly Omit<AuditEntry, "tesisId">[];
}

export interface WriteResult {
  readonly status: number;
  readonly data: unknown;
  readonly replayed: boolean;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value).sort()) {
      if (SECRET_BODY_KEYS.has(k) || k === "clientToken") continue;
      out[k] = canonical((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

/** Gövdenin sırsız, anahtar sırasından bağımsız özeti (hex sha256). */
export function bodyDigestOf(body: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(body)), "utf8").digest("hex");
}

/** Date → ISO: canlı yanıt ile saklanan yanıt aynı biçimde çıksın. */
export function toPlainJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function replay(row: OperationReceipt, spec: Pick<WriteSpec<unknown>, "accountId" | "action">, digest: string): WriteResult {
  if (row.accountId !== spec.accountId || row.action !== spec.action || row.bodyDigest !== digest) {
    throw new CloudError(409, "ISLEM_KIMLIGI_CAKISTI", "Bu işlem kimliği başka bir istekte kullanılmış; formu kapatıp yeniden açarak tekrar gönderin");
  }
  return { status: row.responseStatus, data: row.response, replayed: true };
}

type Outcome<R> = { readonly kind: "replay"; readonly row: OperationReceipt } | { readonly kind: "done"; readonly result: R; readonly status: number; readonly data: unknown };

export async function executeWrite<R>(db: TesisDbRouter, spec: WriteSpec<R>): Promise<WriteResult> {
  const digest = bodyDigestOf(spec.body);
  let outcome: Outcome<R>;
  try {
    outcome = await withTesis(db, { tesisId: spec.tesisId, lock: spec.lock, projections: spec.projections }, async (tx): Promise<Outcome<R>> => {
      const prior = await tx.operationReceipt.findUnique({ where: { tesisId_clientToken: { tesisId: spec.tesisId, clientToken: spec.clientToken } } });
      if (prior) return { kind: "replay", row: prior };
      const result = await spec.run(tx);
      const r = spec.respond(result);
      const status = r.status ?? 200;
      const data = toPlainJson(r.data);
      await tx.operationReceipt.create({
        data: {
          tesisId: spec.tesisId,
          clientToken: spec.clientToken,
          accountId: spec.accountId,
          action: spec.action,
          bodyDigest: digest,
          responseStatus: status,
          response: r.stored === undefined ? data : toPlainJson(r.stored),
        },
      });
      return { kind: "done", result, status, data };
    });
  } catch (err) {
    // Kilit aynı kimliği sıraya soktuğundan nadir; yine de düşerse cevap makbuzdan gelir.
    if (!isUniqueViolation(err)) throw err;
    const row = await withTesis(db, { tesisId: spec.tesisId }, (tx) =>
      tx.operationReceipt.findUnique({ where: { tesisId_clientToken: { tesisId: spec.tesisId, clientToken: spec.clientToken } } }),
    );
    if (!row) throw err;
    return replay(row, spec, digest);
  }
  if (outcome.kind === "replay") return replay(outcome.row, spec, digest);
  for (const e of spec.audit?.(outcome.result) ?? []) await recordAudit(db, { ...e, tesisId: spec.tesisId });
  return { status: outcome.status, data: outcome.data, replayed: false };
}
