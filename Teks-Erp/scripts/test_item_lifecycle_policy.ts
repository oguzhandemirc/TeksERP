// =============================================================================
// TeksERP - Ürün kartı KULLANIM POLİTİKASI (URUN-YASAM-DONGUSU.md §4, §4.1, §10.1)
// =============================================================================
// Sınıf × durum × §4.1 ayar seçeneği tablosu — önce kural motoru (`assertItemUsable`),
// sonra GERÇEK servis çağrıları (KK1 girişi, tambur yolu, sipariş, hızlı sipariş, A2
// uyarısı, fiyat); §4 İE hedef TÜR kapısı (yalnız kumaş; yalnız yeni hedefte). Ayar yazımı `try` içinde, geri alma `finally`de (bekçi sözleşmesi).
//
// ⭐ Bu bekçinin ölçtüğü asıl cümle: "Tükenene kadar" kartın MEVCUT malı akar, karta
// YENİ talep/stok/tanım eklenmez; Pasif kartta hiçbir şey açılmaz ve bu çekirdek kural
// hiçbir ayarla gevşemez.
// =============================================================================
import { ItemLifecycleStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { ensureTestAdmin, testActorId } from "./fixture-test-user";
import { itemService } from "../src/routes/item.routes";
import { InventoryService } from "../src/services/inventory.service";
import { OrderService } from "../src/services/order.service";
import { itemPriceService } from "../src/services/item-price.service";
import { WorkOrderService } from "../src/services/workorder.service";
import { assertItemUsable, type ItemUsage } from "../src/services/helpers/item-usage.helper";
import { PHASE_OUT_LINE_QTY_WARNING } from "../src/services/helpers/item-lifecycle-settings.helper";
import { SETTING_KEYS } from "../src/services/system-setting.service";

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
/** Hata kodu (details.code) — başarılıysa "OK". */
async function codeOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "OK";
  } catch (e) {
    const d = (e as { details?: { code?: string } }).details;
    return d?.code ?? `ERR:${(e as Error).message.slice(0, 60)}`;
  }
}

const TAG = `TST-YD-${Date.now()}`;
const inventory = new InventoryService();
const orderSvc = new OrderService({
  modelName: "order",
  tableName: "ORDER",
  searchFields: [],
  codeSearchFields: ["orderNumber"],
  defaultInclude: { lines: true },
  nestedCreateFields: ["lines"],
});
const woSvc = new WorkOrderService();
const itemIds: string[] = [];
const orderIds: string[] = [];
const woIds: string[] = [];
const stationIds: string[] = [];
let customerId = "";
const SETTING_KEYS_TOUCHED = [
  SETTING_KEYS.ITEM_LIFECYCLE_PHASE_OUT_NEW_ORDER,
  SETTING_KEYS.ITEM_LIFECYCLE_PHASE_OUT_LINE_QTY,
  SETTING_KEYS.ITEM_LIFECYCLE_PHASE_OUT_NEW_PLAN,
];
const originalSettings = new Map<string, unknown>();

async function setSetting(key: string, value: string | boolean): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { key },
    update: { value },
    create: { key, value, description: `${TAG} bekçi` },
  });
}

async function mkItem(suffix: string, itemType: "FABRIC" | "YARN" = "FABRIC"): Promise<string> {
  const r = await itemService.create({ name: `${TAG} ${suffix}`, itemType, unit: itemType === "YARN" ? "KG" : "MT" }, await testActorId());
  const id = (r.data as { id: string }).id;
  itemIds.push(id);
  return id;
}

const ALL: ItemUsage[] = [
  "NEW_ORDER", "LINE_QTY", "NEW_PLAN", "NEW_PURCHASE", "DEFINITION", "NEW_STOCK", "DOC_COMPLETION", "EXISTING_GOODS",
];

