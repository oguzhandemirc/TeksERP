// =============================================================================
// BEKÇİ — D4-F1b okutma noktaları müşteri koduna açılır (DALGA4 §7.5 madde 5, §7.9)
// =============================================================================
// Helper başlığında [AÇIK] etiketli her okutma noktası tek boğazdan (`resolveRollByScanCode` /
// `customerCodeSearchRollIds`) geçer; ikinci çözücü yasağı `test_musteri_barkodu` §AST'tedir.
//
// §AST ⭐ başlıktaki her [AÇIK] satırının fonksiyonu boğazı çağırır; [AÇILMALI] etiketi kalmadı;
//        liste uçları (findAllRolls · getRollStats) arama id'lerini boğazdan çözer.
// §1 ⭐ OFF (varsayılan): yedi noktanın müşteri kodlu yanıtı, kod hiç yokkenki yanıtla bayt-aynı.
// §2 ⭐ iç barkod yanıtı ON/OFF bayt-aynı (yedi nokta).
// §3 ⭐ ON: müşteri koduyla bulunur (tekil noktalarda `matchedBy: CUSTOMER_CODE`).
// §4 ⭐ ON: iç barkod önce (başka topun barkoduna eşit eski müşteri kodu).
// §5 ⭐ ON: iki müşteride aynı kod → tekil noktalarda 409 CUSTOMER_CODE_AMBIGUOUS + adaylar;
//        liste noktalarında iki aday da listede (sessiz seçim yok).
// Negatif sonda (elle, PR gövdesinde): `sack-search.service.ts locateRoll` eski
// `prisma.roll.findFirst({ where: { barcode: code } })`a döndürülünce §AST ve §3 ❌.
// =============================================================================
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { ItemType, RollEntrySource, StationType } from "@prisma/client";
import type { Request } from "express";
import prisma from "../src/lib/prisma";
import { InventoryService } from "../src/services/inventory.service";
import { TamburService } from "../src/services/tambur.service";
import { WorkOrderTimelineService } from "../src/services/workorder-timeline.service";
import { sackSearchService } from "../src/services/sack-search.service";
import { returnService } from "../src/services/return.service";
import { searchBatches } from "../src/services/reports/batch-trace.report.service";
import { RollCustomerCodeService } from "../src/services/roll-customer-code.service";
import { generateRollBarcodeTx } from "../src/services/helpers/roll-barcode.helper";
import { SETTING_KEYS, invalidateFeatureFlagsCache } from "../src/services/system-setting.service";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { testActorId } from "./fixture-test-user";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

/** Yanıt ya da hata — karşılaştırılabilir tek JSON (hata: durum + kod + metin + adaylar). */
async function outcome(p: Promise<unknown>): Promise<string> {
  try {
    return JSON.stringify({ ok: await p });
  } catch (e) {
    const err = e as { statusCode?: number; details?: Record<string, unknown>; message?: string };
    return JSON.stringify({ status: err.statusCode ?? -1, code: err.details?.code ?? null, msg: err.message ?? String(e), candidates: err.details?.candidates ?? null });
  }
}

// ── §AST ─────────────────────────────────────────────────────────────────────
const SRC = join(__dirname, "..", "src");
const HELPER = "services/helpers/roll-scan-resolve.helper.ts";
const GATES = ["resolveRollByScanCode(", "customerCodeSearchRollIds("];

function functionText(rel: string, fn: string): string | null {
  const text = readFileSync(join(SRC, rel), "utf8");
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true);
  let found: string | null = null;
  const visit = (node: ts.Node): void => {
    const named = (ts.isMethodDeclaration(node) || ts.isFunctionDeclaration(node)) && node.name && ts.isIdentifier(node.name) && node.name.text === fn;
    if (named && node.body) found = node.body.getText();
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

function astSection(): void {
  const header = readFileSync(join(SRC, HELPER), "utf8").split("// ====")[2] ?? "";
  const opened = header.split("\n")
    .map((l) => /^\/\/\s+(\S+\.ts):\d+(?:-\d+)?\s+(\w+)\b.*\[AÇIK\]/.exec(l))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ rel: `services/${m[1]}`, fn: m[2]! }));
  check("§AST başlıkta [AÇIK] noktalar beyanlı (≥7)", opened.length >= 7, String(opened.length));
  const bad = opened.filter(({ rel, fn }) => {
    const body = functionText(rel, fn);
    if (body === null) return true;
    // buildRollWhere senkron kalır: id'ler çağıranda boğazdan çözülür, burada parametre olarak kullanılır.
    return !GATES.some((g) => body.includes(g)) && !(fn === "buildRollWhere" && body.includes("customerCodeRollIds"));
  }).map(({ rel, fn }) => `${rel}#${fn}`);
  check("§AST ⭐ her [AÇIK] noktanın fonksiyonu tek boğazı çağırır", bad.length === 0, bad.join(", "));
  check("§AST başlıkta [AÇILMALI] etiketi kalmadı", !/\[AÇILMALI\]/.test(header));
  const lists = ["findAllRolls", "getRollStats"].filter((fn) => !(functionText("services/inventory.service.ts", fn) ?? "").includes("customerCodeSearchRollIds("));
  check("§AST top listesi uçları aramayı boğazdan çözer (findAllRolls · getRollStats)", lists.length === 0, lists.join(", "));
}

