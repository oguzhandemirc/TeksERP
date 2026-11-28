// =============================================================================
// TeksERP — FASON DEVERE SİPARİŞİ (`/api/warping-orders`, devere D4)
// =============================================================================
// Kapı sırası: `verifyToken` → `requireDevereEnabled` → izin. İplik kapısı sipariş CRUD'una konmaz (stok sütunu iplik
// kapalıyken `null` = bilinmiyor); iplik HAREKETİ yazan sevk uçları (D4b) `requireIplikEnabled`'ı uç başına alır. Plan sunucuda hesaplanır; istemci sayı türetmez.
// =============================================================================
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { Currency, WarpingFeeUnit, WarpingOrderStatus } from "@prisma/client";
import { AppError } from "../utils/app-error";
import { verifyToken } from "../middlewares/auth.middleware";
import { matchesPermission, requirePermission } from "../middlewares/rbac.middleware";
import { requireDevereEnabled, requireIplikEnabled } from "../middlewares/module.middleware";
import { dispatchWarpingOrder, getWarpingInstruction, previewWarpingDispatch, WARPING_DISPATCH_MAX_LINES } from "../services/warping-order/dispatch";
import { cancelWarpingDispatch, previewCancelWarpingDispatch } from "../services/warping-order/dispatch-cancel";
import { assertNoBareFilterParams, parseQueryParams, readFilterList, readIdCondition } from "../utils/query-parser";
import { createWarpingOrder, patchWarpingOrder, previewWarpingOrder, WARPING_ORDER_MAX_SALES_ORDERS } from "../services/warping-order/create";
import { cancelPreviewWarpingOrder, cancelWarpingOrder } from "../services/warping-order/cancel";
import { getWarpingOrder, listWarpingOrders } from "../services/warping-order/read";
import { getWarpingOrderFeeSummary } from "../services/warping-order/fee-summary";
import { listWarpingDelays, WARPING_DELAY_STATES, type WarpingDelayState } from "../services/warping-order/delays";
import { WARPING_ORDER_MAX_BEAM_LINES, WARPING_ORDER_MAX_EXTRA_SPECS, WARPING_ORDER_MAX_TARGET_M } from "../services/warping-order/plan";
import warpingOrderYarnRoutes from "./warping-order-yarn.routes";
import warpingOrderReceiveRoutes from "./warping-order-receive.routes";
import warpingOrderSettleRoutes from "./warping-order-settle.routes";
import { qtyText } from "../services/helpers/qty-text.helper";
import "../types/express-augment";
import { BEAM_BODY_DISPATCH_MAX } from "../constants/beam-body";

