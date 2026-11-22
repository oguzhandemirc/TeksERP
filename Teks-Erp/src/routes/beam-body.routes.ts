// =============================================================================
// TeksERP — LEVENT GÖVDESİ ENVANTERİ (`/api/beam-bodies`, devere ek B1)
// =============================================================================
// Kapı sırası: `verifyToken` → `requireDevereEnabled` → `requireBeamBodyTracking` (OFF → 403 BEAM_BODY_MODE_OFF,
// okuma dahil: yüzey yok = bugünkü davranış) → izin. Durum değişimi bu dosyada YOK: elle geçişler alt-router beam-body-movement.routes (B2), dolu/takma B3.
// =============================================================================
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { BeamBodyStatus } from "@prisma/client";
import { AppError } from "../utils/app-error";
import { verifyToken } from "../middlewares/auth.middleware";
import { requireAnyPermission, requirePermission } from "../middlewares/rbac.middleware";
import { requireBeamBodyTracking, requireDevereEnabled } from "../middlewares/module.middleware";
import { assertNoBareFilterParams, parseQueryParams, readFilterList, readIdCondition } from "../utils/query-parser";
import { getBeamBody, listBeamBodies, listBeamBodyEvents, resolveBeamBody } from "../services/beam-body/read";
import {
  BEAM_BODY_MAX_MACHINES, cancelBeamBodyRegistration, createBeamBody, patchBeamBody, previewCancelBeamBodyRegistration,
} from "../services/beam-body/write";
import { BEAM_BODY_OWNER_KINDS, BEAM_BODY_REGISTER_STATUSES, type BeamBodyOwnerKind } from "../constants/beam-body";
import { BEAM_BODY_COUNT_MAX_CODES, beamBodyCountContext, previewBeamBodyCount } from "../services/beam-body/count";
import beamBodyMovementRoutes from "./beam-body-movement.routes";
import "../types/express-augment";

const router = Router();
router.use(verifyToken, requireDevereEnabled, requireBeamBodyTracking);
// Devere ek D1: tablet dönüş kabulünde gövde QR çözümü (yalnız `/resolve`; yazma uçları panelde).
const MOBILE_DEVERE_KABUL = ["mobile:devere-kabul"] as const;
// Devere ek-2 r: Levent Sarım tableti içeride sarımda gövde QR'ını çözer (aynı salt okuma ucu).
const MOBILE_DEVERE = ["mobile:devere"] as const;
// Devere S7: Gövde Sayımı tableti — yalnız sayım bağlamı + önizleme (salt okuma); düzeltme `beam-body:write` ister.
const MOBILE_BEAM_BODY_COUNT = ["mobile:govde-sayim"] as const;
// B2: elle geçiş + geri alma alt-router'ı kapıyı miras alır.
router.use("/", beamBodyMovementRoutes);

