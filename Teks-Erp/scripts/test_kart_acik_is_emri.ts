// =============================================================================
// test_kart_acik_is_emri — atkı/çözgü kartını kullanan açık iş emri sayısı (Seyitoğlu SY-d, GERÇEK DB)
// =============================================================================
// Kabul: kart düzenleme ekranının "bu kartı N açık iş emri kullanıyor" uyarısı sunucudan gelir;
// "açık" tanımı tek kaynaktır (`OPEN_WEAVING_ORDER`, `OPEN_WARPING_STATUSES`); etkin kart kuralı
// `loom-load` ile aynı (iş emrinin kendi kartı, boşsa ürünün kartı; çözgüde ek katman da);
// kapalı/iptal iş emri ve kendi başka kartını sabitlemiş iş emri sayılmaz; dokuma kapalıyken
// dokuma iş emri 0, çözgü emri sayılır. Yazmaz.
// §0 statik: helper açık kümeyi kopyalamaz (status literal'i yok), uçlar prisma import etmez.
// NEGATİF SONDA (ölçüldü, geri alındı): `weftSpecWeavingWhere`ten `weftSpecId: null` koşulu sökülünce
// (başka kartı sabitleyen iş emri de sayılır) §1a/§1b/§1c ❌ (6/3); `OPEN_WEAVING_ORDER` yayılımı silinince §1a/§1c ❌ (7/2).
// Fikstür `TEST-SYD4-<ts>`; temizlik `finally`de FK sırasıyla; ayarlar birebir geri yüklenir.
// =============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { WeavingOrderStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { createWarpingOrder } from "../src/services/warping-order/create";
import { warpSpecOpenOrders, weftSpecOpenOrders } from "../src/services/helpers/spec-open-orders.helper";
import { ensureTestDyeHouse } from "./fixture-subcontractor";
import { testActorId } from "./fixture-test-user";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++; else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}

const TAG = `TEST-SYD4-${Date.now().toString(36).toUpperCase()}`;
const KEYS = [SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.IPLIK_ENABLED, SETTING_KEYS.DOKUMA_ENABLED, SETTING_KEYS.PRODUCTION_ENABLED];
const saved = new Map<string, unknown>();
const made = { items: [] as string[], warp: [] as string[], weft: [] as string[], weaving: [] as string[], warping: [] as string[] };
const setSetting = (key: string, value: unknown) => prisma.systemSetting.upsert({ where: { key }, create: { key, value: value as never }, update: { value: value as never } });

