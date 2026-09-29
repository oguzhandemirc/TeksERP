// GELEN KUTUSU (sözleşme §8) — buluttaki TEK yazma kanalı: hesap bir MESAJ bırakır, fabrika çeker ve
// kendi normal servis yolundan yazar (bulut fabrika satırı DEĞİŞTİREMEZ). Durum makinesi, hepsi
// atomik claim (`updateMany WHERE {…, beklenen durum}` + count 0 → taze okuma):
//   BEKLIYOR ─(yazar iptal)→ IPTAL · BEKLIYOR ─(fabrika al)→ ISLENIYOR ─(fabrika sonuç)→ ISLENDI|REDDEDILDI
//   ISLENIYOR ─(claim süresi doldu, bakım)→ BEKLIYOR (fabrikanın makbuzu tekrar işlemeyi idempotent kılar)
// `mesajId` istemcinin işlem kimliğidir (clientToken) — tekrarı makbuzdan cevaplanır.
import type { InboxMessage, Prisma } from "@prisma/client";
import { accountActor, recordAudit } from "../lib/audit";
import { CloudError, forbidden, notFound, stateConflict } from "../lib/errors";
import { executeWrite, type WriteResult } from "../lib/idempotency";
import { withTesis } from "../lib/tenant";
import type { InboxMessage as InboxMessageWire } from "../wire/api";
import { CustomerMessageSchema, OrderMessageSchema, type InboxClaimRequestSchema, type InboxClaimResponse, type InboxResultRequestSchema, type InboxResultResponse } from "../wire/esitleme";
import type { z } from "zod";
import type { SessionContext } from "../auth/session.service";
import type { CloudContext } from "./context";
import { assertFacilityCloudOpen } from "./facility-gate";
import type { FactoryCaller } from "./installation-auth";

export const INBOX_WRITE_PERMISSION = { SIPARIS: "bulut:siparis:yaz", CARI: "bulut:cari:yaz" } as const;

export interface InboxCreateInput {
  readonly mesajId: string;
  readonly tur: "SIPARIS" | "CARI";
  readonly govde: unknown;
}

function messageView(m: InboxMessage): InboxMessageWire {
  return {
    mesajId: m.messageId,
    tur: m.kind,
    durum: m.status,
    govde: m.body,
    hesapAdi: m.accountName,
    sonuc: m.result,
    olusturulma: m.createdAt.toISOString(),
    islenme: m.processedAt?.toISOString() ?? null,
    iptal: m.cancelledAt?.toISOString() ?? null,
  };
}

function parseBody(tur: InboxCreateInput["tur"], govde: unknown): Prisma.InputJsonValue {
  const schema = tur === "SIPARIS" ? OrderMessageSchema : CustomerMessageSchema;
  const r = schema.safeParse(govde);
  if (!r.success) {
    const first = r.error.issues[0];
    const where = first && first.path.length > 0 ? ` (${first.path.join(".")})` : "";
    throw new CloudError(400, "GOVDE_GECERSIZ", `Mesaj gövdesi sözleşmeye uymuyor${where}: ${first?.message ?? "bilinmiyor"}`);
  }
  return r.data as Prisma.InputJsonValue;
}

