// HESAP API'si (`/api/*`) — patron uygulaması (iOS/Android/web) buna konuşur; UYGULAMA ROLÜYLE.
// Rota TABLOSU veridir: her rota kimlik beyanı (`ACIK` | `OTURUM`) + yazmada işlem kimliği beyanı
// taşır; izin kararı servistedir (sunucu süzer, istemci yalnız gizler). Taşıma: `Authorization:
// Bearer` (çerez YOK → CSRF yüzeyi yok); yazma yalnız application/json. Bekçi: test_patron_kapilari.
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { z } from "zod";
import { acceptInvite, confirmInvite, inspectInvite } from "../auth/invite.service";
import { changeOwnPassword, login, logout, resolveSession, type SessionContext } from "../auth/session.service";
import { ASSIGNABLE_PERMISSIONS, ROLE_TEMPLATES } from "../catalog/permissions";
import { CloudError, badRequest } from "../lib/errors";
import type { WriteResult } from "../lib/idempotency";
import { createAccount, listAccountAudit, listAccounts, resetAccount, setAccountStatus, updateAccount } from "../services/account.service";
import type { CloudContext } from "../services/context";
import { facilityStatus, getProjectionRecord, getSnapshot, listProjection } from "../services/data.service";
import { deactivateDevice, listDevices, registerDevice } from "../services/device.service";
import { cancelInbox, createInboxMessage, getInbox, listInbox } from "../services/inbox.service";
import { cancelReportRequest, createReportRequest, getReportRequest, listReportRequests } from "../services/report.service";
import { rateLimit } from "./rate-limit";

export interface ApiCall {
  readonly ctx: CloudContext;
  readonly req: Request;
  /** `OTURUM` rotalarında dolu. */
  readonly session: SessionContext | null;
}

export interface ApiRouteDef {
  readonly method: "get" | "post" | "patch";
  readonly path: string;
  readonly auth: "ACIK" | "OTURUM";
  /** Yazma: işlem kimliğiyle idempotent ("ISLEM_KIMLIGI") ya da gerekçesi yazılı muafiyet; okuma "OKUMA". */
  readonly kimlik: "OKUMA" | "ISLEM_KIMLIGI" | { readonly muaf: string };
  readonly handler: (c: ApiCall) => Promise<{ status?: number; data: unknown; replayed?: boolean }>;
}

const Uuid = z.uuid();
const Token = z.uuid();
const PermissionList = z.array(z.string().max(40)).max(40);
const Template = z.enum(["PATRON", "MUHASEBE", "SATIS"]);

function body<T>(c: ApiCall, schema: z.ZodType<T>): T {
  const r = schema.safeParse(c.req.body ?? {});
  if (r.success) return r.data;
  const first = r.error.issues[0];
  const where = first && first.path.length > 0 ? ` (${first.path.join(".")})` : "";
  throw badRequest(`İstek gövdesi sözleşmeye uymuyor${where}: ${first?.message ?? "bilinmiyor"}`);
}

function param(c: ApiCall, name: string): string {
  const v = c.req.params[name];
  if (typeof v !== "string" || !Uuid.safeParse(v).success) throw new CloudError(404, "BULUNAMADI", "Kayıt bulunamadı");
  return v;
}

function text(c: ApiCall, name: string, max = 200): string | undefined {
  const v = c.req.query[name];
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t.slice(0, max) : undefined;
}

function page(c: ApiCall): { cursor: string | undefined; limit: number } {
  const raw = text(c, "limit");
  const limit = raw === undefined ? 50 : Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw badRequest("limit 1–200 olmalı");
  return { cursor: text(c, "imlec", 400), limit };
}

function uuidCursor(cursor: string | undefined): string | undefined {
  if (cursor !== undefined && !Uuid.safeParse(cursor).success) throw badRequest("İmleç biçimsiz");
  return cursor;
}

const s = (c: ApiCall): SessionContext => c.session!;
const written = (r: WriteResult) => ({ status: r.status, data: r.data, replayed: r.replayed });
const PROJECTION = "projeksiyon";

