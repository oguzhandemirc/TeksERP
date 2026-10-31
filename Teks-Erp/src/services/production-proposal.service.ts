// =============================================================================
// SİPARİŞTEN ÜRETİM ÖNERİSİ — önizleme + uygula (SY-M1, tasarım §14.5)
// =============================================================================
// Ne yaratılacağını YALNIZ `production-proposal.helper` söyler; uygula onu kilitlerin arkasında yeniden
// koşar. Kilit sırası: 8036 (istek token'ı, tx'in İLK ifadesi) → sipariş satırları id sırasıyla FOR UPDATE
// → 8032 (dokuma işi numarası, yaratma çekirdeğinin içinde). Yaratma mevcut çekirdeklerle (dokuma işi +
// terbiye iş emri) — ikinci yaratma yolu yazılmaz. Kayıt başına token istek token'ından türer (uuidv5):
// aynı token'ın tekrarı aynı kayıt setini boğazdan (`tokenReplay.behindLock`) replay eder.
// =============================================================================

import { v5 as uuidv5 } from "uuid";
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { ApiResponse } from "../types/api.types";
import { withBarcodeRetry } from "../utils/barcode-retry";
import { p2002OnField } from "../utils/p2002";
import { lockClientTokenTx } from "./helpers/token-replay.helper";
import {
  buildProductionProposal, PROPOSAL_CODES, type ProductionProposal, type ProposalScope, type WeavingProposal, type WorkOrderProposal,
} from "./helpers/production-proposal.helper";
import {
  auditWeavingOrderCreate, insertWeavingOrderTx, prepareWeavingOrderCreate, type WeavingOrderCreateInput,
} from "./weaving-order.service";
import { weavingOrderReplay } from "./helpers/weaving-order-replay.helper";
import { WorkOrderService, type WorkOrderCreateInput } from "./workorder.service";
import { readDokumaEnabled, readOrderProductionProposal, readProductionEnabled } from "./system-setting.service";

/** Route'un izin kataloğundan çözdüğü erişim (anahtar-kapsamlı; servis izin okumaz). */
export interface ProposalAccess {
  readWeaving: boolean;
  writeWeaving: boolean;
  writeWorkOrder: boolean;
}

export interface ProposalApplyInput {
  clientToken: string;
  weavingOrders: Array<{ key: string; orderLineIds: string[]; plannedM: number | null }>;
  workOrders: Array<{ key: string; orderLineIds: string[] }>;
}

export interface ProposalApplyResult {
  weavingOrders: Array<{ id: string; number: string }>;
  workOrders: Array<{ id: string; number: string }>;
}

const workOrderService = new WorkOrderService();
/** Apply tx'i birden çok kayıt yaratır; varsayılan 5 sn interaktif tx sınırı büyük siparişte yetmez. */
const APPLY_TX_OPTIONS = { timeout: 60_000, maxWait: 10_000 } as const;

async function resolveScope(access: ProposalAccess): Promise<ProposalScope> {
  const mode = await readOrderProductionProposal();
  if (mode === "KAPALI") {
    throw AppError.forbidden("Siparişten üretim önerisi bu kurulumda kapalı (Ayarlar → Siparişler).", { code: "PRODUCTION_PROPOSAL_DISABLED" });
  }
  const production = await readProductionEnabled();
  if (!production) throw AppError.forbidden("Üretim modülü kapalı; üretim önerisi açılamaz.", { code: "MODULE_DISABLED", modul: "production" });
  const dokuma = await readDokumaEnabled();
  return { weaving: dokuma && access.readWeaving, workOrder: true };
}

export async function previewProductionProposal(
  orderId: string, access: ProposalAccess,
): Promise<ApiResponse<ProductionProposal & { canCreate: { weaving: boolean; workOrder: boolean } }>> {
  const scope = await resolveScope(access);
  const proposal = await buildProductionProposal(prisma, orderId, scope);
  return { success: true, data: { ...proposal, canCreate: { weaving: scope.weaving && access.writeWeaving, workOrder: access.writeWorkOrder } } };
}

function parseKey(key: string, prefix: "W" | "I", parts: number): string[] {
  const p = key.split(":");
  if (p[0] !== prefix || p.length !== parts) throw AppError.badRequest("Öneri anahtarı tanınmadı.", { code: "PROPOSAL_KEY_INVALID", key });
  return p.slice(1).map((x) => (x === "-" ? "" : x));
}