function statik(): void {
  const read = (...p: string[]) => readFileSync(path.join(__dirname, "..", "src", ...p), "utf8").replace(/\/\/.*$/gm, "");
  const h = read("services", "helpers", "spec-open-orders.helper.ts");
  check("§0a açık küme tek kaynaktan (helper'da durum literal'i yok)", /OPEN_WEAVING_ORDER/.test(h) && /OPEN_WARPING_STATUSES/.test(h) && !/"(PLANNED|IN_PROGRESS|OPEN|COMPLETED|CANCELLED)"/.test(h));
  check("§0b uçlar prisma import etmez", !/lib\/prisma/.test(read("routes", "weft-spec.routes.ts")) && !/lib\/prisma/.test(read("routes", "warp-spec.routes.ts")));
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) throw new Error(engel);
  statik();
  for (const k of KEYS) saved.set(k, (await prisma.systemSetting.findUnique({ where: { key: k }, select: { value: true } }))?.value);
  for (const k of [SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.DOKUMA_ENABLED, SETTING_KEYS.PRODUCTION_ENABLED]) await setSetting(k, true);
  await setSetting(SETTING_KEYS.IPLIK_ENABLED, false);

  const U = await testActorId();
  const yarn = await prisma.item.create({ data: { code: `${TAG}-IP`, name: `${TAG} iplik`, itemType: "YARN", unit: "KG", linearDensityDen: 75 }, select: { id: true } });
  made.items.push(yarn.id);
  const warp = async (s: string) => {
    const r = await prisma.warpSpec.create({ data: { code: `${TAG}-${s}`, name: `${TAG} ${s}`, yarnItemId: yarn.id, endsCount: 3000 }, select: { id: true } });
    made.warp.push(r.id);
    return r.id;
  };
  const weft = async (s: string) => {
    const r = await prisma.weftSpec.create({ data: { code: `${TAG}-${s}`, name: `${TAG} ${s}`, picksPerCm: "20", yarns: { create: [{ yarnItemId: yarn.id, picksInRepeat: 4, sortOrder: 0 }] } }, select: { id: true } });
    made.weft.push(r.id);
    return r.id;
  };
  const G = await warp("G"), L = await warp("L"), G2 = await warp("G2");
  const W = await weft("W"), W2 = await weft("W2");
  const fabric = async (s: string, warpSpecId: string, weftSpecId: string) => {
    const r = await prisma.item.create({ data: { code: `${TAG}-${s}`, name: `${TAG} kumaş ${s}`, itemType: "FABRIC", warpSpecId, weftSpecId }, select: { id: true } });
    made.items.push(r.id);
    return r.id;
  };
  const A = await fabric("A", G, W);
  const B = await fabric("B", G2, W2);
  await prisma.itemWarpLayer.create({ data: { itemId: B, warpSpecId: L, role: "LENO", sortOrder: 1 } });
  let n = 0;
  const wo = async (itemId: string, status: WeavingOrderStatus, pin: { warpSpecId?: string; weftSpecId?: string } = {}) => {
    const r = await prisma.weavingOrder.create({ data: { weavingOrderNumber: `${TAG}-D${++n}`, itemId, executionKind: "IN_HOUSE", status, ...pin, ...(status === "COMPLETED" ? { closedAt: new Date() } : {}) }, select: { id: true } });
    made.weaving.push(r.id);
  };
  await wo(A, "PLANNED"); // kendi kartı yok → ürünün kartları (G, W)
  await wo(A, "IN_PROGRESS", { warpSpecId: G, weftSpecId: W });
  await wo(A, "COMPLETED", { weftSpecId: W }); // kapalı → sayılmaz
  await wo(A, "CANCELLED"); // iptal → sayılmaz
  await wo(A, "PLANNED", { warpSpecId: G2, weftSpecId: W2 }); // başka kart sabitli → G/W'de sayılmaz
  await wo(B, "PLANNED", { weftSpecId: W }); // B'nin iş emri W'yi sabitlemiş → W'de sayılır; L katmanından L'de sayılır

  console.log("§1 atkı kartı");
  const w = await weftSpecOpenOrders(W);
  check("§1a W: 3 açık dokuma iş emri (ürün düşüşü + iki sabit), kapalı/iptal yok", w.weavingOrders === 3 && w.total === 3 && w.warpingOrders === 0, JSON.stringify(w));
  const w2 = await weftSpecOpenOrders(W2);
  check("§1b W2: yalnız W2'yi sabitleyen 1 iş emri (B'nin W'ye sabitli işi sayılmaz)", w2.total === 1, JSON.stringify(w2));
  check("§1c numaralar listede", w.numbers.length === 3 && w.numbers.every((x) => x.startsWith(TAG)));

  console.log("§2 çözgü kartı");
  const sub = await ensureTestDyeHouse();
  const wg = await createWarpingOrder({ subcontractorId: sub.id, fixedWasteM: 0, clientToken: randomUUID(), warpSpecId: G, beamLines: [{ beamCount: 1, beamLengthM: 300 }] }, U);
  made.warping.push(wg.data!.id);
  const g = await warpSpecOpenOrders(G);
  check("§2a G: 2 dokuma (düşüş + sabit) + 1 açık çözgü emri", g.weavingOrders === 2 && g.warpingOrders === 1 && g.total === 3, JSON.stringify(g));
  const l = await warpSpecOpenOrders(L);
  check("§2b L (B'nin ek katmanı): B'nin açık iş emri sayılır", l.weavingOrders === 1 && l.total === 1, JSON.stringify(l));
  await prisma.warpingOrder.update({ where: { id: wg.data!.id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
  check("§2c iptal çözgü emri sayılmaz", (await warpSpecOpenOrders(G)).warpingOrders === 0);

  console.log("§3 dokuma kapalı");
  await setSetting(SETTING_KEYS.DOKUMA_ENABLED, false);
  const off = await weftSpecOpenOrders(W);
  check("§3a dokuma kapalı → dokuma iş emri 0 (uyarı çizilmez)", off.total === 0 && off.numbers.length === 0);
}

async function cleanup(): Promise<void> {
  const t = async (fn: () => Promise<unknown>): Promise<void> => { await fn().catch((e) => { fail++; console.log(`  ✗ temizlik: ${(e as Error).message.slice(0, 160)}`); }); };
  await t(() => prisma.weavingOrder.deleteMany({ where: { id: { in: made.weaving } } }));
  await t(() => prisma.warpingOrderYarn.deleteMany({ where: { warpingOrderId: { in: made.warping } } }));
  await t(() => prisma.warpingOrderBeamLine.deleteMany({ where: { warpingOrderId: { in: made.warping } } }));
  await t(() => prisma.warpingOrder.deleteMany({ where: { id: { in: made.warping } } }));
  await t(() => prisma.systemLog.deleteMany({ where: { recordId: { in: [...made.items, ...made.warping] } } }));
  await t(() => prisma.itemWarpLayer.deleteMany({ where: { itemId: { in: made.items } } }));
  await t(() => prisma.item.updateMany({ where: { id: { in: made.items } }, data: { warpSpecId: null, weftSpecId: null } }));
  await t(() => prisma.weftSpecYarn.deleteMany({ where: { weftSpecId: { in: made.weft } } }));
  await t(() => prisma.weftSpec.deleteMany({ where: { id: { in: made.weft } } }));
  await t(() => prisma.warpSpec.deleteMany({ where: { id: { in: made.warp } } }));
  await t(() => prisma.item.deleteMany({ where: { id: { in: made.items } } }));
  for (const [key, value] of saved) {
    if (value === undefined) await t(() => prisma.systemSetting.deleteMany({ where: { key } }));
    else await t(() => setSetting(key, value));
  }
}

main()
  .catch((e) => { fail++; console.error("❌ beklenmeyen hata:", e); })
  .finally(async () => {
    await cleanup();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
    await pool.end();
  });
