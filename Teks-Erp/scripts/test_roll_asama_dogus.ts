// =============================================================================
// TOP AŞAMASI — DOĞUŞ (2026-11-10, plan "Top aşaması")
// Çalıştır: npx tsx scripts/run-all-tests.ts roll_asama_dogus
// =============================================================================
// NEDEN: Etiket türü renkten (`colorId`) türüyordu; renksiz bitmiş top "ham", renkli ham top "bitmiş"
// etiket basıyordu. Artık `Roll.stage` doğuşta materyalize edilir (tek kaynak `roll-stage.helper.ts`);
// bir doğum yolu aşamayı yazmayı unutursa top sessizce RAW (kolon varsayılanı) doğar.
//
// ÖLÇÜLENLER
//   §0 AST: `src/services` altındaki her `roll.create/createMany` `stage` taşır; değer bir aşama helper'ı
//      çağrısından (doğrudan ya da o çağrıyla ilklenen değişken) gelir. Atadan miras (`x.stage`) yalnız
//      MIRAS listesindeki dosyalarda (gerekçeli); listedeki her dosya hâlâ miras doğumu yapmalı (bayat kırmızı).
//      Yeniden konumlama yazarları `reentryStageData`, son adım finalize'ı adımın `outputStage`ini okur.
//   §1 tablo (saf): giriş · üretimden çıkış · üretim içi doğum · en düşük aşama · yeniden konumlama
//   §2 giriş doğumu (DB): manuel STOCK → RAW · bitmiş stoğa → FINISHED · yarı mamul girişi → SEMI_FINISHED ·
//      açık değer kazanır
//   §3 eski istemci (DB): rota adımları `outputStage` göndermeden yeniden yazılınca değer KORUNUR; açık null
//      temizler; geçersiz değer 400. İE şablondan klonlar; replace alanı göndermezse korur
// Negatif sondalar (2026-11-10, cp ile geri; temel 32/0):
//   · route.service `keepOutputStageOfOldClient` çağrısı silindi → §3b/§3c/§3d ❌ (29/3)
//   · replace.ts koruma yayılımı yerine `outputStage: incoming.outputStage ?? null` → §3d ❌ (31/1)
//   · tambur/finalize.ts `stage: RollStage.FINISHED` (helper yerine sabit) → §0b/§0d ❌ (30/2)
//   · initial-entry.ts create'ten `stage` silindi → §0b/§0d/§2b/§2c/§2d ❌ (27/5)
//   · direct-ship.ts miras yerine helper → §0c bayat MIRAS ❌ (31/1)
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım.
// =============================================================================
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { RollEntrySource, RollStage, RollStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { InventoryService } from "../src/services/inventory.service";
import { RouteService, ROUTE_SERVICE_CONFIG } from "../src/services/route.service";
import { WorkOrderService } from "../src/services/workorder.service";
import { ensureDefaultWarehouse } from "../src/jobs/default-warehouse.job";
import { AppError } from "../src/utils/app-error";
import {
  birthStageForEntry,
  lowestStage,
  reentryStageData,
  stageForProductionExit,
  stageForStepBirth,
  stageOnReentry,
} from "../src/services/helpers/roll-stage.helper";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}

