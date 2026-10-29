// =============================================================================
// BEKÇİ — TAMBUR İSTASYON YETENEĞİ KESİMLE DOĞAN ÇOCUĞA (Gülkesim dalga 3a · T1)
// =============================================================================
// Çalıştırma: npx tsx scripts/test_tambur_istasyon_yetenegi.ts
//
// NEDEN: Tambur istasyonunun AUTO özelliği (ör. "Tambur" hizmet bayrağı) kesim/bölme
// yollarında çocuğa yazılmıyordu; çocuk yalnız atadan kalıtıyordu. H10'un CUT tabanı
// (Tambur işi kesilen metreyle faturalanır) gerçek akışta hiç doğmuyordu (S1 bulgusu).
//
// ÖLÇÜLENLER (yol başına bir madde):
//   §1 finalize (adımlı): kesim + kalan çocuk AUTO bayrağı taşır; OPTIONAL yazılmaz; kalıtım korunur;
//      ata bayrak kazanmaz; çocuğun işi H10 bayrak yolunda CUT = kesilen metre, adım = Tambur adımı
//   §2 cutOpenFabric (adımlı tek kesim): çocuk AUTO bayrağı taşır
//   §3 finalizeOpenFabric (kalan parça): kalan çocuk AUTO bayrağı taşır
//   §4 cutWarehouseRoll (Top Kesme, oturum istasyonu Tambur): çocuk AUTO bayrağı taşır
//   §5 finalizeWarehouseCut (Top Kesme kalanı): kalan çocuk AUTO bayrağı taşır
//   §6 Oturum istasyonu Tambur DEĞİLSE ya da yoksa Top Kesme çocuğu o istasyonun yeteneğini almaz
//   §7 AUTO özelliksiz Tambur'da çocuk özellik kümesi = atanınki (bugünkü davranış, bayt-aynı)
//   §8 Geri alma: tek parça (Top Kesme) ve TÜMDEN (finalize) — çocuk CANCELLED, ata bayraksız
//      geri döner, ataya H10 Tambur işi doğmaz; özelliksiz atada istasyon satırı donöre girmez
//      (doğum anı + 1 ms damgası)
//   §9 Elle top (K3c): `createManualRoll` (adıma bağlı) ve `produceFinishedRoll` (kartsız) Tambur
//      oturumunda AUTO bayrağı yazar, OPTIONAL yazmaz; kartsız üretimde oturum Tambur değilse ya da
//      yoksa yazılmaz; replay (aynı token) ikinci satır doğurmaz
// Negatif sonda (2026-10-29, K3c): tambur-manual'daki iki `applyTamburCapabilitiesTx` çağrısı
// kaldırılınca §9 kırmızı.
// Negatif sonda (2026-10-29): `applyTamburCapabilitiesTx` gövdesi boşaltılınca §1–§5 + S1 kırmızı.
// =============================================================================
import { randomUUID } from "node:crypto";
import { ItemType, Prisma, RollStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { TamburService } from "../src/services/tambur.service";
import { TamburUndoService, UNDO_FULL_PERMISSION } from "../src/services/tambur-undo.service";
import { TamburManualService } from "../src/services/tambur-manual.service";
import { ensureDefaultWarehouse } from "../src/jobs/default-warehouse.job";
import { listFlagServiceWorks } from "../src/services/helpers/service-flag-work.helper";
import { roleGrade } from "./fixture-quality-grade";
import { testActorId } from "./fixture-test-user";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`); } else { fail++; console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}
function section(t: string): void { console.log(`\n── ${t} ──`); }

const STAMP = randomUUID().slice(0, 8);
const P = `TEST-TBIY-${STAMP}`;
const tambur = new TamburService();
const undo = new TamburUndoService();
const manual = new TamburManualService();
const fx = { itemIds: [] as string[], propIds: [] as string[], stationIds: [] as string[], woIds: [] as string[], rollIds: [] as string[] };
const eq = (a: Prisma.Decimal.Value | null | undefined, b: number) => a != null && new Prisma.Decimal(a).minus(b).abs().lte(0.001);

async function main(): Promise<void> {
  console.log("=== Tambur istasyon yeteneği → kesim çocuğu (T1) ===");
  const actor = await testActorId();
  const wh = await ensureDefaultWarehouse();
  if (!wh) throw new Error("Varsayılan depo yok");
  const grade = (await roleGrade("FIRST")).code;

  const mkItem = async (suffix: string, itemType: ItemType) => {
    const it = await prisma.item.create({ data: { code: `${P}-${suffix}`.slice(0, 32), name: `TEST TBIY ${suffix}`, itemType, unit: "MT" }, select: { id: true } });
    fx.itemIds.push(it.id);
    return it.id;
  };
  const fabric = await mkItem("KUM", ItemType.FABRIC);
  const SVC = await mkItem("TMBH", ItemType.SERVICE);
  const mkFlag = async (suffix: string, serviceItemId: string | null) => {
    const p = await prisma.fabricProperty.create({ data: { code: `${P}-${suffix}`.slice(0, 32), name: `TEST TBIY ${suffix}`, valueType: "FLAG", serviceItemId }, select: { id: true } });
    fx.propIds.push(p.id);
    return p.id;
  };
  const FA = await mkFlag("AUTO", SVC); // Tambur istasyonunun AUTO bayrağı (hizmet eşlemeli)
  const FO = await mkFlag("OPT", null); // OPTIONAL — seçimsiz yolda yazılmamalı
  const FP = await mkFlag("ATA", null); // atanın kendi bayrağı — kalıtım
  const mkStation = async (suffix: string, kind: "TAMBUR" | "PROCESS_QC", caps: Array<{ propertyId: string; mode: "AUTO" | "OPTIONAL" }>) => {
    const s = await prisma.station.create({ data: { code: `${P}-${suffix}`.slice(0, 32), name: `TEST TBIY ${suffix}`, type: "INTERNAL", kind, appliesProperty: true }, select: { id: true } });
    fx.stationIds.push(s.id);
    if (caps.length) await prisma.stationProperty.createMany({ data: caps.map((c) => ({ stationId: s.id, ...c })) });
    return s.id;
  };
  const ST_T = await mkStation("T", "TAMBUR", [{ propertyId: FA, mode: "AUTO" }, { propertyId: FO, mode: "OPTIONAL" }]);
  const ST_T0 = await mkStation("T0", "TAMBUR", [{ propertyId: FO, mode: "OPTIONAL" }]);
  const ST_Q = await mkStation("Q", "PROCESS_QC", [{ propertyId: FA, mode: "AUTO" }]);

  const mkStep = async (stationId: string): Promise<string> => {
    const wo = await prisma.workOrder.create({
      data: { workOrderNumber: `${P}-WO${fx.woIds.length}`, type: "STOCK_PRODUCTION", status: "IN_PROGRESS", targetItemId: fabric, steps: { create: [{ stationId, stepSequence: 1, status: "ACTIVE" }] } },
      select: { id: true, steps: { select: { id: true } } },
    });
    fx.woIds.push(wo.id);
    return wo.steps[0]!.id;
  };
  let seq = 0;
  /** Tambur adımında bekleyen top (açık hareketle) ya da depoda barkodlu top; atanın bayrağı FP. */
  const mkRoll = async (qty: number, at: { stepId: string } | "WAREHOUSE", withParentFlag = true): Promise<string> => {
    const r = await prisma.roll.create({
      data: {
        barcode: `${P}-R${seq++}`, itemId: fabric, initialQty: qty, currentQty: qty, qualityGrade: grade, entrySource: "SUPPLIER_RECEIPT",
        ...(at === "WAREHOUSE" ? { status: RollStatus.WAREHOUSE, warehouseId: wh.id } : { status: RollStatus.IN_PRODUCTION, currentStepId: at.stepId, warehouseId: wh.id }),
      },
      select: { id: true },
    });
    fx.rollIds.push(r.id);
    if (at !== "WAREHOUSE") await prisma.rollMovement.create({ data: { rollId: r.id, workOrderStepId: at.stepId, qtyIn: qty } });
    if (withParentFlag) await prisma.rollProperty.create({ data: { rollId: r.id, propertyId: FP } });
    return r.id;
  };
  const propsOf = async (rollId: string) =>
    (await prisma.rollProperty.findMany({ where: { rollId, revokedAt: null }, select: { propertyId: true } })).map((p) => p.propertyId).sort();
  const hasAuto = async (ids: string[]) => {
    const out: boolean[] = [];
    for (const id of ids) {
      const ps = await propsOf(id);
      out.push(ps.includes(FA) && ps.includes(FP) && !ps.includes(FO));
    }
    return out;
  };

  // ── §1 finalize ───────────────────────────────────────────────────────────
  section("§1 finalize: kesim + kalan çocuk AUTO bayrağı taşır, ata taşımaz, H10 CUT");
  const S1 = await mkStep(ST_T);
  const R1 = await mkRoll(100, { stepId: S1 });
  const f1 = await tambur.finalize({ rollId: R1, decisions: [], cuts: [{ length: 40, qualityGrade: grade, relatedErrorIds: [] }] }, actor);
  const k1 = f1.data.splitRolls.map((c) => c.id);
  const h1 = await hasAuto(k1);
  check("finalize: 2 çocuğun ikisi de AUTO + ata bayrağı taşır, OPTIONAL yok", k1.length === 2 && h1.every(Boolean), JSON.stringify(h1));
  check("finalize: ata (TAMBUR_CONSUMED) AUTO bayrağı kazanmadı", !(await propsOf(R1)).includes(FA));
  const w1 = await listFlagServiceWorks([R1, ...k1], "OUT");
  const tb1 = w1.filter((w) => w.serviceItemId === SVC);
  check("H10: Tambur işi çocuklarda, taban CUT, metre 40 + 60, adım = Tambur adımı", tb1.length === 2 && tb1.every((w) => w.meterBasis === "CUT" && w.workOrderStepId === S1 && k1.includes(w.rollId)) && eq(tb1.reduce((a, w) => a.plus(w.meters), new Prisma.Decimal(0)), 100), JSON.stringify(tb1.map((w) => [w.meters.toString(), w.meterBasis])));

  // ── §2 / §3 açık kumaş ─────────────────────────────────────────────────────
  section("§2 cutOpenFabric · §3 finalizeOpenFabric");
  const S2 = await mkStep(ST_T);
  const R2 = await mkRoll(80, { stepId: S2 });
  const c2 = await tambur.cutOpenFabric(R2, { lengthMeters: 30, status: "WAREHOUSE", qualityGrade: grade, clientToken: randomUUID() }, actor);
  const k2 = (c2.data as { childRoll: { id: string } }).childRoll.id;
  check("cutOpenFabric: çocuk AUTO + ata bayrağı taşır", (await hasAuto([k2]))[0] === true, JSON.stringify(await propsOf(k2)));
  const f3 = await tambur.finalizeOpenFabric(R2, { remainingAction: "keep_1kalite" }, actor);
  const k3 = f3.data.remainingChildId ?? undefined;
  check("finalizeOpenFabric: kalan çocuk AUTO + ata bayrağı taşır", !!k3 && (await hasAuto([k3]))[0] === true, k3 ? JSON.stringify(await propsOf(k3)) : "kalan çocuk yok");

  // ── §4 / §5 Top Kesme ──────────────────────────────────────────────────────
  section("§4 cutWarehouseRoll · §5 finalizeWarehouseCut (oturum istasyonu Tambur)");
  const R4 = await mkRoll(90, "WAREHOUSE");
  const c4 = await tambur.cutWarehouseRoll(R4, { cutLength: 25, rawDestination: "WAREHOUSE", qualityGrade: grade, clientToken: randomUUID() }, actor, ST_T, null);
  const k4 = c4.data.childRoll.id;
  check("cutWarehouseRoll: çocuk AUTO + ata bayrağı taşır", (await hasAuto([k4]))[0] === true, JSON.stringify(await propsOf(k4)));
  const R5 = await mkRoll(70, "WAREHOUSE");
  await tambur.cutWarehouseRoll(R5, { cutLength: 20, rawDestination: "WAREHOUSE", qualityGrade: grade, clientToken: randomUUID() }, actor, ST_T, null);
  const f5 = await tambur.finalizeWarehouseCut(R5, { remainingAction: "keep_1kalite" }, actor, ST_T, null);
  const k5 = f5.data.remainingChild?.id;
  check("finalizeWarehouseCut: kalan çocuk AUTO + ata bayrağı taşır", !!k5 && (await hasAuto([k5]))[0] === true, k5 ? JSON.stringify(await propsOf(k5)) : "kalan çocuk yok");

  // ── §6 oturum istasyonu Tambur değil / yok ────────────────────────────────
  section("§6 Top Kesme: oturum istasyonu Tambur değilse ya da yoksa yetenek yazılmaz");
  const R6 = await mkRoll(60, "WAREHOUSE");
  const c6a = await tambur.cutWarehouseRoll(R6, { cutLength: 10, rawDestination: "WAREHOUSE", qualityGrade: grade, clientToken: randomUUID() }, actor, ST_Q, null);
  const c6b = await tambur.cutWarehouseRoll(R6, { cutLength: 10, rawDestination: "WAREHOUSE", qualityGrade: grade, clientToken: randomUUID() }, actor, null, null);
  const p6a = await propsOf(c6a.data.childRoll.id);
  const p6b = await propsOf(c6b.data.childRoll.id);
  check("kalite istasyonu oturumu: çocuk yalnız ata bayrağını taşır", JSON.stringify(p6a) === JSON.stringify([FP]), JSON.stringify(p6a));
  check("oturumsuz: çocuk yalnız ata bayrağını taşır", JSON.stringify(p6b) === JSON.stringify([FP]), JSON.stringify(p6b));

  // ── §7 AUTO özelliksiz Tambur: bugünkü davranış ───────────────────────────
  section("§7 AUTO özelliksiz Tambur: çocuk kümesi = atanınki (bayt-aynı)");
  const S7 = await mkStep(ST_T0);
  const R7 = await mkRoll(50, { stepId: S7 });
  const f7 = await tambur.finalize({ rollId: R7, decisions: [], cuts: [{ length: 20, qualityGrade: grade, relatedErrorIds: [] }] }, actor);
  const sets7: string[][] = [];
  for (const c of f7.data.splitRolls) sets7.push(await propsOf(c.id));
  check("finalize (T0): her çocuk yalnız [ata bayrağı]", sets7.length === 2 && sets7.every((s) => JSON.stringify(s) === JSON.stringify([FP])), JSON.stringify(sets7));
  const R7b = await mkRoll(50, "WAREHOUSE");
  const c7 = await tambur.cutWarehouseRoll(R7b, { cutLength: 20, rawDestination: "WAREHOUSE", qualityGrade: grade, clientToken: randomUUID() }, actor, ST_T0, null);
  const p7 = await propsOf(c7.data.childRoll.id);
  check("Top Kesme (T0 oturumu): çocuk yalnız [ata bayrağı]", JSON.stringify(p7) === JSON.stringify([FP]), JSON.stringify(p7));

  // ── §8 geri alma ──────────────────────────────────────────────────────────
  section("§8 geri alma: çocuk iptal, ata bayraksız döner, ataya Tambur işi doğmaz");
  await undo.applyUndo(k4, actor, { permissions: [UNDO_FULL_PERMISSION] });
  const k4After = await prisma.roll.findUniqueOrThrow({ where: { id: k4 }, select: { status: true } });
  const r4Props = await propsOf(R4);
  check("tek parça geri alma: çocuk CANCELLED, ata AUTO bayrağı kazanmadı", k4After.status === RollStatus.CANCELLED && !r4Props.includes(FA), `${k4After.status} ${JSON.stringify(r4Props)}`);
  await undo.applyUndo(R1, actor, { mode: "FULL", reason: "test — T1 Tambur yeteneği geri alma", permissions: [UNDO_FULL_PERMISSION] });
  const r1After = await prisma.roll.findUniqueOrThrow({ where: { id: R1 }, select: { status: true } });
  const kids1 = await prisma.roll.findMany({ where: { id: { in: k1 } }, select: { status: true } });
  const r1Props = await propsOf(R1);
  check("TÜMDEN geri alma: çocuklar CANCELLED, ata IN_PRODUCTION ve AUTO bayraksız", r1After.status === RollStatus.IN_PRODUCTION && kids1.every((k) => k.status === RollStatus.CANCELLED) && !r1Props.includes(FA), `${r1After.status} ${kids1.map((k) => k.status).join(",")} ${JSON.stringify(r1Props)}`);
  const w8 = await listFlagServiceWorks([R1], "OUT");
  check("geri alınan atada Tambur hizmet işi yok", w8.every((w) => w.serviceItemId !== SVC), JSON.stringify(w8));
  // Özelliksiz ata: geri kurulum donörü (doğum-anı satırları) devrede; istasyon satırı donöre girmemeli.
  const R8 = await mkRoll(40, "WAREHOUSE", false);
  const c8 = await tambur.cutWarehouseRoll(R8, { cutLength: 15, rawDestination: "WAREHOUSE", qualityGrade: grade, clientToken: randomUUID() }, actor, ST_T, null);
  const k8 = c8.data.childRoll.id;
  const k8Born = await prisma.roll.findUniqueOrThrow({ where: { id: k8 }, select: { createdAt: true } });
  const k8Rows = await prisma.rollProperty.findMany({ where: { rollId: k8, propertyId: FA }, select: { createdAt: true } });
  check("özelliksiz ata: istasyon satırı çocuğun doğum anından SONRA damgalı", k8Rows.length === 1 && k8Rows[0]!.createdAt.getTime() > k8Born.createdAt.getTime(), JSON.stringify(k8Rows));
  await undo.applyUndo(k8, actor, { permissions: [UNDO_FULL_PERMISSION] });
  const r8Props = await propsOf(R8);
  check("özelliksiz ata geri alındı: ata özelliksiz döner (AUTO dirilmez)", r8Props.length === 0, JSON.stringify(r8Props));

  // ── §9 elle top (K3c) ─────────────────────────────────────────────────────
  section("§9 elle top: Tambur oturumunda AUTO yetenek yazılır");
  const reason = "test — K3c elle top yeteneği";
  const S9 = await mkStep(ST_T);
  const tok9 = randomUUID();
  const m9 = await manual.createManualRoll({ targetStepId: S9, initialQty: 30, reason, clientToken: tok9 }, { userId: actor, stationId: ST_T });
  const r9 = (m9.data as { rollId: string }).rollId;
  fx.rollIds.push(r9);
  const p9 = await propsOf(r9);
  check("createManualRoll (Tambur oturumu): top AUTO bayrağı taşır, OPTIONAL yok", p9.includes(FA) && !p9.includes(FO), JSON.stringify(p9));
  await manual.createManualRoll({ targetStepId: S9, initialQty: 30, reason, clientToken: tok9 }, { userId: actor, stationId: ST_T });
  const n9 = await prisma.rollProperty.count({ where: { rollId: r9, propertyId: FA } });
  check("createManualRoll replay: AUTO satırı tek", n9 === 1, String(n9));
  const produce = async (stationId: string | null, token = randomUUID()) => {
    const r = await manual.produceFinishedRoll({ itemId: fabric, initialQty: 25, reason, clientToken: token }, { userId: actor, stationId });
    const id = (r.data as { rollId: string }).rollId;
    if (!fx.rollIds.includes(id)) fx.rollIds.push(id);
    return id;
  };
  const tok10 = randomUUID();
  const r10 = await produce(ST_T, tok10);
  const p10 = await propsOf(r10);
  check("produceFinishedRoll (Tambur oturumu): top AUTO bayrağı taşır, OPTIONAL yok", p10.includes(FA) && !p10.includes(FO), JSON.stringify(p10));
  await produce(ST_T, tok10);
  const n10 = await prisma.rollProperty.count({ where: { rollId: r10, propertyId: FA } });
  check("produceFinishedRoll replay: AUTO satırı tek", n10 === 1, String(n10));
  const p10q = await propsOf(await produce(ST_Q));
  const p10n = await propsOf(await produce(null));
  check("produceFinishedRoll: kalite istasyonu oturumunda yetenek yazılmaz", p10q.length === 0, JSON.stringify(p10q));
  check("produceFinishedRoll: oturumsuz yetenek yazılmaz", p10n.length === 0, JSON.stringify(p10n));
  const p10t0 = await propsOf(await produce(ST_T0));
  check("produceFinishedRoll (AUTO özelliksiz Tambur): özellik yok (bugünkü davranış)", p10t0.length === 0, JSON.stringify(p10t0));
}

async function allRollIds(): Promise<string[]> {
  const ids = new Set(fx.rollIds);
  for (let frontier = [...ids]; frontier.length > 0; ) {
    const kids = await prisma.roll.findMany({ where: { parentRollId: { in: frontier } }, select: { id: true } });
    frontier = kids.map((k) => k.id).filter((id) => !ids.has(id));
    frontier.forEach((id) => ids.add(id));
  }
  return [...ids];
}

async function cleanup(): Promise<void> {
  const del = async (ad: string, f: () => Promise<unknown>) => {
    try { await f(); } catch (e) { fail++; console.log(`❌ temizlik ${ad}: ${(e as Error).message.split("\n")[0]}`); }
  };
  const ids = await allRollIds();
  const children = ids.filter((id) => !fx.rollIds.includes(id));
  await del("whMove", () => prisma.warehouseMovement.deleteMany({ where: { rollId: { in: ids } } }));
  await del("rollOperation", () => prisma.rollOperation.deleteMany({ where: { rollId: { in: ids } } }));
  await del("rollMovement", () => prisma.rollMovement.deleteMany({ where: { rollId: { in: ids } } }));
  await del("rollVariance", () => prisma.rollVariance.deleteMany({ where: { rollId: { in: ids } } }));
  await del("rollProperty", () => prisma.rollProperty.deleteMany({ where: { rollId: { in: ids } } }));
  await del("child roll", () => prisma.roll.deleteMany({ where: { id: { in: children } } }));
  await del("roll", () => prisma.roll.deleteMany({ where: { id: { in: fx.rollIds } } }));
  await del("travelerCard", () => prisma.travelerCard.deleteMany({ where: { workOrderId: { in: fx.woIds } } }));
  await del("step", () => prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: fx.woIds } } }));
  await del("workOrder", () => prisma.workOrder.deleteMany({ where: { id: { in: fx.woIds } } }));
  await del("station", () => prisma.station.deleteMany({ where: { id: { in: fx.stationIds } } }));
  await del("property", () => prisma.fabricProperty.deleteMany({ where: { id: { in: fx.propIds } } }));
  await del("item", () => prisma.item.deleteMany({ where: { id: { in: fx.itemIds } } }));
  await del("systemLog", () => prisma.systemLog.deleteMany({ where: { recordId: { in: [...ids, ...fx.woIds] } } }));
  const left = await prisma.roll.count({ where: { id: { in: ids } } });
  check("temizlik: TEST-TBIY top kalıntısı yok", left === 0, String(left));
}

main()
  .catch((e) => { fail++; console.error(e); })
  .finally(async () => {
    await cleanup().catch((e) => { fail++; console.error(e); });
    if (pass + fail === 0) { fail++; console.log("❌ hiçbir kontrol koşmadı"); }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
    await pool.end().catch(() => {});
  });