export const API_ROUTES: readonly ApiRouteDef[] = [
  // ---- açık (oturumsuz) ----
  {
    method: "post",
    path: "/oturum/ac",
    auth: "ACIK",
    kimlik: { muaf: "oturum doğumu; tekrar yeni oturum açar (eski oturum süresiyle kapanır)" },
    handler: async (c) => {
      const b = body(c, z.strictObject({ eposta: z.string().min(3).max(254), parola: z.string().min(1).max(200), totp: z.string().min(1).max(12), istemci: z.enum(["mobil", "web"]).optional() }));
      const r = await login(c.ctx, { email: b.eposta, password: b.parola, totp: b.totp, client: b.istemci ?? null });
      return { data: { belirtec: r.token, bitis: r.expiresAt.toISOString(), hesap: { id: r.session.accountId, ad: r.session.accountName, eposta: r.session.email, izinler: [...r.session.permissions].sort() }, tesisId: r.session.tesisId } };
    },
  },
  {
    method: "post",
    path: "/davet/incele",
    auth: "ACIK",
    kimlik: { muaf: "salt okuma; davet belirteci URL'ye ve erişim günlüğüne düşmesin diye POST gövdesinde" },
    handler: async (c) => ({ data: await inspectInvite(c.ctx, body(c, z.strictObject({ davet: z.string().max(100) })).davet) }),
  },
  {
    method: "post",
    path: "/davet/kabul",
    auth: "ACIK",
    kimlik: { muaf: "davet belirteci tek kullanımlık kimliktir; tekrar kabul yeni TOTP sırrı üretir (onaydan önce)" },
    handler: async (c) => {
      const b = body(c, z.strictObject({ davet: z.string().max(100), parola: z.string().min(1).max(200) }));
      return { data: await acceptInvite(c.ctx, { token: b.davet, password: b.parola }) };
    },
  },
  {
    method: "post",
    path: "/davet/onay",
    auth: "ACIK",
    kimlik: { muaf: "davet belirteci tek kullanımlık kimliktir; onay atomik claim (DAVETLI → AKTİF)" },
    handler: async (c) => {
      const b = body(c, z.strictObject({ davet: z.string().max(100), totp: z.string().min(1).max(12) }));
      return { data: await confirmInvite(c.ctx, { token: b.davet, totp: b.totp }) };
    },
  },
  // ---- oturum ----
  { method: "get", path: "/oturum", auth: "OTURUM", kimlik: "OKUMA", handler: async (c) => ({ data: await facilityStatus(c.ctx, s(c)) }) },
  {
    method: "post",
    path: "/oturum/kapat",
    auth: "OTURUM",
    kimlik: { muaf: "oturum kapatma atomik claim; tekrarı etkisiz" },
    handler: async (c) => {
      await logout(c.ctx, s(c));
      return { data: null };
    },
  },
  {
    method: "post",
    path: "/oturum/parola",
    auth: "OTURUM",
    kimlik: { muaf: "TOTP adımı tekrar oynatmayı keser (aynı kod ikinci kez geçmez)" },
    handler: async (c) => {
      const b = body(c, z.strictObject({ mevcutParola: z.string().min(1).max(200), yeniParola: z.string().min(1).max(200), totp: z.string().min(1).max(12) }));
      await changeOwnPassword(c.ctx, s(c), { current: b.mevcutParola, next: b.yeniParola, totp: b.totp });
      return { data: null };
    },
  },
  { method: "get", path: "/izinler", auth: "OTURUM", kimlik: "OKUMA", handler: async () => ({ data: { izinler: ASSIGNABLE_PERMISSIONS, sablonlar: ROLE_TEMPLATES } }) },
  // ---- veri ----
  {
    method: "get",
    path: `/veri/:${PROJECTION}`,
    auth: "OTURUM",
    kimlik: "OKUMA",
    handler: async (c) => {
      const { cursor, limit } = page(c);
      return { data: await listProjection(c.ctx, s(c), String(c.req.params[PROJECTION]), { cursor, limit, durum: text(c, "durum", 40), cariKartId: text(c, "cariKartId", 40) }) };
    },
  },
  { method: "get", path: `/veri/:${PROJECTION}/:id`, auth: "OTURUM", kimlik: "OKUMA", handler: async (c) => ({ data: await getProjectionRecord(c.ctx, s(c), String(c.req.params[PROJECTION]), String(c.req.params.id)) }) },
  { method: "get", path: `/anlik/:${PROJECTION}`, auth: "OTURUM", kimlik: "OKUMA", handler: async (c) => ({ data: await getSnapshot(c.ctx, s(c), String(c.req.params[PROJECTION])) }) },
  // ---- gelen kutusu ----
  {
    method: "post",
    path: "/gelen-kutusu",
    auth: "OTURUM",
    kimlik: "ISLEM_KIMLIGI",
    handler: async (c) => {
      const b = body(c, z.strictObject({ mesajId: Token, tur: z.enum(["SIPARIS", "CARI"]), govde: z.unknown() }));
      return written(await createInboxMessage(c.ctx, s(c), b));
    },
  },
  {
    method: "get",
    path: "/gelen-kutusu",
    auth: "OTURUM",
    kimlik: "OKUMA",
    handler: async (c) => {
      const { cursor, limit } = page(c);
      const durum = text(c, "durum", 20);
      const parsed = durum === undefined ? undefined : z.enum(["BEKLIYOR", "ISLENIYOR", "ISLENDI", "REDDEDILDI", "IPTAL"]).safeParse(durum);
      if (parsed && !parsed.success) throw badRequest(`Tanınmayan durum: ${durum}`);
      return { data: await listInbox(c.ctx, s(c), { durum: parsed?.data, cursor: uuidCursor(cursor), limit }) };
    },
  },
  { method: "get", path: "/gelen-kutusu/:mesajId", auth: "OTURUM", kimlik: "OKUMA", handler: async (c) => ({ data: await getInbox(c.ctx, s(c), param(c, "mesajId")) }) },
  {
    method: "post",
    path: "/gelen-kutusu/:mesajId/iptal",
    auth: "OTURUM",
    kimlik: { muaf: "atomik claim BEKLIYOR → IPTAL; zaten iptalse aynı sonuç" },
    handler: async (c) => ({ data: await cancelInbox(c.ctx, s(c), param(c, "mesajId")) }),
  },
  // ---- rapor isteği ----
  {
    method: "post",
    path: "/raporlar",
    auth: "OTURUM",
    kimlik: "ISLEM_KIMLIGI",
    handler: async (c) => {
      const b = body(c, z.strictObject({ clientToken: Token, raporAnahtari: z.string().min(3).max(120), parametreler: z.record(z.string(), z.unknown()).default({}) }));
      return written(await createReportRequest(c.ctx, s(c), b));
    },
  },
  {
    method: "get",
    path: "/raporlar",
    auth: "OTURUM",
    kimlik: "OKUMA",
    handler: async (c) => {
      const { cursor, limit } = page(c);
      return { data: await listReportRequests(c.ctx, s(c), { cursor: uuidCursor(cursor), limit }) };
    },
  },
  { method: "get", path: "/raporlar/:id", auth: "OTURUM", kimlik: "OKUMA", handler: async (c) => ({ data: await getReportRequest(c.ctx, s(c), param(c, "id")) }) },
  {
    method: "post",
    path: "/raporlar/:id/iptal",
    auth: "OTURUM",
    kimlik: { muaf: "atomik claim BEKLIYOR → IPTAL; zaten iptalse aynı sonuç" },
    handler: async (c) => ({ data: await cancelReportRequest(c.ctx, s(c), param(c, "id")) }),
  },
  // ---- bildirim cihazı ----
  {
    method: "post",
    path: "/cihazlar",
    auth: "OTURUM",
    kimlik: { muaf: "push belirteci doğal kimliktir (tesis + belirteç özeti TEKİL); tekrar aynı satırı günceller" },
    handler: async (c) => {
      const b = body(c, z.strictObject({ platform: z.enum(["ios", "android", "web"]), belirtec: z.string().min(8).max(4096), ad: z.string().trim().min(1).max(120).optional() }));
      return { status: 201, data: await registerDevice(c.ctx, s(c), { platform: b.platform, token: b.belirtec, ...(b.ad ? { ad: b.ad } : {}) }) };
    },
  },
  { method: "get", path: "/cihazlar", auth: "OTURUM", kimlik: "OKUMA", handler: async (c) => ({ data: await listDevices(c.ctx, s(c)) }) },
  {
    method: "post",
    path: "/cihazlar/:id/kaldir",
    auth: "OTURUM",
    kimlik: { muaf: "atomik claim active → pasif; tekrarı aynı sonuç" },
    handler: async (c) => ({ data: await deactivateDevice(c.ctx, s(c), param(c, "id")) }),
  },
  // ---- hesap yönetimi (bulut:hesap:yonet) ----
  { method: "get", path: "/hesaplar", auth: "OTURUM", kimlik: "OKUMA", handler: async (c) => ({ data: await listAccounts(c.ctx, s(c)) }) },
  {
    method: "get",
    path: "/hesaplar/denetim",
    auth: "OTURUM",
    kimlik: "OKUMA",
    handler: async (c) => {
      const { cursor, limit } = page(c);
      return { data: await listAccountAudit(c.ctx, s(c), { cursor: uuidCursor(cursor), limit }) };
    },
  },
  {
    method: "post",
    path: "/hesaplar",
    auth: "OTURUM",
    kimlik: "ISLEM_KIMLIGI",
    handler: async (c) => {
      const b = body(c, z.strictObject({ clientToken: Token, eposta: z.email().max(254), ad: z.string().trim().min(1).max(120), izinler: PermissionList.optional(), sablon: Template.optional() }));
      if ((b.izinler === undefined) === (b.sablon === undefined)) throw badRequest("İzin listesi ya da şablon (yalnız biri) verilmeli");
      return written(await createAccount(c.ctx, s(c), b));
    },
  },
  {
    method: "patch",
    path: "/hesaplar/:id",
    auth: "OTURUM",
    kimlik: "ISLEM_KIMLIGI",
    handler: async (c) => {
      const b = body(c, z.strictObject({ clientToken: Token, ad: z.string().trim().min(1).max(120).optional(), izinler: PermissionList.optional(), sablon: Template.optional() }));
      if (b.izinler !== undefined && b.sablon !== undefined) throw badRequest("İzin listesi ile şablon birlikte verilemez");
      return written(await updateAccount(c.ctx, s(c), param(c, "id"), b));
    },
  },
  {
    method: "post",
    path: "/hesaplar/:id/durum",
    auth: "OTURUM",
    kimlik: "ISLEM_KIMLIGI",
    handler: async (c) => written(await setAccountStatus(c.ctx, s(c), param(c, "id"), body(c, z.strictObject({ clientToken: Token, durum: z.enum(["AKTIF", "KILITLI", "PASIF"]) })))),
  },
  {
    method: "post",
    path: "/hesaplar/:id/sifirla",
    auth: "OTURUM",
    kimlik: "ISLEM_KIMLIGI",
    handler: async (c) => written(await resetAccount(c.ctx, s(c), param(c, "id"), body(c, z.strictObject({ clientToken: Token })))),
  },
];

