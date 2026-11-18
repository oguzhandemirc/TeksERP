// =============================================================================
// ÇÖZGÜ İHTİYACI → FASON DEVERE ÖNERİSİ (fason devere D8) — salt okuma, hiçbir şey yazmaz.
// =============================================================================
// Talep (kumaş metresi · dokuma işi · sipariş) → çözgü metresi YALNIZ `beam-need.helper` (`warpRequirements` +
// take-up `warpNeedM`); arz `warp-supply.helper` (stok + PLANNED + açık devere kalanı). Açık dokuma işleri öncelik
// sırasıyla arzı `beamNeeds` ile TÜKETİR; kaynak dokuma işiyse kendi sırasındaki sonuç, yeni talep (kumaş/sipariş)
// en sonda kalan serbest arzı görür — aynı çözgü iki talebe sayılmaz, açılmış devere siparişi yeniden önerilmez.
// =============================================================================
import { WeavingOrderStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import type { ApiResponse } from "../types/api.types";
import { TERIM } from "../constants/terim";
import { licenseModuleError } from "../lib/license/module-ceiling";
import { readDevereEnabled, readDokumaEnabled, readProductionEnabled, SETTING_KEYS } from "./system-setting.service";
import { resolveEffectiveConstruction, type EffectiveConstruction } from "./helpers/effective-construction.helper";
import { beamNeeds, readBeamLengthsM, warpRequirements, type GroundWarpRef, type WarpRequirement } from "./helpers/beam-need.helper";
import { buildProductionProposalWithContext, PROPOSAL_CODES } from "./helpers/production-proposal.helper";
import { receivedMetersByWeavingOrder, rollMetersByWeavingOrder } from "./helpers/weaving-order-of-roll.helper";
import { weavingProducedM, weavingRemainingM } from "./helpers/weaving-order-list-progress.helper";
import { lastWarpingSubcontractorBySpec, readWarpSupplyBySpec, type OpenWarpingRef } from "./helpers/warp-supply.helper";
import { qtyText } from "./helpers/qty-text.helper";

export type WarpNeedInput =
  | { source: "FABRIC"; itemId: string; recipeId?: string | null; fabricM: number }
  | { source: "WEAVING_ORDER"; weavingOrderId: string }
  | { source: "ORDER"; orderId: string };

export const WARP_NEED_WARNING = {
  noGroundWarp: "NO_GROUND_WARP",
  orderClosed: "WEAVING_ORDER_CLOSED",
  openEnded: "OPEN_ENDED",
  linesPlanned: "ORDER_LINES_PLANNED",
  nothingToWeave: "NOTHING_TO_WEAVE",
} as const;

export interface WarpNeedRow {
  demandKey: string;
  itemId: string;
  itemName: string;
  role: WarpRequirement["role"];
  beamMode: WarpRequirement["beamMode"];
  warpSpecId: string;
  warpSpecCode: string;
  warpSpecName: string;
  takeUpPct: number | null;
  ownBeam: boolean;
  /** Bu talebin dokunacak (ham) kumaş metresi. */
  fabricM: number | null;
  /** Gerekli çözgü metresi = kumaş ÷ (1 − take-up); levent yoksa ya da açık uçluysa null. */
  requiredM: number | null;
  /** Kartın toplam arzı (kendi leventi olan satırda). */
  supply: { stockM: number; plannedBeamM: number; openWarpingM: number; totalM: number } | null;
  /** Arzın, öncelikli açık dokuma işlerine ayrılan kısmı. */
  committedM: number | null;
  /** Bu talebe kalan serbest arz. */
  freeM: number | null;
  shortfallM: number | null;
  /** Fason devere siparişi önerisi (eksik > 0); levent boyu ürün yapısı → maliyet parametresi. */
  suggestion: { beamCount: number; beamLengthM: number; totalM: number } | null;
  /** Kartın son devere siparişinin deverecisi (form ön dolumu). */
  subcontractor: { id: string; name: string } | null;
  openWarpingOrders: OpenWarpingRef[];
}

export interface WarpNeedResult {
  source: WarpNeedInput["source"];
  sourceLabel: string;
  /** Sipariş kaynağında devere siparişine bağlanacak müşteri siparişi. */
  salesOrder: { id: string; label: string } | null;
  rows: WarpNeedRow[];
  warnings: Array<{ code: string; message: string }>;
}

interface Demand {
  key: string;
  itemId: string;
  itemName: string;
  recipeId: string | null;
  fabricM: number | null;
  construction: EffectiveConstruction;
  ground: GroundWarpRef | null;
}

const OPEN_WEAVING = [WeavingOrderStatus.PLANNED, WeavingOrderStatus.IN_PROGRESS];

async function assertDevere(): Promise<void> {
  if (!(await readDevereEnabled())) {
    throw licenseModuleError(SETTING_KEYS.DEVERE_ENABLED, "Devere / levent")
      ?? AppError.forbidden("Devere / levent modülü bu kurulumda kapalı.", { code: "MODULE_DISABLED", modul: "devere" });
  }
}

async function dokumaOpen(): Promise<boolean> {
  return (await readProductionEnabled()) && (await readDokumaEnabled());
}

async function assertDokuma(): Promise<void> {
  if (!(await readProductionEnabled())) {
    throw licenseModuleError(SETTING_KEYS.PRODUCTION_ENABLED, "Üretim")
      ?? AppError.forbidden("Üretim modülü kapalı; bu kaynakla çözgü ihtiyacı hesaplanamaz.", { code: "MODULE_DISABLED", modul: "production", dependent: "dokuma" });
  }
  if (!(await readDokumaEnabled())) {
    throw licenseModuleError(SETTING_KEYS.DOKUMA_ENABLED, TERIM.dokumaIsEmri.tekil)
      ?? AppError.forbidden(`${TERIM.dokumaIsEmri.tekil} modülü kapalı; bu kaynakla çözgü ihtiyacı hesaplanamaz.`, { code: "MODULE_DISABLED", modul: "dokuma" });
  }
}

type ConstructionMemo = Map<string, Promise<EffectiveConstruction>>;
function construct(memo: ConstructionMemo, itemId: string, recipeId: string | null): Promise<EffectiveConstruction> {
  const k = `${itemId}|${recipeId ?? ""}`;
  if (!memo.has(k)) memo.set(k, resolveEffectiveConstruction(prisma, itemId, recipeId));
  return memo.get(k)!;
}

/** Açık dokuma işleri öncelik sırasıyla (plan başlangıcı, boşlar sonda · açılış · id) + kalan kumaş metresi. */
async function openWeavingDemands(memo: ConstructionMemo): Promise<Array<Demand & { weavingOrderId: string; number: string }>> {
  const rows = await prisma.weavingOrder.findMany({
    where: { status: { in: OPEN_WEAVING }, cancelledAt: null },
    select: {
      id: true, weavingOrderNumber: true, itemId: true, recipeId: true, plannedM: true, executionKind: true,
      item: { select: { name: true } }, warpSpec: { select: { id: true, code: true, takeUpPct: true } },
    },
    orderBy: [{ plannedStartDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }, { id: "asc" }],
  });
  const ids = rows.map((r) => r.id);
  const meters = await rollMetersByWeavingOrder(prisma, ids);
  const received = await receivedMetersByWeavingOrder(prisma, rows.filter((r) => r.executionKind === "SUBCONTRACTED").map((r) => r.id));
  const out = [];
  for (const r of rows) {
    const m = meters.get(r.id);
    const produced = weavingProducedM(r.executionKind, received.get(r.id) ?? null, m ? Number(m) : null);
    out.push({
      key: `WO:${r.id}`, weavingOrderId: r.id, number: r.weavingOrderNumber, itemId: r.itemId, itemName: r.item.name, recipeId: r.recipeId,
      fabricM: weavingRemainingM(r.plannedM == null ? null : Number(r.plannedM), produced),
      construction: await construct(memo, r.itemId, r.recipeId), ground: r.warpSpec,
    });
  }
  return out;
}

export async function computeWarpNeed(input: WarpNeedInput): Promise<ApiResponse<WarpNeedResult>> {
  await assertDevere();
  const memo: ConstructionMemo = new Map();
  const warnings: WarpNeedResult["warnings"] = [];
  let sourceLabel = "";
  let salesOrder: WarpNeedResult["salesOrder"] = null;
  let targets: Demand[] = [];
  let targetWeavingId: string | null = null;

  if (input.source === "FABRIC") {
    const c = await construct(memo, input.itemId, input.recipeId ?? null);
    const item = await prisma.item.findUnique({ where: { id: input.itemId }, select: { name: true } });
    sourceLabel = `${item?.name ?? "Kumaş"} · ${qtyText(input.fabricM)} m`;
    targets = [{ key: "FABRIC", itemId: input.itemId, itemName: item?.name ?? "", recipeId: input.recipeId ?? null, fabricM: input.fabricM, construction: c, ground: null }];
  } else if (input.source === "WEAVING_ORDER") {
    await assertDokuma();
    const wo = await prisma.weavingOrder.findUnique({ where: { id: input.weavingOrderId }, select: { id: true, weavingOrderNumber: true, status: true } });
    if (!wo) throw AppError.notFound(`${TERIM.dokumaIsEmri.tekil} bulunamadı`);
    sourceLabel = `${TERIM.dokumaIsEmri.tekil} ${wo.weavingOrderNumber}`;
    if (!OPEN_WEAVING.includes(wo.status as (typeof OPEN_WEAVING)[number])) {
      warnings.push({ code: WARP_NEED_WARNING.orderClosed, message: `${TERIM.dokumaIsEmri.tekil} kapalı (tamamlandı/iptal) — çözgü önerisi yok.` });
    } else {
      targetWeavingId = wo.id;
    }
  } else {
    await assertDokuma();
    const { proposal, constructions } = await buildProductionProposalWithContext(prisma, input.orderId, { weaving: true, workOrder: false });
    sourceLabel = `Sipariş ${proposal.orderNumber}`;
    salesOrder = { id: proposal.orderId, label: proposal.orderNumber };
    const planned = proposal.excluded.filter((x) => x.kind === "WEAVING" && x.code === PROPOSAL_CODES.alreadyPlanned).length;
    if (planned > 0) warnings.push({ code: WARP_NEED_WARNING.linesPlanned, message: `${planned} satır zaten bir ${TERIM.dokumaIsEmri.tekil} kaydına bağlı — o satırların çözgüsü açık işler arasında sayıldı.` });
    targets = proposal.weavingOrders.map((g) => ({ key: g.key, itemId: g.itemId, itemName: g.itemName, recipeId: g.recipeId, fabricM: g.plannedM, construction: constructions.get(g.key)!, ground: null }));
    if (targets.length === 0) warnings.push({ code: WARP_NEED_WARNING.nothingToWeave, message: "Siparişte dokunacak açık satır yok." });
  }

  const open = (await dokumaOpen()) ? await openWeavingDemands(memo) : [];
  if (targetWeavingId) {
    const t = open.find((o) => o.weavingOrderId === targetWeavingId);
    if (t) targets = [t];
  }

  // Her talebin çözgü gereksinimi (tek kaynak `warpRequirements`).
  const reqsOf = (d: Demand) => warpRequirements(d.construction, d.ground, d.fabricM);
  const all = [...open, ...(targetWeavingId ? [] : targets)];
  const reqs = new Map(all.map((d) => [d.key, reqsOf(d)]));
  for (const t of targets) {
    if (reqs.get(t.key)!.length === 0) warnings.push({ code: WARP_NEED_WARNING.noGroundWarp, message: `${t.itemName}: zemin çözgüsü tanımlı değil — çözgü ihtiyacı çıkarılamaz.` });
    else if (t.fabricM == null) warnings.push({ code: WARP_NEED_WARNING.openEnded, message: `${t.itemName}: plan metresi yok (açık uçlu) — ihtiyaç hesaplanamaz.` });
  }
  const specIds = [...new Set([...reqs.values()].flat().filter((r) => r.ownBeam).map((r) => r.warpSpecId))];
  const supply = await readWarpSupplyBySpec(prisma, specIds);
  const available = new Map([...supply].map(([id, s]) => [id, s.totalM]));
  const lengths = await readBeamLengthsM(prisma, [...new Set(all.map((d) => d.itemId))]);
  const subs = await lastWarpingSubcontractorBySpec(prisma, specIds);
  const names = new Map((await prisma.warpSpec.findMany({ where: { id: { in: specIds } }, select: { id: true, name: true } })).map((w) => [w.id, w.name]));

  // Tahsis: açık dokuma işleri sırayla; yeni talep sonda. `beamNeeds` `available`ı tüketir.
  const targetKeys = new Set(targets.map((t) => t.key));
  const rows: WarpNeedRow[] = [];
  for (const d of all) {
    const needs = beamNeeds(reqs.get(d.key)!, available, lengths.get(d.itemId) ?? null);
    if (!targetKeys.has(d.key)) continue;
    for (const n of needs) {
      const s = n.ownBeam ? supply.get(n.warpSpecId) ?? null : null;
      rows.push({
        demandKey: d.key, itemId: d.itemId, itemName: d.itemName, role: n.role, beamMode: n.beamMode,
        warpSpecId: n.warpSpecId, warpSpecCode: n.warpSpecCode, warpSpecName: names.get(n.warpSpecId) ?? n.warpSpecCode,
        takeUpPct: n.takeUpPct, ownBeam: n.ownBeam, fabricM: d.fabricM, requiredM: n.requiredM,
        supply: s ? { stockM: s.stockM, plannedBeamM: s.plannedBeamM, openWarpingM: s.openWarpingM, totalM: s.totalM } : null,
        committedM: s && n.availableM != null ? Math.round((s.totalM - n.availableM) * 1000) / 1000 : null,
        freeM: n.availableM, shortfallM: n.shortfallM,
        suggestion: n.proposedBeams ? { beamCount: n.proposedBeams.count, beamLengthM: n.proposedBeams.lengthM, totalM: Math.round(n.proposedBeams.count * n.proposedBeams.lengthM * 1000) / 1000 } : null,
        subcontractor: n.ownBeam ? subs.get(n.warpSpecId) ?? null : null,
        openWarpingOrders: s?.openWarpingOrders ?? [],
      });
    }
  }
  return { success: true, data: { source: input.source, sourceLabel, salesOrder, rows, warnings } };
}
