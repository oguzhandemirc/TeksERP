// =============================================================================
// TeksERP — Lisans uçları (`/api/license/*`)
// =============================================================================
// İki uç kimlik doğrulamasını KOŞULLU yapar (test_route_auth_coverage muaf listesinde):
//   · `GET /durum` herkes içindir ama kimliksiz çağırana AYRINTI dönmez (K5 sinyali sızmaz);
//   · `GET /indirme-belirteci` tabletin giriş ÖNCESİ güncelleme denetimi için onaylı cihazı
//     da kabul eder.
// Geri kalan her uç `router.use(verifyToken)`un ARKASINDA — sıra load-bearing.
// Kapı (kısıtlı kip) bu dosyada DEĞİL: app düzeyinde `licenseGate`; `/api/license/*` her kademede açık.
// Etkinleştirme kodu URL'de taşınmaz: istek zarfı uçları POST gövdesiyle çalışır; aynı uçların
// `?kod=`lu GET biçimi eski panel için BİR sürüm daha durur (erişim günlüğünde kod maskelenir).
// =============================================================================
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { verifyToken } from "../middlewares/auth.middleware";
import { requireAnyPermission, requirePermission } from "../middlewares/rbac.middleware";
import { AppError } from "../utils/app-error";
import {
  activateLicense,
  acceptOfflineResponse,
  buildOfflineRequest,
  drTakeover,
  getDataExportManifest,
  getDownloadToken,
  getLicenseDetail,
  getLicenseStatus,
  getProxySettings,
  pollLicenseNow,
  requestTransfer,
  updateProxySettings,
} from "../services/license.service";

const router = Router();

/** Başlık varsa TAM doğrulama (geçersiz token 401); yoksa kimliksiz devam. */
function verifyTokenIfPresent(req: Request, res: Response, next: NextFunction): void {
  if (!req.headers.authorization) {
    next();
    return;
  }
  void verifyToken(req, res, next);
}

/** Onaylı cihaz (`req.device`, yalnız ONAYLI+aktif cihazda dolar) ya da kimlikli kullanıcı. */
function requireApprovedDeviceOrSession(req: Request, res: Response, next: NextFunction): void {
  if (req.device) {
    next();
    return;
  }
  if (req.headers.authorization) {
    void verifyToken(req, res, next);
    return;
  }
  next(AppError.unauthorized("Onaylı cihaz ya da oturum gerekli.", { code: "DEVICE_OR_SESSION_REQUIRED" }));
}

const canView = requireAnyPermission("license:view", "license:manage");
const canManage = requirePermission("license:manage");

const ActivateBody = z.object({ kod: z.string().trim().min(12).max(40) });
const OfflineRequestInput = z.object({
  amac: z.enum(["yokla", "etkinlestir"]).default("yokla"),
  kod: z.string().trim().max(40).optional(),
});
const ResponseBody = z.object({
  yanit: z.union([z.string().min(10).max(64 * 1024), z.record(z.string(), z.unknown())]),
});
const TransferBody = z.object({ gerekce: z.string().trim().max(500).nullable().optional() });
const DrBody = z.object({ anaKurulumId: z.uuid(), gerekce: z.string().trim().min(1).max(500) });
const DownloadQuery = z.object({
  urun: z.enum(["electron", "mobil"]),
  kanal: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/).optional(),
});
const ProxyBody = z.object({
  adres: z.string().trim().max(500).nullable(),
  atla: z.string().trim().max(500).nullable().optional(),
});

/**
 * @openapi
 * /api/license/durum:
 *   get:
 *     tags: [Lisans]
 *     summary: Lisans durumu özeti (kimliksiz çağırana ayrıntı yok)
 *     responses:
 *       200: { description: "Kimlikli → kip, uygulanan kademe, bant, lisans sahibi/no; kimliksiz → { ayrinti: false }" }
 *       401: { description: Token geçersiz }
 */
router.get("/durum", verifyTokenIfPresent, (req: Request, res: Response) => {
  res.status(200).json({ success: true, data: getLicenseStatus(Boolean(req.user)) });
});

/**
 * @openapi
 * /api/license/indirme-belirteci:
 *   get:
 *     tags: [Lisans]
 *     summary: Güncelleme indirme belirteci (onaylı cihaz ya da oturum)
 *     parameters:
 *       - { in: query, name: urun, required: true, schema: { type: string, enum: [electron, mobil] } }
 *       - { in: query, name: kanal, required: false, schema: { type: string } }
 *     responses:
 *       200: { description: "{ yolOneki, belirtec, gecerlilikSonu }" }
 *       403: { description: Güncelleme dondurulmuş (LICENSE_UPDATES_FROZEN) }
 *       404: { description: Belirteç yok (LICENSE_DOWNLOAD_TOKEN_UNAVAILABLE) }
 */
