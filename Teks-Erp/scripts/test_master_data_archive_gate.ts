// =============================================================================
// TeksERP - ANA VERİ ARŞİV KAPISI (URUN-YASAM-DONGUSU.md §6, §10.3)
// =============================================================================
// Renk · kumaş özelliği · müşteri · depo · fasoncu: canlı referans varken DELETE ve
// PATCH {isActive:false} 409 `MASTER_DATA_HAS_LIVE_REFERENCES` (+ entity + kayıtlar tek
// tek). Bugünkü "uyar ama bırak" (eski `test_deactivate_impact`) bilerek kalktı.
// Ölçülenler:
//   · aktif rotanın planlı rengi/fasoncusu ENGELLER (1e Q1 revize) — rota·adım listelenir
//   · yapılandırma (ürünün izinli rengi) yalnız UYARIR — kayıt adıyla
//   · eski veride pasif planlı renkli rota: iş emri AÇILIR + `warnings` metni
//   · birleştirmenin hedefi pasif olamaz · (k) Tükenene kadar kartta izinli liste 409
//   · zaten pasif kayıtta düzenleme 409'a takılmaz (form isActive'i yeniden gönderir)
// =============================================================================
import { ItemLifecycleStatus, OrderStatus, RollStatus, StationType } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { ensureTestAdmin } from "./fixture-test-user";
import { colorService } from "../src/routes/color.routes";
import { fabricPropertyService } from "../src/routes/fabric-property.routes";
import { customerService } from "../src/routes/customer.routes";
import { itemService } from "../src/routes/item.routes";
import { warehouseService } from "../src/services/warehouse.service";
import { SubcontractorManagementService } from "../src/services/subcontractor-management.service";
import { MasterDataMergeService } from "../src/services/master-data-merge.service";
import { WorkOrderService } from "../src/services/workorder.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`);
  }
}
type Err = { code: string; status: number; details: Record<string, unknown> };
async function errOf(fn: () => Promise<unknown>): Promise<Err> {
  try {
    await fn();
    return { code: "OK", status: 200, details: {} };
  } catch (e) {
    const d = ((e as { details?: Record<string, unknown> }).details ?? {}) as Record<string, unknown>;
    return { code: String(d.code ?? "ERR"), status: (e as { statusCode?: number }).statusCode ?? 500, details: d };
  }
}
const refTitles = (e: Err, kind: string): string[] =>
  ((e.details.references as Array<{ kind: string; records: Array<{ title: string }> }> | undefined) ?? [])
    .filter((r) => r.kind === kind)
    .flatMap((r) => r.records.map((x) => x.title));

const T = `TST-AG-${Date.now().toString().slice(-7)}`;
const subSvc = new SubcontractorManagementService();
const woSvc = new WorkOrderService();
const ids = { items: [] as string[], colors: [] as string[], props: [] as string[], customers: [] as string[], warehouses: [] as string[], subs: [] as string[], rolls: [] as string[], orders: [] as string[], routes: [] as string[], wos: [] as string[] };

async function mkRoll(tag: string, data: Record<string, unknown>): Promise<string> {
  const r = await prisma.roll.create({
    data: { barcode: `${T}${tag}`.slice(0, 30), initialQty: 50, currentQty: 50, status: RollStatus.WAREHOUSE, ...(data as object) } as never,
    select: { id: true },
  });
  ids.rolls.push(r.id);
  return r.id;
}
async function mkColor(tag: string): Promise<string> {
  const c = await prisma.color.create({ data: { code: `${T}${tag}`.slice(0, 32), name: `${T} RENK ${tag}` }, select: { id: true } });
  ids.colors.push(c.id);
  return c.id;
}
async function mkRoute(tag: string, steps: Array<Record<string, unknown>>): Promise<{ id: string; name: string }> {
  const name = `${T} ROTA ${tag}`;
  const r = await prisma.route.create({ data: { code: `${T}${tag}`.slice(0, 32), name, isActive: true, steps: { create: steps as never } }, select: { id: true } });
  ids.routes.push(r.id);
  return { id: r.id, name };
}