function bearer(req: Request): string | undefined {
  const h = req.get("authorization");
  if (!h) return undefined;
  const m = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(h.trim());
  return m?.[1];
}

function noStore(_req: Request, res: Response, next: NextFunction): void {
  res.set({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" });
  next();
}

function jsonOnlyWrites(req: Request, _res: Response, next: NextFunction): void {
  if (req.method !== "GET" && req.method !== "HEAD" && !req.is("application/json")) throw badRequest("Yazma istekleri application/json gövde taşımalı");
  next();
}

export function createApiRouter(ctx: CloudContext): Router {
  const router = express.Router();
  router.use(noStore);
  router.use(jsonOnlyWrites);
  router.use(express.json({ limit: "256kb", strict: true }));
  const loginLimit = rateLimit({ perMinute: ctx.config.GIRIS_HIZ_DK, proxyHeader: ctx.config.VEKIL_IP_BASLIGI });
  for (const def of API_ROUTES) {
    const guards = def.auth === "ACIK" ? [loginLimit] : [];
    router[def.method](def.path, ...guards, async (req: Request, res: Response) => {
      let session: SessionContext | null = null;
      if (def.auth === "OTURUM") {
        session = await resolveSession(ctx, bearer(req));
        if (!session) throw new CloudError(401, "OTURUM_YOK", "Oturum yok ya da süresi doldu; yeniden giriş yapın");
      }
      const r = await def.handler({ ctx, req, session });
      if (r.replayed) res.set("Idempotent-Replay", "true");
      res.status(r.status ?? 200).json({ success: true, data: r.data });
    });
  }
  return router;
}