router.get("/indirme-belirteci", requireApprovedDeviceOrSession, (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = DownloadQuery.parse(req.query);
    res.status(200).json({ success: true, data: getDownloadToken({ urun: q.urun, kanal: q.kanal ?? null }) });
  } catch (err) {
    next(err);
  }
});

// ⚠️ Bu satırdan SONRAKİ her uç kimlik ister.
router.use(verifyToken);

/**
 * @openapi
 * /api/license/detay:
 *   get:
 *     tags: [Lisans]
 *     summary: Lisans ayrıntısı (HAK, kira, parmak izi ölçümü, yoklama, zil, proxy)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Ayrıntı }
 */
router.get("/detay", canView, (_req: Request, res: Response) => {
  res.status(200).json({ success: true, data: getLicenseDetail() });
});

/**
 * @openapi
 * /api/license/etkinlestir:
 *   post:
 *     tags: [Lisans]
 *     summary: Çevrimiçi etkinleştirme (satıcıya imzalı istek)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [kod], properties: { kod: { type: string } } }
 *     responses:
 *       200: { description: Etkinleşti — güncel ayrıntı }
 *       409: { description: Satıcı reddetti / zaten etkin / yapılandırılmamış }
 *       502: { description: Satıcıya ulaşılamadı }
 */
router.post("/etkinlestir", canManage, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { kod } = ActivateBody.parse(req.body);
    res.status(200).json({ success: true, data: await activateLicense(kod, req.user?.userId ?? null) });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/license/yokla:
 *   post:
 *     tags: [Lisans]
 *     summary: Şimdi yokla (zamanlayıcıyı beklemeden)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ outcome, code? }" }
 */
router.post("/yokla", canManage, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.status(200).json({ success: true, data: await pollLicenseNow() });
  } catch (err) {
    next(err);
  }
});

/**
 * İstek zarfı (çevrimdışı QR ve panel aktarması aynı zarfı üretir). `source`: POST gövdesi ya da
 * eski GET sorgusu. GET biçimi yalnız geçiş içindir — `Deprecation` başlığı taşır; panel POST'a
 * geçtikten bir sürüm sonra kaldırılır.
 */
function offlineRequestHandler(source: "body" | "query") {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const input = OfflineRequestInput.parse((source === "body" ? req.body : req.query) ?? {});
      if (source === "query") res.setHeader("Deprecation", "true");
      res.status(200).json({ success: true, data: await buildOfflineRequest({ amac: input.amac, kod: input.kod ?? null }) });
    } catch (err) {
      next(err);
    }
  };
}

/**
 * @openapi
 * /api/license/cevrimdisi-istek:
 *   post:
 *     tags: [Lisans]
 *     summary: Çevrimdışı (QR) imzalı istek zarfı — 10 dk geçerli
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema: { type: object, properties: { amac: { type: string, enum: [yokla, etkinlestir] }, kod: { type: string } } }
 *     responses:
 *       200: { description: "{ zarf, gecerlilikSonu, qrAdresi, istekGovdesi, hedefUrl }" }
 *   get:
 *     tags: [Lisans]
 *     deprecated: true
 *     summary: "ESKİ biçim — kod URL'de; POST'a geçildikten bir sürüm sonra kaldırılır"
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: amac, required: false, schema: { type: string, enum: [yokla, etkinlestir] } }
 *       - { in: query, name: kod, required: false, schema: { type: string } }
 *     responses:
 *       200: { description: "{ zarf, gecerlilikSonu, qrAdresi, istekGovdesi, hedefUrl }" }
 */
router.post("/cevrimdisi-istek", canManage, offlineRequestHandler("body"));
router.get("/cevrimdisi-istek", canManage, offlineRequestHandler("query"));

/**
 * @openapi
 * /api/license/cevrimdisi-yanit:
 *   post:
 *     tags: [Lisans]
 *     summary: Çevrimdışı yanıtı (QR metni ya da JSON) doğrula ve kabul et
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Kabul edildi — güncel ayrıntı }
 *       400: { description: İmza/bağ doğrulanamadı (LICENSE_RESPONSE_INVALID) }
 */