const router = Router();
router.use(verifyToken, requireDevereEnabled);
// D4b-2 iplik iade/aktarma alt router'ı kapıyı BURADAN miras alır; `/:id`den ÖNCE (statik `/yarn-at-subcontractor` yolu).
router.use("/", warpingOrderYarnRoutes);
// D5a dönüş kabulü alt router'ı — aynı miras ve `/:id`den önce.
router.use("/", warpingOrderReceiveRoutes);
// D5b kapanış / yeniden açma alt router'ı — aynı miras ve `/:id`den önce.
router.use("/", warpingOrderSettleRoutes);

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
const BeamLine = z.strictObject({
  beamCount: z.number({ message: "Levent adedi sayı olmalı" }).int("Levent adedi tam sayı olmalı").positive("Levent adedi sıfırdan büyük olmalı").max(10_000, "Levent adedi çok büyük"),
  beamLengthM: z.number({ message: "Levent boyu sayı olmalı" }).positive("Levent boyu sıfırdan büyük olmalı").max(1_000_000, "Levent boyu çok büyük"),
});
const PlanFields = {
  // Hedef: beamLines YA DA openTargetLengthM (adet belli değil) — tam birini servis `resolvePlanTarget` denetler.
  beamLines: z.array(BeamLine).min(1, "En az bir levent satırı gerekli").max(WARPING_ORDER_MAX_BEAM_LINES, `En çok ${WARPING_ORDER_MAX_BEAM_LINES} levent satırı`).optional(),
  openTargetLengthM: z.number({ message: "Toplam metre sayı olmalı" }).positive("Toplam metre sıfırdan büyük olmalı").max(WARPING_ORDER_MAX_TARGET_M, "Toplam metre çok büyük").optional(),
  extraWarpSpecIds: z.array(Id).max(WARPING_ORDER_MAX_EXTRA_SPECS, `En çok ${WARPING_ORDER_MAX_EXTRA_SPECS} ek tel grubu`).optional(),
  fixedWasteM: z.number({ message: "Sabit fire sayı olmalı" }).min(0, "Sabit fire negatif olamaz").max(1000, "Sabit fire en çok 1000 m").optional(),
};
const MetaFields = {
  salesOrderIds: z.array(Id).max(WARPING_ORDER_MAX_SALES_ORDERS, `En çok ${WARPING_ORDER_MAX_SALES_ORDERS} müşteri siparişi`).optional(),
  wasteTolerancePct: z.number({ message: "Fire toleransı sayı olmalı" }).min(0, "Fire toleransı negatif olamaz").max(99, "Fire toleransı en çok %99").nullable().optional(),
  feeUnit: z.enum(WarpingFeeUnit, { message: "Ücret birimi METRE, KG ya da ENDS_METRE olmalı" }).optional(),
  feeUnitPrice: z.number({ message: "Devere ücreti sayı olmalı" }).min(0, "Devere ücreti negatif olamaz").max(1_000_000, "Devere ücreti çok büyük").nullable().optional(),
  feeCurrency: z.enum(Currency, { message: "Para birimi geçersiz" }).nullable().optional(),
  expectedReturnAt: z.iso.datetime({ offset: true, message: "Termin ISO tarih-saat olmalı" }).nullable().optional(),
  notes: z.string().max(500, "Not en çok 500 karakter").nullable().optional(),
};
/** Devere H1: koli / bobin adedi — BİLGİ (defter değil, kg tek kaynak); boş = girilmedi. */
const PieceCount = (ad: string) => z.number({ message: `${ad} sayı olmalı` }).int(`${ad} tam sayı olmalı`).positive(`${ad} sıfırdan büyük olmalı`).max(100_000, `${ad} çok büyük`).nullable().optional();
const DispatchLine = z.strictObject({
  yarnItemId: Id,
  warehouseId: Id,
  lotId: Id.nullable().optional(),
  qtyKg: z.number({ message: "İplik kg sayı olmalı" }).positive("İplik kg sıfırdan büyük olmalı").max(1_000_000, "İplik kg çok büyük"),
  packageCount: PieceCount("Koli adedi"),
  bobbinCount: PieceCount("Bobin adedi"),
});
const DispatchLines = z.array(DispatchLine).min(1, "En az bir iplik satırı gerekli").max(WARPING_DISPATCH_MAX_LINES, `En çok ${WARPING_DISPATCH_MAX_LINES} iplik satırı`);
const PreviewBody = z.strictObject({ warpSpecId: Id, ...PlanFields });
const CreateBody = z.strictObject({
  clientToken: z.uuid("clientToken geçersiz (UUID)"), warpSpecId: Id, subcontractorId: Id, ...PlanFields, ...MetaFields,
  // D2: sipariş açılırken ilk iplik sevki (opsiyonel; yoksa bugünkü gibi sevksiz).
  initialDispatch: z.strictObject({ lines: DispatchLines }).optional(),
});
const PatchBody = z.strictObject({ ...PlanFields, ...MetaFields });
const CancelBody = z.strictObject({ reason: z.string().trim().min(3, "İptal sebebi en az 3 karakter").max(300, "İptal sebebi en çok 300 karakter") });
const ListQuery = z.object({
  search: z.string().max(64).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
}).passthrough();
const FILTERS = ["status", "subcontractorId", "warpSpecId", "salesOrderId", "from", "to", "feeInvoiced"];
const FEE_STATES = ["NONE", "PARTIAL", "FULL"] as const;
const DELAY_FILTERS = ["state", "subcontractorId"];
const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * @openapi
 * /api/warping-orders:
 *   get:
 *     tags: [WarpingOrder]
 *     summary: Fason devere siparişleri — liste + cursor + özet şeridi (tek where)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: "filter[status]", schema: { type: string }, description: "CSV — OPEN, IN_PROGRESS, COMPLETED, CANCELLED" }
 *       - { in: query, name: "filter[subcontractorId]", schema: { type: string }, description: "CSV devereci id" }
 *       - { in: query, name: "filter[warpSpecId]", schema: { type: string }, description: "CSV çözgü kartı id" }
 *       - { in: query, name: "filter[salesOrderId]", schema: { type: string }, description: "CSV müşteri siparişi id" }
 *       - { in: query, name: "filter[from]", schema: { type: string, format: date }, description: "Fabrika günü (createdAt)" }
 *       - { in: query, name: "filter[to]", schema: { type: string, format: date } }
 *       - { in: query, name: search, schema: { type: string }, description: "Sipariş no" }
 *       - { in: query, name: cursor, schema: { type: string } }
 *       - { in: query, name: limit, schema: { type: integer, maximum: 200 } }
 *     responses:
 *       200: { description: "{ success, data, nextCursor, summary }" }
 *       400: { description: Tanınmayan/geçersiz süzgeç (FILTER_UNKNOWN · FILTER_INVALID) }
 *       403: { description: Devere modülü kapalı (MODULE_DISABLED) ya da warping-order:read yok }
 *   post:
 *     tags: [WarpingOrder]
 *     summary: Fason devere siparişi aç (plan sunucuda hesaplanır ve donar; clientToken idempotent)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [clientToken, warpSpecId, subcontractorId]
 *             properties:
 *               clientToken: { type: string, format: uuid }
 *               warpSpecId: { type: string, format: uuid }
 *               subcontractorId: { type: string, format: uuid }
 *               beamLines: { type: array, description: "openTargetLengthM ile birlikte verilmez", items: { type: object, properties: { beamCount: { type: integer }, beamLengthM: { type: number } } } }
 *               openTargetLengthM: { type: number, description: "Levent adedi belli değil — yalnız toplam metre (adet kabulde çıkar)" }
 *               extraWarpSpecIds: { type: array, items: { type: string, format: uuid }, description: "Aynı levente sarılan ek tel grubu kartları" }
 *               salesOrderIds: { type: array, items: { type: string, format: uuid }, description: "K3 — boş = stoğa çözgü" }
 *               fixedWasteM: { type: number, description: "Verilmezse devere.warpFixedWasteM" }
 *               wasteTolerancePct: { type: number, nullable: true, description: "Verilmezse devere.fasonWasteTolerancePct (0 = denetim yok)" }
 *               feeUnit: { type: string, enum: [METRE, KG, ENDS_METRE] }
 *               feeUnitPrice: { type: number, nullable: true }
 *               feeCurrency: { type: string, nullable: true }
 *               expectedReturnAt: { type: string, format: date-time, nullable: true }
 *               notes: { type: string, nullable: true }
 *               initialDispatch: { type: object, description: "D2 — ilk iplik sevki aynı işlemde (sevk ucunun satır biçimi: yarnItemId, warehouseId, lotId, qtyKg, packageCount, bobbinCount); iplik modülü kapalıysa 403", properties: { lines: { type: array, items: { type: object } } } }
 *     responses:
 *       201: { description: "Sipariş açıldı — data.initialDispatch { id, dispatchNo, yarnTotalKg } | null; sevk uyarıları warnings" }
 *       200: { description: Aynı denemenin tekrarı (replay) }
 *       400: { description: "WARP_SPEC_INACTIVE · YARN_DENIER_MISSING · WARPING_EXTRA_NOT_SHARED · SALES_ORDER_CANCELLED · VALIDATION_ERROR" }
 *       409: { description: "WARPING_ORDER_CANCELLED · CLIENT_TOKEN_COLLISION" }
 */
