// =============================================================================
// EMANET DEPOSU — TAMBUR ÜRETİM KESİMİ ÇOCUKLARI (2026-11-10, Gülkesim demo bulgusu)
// Çalıştır: npx tsx scripts/run-all-tests.ts emanet_depo_tambur
// =============================================================================
// NEDEN: Tamburda müşteri malından (ownerCustomerId dolu) kesilen parça `emanet.defaultWarehouseId` ayarlıyken
// Merkez Depo'ya doğuyordu: üç üretim kesimi yolu (`finalize` · `cutOpenFabric` · `finalizeOpenFabric`) depoyu
// ebeveynden mirasla yazıyordu, `resolveBirthWarehouseIdTx`e hiç sormuyordu. Sıra artık: açık seçim > emanet
// deposu (sahipli, emanet açık, ayar dolu) > ebeveynin kayıtlı deposu > varsayılan (`fason.md` F1b).
//
// ÖLÇÜLENLER
//   §0 AST: `src/services` altında `ownerCustomerId` taşıyan her `roll.create/createMany` çağrısının `warehouseId`i
//      `resolveBirthWarehouseIdTx` çağrısından (doğrudan ya da o çağrıyla ilklenen değişken) gelir; istisna yalnız
//      ISTISNA listesi (gerekçeli) ve listedeki her dosya hâlâ sahipli doğum yapıyor olmalı (bayat istisna kırmızı)
//   §1 ⭐ emanet açık + ayar dolu: sahipli cutOpenFabric çocuğu emanet deposunda (defter `toWarehouseId` dahil);
//      sahipsiz çocuk ebeveynin deposunda (bugünkü)
//   §2 ⭐ sahipli finalizeOpenFabric KALANI + segmentli finalize çocuklarının hepsi emanet deposunda; sahipsiz finalize
//      çocukları ebeveynin deposunda
//   §3 emanet KAPALI (ayar dolu) → sahipli çocuk ebeveynin deposunda (bugünkü)
//   §4 ayar BOŞ (emanet açık) → sahipli çocuk ebeveynin deposunda (bugünkü)
//   §5 fail-closed: emanet deposu pasif → sahipli kesim 400 EMANET_DEFAULT_WAREHOUSE_UNUSABLE, çocuk doğmaz, ebeveyn
//      metrajı değişmez; sahipsiz kesim etkilenmez
//   §6 depo kesimi (cutWarehouseRoll) semantiği KORUNUR: sahipli depo topundan kesilen parça ebeveynin deposunda kalır
// Negatif sondalar (2026-11-10, cp+shasum ile geri; temel 15/0):
//   · `open-fabric-cut.ts`te boğaz yerine `parent.warehouseId` → §0b/§0d/§1a/§1b/§5a ❌ (10/5)
//   · `finalize.ts`te boğaz yerine `roll.warehouseId ?? ""` → §0b/§0d/§2b ❌ (12/3)
//   · `open-fabric-finalize.ts`te boğaz yerine `parent.warehouseId` → §0b/§0d/§2a ❌ (12/3)
//   · helper'da `inheritedId` dalı düşünce → §1c/§2c/§3/§4/§5b ❌ (10/5; ebeveyn deposu yerine varsayılan)
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım; global ayarlar `finally`de geri alınır.
// =============================================================================
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { RollEntrySource, RollForm, RollStatus, StepStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { TamburService } from "../src/services/tambur.service";
import { roleGrade } from "./fixture-quality-grade";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { AppError } from "../src/utils/app-error";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}

// ── §0 AST ──────────────────────────────────────────────────────────────────
const SRC = join(__dirname, "..", "src", "services");
const BOGAZ = "resolveBirthWarehouseIdTx";
/** Sahipli doğum yapıp depoyu boğazdan ALMAYAN yollar — her biri gerekçeli; yeni satır = karar notu. */
const ISTISNA: Record<string, string> = {
  "tambur/warehouse-cut.ts": "depo kesimi: ebeveyn fiziksel olarak o depoda duruyor, parça yerinden kımıldamaz",
  "tambur/warehouse-cut-finalize.ts": "depo kesimi kapanışı: aynı gerekçe (kalan parça ebeveynin deposunda)",
  "subcontractor/direct-ship.ts": "fasona doğrudan sevk çocuğu AT_SUBCONTRACTOR doğar — depoya girmez; dönüş receive.ts boğazından",
};

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".ts") && !p.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