router.post("/cevrimdisi-yanit", canManage, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { yanit } = ResponseBody.parse(req.body);
    res.status(200).json({ success: true, data: await acceptOfflineResponse(yanit, "cevrimdisi", req.user?.userId ?? null) });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/license/aktarma-istegi:
 *   post:
 *     tags: [Lisans]
 *     summary: Panel aktarması için imzalı istek (panel satıcıya kendisi iletir)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema: { type: object, properties: { amac: { type: string, enum: [yokla, etkinlestir] }, kod: { type: string } } }
 *     responses:
 *       200: { description: "{ istekGovdesi, hedefUrl, gecerlilikSonu }" }
 *   get:
 *     tags: [Lisans]
 *     deprecated: true
 *     summary: "ESKİ biçim — kod URL'de; POST'a geçildikten bir sürüm sonra kaldırılır"
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: amac, required: false, schema: { type: string, enum: [yokla, etkinlestir] } }
 *       - { in: query, name: kod, required: false, schema: { type: string } }
 *     responses:
 *       200: { description: "{ istekGovdesi, hedefUrl, gecerlilikSonu }" }
 */
router.post("/aktarma-istegi", canManage, offlineRequestHandler("body"));
router.get("/aktarma-istegi", canManage, offlineRequestHandler("query"));

/**
 * @openapi
 * /api/license/aktarma-yaniti:
 *   post:
 *     tags: [Lisans]
 *     summary: Panelin satıcıdan getirdiği yanıtı doğrula ve kabul et (imza backend'de)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Kabul edildi — güncel ayrıntı }
 *       400: { description: İmzasız/kurcalı yanıt (LICENSE_RESPONSE_INVALID) }
 */
router.post("/aktarma-yaniti", canManage, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { yanit } = ResponseBody.parse(req.body);
    res.status(200).json({ success: true, data: await acceptOfflineResponse(yanit, "aktarma", req.user?.userId ?? null) });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/license/tasima-talebi:
 *   post:
 *     tags: [Lisans]
 *     summary: Bu kuruluma taşıma talebi (satıcı onayı gerekir)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ talepId, durum: BEKLIYOR|ONAYLANDI|REDDEDILDI, lisans }" }
 */
router.post("/tasima-talebi", canManage, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { gerekce } = TransferBody.parse(req.body ?? {});
    res.status(200).json({ success: true, data: await requestTransfer(gerekce ?? null, req.user?.userId ?? null) });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/license/dr-devral:
 *   post:
 *     tags: [Lisans]
 *     summary: DR devralma (ana sunucunun kirası iptal edilir; satıcıya anında bildirim)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Devralındı — güncel ayrıntı }
 */
router.post("/dr-devral", canManage, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { anaKurulumId, gerekce } = DrBody.parse(req.body);
    res.status(200).json({ success: true, data: await drTakeover(anaKurulumId, gerekce, req.user?.userId ?? null) });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/license/veri-disari:
 *   get:
 *     tags: [Lisans]
 *     summary: Verilerimi al — yedek + dışa aktarma yolları (her kademede açık, yalnız yönetici)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ kademe, yedekler, yollar }" }
 */
router.get(
  "/veri-disari",
  // Yedek listesi/indirme ile AYNI zincir: yedek düz giriş sırları taşır (F287).
  requireAnyPermission("admin:settings", "system:backups"),
  requirePermission("admin:users"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(200).json({ success: true, data: await getDataExportManifest(req.user?.userId ?? null) });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * @openapi
 * /api/license/proxy:
 *   get:
 *     tags: [Lisans]
 *     summary: Dışarı çıkış proxy ayarı (kimlik bilgisi maskeli)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ kaynak, adres, atla, destekleniyor }" }
 *   put:
 *     tags: [Lisans]
 *     summary: Proxy ayarını değiştir (null = kaldır); yeniden başlatma gerekmez
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Güncel ayar }
 *       400: { description: Adres geçersiz (LICENSE_PROXY_INVALID) }
 */
router.get("/proxy", canView, (_req: Request, res: Response) => {
  res.status(200).json({ success: true, data: getProxySettings() });
});

router.put("/proxy", canManage, (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = ProxyBody.parse(req.body);
    res.status(200).json({ success: true, data: updateProxySettings({ adres: body.adres, atla: body.atla ?? null }, req.user?.userId ?? null) });
  } catch (err) {
    next(err);
  }
});

export default router;