router.get("/", requirePermission("warping-order:read"), wrap(async (req) => {
  assertNoBareFilterParams(req, FILTERS);
  const f = parseQueryParams(req).filters;
  const unknown = Object.keys(f).filter((k) => !FILTERS.includes(k));
  if (unknown.length > 0) throw AppError.badRequest(`Tanınmayan süzgeç: ${unknown.join(", ")}`, { code: "FILTER_UNKNOWN", params: unknown });
  const status = readFilterList(f.status);
  const bad = status.find((s) => !(Object.values(WarpingOrderStatus) as string[]).includes(s));
  if (bad) throw AppError.badRequest(`filter[status] geçersiz: ${bad}`, { code: "FILTER_INVALID" });
  // Devere A1: fatura durumu süzgeci fatura bilgisidir → finance:read ister (yoksa 403 değil, 400 fail-closed).
  const feeInvoiced = readFilterList(f.feeInvoiced);
  const badFee = feeInvoiced.find((s) => !(FEE_STATES as readonly string[]).includes(s));
  if (badFee) throw AppError.badRequest(`filter[feeInvoiced] geçersiz: ${badFee} (NONE · PARTIAL · FULL)`, { code: "FILTER_INVALID" });
  if (feeInvoiced.length > 0 && !matchesPermission(req.user?.permissions ?? [], "finance:read")) {
    throw AppError.badRequest("Fatura durumu süzgeci için ön muhasebe okuma izni gerekli.", { code: "FILTER_INVALID" });
  }
  const one =(k: "from" | "to"): string | undefined => {
    const v = readFilterList(f[k]);
    if (v.length === 0) return undefined;
    if (v.length > 1 || !YMD.test(v[0]!)) throw AppError.badRequest(`filter[${k}] YYYY-AA-GG olmalı.`, { code: "FILTER_INVALID" });
    return v[0];
  };
  const q = parse(ListQuery, req.query);
  const out = await listWarpingOrders({
    status: status as WarpingOrderStatus[],
    subcontractorId: readIdCondition(f.subcontractorId),
    warpSpecId: readIdCondition(f.warpSpecId),
    salesOrderId: readIdCondition(f.salesOrderId),
    feeInvoiced: feeInvoiced as Array<(typeof FEE_STATES)[number]>,
    from: one("from"),
    to: one("to"),
    search: q.search,
    cursor: q.cursor,
    limit: q.limit,
  });
  return { status: 200, body: { success: true, ...out } };
}));

