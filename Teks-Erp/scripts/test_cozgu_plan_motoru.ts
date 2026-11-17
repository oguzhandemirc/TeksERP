// =============================================================================
// ÇÖZGÜ HESAP MOTORU BEKÇİSİ — fason devere D1 (plan §5, §9 S1–S6)
// =============================================================================
// §1–§6 saf motor (DB'siz): formül, fire sırası (bölerek), yuvarlamasızlık, ters yön, kısıtlayan iplik,
// giriş yardımcıları. §7 servis (GERÇEK DB): kart satırları, göç güvenliği (satırsız kart), stok kolu
// (iplik kapalı → null, bekletmedeki lot düşer), doğrulamalar, ayar varsayılanı. §8–§9 metin: kapı + formülün tek evi.
// DB'YE YAZAR: `TEST-CZP-<pid>` iplik/kart/stok satırları + iki ayar (birebir geri yüklenir), `finally`de silinir.
// Koşum: npx tsx scripts/run-all-tests.ts cozgu_plan_motoru
//
// NEGATİF SONDALAR (2026-11-17 koşuldu, dosya geri alındı, yeşil yeniden ölçüldü):
//   ① `grossKgExact` fireyi bölmek yerine ÇARPTI (× (1 + f)) → §3a/§3d/§7l kırmızı (52,530 ≠ 52,577), 34/37.
//   ② ters yönde kısıt `lessThan` yerine `greaterThan` (min yerine max) → §4a–§4e/§5a/§7d kırmızı (2500 m, kısıt z), 30/37.
//   ③ servis stok okumasında `excludeHeld: false` → §7d kırmızı (1750 m; bekletmedeki 10 kg serbest sayıldı), 36/37.
// =============================================================================
import * as fs from "node:fs";
import * as path from "node:path";
import { ItemType, Prisma, YarnLotQualityStatus, YarnMovementKind } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { computeWarpPlanForward, computeWarpPlanReverse, endsFromKgPer1000m, endsFromReed, type WarpPlanStock } from "../src/services/helpers/warp-plan.helper";
import { calculateWarpPlan } from "../src/services/warp-plan.service";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestDyeHouse } from "./fixture-subcontractor";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}
const J = (v: unknown): string => JSON.stringify(v);

const X = { yarnItemId: "x", endsCount: 3000, denier: 150, yarnWastePct: null };
const Y = { yarnItemId: "y", endsCount: 2400, denier: 150, yarnWastePct: null };
const Z = { yarnItemId: "z", endsCount: 1800, denier: 300, yarnWastePct: null };
const stockOf = (rows: Record<string, [number | null, number | null]>): Map<string, WarpPlanStock> =>
  new Map(Object.entries(rows).map(([k, [d, f]]) => [k, { depoKg: d, fasondaKg: f }]));

async function expect400(label: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    check(label, false, "kabul edildi");
  } catch (e) {
    const code = (e as { statusCode?: number }).statusCode;
    check(label, code === 400 || code === 404, `${code} ${(e as Error).message.slice(0, 70)}`);
  }
}

async function withSettings<T>(values: Record<string, boolean | number>, fn: () => Promise<T>): Promise<T> {
  const keys = Object.keys(values);
  const before = await prisma.systemSetting.findMany({ where: { key: { in: keys } }, select: { key: true, value: true } });
  try {
    for (const k of keys) await prisma.systemSetting.upsert({ where: { key: k }, create: { key: k, value: values[k] }, update: { value: values[k] } });
    return await fn();
  } finally {
    for (const k of keys) {
      const b = before.find((x) => x.key === k);
      if (b) await prisma.systemSetting.update({ where: { key: k }, data: { value: b.value as Prisma.InputJsonValue } });
      else await prisma.systemSetting.deleteMany({ where: { key: k } });
    }
  }
}

