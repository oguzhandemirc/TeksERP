// =============================================================================
// TEST: TON GRUBU (shade sorting, 2026-11-23) — `Roll.shadeCode` + `shipping.shadeMixPolicy`
// Çalıştır: npx tsx scripts/test_ton_grubu.ts
// =============================================================================
//   §1 saf: normalizeShadeCode (ASCII büyütme, boş → null, geçersiz 400) · groupShadeMixes (NULL sayılmaz,
//      aynı ürün+renk ≥2 ton = karışım, farklı renk karışım değil)
//   §2 DB CHECK `rolls_shade_code_format_chk`: küçük harf / 5 karakter reddedilir
//   §3 fason kabul doğuşu: newRolls[].shadeCode normalize edilerek topa yazılır; verilmeyen NULL
//   §4 tambur kesim kalıtımı: çocuk atanın tonunu alır
//   §5 setRollShade: atar + labelDirty + audit; kilitli (SHIPPED) top 409, hiçbir şey yazılmaz; null kaldırır
//   §6 önizleme: off → uyarı yok; warn → `[SHADE_MIX]` + shadeMixes; sevk kapısı block → 409 SHADE_MIX, off/warn geçer
//   §7 kapı bağlantısı: performDispatchTx + executeDirectShip + create-preview helper'ı çağırır (metin taraması)
// NEGATİF SONDA (elle, 2026-11-23): groupShadeMixes'te `continue` (NULL atlama) kaldırılınca §1 kırmızı;
// warehouse-cut.ts'te `shadeCode: parent.shadeCode` satırı silinince §4 kırmızı; assertShadeMixAllowedTx'te
// `policy !== "block"` → `policy === "off"` yapılınca §6 kırmızı. Yedek kopyadan geri alındı.
// ⚠️ DB'ye YAZAR (kendi TST-TON- topları + bayrak; bayrak finally'de BİREBİR geri) → `hedefDbEngeli()` ilk adım.
// =============================================================================

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Prisma, RollStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { roleGrade } from "./fixture-quality-grade";
import { ensureTestDyeHouse } from "./fixture-subcontractor";
import { fixtureWarehouseId } from "./fixture-warehouse";
import { ensureDefaultWarehouse } from "../src/jobs/default-warehouse.job";
import { ensureTestAdmin } from "./fixture-test-user";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { TamburService } from "../src/services/tambur.service";
import { setRollShade } from "../src/services/inventory/roll-shade";
import { SETTING_KEYS } from "../src/services/system-setting/keys";
import {
  assertShadeMixAllowedTx,
  groupShadeMixes,
  normalizeShadeCode,
  previewShadeMixes,
  type ShadeRollRow,
} from "../src/services/helpers/shade-group.helper";

