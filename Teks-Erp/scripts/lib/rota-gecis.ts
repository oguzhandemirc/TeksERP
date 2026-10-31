// =============================================================================
// ROTA GEÇİŞİ — SY-G2 (TASARIM-2026-10-31 §8.5 md. 3–4, §8.8)
// =============================================================================
// Kurşun/tambur dışarıdan içeriye geçerken rota şablonu VERİSİ değişir: eski rotayı
// kullanan varyantlar (`ProductRecipe.routeId`) yeni rotaya alınır. Açık iş emirleri
// kendi adım snapshot'ını korur (dokunulmaz, yalnız listelenir); yeni iş emri yeni rotayla doğar.
// Yazım varyant başına ATOMİK CLAIM (`updateMany WHERE {id, routeId: eski}`) + audit;
// arada başka biri rotayı değiştirdiyse kayıt ATLANIR, üzerine yazılmaz.
// =============================================================================
import { StationType } from "@prisma/client";
import prisma from "../../src/lib/prisma";
import { AuditService } from "../../src/services/audit.service";
import { OPEN_WORK_ORDER } from "../../src/services/helpers/live-ref-where.helper";

export interface RouteRef {
  id: string;
  code: string | null;
  name: string;
  isActive: boolean;
  lastStep: { stationName: string; external: boolean } | null;
}

export interface VariantRow {
  id: string;
  code: string;
  name: string;
  openWorkOrders: string[];
}

export interface SwitchPlan {
  from: RouteRef;
  to: RouteRef;
  variants: VariantRow[];
  /** Eski rotadan türemiş açık iş emirleri — snapshot'larını korur, DEĞİŞMEZ. */
  openWorkOrders: { number: string; status: string }[];
}

/**
 * Son adımı fason (EXTERNAL) olan rotada ne olur — 2026-10-31 ölçümü
 * (`scripts/test_seyitoglu_rota_gecis.ts` §1–§2). `finalizeRollsAtLastStep` ÇALIŞMAZ;
 * kabul kendi son-adım dalından finalize eder (subcontractor.service `bornStatus`).
 */
export const EXTERNAL_LAST_STEP_NOTE =
  "Son adım fason: TAM kabulde doğan toplar WAREHOUSE + barkod + form ACIK doğar ve iş emri kapanır " +
  "(top kapanır); kalite NULL kalır. Kalite isteniyorsa rotaya iç \"Son kontrol\" adımı ekleyin.";

export class RouteSwitchError extends Error {}

/** Kod ya da tam ad ile rota; iki farklı rotaya eşleşirse belirsiz → hata (fail-closed). */
export async function resolveRoute(ref: string): Promise<RouteRef> {
  const rows = await prisma.route.findMany({
    where: { OR: [{ code: ref }, { name: ref }] },
    select: {
      id: true,
      code: true,
      name: true,
      isActive: true,
      steps: { orderBy: { sequence: "desc" }, take: 1, select: { station: { select: { name: true, type: true } } } },
    },
  });
  if (rows.length === 0) throw new RouteSwitchError(`rota bulunamadı: ${ref}`);
  if (rows.length > 1) throw new RouteSwitchError(`rota belirsiz (kod/ad iki rotaya eşleşiyor): ${ref}`);
  const r = rows[0]!;
  const last = r.steps[0]?.station;
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    isActive: r.isActive,
    lastStep: last ? { stationName: last.name, external: last.type === StationType.EXTERNAL } : null,
  };
}

export async function planRouteSwitch(fromRef: string, toRef: string): Promise<SwitchPlan> {
  const from = await resolveRoute(fromRef);
  const to = await resolveRoute(toRef);
  if (from.id === to.id) throw new RouteSwitchError("eski ve yeni rota aynı");
  // Reçete servisinin kapısıyla aynı: pasif rotaya reçete bağlanmaz.
  if (!to.isActive) throw new RouteSwitchError(`yeni rota pasif: ${toRef}`);
  if (!to.lastStep) throw new RouteSwitchError(`yeni rotanın adımı yok: ${toRef}`);

  const recipes = await prisma.productRecipe.findMany({
    where: { routeId: from.id, isActive: true },
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true, itemId: true, colorId: true },
  });
  const openWos = await prisma.workOrder.findMany({
    where: { ...OPEN_WORK_ORDER, routeTemplateId: from.id },
    orderBy: { workOrderNumber: "asc" },
    select: { workOrderNumber: true, status: true, targetItemId: true, targetColorId: true },
  });
  // İş emri reçeteye bağlı değil: varyantın açık işi = aynı kalem (+ varyant renkliyse aynı renk).
  const variants = recipes.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    openWorkOrders: openWos
      .filter((w) => w.targetItemId === r.itemId && (r.colorId === null || w.targetColorId === r.colorId))
      .map((w) => w.workOrderNumber),
  }));
  return {
    from,
    to,
    variants,
    openWorkOrders: openWos.map((w) => ({ number: w.workOrderNumber, status: w.status })),
  };
}

/** Varyant başına atomik claim + audit; dönen: yazılan ve (başkası değiştirdiği için) atlanan kodlar. */
export async function applyRouteSwitch(
  plan: SwitchPlan,
  userId: string,
): Promise<{ written: string[]; skipped: string[] }> {
  const written: string[] = [];
  const skipped: string[] = [];
  for (const v of plan.variants) {
    const res = await prisma.productRecipe.updateMany({
      where: { id: v.id, routeId: plan.from.id },
      data: { routeId: plan.to.id },
    });
    if (res.count === 0) {
      skipped.push(v.code);
      continue;
    }
    written.push(v.code);
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "PRODUCT_RECIPE",
      recordId: v.id,
      oldData: { routeId: plan.from.id },
      newData: { routeId: plan.to.id },
    });
  }
  return { written, skipped };
}

export function describeRoute(r: RouteRef): string {
  const last = r.lastStep ? `son adım: ${r.lastStep.stationName}${r.lastStep.external ? " (fason)" : ""}` : "adımsız";
  return `${r.code ? `${r.code} · ` : ""}${r.name} (${last}${r.isActive ? "" : ", PASİF"})`;
}
