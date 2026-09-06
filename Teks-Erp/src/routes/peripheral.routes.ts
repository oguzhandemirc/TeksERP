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
import { MOBILE_SESSION_PERMS } from "../services/work-session.service";
import { getStampContext } from "../services/helpers/work-session.helper";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission, requireAnyPermission } from "../middlewares/rbac.middleware";
import { z } from "zod";
import { labelKindSchema } from "../config/label-kind.schema";

// Gövde sözleşmeleri — 2026-09-05'te eklendi: iki yazma ucu gövdeyi HAM CAST ile
// okuyordu (`as { kind?: string }`, `body.kind as never`), yani tip güvencesi yoktu
// ve sözleşme yalnız servisin içindeki kontrollerde yaşıyordu.
// ⚠️ `.strict()` BİLEREK YOK: bu uçlar sahadaki tablet ve panel tarafından zaten
// çağrılıyor; bilinmeyen anahtarı 400'e çevirmek eski istemciyi kırardı
// (backend ÖNCE kuralı). Yeni uçlarda `.strict()` zorunludur — docs/standart/BACKEND.md.
// `kind` tek kaynaktan (`labelKindSchema`) türer; elle string listesi YAZILMAZ.
const templateRouteSchema = z.object({
  kind: labelKindSchema,
  templateId: z.string().uuid().nullable().optional(),
});
const fieldAddressSchema = z.object({ address: z.string() });

const MOBILE_LABEL_PRINTERS = ["mobile:kk1", "mobile:tambur", "mobile:tarti-paket"] as const;

const service = new PeripheralDeviceService({
  modelName: "peripheralDevice",
  tableName: "PERIPHERAL_DEVICE",
  searchFields: ["name", "address"],
  codeSearchFields: ["code"],
  uniqueField: "code",
  duplicateNameField: "name",
  // hardDelete tombstone'u (deletedAt dolu, aktifleştirilemez) aday sayılmasın —
  // aksi hâlde silinen cihazın adı süresiz bloke olurdu.
  duplicateNameWhere: { deletedAt: null },
  entityLabel: "cihaz",
  defaultInclude: {
    machine: { select: { id: true, code: true, name: true } },
    device: { select: { id: true, name: true } },
    station: { select: { id: true, code: true, name: true, kind: true } },
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
// `settings:workstation` de okuyabilir: "Bu Bilgisayar → Yazıcı" sekmesi, yerel
// yazıcıyı bir CİHAZ KAYDINA bağlar (dil/şablon oradan çözülür). Liste olmadan o
// seçim yapılamaz ve diyalogsuz baskı net hatayla durur — yani izni verip listeyi
// kapamak, ekranı yarım açmak olurdu. Yazma uçları `station:write`te KALIR.
peripheralRouter.get("/", verifyToken, requireAnyPermission("station:read", "settings:workstation", ...MOBILE_LABEL_PRINTERS), controller.findAll);

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
  // Sevkiyat PC'si (Electron) kantarını çözmek için shipping izniyle de erişir.
  requireAnyPermission("station:read", "shipping:read", "shipping:write", ...MOBILE_LABEL_PRINTERS, "mobile:sevkiyat"),
  async (req, res, next) => {
    try {
      const kind = typeof req.query.kind === "string" ? req.query.kind : "";
      const result = await service.getForDevice(
        { deviceId: req.device?.id ?? null, machineId: req.device?.machineId ?? null },
        kind,
      );
      res.status(200).json(result);
    } catch (e) { next(e); }
  },
);
/**
 * @openapi
 * /api/peripherals/for-session:
 *   get:
 *     tags: [Peripherals]
 *     summary: Aktif çalışma oturumunun YERİNE sabit cihazları çöz (for-device halefi)
 *     description: |
 *       Yer, cihazın aktif WorkSession'ından çözülür (x-device-id → oturum):
 *       makine-oturumu → makineye sabit; makinesiz istasyon-oturumu (SHIPPING) →
 *       istasyona sabit. Oturum yoksa BOŞ liste (fail-closed). kind=METER/SCALE/LABEL_PRINTER/SIGNAL_SOURCE.
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Cihaz listesi } }
 */
peripheralRouter.get(
  "/for-session",
  verifyToken,
  requireAnyPermission("station:read", "shipping:read", "shipping:write", ...MOBILE_SESSION_PERMS),
  async (req, res, next) => {
    try {
      const kind = typeof req.query.kind === "string" ? req.query.kind : "";
      const stamp = await getStampContext(req);
      const result = await service.getForSession(stamp, kind);
      res.status(200).json(result);
    } catch (e) { next(e); }
  },
);
// BENZER KAYITLAR — mükerreri REDDETMEK yerine ÖNLEMEK için (2026-08-19).
// ⚠️ `/:id`den ÖNCE tanımlı olmalı; sonra gelirse Express "similar-names"i id
// sanar ve `uuid-param` middleware'i 400 döndürür.
// ⚠️ İzin WRITE: bu uç var olan adları listeler ve yalnız KAYIT AÇAN kişiye
// lazımdır; okuma iznine bakmak görünürlüğü gereksiz genişletirdi.
peripheralRouter.get("/similar-names", verifyToken, requirePermission("station:write"), controller.similarNames);

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
    const body = templateRouteSchema.parse(req.body ?? {});
    const result = await service.setTemplateRoute(
      req.params.id as string,
      body.kind,
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
 * /api/peripherals/{id}/field-address:
 *   patch:
 *     tags: [Peripherals]
 *     summary: Saha tableti — aktif oturumun makine/istasyonundaki cihaza taranan MAC'i yaz
 *     description: |
 *       Body { address }. Tablet BT tarayıp seçtiği HC-06'nın MAC'ini cihaz kaydına yazar.
 *       GÜVENLİK: cihaz, aktif oturumun machineId/stationId'sine ait DEĞİLSE 403 —
 *       makine 2'deki tablet makine 3'ün cihazını yeniden yazamaz. Oturum yoksa 409.
 *       Gerçek MAC atandığı için simulate kapatılır.
 *     security: [{ bearerAuth: [] }]
 *     responses: { 200: { description: Güncellendi } }
 */
peripheralRouter.patch(
  "/:id/field-address",
  verifyToken,
  // Kaba geçit; asıl güvenlik serviste: aktif oturum ZORUNLU (yoksa 409) + cihaz
  // oturumun makine/istasyonuna ait olmalı (değilse 403) + yalnız BT kantar/metre.
  // Bu YALNIZ oturumlu saha tableti akışıdır — panelden düzenleme normal PATCH /:id
  // (station:write) ile yapılır (masaüstü/oturumsuz istek burada kapsam-dışı → 403).
  requireAnyPermission("station:write", ...MOBILE_SESSION_PERMS),
  async (req, res, next) => {
    try {
      const body = fieldAddressSchema.parse(req.body ?? {});
      const stamp = await getStampContext(req, { enforceForMobile: true }); // oturum yoksa 409
      const result = await service.setFieldAddress(
        req.params.id as string,
        body.address,
        stamp,
        req.user?.userId,
      );
      res.status(200).json(result);
    } catch (e) { next(e); }
  },
);
