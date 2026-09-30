// FABRİKA KANALI (`/v1/*`) — yalnız kurulum imzalı istek (amaç `esitle`), eşitleme ROLÜYLE. Sıra her
// uçta aynı: HAM gövde (≤ 4 MB) → imza + nonce + hak kapısı → (gzip ise) aç → KATI şema → servis.
// Kiracı İMZADAN (kurulum kaydından) çözülür, gövdeden asla. Sıkıştırma ara katmanı yok.
import express, { type Request, type Response, type Router } from "express";
import type { z } from "zod";
import { PROTOCOL_VERSION, REQUEST_HEADER, isPlainObject } from "../lisans-protokol";
import { CloudError, badRequest } from "../lib/errors";
import { listAccountsForFactory, lockAccountFromFactory } from "../services/account.service";
import type { CloudContext } from "../services/context";
import { claimInbox, recordInboxResults } from "../services/inbox.service";
import { authenticateFactory, type FactoryCaller } from "../services/installation-auth";
import { claimReports, recordReportResult } from "../services/report.service";
import { applyPackage, decodeBody } from "../services/sync.service";
import {
  AccountLockRequestSchema,
  AccountsRequestSchema,
  InboxClaimRequestSchema,
  InboxResultRequestSchema,
  MAX_COMPRESSED_BYTES,
  ReportClaimRequestSchema,
  ReportResultRequestSchema,
  SYNC_PATHS,
} from "../wire/esitleme";
import { rateLimit } from "./rate-limit";
import { readRawBody } from "./raw-body";

interface FactoryRequest {
  readonly caller: FactoryCaller;
  readonly raw: Buffer;
  readonly nowMs: number;
}

async function authenticated(ctx: CloudContext, req: Request): Promise<FactoryRequest> {
  const raw = await readRawBody(req, MAX_COMPRESSED_BYTES);
  const nowMs = ctx.now();
  const caller = await authenticateFactory(ctx, { header: req.get(REQUEST_HEADER), rawBody: raw, nowMs });
  return { caller, raw, nowMs };
}

function strictJson<T>(schema: z.ZodType<T>, r: FactoryRequest, req: Request): T {
  let value: unknown;
  try {
    value = JSON.parse(decodeBody(r.raw, req.get("content-encoding")).toString("utf8"));
  } catch (err) {
    if (err instanceof CloudError) throw err;
    throw badRequest("İstek gövdesi JSON değil");
  }
  if (!isPlainObject(value)) throw badRequest("İstek gövdesi bir JSON nesnesi olmalı");
  if ("v" in value && value.v !== PROTOCOL_VERSION) throw new CloudError(400, "PROTOKOL_SURUMU", `Desteklenmeyen sürüm: ${String(value.v)}`);
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  const first = parsed.error.issues[0];
  const where = first && first.path.length > 0 ? ` (${first.path.join(".")})` : "";
  throw badRequest(`İstek gövdesi sözleşmeye uymuyor${where}: ${first?.message ?? "bilinmiyor"}`);
}

export function createFactoryRouter(ctx: CloudContext): Router {
  const router = express.Router();
  router.use((_req, res, next) => {
    res.set({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    next();
  });
  router.use(rateLimit({ perMinute: ctx.config.V1_HIZ_DK, proxyHeader: ctx.config.VEKIL_IP_BASLIGI }));

  router.post(SYNC_PATHS.SYNC.replace("/v1", ""), async (req: Request, res: Response) => {
    const r = await authenticated(ctx, req);
    res.json(await applyPackage(ctx, r.caller, { raw: r.raw, contentEncoding: req.get("content-encoding"), nowMs: r.nowMs }));
  });

  router.post(SYNC_PATHS.INBOX_CLAIM.replace("/v1", ""), async (req: Request, res: Response) => {
    const r = await authenticated(ctx, req);
    res.json(await claimInbox(ctx, r.caller, strictJson(InboxClaimRequestSchema, r, req), r.nowMs));
  });

  router.post(SYNC_PATHS.INBOX_RESULT.replace("/v1", ""), async (req: Request, res: Response) => {
    const r = await authenticated(ctx, req);
    res.json(await recordInboxResults(ctx, r.caller, strictJson(InboxResultRequestSchema, r, req), r.nowMs));
  });

  router.post(SYNC_PATHS.ACCOUNTS.replace("/v1", ""), async (req: Request, res: Response) => {
    const r = await authenticated(ctx, req);
    strictJson(AccountsRequestSchema, r, req);
    res.json(await listAccountsForFactory(ctx, r.caller));
  });

  router.post(SYNC_PATHS.ACCOUNT_LOCK.replace("/v1", ""), async (req: Request, res: Response) => {
    const r = await authenticated(ctx, req);
    const out = await lockAccountFromFactory(ctx, r.caller, strictJson(AccountLockRequestSchema, r, req));
    res.status(out.status).json(out.data);
  });

  router.post(SYNC_PATHS.REPORT_CLAIM.replace("/v1", ""), async (req: Request, res: Response) => {
    const r = await authenticated(ctx, req);
    res.json(await claimReports(ctx, r.caller, strictJson(ReportClaimRequestSchema, r, req), r.nowMs));
  });

  router.post(SYNC_PATHS.REPORT_RESULT.replace("/v1", ""), async (req: Request, res: Response) => {
    const r = await authenticated(ctx, req);
    res.json(await recordReportResult(ctx, r.caller, strictJson(ReportResultRequestSchema, r, req), r.nowMs));
  });

  return router;
}
