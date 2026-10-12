// =============================================================================
// TeksERP — HAM DURUŞ KODU EŞLEMESİ uçları (makine kaynaklı duruş D2) · /api/machine-stop-code-maps
// =============================================================================
// ⚠️ ÜÇ KAPI SIRAYLA: `verifyToken` → `requireTezgahEnabled` (eşleme yalnız kart sinyalinin işidir)
// → `loom:spec-manage` (tezgah künyesiyle aynı yetenek; yeni izin kodu yok). Panel ekranı ayrı dilim;
// bugün çıkış yüzeyi bu uçlardır. Gövde allowlist'i servistedir (Zod `.strict()`).
// =============================================================================
import { Router } from "express";
import { BaseController } from "../controllers/base.controller";
import { MachineStopCodeMapService } from "../services/machine-stop-code-map.service";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { requireTezgahEnabled } from "../middlewares/module.middleware";

export const machineStopCodeMapService = new MachineStopCodeMapService({
  modelName: "machineStopCodeMap",
  tableName: "MACHINE_STOP_CODE_MAP",
  searchFields: ["collectorType", "rawStopCode"],
  defaultInclude: {
    machine: { select: { id: true, code: true, name: true } },
    stopReason: { select: { id: true, code: true, label: true, isActive: true } },
  },
  entityLabel: "duruş kodu eşlemesi",
});

const controller = new BaseController(machineStopCodeMapService);
const router = Router();
router.use(verifyToken, requireTezgahEnabled);
const guard = requirePermission("loom:spec-manage");

/**
 * @openapi
 * /api/machine-stop-code-maps:
 *   get:
 *     tags: [MachineStopCodeMaps]
 *     summary: Ham duruş kodu → sebep eşlemeleri (kart tipi geneli + tezgah üst-yazımı)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Liste }
 *       403: { description: Tezgah modülü kapalı (MODULE_DISABLED) ya da yetki yok }
 *   post:
 *     tags: [MachineStopCodeMaps]
 *     summary: Eşleme oluştur — allowlist (collectorType · rawStopCode · machineId? · stopReasonId)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Oluşturuldu }
 *       400: { description: Tanınmayan alan · biçim · sebep MACHINE_STOP değil/pasif (STOP_REASON_INVALID) · pasif tezgah }
 *       409: { description: Aynı kapsamda etkin eşleme var (STOP_CODE_MAP_DUPLICATE) }
 */
router.get("/", guard, controller.findAll);
router.post("/", guard, controller.create);

/**
 * @openapi
 * /api/machine-stop-code-maps/{id}:
 *   get:
 *     tags: [MachineStopCodeMaps]
 *     summary: Eşleme detayı
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: Kayıt }
 *       404: { description: Bulunamadı }
 *   patch:
 *     tags: [MachineStopCodeMaps]
 *     summary: Sebebi değiştir ya da etkinleştir — anahtar (kart tipi · ham kod · tezgah) değişmez
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: Güncellendi }
 *       400: { description: Anahtar alanı ya da tanınmayan alan }
 *       409: { description: Etkinleştirmede aynı kapsamda etkin eşleme var }
 *   delete:
 *     tags: [MachineStopCodeMaps]
 *     summary: Eşlemeyi pasife al (silme yok; geçmiş duruşların sebebi değişmez)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: Pasife alındı }
 */
router.get("/:id", guard, controller.findById);
router.patch("/:id", guard, controller.update);
router.delete("/:id", guard, controller.remove);

export default router;