/** D2: ilk sevk iplik HAREKETİ yazar → iplik kapısı yalnız `initialDispatch` gelince (sevksiz sipariş bugünkü gibi kapısız). */
const requireIplikForInitialDispatch = (req: Request, res: Response, next: NextFunction) => {
  const b: unknown = req.body;
  if (b && typeof b === "object" && "initialDispatch" in b && b.initialDispatch != null) return void requireIplikEnabled(req, res, next);
  next();
};

router.post("/", requirePermission("warping-order:write"), requireIplikForInitialDispatch, wrap(async (req) => {
  const body = parse(CreateBody, req.body);
  const out = await createWarpingOrder(body, req.user!.userId);
  const d = out.initialDispatch;
  const opened = `Fason devere siparişi ${out.data.orderNo} açıldı${d ? ` · iplik sevki ${d.dispatchNo} (${qtyText(d.yarnTotalKg)} kg)` : ""}`;
  return {
    status: out.replayed ? 200 : 201,
    body: { success: true, data: { ...out.data, initialDispatch: d }, message: out.replayed ? `${out.data.orderNo} zaten kayıtlı` : opened, ...(out.warnings.length > 0 ? { warnings: out.warnings } : {}) },
  };
}));

/**
 * @openapi
 * /api/warping-orders/preview:
 *   post:
 *     tags: [WarpingOrder]
 *     summary: Sipariş planı önizlemesi — iplik başına formül (firesiz) ve fireli kg, depo stoğu, ek tel grubu önerisi; yazmaz
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ success, data: WarpingOrderPreview }" }
 *       400: { description: Geçersiz kart/satır }
 */
router.post("/preview", requirePermission("warping-order:write"), wrap(async (req) => {
  const body = parse(PreviewBody, req.body);
  return { status: 200, body: { success: true, data: await previewWarpingOrder(body) } };
}));