function weavingInput(sel: ProposalApplyInput["weavingOrders"][number], token: string, fresh?: WeavingProposal): WeavingOrderCreateInput {
  const [itemId, recipeId] = parseKey(sel.key, "W", 3);
  const alloc = new Map(fresh?.orderLines.map((l) => [l.orderLineId, l.allocatedM]) ?? []);
  return {
    itemId, recipeId: recipeId || null, executionKind: "IN_HOUSE", plannedM: sel.plannedM,
    orderLines: sel.orderLineIds.map((orderLineId) => ({ orderLineId, allocatedM: alloc.get(orderLineId) ?? null })),
    clientToken: uuidv5(`WEAVING|${sel.key}`, token),
  };
}

function workOrderInput(sel: ProposalApplyInput["workOrders"][number], token: string, fresh?: WorkOrderProposal): WorkOrderCreateInput {
  const [itemId] = parseKey(sel.key, "I", 4);
  const alloc = new Map(fresh?.orderLines.map((l) => [l.orderLineId, l.allocatedQty]) ?? []);
  return {
    type: "ORDER_PRODUCTION", targetItemId: itemId, targetColorId: fresh?.colorId ?? null, width: fresh?.width ?? null,
    routeTemplateId: fresh?.routeId ?? null, foldType: fresh?.foldType ?? null, targetQuantity: fresh?.targetQuantity ?? null,
    orderLineAllocations: sel.orderLineIds.map((orderLineId) => ({ orderLineId, allocatedQty: alloc.get(orderLineId) ?? 0 })),
    clientToken: uuidv5(`WORK_ORDER|${sel.key}`, token),
  };
}

/** Türetilmiş token'lar boğazdan okunur: hepsi varsa replay seti, kısmen varsa 409, hiçbiri yoksa null. */
async function readReplaySetTx(tx: Prisma.TransactionClient, input: ProposalApplyInput): Promise<ProposalApplyResult | null> {
  const weaving: ProposalApplyResult["weavingOrders"] = [];
  const workOrders: ProposalApplyResult["workOrders"] = [];
  let missing = 0;
  for (const sel of input.weavingOrders) {
    const w = weavingInput(sel, input.clientToken);
    const r = await weavingOrderReplay(w).behindLock(tx, w.clientToken as string);
    if (r?.data) weaving.push({ id: r.data.id, number: r.data.weavingOrderNumber });
    else missing++;
  }
  for (const sel of input.workOrders) {
    const d = workOrderInput(sel, input.clientToken);
    const r = await workOrderService.woReplay(d).behindLock(tx, d.clientToken as string);
    if (r?.data) workOrders.push({ id: r.data.id, number: r.data.workOrderNumber });
    else missing++;
  }
  if (missing === 0) return { weavingOrders: weaving, workOrders };
  if (weaving.length + workOrders.length === 0) return null;
  throw AppError.conflict("Bu istek anahtarı başka bir seçimle kullanılmış — önizlemeyi yenileyip yeniden deneyin.", { code: "CLIENT_TOKEN_COLLISION" });
}