function isBogazCall(e: ts.Expression): boolean {
  let x: ts.Expression = e;
  while (ts.isParenthesizedExpression(x) || ts.isAwaitExpression(x)) x = x.expression;
  return ts.isCallExpression(x) && ts.isIdentifier(x.expression) && x.expression.text === BOGAZ;
}

interface Bulgu { dosya: string; satir: number; deger: string; uygun: boolean }

function tara(): Bulgu[] {
  const bulgular: Bulgu[] = [];
  for (const file of walk(SRC)) {
    const text = readFileSync(file, "utf8");
    if (!/\.roll\.(create|createMany)\(/.test(text)) continue;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    // Boğaz çağrısıyla ilklenen değişkenler (dosya kapsamı — yeterince dar: ad + boğaz ilkleyicisi).
    const bogazVars = new Set<string>();
    const topla = (n: ts.Node): void => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && isBogazCall(n.initializer)) bogazVars.add(n.name.text);
      ts.forEachChild(n, topla);
    };
    topla(sf);
    const visit = (n: ts.Node): void => {
      if (
        ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) &&
        (n.expression.name.text === "create" || n.expression.name.text === "createMany") &&
        ts.isPropertyAccessExpression(n.expression.expression) && n.expression.expression.name.text === "roll"
      ) {
        const props: Array<ts.PropertyAssignment | ts.ShorthandPropertyAssignment> = [];
        const ic = (m: ts.Node): void => {
          if ((ts.isPropertyAssignment(m) || ts.isShorthandPropertyAssignment(m)) && ts.isIdentifier(m.name)) props.push(m);
          ts.forEachChild(m, ic);
        };
        n.arguments.forEach(ic);
        const sahipli = props.some((p) => (p.name as ts.Identifier).text === "ownerCustomerId");
        const wh = props.find((p) => (p.name as ts.Identifier).text === "warehouseId");
        if (sahipli) {
          let uygun = false;
          let deger = "(warehouseId yok)";
          if (wh && ts.isShorthandPropertyAssignment(wh)) { deger = "warehouseId"; uygun = bogazVars.has("warehouseId"); }
          else if (wh && ts.isPropertyAssignment(wh)) {
            deger = wh.initializer.getText(sf).replace(/\s+/g, " ");
            uygun = isBogazCall(wh.initializer) || (ts.isIdentifier(wh.initializer) && bogazVars.has(wh.initializer.text));
          }
          bulgular.push({ dosya: relative(SRC, file), satir: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, deger, uygun });
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return bulgular;
}

function astBolumu(): void {
  const bulgular = tara();
  const ihlal = bulgular.filter((b) => !b.uygun && !(b.dosya in ISTISNA));
  check("§0a sahipli doğum envanteri boş değil (tarayıcı kör değil)", bulgular.length >= 6, `${bulgular.length} çağrı: ${bulgular.map((b) => b.dosya).join(", ")}`);
  check(`§0b sahipli her roll.create/createMany deposunu ${BOGAZ}'ten alır (istisnalar hariç)`, ihlal.length === 0, ihlal.map((b) => `${b.dosya}:${b.satir} warehouseId=${b.deger}`).join(" · "));
  const bayat = Object.keys(ISTISNA).filter((f) => !bulgular.some((b) => b.dosya === f && !b.uygun));
  check("§0c istisna listesi bayat değil (her istisna hâlâ boğazsız sahipli doğum yapıyor)", bayat.length === 0, bayat.join(", "));
  const zorunlu = ["tambur/finalize.ts", "tambur/open-fabric-cut.ts", "tambur/open-fabric-finalize.ts", "inventory/open-fabric.ts", "inventory/initial-entry.ts", "subcontractor/receive.ts"];
  const eksik = zorunlu.filter((f) => !bulgular.some((b) => b.dosya === f && b.uygun));
  check("§0d bağlanan yollar boğazdan geçiyor (tambur ×3 · açık kumaş · ilk giriş · fason kabulü)", eksik.length === 0, eksik.join(", "));
}

// ── Davranış ────────────────────────────────────────────────────────────────
const TAG = `TEST-EDT-${Date.now()}`;
const rollIds: string[] = [];
const woIds: string[] = [];
const whIds: string[] = [];
const custIds: string[] = [];
const SETTINGS = [SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.EMANET_DEFAULT_WAREHOUSE_ID];

async function setSetting(key: string, value: unknown): Promise<void> {
  if (value === null) await prisma.systemSetting.deleteMany({ where: { key } });
  else await prisma.systemSetting.upsert({ where: { key }, create: { key, value: value as never }, update: { value: value as never } });
}

async function uretimdeTop(ek: string, stationId: string, opts: { warehouseId: string; itemId: string; gradeCode: string; owner: string | null }): Promise<string> {
  const wo = await prisma.workOrder.create({ data: { workOrderNumber: `${TAG}-WO-${ek}`, status: "IN_PROGRESS" }, select: { id: true } });
  woIds.push(wo.id);
  const step = await prisma.workOrderStep.create({ data: { workOrderId: wo.id, stationId, stepSequence: 1, status: StepStatus.ACTIVE }, select: { id: true } });
  const roll = await prisma.roll.create({
    data: {
      barcode: null, form: RollForm.ACIK, itemId: opts.itemId, width: 150, initialQty: 100, currentQty: 100,
      status: RollStatus.IN_PRODUCTION, qualityGrade: opts.gradeCode, entrySource: RollEntrySource.SUPPLIER_RECEIPT,
      currentStepId: step.id, warehouseId: opts.warehouseId, ownerCustomerId: opts.owner,
    },
    select: { id: true },
  });
  rollIds.push(roll.id);
  await prisma.rollMovement.create({ data: { rollId: roll.id, workOrderStepId: step.id, qtyIn: 100 } });
  return roll.id;
}

async function whOf(id: string): Promise<string | null> {
  return (await prisma.roll.findUnique({ where: { id }, select: { warehouseId: true } }))?.warehouseId ?? null;
}

async function davranis(): Promise<void> {
  const tambur = new TamburService();
  const tamburSt = await prisma.station.findFirst({ where: { code: "TAMBUR_1" }, select: { id: true } });
  if (!tamburSt) throw new Error("TAMBUR_1 istasyonu yok (seed koşmamış)");
  const itemId = (await prisma.item.create({ data: { code: TAG, name: `${TAG} kumaş`, itemType: "FABRIC" }, select: { id: true } })).id;
  const grade = await roleGrade("FIRST");
  const mkWh = async (s: string) => {
    const id = (await prisma.warehouse.create({ data: { code: `${TAG}-${s}`.slice(0, 32), name: `${TAG} ${s}` }, select: { id: true } })).id;
    whIds.push(id);
    return id;
  };
  const P = await mkWh("EBEVEYN");
  const E = await mkWh("EMANET");
  const owner = (await prisma.customer.create({ data: { code: `${TAG}-O`, name: `${TAG} Sahip` }, select: { id: true } })).id;
  custIds.push(owner);
  const base = { warehouseId: P, itemId, gradeCode: grade.code };
  const cut = async (rollId: string, len = 30) => {
    const r = await tambur.cutOpenFabric(rollId, { lengthMeters: len, status: "WAREHOUSE", confirmMismatch: true });
    const id = (r.data as { childRoll: { id: string } }).childRoll.id;
    rollIds.push(id);
    return id;
  };

  try {
    // ── §1 emanet açık + ayar dolu: cutOpenFabric ───────────────────────────
    await setSetting(SETTING_KEYS.EMANET_ENABLED, true);
    await setSetting(SETTING_KEYS.EMANET_DEFAULT_WAREHOUSE_ID, E);
    const a = await uretimdeTop("A", tamburSt.id, { ...base, owner });
    const a1 = await cut(a);
    check("§1a ⭐ sahipli cutOpenFabric çocuğu emanet deposunda", (await whOf(a1)) === E, `depo=${(await whOf(a1)) === P ? "ebeveyn" : await whOf(a1)}`);
    const mv = await prisma.warehouseMovement.findFirst({ where: { rollId: a1 }, select: { toWarehouseId: true } });
    check("§1b defter girişi de emanet deposuna", mv?.toWarehouseId === E, `to=${mv?.toWarehouseId === P ? "ebeveyn" : mv?.toWarehouseId}`);
    const b = await uretimdeTop("B", tamburSt.id, { ...base, owner: null });
    const b1 = await cut(b);
    check("§1c sahipsiz cutOpenFabric çocuğu ebeveynin deposunda (bugünkü)", (await whOf(b1)) === P);

    // ── §2 finalizeOpenFabric kalanı + segmentli finalize ───────────────────
    const fin = await tambur.finalizeOpenFabric(a, { remainingAction: "keep_1kalite", varianceReasonCode: null, varianceReasonText: "bekçi §2", confirmMismatch: true });
    const kalan = (fin.data as { remainingChildId: string | null }).remainingChildId;
    if (kalan) rollIds.push(kalan);
    check("§2a ⭐ sahipli finalizeOpenFabric KALANI emanet deposunda", !!kalan && (await whOf(kalan)) === E, `kalan=${!!kalan}`);
    const c = await uretimdeTop("C", tamburSt.id, { ...base, owner });
    const fc = await tambur.finalize({ rollId: c, decisions: [], cuts: [{ length: 40, qualityGrade: grade.code, relatedErrorIds: [] }] });
    const cc = fc.data.splitRolls.map((s) => s.id);
    rollIds.push(...cc);
    const ccWh = await Promise.all(cc.map(whOf));
    check("§2b ⭐ sahipli segmentli finalize çocuklarının HEPSİ emanet deposunda", cc.length === 2 && ccWh.every((w) => w === E), `n=${cc.length} emanette=${ccWh.filter((w) => w === E).length}`);
    const d = await uretimdeTop("D", tamburSt.id, { ...base, owner: null });
    const fd = await tambur.finalize({ rollId: d, decisions: [], cuts: [{ length: 40, qualityGrade: grade.code, relatedErrorIds: [] }] });
    const dd = fd.data.splitRolls.map((s) => s.id);
    rollIds.push(...dd);
    check("§2c sahipsiz finalize çocukları ebeveynin deposunda (bugünkü)", dd.length === 2 && (await Promise.all(dd.map(whOf))).every((w) => w === P));

    // ── §3 emanet KAPALI ───────────────────────────────────────────────────
    await setSetting(SETTING_KEYS.EMANET_ENABLED, false);
    const e = await uretimdeTop("E", tamburSt.id, { ...base, owner });
    const e1 = await cut(e);
    check("§3 emanet kapalı → sahipli çocuk ebeveynin deposunda (bugünkü)", (await whOf(e1)) === P, `depo=${(await whOf(e1)) === E ? "emanet" : await whOf(e1)}`);

    // ── §4 ayar BOŞ ────────────────────────────────────────────────────────
    await setSetting(SETTING_KEYS.EMANET_ENABLED, true);
    await setSetting(SETTING_KEYS.EMANET_DEFAULT_WAREHOUSE_ID, null);
    const f = await uretimdeTop("F", tamburSt.id, { ...base, owner });
    const f1 = await cut(f);
    check("§4 ayar boş → sahipli çocuk ebeveynin deposunda (bugünkü)", (await whOf(f1)) === P);

    // ── §5 fail-closed ─────────────────────────────────────────────────────
    await setSetting(SETTING_KEYS.EMANET_DEFAULT_WAREHOUSE_ID, E);
    await prisma.warehouse.update({ where: { id: E }, data: { isActive: false } });
    const g = await uretimdeTop("G", tamburSt.id, { ...base, owner });
    const once = await prisma.roll.count({ where: { parentRollId: g } });
    let err: AppError | null = null;
    try { await cut(g); } catch (x) { err = x instanceof AppError ? x : null; }
    const code = (err?.details as { code?: string } | undefined)?.code;
    const sonra = await prisma.roll.count({ where: { parentRollId: g } });
    const gq = await prisma.roll.findUnique({ where: { id: g }, select: { currentQty: true } });
    check("§5a ⭐ emanet deposu pasif → sahipli kesim 400 EMANET_DEFAULT_WAREHOUSE_UNUSABLE, çocuk yok, ebeveyn 100", err?.statusCode === 400 && code === "EMANET_DEFAULT_WAREHOUSE_UNUSABLE" && sonra === once && Number(gq?.currentQty) === 100, `kod=${code} çocuk=${sonra - once} kalan=${String(gq?.currentQty)}`);
    const h = await uretimdeTop("H", tamburSt.id, { ...base, owner: null });
    const h1 = await cut(h);
    check("§5b sahipsiz kesim pasif emanet deposundan etkilenmez", (await whOf(h1)) === P);
    await prisma.warehouse.update({ where: { id: E }, data: { isActive: true } });

    // ── §6 depo kesimi semantiği korunur ───────────────────────────────────
    const w = await prisma.roll.create({
      data: {
        barcode: `${TAG}-W`, form: RollForm.TOP, itemId, width: 150, initialQty: 100, currentQty: 100, status: RollStatus.WAREHOUSE,
        qualityGrade: grade.code, entrySource: RollEntrySource.SUPPLIER_RECEIPT, warehouseId: P, ownerCustomerId: owner,
      },
      select: { id: true },
    });
    rollIds.push(w.id);
    const wr = await tambur.cutWarehouseRoll(w.id, { cutLength: 10 });
    const wc = (wr.data as { childRoll: { id: string } }).childRoll.id;
    rollIds.push(wc);
    check("§6 depo kesimi: sahipli depo topundan kesilen parça ebeveynin deposunda kalır (fiziksel konum)", (await whOf(wc)) === P, `depo=${(await whOf(wc)) === E ? "emanet" : await whOf(wc)}`);
  } finally {
    await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollVariance.deleteMany({ where: { OR: [{ rollId: { in: rollIds } }, { sourceRollId: { in: rollIds } }] } });
    await prisma.rollPlanDeviation.deleteMany({ where: { OR: [{ rollId: { in: rollIds } }, { childRollId: { in: rollIds } }] } }).catch(() => undefined);
    await prisma.rollMeterReading.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => undefined);
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: rollIds } } });
    await prisma.roll.updateMany({ where: { id: { in: rollIds } }, data: { parentRollId: null } });
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
    await prisma.warehouse.deleteMany({ where: { id: { in: whIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: custIds } } }).catch(() => undefined);
    await prisma.item.deleteMany({ where: { id: itemId } }).catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) { console.log(`⛔ ${engel}`); process.exitCode = 1; return; }
  console.log("\n=== Emanet deposu — tambur üretim kesimi çocukları ===\n");
  astBolumu();
  const prior = await prisma.systemSetting.findMany({ where: { key: { in: SETTINGS } }, select: { key: true, value: true } });
  try {
    await davranis();
  } catch (e) {
    fail++;
    console.error("❌ bekçi çöktü:", e);
  } finally {
    for (const k of SETTINGS) {
      const p = prior.find((x) => x.key === k);
      if (p) await prisma.systemSetting.update({ where: { key: k }, data: { value: p.value as never } });
      else await prisma.systemSetting.deleteMany({ where: { key: k } });
    }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exitCode = fail > 0 ? 1 : 0;
  }
}

void main();