async function main(): Promise<void> {
  for (const k of SETTING_KEYS_TOUCHED) {
    const row = await prisma.systemSetting.findUnique({ where: { key: k }, select: { value: true } });
    originalSettings.set(k, row ? row.value : undefined);
  }
  const admin = await ensureTestAdmin();
  const ADMIN = admin.id;
  customerId = (await prisma.customer.create({ data: { code: `${TAG}-C`, name: `${TAG} MÜŞTERİ` }, select: { id: true } })).id;

  try {
    // Ayar başlangıcı: kayıt YOK = varsayılanlar (OKUTULAN_TOPLAR · SERBEST_UYARILI · plan açık).
    for (const k of SETTING_KEYS_TOUCHED) await prisma.systemSetting.deleteMany({ where: { key: k } });

    const A = await mkItem("AKTIF");
    const P = await mkItem("TUKENEN");
    const X = await mkItem("PASIF");
    // P'nin üstünde canlı top (Aktif'ken doğar) → sonra Tükenene kadar.
    const roll = await inventory.createInitialEntry({ itemId: P, initialQty: 80 }, ADMIN);
    const rollId = (roll.data as { id: string }).id;
    await itemService.transitionLifecycle(P, ItemLifecycleStatus.PHASE_OUT, "bekçi", ADMIN);
    await itemService.transitionLifecycle(X, ItemLifecycleStatus.ARCHIVED, "bekçi", ADMIN);

    console.log("=== 1) Kural motoru — varsayılan ayarlar ===");
    for (const u of ALL) {
      check(`ACTIVE · ${u} açık`, (await codeOf(() => assertItemUsable(prisma, A, u, { oldQty: 1, newQty: 2 }))) === "OK");
      check(`ARCHIVED · ${u} kapalı (ITEM_INACTIVE)`, (await codeOf(() => assertItemUsable(prisma, X, u, { oldQty: 1, newQty: 2 }))) === "ITEM_INACTIVE");
    }
    const po = async (u: ItemUsage, o = {}) => codeOf(() => assertItemUsable(prisma, P, u, o));
    check("PHASE_OUT · A1 yeni sipariş (elle) kapalı", (await po("NEW_ORDER")) === "ITEM_PHASE_OUT");
    check("PHASE_OUT · A1 okutulan toplardan açık", (await po("NEW_ORDER", { fromScannedRolls: true })) === "OK");
    const w = await assertItemUsable(prisma, P, "LINE_QTY", { oldQty: 100, newQty: 120 });
    check("PHASE_OUT · A2 miktar serbest + sade uyarı", w.warnings.length === 1 && w.warnings[0] === PHASE_OUT_LINE_QTY_WARNING, w.warnings.join("|"));
    check("PHASE_OUT · A2 miktar değişmiyorsa uyarı yok", (await assertItemUsable(prisma, P, "LINE_QTY", { oldQty: 100, newQty: 100 })).warnings.length === 0);
    check("PHASE_OUT · A3 yeni plan açık (varsayılan)", (await po("NEW_PLAN")) === "OK");
    for (const u of ["NEW_PURCHASE", "DEFINITION", "NEW_STOCK"] as ItemUsage[]) check(`PHASE_OUT · ${u} kapalı`, (await po(u)) === "ITEM_PHASE_OUT");
    for (const u of ["DOC_COMPLETION", "EXISTING_GOODS"] as ItemUsage[]) check(`PHASE_OUT · ${u} akar`, (await po(u)) === "OK");
    const msg = await (async () => { try { await assertItemUsable(prisma, P, "NEW_STOCK"); return ""; } catch (e) { return (e as Error).message; } })();
    check("mesaj kart adını ve durumu söylüyor, yol gösteriyor", msg.includes(`${TAG} TUKENEN`) && msg.includes("Tükenene kadar") && msg.includes("Aktif'e döndürün"), msg);

    console.log("\n=== 2) §4.1 ayar seçenekleri ===");
    await setSetting(SETTING_KEYS.ITEM_LIFECYCLE_PHASE_OUT_NEW_ORDER, "KAPALI");
    check("KAPALI · okutulan toplardan da kapalı", (await po("NEW_ORDER", { fromScannedRolls: true })) === "ITEM_PHASE_OUT");
    await setSetting(SETTING_KEYS.ITEM_LIFECYCLE_PHASE_OUT_NEW_ORDER, "SERBEST");
    check("SERBEST · elle yeni sipariş açık", (await po("NEW_ORDER")) === "OK");
    await setSetting(SETTING_KEYS.ITEM_LIFECYCLE_PHASE_OUT_LINE_QTY, "AZALTMA_SERBEST");
    check("AZALTMA_SERBEST · azaltma açık", (await po("LINE_QTY", { oldQty: 100, newQty: 60 })) === "OK");
    check("AZALTMA_SERBEST · artırma kapalı", (await po("LINE_QTY", { oldQty: 100, newQty: 140 })) === "ITEM_PHASE_OUT");
    await setSetting(SETTING_KEYS.ITEM_LIFECYCLE_PHASE_OUT_LINE_QTY, "KILITLI");
    check("KILITLI · azaltma da kapalı", (await po("LINE_QTY", { oldQty: 100, newQty: 60 })) === "ITEM_PHASE_OUT");
    await setSetting(SETTING_KEYS.ITEM_LIFECYCLE_PHASE_OUT_NEW_PLAN, false);
    check("plan kapalı · A3 kapalı", (await po("NEW_PLAN")) === "ITEM_PHASE_OUT");
    check("plan kapalı · E (mevcut mal) yine akar", (await po("EXISTING_GOODS")) === "OK");
    for (const u of ALL) {
      check(`⭐ çekirdek: gevşek ayarda da ARCHIVED · ${u} kapalı`, (await codeOf(() => assertItemUsable(prisma, X, u, { fromScannedRolls: true }))) === "ITEM_INACTIVE");
    }
    // Varsayılana dön (servis çağrıları varsayılanı ölçer).
    for (const k of SETTING_KEYS_TOUCHED) await prisma.systemSetting.deleteMany({ where: { key: k } });

    console.log("\n=== 3) Servis çağrıları ===");
    check("KK1/elle giriş (C) Tükenene kadar kartta 409 ITEM_PHASE_OUT", (await codeOf(() => inventory.createInitialEntry({ itemId: P, initialQty: 10 }, ADMIN))) === "ITEM_PHASE_OUT");
    const tamburRoll = await codeOf(async () => {
      const r = await inventory.createInitialEntry({ itemId: P, initialQty: 10 }, ADMIN, null, false, { itemUsage: "EXISTING_GOODS" });
      return r;
    });
    check("tambur yolu (E) Tükenene kadar kartta top doğurur", tamburRoll === "OK", tamburRoll);
    check("KK1/elle giriş Pasif kartta 409 ITEM_INACTIVE", (await codeOf(() => inventory.createInitialEntry({ itemId: X, initialQty: 10 }, ADMIN))) === "ITEM_INACTIVE");
    check(
      "elle sipariş satırı (A1) Tükenene kadar kartta 409",
      (await codeOf(() => orderSvc.create({ customerId, lines: [{ itemId: P, quantity: 50 }] }, ADMIN))) === "ITEM_PHASE_OUT",
    );
    const q = await orderSvc.quickOrderFromRolls({ customerId, rollIds: [rollId] }, ADMIN);
    const order = (q.data as { order: { id: string } }).order;
    orderIds.push(order.id);
    const lines = await prisma.orderLine.findMany({ where: { orderId: order.id }, select: { id: true, itemId: true, quantity: true } });
    check("hızlı sipariş (okutulan top) Tükenene kadar kartta açılır", lines.length === 1 && lines[0]!.itemId === P);
    check("⭐ miktar SUNUCUDA topun metrajından (80)", Number(lines[0]!.quantity) === 80, String(lines[0]?.quantity));
    const upd = await orderSvc.update(order.id, { lines: [{ id: lines[0]!.id, itemId: P, quantity: 90 }] }, ADMIN);
    const warns = (upd as { warnings?: string[] }).warnings ?? [];
    check("A2 miktar artırımı serbest + uyarı yanıtta", warns.includes(PHASE_OUT_LINE_QTY_WARNING), warns.join("|"));
    check(
      "fiyat tanımı (B) Tükenene kadar kartta 409",
      (await codeOf(() => itemPriceService.upsert({ itemId: P, kind: "SALE", currency: "TRY", price: "10" } as never, ADMIN))) === "ITEM_PHASE_OUT",
    );
    check("Aktif kartta elle sipariş açılır (körlük zemini)", (await codeOf(async () => {
      const r = await orderSvc.create({ customerId, lines: [{ itemId: A, quantity: 5 }] }, ADMIN);
      orderIds.push((r.data as { id: string }).id);
    })) === "OK");
    await workOrderTargetSection(A, ADMIN);
  } finally {
    await temizleAyarlar();
  }
}