/**
 * @openapi
 * /api/warping-orders/delays:
 *   get:
 *     tags: [WarpingOrder]
 *     summary: Devere gecikmeleri (D8b) — açık siparişlerden termini geçmiş / 2 gün içinde / terminsiz olanlar (fason kokpiti bandı)
 *     description: |
 *       Etkin termin = sipariş termini, yoksa iptal edilmemiş sevklerin en erken termini; gecikme fabrika günüyle.
 *       Sayaçlar durum süzgecinden bağımsız, devereci süzgecine bağlı. Devere kapalı → 403 MODULE_DISABLED.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: "filter[state]", schema: { type: string, enum: [ALL, OVERDUE, DUE_SOON, NO_DUE_DATE], default: ALL } }
 *       - { in: query, name: "filter[subcontractorId]", schema: { type: string }, description: "uuid; virgülle çoklu" }
 *     responses:
 *       200: { description: "{ success, data: { data: WarpingDelayRow[], summary: { openCount, overdueCount, dueSoonCount, noDueDateCount } }, warnings? }" }
 *       400: { description: FILTER_INVALID · FILTER_UNKNOWN }
 */
router.get("/delays", requirePermission("warping-order:read"), wrap(async (req) => {
  assertNoBareFilterParams(req, DELAY_FILTERS);
  const f = parseQueryParams(req).filters;
  const unknown = Object.keys(f).filter((k) => !DELAY_FILTERS.includes(k));
  if (unknown.length > 0) throw AppError.badRequest(`Tanınmayan süzgeç: ${unknown.join(", ")}`, { code: "FILTER_UNKNOWN", params: unknown });
  const states = readFilterList(f.state);
  if (states.length > 1 || (states[0] !== undefined && !(WARPING_DELAY_STATES as readonly string[]).includes(states[0]))) {
    throw AppError.badRequest("filter[state] tek değer olmalı (ALL · OVERDUE · DUE_SOON · NO_DUE_DATE)", { code: "FILTER_INVALID" });
  }
  const subs = readFilterList(f.subcontractorId);
  if (subs.some((s) => !Id.safeParse(s).success)) throw AppError.badRequest("filter[subcontractorId] geçersiz kimlik.", { code: "FILTER_INVALID" });
  const out = await listWarpingDelays({ state: (states[0] ?? "ALL") as WarpingDelayState, subcontractorIds: subs });
  return { status: 200, body: { success: true, ...out } };
}));

/**
 * @openapi
 * /api/warping-orders/{id}:
 *   get:
 *     tags: [WarpingOrder]
 *     summary: Fason devere siparişi detayı (plan satırları, levent satırları, bağlı müşteri siparişleri)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: "{ success, data }" }
 *       404: { description: WARPING_ORDER_NOT_FOUND }
 *   patch:
 *     tags: [WarpingOrder]
 *     summary: Düzenle — plan alanları yalnız OPEN (sevksiz); not/termin/ücret/tolerans/sipariş bağı OPEN ve IN_PROGRESS
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: Güncel sipariş }
 *       409: { description: WARPING_ORDER_NOT_EDITABLE }
 */
/**
 * @openapi
 * /api/warping-orders/{id}/fee-summary:
 *   get:
 *     tags: [WarpingOrder]
 *     summary: Devere ücreti özeti — kabul başına ölçü ve beklenen ücret (devere A1)
 *     description: >
 *       Beklenen = donuk birim ücret × (metre · nominal kg · tel × metre); fiyatsız sipariş null. Bağlı fatura ve
 *       `invoiceState` yalnız `finance:read` ∧ ön muhasebe açıkken döner (aksi null).
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: "{ data: WarpingFeeOrderDto }" }
 *       404: { description: WARPING_ORDER_NOT_FOUND }
 */
router.get("/:id/fee-summary", requirePermission("warping-order:read"), wrap(async (req) => {
  const id = parse(Id, req.params.id);
  const canReadInvoices = matchesPermission(req.user?.permissions ?? [], "finance:read");
  return { status: 200, body: { success: true, data: await getWarpingOrderFeeSummary(id, { canReadInvoices }) } };
}));

router.get("/:id", requirePermission("warping-order:read"), wrap(async (req) => {
  const id = parse(Id, req.params.id);
  return { status: 200, body: { success: true, data: await getWarpingOrder(id) } };
}));

router.patch("/:id", requirePermission("warping-order:write"), wrap(async (req) => {
  const id = parse(Id, req.params.id);
  const body = parse(PatchBody, req.body);
  const data = await patchWarpingOrder(id, body, req.user!.userId);
  return { status: 200, body: { success: true, data, message: `${data.orderNo} güncellendi` } };
}));