const wrap = (fn: (req: Request) => Promise<{ status: number; body: unknown }>) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    const out = await fn(req);
    res.status(out.status).json(out.body);
  } catch (err) {
    next(err);
  }
};

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) {
    const first = r.error.issues[0];
    throw AppError.badRequest(first?.message ?? "Geçersiz istek", { code: "VALIDATION_ERROR", issues: r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
  }
  return r.data;
}

const Id = z.uuid("Geçersiz kimlik");
const Owner = z.strictObject({
  kind: z.enum(BEAM_BODY_OWNER_KINDS as [BeamBodyOwnerKind, ...BeamBodyOwnerKind[]], { message: "Sahip OURS, WARPER, CUSTOMER ya da OTHER olmalı" }),
  customerId: Id.nullable().optional(),
  subcontractorId: Id.nullable().optional(),
});
const Dims = {
  widthCm: z.number({ message: "Gövde eni sayı olmalı" }).positive("Gövde eni sıfırdan büyük olmalı").max(10_000, "Gövde eni çok büyük").nullable().optional(),
  flangeDiameterCm: z.number({ message: "Flanş çapı sayı olmalı" }).positive("Flanş çapı sıfırdan büyük olmalı").max(10_000, "Flanş çapı çok büyük").nullable().optional(),
  tareKg: z.number({ message: "Dara sayı olmalı" }).positive("Dara sıfırdan büyük olmalı").max(100_000, "Dara çok büyük").nullable().optional(),
};
const MachineIds = z.array(Id).max(BEAM_BODY_MAX_MACHINES, `En çok ${BEAM_BODY_MAX_MACHINES} uyumlu tezgâh`);
const Notes = z.string().max(500, "Not en çok 500 karakter").nullable().optional();
const CreateBody = z.strictObject({
  clientToken: z.uuid("clientToken geçersiz (UUID)"),
  bodyNo: z.string().max(32, "Gövde no en çok 32 karakter").nullable().optional(),
  owner: Owner,
  ...Dims,
  initialStatus: z.enum(BEAM_BODY_REGISTER_STATUSES as [BeamBodyStatus, ...BeamBodyStatus[]], { message: "Başlangıç durumu EMPTY_STOCK ya da AT_SUBCONTRACTOR olmalı" }).optional(),
  warehouseId: Id.nullable().optional(),
  subcontractorId: Id.nullable().optional(),
  machineIds: MachineIds.optional(),
  notes: Notes,
});
const PatchBody = z.strictObject({ owner: Owner.optional(), ...Dims, machineIds: MachineIds.optional(), notes: Notes, isActive: z.boolean().optional() });
const CancelBody = z.strictObject({ reason: z.string().trim().min(3, "İptal sebebi en az 3 karakter").max(300, "İptal sebebi en çok 300 karakter") });
const ResolveQuery = z.object({ code: z.string().trim().min(1, "Gövde no gerekli").max(64, "Gövde no çok uzun") });
const CountPreviewBody = z.strictObject({
  scope: z.union([z.strictObject({ warehouseId: Id.nullable() }), z.strictObject({ subcontractorId: Id })], { message: "Kapsam depo ya da devereci olmalı" }),
  codes: z.array(z.string().trim().min(1, "Boş gövde no").max(64, "Gövde no çok uzun")).max(BEAM_BODY_COUNT_MAX_CODES, `Tek sayımda en çok ${BEAM_BODY_COUNT_MAX_CODES} okutma`),
});
const ListQuery = z.object({
  search: z.string().max(64).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
}).passthrough();
const FILTERS = ["owner", "ownerCustomerId", "status", "subcontractorId", "machineId", "warehouseId", "ownerReturnDue", "active", "minAgeDays"];
const ACTIVE = ["active", "inactive", "all"] as const;

/**
 * @openapi
 * /api/beam-bodies:
 *   get:
 *     tags: [BeamBody]
 *     summary: Levent gövdeleri — liste + cursor + özet şeridi (sahip/durum kırılımı, sahibine iade edilecek; tek where)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: "filter[owner]", schema: { type: string }, description: "CSV — OURS, WARPER, CUSTOMER, OTHER" }
 *       - { in: query, name: "filter[ownerCustomerId]", schema: { type: string }, description: "CSV sahip cari id" }
 *       - { in: query, name: "filter[status]", schema: { type: string }, description: "CSV — BeamBodyStatus" }
 *       - { in: query, name: "filter[subcontractorId]", schema: { type: string }, description: "CSV devereci id" }
 *       - { in: query, name: "filter[machineId]", schema: { type: string }, description: "CSV tezgâh id (takılı olduğu)" }
 *       - { in: query, name: "filter[warehouseId]", schema: { type: string }, description: "CSV depo id" }
 *       - { in: query, name: "filter[ownerReturnDue]", schema: { type: string, enum: ["true"] }, description: "Yalnız sahibine iade edilecekler" }
 *       - { in: query, name: "filter[active]", schema: { type: string, enum: [active, inactive, all], default: active } }
 *       - { in: query, name: search, schema: { type: string }, description: "Gövde no" }
 *       - { in: query, name: cursor, schema: { type: string } }
 *       - { in: query, name: limit, schema: { type: integer, maximum: 200 } }
 *     responses:
 *       200: { description: "{ success, data, nextCursor, summary: { count, byOwner, byStatus, ownerReturnDue } }" }
 *       400: { description: Tanınmayan/geçersiz süzgeç (FILTER_UNKNOWN · FILTER_INVALID) }
 *       403: { description: "MODULE_DISABLED · BEAM_BODY_MODE_OFF · beam-body:read yok" }
 *   post:
 *     tags: [BeamBody]
 *     summary: Levent gövdesi kaydı (no seriden ya da elle; REGISTER olayı; clientToken idempotent)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [clientToken, owner]
 *             properties:
 *               clientToken: { type: string, format: uuid }
 *               bodyNo: { type: string, nullable: true, description: "Boş = seri (LG-00001); elle no büyük/küçük harf duyarsız tekil" }
 *               owner: { type: object, properties: { kind: { type: string, enum: [OURS, WARPER, CUSTOMER, OTHER] }, customerId: { type: string, nullable: true }, subcontractorId: { type: string, nullable: true, description: "WARPER: fason profilinin bağlı carisi sahip olur" } } }
 *               widthCm: { type: number, nullable: true }
 *               flangeDiameterCm: { type: number, nullable: true }
 *               tareKg: { type: number, nullable: true }
 *               initialStatus: { type: string, enum: [EMPTY_STOCK, AT_SUBCONTRACTOR] }
 *               warehouseId: { type: string, nullable: true }
 *               subcontractorId: { type: string, nullable: true, description: "AT_SUBCONTRACTOR'da zorunlu" }
 *               machineIds: { type: array, items: { type: string, format: uuid }, description: "Uyumlu tezgâhlar; boş = her tezgâha uyar" }
 *               notes: { type: string, nullable: true }
 *     responses:
 *       201: { description: Gövde kaydedildi }
 *       200: { description: Aynı denemenin tekrarı (replay) }
 *       400: { description: "BEAM_BODY_OWNER_* · BEAM_BODY_PLACE_* · BEAM_BODY_NO_INVALID · BEAM_BODY_MACHINE_INVALID · VALIDATION_ERROR" }
 *       409: { description: "BEAM_BODY_NO_TAKEN · CLIENT_TOKEN_COLLISION" }
 */
router.get("/", requirePermission("beam-body:read"), wrap(async (req) => {
  assertNoBareFilterParams(req, FILTERS);
  const f = parseQueryParams(req).filters;
  const unknown = Object.keys(f).filter((k) => !FILTERS.includes(k));
  if (unknown.length > 0) throw AppError.badRequest(`Tanınmayan süzgeç: ${unknown.join(", ")}`, { code: "FILTER_UNKNOWN", params: unknown });
  const owner = readFilterList(f.owner);
  const badOwner = owner.find((o) => !(BEAM_BODY_OWNER_KINDS as readonly string[]).includes(o));
  if (badOwner) throw AppError.badRequest(`filter[owner] geçersiz: ${badOwner}`, { code: "FILTER_INVALID" });
  const status = readFilterList(f.status);
  const badStatus = status.find((s) => !(Object.values(BeamBodyStatus) as string[]).includes(s));
  if (badStatus) throw AppError.badRequest(`filter[status] geçersiz: ${badStatus}`, { code: "FILTER_INVALID" });
  const due = readFilterList(f.ownerReturnDue);
  if (due.length > 1 || (due[0] !== undefined && due[0] !== "true" && due[0] !== "false")) throw AppError.badRequest("filter[ownerReturnDue] true ya da false olmalı", { code: "FILTER_INVALID" });
  const active = readFilterList(f.active);
  if (active.length > 1 || (active[0] !== undefined && !(ACTIVE as readonly string[]).includes(active[0]))) throw AppError.badRequest("filter[active] active, inactive ya da all olmalı", { code: "FILTER_INVALID" });
  const age = readFilterList(f.minAgeDays);
  const minAgeDays = age[0] === undefined ? undefined : Number(age[0]);
  if (age.length > 1 || (minAgeDays !== undefined && !(Number.isInteger(minAgeDays) && minAgeDays >= 1 && minAgeDays <= 3650))) throw AppError.badRequest("filter[minAgeDays] 1–3650 arası tam gün olmalı", { code: "FILTER_INVALID" });
  const q = parse(ListQuery, req.query);
  const out = await listBeamBodies({
    minAgeDays,
    owner: owner as BeamBodyOwnerKind[],
    ownerCustomerId: readIdCondition(f.ownerCustomerId),
    status: status as BeamBodyStatus[],
    subcontractorId: readIdCondition(f.subcontractorId),
    machineId: readIdCondition(f.machineId),
    warehouseId: readIdCondition(f.warehouseId),
    ownerReturnDue: due[0] === "true",
    active: (active[0] ?? "active") as (typeof ACTIVE)[number],
    search: q.search,
    cursor: q.cursor,
    limit: q.limit,
  });
  return { status: 200, body: { success: true, ...out } };
}));

router.post("/", requirePermission("beam-body:write"), wrap(async (req) => {
  const body = parse(CreateBody, req.body);
  const out = await createBeamBody(body, req.user!.userId);
  return { status: out.replayed ? 200 : 201, body: { success: true, data: out.data, message: out.replayed ? `${out.data.bodyNo} zaten kayıtlı` : `Levent gövdesi ${out.data.bodyNo} kaydedildi`, ...(out.warnings ? { warnings: out.warnings } : {}) } };
}));

/**
 * @openapi
 * /api/beam-bodies/resolve:
 *   get:
 *     tags: [BeamBody]
 *     summary: QR/barkod çözümü — gövde no (büyük/küçük harf duyarsız tam eşleşme; ayarla esnek eşleşme)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: query, name: code, required: true, schema: { type: string } }]
 *     responses:
 *       200: { description: "{ success, data: BeamBody (+ matchedBy NORMALIZED), warnings? }" }
 *       404: { description: BEAM_BODY_NOT_FOUND }
 *       409: { description: "BEAM_BODY_NO_AMBIGUOUS (details.candidates)" }
 */
router.get("/resolve", requireAnyPermission("beam-body:read", ...MOBILE_DEVERE_KABUL, ...MOBILE_DEVERE), wrap(async (req) => {
  const q = parse(ResolveQuery, req.query);
  const out = await resolveBeamBody(q.code);
  return { status: 200, body: { success: true, data: out.data, ...(out.warnings ? { warnings: out.warnings } : {}) } };
}));

/**
 * @openapi
 * /api/beam-bodies/count-context:
 *   get:
 *     tags: [BeamBody]
 *     summary: Gövde sayımı kapsam seçimi — aktif depolar + gövde bulunduran devereciler, beklenen sayılarıyla (devere S7)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ success, data: { warehouses[], subcontractors[], stockTotal } }" }
 * /api/beam-bodies/count-preview:
 *   post:
 *     tags: [BeamBody]
 *     summary: Gövde okut-say önizlemesi — beklenen ↔ okunan (eşleşen · eksik · başka yerde · tanımsız). YAZMAZ; düzeltme satır başına /{id}/transition
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [scope, codes]
 *             properties:
 *               scope: { type: object, description: "{ warehouseId: uuid | null (bütün depolar) } ya da { subcontractorId: uuid }" }
 *               codes: { type: array, items: { type: string }, maxItems: 1000 }
 *     responses:
 *       200: { description: "{ success, data: { scope, expectedCount, matched[], missing[], unexpected[], unknown[] } }" }
 *       400: { description: "VALIDATION_ERROR · BEAM_BODY_PLACE_INVALID" }
 */
router.get("/count-context", requireAnyPermission("beam-body:read", ...MOBILE_BEAM_BODY_COUNT), wrap(async () => {
  return { status: 200, body: { success: true, data: await beamBodyCountContext() } };
}));

router.post("/count-preview", requireAnyPermission("beam-body:read", ...MOBILE_BEAM_BODY_COUNT), wrap(async (req) => {
  const body = parse(CountPreviewBody, req.body);
  return { status: 200, body: { success: true, data: await previewBeamBodyCount(body.scope, body.codes) } };
}));

/**
 * @openapi
 * /api/beam-bodies/{id}:
 *   get:
 *     tags: [BeamBody]
 *     summary: Levent gövdesi detayı (sahip, ölçüler, yer, uyumlu tezgâhlar)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: "{ success, data }" }
 *       404: { description: BEAM_BODY_NOT_FOUND }
 *   patch:
 *     tags: [BeamBody]
 *     summary: Düzenle — ölçü/not/uyumlu tezgâhlar; sahip yalnız depoda boşken; pasife alma yalnız boş/hurda/iade edilmişken (gövde no değişmez)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: Güncel gövde }
 *       409: { description: BEAM_BODY_BUSY }
 */
router.get("/:id", requirePermission("beam-body:read"), wrap(async (req) => {
  const id = parse(Id, req.params.id);
  return { status: 200, body: { success: true, data: await getBeamBody(id) } };
}));

router.patch("/:id", requirePermission("beam-body:write"), wrap(async (req) => {
  const id = parse(Id, req.params.id);
  const body = parse(PatchBody, req.body);
  const data = await patchBeamBody(id, body, req.user!.userId);
  return { status: 200, body: { success: true, data, message: `${data.bodyNo} güncellendi` } };
}));

/**
 * @openapi
 * /api/beam-bodies/{id}/events:
 *   get:
 *     tags: [BeamBody]
 *     summary: Gövde geçmişi — kronolojik olay defteri (iptal edilen ileri satır işaretli)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: "{ success, data: BeamBodyEvent[] }" }
 */
router.get("/:id/events", requirePermission("beam-body:read"), wrap(async (req) => {
  const id = parse(Id, req.params.id);
  return { status: 200, body: { success: true, data: await listBeamBodyEvents(id) } };
}));

/**
 * @openapi
 * /api/beam-bodies/{id}/cancel-registration/preview:
 *   get:
 *     tags: [BeamBody]
 *     summary: Kayıt iptali önizlemesi — iptal edilebilir mi, kayıttan sonraki hareket sayısı (yazmaz)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: "{ success, data: { body, cancellable, blocker, laterEventCount } }" }
 * /api/beam-bodies/{id}/cancel-registration:
 *   post:
 *     tags: [BeamBody]
 *     summary: Yanlış açılmış kaydı iptal et (REGISTER_CANCEL ters olayı; kart pasif) — yalnız kayıttan sonra hareket yokken
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: İptal edildi }
 *       409: { description: "BEAM_BODY_HAS_HISTORY · BEAM_BODY_EVENT_REVERSED · BEAM_BODY_INACTIVE" }
 */
router.get("/:id/cancel-registration/preview", requirePermission("beam-body:cancel"), wrap(async (req) => {
  const id = parse(Id, req.params.id);
  return { status: 200, body: { success: true, data: await previewCancelBeamBodyRegistration(id) } };
}));

router.post("/:id/cancel-registration", requirePermission("beam-body:cancel"), wrap(async (req) => {
  const id = parse(Id, req.params.id);
  const body = parse(CancelBody, req.body);
  const data = await cancelBeamBodyRegistration(id, body.reason, req.user!.userId);
  return { status: 200, body: { success: true, data, message: `${data.bodyNo} kaydı iptal edildi` } };
}));

export default router;
