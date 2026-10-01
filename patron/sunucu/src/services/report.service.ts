// RAPOR İSTEĞİ (sözleşme §7) — bulut hesap yapmaz: özel aralıklı rapor FABRİKADA hesaplanır.
// Hesap isteği yazar (BEKLIYOR) → zil `rapor` → fabrika `POST /v1/rapor/al` ile ATOMİK claim eder
// (HESAPLANIYOR, claim süresi) → kendi rapor servisi + kendi Zod'uyla yeniden doğrular → `POST
// /v1/rapor/sonuc` (HAZIR | HATA). Aynı parametreyle 5 dk içindeki ikinci istek mevcut sonuçtan
// cevaplanır. Yetki RAPOR BAŞINA: `bulut:rapor:oku` + anahtarın izni (+ fabrikanın beyanı daha darsa o da);
// sonuç rapor başına RLS adıyla (`rapor.<aile>-<ad>`) korunur.
import type { Prisma, ReportRequest } from "@prisma/client";
import type { z } from "zod";
import type { SessionContext } from "../auth/session.service";
import type { CloudPermission } from "../catalog/permissions";
import { reportProjectionName, reportVerdict, requiredReportPermissions } from "../catalog/reports";
import { accountActor, recordAudit } from "../lib/audit";
import { CloudError, badRequest, forbidden, notFound, stateConflict } from "../lib/errors";
import { bodyDigestOf, executeWrite, toPlainJson, type WriteResult } from "../lib/idempotency";
import { NO_TENANT, withTesis } from "../lib/tenant";
import type { ReportClaimRequestSchema, ReportClaimResponse, ReportResult, ReportResultResponse } from "../wire/esitleme";
import type { ReportRequest as ReportRequestWire, ReportRequestDetail } from "../wire/api";
import type { CloudContext } from "./context";
import { assertFacilityCloudOpen } from "./facility-gate";
import type { FactoryCaller } from "./installation-auth";

const DEDUPE_WINDOW_MS = 5 * 60_000;
const MAX_PARAMS_BYTES = 8 * 1024;

function requestView(r: ReportRequest): ReportRequestWire {
  return {
    id: r.id,
    raporAnahtari: r.reportKey,
    aile: r.family,
    parametreler: r.params,
    durum: r.status,
    hataKodu: r.errorCode,
    olusturulma: r.createdAt.toISOString(),
    tamamlanma: r.completedAt?.toISOString() ?? null,
  };
}

/** Fabrikanın gönderdiği rapor kataloğundaki girdi (`rapor-katalogu` anlık kaydı: `{raporlar: [{anahtar, izin}]}`); yoksa null. */
async function catalogEntry(ctx: CloudContext, tesisId: string, key: string): Promise<{ readonly izin?: unknown } | null> {
  const row = await withTesis(ctx.app, { tesisId, projections: ["rapor-katalogu"] }, (tx) =>
    tx.projectionRow.findUnique({ where: { tesisId_projection_recordId: { tesisId, projection: "rapor-katalogu", recordId: NO_TENANT } } }),
  );
  const list = (row?.data as { raporlar?: unknown } | null)?.raporlar;
  if (!Array.isArray(list)) return null;
  const hit: unknown = list.find((r) => typeof r === "object" && r !== null && (r as { anahtar?: unknown }).anahtar === key);
  return hit && typeof hit === "object" ? (hit as { izin?: unknown }) : null;
}

const hasAll = (s: SessionContext, required: readonly CloudPermission[] | null): boolean => required !== null && required.every((p) => s.permissions.has(p));

export interface ReportCreateInput {
  readonly clientToken: string;
  readonly raporAnahtari: string;
  readonly parametreler: Readonly<Record<string, unknown>>;
}