async function main(): Promise<void> {
  const admin = await ensureTestAdmin();
  const need = async (code: string) => {
    const s = await prisma.station.findFirst({ where: { code }, select: { id: true } });
    if (!s) throw new Error(`Seed fixture eksik: istasyon ${code} ('npm run seed:fixtures')`);
    return s.id;
  };
  const ST_BOYA = await need("BOYA_FASON");
  const ST_TAMBUR = await need("TAMBUR_1");
  void StationType;
  const item = (await itemService.create({ name: `${T} KUMAS`, itemType: "FABRIC", unit: "MT" })).data as { id: string; name: string };
  ids.items.push(item.id);

  console.log("=== 1) Renk ===");
  const C1 = await mkColor("C1");
  const roll1 = await mkRoll("R1", { itemId: item.id, colorId: C1 });
  void roll1;
  for (const [ad, fn] of [
    ["DELETE", () => colorService.softDelete(C1, admin.id)],
    ["PATCH isActive:false", () => colorService.update(C1, { isActive: false }, admin.id)],
  ] as const) {
    const e = await errOf(fn);
    check(`renk · canlı top → ${ad} 409 MASTER_DATA_HAS_LIVE_REFERENCES (entity=color)`, e.status === 409 && e.code === "MASTER_DATA_HAS_LIVE_REFERENCES" && e.details.entity === "color", `${e.status} ${e.code}`);
    check(`renk · ${ad} → top barkoduyla listelendi`, refTitles(e, "ROLL").includes(`${T}R1`.slice(0, 30)));
  }
  const C2 = await mkColor("C2");
  const rota = await mkRoute("P1", [{ stationId: ST_BOYA, sequence: 1, plannedColorId: C2 }, { stationId: ST_TAMBUR, sequence: 2 }]);
  const e2 = await errOf(() => colorService.softDelete(C2, admin.id));
  check("⭐ renk · aktif rota planlıyor → 409, rota·adım listelendi (Q1 revize)", e2.code === "MASTER_DATA_HAS_LIVE_REFERENCES" && refTitles(e2, "ROUTE_STEP").includes(`${rota.name} · adım 1`), refTitles(e2, "ROUTE_STEP").join("|"));
  const C3 = await mkColor("C3");
  await prisma.itemAllowedColor.create({ data: { itemId: item.id, colorId: C3 } });
  const ok3 = await colorService.softDelete(C3, admin.id);
  const c3 = await prisma.color.findUniqueOrThrow({ where: { id: C3 }, select: { isActive: true } });
  check("renk · yalnız yapılandırma (izinli liste) → pasife alındı", ok3.success === true && c3.isActive === false);
  check("renk · uyarı kaydı ADIYLA söylüyor (soyut sayı değil)", (ok3.warnings ?? []).some((w) => w.includes("Ürünün izinli rengi") && w.includes(item.name)), (ok3.warnings ?? []).join("|"));
  const e3 = await errOf(() => colorService.update(C3, { isActive: false, name: `${T} RENK C3 YENI` }, admin.id));
  check("zaten pasif kayıtta düzenleme 409'a takılmıyor (form isActive'i yeniden gönderir)", e3.code === "OK", e3.code);

  console.log("\n=== 2) Eski veri: pasif planlı renkli rota → iş emri AÇILIR + uyarı ===");
  const C4 = await mkColor("C4");
  const eski = await mkRoute("P2", [{ stationId: ST_BOYA, sequence: 1, plannedColorId: C4 }, { stationId: ST_TAMBUR, sequence: 2 }]);
  await prisma.color.update({ where: { id: C4 }, data: { isActive: false } }); // kapı öncesi eski veri (doğrudan DB)
  const wo = await woSvc.create({ type: "STOCK_PRODUCTION", targetItemId: item.id, width: 150, routeTemplateId: eski.id }, admin.id);
  ids.wos.push((wo.data as { id: string }).id);
  const ww = (wo as { warnings?: string[] }).warnings ?? [];
  check("⭐ iş emri açıldı (engel değil)", wo.success === true);
  check("⭐ uyarı metni rota + adım + pasif rengi söylüyor", ww.some((w) => w.includes(`Rota '${eski.name}' adım 1 pasif rengi`) && w.includes("fason kabulünde uygulanan rengi seçin")), ww.join("|"));

  console.log("\n=== 3) Kumaş özelliği ===");
  const P1 = (await prisma.fabricProperty.create({ data: { code: `${T}P1`.slice(0, 32), name: `${T} OZELLIK` }, select: { id: true } })).id;
  ids.props.push(P1);
  const rollP = await mkRoll("R2", { itemId: item.id });
  await prisma.rollProperty.create({ data: { rollId: rollP, propertyId: P1 } });
  for (const [ad, fn] of [
    ["DELETE", () => fabricPropertyService.softDelete(P1, admin.id)],
    ["PATCH isActive:false", () => fabricPropertyService.update(P1, { isActive: false }, admin.id)],
  ] as const) {
    const e = await errOf(fn);
    check(`özellik · canlı topun özelliği → ${ad} 409 (entity=fabricProperty)`, e.code === "MASTER_DATA_HAS_LIVE_REFERENCES" && e.details.entity === "fabricProperty", e.code);
  }

  console.log("\n=== 4) Müşteri ===");
  const M1 = (await prisma.customer.create({ data: { code: `${T}M1`.slice(0, 32), name: `${T} MUSTERI` }, select: { id: true } })).id;
  ids.customers.push(M1);
  const o = await prisma.order.create({ data: { orderNumber: `${T}-S1`, customerId: M1, status: OrderStatus.PENDING }, select: { id: true } });
  ids.orders.push(o.id);
  const eD = await errOf(() => customerService.softDelete(M1, admin.id));
  check("müşteri · açık sipariş → DELETE 409, sipariş no listelendi", eD.code === "MASTER_DATA_HAS_LIVE_REFERENCES" && refTitles(eD, "ORDER").includes(`${T}-S1`), eD.code);
  const eP = await errOf(() => customerService.update(M1, { isActive: false }, admin.id));
  check("⭐ müşteri · PATCH isActive:false da 409 (eskiden kapıyı atlıyordu)", eP.code === "MASTER_DATA_HAS_LIVE_REFERENCES", eP.code);

  console.log("\n=== 5) Depo ===");
  const W1 = (await prisma.warehouse.create({ data: { code: `${T}W1`.slice(0, 32), name: `${T} DEPO` }, select: { id: true } })).id;
  ids.warehouses.push(W1);
  await mkRoll("R3", { itemId: item.id, warehouseId: W1 });
  const eW = await errOf(() => warehouseService.softDelete(W1, admin.id));
  check("depo · canlı top → DELETE 409 (entity=warehouse)", eW.code === "MASTER_DATA_HAS_LIVE_REFERENCES" && eW.details.entity === "warehouse", eW.code);
  const eW2 = await errOf(() => warehouseService.update(W1, { isActive: false }, admin.id));
  check("depo · PATCH isActive:false 409", eW2.code === "MASTER_DATA_HAS_LIVE_REFERENCES", eW2.code);

  console.log("\n=== 6) Fasoncu ===");
  const F1 = (await prisma.subcontractor.create({ data: { code: `${T}F1`.slice(0, 32), name: `${T} FASONCU` }, select: { id: true } })).id;
  ids.subs.push(F1);
  const rotaF = await mkRoute("P3", [{ stationId: ST_BOYA, sequence: 1, plannedSubcontractorId: F1 }, { stationId: ST_TAMBUR, sequence: 2 }]);
  const eF = await errOf(() => subSvc.remove(F1, admin.id));
  check("fasoncu · aktif rota planlıyor → remove 409, rota·adım listelendi", eF.code === "MASTER_DATA_HAS_LIVE_REFERENCES" && refTitles(eF, "ROUTE_STEP").includes(`${rotaF.name} · adım 1`), eF.code);
  const eF2 = await errOf(() => subSvc.update(F1, { isActive: false }, admin.id));
  check("fasoncu · update isActive:false 409", eF2.code === "MASTER_DATA_HAS_LIVE_REFERENCES", eF2.code);
  const f1 = await prisma.subcontractor.findUniqueOrThrow({ where: { id: F1 }, select: { isActive: true } });
  check("fasoncu hâlâ aktif (yarım yazım yok)", f1.isActive === true);

  console.log("\n=== 7) Birleştirme hedefi · (k) izinli liste ===");
  const CS = await mkColor("CS");
  const CK = await mkColor("CK");
  await prisma.color.update({ where: { id: CS }, data: { isActive: false } });
  const m = await errOf(() => MasterDataMergeService.merge("color", { survivorId: CS, sourceIds: [CK], reason: "bekçi birleştirme denemesi", acknowledgedConflicts: 0, userId: admin.id }));
  check("pasif hedefe birleştirme 409 MERGE_TARGET_INACTIVE", m.code === "MERGE_TARGET_INACTIVE", m.code);
  await itemService.transitionLifecycle(item.id, ItemLifecycleStatus.PHASE_OUT, null, admin.id);
  const k = await errOf(() => itemService.update(item.id, { allowedColorIds: [] }, admin.id));
  check("(k) Tükenene kadar kartta izinli liste düzenlemesi 409 ITEM_PHASE_OUT", k.code === "ITEM_PHASE_OUT", k.code);
}

