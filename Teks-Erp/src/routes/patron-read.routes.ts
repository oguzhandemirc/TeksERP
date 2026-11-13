// =============================================================================
// TeksERP - Patron okuma ucu (V3a, 2026-11-13) — `/api/patron/v1/*`
// =============================================================================
// Patron telefon uygulaması bulut kopyası yerine ERP'yi okur: bulutun `/api/oturum`, `/api/veri/:p[/:id]`,
// `/api/anlik/:p` uçlarıyla AYNI yol/sorgu/yanıt biçimi (uygulama yalnız taban adresini değiştirir).
// Hepsi salt okunur; kimlik + `patron-app:login` toplu kapı, küme izni serviste, modül kapısı ADLI kapıdan.
// =============================================================================
import { Router, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { requireMaliyetEnabled, requireProductionEnabled } from "../middlewares/module.middleware";
import { requireFinanceEnabled } from "../middlewares/finance.middleware";
import { PATRON_LOGIN_PERMISSION } from "../constants/permission-catalog";
import { AppError } from "../utils/app-error";
import {
  facilityStatus, getSetRecord, getSnapshot, listSet, setModule, type PatronUser,
} from "../services/patron-read/patron-read.service";
import { ID_FILTER_KEYS } from "../services/patron-read/kayit-sayfasi";

const router = Router();
// ⚠️ Toplu kapı: bu satırdan ÖNCE tanımlanan uç kapısız kalır (Express kayıt sırası).
router.use(verifyToken, requirePermission(PATRON_LOGIN_PERMISSION));

const MODULE_GATES: Readonly<Record<string, RequestHandler>> = {
  "production.enabled": requireProductionEnabled,
  "finance.enabled": requireFinanceEnabled,
  "maliyet.enabled": requireMaliyetEnabled,
};

/** Kümenin modülü kapalıysa adlı kapı 403 MODULE_DISABLED verir; tanınmayan ad kapıdan geçer, servis 404 verir. */
const moduleGate = (kind: "KAYIT" | "ANLIK"): RequestHandler => (req, res, next) => {
  const m = setModule(String(req.params.projeksiyon), kind);
  if (!m) return next();
  return MODULE_GATES[m]!(req, res, next);
};

const userOf = (req: Request): PatronUser => ({ userId: req.user!.userId, username: req.user!.username, permissions: req.user!.permissions });

const optText = (max: number) => z.string().max(max).optional();
const listQuerySchema = z.object({
  imlec: optText(400),
  limit: z.coerce.number().int().min(1, "limit 1–200 olmalı").max(200, "limit 1–200 olmalı").default(50),
  durum: optText(40),
  ara: optText(200),
  suzgec: optText(40),
  ...Object.fromEntries(ID_FILTER_KEYS.map((k) => [k, optText(40)])),
});

function parseList(req: Request) {
  const r = listQuerySchema.safeParse(req.query);
  if (!r.success) throw AppError.badRequest(r.error.issues[0]?.message ?? "Sorgu geçersiz", { code: "PATRON_LIST_QUERY" });
  const q = r.data as z.infer<typeof listQuerySchema> & Record<string, string | undefined>;
  return {
    cursor: q.imlec, limit: q.limit, durum: q.durum, ara: q.ara, suzgec: q.suzgec,
    kimlik: Object.fromEntries(ID_FILTER_KEYS.filter((k) => q[k] !== undefined).map((k) => [k, q[k]!])),
  };
}

const send = (fn: (req: Request) => Promise<unknown>) => async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    res.set("Cache-Control", "no-store");
    res.status(200).json({ success: true, data: await fn(req) });
  } catch (error) {
    next(error);
  }
};

/**
 * @openapi
 * /api/patron/v1/oturum:
 *   get:
 *     tags: [Patron]
 *     summary: Patron uygulaması üst şeridi (bulut `GET /api/oturum` biçimi)
 *     description: Tesis adı, hesabın ERP izinlerinden türeyen bulut kodları, okunabilir kümeler, liste yetenekleri. `patron-app:login` ister.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: FacilityStatus }
 *       403: { description: patron-app:login yok }
 */
router.get("/oturum", send((req) => facilityStatus(userOf(req))));

/**
 * @openapi
 * /api/patron/v1/veri/{projeksiyon}:
 *   get:
 *     tags: [Patron]
 *     summary: KAYIT kümesi sayfası (bulut `GET /api/veri/:projeksiyon` biçimi)
 *     description: Canlı ERP verisi, fabrika projeksiyon kurucusuyla. İzinsiz küme 403, tanınmayan 404, beyansız süzgeç 400.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: projeksiyon, required: true, schema: { type: string } }
 *       - { in: query, name: imlec, schema: { type: string } }
 *       - { in: query, name: limit, schema: { type: integer, minimum: 1, maximum: 200 } }
 *       - { in: query, name: durum, schema: { type: string } }
 *       - { in: query, name: ara, schema: { type: string } }
 *       - { in: query, name: suzgec, schema: { type: string } }
 *     responses:
 *       200: { description: "Page<ProjectionRecord>" }
 *       400: { description: Sorgu geçersiz }
 *       403: { description: İzin yok ya da modül kapalı }
 *       404: { description: Küme bu sunucuda yok }
 */
router.get("/veri/:projeksiyon", moduleGate("KAYIT"), send((req) => listSet(userOf(req), String(req.params.projeksiyon), parseList(req))));

/**
 * @openapi
 * /api/patron/v1/veri/{projeksiyon}/{id}:
 *   get:
 *     tags: [Patron]
 *     summary: KAYIT kümesinden tek kayıt (bulut `GET /api/veri/:projeksiyon/:id` biçimi)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: projeksiyon, required: true, schema: { type: string } }
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: ProjectionRecord }
 *       403: { description: İzin yok ya da modül kapalı }
 *       404: { description: Küme ya da kayıt yok }
 */
router.get("/veri/:projeksiyon/:id", moduleGate("KAYIT"), send((req) => getSetRecord(userOf(req), String(req.params.projeksiyon), String(req.params.id))));

/**
 * @openapi
 * /api/patron/v1/anlik/{projeksiyon}:
 *   get:
 *     tags: [Patron]
 *     summary: ANLIK özet (bulut `GET /api/anlik/:projeksiyon` biçimi)
 *     description: Fabrika anlık kurucusuyla istek anında; 20 sn süreç içi önbellek (kullanıcı+küme), izin ve modül kapısı her istekte. `surum` = üretim anı.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: projeksiyon, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Snapshot }
 *       403: { description: İzin yok ya da modül kapalı }
 *       404: { description: Küme bu sunucuda yok }
 */
router.get("/anlik/:projeksiyon", moduleGate("ANLIK"), send((req) => getSnapshot(userOf(req), String(req.params.projeksiyon))));

export default router;
