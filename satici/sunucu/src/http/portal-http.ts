// PORTAL HTTP ORTAK KATMANI — satıcı portalı (ERİŞİM, /portal/api) ve bayi alt-portalı
// (GENEL, /bayi/api) aynı yapıdan doğar: oturum (çerez httpOnly + SameSite=Strict), rota başına BEYANLI
// izin, yazma rotalarında işlem kimliği (clientToken) ile idempotent eylem. Rota tabloları
// (portal-routes.ts · dealer-routes.ts) veridir: bekçi her rotanın iznini ve kimlik beyanını ölçer.
// ERİŞİM (Cloudflare Access) yönlendiricisi OPT-IN: yalnız erisim-rotalari.ts listesindeki rotalar bağlanır, liste
// dışı istek gövde okunmadan 404. İmza parolasının hangi yoldan geçebileceğini rota değil imza boğazı söyler (signing-scope.ts). Her işleyici istek kapsamında koşar (lib/request-scope.ts): imza boğazı dinleyiciyi,
// denetim Access e-postasını oradan okur; denetim satırı yazmayan ERİŞİM yazması genel ayak izi satırı alır.
// CSRF: SameSite=Strict + yazmada yalnız application/json (tarayıcı formu bu türü gönderemez) + CORS yok.
import express, { Router, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { recordAudit } from "../lib/audit";
import { VendorError, notFoundError } from "../lib/errors";
import { currentScope, runInListenerScope } from "../lib/request-scope";
import { login, logout, resolveSession, SESSION_COOKIE, SESSION_COOKIE_PATH, type PortalSession } from "../portal/auth.service";
import { executePortalAction, type PortalActionResult, type PortalActionSpec } from "../portal/idempotency";
import { roleHas, type PortalListener, type PortalPermission } from "../portal/roles";
import { changeOwnPassword } from "../portal/users.service";
import type { VendorContext } from "../services/context";
import { parseStrict } from "./body";
import { proxyTrustFrom } from "./client-address";
import { ERISIM_PORTAL_ROTALARI } from "./erisim-rotalari";
import { notFound } from "./error-handler";
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

function cookieHeader(listener: PortalListener, value: string, maxAgeSec: number): string {
  // GENEL ve ERİŞİM yalnız HTTPS'ten (Cloudflare) gelir: çerez her zaman Secure.
  return [
    `${SESSION_COOKIE[listener]}=${value}`,
    `Path=${SESSION_COOKIE_PATH[listener]}`,
    `Max-Age=${maxAgeSec}`,
    "HttpOnly",
    "SameSite=Strict",
    "Secure",
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

/** Oturum + izin kapısı — JSON rota tablosunun DIŞINDAKİ (ham gövdeli/akışlı) portal uçları da buradan geçer. */
export async function requirePortalSession(ctx: VendorContext, listener: PortalListener, http: { req: Request; res: Response }, permission?: PortalPermission): Promise<PortalSession> {
  const { req, res } = http;
  const session = await resolveSession(ctx, { listener, token: readCookie(req, SESSION_COOKIE[listener]) });
  if (!session) {
    res.append("Set-Cookie", cookieHeader(listener, "", 0));
    throw new VendorError(401, "OTURUM_YOK", "Oturum yok ya da süresi doldu; yeniden giriş yapın");
  }
  if (permission && !roleHas(session.user.rol, permission)) throw new VendorError(403, "YETKISIZ", "Bu işlem için yetkiniz yok");
  const scope = currentScope();
  if (scope) scope.actor = session.actor;
  return session;
}

// ---------------------------------------------------------------- dinleyici kapsamı + ERİŞİM izin listesi

export type RouteMethod = PortalMethod | "put";

/** İzin listesi anahtarı: "YÖNTEM /yol" (rota tablosundaki yazımla birebir). */
export const routeKey = (method: RouteMethod, path: string): string => `${method.toUpperCase()} ${path}`;

/** Oturum uçları (tablo dışı, bu dosyada bağlanır) — ERİŞİM listesinin tanıdığı anahtarlar. */
export const SESSION_ROUTE_KEYS: readonly string[] = ["POST /oturum/ac", "POST /oturum/kapat", "GET /oturum", "POST /oturum/parola"];

/**
 * ERİŞİM izin listesinin kusurları: listede ama rota tablosunda olmayan satır. `disi` (erisim-rotalari.ts
 * `ERISIM_DISI_ROTALAR`) verilirse KARAR TAMLIĞI da ölçülür: her tablo rotası ya listede ya gerekçeli dışlamada, ikisinde
 * birden değil, dışlamada tabloda olmayan satır yok. Yönlendirici yalnız birinci kolu açılışta uygular (liste dışı rota
 * zaten 404); tamlık bekçide (test_erisim_kapisi §4a). Boş dizi = geçerli.
 */
export function erisimListesiBulgulari(
  routes: readonly PortalRouteDef[],
  list: ReadonlySet<string>,
  fixedKeys: readonly string[] = SESSION_ROUTE_KEYS,
  disi?: Readonly<Record<string, string>>,
): string[] {
  const out: string[] = [];
  const keys = new Set(routes.map((d) => routeKey(d.method, d.path)));
  for (const key of list) if (!keys.has(key) && !fixedKeys.includes(key)) out.push(`${key}: listede ama rota tablosunda yok`);
  if (disi === undefined) return out;
  for (const key of Object.keys(disi)) {
    if (!keys.has(key)) out.push(`${key}: dışlamada ama rota tablosunda yok`);
    if (list.has(key)) out.push(`${key}: hem listede hem dışlamada`);
  }
  for (const key of keys) if (!list.has(key) && !Object.hasOwn(disi, key)) out.push(`${key}: tablo rotası ne ERİŞİM listesinde ne dışlamada (karar yok)`);
  return out;
}

const ALLOWED_MARK = "erisimIzinliRota";

/** Listede olmayan istek gövde OKUNMADAN 404 (eşleşme Express'in kendi yol eşleyicisiyle — bağlamayla aynı anlam). */
export function allowlistGate(list: ReadonlySet<string>): RequestHandler {
  const marker = express.Router();
  const mark: RequestHandler = (_req, res, next) => {
    res.locals[ALLOWED_MARK] = true;
    next();
  };
  for (const key of list) {
    const [method, path] = key.split(" ") as [string, string];
    const m = method.toLowerCase() as RouteMethod;
    if (!["get", "post", "patch", "put"].includes(m) || !path?.startsWith("/")) throw new Error(`ERİŞİM izin listesi: biçimsiz anahtar ${key}`);
    marker[m](path, mark);
  }
  return (req, res, next) => {
    marker(req, res, (err?: unknown) => {
      if (err) {
        next(err);
        return;
      }
      if (res.locals[ALLOWED_MARK] === true) next();
      else notFound(req, res);
    });
  };
}

export interface ScopedOptions {
  /** ERİŞİM yazma ayak izi satırından muafiyet — gerekçesi yazılı (ör. parça yazımı: oturumun açılışı/tamamlanışı taşır). */
  readonly ayakIziMuaf?: string;
}

const isWrite = (req: Request): boolean => req.method !== "GET" && req.method !== "HEAD";

/**
 * İşleyiciyi istek kapsamında koşar. ERİŞİM'de doğrulanmış Access kimliği yoksa (JWT kapısının arkasında değil) 404.
 * ERİŞİM'de oturumlu, başarılı, tekrar oynatma olmayan ve denetim satırı yazmamış yazma → genel ayak izi satırı.
 */
export function scopedHandler(listener: PortalListener, key: string, fn: (req: Request, res: Response) => Promise<void>, opts: ScopedOptions = {}): RequestHandler {
  return async (req, res) => {
    const raw = listener === "ERISIM" ? (res.locals.erisimKimligi as { email?: unknown } | undefined)?.email : undefined;
    const email = typeof raw === "string" && raw !== "" ? raw : undefined;
    if (listener === "ERISIM" && email === undefined) {
      notFound(req, res);
      return;
    }
    await runInListenerScope(
      listener,
      async () => {
        await fn(req, res);
        const scope = currentScope();
        if (listener !== "ERISIM" || !isWrite(req) || opts.ayakIziMuaf || !scope?.actor || scope.audits > 0) return;
        if (res.statusCode >= 400 || res.get("Idempotent-Replay") === "true") return;
        await recordAudit({ event: "ERISIM_YAZMA", entity: "PortalRota", actor: scope.actor, summary: { rota: key, yol: `${req.baseUrl}${req.path}`, durum: res.statusCode } });
      },
      email,
    );
  };
}

export function createPortalRouter(ctx: VendorContext, listener: PortalListener, routes: readonly PortalRouteDef[]): Router {
  const router = express.Router();
  // ERİŞİM: YALNIZ izin listesi (opt-in). Kusurlu liste açılışı durdurur; liste dışı istek gövde okunmadan 404.
  const allowed = listener === "ERISIM" ? ERISIM_PORTAL_ROTALARI : null;
  if (allowed) {
    const problems = erisimListesiBulgulari(routes, allowed);
    if (problems.length > 0) throw new Error(`ERİŞİM izin listesi geçersiz: ${problems.join(" | ")}`);
    router.use(allowlistGate(allowed));
  }
  const bind = (key: string): boolean => allowed === null || allowed.has(key);
  const bound = routes.filter((d) => bind(routeKey(d.method, d.path)));
  router.use(noStore);
  router.use(jsonOnlyWrites);
  router.use(express.json({ limit: "64kb", strict: true }));
  // Vekil başlığı yalnız Cloudflare arkasındaki dinleyicilerde (GENEL · ERİŞİM) ve yalnız güvenilen vekilden gelen bağlantıda okunur.
  const trust = proxyTrustFrom(ctx.config);
  const scoped = (key: string, fn: (req: Request, res: Response) => Promise<void>): RequestHandler => scopedHandler(listener, key, fn);

  if (bind("POST /oturum/ac")) {
    router.post(
      "/oturum/ac",
      rateLimit({ perMinute: ctx.config.PORTAL_GIRIS_HIZ_DK, trust }),
      scoped("POST /oturum/ac", async (req, res) => {
        const body = parseStrict(LoginSchema, req.body ?? {});
        const { token, session } = await login(ctx, { listener, username: body.kullaniciAdi, password: body.parola, totp: body.totp });
        res.append("Set-Cookie", cookieHeader(listener, token, ctx.config.PORTAL_OTURUM_AZAMI_SAAT * 3600));
        res.status(200).json({ success: true, data: sessionView(session) });
      }),
    );
  }

  const requireSession = (req: Request, res: Response): Promise<PortalSession> => requirePortalSession(ctx, listener, { req, res });

  if (bind("POST /oturum/kapat")) {
    router.post(
      "/oturum/kapat",
      scoped("POST /oturum/kapat", async (req, res) => {
        const session = await resolveSession(ctx, { listener, token: readCookie(req, SESSION_COOKIE[listener]) });
        if (session) await logout(session);
        res.append("Set-Cookie", cookieHeader(listener, "", 0));
        res.json({ success: true, data: null });
      }),
    );
  }

  if (bind("GET /oturum")) {
    router.get(
      "/oturum",
      scoped("GET /oturum", async (req, res) => {
        res.json({ success: true, data: sessionView(await requireSession(req, res)) });
      }),
    );
  }

  if (bind("POST /oturum/parola")) {
    router.post(
      "/oturum/parola",
      scoped("POST /oturum/parola", async (req, res) => {
        const session = await requireSession(req, res);
        const body = parseStrict(PasswordChangeSchema, req.body ?? {});
        await changeOwnPassword(ctx, { userId: session.user.id, sessionId: session.id, currentPassword: body.mevcutParola, newPassword: body.yeniParola, totp: body.totp });
        res.json({ success: true, data: null });
      }),
    );
  }

  for (const def of bound) {
    const key = routeKey(def.method, def.path);
    router[def.method](
      def.path,
      scoped(key, async (req, res) => {
        const session = await requireSession(req, res);
        if (!roleHas(session.user.rol, def.permission)) throw new VendorError(403, "YETKISIZ", "Bu işlem için yetkiniz yok");
        const result = await def.handler({ ctx, session, req, nowMs: Date.now() });
        if (result.replayed) res.set("Idempotent-Replay", "true");
        res.status(result.status ?? 200).json({ success: true, data: result.data });
      }),
    );
  }
  return router;
}
