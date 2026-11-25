// =============================================================================
// TeksERP — Atkı Kartı (WeftSpec) Routes · dokuma ürün yapısı (MAL-1, S2 çekirdeği)
// =============================================================================
// ⚠️ ÜÇ KAPI SIRAYLA: `verifyToken` → `requireDokumaEnabled` (modül rejimi; TOPLU) →
// `requirePermission`. İzinler çözgü kartıyla AYNI kodlar (`warpspec:read/write`; yeni
// kod yok — DOKUMA-MANUEL-PLAN §S2). Ekran S4c'de (iş emri formu v2 + kart sayfaları).
// L3 (Seyitoğlu): kart dönen her yanıtta salt-okunur `shareBasis` + `yarns[].sharePct` (`withWeftShares`).
// =============================================================================
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { requireDokumaEnabled } from "../middlewares/module.middleware";
import {
  createWeftSpec,
  deactivateWeftSpec,
  getWeftSpec,
  listWeftSpecs,
  updateWeftSpec,
} from "../services/weft-spec.service";
import { forkWeftSpecForItem } from "../services/weft-spec-fork.service";
import { calculateWeftNeed } from "../services/weft-calc.service";
import { attachNewWeftSpecToItem } from "../services/weft-spec-draft.service";
import { withWeftShares } from "../services/helpers/weft-share.helper";
import { weftSpecOpenOrders } from "../services/helpers/spec-open-orders.helper";

const router = Router();
router.use(verifyToken, requireDokumaEnabled);

type H = (req: Request, res: Response) => Promise<void>;
const wrap = (h: H) => (req: Request, res: Response, next: NextFunction): void => {
  h(req, res).catch(next);
};
const idParam = z.object({ id: z.string().uuid("Geçersiz kayıt ID") });
const body = z.record(z.string(), z.unknown());
const listQuery = z.object({
  search: z.string().max(100).optional(),
  includeInactive: z.enum(["0", "1", "true", "false"], { message: "includeInactive yalnız 0/1/true/false olabilir" }).optional()
    .transform((v) => v === "1" || v === "true"),
});

/**
 * @openapi
 * /api/weft-specs:
 *   get:
 *     tags: [WeftSpecs]
 *     summary: Atkı kartı listesi (dokuma modülü; varsayılan yalnız aktif)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Liste }
 *       403: { description: Dokuma modülü kapalı (MODULE_DISABLED) ya da yetki yok }
 */
router.get("/", requirePermission("warpspec:read"), wrap(async (req, res) => {
  res.status(200).json({ success: true, data: (await listWeftSpecs(listQuery.parse(req.query))).map(withWeftShares) });
}));

const positive = (label: string, max: number) => z.number({ message: `${label} sayı olmalı` }).positive(`${label} sıfırdan büyük olmalı`).max(max, `${label} çok büyük`);
const calcBody = z.strictObject({
  itemId: z.uuid({ message: "Geçersiz kumaş ID" }).optional(),
  rawWidthCm: positive("Ham en", 10_000).nullable().optional(),
  weftLengthCm: positive("Atkı boyu", 10_000).nullable().optional(),
  picksPerCm: positive("Atkı sıklığı", 1000).nullable().optional(),
  sequenceCode: z.string().max(120, "Sıra kodu en çok 120 karakter").nullable().optional(),
  yarns: z.array(z.strictObject({
    yarnItemId: z.uuid({ message: "İplik kimliği geçersiz" }),
    picksInRepeat: z.number().int("Atkı adedi tam sayı olmalı").positive("Atkı adedi sıfırdan büyük olmalı").max(100_000).nullable().optional(),
  })).min(1, "En az bir atkı ipliği gerekli").max(26, "En çok 26 atkı ipliği"),
});

/**
 * @openapi
 * /api/weft-specs/calc:
 *   post:
 *     tags: [WeftSpecs]
 *     summary: Atkı hesabı — 1000 m kumaş için iplik başına kg (fireli/firesiz), YAZMAZ (K4)
 *     description: |
 *       Formdaki atkı (kaydedilmemiş olabilir) maliyet motorunun aynı formülüyle hesaplanır. `itemId` verilirse atkı boyu
 *       ve fire o kumaşın zincirinden (elle → yapı → tarak eni → ham en + kenar payı); verilmezse yalnız elle atkı boyu.
 *       Eksik veri `missing[]` ile döner (400 değil).
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ perMeters, picksPerCm, lengthCm, lengthSource, wastePct, rows[], totalNetKg, totalGrossKg, missing[] }" }
 *       400: { description: Gövde geçersiz / iplik bulunamadı }
 *       404: { description: Kumaş bulunamadı }
 */
router.post("/calc", requirePermission("warpspec:read"), wrap(async (req, res) => {
  res.status(200).json({ success: true, data: await calculateWeftNeed(calcBody.parse(req.body ?? {})) });
}));

/**
 * @openapi
 * /api/weft-specs/{id}:
 *   get:
 *     tags: [WeftSpecs]
 *     summary: Atkı kartı detayı (iplik satırlarıyla)
 *     description: |
 *       Salt-okunur pay: `shareBasis` = "MASS" (kütlece — maliyet motorunun atkı formülü; tüm ipliklerde denye varsa)
 *       | "PICKS" (denye eksik → atım sayısı payı) | null (iplik satırı yok); `yarns[].sharePct` 2 haneli yüzde (yoksa null).
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: Kayıt }
 *       404: { description: Bulunamadı }
 */
router.get("/:id", requirePermission("warpspec:read"), wrap(async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.status(200).json({ success: true, data: withWeftShares(await getWeftSpec(id)) });
}));