/**
 * @openapi
 * /api/warping-orders/{id}/cancel-preview:
 *   get:
 *     tags: [WarpingOrder]
 *     summary: İptal önizlemesi — iptal edilebilir mi, etkilenen kayıtlar
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: "{ success, data: { canCancel, blockedReason, salesOrders, affected } }" }
 * /api/warping-orders/{id}/cancel:
 *   post:
 *     tags: [WarpingOrder]
 *     summary: Siparişi iptal et (yalnız OPEN — sevksiz; soft, durum geçişi)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: İptal edildi }
 *       409: { description: WARPING_ORDER_NOT_CANCELLABLE }
 */
router.get("/:id/cancel-preview", requirePermission("warping-order:cancel"), wrap(async (req) => {
  const id = parse(Id, req.params.id);
  return { status: 200, body: { success: true, data: await cancelPreviewWarpingOrder(id) } };
}));

router.post("/:id/cancel", requirePermission("warping-order:cancel"), wrap(async (req) => {
  const id = parse(Id, req.params.id);
  const body = parse(CancelBody, req.body);
  const data = await cancelWarpingOrder(id, body.reason, req.user!.userId);
  return { status: 200, body: { success: true, data, message: `${data.orderNo} iptal edildi` } };
}));

// ── D4b: iplik sevki · sevk iptali · çözgü talimatı ─────────────────────────
const DispatchBody = z.strictObject({
  clientToken: z.uuid("clientToken geçersiz (UUID)"),
  lines: DispatchLines,
  plateNumber: z.string().max(32, "Plaka en çok 32 karakter").nullable().optional(),
  driverName: z.string().max(100, "Şoför adı en çok 100 karakter").nullable().optional(),
  notes: z.string().max(500, "Not en çok 500 karakter").nullable().optional(),
  expectedReturnAt: z.iso.datetime({ offset: true, message: "Termin ISO tarih-saat olmalı" }).nullable().optional(),
  // Devere ek B2: iplikle giden boş levent gövdeleri (beamBodyMode OFF iken dolu gelirse 403 BEAM_BODY_MODE_OFF).
  beamBodyIds: z.array(Id).max(BEAM_BODY_DISPATCH_MAX, `En çok ${BEAM_BODY_DISPATCH_MAX} boş gövde`).optional(),
});

/**
 * @openapi
 * /api/warping-orders/{id}/dispatch-preview:
 *   get:
 *     tags: [WarpingOrder]
 *     summary: İplik sevk önizlemesi — iplik başına plan · gönderilen · iade · deverecide · önerilen · depo · eksik; lot kuralı ve sahip
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: "{ success, data: WarpingDispatchPreview }" }
 *       403: { description: Devere ya da iplik modülü kapalı (MODULE_DISABLED) }
 * /api/warping-orders/{id}/dispatch:
 *   post:
 *     tags: [WarpingOrder]
 *     summary: Devereciye iplik sevki (kısmi/çok seferli/plandan fazla meşru; clientToken idempotent) — sipariş IN_PROGRESS olur
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [clientToken, lines]
 *             properties:
 *               clientToken: { type: string, format: uuid }
 *               lines: { type: array, items: { type: object, properties: { yarnItemId: { type: string }, warehouseId: { type: string }, lotId: { type: string, nullable: true }, qtyKg: { type: number }, packageCount: { type: integer, nullable: true, description: "Koli adedi (bilgi)" }, bobbinCount: { type: integer, nullable: true, description: "Bobin adedi (bilgi)" } } } }
 *               plateNumber: { type: string, nullable: true }
 *               driverName: { type: string, nullable: true }
 *               notes: { type: string, nullable: true }
 *               expectedReturnAt: { type: string, format: date-time, nullable: true }
 *               beamBodyIds: { type: array, items: { type: string, format: uuid }, description: "B2: iplikle giden boş levent gövdeleri (EMPTY_STOCK → AT_SUBCONTRACTOR); beamBodyMode OFF iken 403" }
 *     responses:
 *       201: { description: "Sevk açıldı — { data: { dispatch, yarnItems, beamBodies, instruction, warnings } }" }
 *       200: { description: Aynı denemenin tekrarı (replay) }
 *       400: { description: "WARPING_YARN_NOT_IN_PLAN · YARN_LOT_REQUIRED · WARPING_DISPATCH_DUPLICATE_LINE · eksi bakiye" }
 *       403: { description: "MODULE_DISABLED · BEAM_BODY_MODE_OFF (gövde gönderildi, takip kapalı)" }
 *       409: { description: "WARPING_ORDER_NOT_DISPATCHABLE · OWNER_MISMATCH · WARPING_LOT_MIXED · DISPATCH_CANCELLED · CLIENT_TOKEN_COLLISION · BEAM_BODY_STATE · BEAM_BODY_INACTIVE" }
 */
