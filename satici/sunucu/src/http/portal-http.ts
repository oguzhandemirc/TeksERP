// PORTAL HTTP ORTAK KATMANI — satıcı portalı (TAILNET, /portal/api) ve bayi alt-portalı (GENEL,
// /bayi/api) aynı yapıdan doğar: oturum (çerez httpOnly + SameSite=Strict), rota başına BEYANLI
// izin, yazma rotalarında işlem kimliği (clientToken) ile idempotent eylem. Rota tabloları
// (portal-routes.ts · dealer-routes.ts) veridir: bekçi her rotanın iznini ve kimlik beyanını ölçer.
// CSRF: SameSite=Strict + yazmada yalnız application/json (tarayıcı formu bu türü gönderemez) + CORS yok.
import express, { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { VendorError, notFoundError } from "../lib/errors";
import { login, logout, resolveSession, SESSION_COOKIE, SESSION_COOKIE_PATH, type PortalSession } from "../portal/auth.service";
import { executePortalAction, type PortalActionResult, type PortalActionSpec } from "../portal/idempotency";
import { roleHas, type PortalListener, type PortalPermission } from "../portal/roles";
import { changeOwnPassword } from "../portal/users.service";
import type { VendorContext } from "../services/context";
import { parseStrict } from "./body";
import { rateLimit } from "./rate-limit";

export type PortalMethod = "get" | "post" | "patch";

export interface PortalRequestContext {
  readonly ctx: VendorContext;
  readonly session: PortalSession;
  readonly req: Request;
  readonly nowMs: number;
}

export interface PortalRouteResult {
  readonly status?: number;
  readonly data: unknown;
  readonly replayed?: boolean;
}

/**
 * Rota beyanı. `kimlik`: yazma rotası ya işlem kimliğiyle idempotenttir ("ISLEM_KIMLIGI") ya da
 * gerekçesi yazılı muafiyettir; okuma rotası "OKUMA". Bekçi: test_portal_rol_dinleyici §1.
 */
export interface PortalRouteDef {
  readonly method: PortalMethod;
  readonly path: string;
  readonly permission: PortalPermission;
  readonly kimlik: "OKUMA" | "ISLEM_KIMLIGI" | { readonly muaf: string };
  readonly handler: (c: PortalRequestContext) => Promise<PortalRouteResult>;
}

export const ClientTokenSchema = z.uuid();
export const ReasonSchema = z.string().trim().min(1).max(500);
export const IsoSchema = z.iso.datetime();

/** URL parçasındaki kimlik: UUID değilse kayıt yok sayılır (DB'ye biçimsiz kimlik gitmez). */
export function idParam(req: Request, name = "id", what = "Kayıt"): string {
  const v = req.params[name];
  if (typeof v !== "string" || !z.uuid().safeParse(v).success) throw notFoundError(what);
  return v;
}

export function queryText(req: Request, name: string, max = 100): string | undefined {
  const v = req.query[name];
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t.slice(0, max) : undefined;
}

export function queryEnum<T extends string>(req: Request, name: string, values: readonly T[]): T | undefined {
  const v = queryText(req, name);
  if (v === undefined) return undefined;
  if (!(values as readonly string[]).includes(v)) throw new VendorError(400, "GOVDE_GECERSIZ", `Tanınmayan ${name}: ${v}`);
  return v as T;
}

export function queryBool(req: Request, name: string): boolean | undefined {
  const v = queryText(req, name);
  if (v === undefined) return undefined;
  if (v !== "true" && v !== "false") throw new VendorError(400, "GOVDE_GECERSIZ", `${name} true ya da false olmalı`);
  return v === "true";
}

export function pageQuery(req: Request): { cursor: string | undefined; limit: number } {
  const cursor = queryText(req, "imlec");
  if (cursor !== undefined && !z.uuid().safeParse(cursor).success) throw new VendorError(400, "GOVDE_GECERSIZ", "İmleç biçimsiz");
  const raw = queryText(req, "limit");
  const limit = raw === undefined ? 50 : Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new VendorError(400, "GOVDE_GECERSIZ", "limit 1–200 olmalı");
  return { cursor, limit };
}

/** Gövde KATI şemadan geçer; tanınmayan anahtar 400. */
export function bodyOf<T>(c: PortalRequestContext, schema: z.ZodType<T>): T {
  return parseStrict(schema, c.req.body ?? {});
}

/** Yazma eylemi: işlem kimliği + oturum aktörü + denetim tek boğazdan. */
export async function portalAction<P, R>(
  c: PortalRequestContext,
  spec: Omit<PortalActionSpec<P, R>, "body"> & { body: object },
): Promise<PortalActionResult> {
  return executePortalAction({ userId: c.session.user.id, actor: c.session.actor }, { ...spec, body: spec.body as Record<string, unknown> });
}

// ---------------------------------------------------------------- çerez

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

function cookieHeader(ctx: VendorContext, listener: PortalListener, value: string, maxAgeSec: number): string {
  const secure = listener === "GENEL" || ctx.config.TAILNET_CEREZ_GUVENLI === "1";
  return [
    `${SESSION_COOKIE[listener]}=${value}`,
    `Path=${SESSION_COOKIE_PATH[listener]}`,
    `Max-Age=${maxAgeSec}`,
    "HttpOnly",
    "SameSite=Strict",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

// ---------------------------------------------------------------- yönlendirici

const LoginSchema = z.strictObject({
  kullaniciAdi: z.string().min(1).max(60),
  parola: z.string().min(1).max(200),
  totp: z.string().min(1).max(12),
});

const PasswordChangeSchema = z.strictObject({
  mevcutParola: z.string().min(1).max(200),
  yeniParola: z.string().min(1).max(200),
  totp: z.string().min(1).max(12),
});

function noStore(_req: Request, res: Response, next: NextFunction): void {
  res.set({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" });
  next();
}

function jsonOnlyWrites(req: Request, _res: Response, next: NextFunction): void {
  if (req.method !== "GET" && req.method !== "HEAD" && !req.is("application/json")) {
    throw new VendorError(400, "GOVDE_GECERSIZ", "Yazma istekleri application/json gövde taşımalı");
  }
  next();
}

function sessionView(s: PortalSession) {
  return { kullanici: s.user, dinleyici: s.listener, bitis: s.expiresAt.toISOString() };
}

export function createPortalRouter(ctx: VendorContext, listener: PortalListener, routes: readonly PortalRouteDef[]): Router {
  const router = express.Router();
  router.use(noStore);
  router.use(jsonOnlyWrites);
  router.use(express.json({ limit: "64kb", strict: true }));
  const proxyHeader = listener === "GENEL" ? ctx.config.VEKIL_IP_BASLIGI : undefined;

  router.post("/oturum/ac", rateLimit({ perMinute: ctx.config.PORTAL_GIRIS_HIZ_DK, proxyHeader }), async (req: Request, res: Response) => {
    const body = parseStrict(LoginSchema, req.body ?? {});
    const { token, session } = await login(ctx, { listener, username: body.kullaniciAdi, password: body.parola, totp: body.totp });
    res.append("Set-Cookie", cookieHeader(ctx, listener, token, ctx.config.PORTAL_OTURUM_AZAMI_SAAT * 3600));
    res.status(200).json({ success: true, data: sessionView(session) });
  });

  const requireSession = async (req: Request, res: Response): Promise<PortalSession> => {
    const session = await resolveSession(ctx, { listener, token: readCookie(req, SESSION_COOKIE[listener]) });
    if (!session) {
      res.append("Set-Cookie", cookieHeader(ctx, listener, "", 0));
      throw new VendorError(401, "OTURUM_YOK", "Oturum yok ya da süresi doldu; yeniden giriş yapın");
    }
    return session;
  };

  router.post("/oturum/kapat", async (req: Request, res: Response) => {
    const session = await resolveSession(ctx, { listener, token: readCookie(req, SESSION_COOKIE[listener]) });
    if (session) await logout(session);
    res.append("Set-Cookie", cookieHeader(ctx, listener, "", 0));
    res.json({ success: true, data: null });
  });

  router.get("/oturum", async (req: Request, res: Response) => {
    res.json({ success: true, data: sessionView(await requireSession(req, res)) });
  });

  router.post("/oturum/parola", async (req: Request, res: Response) => {
    const session = await requireSession(req, res);
    const body = parseStrict(PasswordChangeSchema, req.body ?? {});
    await changeOwnPassword(ctx, { userId: session.user.id, sessionId: session.id, currentPassword: body.mevcutParola, newPassword: body.yeniParola, totp: body.totp });
    res.json({ success: true, data: null });
  });

  for (const def of routes) {
    router[def.method](def.path, async (req: Request, res: Response) => {
      const session = await requireSession(req, res);
      if (!roleHas(session.user.rol, def.permission)) throw new VendorError(403, "YETKISIZ", "Bu işlem için yetkiniz yok");
      const result = await def.handler({ ctx, session, req, nowMs: Date.now() });
      if (result.replayed) res.set("Idempotent-Replay", "true");
      res.status(result.status ?? 200).json({ success: true, data: result.data });
    });
  }
  return router;
}