/**
 * @openapi
 * /api/weft-specs/{id}/open-orders:
 *   get:
 *     tags: [WeftSpecs]
 *     summary: Bu atkı kartını kullanan açık dokuma iş emirleri (düzenleme uyarısı; yazmaz)
 *     description: İş emrinin kendi kartı, boşsa ürünün kartı sayılır. `numbers` en çok 10 numara; `total` tam sayıdır.
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: "{ weavingOrders, warpingOrders, total, numbers[] }" }
 */
router.get("/:id/open-orders", requirePermission("warpspec:read"), wrap(async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.status(200).json({ success: true, data: await weftSpecOpenOrders(id) });
}));

/**
 * @openapi
 * /api/weft-specs:
 *   post:
 *     tags: [WeftSpecs]
 *     summary: Atkı kartı oluştur (çoklu atkı ipliği — rapordaki adet payı)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Oluşturuldu }
 *       400: { description: İplik değil / denye boş / adet ≤ 0 }
 *       409: { description: Kod ya da ad mükerrer }
 */
router.post("/", requirePermission("warpspec:write"), wrap(async (req, res) => {
  const data = withWeftShares(await createWeftSpec(body.parse(req.body ?? {}), req.user?.userId));
  res.status(201).json({ success: true, data, message: "Atkı kartı oluşturuldu." });
}));

const attachBody = z.object({
  itemId: z.string().uuid("Geçersiz kumaş ID"),
  expectedWeftSpecId: z.string().uuid("Geçersiz atkı kartı ID").nullable(),
  weft: z.record(z.string(), z.unknown()),
}).strict();

/**
 * @openapi
 * /api/weft-specs/attach-to-item:
 *   post:
 *     tags: [WeftSpecs]
 *     summary: Var olan kumaşa ürün penceresinden girilen atkıyı yeni kart olarak bağla (B19; kart + bağ tek tx)
 *     description: |
 *       Kod/ad üründen türer. `expectedWeftSpecId` kumaşın bilinen kartıdır (yoksa null); tutmazsa 409. Kumaş zaten
 *       üründen türemiş kodlu ve aynı içerikli karta bağlıysa önceki denemenin tekrarı sayılır (200, replayed=true).
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Kart oluşturuldu ve kumaşa bağlandı }
 *       200: { description: Tekrar deneme — mevcut kart döndü }
 *       400: { description: Taslak geçersiz ya da kumaş değil }
 *       409: { description: WEFT_SPEC_BINDING_CHANGED · WEFT_SPEC_DUPLICATE }
 */
router.post("/attach-to-item", requirePermission("warpspec:write"), requirePermission("item:write"), wrap(async (req, res) => {
  const result = await attachNewWeftSpecToItem(attachBody.parse(req.body ?? {}), req.user?.userId);
  const data = { ...result, weftSpec: withWeftShares(result.weftSpec) };
  res.status(data.replayed ? 200 : 201).json({ success: true, data, message: data.replayed ? "Atkı kartı zaten bağlanmıştı." : "Atkı kartı oluşturuldu ve kumaşa bağlandı." });
}));

const forkBody = z.object({
  itemId: z.string().uuid("Geçersiz kumaş ID"),
  code: z.string().max(32, "Atkı kartı kodu en çok 32 karakter olabilir"),
  name: z.string().max(100, "Atkı kartı adı en çok 100 karakter olabilir"),
}).strict();

/**
 * @openapi
 * /api/weft-specs/{id}/fork:
 *   post:
 *     tags: [WeftSpecs]
 *     summary: Bu desene özel kopya — kartı kopyalar, YALNIZ verilen kumaşın bağını kopyaya çevirir (SY-P3)
 *     description: Aynı kod bu kumaşa zaten bağlıysa önceki denemenin tekrarı sayılır (200, replayed=true).
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       201: { description: Kopya oluşturuldu ve kumaş bağı çevrildi }
 *       200: { description: Tekrar deneme — mevcut kopya döndü }
 *       400: { description: Kod/ad boş ya da gövde geçersiz }
 *       404: { description: Kart ya da kumaş bulunamadı }
 *       409: { description: WEFT_SPEC_DUPLICATE · WEFT_SPEC_BINDING_CHANGED · WEFT_SPEC_NOT_SHARED }
 */
router.post("/:id/fork", requirePermission("warpspec:write"), wrap(async (req, res) => {
  const { id } = idParam.parse(req.params);
  const forked = await forkWeftSpecForItem(id, forkBody.parse(req.body ?? {}), req.user?.userId);
  const data = { ...forked, weftSpec: withWeftShares(forked.weftSpec) };
  res.status(data.replayed ? 200 : 201).json({ success: true, data, message: data.replayed ? "Özel kopya zaten oluşturulmuştu." : "Bu desene özel atkı kartı oluşturuldu." });
}));

/**
 * @openapi
 * /api/weft-specs/{id}:
 *   patch:
 *     tags: [WeftSpecs]
 *     summary: Atkı kartı güncelle (yarns gönderilirse küme değiştirilir)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: Güncellendi }
 */
router.patch("/:id", requirePermission("warpspec:write"), wrap(async (req, res) => {
  const { id } = idParam.parse(req.params);
  const data = withWeftShares(await updateWeftSpec(id, body.parse(req.body ?? {}), req.user?.userId));
  res.status(200).json({ success: true, data, message: "Atkı kartı güncellendi." });
}));

/**
 * @openapi
 * /api/weft-specs/{id}:
 *   delete:
 *     tags: [WeftSpecs]
 *     summary: Atkı kartını pasife al (silinmez)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: Pasife alındı }
 */
router.delete("/:id", requirePermission("warpspec:write"), wrap(async (req, res) => {
  const { id } = idParam.parse(req.params);
  res.status(200).json({ success: true, data: await deactivateWeftSpec(id, req.user?.userId), message: "Atkı kartı pasife alındı." });
}));

export default router;