export async function createInboxMessage(ctx: CloudContext, s: SessionContext, input: InboxCreateInput): Promise<WriteResult> {
  if (!s.permissions.has(INBOX_WRITE_PERMISSION[input.tur])) throw forbidden("Bu mesaj türünü yazma yetkiniz yok");
  const body = parseBody(input.tur, input.govde);
  const nowMs = ctx.now();
  await assertFacilityCloudOpen(ctx, s.tesisId, nowMs);
  const result = await executeWrite(ctx.app, {
    tesisId: s.tesisId,
    accountId: s.accountId,
    action: `GELEN_KUTUSU_${input.tur}`,
    clientToken: input.mesajId,
    body: { tur: input.tur, govde: body },
    lock: { name: "CLIENT_TOKEN", key: `${s.tesisId}:${input.mesajId}` },
    run: (tx) =>
      tx.inboxMessage.create({
        data: { tesisId: s.tesisId, messageId: input.mesajId, kind: input.tur, body, accountId: s.accountId, accountName: s.accountName },
      }),
    respond: (m) => ({ status: 201, data: messageView(m) }),
    audit: (m) => [{ actor: accountActor(s.accountId), event: "GELEN_KUTUSU_YAZILDI", entity: "InboxMessage", entityId: m.messageId, summary: { tur: m.kind } }],
  });
  if (!result.replayed) ctx.doorbell.ring(s.tesisId, "gelen-kutusu");
  return result;
}

/** Yazar yalnız kendi mesajını görür; hesap yöneticisi tesisin bütün mesajlarını. */
function visibility(s: SessionContext): Prisma.InboxMessageWhereInput {
  return s.permissions.has("bulut:hesap:yonet") ? { tesisId: s.tesisId } : { tesisId: s.tesisId, accountId: s.accountId };
}