// ── DB ───────────────────────────────────────────────────────────────────────
const inventory = new InventoryService();
const tambur = new TamburService();
const timeline = new WorkOrderTimelineService();

async function setLookup(on: boolean): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { key: SETTING_KEYS.SCAN_CUSTOMER_CODE_LOOKUP },
    create: { key: SETTING_KEYS.SCAN_CUSTOMER_CODE_LOOKUP, value: on, description: "TEST okutma_noktalari" },
    update: { value: on },
  });
  invalidateFeatureFlagsCache();
}

type Probe = (code: string) => Promise<string>;

async function main(): Promise<void> {
  astSection();
  const engel = hedefDbEngeli();
  if (engel) throw new Error(engel);

  const STAMP = Date.now().toString(36).toUpperCase();
  const P = `TEST-OKN-${STAMP}`;
  const actor = await testActorId();
  const fx = { customerIds: [] as string[], rollIds: [] as string[], batchIds: [] as string[], stepId: null as string | null, woId: null as string | null, stationId: null as string | null, itemId: null as string | null };
  const saved = await prisma.systemSetting.findUnique({ where: { key: SETTING_KEYS.SCAN_CUSTOMER_CODE_LOOKUP } });

  try {
    const station = await prisma.station.create({ data: { code: `TST-OKN-${STAMP}`.slice(0, 32), name: `TEST OKN istasyon ${STAMP}`, type: StationType.INTERNAL }, select: { id: true } });
    fx.stationId = station.id;
    const item = await prisma.item.create({ data: { code: `${P}-K`.slice(0, 32), name: `TEST OKN kumaş ${STAMP}`, itemType: ItemType.FABRIC }, select: { id: true } });
    fx.itemId = item.id;
    const wo = await prisma.workOrder.create({ data: { workOrderNumber: `${P}-WO` }, select: { id: true, workOrderNumber: true } });
    fx.woId = wo.id;
    const step = await prisma.workOrderStep.create({ data: { workOrderId: wo.id, stationId: station.id, stepSequence: 1 }, select: { id: true } });
    fx.stepId = step.id;
    const mkBatch = async (tag: string) => {
      const b = await prisma.batch.create({ data: { batchNumber: `${P}-P${tag}`, workOrderId: wo.id }, select: { id: true } });
      fx.batchIds.push(b.id);
      return b.id;
    };
    const batch1 = await mkBatch("1");
    const batch2 = await mkBatch("2");
    const mkCust = async (tag: string) => {
      const c = await prisma.customer.create({ data: { code: `${P}-${tag}`.slice(0, 32), name: `TEST OKN ${tag} ${STAMP}` }, select: { id: true } });
      fx.customerIds.push(c.id);
      return c.id;
    };
    const A = await mkCust("A");
    const B = await mkCust("B");
    const mkRoll = async (owner: string, batchId: string) => {
      const barcode = await generateRollBarcodeTx(prisma as never, "H");
      const r = await prisma.roll.create({
        data: { itemId: item.id, initialQty: 50, currentQty: 50, ownerCustomerId: owner, barcode, batchId, producedInStepId: step.id, entrySource: RollEntrySource.TAMBUR_SPLIT },
        select: { id: true, barcode: true },
      });
      fx.rollIds.push(r.id);
      return { id: r.id, barcode: r.barcode! };
    };
    const rA1 = await mkRoll(A, batch1);
    const rA2 = await mkRoll(A, batch2);
    const rB1 = await mkRoll(B, batch2);
    const rLegacy = await mkRoll(A, batch1);
    const CODE = `OK${STAMP}01`;
    const SHARED = `OK${STAMP}77`;

    const ids = (rows: unknown): string[] => ((rows as { id: string }[] | undefined) ?? []).map((r) => r.id).sort();
    const listReq = (search: string) => ({ query: { search, pageSize: "50" } }) as unknown as Request;
    // Yedi nokta: tekil (409 adaylı) ve liste (adaylar listede).
    const single: Record<string, Probe> = {
      getRelabelContext: (c) => outcome(inventory.getRelabelContext({ barcode: c })),
      "workorder-timeline lookup": (c) => outcome(timeline.lookup(c)),
      locateRoll: (c) => outcome(sackSearchService.locateRoll(c)),
      lookupForReturn: (c) => outcome(returnService.lookupForReturn(c)),
    };
    const list: Record<string, Probe> = {
      findAllRolls: (c) => outcome(inventory.findAllRolls(listReq(c)).then((r) => ids(r.data))),
      listRecentOutputRolls: (c) => outcome(tambur.listRecentOutputRolls({ search: c }).then((r) => ids(r.data))),
      searchBatches: (c) => outcome(searchBatches(c).then((rows) => rows.map((b) => b.batchId).sort())),
    };
    const all = { ...single, ...list };

    // ── §1 OFF: kod hiç yokken alınan yanıt = kod bağlıyken OFF yanıtı ──
    await setLookup(false);
    const before: Record<string, string> = {};
    const internalOff: Record<string, string> = {};
    for (const [k, f] of Object.entries(all)) { before[k] = await f(CODE); internalOff[k] = await f(rA1.barcode); }
    await RollCustomerCodeService.bind(rA1.id, { code: CODE, clientToken: randomUUID() }, actor);
    for (const [k, f] of Object.entries(all)) {
      const after = await f(CODE);
      check(`§1 ⭐ OFF bayt-aynı: ${k}`, after === before[k], after.slice(0, 160));
    }

    // ── §2 iç barkod ON/OFF bayt-aynı ──
    await setLookup(true);
    for (const [k, f] of Object.entries(all)) {
      const on = await f(rA1.barcode);
      check(`§2 ⭐ iç barkod ON/OFF bayt-aynı: ${k}`, on === internalOff[k] && !on.includes("matchedBy"), on.slice(0, 160));
    }

    // ── §3 ON: müşteri koduyla bulunur ──
    const relabel = JSON.parse(await single.getRelabelContext!(CODE)) as { ok?: { data?: { id: string; matchedBy?: string; customerCode?: string } } };
    check("§3 ⭐ ON getRelabelContext müşteri koduyla", relabel.ok?.data?.id === rA1.id && relabel.ok?.data?.matchedBy === "CUSTOMER_CODE" && relabel.ok?.data?.customerCode === CODE);
    const tl = JSON.parse(await single["workorder-timeline lookup"]!(CODE)) as { ok?: { id: string; via: string; matchedBy?: string }[] };
    check("§3 ⭐ ON iz sür (workorder-timeline lookup) müşteri koduyla", tl.ok?.length === 1 && tl.ok[0]!.id === wo.id && tl.ok[0]!.via === "ROLL_BARCODE" && tl.ok[0]!.matchedBy === "CUSTOMER_CODE");
    const loc = JSON.parse(await single.locateRoll!(CODE)) as { ok?: { data?: { id: string; matchedBy?: string } } };
    check("§3 ⭐ ON locateRoll müşteri koduyla", loc.ok?.data?.id === rA1.id && loc.ok?.data?.matchedBy === "CUSTOMER_CODE");
    const ret = JSON.parse(await single.lookupForReturn!(CODE)) as { status?: number; msg?: string };
    check("§3 ⭐ ON lookupForReturn müşteri koduyla topu bulur (sevk edilmemiş → 400, 404 değil)", ret.status === 400 && /sevk edilmemiş/.test(ret.msg ?? ""), ret.msg);
    for (const k of ["findAllRolls", "listRecentOutputRolls"]) {
      const r = JSON.parse(await list[k]!(CODE)) as { ok?: string[] };
      check(`§3 ⭐ ON ${k} müşteri koduyla topu listeler`, JSON.stringify(r.ok) === JSON.stringify([rA1.id]), JSON.stringify(r.ok));
    }
    const sb = JSON.parse(await list.searchBatches!(CODE)) as { ok?: string[] };
    check("§3 ⭐ ON parti araması müşteri koduyla partiyi bulur", JSON.stringify(sb.ok) === JSON.stringify([batch1]), JSON.stringify(sb.ok));

    // ── §4 iç barkod önce: kapı öncesi eski veride başka topun barkoduna eşit müşteri kodu ──
    await prisma.rollCustomerCode.create({ data: { rollId: rLegacy.id, customerId: A, code: rB1.barcode, source: "BOUND_LABEL", clientToken: randomUUID(), createdById: actor } });
    const pri = JSON.parse(await single.locateRoll!(rB1.barcode)) as { ok?: { data?: { id: string; matchedBy?: string } } };
    check("§4 ⭐ iç barkod önce (locateRoll)", pri.ok?.data?.id === rB1.id && pri.ok?.data?.matchedBy === undefined);
    const priList = JSON.parse(await list.findAllRolls!(rB1.barcode)) as { ok?: string[] };
    check("§4 ⭐ iç barkod önce (top listesi müşteri kodlu topu eklemez)", JSON.stringify(priList.ok) === JSON.stringify([rB1.id]), JSON.stringify(priList.ok));
    await prisma.rollCustomerCode.updateMany({ where: { rollId: rLegacy.id, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: "TEST eski veri sondası" } });

    // ── §5 belirsizlik ──
    await RollCustomerCodeService.bind(rA2.id, { code: SHARED, clientToken: randomUUID() }, actor);
    await RollCustomerCodeService.bind(rB1.id, { code: SHARED, clientToken: randomUUID() }, actor);
    for (const [k, f] of Object.entries(single)) {
      const r = JSON.parse(await f(SHARED)) as { status?: number; code?: string; candidates?: { rollId: string }[] | null };
      const cands = (r.candidates ?? []).map((c) => c.rollId).sort();
      check(`§5 ⭐ belirsiz kod → 409 CUSTOMER_CODE_AMBIGUOUS + 2 aday: ${k}`, r.status === 409 && r.code === "CUSTOMER_CODE_AMBIGUOUS" && JSON.stringify(cands) === JSON.stringify([rA2.id, rB1.id].sort()));
    }
    for (const k of ["findAllRolls", "listRecentOutputRolls"]) {
      const r = JSON.parse(await list[k]!(SHARED)) as { ok?: string[] };
      check(`§5 ⭐ belirsiz kod listede iki aday: ${k}`, JSON.stringify(r.ok) === JSON.stringify([rA2.id, rB1.id].sort()), JSON.stringify(r.ok));
    }
    const sbAmb = JSON.parse(await list.searchBatches!(SHARED)) as { ok?: string[] };
    check("§5 belirsiz kod parti aramasında adayların partisi", JSON.stringify(sbAmb.ok) === JSON.stringify([batch2]), JSON.stringify(sbAmb.ok));
  } finally {
    if (saved) await prisma.systemSetting.update({ where: { key: saved.key }, data: { value: saved.value as never } });
    else await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.SCAN_CUSTOMER_CODE_LOOKUP } });
    invalidateFeatureFlagsCache();
    if (fx.rollIds.length) {
      await prisma.rollCustomerCode.deleteMany({ where: { rollId: { in: fx.rollIds } } });
      await prisma.roll.deleteMany({ where: { id: { in: fx.rollIds } } });
    }
    if (fx.batchIds.length) await prisma.batch.deleteMany({ where: { id: { in: fx.batchIds } } });
    if (fx.stepId) await prisma.workOrderStep.deleteMany({ where: { id: fx.stepId } });
    if (fx.woId) await prisma.workOrder.deleteMany({ where: { id: fx.woId } });
    if (fx.stationId) await prisma.station.deleteMany({ where: { id: fx.stationId } });
    if (fx.customerIds.length) await prisma.customer.deleteMany({ where: { id: { in: fx.customerIds } } });
    if (fx.itemId) await prisma.item.deleteMany({ where: { id: fx.itemId } });
  }
}

main()
  .catch((e) => { fail++; console.error(e); })
  .finally(async () => {
    if (pass + fail === 0) { fail++; console.log("❌ hiçbir kontrol koşmadı"); }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
  });