router.get("/:id/dispatch-preview", requirePermission("warping-order:write"), requireIplikEnabled, wrap(async (req) => {
  const id = parse(Id, req.params.id);
  return { status: 200, body: { success: true, data: await previewWarpingDispatch(id) } };
}));

router.post("/:id/dispatch", requirePermission("warping-order:write"), requireIplikEnabled, wrap(async (req) => {
  const id = parse(Id, req.params.id);
  const body = parse(DispatchBody, req.body);
  const out = await dispatchWarpingOrder(id, body, req.user!.userId);
  const { warnings, replayed, ...data } = out;
  return {
    status: replayed ? 200 : 201,
    body: { success: true, data, message: replayed ? `${data.dispatch.dispatchNo} zaten kayıtlı` : `İplik sevki ${data.dispatch.dispatchNo} açıldı (${qtyText(data.yarnTotalKg)} kg)`, ...(warnings.length > 0 ? { warnings } : {}) },
  };
}));

/**
 * @openapi
 * /api/warping-orders/{id}/dispatches/{dispatchId}/cancel-preview:
 *   get:
 *     tags: [WarpingOrder]
 *     summary: Sevk iptali önizlemesi — etkilenen her iplik kalemi, LIFO engeli, sipariş OPEN'a döner mi
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *       - { in: path, name: dispatchId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "{ success, data: WarpingDispatchCancelPreview }" }
 * /api/warping-orders/{id}/dispatches/{dispatchId}/cancel:
 *   post:
 *     tags: [WarpingOrder]
 *     summary: Sevk iptali — iplik depoya geri (SUBCONTRACT_OUT_CANCEL); iade alınmış sevk 409 (LIFO); son canlı sevkte sipariş OPEN
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *       - { in: path, name: dispatchId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: İptal edildi }
 *       409: { description: "YARN_ITEM_RETURNED · DISPATCH_CANCELLED · WARPING_ORDER_NOT_CANCELLABLE" }
 */
router.get("/:id/dispatches/:dispatchId/cancel-preview", requirePermission("warping-order:cancel"), requireIplikEnabled, wrap(async (req) => {
  const id = parse(Id, req.params.id);
  const dispatchId = parse(Id, req.params.dispatchId);
  return { status: 200, body: { success: true, data: await previewCancelWarpingDispatch(id, dispatchId) } };
}));

router.post("/:id/dispatches/:dispatchId/cancel", requirePermission("warping-order:cancel"), requireIplikEnabled, wrap(async (req) => {
  const id = parse(Id, req.params.id);
  const dispatchId = parse(Id, req.params.dispatchId);
  const body = parse(CancelBody, req.body);
  const data = await cancelWarpingDispatch(id, dispatchId, body.reason, req.user!.userId);
  return { status: 200, body: { success: true, data, message: `Sevk ${data.dispatchNo} iptal edildi` } };
}));

/**
 * @openapi
 * /api/warping-orders/{id}/instruction:
 *   get:
 *     tags: [WarpingOrder]
 *     summary: Çözgü talimatı bloğu — kart(lar), iplik başına harf/tel/denye, dizilim, tarak, levent adedi × boy, termin, not (iç kolon yok)
 *     security: [{ bearerAuth: [] }]
 *     parameters: [{ in: path, name: id, required: true, schema: { type: string, format: uuid } }]
 *     responses:
 *       200: { description: "{ success, data: WarpingInstruction }" }
 */
router.get("/:id/instruction", requirePermission("warping-order:read"), wrap(async (req) => {
  const id = parse(Id, req.params.id);
  return { status: 200, body: { success: true, data: await getWarpingInstruction(id) } };
}));

export default router;