export async function listInbox(ctx: CloudContext, s: SessionContext, q: { durum?: InboxMessage["status"]; cursor?: string; limit: number }) {
  const rows = await withTesis(ctx.app, { tesisId: s.tesisId }, (tx) =>
    tx.inboxMessage.findMany({
      where: { ...visibility(s), ...(q.durum ? { status: q.durum } : {}) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    }),
  );
  const page = rows.slice(0, q.limit);
  return { kayitlar: page.map(messageView), sonraki: rows.length > q.limit ? page[page.length - 1]!.id : null };
}

export async function getInbox(ctx: CloudContext, s: SessionContext, messageId: string) {
  const m = await withTesis(ctx.app, { tesisId: s.tesisId }, (tx) => tx.inboxMessage.findFirst({ where: { ...visibility(s), messageId } }));
  if (!m) throw notFound("Mesaj");
  return messageView(m);
}

/** Yazar yalnız BEKLIYOR iken iptal eder (atomik claim). Zaten iptal edilmişse aynı sonuç (idempotent). */
export async function cancelInbox(ctx: CloudContext, s: SessionContext, messageId: string) {
  const nowMs = ctx.now();
  const m = await withTesis(ctx.app, { tesisId: s.tesisId }, async (tx) => {
    const claimed = await tx.inboxMessage.updateMany({
      where: { tesisId: s.tesisId, messageId, accountId: s.accountId, status: "BEKLIYOR" },
      data: { status: "IPTAL", cancelledAt: new Date(nowMs) },
    });
    const fresh = await tx.inboxMessage.findFirst({ where: { tesisId: s.tesisId, messageId, accountId: s.accountId } });
    if (!fresh) throw notFound("Mesaj");
    if (claimed.count === 0 && fresh.status !== "IPTAL") {
      throw stateConflict("Mesaj artık iptal edilemez (fabrika aldı ya da işledi)", { durum: fresh.status });
    }
    return { fresh, changed: claimed.count > 0 };
  });
  if (m.changed) {
    await recordAudit(ctx.app, { tesisId: s.tesisId, actor: accountActor(s.accountId), event: "GELEN_KUTUSU_IPTAL", entity: "InboxMessage", entityId: messageId });
  }
  return messageView(m.fresh);
}

// ---------------------------------------------------------------- fabrika tarafı (imzalı, eşitleme rolü)

interface ClaimedRow {
  message_id: string;
  kind: InboxMessage["kind"];
  body: unknown;
  account_id: string;
  account_name: string;
  created_at: Date;
}

export async function claimInbox(ctx: CloudContext, caller: FactoryCaller, req: z.infer<typeof InboxClaimRequestSchema>, nowMs: number): Promise<InboxClaimResponse> {
  const until = new Date(nowMs + ctx.config.GELEN_KUTUSU_CLAIM_DK * 60_000);
  const rows = await withTesis(ctx.sync, { tesisId: caller.tesisId }, (tx) =>
    tx.$queryRaw<ClaimedRow[]>`
      WITH picked AS MATERIALIZED (
        SELECT id FROM inbox_messages
         WHERE tesis_id = ${caller.tesisId}::uuid AND status = 'BEKLIYOR'
         ORDER BY created_at, id LIMIT ${req.enFazla}
         FOR UPDATE SKIP LOCKED)
      UPDATE inbox_messages AS t
         SET status = 'ISLENIYOR', owner_installation_id = ${caller.installation.installationId}::uuid,
             claim_until = ${until}::timestamptz, claim_count = t.claim_count + 1, updated_at = now()
        FROM picked WHERE t.id = picked.id
      RETURNING t.message_id, t.kind, t.body, t.account_id, t.account_name, t.created_at`,
  );
  rows.sort((a, b) => a.created_at.getTime() - b.created_at.getTime() || a.message_id.localeCompare(b.message_id));
  return {
    v: 1 as const,
    kayitlar: rows.map((r) => ({
      mesajId: r.message_id,
      tur: r.kind,
      govde: r.body,
      hesapId: r.account_id,
      hesapAdi: r.account_name,
      olusturulma: r.created_at.toISOString(),
    })),
  };
}

type ResultItem = z.infer<typeof InboxResultRequestSchema>["sonuclar"][number];

interface InboxOutcome {
  readonly varlikId: string | null;
  readonly belgeNo: string | null;
  readonly kod: string | null;
  readonly mesaj: string | null;
}

function resultJson(item: ResultItem): InboxOutcome {
  return { varlikId: item.varlikId ?? null, belgeNo: item.belgeNo ?? null, kod: item.kod ?? null, mesaj: item.mesaj ?? null };
}

/** Saklı sonuç aynı mı (jsonb anahtar sırası JSON metninden farklıdır — alan alan karşılaştırılır). */
function sameOutcome(stored: Prisma.JsonValue, wanted: InboxOutcome): boolean {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return false;
  const o = stored as Record<string, unknown>;
  return o.varlikId === wanted.varlikId && o.belgeNo === wanted.belgeNo && o.kod === wanted.kod && o.mesaj === wanted.mesaj;
}

export async function recordInboxResults(ctx: CloudContext, caller: FactoryCaller, req: z.infer<typeof InboxResultRequestSchema>, nowMs: number): Promise<InboxResultResponse> {
  const kabul: string[] = [];
  const ret: { mesajId: string; kod: "BULUNAMADI" | "DURUM_CAKISMASI"; durum: string | null }[] = [];
  await withTesis(ctx.sync, { tesisId: caller.tesisId }, async (tx) => {
    for (const item of req.sonuclar) {
      const result = resultJson(item);
      const claimed = await tx.inboxMessage.updateMany({
        where: { tesisId: caller.tesisId, messageId: item.mesajId, status: "ISLENIYOR", ownerInstallationId: caller.installation.installationId },
        data: { status: item.durum, result: { ...result }, processedAt: new Date(nowMs), claimUntil: null },
      });
      if (claimed.count === 1) {
        kabul.push(item.mesajId);
        continue;
      }
      const fresh = await tx.inboxMessage.findUnique({ where: { tesisId_messageId: { tesisId: caller.tesisId, messageId: item.mesajId } } });
      const sameAnswer = fresh && fresh.status === item.durum && fresh.ownerInstallationId === caller.installation.installationId && sameOutcome(fresh.result, result);
      if (sameAnswer) kabul.push(item.mesajId);
      else ret.push({ mesajId: item.mesajId, kod: fresh ? "DURUM_CAKISMASI" : "BULUNAMADI", durum: fresh?.status ?? null });
    }
  });
  return { v: 1 as const, kabul, ret };
}
