// =============================================================================
// TeksERP - Peripheral Device (birleşik cihaz kaydı) Routes
// =============================================================================
// Mount: /api/peripherals
//
// Yazıcılar (ağ/Bluetooth/USB/seri) + tekstil makine sinyal kaynakları (kantar/
// metraj — kayıt-only). Her cihaz dil/profil/şablon yönlendirmesini taşır; baskı
// anında label.service cihaz→{dil,profil,şablon} çözer. İzin: `station:read/write`
// (donanım ailesiyle tutarlı); mobil BT kaydı saha ekran izniyle de.
// =============================================================================

import { Router } from "express";
import { BaseController } from "../controllers/base.controller";
import { PeripheralDeviceService } from "../services/peripheral.service";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission, requireAnyPermission } from "../middlewares/rbac.middleware";

const MOBILE_LABEL_PRINTERS = ["mobile:kk1", "mobile:tambur", "mobile:tarti-paket"] as const;

const service = new PeripheralDeviceService({
  modelName: "peripheralDevice",
  tableName: "PERIPHERAL_DEVICE",
  searchFields: ["code", "name", "address"],
  uniqueField: "code",
  defaultInclude: {
    machine: { select: { id: true, code: true, name: true } },
    device: { select: { id: true, name: true } },
    printerModel: { select: { id: true, code: true, name: true, language: true } },
    formatProfile: { select: { id: true, code: true, name: true } },
    templateRoutes: { select: { kind: true, templateId: true, template: { select: { id: true, name: true } } } },
  },
});
const controller = new BaseController(service);

export const peripheralRouter = Router();

/**
 * @openapi
 * /api/peripherals:
 *   get: { tags: [Peripherals], summary: Cihaz kaydı listesi (yazıcı/sinyal), security: [{ bearerAuth: [] }], responses: { 200: { description: Liste } } }
 *   post: { tags: [Peripherals], summary: Cihaz kaydı oluştur, security: [{ bearerAuth: [] }], responses: { 201: { description: Oluşturuldu } } }
 */
peripheralRouter.get("/", verifyToken, requireAnyPermission("station:read", ...MOBILE_LABEL_PRINTERS), controller.findAll);

/**
 * @openapi
 * /api/peripherals/for-device:
 *   get:
 *     tags: [Peripherals]
 *     summary: Tablet — kendi makinesine sabit, türe göre AKTİF cihazları çöz (protokol dahil)
 *     description: machineId req.device'tan gelir (query DEĞİL). kind=METER/SCALE/LABEL_PRINTER/SIGNAL_SOURCE. Eşleşme yoksa boş liste.
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Cihaz listesi } }
 */
peripheralRouter.get(
  "/for-device",
  verifyToken,
  requireAnyPermission("station:read", ...MOBILE_LABEL_PRINTERS),
  async (req, res, next) => {
    try {
      const kind = typeof req.query.kind === "string" ? req.query.kind : "";
      const result = await service.getForDevice(req.device?.machineId ?? null, kind);
      res.status(200).json(result);
    } catch (e) { next(e); }
  },
);
peripheralRouter.get("/:id", verifyToken, requirePermission("station:read"), controller.findById);
peripheralRouter.post("/", verifyToken, requirePermission("station:write"), controller.create);
peripheralRouter.patch("/:id", verifyToken, requirePermission("station:write"), controller.update);
peripheralRouter.delete("/:id", verifyToken, requirePermission("station:write"), controller.remove);
peripheralRouter.delete("/:id/permanent", verifyToken, requirePermission("station:write"), controller.hardRemove);

/**
 * @openapi
 * /api/peripherals/{id}/template-routes:
 *   post:
 *     tags: [Peripherals]
 *     summary: Cihaza per-kind şablon yönlendirmesi ata/kaldır
 *     description: Body { kind, templateId }. templateId boş → yönlendirme kaldırılır (kind default'a düşer).
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Güncellendi } }
 */
peripheralRouter.post("/:id/template-routes", verifyToken, requirePermission("station:write"), async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as { kind?: string; templateId?: string | null };
    const result = await service.setTemplateRoute(
      req.params.id as string,
      body.kind as never,
      body.templateId ?? null,
      req.user?.userId,
    );
    res.status(200).json(result);
  } catch (e) { next(e); }
});

/**
 * @openapi
 * /api/peripherals/{id}/test:
 *   post:
 *     tags: [Peripherals]
 *     summary: Cihaz bağlantı testi (NETWORK_TCP gerçek/simüle; BT/USB/seri cihaz tarafı)
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Test sonucu } }
 */
peripheralRouter.post("/:id/test", verifyToken, requirePermission("station:write"), async (req, res, next) => {
  try {
    const result = await service.test(req.params.id as string, req.user?.userId);
    res.status(200).json(result);
  } catch (e) { next(e); }
});

/**
 * @openapi
 * /api/peripherals/register-bt:
 *   post:
 *     tags: [Peripherals]
 *     summary: Mobil — tablete-bağlı Bluetooth yazıcıyı merkezî kayda al (idempotent)
 *     description: deviceId req.device'tan çözülür. Body { address, name?, languageOverride? }.
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Kaydedildi } }
 */
peripheralRouter.post("/register-bt", verifyToken, requireAnyPermission("station:write", ...MOBILE_LABEL_PRINTERS), async (req, res, next) => {
  try {
    const deviceId = req.device?.id;
    if (!deviceId) {
      res.status(400).json({ success: false, message: "Eşleşmiş cihaz (tablet) gerekli — önce eşleştirin" });
      return;
    }
    const body = (req.body ?? {}) as { address?: string; name?: string; languageOverride?: string | null };
    const result = await service.registerBt(
      { deviceId, address: body.address ?? "", name: body.name, languageOverride: body.languageOverride as never },
      req.user?.userId,
    );
    res.status(200).json(result);
  } catch (e) { next(e); }
});