const sub = new SubcontractorService();
const cards = new TravelerCardService();
const tambur = new TamburService();
const TAG = `TST-TON-${Date.now()}`;
const POLICY_KEY = SETTING_KEYS.SHIPPING_SHADE_MIX_POLICY;

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`  ✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.error(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}

type Err = { statusCode?: number; details?: { code?: string } } | null;
const hataOf = <T,>(p: Promise<T>): Promise<Err> => p.then(() => null, (e: Err) => e ?? {});

let ITEM = "", ADMIN = "", ST_BOYA = "", ST_TAMBUR = "", SUB_BOYER = "", GRADE = "", GRADE_CODE = "", COLOR_A = "", COLOR_B = "";
const woIds: string[] = [];
let seq = 0;

async function fikstur(): Promise<void> {
  const need = <T,>(v: T | null, label: string): T => {
    if (!v) throw new Error(`Fikstür eksik: ${label} (önce 'npm run seed' + 'seed:fixtures')`);
    return v;
  };
  ITEM = need(await prisma.item.findUnique({ where: { code: "PATOS" }, select: { id: true } }), "Item PATOS").id;
  ADMIN = (await ensureTestAdmin()).id;
  await ensureDefaultWarehouse(); // boot uzlaştırması taze test DB'sinde koşmamış olabilir
  ST_BOYA = need(await prisma.station.findFirst({ where: { code: "BOYA_FASON" }, select: { id: true } }), "BOYA_FASON").id;
  ST_TAMBUR = need(await prisma.station.findFirst({ where: { code: "TAMBUR_1" }, select: { id: true } }), "TAMBUR_1").id;
  SUB_BOYER = (await ensureTestDyeHouse()).id;
  const g = await roleGrade("FIRST");
  GRADE = g.id;
  GRADE_CODE = g.code;
  const colors = await prisma.color.findMany({ select: { id: true }, orderBy: { id: "asc" }, take: 2 });
  COLOR_A = need(colors[0] ?? null, "Renk 1").id;
  COLOR_B = need(colors[1] ?? null, "Renk 2").id;
}

async function top(opts: { status?: RollStatus; shadeCode?: string | null; colorId?: string | null } = {}): Promise<string> {
  seq += 1;
  const r = await prisma.roll.create({
    data: {
      barcode: `${TAG}-${seq}`, itemId: ITEM, colorId: opts.colorId ?? null, initialQty: 200, currentQty: 200,
      status: opts.status ?? RollStatus.STOCK, shadeCode: opts.shadeCode ?? null,
      warehouseId: await fixtureWarehouseId(), qualityGrade: GRADE_CODE, qualityGradeId: GRADE, width: 250, createdById: ADMIN,
    },
    select: { id: true },
  });
  return r.id;
}

// Anahtar çağrının İLK argümanı: `test_bekci_ayar_geri_alma` §1b SET ↔ RESTORE eşlemesini anahtarla yapar.
async function setPolicy(key: typeof POLICY_KEY, v: "off" | "warn" | "block"): Promise<void> {
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });
}

function bolum1(): void {
  console.log("\n§1 saf yüklem");
  check("normalize: ' b ' → 'B'", normalizeShadeCode(" b ") === "B");
  check("normalize: 'a2' → 'A2'", normalizeShadeCode("a2") === "A2");
  check("normalize: 'i' → 'I' (Türkçe İ değil)", normalizeShadeCode("i") === "I");
  check("normalize: boş/null → null", normalizeShadeCode("  ") === null && normalizeShadeCode(null) === null);
  let bad = 0;
  for (const raw of ["ı", "ABCDE", "A-1", 5]) {
    try { normalizeShadeCode(raw); } catch (e) { if ((e as { statusCode?: number }).statusCode === 400) bad++; }
  }
  check("normalize: geçersiz (ı, 5 karakter, tire, sayı) → 400", bad === 4, `${bad}/4`);

  const row = (id: string, colorId: string | null, shadeCode: string | null): ShadeRollRow => ({ id, barcode: id, itemId: "I1", colorId, shadeCode });
  const tekTonNull = groupShadeMixes([row("r1", "C1", "A"), row("r2", "C1", null), row("r3", "C1", "A")]);
  check("group: tek ton + tonsuz → karışım YOK (NULL sayılmaz)", tekTonNull.length === 0);
  const renkFarki = groupShadeMixes([row("r1", "C1", "A"), row("r2", "C2", "B")]);
  check("group: farklı renkte farklı ton → karışım YOK", renkFarki.length === 0);
  const mix = groupShadeMixes([row("r1", "C1", "B"), row("r2", "C1", "A"), row("r3", "C1", null), row("r4", "C2", "A")]);
  check("group: aynı ürün+renk A/B → tek karışım grubu, tonlar sıralı, tonsuz bilgi olarak",
    mix.length === 1 && mix[0]!.shades.join(",") === "A,B" && mix[0]!.unshadedBarcodes.join(",") === "r3" && mix[0]!.rollsByShade.B?.[0] === "r1",
    JSON.stringify(mix.map((g) => g.shades)));
}

async function bolum2(): Promise<void> {
  console.log("\n§2 DB CHECK");
  let reddedilen = 0;
  const mesajlar: string[] = [];
  for (const bad of ["a", "A-1"]) {
    const e = await hataOf(top({ shadeCode: bad }));
    const m = e ? JSON.stringify({ msg: (e as unknown as Error).message, meta: (e as unknown as { meta?: unknown }).meta }) : "kabul edildi";
    if (m.includes("rolls_shade_code_format_chk")) reddedilen++;
    else mesajlar.push(m.slice(0, 300));
  }
  check("CHECK küçük harf ve tireyi reddeder (servisi atlayan ham yazım)", reddedilen === 2, `${reddedilen}/2 ${mesajlar.join(" | ")}`);
}

async function bolum3(): Promise<void> {
  console.log("\n§3 fason kabul doğuşu");
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `${TAG}-WO`, type: "STOCK_PRODUCTION", status: "IN_PROGRESS", width: 250, targetItemId: ITEM,
      steps: { create: [{ stationId: ST_BOYA, stepSequence: 1, status: "PENDING" }, { stationId: ST_TAMBUR, stepSequence: 2, status: "PENDING" }] },
    },
    include: { steps: { orderBy: { stepSequence: "asc" } } },
  });
  woIds.push(wo.id);
  await prisma.$transaction((tx) => cards.createForWorkOrder(tx, wo.id, ADMIN));
  const step = wo.steps[0]!.id;
  const giden = await top();
  await sub.dispatch({ workOrderId: wo.id, stepId: step, subcontractorId: SUB_BOYER, rollIds: [giden] }, ADMIN);
  const r = await sub.receive(
    { workOrderId: wo.id, stepId: step, subcontractorId: SUB_BOYER, returns: [{ rollId: giden }], newRolls: [{ qty: 120, shadeCode: " b " }, { qty: 70 }] },
    ADMIN,
  );
  const dogan = await prisma.roll.findMany({ where: { parentReceiptId: (r.data as { id: string }).id }, select: { initialQty: true, shadeCode: true } });
  const by = new Map(dogan.map((d) => [Number(d.initialQty), d.shadeCode]));
  check("doğan topun tonu normalize yazıldı (' b ' → 'B')", by.get(120) === "B", JSON.stringify([...by]));
  check("ton verilmeyen doğan top NULL", by.has(70) && by.get(70) === null);
}

async function bolum4(): Promise<void> {
  console.log("\n§4 tambur kesim kalıtımı");
  const ata = await top({ shadeCode: "C" });
  const r = await tambur.cutWarehouseRoll(ata, { cutLength: 30, rawDestination: "STOCK" });
  const cocuk = await prisma.roll.findUnique({ where: { id: r.data.childRoll.id }, select: { shadeCode: true } });
  check("kesilen çocuk atanın tonunu aldı (C)", cocuk?.shadeCode === "C", `çocuk=${cocuk?.shadeCode}`);
}

async function bolum5(): Promise<void> {
  console.log("\n§5 Ton ata (setRollShade)");
  const a = await top();
  const b = await top();
  const logOnce = await prisma.systemLog.count({ where: { recordId: { in: [a, b] } } });
  const res = await setRollShade({ rollIds: [a, b], shadeCode: "d" }, ADMIN);
  const rows = await prisma.roll.findMany({ where: { id: { in: [a, b] } }, select: { shadeCode: true, labelDirty: true } });
  check("iki topa 'D' yazıldı + etiket bayat", res.data?.updated === 2 && rows.every((x) => x.shadeCode === "D" && x.labelDirty));
  const logSonra = await prisma.systemLog.count({ where: { recordId: { in: [a, b] } } });
  check("her top için audit izi", logSonra - logOnce === 2, `+${logSonra - logOnce}`);

  const kilitli = await top({ status: RollStatus.SHIPPED });
  const e = await hataOf(setRollShade({ rollIds: [a, kilitli], shadeCode: "E" }, ADMIN));
  const aSonra = await prisma.roll.findUnique({ where: { id: a }, select: { shadeCode: true } });
  check("sevk edilmiş top varsa 409, serbest top da değişmedi", e?.statusCode === 409 && aSonra?.shadeCode === "D", `${e?.statusCode} · a=${aSonra?.shadeCode}`);

  await setRollShade({ rollIds: [b], shadeCode: null }, ADMIN);
  const bSonra = await prisma.roll.findUnique({ where: { id: b }, select: { shadeCode: true } });
  check("null tonu kaldırır", bSonra?.shadeCode === null);
  const gecersiz = await hataOf(setRollShade({ rollIds: [b], shadeCode: "ç" }, ADMIN));
  check("geçersiz kod 400", gecersiz?.statusCode === 400);
}

async function bolum6(): Promise<void> {
  console.log("\n§6 önizleme + sevk kapısı");
  const x1 = await top({ colorId: COLOR_A, shadeCode: "A" });
  const x2 = await top({ colorId: COLOR_A, shadeCode: "B" });
  const x3 = await top({ colorId: COLOR_B, shadeCode: "A" });
  const tekRenk = await top({ colorId: COLOR_B, shadeCode: null });
  const rollIds = [x1, x2, x3, tekRenk];

  await setPolicy(SETTING_KEYS.SHIPPING_SHADE_MIX_POLICY, "off");
  const off = await previewShadeMixes(prisma, { rollIds });
  check("off: uyarı ve grup yok", off.warnings.length === 0 && off.shadeMixes.length === 0 && off.shadeMixPolicy === "off");
  const offGate = await hataOf(prisma.$transaction((tx) => assertShadeMixAllowedTx(tx, { rollIds, belge: "test" })));
  check("off: kapı geçer", offGate === null);

  await setPolicy(SETTING_KEYS.SHIPPING_SHADE_MIX_POLICY, "warn");
  const warn = await previewShadeMixes(prisma, { rollIds });
  check("warn: tek karışım (renk A: A/B) + [SHADE_MIX] uyarısı",
    warn.shadeMixes.length === 1 && warn.shadeMixes[0]!.colorId === COLOR_A && warn.warnings.length === 1 && warn.warnings[0]!.startsWith("[SHADE_MIX]"),
    `${warn.shadeMixes.length} grup`);
  const warnGate = await hataOf(prisma.$transaction((tx) => assertShadeMixAllowedTx(tx, { rollIds, belge: "test" })));
  check("warn: kapı geçer", warnGate === null);

  await setPolicy(SETTING_KEYS.SHIPPING_SHADE_MIX_POLICY, "block");
  const blockGate = await hataOf(prisma.$transaction((tx) => assertShadeMixAllowedTx(tx, { rollIds, belge: "test" })));
  check("block: karışımda 409 SHADE_MIX", blockGate?.statusCode === 409 && blockGate.details?.code === "SHADE_MIX", `${blockGate?.statusCode} ${blockGate?.details?.code}`);
  const temiz = await hataOf(prisma.$transaction((tx) => assertShadeMixAllowedTx(tx, { rollIds: [x1, x3, tekRenk], belge: "test" })));
  check("block: tek tonlu küme (NULL dahil) geçer", temiz === null);
}

function bolum7(): void {
  console.log("\n§7 kapı bağlantısı");
  const src = (p: string) => readFileSync(join(__dirname, "..", "src", p), "utf8");
  check("performDispatchTx kapıyı çağırır", /assertShadeMixAllowedTx\(tx,/.test(src("services/shipping/dispatch.ts")));
  check("executeDirectShip kapıyı çağırır", /assertShadeMixAllowedTx\(tx,/.test(src("services/subcontractor/direct-ship.ts")));
  check("sevk önizlemesi aynı helper'ı okur", /previewShadeMixes\(/.test(src("services/shipping/create-preview.ts")));
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) { console.error(`⛔ ${engel}`); process.exitCode = 1; return; }
  console.log("=== Ton grubu ===");
  const eski = await prisma.systemSetting.findUnique({ where: { key: POLICY_KEY } });
  try {
    bolum1();
    await fikstur();
    await bolum2();
    await bolum3();
    await bolum4();
    await bolum5();
    await bolum6();
    bolum7();
  } finally {
    if (eski) await prisma.systemSetting.update({ where: { key: SETTING_KEYS.SHIPPING_SHADE_MIX_POLICY }, data: { value: eski.value as Prisma.InputJsonValue } });
    else await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.SHIPPING_SHADE_MIX_POLICY } });
    await temizle().catch((err) => { fail++; console.error("temizlik hatası:", err); });
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exitCode = fail > 0 ? 1 : 0;
}

async function temizle(): Promise<void> {
  const stepIds = (await prisma.workOrderStep.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } })).map((s) => s.id);
  const rollIds = (await prisma.roll.findMany({
    where: { OR: [{ barcode: { startsWith: TAG } }, { parent: { barcode: { startsWith: TAG } } }, { parentReceipt: { workOrderId: { in: woIds } } }, { producedInStepId: { in: stepIds } }] },
    select: { id: true },
  })).map((r) => r.id);
  const receiptIds = (await prisma.subcontractorReceipt.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } })).map((r) => r.id);
  const dispatchIds = (await prisma.subcontractorDispatch.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } })).map((d) => d.id);
  await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
  await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
  await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } });
  await prisma.subcontractorReceiptItem.deleteMany({ where: { receiptId: { in: receiptIds } } });
  await prisma.subcontractorReceiptProperty.deleteMany({ where: { receiptId: { in: receiptIds } } });
  await prisma.subcontractorDispatchItem.deleteMany({ where: { dispatchId: { in: dispatchIds } } });
  await prisma.rollVariance.deleteMany({ where: { rollId: { in: rollIds } } });
  await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds } } });
  await prisma.roll.deleteMany({ where: { id: { in: rollIds }, parentRollId: { not: null } } });
  await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
  await prisma.subcontractorReceipt.deleteMany({ where: { id: { in: receiptIds } } });
  await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: dispatchIds } } });
  await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: woIds } } });
  await prisma.batch.deleteMany({ where: { workOrderId: { in: woIds } } });
  await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } });
  await prisma.systemLog.deleteMany({ where: { recordId: { in: [...rollIds, ...receiptIds, ...dispatchIds, ...woIds] } } });
  await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
}

main()
  .catch((e) => {
    console.error("HATA:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