// ── §0 AST ──────────────────────────────────────────────────────────────────
const SRC = join(__dirname, "..", "src", "services");
const STAGE_HELPERS = new Set(["birthStageForEntry", "stageForProductionExit", "stageForStepBirth", "lowestStage", "stageOnReentry"]);
/** Aşamayı atadan MİRAS alan doğumlar — her biri gerekçeli; yeni satır = karar notu. */
const MIRAS: Record<string, string> = {
  "tambur/warehouse-cut.ts": "depo kesimi (Top Kesme): aynı mal bölünür, aşama değişmez",
  "tambur/warehouse-cut-finalize.ts": "depo kesimi kapanışı: kalan parça atanın aşamasında",
  "subcontractor/direct-ship.ts": "fasona doğrudan kısmi sevk çocuğu: aynı mal bölünür",
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

/** İfade (herhangi bir derinlikte) bir aşama helper'ı çağırıyor mu? */
function callsStageHelper(e: ts.Node): boolean {
  if (ts.isCallExpression(e) && ts.isIdentifier(e.expression) && STAGE_HELPERS.has(e.expression.text)) return true;
  return ts.forEachChild(e, (c) => (callsStageHelper(c) ? true : undefined)) ?? false;
}

type Tur = "helper" | "miras" | "yok" | "diger";
interface Bulgu { dosya: string; satir: number; tur: Tur; deger: string }

function tara(): Bulgu[] {
  const out: Bulgu[] = [];
  for (const file of walk(SRC)) {
    const text = readFileSync(file, "utf8");
    if (!/\.roll\.(create|createMany)\(/.test(text)) continue;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const helperVars = new Set<string>();
    const topla = (n: ts.Node): void => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && callsStageHelper(n.initializer)) helperVars.add(n.name.text);
      ts.forEachChild(n, topla);
    };
    topla(sf);
    const visit = (n: ts.Node): void => {
      if (
        ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) &&
        (n.expression.name.text === "create" || n.expression.name.text === "createMany") &&
        ts.isPropertyAccessExpression(n.expression.expression) && n.expression.expression.name.text === "roll"
      ) {
        let stage: ts.PropertyAssignment | ts.ShorthandPropertyAssignment | undefined;
        const ic = (m: ts.Node): void => {
          if ((ts.isPropertyAssignment(m) || ts.isShorthandPropertyAssignment(m)) && ts.isIdentifier(m.name) && m.name.text === "stage") stage ??= m;
          ts.forEachChild(m, ic);
        };
        n.arguments.forEach(ic);
        let tur: Tur = "yok";
        let deger = "(stage yok)";
        if (stage && ts.isShorthandPropertyAssignment(stage)) { deger = "stage"; tur = helperVars.has("stage") ? "helper" : "diger"; }
        else if (stage && ts.isPropertyAssignment(stage)) {
          const init = stage.initializer;
          deger = init.getText(sf).replace(/\s+/g, " ");
          if (callsStageHelper(init) || (ts.isIdentifier(init) && helperVars.has(init.text))) tur = "helper";
          else if (ts.isPropertyAccessExpression(init) && init.name.text === "stage") tur = "miras";
          else tur = "diger";
        }
        out.push({ dosya: relative(SRC, file), satir: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, tur, deger });
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return out;
}

function astBolumu(): void {
  const b = tara();
  check("§0a roll doğum envanteri boş değil (tarayıcı kör değil)", b.length >= 9, `${b.length} çağrı`);
  const ihlal = b.filter((x) => x.tur === "yok" || x.tur === "diger" || (x.tur === "miras" && !(x.dosya in MIRAS)));
  check("§0b her roll.create/createMany aşamayı helper'dan alır (miras yalnız MIRAS listesinde)", ihlal.length === 0,
    ihlal.map((x) => `${x.dosya}:${x.satir} stage=${x.deger}`).join(" · "));
  const bayat = Object.keys(MIRAS).filter((f) => !b.some((x) => x.dosya === f && x.tur === "miras"));
  check("§0c MIRAS listesi bayat değil (her dosya hâlâ atadan miras doğum yapıyor)", bayat.length === 0, bayat.join(", "));
  const zorunlu = ["inventory/initial-entry.ts", "inventory/open-fabric.ts", "subcontractor/receive.ts", "tambur/finalize.ts", "tambur/open-fabric-cut.ts", "tambur/open-fabric-finalize.ts"];
  const eksik = zorunlu.filter((f) => !b.some((x) => x.dosya === f && x.tur === "helper"));
  check("§0d bağlanan yollar helper'dan yazıyor (giriş · açık kumaş · fason kabulü · tambur ×3)", eksik.length === 0, eksik.join(", "));

  const reentry = ["helpers/roll-disposition.helper.ts", "inventory/rescue.ts", "workorder-batch-drop.service.ts"];
  const reentryEksik = reentry.filter((f) => !/\.\.\.reentryStageData\(/.test(readFileSync(join(SRC, f), "utf8")));
  check("§0e yeniden konumlama yazarları reentryStageData yayıyor (dispozisyon · kurtarma · partiden düşürme)", reentryEksik.length === 0, reentryEksik.join(", "));
  const fin = readFileSync(join(SRC, "helpers/roll-finalize.helper.ts"), "utf8");
  check("§0f son adım finalize'ı adımın outputStage'ini okuyup stage yazıyor", /outputStage/.test(fin) && /stage:\s*stageForProductionExit\(|stage:\s*exitStage/.test(fin));
}

// ── §1 tablo (saf) ──────────────────────────────────────────────────────────
function tabloBolumu(): void {
  const { RAW, SEMI_FINISHED: SEMI, FINISHED } = RollStage;
  const giris: Array<[string, Parameters<typeof birthStageForEntry>[0], RollStage]> = [
    ["KK1 ham giriş STOCK", { entrySource: RollEntrySource.SUPPLIER_RECEIPT, status: RollStatus.STOCK }, RAW],
    ["manuel STOCK", { entrySource: RollEntrySource.MANUAL_ENTRY, status: RollStatus.STOCK }, RAW],
    ["manuel bitmiş depo", { entrySource: RollEntrySource.MANUAL_ENTRY, status: RollStatus.WAREHOUSE }, FINISHED],
    ["A1 stok", { entrySource: RollEntrySource.MANUAL_ENTRY, status: RollStatus.A1_STOCK }, FINISHED],
    ["yarı mamul girişi STOCK", { entrySource: RollEntrySource.SEMI_FINISHED, status: RollStatus.STOCK }, SEMI],
    ["yarı mamul girişi depoya bile → SEMI (kaynak statüden önce)", { entrySource: RollEntrySource.SEMI_FINISHED, status: RollStatus.WAREHOUSE }, SEMI],
    ["Tambur manuel açık FINISHED", { explicit: FINISHED, entrySource: RollEntrySource.TAMBUR_MANUAL, status: RollStatus.STOCK }, FINISHED],
    ["açık RAW bitmiş stoğu ezer", { explicit: RAW, entrySource: RollEntrySource.MANUAL_ENTRY, status: RollStatus.WAREHOUSE }, RAW],
  ];
  for (const [ad, girdi, beklenen] of giris) {
    const got = birthStageForEntry(girdi);
    check(`§1 giriş: ${ad} → ${beklenen}`, got === beklenen, `okunan ${got}`);
  }
  check("§1 üretimden çıkış: adım boş → FINISHED", stageForProductionExit(null) === FINISHED);
  check("§1 üretimden çıkış: adım SEMI → SEMI", stageForProductionExit(SEMI) === SEMI);
  check("§1 üretim içi doğum: adım boş → atanın aşaması", stageForStepBirth(undefined, SEMI) === SEMI);
  check("§1 üretim içi doğum: adım FINISHED → FINISHED", stageForStepBirth(FINISHED, RAW) === FINISHED);
  check("§1 en düşük aşama: [FINISHED, SEMI] → SEMI; boş → RAW", lowestStage([FINISHED, SEMI]) === SEMI && lowestStage([]) === RAW);
  check("§1 yeniden konumlama: depoya → FINISHED; üretime → değişmez", stageOnReentry(RAW, RollStatus.WAREHOUSE) === FINISHED && stageOnReentry(SEMI, RollStatus.IN_PRODUCTION) === SEMI);
  check("§1 reentryStageData ikizi: depoya {FINISHED}, STOCK'a {}", reentryStageData(RollStatus.WAREHOUSE).stage === FINISHED && !("stage" in reentryStageData(RollStatus.STOCK)));
}

// ── §2-§3 DB ────────────────────────────────────────────────────────────────
const TAG = `TEST-ASD-${Date.now()}`;
const rollIds: string[] = [];
const woIds: string[] = [];
let itemId: string | null = null;
let routeId: string | null = null;

const inventory = new InventoryService();

async function entry(opts: Parameters<InventoryService["createInitialEntry"]>[4]): Promise<RollStage> {
  const res = await inventory.createInitialEntry({ itemId: itemId!, initialQty: 50 }, undefined, undefined, false, { gradeRequired: false, ...opts });
  const id = (res.data as { id: string }).id;
  rollIds.push(id);
  return (await prisma.roll.findUniqueOrThrow({ where: { id }, select: { stage: true } })).stage;
}

async function girisBolumu(): Promise<void> {
  await ensureDefaultWarehouse();
  itemId = (await prisma.item.create({ data: { code: `${TAG}-ITEM`, name: `${TAG} Kumaş`, unit: "MT", itemType: "FABRIC" }, select: { id: true } })).id;
  check("§2a manuel STOCK girişi → RAW", (await entry({ forcedStatus: RollStatus.STOCK })) === RollStage.RAW);
  check("§2b bitmiş depoya giriş → FINISHED", (await entry({ forcedStatus: RollStatus.WAREHOUSE })) === RollStage.FINISHED);
  check("§2c yarı mamul girişi → SEMI_FINISHED", (await entry({ forcedStatus: RollStatus.STOCK, forcedEntrySource: RollEntrySource.SEMI_FINISHED })) === RollStage.SEMI_FINISHED);
  check("§2d açık aşama kazanır (STOCK + FINISHED)", (await entry({ forcedStatus: RollStatus.STOCK, stage: RollStage.FINISHED })) === RollStage.FINISHED);
}

async function stepStages(where: { routeId?: string; workOrderId?: string }): Promise<Array<RollStage | null>> {
  if (where.routeId) {
    const r = await prisma.routeStep.findMany({ where: { routeId: where.routeId }, orderBy: { sequence: "asc" }, select: { outputStage: true } });
    return r.map((x) => x.outputStage);
  }
  const r = await prisma.workOrderStep.findMany({ where: { workOrderId: where.workOrderId! }, orderBy: { stepSequence: "asc" }, select: { outputStage: true } });
  return r.map((x) => x.outputStage);
}

async function eskiIstemciBolumu(): Promise<void> {
  const st = async (code: string) => (await prisma.station.findFirstOrThrow({ where: { code }, select: { id: true } })).id;
  const ST_BOYA = await st("BOYA_FASON");
  const ST_TAMBUR = await st("TAMBUR_1");
  const svc = new RouteService(ROUTE_SERVICE_CONFIG);
  const created = await svc.create({
    name: `${TAG} rota`, code: `${TAG}-RT`, isActive: true,
    steps: [
      { stationId: ST_BOYA, sequence: 1, outputStage: RollStage.SEMI_FINISHED },
      { stationId: ST_TAMBUR, sequence: 2 },
    ],
  });
  routeId = (created.data as { id: string }).id;
  check("§3a rota create outputStage'i yazar (SEMI, otomatik)", JSON.stringify(await stepStages({ routeId })) === JSON.stringify(["SEMI_FINISHED", null]));

  // Eski panel: alanı bilmez, adımları silip yeniden yazar.
  await svc.update(routeId, { steps: { deleteMany: {}, create: [{ stationId: ST_BOYA, sequence: 1, defaultNotes: "eski panel" }, { stationId: ST_TAMBUR, sequence: 2 }] } });
  check("§3b ⭐ eski istemci outputStage göndermeden kaydeder → değer KORUNUR", JSON.stringify(await stepStages({ routeId })) === JSON.stringify(["SEMI_FINISHED", null]),
    JSON.stringify(await stepStages({ routeId })));

  // İE: şablondan klon + replace koruması (rota hâlâ SEMI taşıyor).
  const wos = new WorkOrderService();
  const wo = await wos.create({ type: "STOCK_PRODUCTION", targetItemId: itemId!, width: 250, routeTemplateId: routeId });
  const woId = (wo.data as { id: string }).id;
  woIds.push(woId);
  check("§3c İE şablondan outputStage klonlar", JSON.stringify(await stepStages({ workOrderId: woId })) === JSON.stringify(["SEMI_FINISHED", null]));
  const woSteps = await prisma.workOrderStep.findMany({ where: { workOrderId: woId }, orderBy: { stepSequence: "asc" }, select: { id: true, stationId: true } });
  await wos.replace(woId, { type: "STOCK_PRODUCTION", targetItemId: itemId!, width: 250, steps: woSteps.map((s) => ({ id: s.id, stationId: s.stationId })) });
  check("§3d ⭐ İE replace alanı göndermezse outputStage KORUNUR", JSON.stringify(await stepStages({ workOrderId: woId })) === JSON.stringify(["SEMI_FINISHED", null]),
    JSON.stringify(await stepStages({ workOrderId: woId })));
  await wos.replace(woId, { type: "STOCK_PRODUCTION", targetItemId: itemId!, width: 250, steps: woSteps.map((s, i) => ({ id: s.id, stationId: s.stationId, outputStage: i === 1 ? RollStage.FINISHED : null })) });
  check("§3e İE replace açık değeri yazar (null = otomatik, FINISHED)", JSON.stringify(await stepStages({ workOrderId: woId })) === JSON.stringify([null, "FINISHED"]));

  await svc.update(routeId, { steps: { deleteMany: {}, create: [{ stationId: ST_BOYA, sequence: 1, outputStage: null }, { stationId: ST_TAMBUR, sequence: 2, outputStage: null }] } });
  check("§3f yeni istemci açık null gönderir → otomatik'e döner", JSON.stringify(await stepStages({ routeId })) === JSON.stringify([null, null]));

  let kod = 0;
  try {
    await svc.update(routeId, { steps: { deleteMany: {}, create: [{ stationId: ST_BOYA, sequence: 1, outputStage: "YARIM" }] } });
  } catch (e) { kod = e instanceof AppError ? e.statusCode : -1; }
  check("§3g geçersiz outputStage → 400 (fail-closed)", kod === 400, `kod=${kod}`);
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) { check("hedef DB yazmaya uygun", false, engel); return; }
  astBolumu();
  tabloBolumu();
  await girisBolumu();
  await eskiIstemciBolumu();
}

main()
  .catch((e) => { fail++; console.error("HATA:", e instanceof Error ? e.message : e); })
  .finally(async () => {
    for (const id of woIds) {
      await prisma.travelerCardScan.deleteMany({ where: { card: { workOrderId: id } } }).catch(() => {});
      await prisma.travelerCard.deleteMany({ where: { workOrderId: id } }).catch(() => {});
      await prisma.workOrderEvent.deleteMany({ where: { workOrderId: id } }).catch(() => {});
      await prisma.workOrderStep.deleteMany({ where: { workOrderId: id } }).catch(() => {});
      await prisma.workOrder.delete({ where: { id } }).catch(() => {});
    }
    if (routeId) {
      await prisma.routeStep.deleteMany({ where: { routeId } }).catch(() => {});
      await prisma.route.delete({ where: { id: routeId } }).catch(() => {});
    }
    if (rollIds.length > 0) {
      await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.rollVariance.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    }
    if (itemId) await prisma.item.deleteMany({ where: { id: itemId } });
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exitCode = fail > 0 ? 1 : 0;
  });