function pureSections(): void {
  // ── §1 S1: x/y/z, 1 × 1000 m, fire 0 → 50 / 40 / 60 kg; firesiz = fireli ──
  const s1 = computeWarpPlanForward({ lines: [X, Y, Z], specWastePct: null, fixedWasteM: 0, beamCount: 1, beamLengthM: 1000 });
  check("§1a S1 net = 50 / 40 / 60 kg", J(s1.lines.map((l) => l.netKg)) === J([50, 40, 60]), J(s1.lines.map((l) => l.netKg)));
  check("§1b fire yokken brüt = net (fireli sütun çizilmez)", !s1.hasWaste && s1.wasteSources.length === 0 && J(s1.lines.map((l) => l.grossKg)) === J([50, 40, 60]));
  check("§1c müşterinin gram formülü (denye × tel × mt ÷ 9000) ÷ 1000 ile birebir", s1.lines[0]!.netKg === (150 * 3000 * 1000) / 9000 / 1000);
  check("§1d toplam 150 kg, metre 1000", s1.totals.netKg === 150 && s1.lengthM === 1000 && s1.grossLengthM === 1000);

  // ── §2 S2 MONO: 165 den × 5250 + 70 den × 5250; 2 × 2500 m ──
  const s2 = computeWarpPlanForward({
    lines: [{ yarnItemId: "a", endsCount: 5250, denier: 165, yarnWastePct: null }, { yarnItemId: "b", endsCount: 5250, denier: 70, yarnWastePct: null }],
    specWastePct: null, fixedWasteM: 0, beamCount: 2, beamLengthM: 2500,
  });
  check("§2 S2 MONO 481,250 kg + 204,167 kg", s2.lines[0]!.netKg === 481.25 && s2.lines[1]!.netKg === 204.167, J(s2.lines.map((l) => l.netKg)));

  // ── §3 S3: kart %3 + sabit 20 m → fire BÖLEREK, firesiz sütun aynı kalır ──
  const s3 = computeWarpPlanForward({ lines: [X, Y, Z], specWastePct: 3, fixedWasteM: 20, beamCount: 1, beamLengthM: 1000 });
  check("§3a S3 fireli 52,577 / 42,062 / 63,093", J(s3.lines.map((l) => l.grossKg)) === J([52.577, 42.062, 63.093]), J(s3.lines.map((l) => l.grossKg)));
  check("§3b firesiz 50 / 40 / 60 ayrı kalır; hasWaste + kaynaklar sabit 20 m · kart %3",
    J(s3.lines.map((l) => l.netKg)) === J([50, 40, 60]) && s3.hasWaste && J(s3.wasteSources) === J([{ kind: "SABIT_M", value: 20 }, { kind: "KART_PCT", value: 3 }]), J(s3.wasteSources));
  check("§3c yuvarlamasız öneri (tam kg'a/adıma yuvarlanmaz)", !Number.isInteger(s3.lines[0]!.grossKg) && s3.grossLengthM === 1020);
  const s3b = computeWarpPlanForward({ lines: [{ ...X, yarnWastePct: 5 }, Y], specWastePct: 3, fixedWasteM: 0, beamCount: 1, beamLengthM: 1000 });
  check("§3d iplik kartı firesi kart firesini ezer: x 50 ÷ 0,95 = 52,632 (IPLIK), y 40 ÷ 0,97 = 41,237 (KART)",
    s3b.lines[0]!.grossKg === 52.632 && s3b.lines[0]!.wasteSource === "IPLIK" && s3b.lines[1]!.grossKg === 41.237 && s3b.lines[1]!.wasteSource === "KART",
    J(s3b.lines.map((l) => [l.grossKg, l.wasteSource])));

  // ── §4 S4: ters yön — stok x 120, y 60, z 150 kg ──
  const s4 = computeWarpPlanReverse({ lines: [X, Y, Z], specWastePct: null, fixedWasteM: 0, stock: stockOf({ x: [120, null], y: [60, null], z: [150, null] }), beamLengthM: 700 });
  check("§4a S4 en çok 1500 m, kısıt y", s4.maxLengthM === 1500 && s4.constraintYarnItemId === "y", `${s4.maxLengthM} ${s4.constraintYarnItemId}`);
  check("§4b artan x 45, y 0, z 60 kg", J(s4.lines.map((l) => l.leftoverKg)) === J([45, 0, 60]), J(s4.lines.map((l) => l.leftoverKg)));
  check("§4c levent 700 m → 2 tam levent + 100 m", s4.fullBeams === 2 && s4.remainderM === 100 && !s4.insufficient);
  const s4f = computeWarpPlanReverse({ lines: [X, Y, Z], specWastePct: 3, fixedWasteM: 20, stock: stockOf({ x: [120, null], y: [60, null], z: [150, null] }) });
  check("§4d fireli ters yön: y 60 × 0,97 × 9e6 ÷ 360000 = 1455 − 20 = 1435 m; artan ≥ 0",
    s4f.maxLengthM === 1435 && s4f.constraintYarnItemId === "y" && s4f.lines.every((l) => (l.leftoverKg ?? -1) >= 0), `${s4f.maxLengthM} ${J(s4f.lines.map((l) => l.leftoverKg))}`);
  const s4z = computeWarpPlanReverse({ lines: [X, Y], specWastePct: null, fixedWasteM: 0, stock: stockOf({ x: [120, null], y: [0, null] }) });
  check("§4e stok 0 → 0 m + yetersiz", s4z.maxLengthM === 0 && s4z.insufficient);
  const s4u = computeWarpPlanReverse({ lines: [X, Y], specWastePct: null, fixedWasteM: 0, stock: stockOf({ x: [120, null], y: [null, null] }) });
  check("§4f stok bilinmiyor → null (0 değil), kısıt yok", s4u.maxLengthM === null && s4u.unknownStock && s4u.constraintYarnItemId === null);

  // ── §5 S5: deverecide duran iplik ──
  const s5 = computeWarpPlanReverse({ lines: [X, Y, Z], specWastePct: null, fixedWasteM: 0, stock: stockOf({ x: [500, 0], y: [30, 30], z: [500, 0] }) });
  check("§5a kullanılabilir = depo 30 + deverecide 30 = 60 → 1500 m", s5.lines[1]!.availableKg === 60 && s5.maxLengthM === 1500);
  const f5 = computeWarpPlanForward({ lines: [X, Y, Z], specWastePct: null, fixedWasteM: 0, beamCount: 1, beamLengthM: 1000, stock: stockOf({ x: [500, null], y: [30, 30], z: [500, null] }) });
  check("§5b ileri: y gönderilecek = 40 − 30 = 10, depo eksiği 0", f5.lines[1]!.sendKg === 10 && f5.lines[1]!.depoShortKg === 0);
  const f5b = computeWarpPlanForward({ lines: [X, Y, Z], specWastePct: null, fixedWasteM: 0, beamCount: 1, beamLengthM: 1000, stock: stockOf({ x: [500, null], y: [30, null], z: [500, null] }) });
  check("§5c başka devereci (deverecide yok): gönderilecek 40, depo eksiği 10", f5b.lines[1]!.sendKg === 40 && f5b.lines[1]!.depoShortKg === 10 && f5b.lines[1]!.fasondaKg === null);

  // ── §6 S6: giriş yardımcıları ──
  const e1 = endsFromKgPer1000m(50, 150);
  check("§6a 1000 m'ye 50 kg, 150 den → 3000 tel, fark 0", e1.endsCount === 3000 && e1.diffKg === 0, J(e1));
  const e2 = endsFromKgPer1000m(50, 165);
  check("§6b 1000 m'ye 50 kg, 165 den → 2727 tel, fark 0,005 kg", e2.endsCount === 2727 && e2.diffKg === 0.005, J(e2));
  check("§6c tarak 20 × en 350 × dişe 1 → 7000 tel", endsFromReed(20, 350, 1) === 7000);
}