/**
 * §4 İE hedef TÜR kapısı (`workOrderTarget`): iş emri top üretir → hedef yalnız top doğurabilen tür (kumaş).
 * Kapı yalnız YENİ hedefte: hedefi değişmeyen düzenleme kapıdan önce açılmış (iplik hedefli) eski kaydı reddetmez.
 * Sonda (2026-11-26): `decide`teki tür kapısı etkisizleştirildi → §4a/§4b/§4b4/§4c/§4e ❌.
 */
async function workOrderTargetSection(fabricId: string, admin: string): Promise<void> {
  console.log("\n=== 4) İE hedef tür kapısı ===");
  const yarn = await mkItem("IPLIK", "YARN");
  const consumable = (await prisma.item.create({ data: { code: `${TAG}-SARF`, name: `${TAG} SARF`, itemType: "CONSUMABLE", unit: "ADET" }, select: { id: true } })).id;
  itemIds.push(consumable);
  check("§4a ⭐ iplik kartı İE hedefi olamaz → 400 WORK_ORDER_TARGET_ITEM_TYPE", (await codeOf(() => assertItemUsable(prisma, yarn, "NEW_PLAN", { workOrderTarget: true }))) === "WORK_ORDER_TARGET_ITEM_TYPE");
  check("§4b sarf kartı da olamaz (allowlist: yalnız kumaş)", (await codeOf(() => assertItemUsable(prisma, consumable, "EXISTING_GOODS", { workOrderTarget: true }))) === "WORK_ORDER_TARGET_ITEM_TYPE");
  check("§4b2 kumaş kartı hedef olur", (await codeOf(() => assertItemUsable(prisma, fabricId, "NEW_PLAN", { workOrderTarget: true }))) === "OK");
  check("§4b3 opsiyonsuz çağrı türe bakmaz (iplik girişi vb. yollar etkilenmez)", (await codeOf(() => assertItemUsable(prisma, yarn, "NEW_STOCK"))) === "OK");
  const msg = await (async () => { try { await assertItemUsable(prisma, yarn, "NEW_PLAN", { workOrderTarget: true }); return ""; } catch (e) { return (e as Error).message; } })();
  check("§4b4 mesaj kartı ve çıkış yolunu söyler (yalnız kumaş)", msg.includes(`"${TAG} IPLIK" ipliği `) && msg.includes("yalnız kumaş"), msg);

  const station = await prisma.station.create({ data: { code: `${TAG}-ST`, name: `${TAG} İSTASYON`, type: "INTERNAL" }, select: { id: true } });
  stationIds.push(station.id);
  const steps = [{ stationId: station.id }];
  check("§4c ⭐ İE açılışı (servis): iplik hedef → 400 WORK_ORDER_TARGET_ITEM_TYPE",
    (await codeOf(() => woSvc.prepareCreate({ type: "STOCK_PRODUCTION", targetItemId: yarn, steps } as never))) === "WORK_ORDER_TARGET_ITEM_TYPE");
  check("§4c2 İE açılışı: kumaş hedef geçer (körlük zemini)",
    (await codeOf(() => woSvc.prepareCreate({ type: "STOCK_PRODUCTION", targetItemId: fabricId, steps } as never))) === "OK");

  // Kapıdan önce açılmış eski kayıt: iplik hedefli iş emri (doğrudan DB'ye, bugünkü canlı veriyi taklit eder).
  const mkWo = async (n: string, targetItemId: string) => {
    const wo = await prisma.workOrder.create({
      data: { workOrderNumber: `${TAG}-${n}`, type: "STOCK_PRODUCTION", targetItemId, steps: { create: [{ stepSequence: 1, stationId: station.id }] } },
      select: { id: true },
    });
    woIds.push(wo.id);
    return wo.id;
  };
  const legacy = await mkWo("ESKI", yarn);
  check("§4d ⭐ hedefi değişmeyen düzenleme eski (iplik hedefli) kaydı reddetmez", (await codeOf(() => woSvc.update(legacy, { targetQuantity: 120 }, admin))) === "OK");
  check("§4d2 aynı hedef gövdede tekrar gelse de reddetmez", (await codeOf(() => woSvc.update(legacy, { targetItemId: yarn, targetQuantity: 130 }, admin))) === "OK");
  const fresh = await mkWo("YENI", fabricId);
  check("§4e ⭐ hedefi iplik karta ÇEVİRMEK → 400 WORK_ORDER_TARGET_ITEM_TYPE", (await codeOf(() => woSvc.update(fresh, { targetItemId: yarn }, admin))) === "WORK_ORDER_TARGET_ITEM_TYPE");
  check("§4e2 eski iplik hedefini kumaşa çevirmek serbest (çıkış yolu)", (await codeOf(() => woSvc.update(legacy, { targetItemId: fabricId }, admin))) === "OK");
}