export async function createReportRequest(ctx: CloudContext, s: SessionContext, input: ReportCreateInput): Promise<WriteResult> {
  const verdict = reportVerdict(input.raporAnahtari);
  if (!verdict.ok) {
    if (verdict.reason === "BICIM") throw badRequest("Rapor anahtarı biçimsiz");
    if (verdict.reason === "BULUTTA_YOK") throw new CloudError(404, "RAPOR_BULUTTA_YOK", "Bu rapor patron bulutunda sunulmuyor");
    throw new CloudError(404, "RAPOR_BILINMIYOR", "Rapor patron bulutunda tanınmıyor");
  }
  if (!hasAll(s, requiredReportPermissions(verdict.permission, undefined))) throw forbidden("Bu raporu isteme yetkiniz yok");
  if (Buffer.byteLength(JSON.stringify(input.parametreler), "utf8") > MAX_PARAMS_BYTES) throw badRequest("Rapor parametreleri çok büyük");
  const nowMs = ctx.now();
  await assertFacilityCloudOpen(ctx, s.tesisId, nowMs);
  const entry = await catalogEntry(ctx, s.tesisId, input.raporAnahtari);
  if (!entry) throw new CloudError(404, "RAPOR_BILINMIYOR", "Rapor fabrikanın rapor kataloğunda yok (katalog henüz eşitlenmemiş olabilir)");
  if (!hasAll(s, requiredReportPermissions(verdict.permission, entry.izin))) throw forbidden("Bu raporu isteme yetkiniz yok");
  const paramsDigest = bodyDigestOf(input.parametreler);
  const params = toPlainJson(input.parametreler);
  const result = await executeWrite(ctx.app, {
    tesisId: s.tesisId,
    accountId: s.accountId,
    action: "RAPOR_ISTEGI",
    clientToken: input.clientToken,
    body: { raporAnahtari: input.raporAnahtari, parametreler: input.parametreler },
    lock: { name: "CLIENT_TOKEN", key: `${s.tesisId}:${input.clientToken}` },
    projections: [verdict.projection],
    run: async (tx) => {
      const recent = await tx.reportResult.findFirst({
        where: { tesisId: s.tesisId, reportKey: input.raporAnahtari, paramsDigest, computedAt: { gte: new Date(nowMs - DEDUPE_WINDOW_MS) } },
        orderBy: [{ computedAt: "desc" }, { id: "desc" }],
      });
      return tx.reportRequest.create({
        data: {
          tesisId: s.tesisId,
          accountId: s.accountId,
          reportKey: input.raporAnahtari,
          family: verdict.family,
          params,
          paramsDigest,
          ...(recent ? { status: "HAZIR", resultId: recent.id, completedAt: new Date(nowMs) } : {}),
        },
      });
    },
    respond: (r) => ({ status: 201, data: requestView(r) }),
    audit: (r) => [{ actor: accountActor(s.accountId), event: "RAPOR_ISTEGI", entity: "ReportRequest", entityId: r.id, summary: { rapor: r.reportKey, durum: r.status } }],
  });
  if (!result.replayed && (result.data as { durum?: string }).durum === "BEKLIYOR") ctx.doorbell.ring(s.tesisId, "rapor");
  return result;
}

function visibility(s: SessionContext): Prisma.ReportRequestWhereInput {
  return s.permissions.has("bulut:hesap:yonet") ? { tesisId: s.tesisId } : { tesisId: s.tesisId, accountId: s.accountId };
}

export async function listReportRequests(ctx: CloudContext, s: SessionContext, q: { cursor?: string; limit: number }) {
  const rows = await withTesis(ctx.app, { tesisId: s.tesisId }, (tx) =>
    tx.reportRequest.findMany({ where: visibility(s), orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: q.limit + 1, ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}) }),
  );
  const page = rows.slice(0, q.limit);
  return { kayitlar: page.map(requestView), sonraki: rows.length > q.limit ? page[page.length - 1]!.id : null };
}

/** İstek + (HAZIR ise) sonuç. Sonuç RLS'le korunur: raporun izni yoksa satır görünmez; karar da rapor başınadır. */
export async function getReportRequest(ctx: CloudContext, s: SessionContext, id: string): Promise<ReportRequestDetail> {
  const out = await withTesis(ctx.app, { tesisId: s.tesisId, projections: s.projections }, async (tx) => {
    const r = await tx.reportRequest.findFirst({ where: { ...visibility(s), id } });
    if (!r) return null;
    const result = r.resultId ? await tx.reportResult.findUnique({ where: { id: r.resultId } }) : null;
    return { r, result };
  });
  if (!out) throw notFound("Rapor isteği");
  const verdict = reportVerdict(out.r.reportKey);
  const allowed = verdict.ok && hasAll(s, requiredReportPermissions(verdict.permission, (await catalogEntry(ctx, s.tesisId, out.r.reportKey))?.izin));
  return {
    ...requestView(out.r),
    sonuc: allowed && out.result ? { veri: out.result.data, hesaplandi: out.result.computedAt.toISOString(), kaynakUfuk: out.result.sourceHorizon?.toISOString() ?? null } : null,
  };
}

export async function cancelReportRequest(ctx: CloudContext, s: SessionContext, id: string) {
  const nowMs = ctx.now();
  const out = await withTesis(ctx.app, { tesisId: s.tesisId }, async (tx) => {
    const claimed = await tx.reportRequest.updateMany({ where: { id, tesisId: s.tesisId, accountId: s.accountId, status: "BEKLIYOR" }, data: { status: "IPTAL", cancelledAt: new Date(nowMs) } });
    const fresh = await tx.reportRequest.findFirst({ where: { id, tesisId: s.tesisId, accountId: s.accountId } });
    if (!fresh) throw notFound("Rapor isteği");
    if (claimed.count === 0 && fresh.status !== "IPTAL") throw stateConflict("Rapor isteği artık iptal edilemez", { durum: fresh.status });
    return { fresh, changed: claimed.count > 0 };
  });
  if (out.changed) await recordAudit(ctx.app, { tesisId: s.tesisId, actor: accountActor(s.accountId), event: "RAPOR_IPTAL", entity: "ReportRequest", entityId: id });
  return requestView(out.fresh);
}

// ---------------------------------------------------------------- fabrika tarafı

interface ClaimedReport {
  id: string;
  report_key: string;
  params: unknown;
  created_at: Date;
}