async function temizle(): Promise<void> {
  const del = async (fn: () => Promise<unknown>) => fn().catch((e) => console.error("temizlik:", (e as Error).message.slice(0, 120)));
  for (const id of ids.wos) {
    await del(() => prisma.travelerCardScan.deleteMany({ where: { card: { workOrderId: id } } }));
    await del(() => prisma.travelerCard.deleteMany({ where: { workOrderId: id } }));
    await del(() => prisma.workOrderTargetProperty.deleteMany({ where: { workOrderId: id } }));
    await del(() => prisma.workOrderStep.deleteMany({ where: { workOrderId: id } }));
    await del(() => prisma.workOrder.deleteMany({ where: { id } }));
  }
  await del(() => prisma.routeStep.deleteMany({ where: { routeId: { in: ids.routes } } }));
  await del(() => prisma.route.deleteMany({ where: { id: { in: ids.routes } } }));
  await del(() => prisma.rollProperty.deleteMany({ where: { rollId: { in: ids.rolls } } }));
  await del(() => prisma.roll.deleteMany({ where: { id: { in: ids.rolls } } }));
  await del(() => prisma.order.deleteMany({ where: { id: { in: ids.orders } } }));
  await del(() => prisma.itemAllowedColor.deleteMany({ where: { itemId: { in: ids.items } } }));
  const all = [...ids.items, ...ids.colors, ...ids.props, ...ids.customers, ...ids.warehouses, ...ids.subs];
  await del(() => prisma.systemLog.deleteMany({ where: { recordId: { in: all } } }));
  await del(() => prisma.item.deleteMany({ where: { id: { in: ids.items } } }));
  await del(() => prisma.color.deleteMany({ where: { id: { in: ids.colors } } }));
  await del(() => prisma.fabricProperty.deleteMany({ where: { id: { in: ids.props } } }));
  await del(() => prisma.cariAccount.deleteMany({ where: { customerId: { in: ids.customers } } }));
  await del(() => prisma.customer.deleteMany({ where: { id: { in: ids.customers } } }));
  await del(() => prisma.warehouse.deleteMany({ where: { id: { in: ids.warehouses } } }));
  await del(() => prisma.subcontractor.deleteMany({ where: { id: { in: ids.subs } } }));
}

main()
  .catch((e) => {
    console.error("\n💥 ÇÖKTÜ:", e);
    fail++;
  })
  .finally(async () => {
    await temizle();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