/** Ayarları ÖNCEKİ hâline döndürür (yoksa satırı siler). */
async function temizleAyarlar(): Promise<void> {
  for (const k of SETTING_KEYS_TOUCHED) {
    const v = originalSettings.get(k);
    if (v === undefined) await prisma.systemSetting.deleteMany({ where: { key: k } });
    else await prisma.systemSetting.update({ where: { key: k }, data: { value: v as never } });
  }
}

async function temizle(): Promise<void> {
  if (woIds.length > 0) {
    await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
  }
  if (stationIds.length > 0) await prisma.station.deleteMany({ where: { id: { in: stationIds } } });
  if (orderIds.length > 0) {
    await prisma.orderLine.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  }
  if (itemIds.length > 0) {
    const rolls = await prisma.roll.findMany({ where: { itemId: { in: itemIds } }, select: { id: true } });
    const rollIds = rolls.map((r) => r.id);
    await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    await prisma.itemPrice.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
  }
  if (customerId) {
    await prisma.cariAccount.deleteMany({ where: { customerId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
  }
}

main()
  .catch((e) => {
    console.error("\n💥 ÇÖKTÜ:", e);
    fail++;
  })
  .finally(async () => {
    await temizle().catch((e) => console.error("temizlik:", (e as Error).message));
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exitCode ||= fail > 0 ? 1 : 0;
  });