async function serviceSections(): Promise<void> {
  const damga = `TEST-CZP-${process.pid}`;
  const itemIds: string[] = [];
  const specIds: string[] = [];
  let lotId: string | null = null;
  try {
    const mk = async (suffix: string, den: string | null) => {
      const it = await prisma.item.create({ data: { code: `${damga}-${suffix}`, name: `${damga}-${suffix}`, itemType: ItemType.YARN, unit: "KG", linearDensityDen: den }, select: { id: true } });
      itemIds.push(it.id);
      return it.id;
    };
    const x = await mk("X", "150"), y = await mk("Y", "150"), z = await mk("Z", "300"), nod = await mk("NODEN", null);
    // Çok iplikli kart — D1'de yalnız testte doğrudan yazılır (yazma yüzeyi D3).
    const spec = await prisma.warpSpec.create({
      data: {
        code: `${damga}-K`, name: `${damga}-KART`, yarnItemId: x, endsCount: 7200,
        yarns: { create: [{ yarnItemId: x, endsCount: 3000, sortOrder: 0 }, { yarnItemId: y, endsCount: 2400, sortOrder: 1 }, { yarnItemId: z, endsCount: 1800, sortOrder: 2 }] },
      },
      select: { id: true },
    });
    specIds.push(spec.id);
    const legacy = await prisma.warpSpec.create({ data: { code: `${damga}-ESKI`, name: `${damga}-ESKI`, yarnItemId: x, endsCount: 3000 }, select: { id: true } });
    specIds.push(legacy.id);

    const OFF = { [SETTING_KEYS.DEVERE_ENABLED]: true, [SETTING_KEYS.IPLIK_ENABLED]: false, [SETTING_KEYS.DEVERE_WARP_FIXED_WASTE_M]: 0 };
    const ON = { [SETTING_KEYS.DEVERE_ENABLED]: true, [SETTING_KEYS.IPLIK_ENABLED]: true, [SETTING_KEYS.TICARET_ENABLED]: true, [SETTING_KEYS.EMANET_ENABLED]: false, [SETTING_KEYS.DEVERE_WARP_FIXED_WASTE_M]: 0 };

    await withSettings(OFF, async () => {
      const r = (await calculateWarpPlan({ mode: "FROM_BEAMS", warpSpecId: spec.id, beamCount: 1, beamLengthM: 1000 })).data!;
      check("§7a kayıtlı çok iplikli kart (satırlar) → 50 / 40 / 60 kg, sıra korunur",
        J(r.forward!.lines.map((l) => l.netKg)) === J([50, 40, 60]) && J(r.yarns.map((t) => t.yarnItemId)) === J([x, y, z]));
      check("§7b iplik kapalı → stok bilinmiyor (null, 0 değil)", r.stock.known === false && r.forward!.lines.every((l) => l.depoKg === null && l.depoShortKg === null));
      const rv = await calculateWarpPlan({ mode: "FROM_STOCK", warpSpecId: spec.id });
      check("§7c iplik kapalı ters yön → en çok metre null + uyarı", rv.data!.reverse!.maxLengthM === null && (rv.warnings ?? []).length === 1);
      const lg = (await calculateWarpPlan({ mode: "FROM_BEAMS", warpSpecId: legacy.id, beamCount: 1, beamLengthM: 1000 })).data!;
      check("§7e göç güvenliği: satırsız (eski) kart kolonlardan tek satır → 50 kg", lg.forward!.lines.length === 1 && lg.forward!.lines[0]!.netKg === 50);
      const sub = await ensureTestDyeHouse();
      const rs = (await calculateWarpPlan({ mode: "FROM_BEAMS", warpSpecId: spec.id, beamCount: 1, beamLengthM: 1000, subcontractorId: sub.id })).data!;
      check("§7f devereci seçili → deverecide 0 (devere başlığı D4'te doğar), gönderilecek = brüt", rs.forward!.lines.every((l) => l.fasondaKg === 0 && l.sendKg === l.grossKg));
      await expect400("§7g kart + satır birlikte → 400", () => calculateWarpPlan({ mode: "FROM_BEAMS", warpSpecId: spec.id, lines: [{ yarnItemId: x, endsCount: 1 }], beamCount: 1, beamLengthM: 1 }));
      await expect400("§7h aynı iplik iki satır → 400", () => calculateWarpPlan({ mode: "FROM_BEAMS", lines: [{ yarnItemId: x, endsCount: 1 }, { yarnItemId: x, endsCount: 2 }], beamCount: 1, beamLengthM: 1 }));
      await expect400("§7i denyesiz iplik → 400", () => calculateWarpPlan({ mode: "FROM_BEAMS", lines: [{ yarnItemId: nod, endsCount: 10 }], beamCount: 1, beamLengthM: 1 }));
      await expect400("§7j leventten hesapta adet/boy eksik → 400", () => calculateWarpPlan({ mode: "FROM_BEAMS", warpSpecId: spec.id }));
      await expect400("§7k bilinmeyen devereci → 400", () => calculateWarpPlan({ mode: "FROM_BEAMS", warpSpecId: spec.id, beamCount: 1, beamLengthM: 1, subcontractorId: legacy.id }));
      const body = (await calculateWarpPlan({ mode: "FROM_BEAMS", lines: [{ yarnItemId: x, endsCount: 3000 }, { yarnItemId: y, endsCount: 2400 }], specWastePct: 3, fixedWasteM: 20, beamCount: 1, beamLengthM: 1000 })).data!;
      check("§7l kayıtsız kart (gövde satırları) önizlemesi: fireli 52,577 / 42,062", J(body.forward!.lines.map((l) => l.grossKg)) === J([52.577, 42.062]) && body.warpSpec === null);
    });

    await withSettings({ ...OFF, [SETTING_KEYS.DEVERE_WARP_FIXED_WASTE_M]: 20 }, async () => {
      const r = (await calculateWarpPlan({ mode: "FROM_BEAMS", warpSpecId: spec.id, beamCount: 1, beamLengthM: 1000 })).data!;
      check("§7m sabit fire ayardan gelir (20 m) → x 51 kg, hasWaste", r.fixedWasteM === 20 && r.forward!.lines[0]!.grossKg === 51 && r.forward!.hasWaste);
    });

    const wh = await prisma.warehouse.findFirst({ where: { isDefault: true }, select: { id: true } });
    if (!wh) throw new Error("Fikstür eksik: varsayılan depo");
    await prisma.yarnStock.createMany({ data: [{ itemId: x, warehouseId: wh.id, balanceKg: "120" }, { itemId: y, warehouseId: wh.id, balanceKg: "70" }, { itemId: z, warehouseId: wh.id, balanceKg: "150" }] });
    const lot = await prisma.yarnLot.create({ data: { itemId: y, lotNo: `${damga}-L1`, qualityStatus: YarnLotQualityStatus.ON_HOLD }, select: { id: true } });
    lotId = lot.id;
    await prisma.yarnMovement.create({ data: { itemId: y, warehouseId: wh.id, kind: YarnMovementKind.ADJUST_IN, qtyKg: "10", lotId, reason: damga } });
    await withSettings(ON, async () => {
      const rv = (await calculateWarpPlan({ mode: "FROM_STOCK", warpSpecId: spec.id, beamLengthM: 700 })).data!;
      check("§7d stoktan ters yön: y depo 70 − bekletmede 10 = 60 → 1500 m, kısıt y, 2 levent + 100 m",
        rv.stock.known && rv.reverse!.maxLengthM === 1500 && rv.reverse!.constraintYarnItemId === y && rv.reverse!.fullBeams === 2 && rv.reverse!.remainderM === 100,
        `${rv.reverse!.maxLengthM} ${J(rv.reverse!.lines.map((l) => l.availableKg))}`);
    });
  } finally {
    if (lotId) {
      await prisma.yarnMovement.deleteMany({ where: { lotId } });
      await prisma.yarnLot.deleteMany({ where: { id: lotId } });
    }
    await prisma.yarnStock.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.warpSpec.deleteMany({ where: { id: { in: specIds } } });
    await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
  }
}

function textSections(): void {
  const src = path.resolve(__dirname, "../src");
  const route = fs.readFileSync(path.join(src, "routes/warp-plan.routes.ts"), "utf8");
  check("§8a route devere kapısında + warpspec:read", /router\.use\(verifyToken, requireDevereEnabled\)/.test(route) && route.includes('requirePermission("warpspec:read")'));
  check("§8b app.ts /api/warp-plan bağlı", /app\.use\("\/api\/warp-plan", warpPlanRoutes\)/.test(fs.readFileSync(path.join(src, "app.ts"), "utf8")));
  const helper = fs.readFileSync(path.join(src, "services/helpers/warp-plan.helper.ts"), "utf8");
  check("§9 formül sabiti motora KOPYALANMAMIŞ (9.000.000 yalnız constants/warp-beam.ts)", !/9_?000_?000|9e6\b|\b9000\b/.test(helper.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")));
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.error(engel);
    process.exitCode = 1;
    return;
  }
  pureSections();
  await serviceSections();
  textSections();
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