/** Satır kilidi: eşzamanlı ikinci uygula, birincinin bağlarını görene kadar burada bekler. */
async function lockOrderLinesTx(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM order_lines WHERE "orderId" = ${orderId}::uuid ORDER BY id FOR UPDATE`;
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && [...a].sort().join(",") === [...b].sort().join(",");
}

/** Seçim taze öneriyle birebir değilse 409 — bağlanmış satır `ORDER_LINE_ALREADY_PLANNED` + liste. */
function assertSelectionCurrent(
  fresh: ProductionProposal, kind: "WEAVING" | "WORK_ORDER", sel: { key: string; orderLineIds: string[] },
  group: { orderLines: Array<{ orderLineId: string }> } | undefined,
): void {
  const planned = new Set(fresh.excluded.filter((e) => e.kind === kind && e.code === PROPOSAL_CODES.alreadyPlanned).map((e) => e.orderLineId));
  const taken = sel.orderLineIds.filter((id) => planned.has(id));
  if (taken.length > 0) {
    throw AppError.conflict("Seçilen sipariş satırlarından bazıları bu arada planlanmış — önizlemeyi yenileyin.", { code: PROPOSAL_CODES.alreadyPlanned, kind, orderLineIds: taken });
  }
  if (!group || !sameSet(group.orderLines.map((l) => l.orderLineId), sel.orderLineIds)) {
    throw AppError.conflict("Öneri değişmiş — önizlemeyi yenileyin.", { code: "PROPOSAL_STALE", key: sel.key });
  }
}

interface CreatedSet {
  weaving: Array<Awaited<ReturnType<typeof insertWeavingOrderTx>>>;
  workOrders: Array<{ wo: Awaited<ReturnType<WorkOrderService["insertPreparedTx"]>>; prep: Awaited<ReturnType<WorkOrderService["prepareCreate"]>> }>;
}

async function createSelectedTx(tx: Prisma.TransactionClient, fresh: ProductionProposal, input: ProposalApplyInput, userId?: string): Promise<CreatedSet> {
  const out: CreatedSet = { weaving: [], workOrders: [] };
  for (const sel of input.weavingOrders) {
    const g = fresh.weavingOrders.find((x) => x.key === sel.key);
    assertSelectionCurrent(fresh, "WEAVING", sel, g);
    const w = weavingInput(sel, input.clientToken, g);
    out.weaving.push(await insertWeavingOrderTx(tx, w, await prepareWeavingOrderCreate(w), userId));
  }
  for (const sel of input.workOrders) {
    const g = fresh.workOrders.find((x) => x.key === sel.key);
    assertSelectionCurrent(fresh, "WORK_ORDER", sel, g);
    if (g?.blockedCode) throw AppError.conflict("Bu iş emri grubunun rotası çözülemedi; formdan açın.", { code: g.blockedCode, key: sel.key });
    const prep = await workOrderService.prepareCreate(workOrderInput(sel, input.clientToken, g));
    out.workOrders.push({ wo: await workOrderService.insertPreparedTx(tx, prep, userId, tx), prep });
  }
  return out;
}

function assertApplyAllowed(input: ProposalApplyInput, scope: ProposalScope, access: ProposalAccess): void {
  if (input.weavingOrders.length + input.workOrders.length === 0) throw AppError.badRequest("Oluşturulacak en az bir kayıt seçin.");
  if (input.weavingOrders.length > 0 && !scope.weaving) {
    throw AppError.forbidden("Dokuma iş emri bu kurulumda ya da yetkinizde yok.", { code: "MODULE_DISABLED", modul: "dokuma" });
  }
  if (input.weavingOrders.length > 0 && !access.writeWeaving) throw AppError.forbidden("Dokuma iş emri oluşturma yetkiniz yok.", { code: "PERMISSION_DENIED", required: "weavingorder:write" });
  if (input.workOrders.length > 0 && !access.writeWorkOrder) throw AppError.forbidden("Terbiye iş emri oluşturma yetkiniz yok.", { code: "PERMISSION_DENIED", required: "workorder:write" });
}

export async function applyProductionProposal(
  orderId: string, input: ProposalApplyInput, access: ProposalAccess, userId?: string,
): Promise<ApiResponse<ProposalApplyResult> & { idempotentReplay?: boolean }> {
  const scope = await resolveScope(access);
  assertApplyAllowed(input, scope, access);
  const outcome = await withBarcodeRetry(
    () => prisma.$transaction(async (tx) => {
      await lockClientTokenTx(tx, input.clientToken);
      const replay = await readReplaySetTx(tx, input);
      if (replay) return { replay };
      await lockOrderLinesTx(tx, orderId);
      const fresh = await buildProductionProposal(tx, orderId, scope);
      return { created: await createSelectedTx(tx, fresh, input, userId) };
    }, APPLY_TX_OPTIONS),
    undefined,
    (err) => p2002OnField(err, "weavingOrderNumber") || p2002OnField(err, "workOrderNumber"),
  );
  if ("replay" in outcome && outcome.replay) {
    return { success: true, data: outcome.replay, message: "Üretim önerisi zaten uygulanmış", idempotentReplay: true };
  }
  return finishApply(outcome.created as CreatedSet, userId);
}

/** Audit tx DIŞINDA, kayıt başına (mevcut çekirdeklerin kendi audit'i). */
async function finishApply(created: CreatedSet, userId?: string): Promise<ApiResponse<ProposalApplyResult>> {
  const data: ProposalApplyResult = { weavingOrders: [], workOrders: [] };
  const warnings: string[] = [];
  for (const w of created.weaving) {
    const r = w.fresh ? await auditWeavingOrderCreate(w.row, userId) : w.replay;
    if (r.data) data.weavingOrders.push({ id: r.data.id, number: r.data.weavingOrderNumber });
  }
  for (const { wo, prep } of created.workOrders) {
    const r = await workOrderService.finishCreate(wo, prep, userId);
    data.workOrders.push({ id: wo.id, number: wo.workOrderNumber });
    warnings.push(...(r.warnings ?? []));
  }
  const n = data.weavingOrders.length + data.workOrders.length;
  return { success: true, data, message: `${n} kayıt oluşturuldu`, ...(warnings.length > 0 ? { warnings } : {}) };
}
