// PORTAL EYLEMİ — tek boğaz: işlem kimliği (clientToken) + eylem + denetim.
// Sıra: ① kilitsiz ön okuma (varsa yanıt kimlikten) → ② hazırlık tx DIŞINDA (ör. imza alt süreci)
// → ③ tx: kimlik kilidi (İLK ifade) → taze okuma → eylem → kimlik satırı (yanıtla) AYNI tx'te →
// ④ COMMIT sonrası denetim. Eylem ile kimlik satırı birlikte yazıldığından "yapıldı ama yanıtı
// kayboldu" durumu yoktur: aynı kimlikle tekrar aynı yanıtı alır, eylem ikinci kez koşmaz.
// Gövde kapısı: aynı kimlik başka kullanıcı/eylem/gövdeyle gelirse 409 ISLEM_KIMLIGI_CAKISTI.
// Sır alanları (parola, TOTP) gövde özetine GİRMEZ; saklanan yanıt sırsızdır (`stored`).
import { createHash } from "node:crypto";
import type { PortalIslemi, Prisma } from "@prisma/client";
import { recordAudit } from "../lib/audit";
import { VendorError } from "../lib/errors";
import { lockPortalToken } from "../lib/locks";
import { prisma, type Tx } from "../lib/prisma";
import { isUniqueViolation } from "../lib/prisma-errors";

/** Gövde özetine ve hiçbir kayda girmeyen alanlar. */
export const SECRET_BODY_KEYS: ReadonlySet<string> = new Set(["parola", "mevcutParola", "yeniParola", "kokParolasi", "imzaParolasi", "bayiParolasi", "totp"]);

export interface PortalActor {
  readonly userId: string;
  readonly actor: string;
}

export interface AuditEntry {
  readonly event: string;
  readonly entity: string;
  readonly entityId?: string | null;
  readonly summary?: Prisma.InputJsonValue;
}

export interface PortalActionSpec<P, R> {
  readonly action: string;
  readonly clientToken: string;
  readonly body: Readonly<Record<string, unknown>>;
  /** Tx DIŞINDA hazırlık (imza alt süreci gibi uzun iş); tekrar oynatmada HİÇ koşmaz. */
  readonly prepare?: () => Promise<P>;
  readonly run: (tx: Tx, prepared: P) => Promise<R>;
  /** Canlı yanıt; `stored` verilirse saklanan (tekrar) yanıt odur — sır taşıyan alan orada olmaz. */
  readonly respond: (result: R) => { readonly data: unknown; readonly stored?: unknown; readonly status?: number };
  readonly audit?: (result: R) => readonly AuditEntry[];
  /** Hazırlıkta açılan sırların sıfırlanması (her dalda koşar). */
  readonly release?: () => void;
}

export interface PortalActionResult {
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

/** Gövdenin sırsız, anahtar sırası bağımsız özeti. */
export function portalBodyDigest(body: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(body)), "utf8").digest("hex");
}

/** Date/Decimal → JSON biçimi: canlı yanıt ile saklanan yanıt aynı biçimde çıksın. */
export function toPlainJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function replay(row: PortalIslemi, who: PortalActor, action: string, digest: string): PortalActionResult {
  if (row.kullaniciId !== who.userId || row.eylem !== action || row.govdeOzeti !== digest) {
    throw new VendorError(
      409,
      "ISLEM_KIMLIGI_CAKISTI",
      "Bu işlem kimliği başka bir istekte kullanılmış; formu kapatıp yeniden açarak tekrar gönderin",
    );
  }
  return { status: row.yanitDurumu, data: row.yanit, replayed: true };
}

type Outcome<R> = { readonly kind: "replay"; readonly row: PortalIslemi } | { readonly kind: "done"; readonly result: R; readonly status: number; readonly data: unknown };

export async function executePortalAction<P, R>(who: PortalActor, spec: PortalActionSpec<P, R>): Promise<PortalActionResult> {
  const digest = portalBodyDigest(spec.body);
  try {
    const prior = await prisma.portalIslemi.findUnique({ where: { clientToken: spec.clientToken } });
    if (prior) return replay(prior, who, spec.action, digest);
    const prepared = (spec.prepare ? await spec.prepare() : undefined) as P;
    let outcome: Outcome<R>;
    try {
      outcome = await prisma.$transaction(async (tx): Promise<Outcome<R>> => {
        await lockPortalToken(tx, spec.clientToken);
        const again = await tx.portalIslemi.findUnique({ where: { clientToken: spec.clientToken } });
        if (again) return { kind: "replay", row: again };
        const result = await spec.run(tx, prepared);
        const r = spec.respond(result);
        const status = r.status ?? 200;
        const data = toPlainJson(r.data);
        await tx.portalIslemi.create({
          data: {
            clientToken: spec.clientToken,
            kullaniciId: who.userId,
            eylem: spec.action,
            govdeOzeti: digest,
            yanitDurumu: status,
            yanit: r.stored === undefined ? data : toPlainJson(r.stored),
          },
        });
        return { kind: "done", result, status, data };
      });
    } catch (err) {
      // Kilit aynı kimliği sıraya soktuğu için nadir: yine de düşerse cevap kimlikten gelir.
      if (isUniqueViolation(err)) {
        const row = await prisma.portalIslemi.findUnique({ where: { clientToken: spec.clientToken } });
        if (row) return replay(row, who, spec.action, digest);
      }
      throw err;
    }
    if (outcome.kind === "replay") return replay(outcome.row, who, spec.action, digest);
    for (const e of spec.audit?.(outcome.result) ?? []) {
      await recordAudit({ event: e.event, entity: e.entity, entityId: e.entityId ?? null, actor: who.actor, ...(e.summary === undefined ? {} : { summary: e.summary }) });
    }
    return { status: outcome.status, data: outcome.data, replayed: false };
  } finally {
    spec.release?.();
  }
}
