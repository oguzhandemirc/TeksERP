// =============================================================================
// TeksERP - Patron panosu ucu (2026-11-14) — `/api/patron/v1/pano`
// =============================================================================
// Patron uygulamasının kişiselleştirilebilir panosu panelin AÇILIŞ PANOSU kutularını okur: katalog ve veri
// `services/dashboard/pano-kutular.service.ts`ten AYNEN (ayrı hesap yok). Kutu izni + modül kapısı serviste;
// burada kimlik + `patron-app:login` + pano ucunun izin kümesi toplu kapıdır. Düzen tercihi telefonda tutulur.
// =============================================================================
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { verifyToken } from "../middlewares/auth.middleware";
import { requireAnyPermission, requirePermission } from "../middlewares/rbac.middleware";
import { PATRON_LOGIN_PERMISSION } from "../constants/permission-catalog";
import { AppError } from "../utils/app-error";
import { PANO_DONEMLERI } from "../services/dashboard/pano-donem";
import { getPanoBoxCatalog, getPanoBoxes, parseBoxKeys } from "../services/dashboard/pano-kutular.service";
import { defaultAgendaParams } from "../services/dashboard/pano-kutu-ajanda";
import { PANO_ROUTE_PERMISSIONS } from "../services/dashboard/pano.service";

const router = Router();
// ⚠️ Toplu kapı: bu satırdan ÖNCE tanımlanan uç kapısız kalır (Express kayıt sırası).
router.use(verifyToken, requirePermission(PATRON_LOGIN_PERMISSION), requireAnyPermission(...PANO_ROUTE_PERMISSIONS));

export const patronPanoCatalogQuerySchema = z.strictObject({});
/** Telefon her zaman kutu listesi verir (özet biçimi yok); tanınmayan anahtar serviste 400 (fail-closed). */
export const patronPanoQuerySchema = z.strictObject({
  kutular: z.string().min(1, "kutular zorunlu").max(1000),
  donem: z.enum(PANO_DONEMLERI).optional(),
});

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw AppError.badRequest(r.error.issues[0]?.message ?? "İstek geçersiz", { code: "PATRON_PANO_SORGU" });
  return r.data;
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
 * /api/patron/v1/pano/kutular:
 *   get:
 *     tags: [Patron]
 *     summary: Patron panosu kutu kataloğu (panelin açılış panosu kataloğu, kullanıcının görebildikleri)
 *     description: "`{ kutular: [{ anahtar, baslik, aciklama, grup, donemli, varsayilan, boyut }] }` — izinsiz/kapalı modül kutusu listede yok."
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Katalog }
 *       403: { description: patron-app:login ya da pano izni yok }
 */
router.get("/kutular", send(async (req) => {
  parse(patronPanoCatalogQuerySchema, req.query);
  return getPanoBoxCatalog(req.user!);
}));

/**
 * @openapi
 * /api/patron/v1/pano:
 *   get:
 *     tags: [Patron]
 *     summary: Seçili pano kutularının verisi (panelle aynı kaynak)
 *     description: "Yanıt `{ donem, aralik, oncekiAralik, olusturuldu, kutular: { <anahtar>: veri | null } }`; izinsiz/kapalı kutu `null`, tanınmayan anahtar 400 `PANO_BOX_UNKNOWN`."
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: kutular, required: true, schema: { type: string }, description: Virgülle ayrılmış kutu anahtarları }
 *       - { in: query, name: donem, schema: { type: string, enum: [bugun, hafta, ay, yil], default: bugun } }
 *     responses:
 *       200: { description: Kutu verisi }
 *       400: { description: Sorgu geçersiz ya da tanınmayan kutu }
 */
router.get("/", send(async (req) => {
  const q = parse(patronPanoQuerySchema, req.query);
  return getPanoBoxes(q.donem ?? "bugun", parseBoxKeys(q.kutular), { user: req.user!, agenda: defaultAgendaParams(new Date()) });
}));

export default router;
