// =============================================================================
// BEKÇİ — ÇUVALSIZ SEVK (yük birimi: dökme / araba)
// =============================================================================
// Çalıştırma: npx tsx scripts/test_loose_load_unit.ts
//
// NEDEN: sevkiyat artık çuvala DEĞİL yük birimine (SACK/CART/BULK) bağlanır.
// Dökme/araba birimi yalnız sevkiyatın içinde doğar; iptalde ÇÖZÜLÜR (toplar
// rafa, birim sevkiyatında damgalı kalır) — havuza düşerse operatörün hiç
// görmediği bir "çuval" belirir.
//
// ÖLÇÜLENLER:
//   §1 Bayrak kapalı → 400 LOOSE_LOAD_DISABLED, hiçbir şey yazılmaz (fail-closed)
//   §2 Dökme: tek BULK birim, toplar bağlı, tahsis Σ = top Σ (brüt)
//   §3 Araba: araba başına bir CART birim, etiket normalize
//   §4 Bölme doğrulaması: eksik top · çift top · karışık tür · iki dökme · boş/çift araba no
//   §5 PLANNED'dan dökme birimi çıkarma → 409 LOAD_UNIT_NOT_REMOVABLE
//   §6 ⭐ İptal önizlemesi her birim/top + nereye döner; iptal: toplar rafta (sackId/shipmentId null), birim havuzda DEĞİL, dissolvedAt dolu
//   §7 ⭐ Storno + kapanış (undoDispatch releaseSacks) da birimi çözer
//   §8 DB seddi (negatif sonda): havuza çekme · tür değişimi · çözülmüşe top · ikinci canlı dökme
//   §9 İrsaliye: dökme/araba snapshot'ta tür + "Dökme – N top"; çuvallı snapshot'ta anahtar YOK (bayt-eşit)
// =============================================================================
import { LoadUnitKind, Prisma, PrintedDocType, RollStatus, ShipmentStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { shippingService } from "../src/services/shipping.service";
import { InventoryService } from "../src/services/inventory.service";
import { ensureDefaultWarehouse } from "../src/jobs/default-warehouse.job";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { loadUnitDocLabel } from "../src/services/document-render/shipment-dispatch.html";

const inventory = new InventoryService();

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const TAG = `TEST-LLU-${Date.now()}`;
const rollIds: string[] = [];
const shipmentIds: string[] = [];
let customerId: string | null = null;
let itemId: string | null = null;
const savedSettings = new Map<string, Prisma.JsonValue | null>();

async function setSetting(key: string, value: boolean): Promise<void> {
  if (!savedSettings.has(key)) {
    const old = await prisma.systemSetting.findUnique({ where: { key }, select: { value: true } });
    savedSettings.set(key, old ? (old.value as Prisma.JsonValue) : null);
  }
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

async function caught(fn: () => Promise<unknown>): Promise<{ message: string; code: string | null; status: number | null }> {
  try {
    await fn();
    return { message: "", code: null, status: null };
  } catch (e) {
    const err = e as { message?: string; statusCode?: number; details?: { code?: string } };
    return { message: err.message ?? String(e), code: err.details?.code ?? null, status: err.statusCode ?? null };
  }
}

async function makeRoll(qty: number): Promise<string> {
  const res = await inventory.createInitialEntry({ itemId: itemId!, initialQty: qty }, undefined, undefined, false, {
    forcedStatus: RollStatus.WAREHOUSE,
  });
  const id = (res.data as { id: string }).id;
  rollIds.push(id);
  return id;
}

async function quick(ids: string[], loadUnits: unknown, extra: Record<string, unknown> = {}): Promise<{ id: string; status: string }> {
  const res = await shippingService.createShipmentFromRolls({
    rollIds: ids,
    customerId: customerId!,
    clientToken: crypto.randomUUID(),
    loadUnits: loadUnits as never,
    ...extra,
  });
  const d = res.data as { id: string; status: string };
  shipmentIds.push(d.id);
  return d;
}

async function unitsOf(shipmentId: string) {
  return prisma.sack.findMany({
    where: { shipmentId },
    select: { id: true, unitKind: true, unitLabel: true, dissolvedAt: true, rolls: { select: { id: true } } },
    orderBy: { createdAt: "asc" },
  });
}

/** DB seddini tx içinde dener; hata beklenir (deferred trigger commit'te düşer). */
async function dbRejects(fn: (tx: Prisma.TransactionClient) => Promise<unknown>): Promise<string> {
  try {
    await prisma.$transaction(async (tx) => {
      await fn(tx);
    });
    return "";
  } catch (e) {
    return (e as Error).message || "hata";
  }
}

async function main(): Promise<void> {
  console.log("=== Çuvalsız sevk (yük birimi) bekçisi ===\n");
  const engel = hedefDbEngeli();
  if (engel) throw new Error(engel);

  await ensureDefaultWarehouse();
  const customer = await prisma.customer.create({ data: { code: TAG, name: `${TAG} Müşteri` }, select: { id: true } });
  customerId = customer.id;
  const item = await prisma.item.create({ data: { code: `${TAG}-ITM`, name: `${TAG} kumaş`, itemType: "FABRIC", unit: "MT" }, select: { id: true } });
  itemId = item.id;
  await setSetting(SETTING_KEYS.SHIPMENT_CONFIRMATION_ENABLED, true); // PLANNED kalsın (iptal yolu)

  // ── §1 BAYRAK KAPALI ────────────────────────────────────────────────────
  await setSetting(SETTING_KEYS.SHIPMENT_LOOSE_LOAD_ENABLED, false);
  const off1 = await makeRoll(50);
  const offErr = await caught(() => quick([off1], [{ kind: "BULK", rollIds: [off1] }]));
  check("§1a Bayrak kapalı → 400 LOOSE_LOAD_DISABLED", offErr.code === "LOOSE_LOAD_DISABLED" && offErr.status === 400, `${offErr.status} ${offErr.code}`);
  const offRoll = await prisma.roll.findUniqueOrThrow({ where: { id: off1 }, select: { sackId: true, shipmentId: true } });
  check("§1b Reddedilen istekte top serbest kaldı", offRoll.sackId === null && offRoll.shipmentId === null);
  await setSetting(SETTING_KEYS.SHIPMENT_LOOSE_LOAD_ENABLED, true);

  // ── §2 DÖKME + tahsis brüt ──────────────────────────────────────────────
  const order = await prisma.order.create({
    data: { orderNumber: `${TAG}-ORD`, customerId: customer.id, lines: { create: [{ itemId: item.id, quantity: 1000 }] } },
    select: { id: true, lines: { select: { id: true } } },
  });
  const b = [await makeRoll(100), await makeRoll(60.5), await makeRoll(40)];
  const bulk = await quick(b, [{ kind: "BULK", rollIds: b }], { orderIds: [order.id] });
  const bu = await unitsOf(bulk.id);
  check("§2a Tek BULK birim doğdu", bu.length === 1 && bu[0]!.unitKind === LoadUnitKind.BULK && bu[0]!.unitLabel === null, JSON.stringify(bu.map((u) => u.unitKind)));
  check("§2b Üç top birime bağlı", bu[0]?.rolls.length === 3);
  check("§2c Sevkiyat PLANNED (onay açık)", bulk.status === ShipmentStatus.PLANNED, bulk.status);
  const alloc = await prisma.sackAllocation.aggregate({ where: { sackId: bu[0]!.id, clearedAt: null }, _sum: { qty: true } });
  check("§2d ⭐ Tahsis Σ = top Σ (brüt 200.5)", Number(alloc._sum.qty ?? 0) === 200.5, `Σ=${alloc._sum.qty}`);

  // ── §3 ARABA ────────────────────────────────────────────────────────────
  const c = [await makeRoll(10), await makeRoll(20), await makeRoll(30)];
  const cart = await quick(c, [
    { kind: "CART", label: "  A   12 ", rollIds: [c[0], c[2]] },
    { kind: "CART", label: "A-15", rollIds: [c[1]] },
  ]);
  const cu = await unitsOf(cart.id);
  check(
    "§3a Araba başına bir CART birim, etiket normalize",
    cu.length === 2 && cu.every((u) => u.unitKind === LoadUnitKind.CART) && cu.map((u) => u.unitLabel).sort().join("|") === "A 12|A-15",
    cu.map((u) => u.unitLabel).join("|"),
  );
  const a12 = cu.find((u) => u.unitLabel === "A 12");
  check("§3b Toplar doğru arabada", a12?.rolls.map((r) => r.id).sort().join() === [c[0], c[2]].sort().join());

  // ── §4 BÖLME DOĞRULAMASI ────────────────────────────────────────────────
  const v = [await makeRoll(5), await makeRoll(6)];
  const bad: Array<[string, unknown]> = [
    ["eksik top", [{ kind: "BULK", rollIds: [v[0]] }]],
    ["çift top", [{ kind: "CART", label: "X", rollIds: [v[0], v[1]] }, { kind: "CART", label: "Y", rollIds: [v[1]] }]],
    ["karışık tür", [{ kind: "BULK", rollIds: [v[0]] }, { kind: "CART", label: "X", rollIds: [v[1]] }]],
    ["iki dökme", [{ kind: "BULK", rollIds: [v[0]] }, { kind: "BULK", rollIds: [v[1]] }]],
    ["boş araba no", [{ kind: "CART", label: "  ", rollIds: v }]],
    ["çift araba no", [{ kind: "CART", label: "X", rollIds: [v[0]] }, { kind: "CART", label: " X ", rollIds: [v[1]] }]],
  ];
  for (const [ad, units] of bad) {
    const e = await caught(() => quick(v, units));
    check(`§4 ${ad} → 400 LOAD_UNITS_INVALID`, e.code === "LOAD_UNITS_INVALID" && e.status === 400, `${e.status} ${e.code} ${e.message}`);
  }
  const vFree = await prisma.roll.count({ where: { id: { in: v }, sackId: null, shipmentId: null } });
  check("§4z Reddedilen isteklerde toplar serbest", vFree === 2);

  // ── §5 ÇIKARMA YOK ──────────────────────────────────────────────────────
  const rm = await caught(() => shippingService.removeSackFromShipment(bulk.id, bu[0]!.id));
  check("§5 Dökme birimi çıkarma → 409 LOAD_UNIT_NOT_REMOVABLE", rm.code === "LOAD_UNIT_NOT_REMOVABLE" && rm.status === 409, `${rm.status} ${rm.code}`);

  // ── §6 İPTAL → ÇÖZÜLME ──────────────────────────────────────────────────
  const pv = (await shippingService.getCancelPreview(bulk.id)).data as { units: Array<{ unitKind: string; returnsTo: string; rolls: unknown[] }> };
  check("§6p ⭐ İptal önizlemesi her birimi + topu listeler (dökme → raf)", pv.units.length === 1 && pv.units[0]!.unitKind === "BULK" && pv.units[0]!.returnsTo === "SHELF" && pv.units[0]!.rolls.length === 3, JSON.stringify(pv.units).slice(0, 160));
  await shippingService.cancelShipment(bulk.id);
  const afterRolls = await prisma.roll.findMany({ where: { id: { in: b } }, select: { sackId: true, shipmentId: true, status: true } });
  check("§6a ⭐ Toplar rafta (sackId + shipmentId null)", afterRolls.every((r) => r.sackId === null && r.shipmentId === null), JSON.stringify(afterRolls));
  check("§6b Topların statüsü WAREHOUSE", afterRolls.every((r) => r.status === RollStatus.WAREHOUSE));
  const du = await prisma.sack.findUniqueOrThrow({ where: { id: bu[0]!.id }, select: { shipmentId: true, dissolvedAt: true } });
  check("§6c ⭐ Birim havuza DÖNMEDİ (sevkiyatında kaldı)", du.shipmentId === bulk.id);
  check("§6d Birim çözülmüş damgalı", du.dissolvedAt !== null);
  const reship = await quick(b, [{ kind: "BULK", rollIds: b }]);
  check("§6e Çözülen toplar yeniden sevk edilebilir", (await unitsOf(reship.id)).length === 1);

  // ── §7 STORNO + KAPANIŞ ─────────────────────────────────────────────────
  await setSetting(SETTING_KEYS.SHIPMENT_CONFIRMATION_ENABLED, false);
  const d = [await makeRoll(70)];
  const disp = await quick(d, [{ kind: "CART", label: "Z-1", rollIds: d }]);
  check("§7a Onay kapalı → DISPATCHED", disp.status === ShipmentStatus.DISPATCHED, disp.status);
  const dUnit = (await unitsOf(disp.id))[0]!;
  await shippingService.undoDispatch(disp.id, `${TAG} storno`, undefined, { releaseSacks: true });
  const dRoll = await prisma.roll.findUniqueOrThrow({ where: { id: d[0]! }, select: { sackId: true, shipmentId: true, status: true } });
  const dSack = await prisma.sack.findUniqueOrThrow({ where: { id: dUnit.id }, select: { shipmentId: true, dissolvedAt: true } });
  check("§7b ⭐ Storno kapanışında top rafta", dRoll.sackId === null && dRoll.shipmentId === null && dRoll.status === RollStatus.WAREHOUSE, JSON.stringify(dRoll));
  check("§7c Araba birimi çözüldü, havuzda değil", dSack.shipmentId === disp.id && dSack.dissolvedAt !== null);

  // ── §8 DB SEDDİ ─────────────────────────────────────────────────────────
  const live = (await unitsOf(cart.id))[0]!;
  check("§8a Dökme/araba havuza çekilemez", (await dbRejects((tx) => tx.sack.update({ where: { id: live.id }, data: { shipmentId: null, seq: null } })))!== "");
  check("§8b Birim türü değiştirilemez", (await dbRejects((tx) => tx.sack.update({ where: { id: live.id }, data: { unitKind: LoadUnitKind.BULK, unitLabel: null } }))) !== "");
  const free = await makeRoll(3);
  check("§8c Çözülmüş birime top bağlanamaz", (await dbRejects((tx) => tx.roll.update({ where: { id: free }, data: { sackId: bu[0]!.id } }))) !== "");
  const rs = (await unitsOf(reship.id))[0]!;
  check(
    "§8d Aynı sevkiyatta ikinci canlı dökme reddedilir",
    (await dbRejects((tx) => tx.sack.create({ data: { sackNo: `${TAG}-X`, unitKind: LoadUnitKind.BULK, shipmentId: reship.id, customerId: customer.id } }))) !== "",
  );
  check("§8e CHECK: dökmeye etiket yazılamaz", (await dbRejects((tx) => tx.sack.update({ where: { id: rs.id }, data: { unitLabel: "X" } }))) !== "");
  check("§8f CHECK: çuval (SACK) çözülemez", (await dbRejects(async (tx) => {
    const s = await tx.sack.create({ data: { sackNo: `${TAG}-S`, customerId: customer.id }, select: { id: true } });
    await tx.sack.update({ where: { id: s.id }, data: { dissolvedAt: new Date() } });
  })) !== "");

  // ── §9 İRSALİYE ─────────────────────────────────────────────────────────
  type Snap = { doc?: { sacks?: Array<Record<string, unknown>>; cekiRows?: Array<{ sackCode: string }> } };
  const snapOf = async (id: string): Promise<Snap> =>
    ((await prisma.printedDocument.findFirst({
      where: { docType: PrintedDocType.SHIPMENT_DISPATCH, sourceId: id, status: "ACTIVE" },
      select: { snapshot: true },
    }))?.snapshot ?? {}) as Snap;
  const e = [await makeRoll(11), await makeRoll(12)];
  const bulkDisp = await quick(e, [{ kind: "BULK", rollIds: e }]);
  const bSnap = await snapOf(bulkDisp.id);
  const bRow = bSnap.doc?.sacks?.[0] ?? {};
  check("§9a Dökme snapshot'ı türü taşır", bRow.unitKind === "BULK", JSON.stringify(bRow).slice(0, 160));
  check("§9b ⭐ Ambalaj hücresi \"Dökme – 2 top\"", loadUnitDocLabel(bRow as never) === "Dökme – 2 top", loadUnitDocLabel(bRow as never));
  check("§9c Çeki satırı birimi \"Dökme\" yazar", (bSnap.doc?.cekiRows ?? []).every((r) => r.sackCode === "Dökme") && (bSnap.doc?.cekiRows ?? []).length === 2);
  const f = [await makeRoll(13)];
  const cartDisp = await quick(f, [{ kind: "CART", label: "B-7", rollIds: f }]);
  const cRow = (await snapOf(cartDisp.id)).doc?.sacks?.[0] ?? {};
  check("§9d Araba hücresi \"Araba B-7 – 1 top\"", loadUnitDocLabel(cRow as never) === "Araba B-7 – 1 top", loadUnitDocLabel(cRow as never));
  const g = [await makeRoll(14)];
  const sackDisp = await quick(g, undefined);
  const sRow = (await snapOf(sackDisp.id)).doc?.sacks?.[0] ?? {};
  check("§9e ⭐ Çuvallı snapshot'ta unitKind/unitLabel anahtarı YOK", Object.keys(sRow).length > 0 && !("unitKind" in sRow) && !("unitLabel" in sRow), Object.keys(sRow).join(","));
  check("§9f Çuvalda hücre çuval no", loadUnitDocLabel(sRow as never) === sRow.code);
}

main()
  .catch((e) => {
    fail++;
    console.error("❌ Beklenmeyen hata:", e);
  })
  .finally(async () => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    for (const [key, value] of savedSettings) {
      if (value === null) await prisma.systemSetting.deleteMany({ where: { key } }).catch(() => {});
      else await prisma.systemSetting.update({ where: { key }, data: { value: value as Prisma.InputJsonValue } }).catch(() => {});
    }
    const sids = [...new Set(shipmentIds)];
    const sackIds = customerId ? (await prisma.sack.findMany({ where: { customerId }, select: { id: true } })).map((s) => s.id) : [];
    await prisma.sackAllocation.deleteMany({ where: { sackId: { in: sackIds } } }).catch(() => {}); // fikstür temizliği
    await prisma.printedDocument.deleteMany({ where: { sourceId: { in: sids } } }).catch(() => {});
    await prisma.shipmentEvent.deleteMany({ where: { shipmentId: { in: sids } } }).catch(() => {});
    await prisma.shipmentOrder.deleteMany({ where: { shipmentId: { in: sids } } }).catch(() => {});
    if (rollIds.length > 0) {
      await prisma.roll.updateMany({ where: { id: { in: rollIds } }, data: { sackId: null, shipmentId: null } }).catch(() => {});
      await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
      await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
      await prisma.rollVariance.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
      await prisma.roll.deleteMany({ where: { id: { in: rollIds } } }).catch(() => {});
    }
    // Birimler sevkiyattan ÖNCE silinir: dökme/araba havuza çekilemez (trigger yalnız INSERT/UPDATE'te).
    await prisma.sack.deleteMany({ where: { id: { in: sackIds } } }).catch((e) => console.error("temizlik sack:", (e as Error).message));
    await prisma.shipment.deleteMany({ where: { id: { in: sids } } }).catch((e) => console.error("temizlik shipment:", (e as Error).message));
    if (customerId) {
      await prisma.orderLine.deleteMany({ where: { order: { customerId } } }).catch(() => {});
      await prisma.order.deleteMany({ where: { customerId } }).catch(() => {});
      await prisma.customer.deleteMany({ where: { id: customerId } }).catch(() => {});
    }
    if (itemId) await prisma.item.deleteMany({ where: { id: itemId } }).catch(() => {});
    await prisma.$disconnect();
    await pool.end();
    process.exitCode = fail > 0 ? 1 : 0;
  });