/** Saklı parametreler yazılırken nesne olarak doğrulandı; jsonb okuması tipsiz döner. */
function paramsObject(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v)) : {};
}

export async function claimReports(ctx: CloudContext, caller: FactoryCaller, req: z.infer<typeof ReportClaimRequestSchema>, nowMs: number): Promise<ReportClaimResponse> {
  const until = new Date(nowMs + ctx.config.RAPOR_CLAIM_DK * 60_000);
  const rows = await withTesis(ctx.sync, { tesisId: caller.tesisId }, (tx) =>
    tx.$queryRaw<ClaimedReport[]>`
      WITH picked AS MATERIALIZED (
        SELECT id FROM report_requests
         WHERE tesis_id = ${caller.tesisId}::uuid AND status = 'BEKLIYOR'
         ORDER BY created_at, id LIMIT ${req.enFazla}
         FOR UPDATE SKIP LOCKED)
      UPDATE report_requests AS t
         SET status = 'HESAPLANIYOR', owner_installation_id = ${caller.installation.installationId}::uuid,
             claim_until = ${until}::timestamptz, claim_count = t.claim_count + 1, updated_at = now()
        FROM picked WHERE t.id = picked.id
      RETURNING t.id, t.report_key, t.params, t.created_at`,
  );
  rows.sort((a, b) => a.created_at.getTime() - b.created_at.getTime() || a.id.localeCompare(b.id));
  return { v: 1 as const, istekler: rows.map((r) => ({ istekId: r.id, raporAnahtari: r.report_key, parametreler: paramsObject(r.params), olusturulma: r.created_at.toISOString() })) };
}

/**
 * Standart görüntü (S13 — `istekId: null`): fabrikanın saatlik ürettiği sonuç `report_results`e yazılır; aynı
 * parametre özetiyle gelen hesap isteği oradan cevaplanır. HATA'lı standart görüntü saklanmaz (son iyi sonuç kalır).
 */
async function recordStandardResult(ctx: CloudContext, caller: FactoryCaller, req: ReportResult): Promise<ReportResultResponse> {
  const verdict = reportVerdict(req.raporAnahtari);
  if (!verdict.ok) throw new CloudError(404, "RAPOR_BILINMIYOR", "Bu rapor patron bulutunda sunulmuyor");
  if (req.durum === "HATA") return { v: 1, kabul: true, durum: "HATA" };
  await withTesis(ctx.sync, { tesisId: caller.tesisId, projections: [verdict.projection] }, (tx) =>
    tx.reportResult.create({
      data: {
        tesisId: caller.tesisId,
        reportKey: req.raporAnahtari,
        projection: verdict.projection,
        paramsDigest: bodyDigestOf(req.parametreler),
        data: toPlainJson(req.veri),
        computedAt: new Date(req.hesaplandi),
        sourceHorizon: new Date(req.kaynakUfuk),
      },
    }),
  );
  return { v: 1, kabul: true, durum: "HAZIR" };
}

export async function recordReportResult(ctx: CloudContext, caller: FactoryCaller, req: ReportResult, nowMs: number): Promise<ReportResultResponse> {
  if (req.istekId === null) return recordStandardResult(ctx, caller, req);
  const istekId = req.istekId;
  const scope = { tesisId: caller.tesisId };
  const request = await withTesis(ctx.sync, scope, (tx) => tx.reportRequest.findFirst({ where: { id: istekId, tesisId: caller.tesisId } }));
  if (!request) throw notFound("Rapor isteği");
  if (request.reportKey !== req.raporAnahtari) throw badRequest("Rapor sonucu isteğin rapor anahtarıyla uyuşmuyor");
  const mine = request.ownerInstallationId === caller.installation.installationId;
  if (request.status !== "HESAPLANIYOR") {
    if (mine && (request.status === "HAZIR" || request.status === "HATA")) return { v: 1 as const, kabul: true, durum: request.status };
    throw stateConflict("Rapor isteği hesaplanmayı beklemiyor", { durum: request.status });
  }
  const projection = reportProjectionName(request.reportKey);
  const status = await withTesis(ctx.sync, { ...scope, projections: [projection] }, async (tx) => {
    const resultId =
      req.durum === "HAZIR"
        ? (
            await tx.reportResult.create({
              data: {
                tesisId: caller.tesisId,
                reportKey: request.reportKey,
                projection,
                paramsDigest: request.paramsDigest,
                data: toPlainJson(req.veri),
                computedAt: new Date(req.hesaplandi),
                sourceHorizon: new Date(req.kaynakUfuk),
              },
            })
          ).id
        : null;
    const claimed = await tx.reportRequest.updateMany({
      where: { id: request.id, tesisId: caller.tesisId, status: "HESAPLANIYOR", ownerInstallationId: caller.installation.installationId },
      data: { status: req.durum, resultId, errorCode: req.durum === "HATA" ? req.hataKodu! : null, claimUntil: null, completedAt: new Date(nowMs) },
    });
    if (claimed.count === 0) throw stateConflict("Rapor isteğinin sahipliği düştü (claim süresi doldu)");
    return req.durum;
  });
  return { v: 1 as const, kabul: true, durum: status };
}

