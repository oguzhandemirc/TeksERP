// =============================================================================
// FASON KOKPİTİ BEKÇİSİ (F10) — `GET /api/subcontractor/cockpit` gövdesi (`getSubcontractorCockpit`)
// =============================================================================
// Ölçülenler:
//   §1 ⭐ açık sevk tanımı TEK KAYNAKTAN: top kalemi (`OPEN_OUTSTANDING`) · haşıl leventi (`OPEN_BEAM_DISPATCH`) ·
//      dokuma fason belgesi (iş açıkken); iptal edilmiş sevk yok; dönen levent / kapanan top kalemi sevki düşürür
//   §2 satır metrikleri: fasonda kalan metre = OUTSTANDING topların `currentQty`si (kısmi kabul kalanı), iplik kg =
//      giden − net dönüş − sarılan (`listYarnItems` formülü), levent = dönmemiş levent; dokuma satırında `weavingOrder`
//   §3 termin: `overdueDays` fabrika günüyle (dün 1 · bugün 0 · yok null); OVERDUE / DUE_SOON / NO_DUE_DATE süzgeçleri
//   §4 süreç türü süzgeci: adımın `requiredCategory`si, yoksa istasyonun varsayılanı; satırın `category`si aynı öncelik
//   §5 özet = liste ile AYNI where: sayaçlar ve metre toplamı tüm sayfaların toplamına eşit; firma şeridi
//   §6 cursor: sayfalar örtüşmez, uç sayfada `nextCursor` null
//   §7 fail-closed: tanınmayan durum / bozuk uuid / limit 0·201 / bozuk cursor / çoklu durum → 400 COCKPIT_FILTER_INVALID
//   §8 statik: route `/cockpit` izin çifti `subcontractor:read` · `workorder:read`, route prisma'ya dokunmaz
// Kısmi kabul `currentQty`yi atomik düşürür (`subcontractor/receive.ts`); bekçi bu durumu doğrudan kurar — kabul
// akışının kendisi `test_fason_partial_receive`'in işidir.
// Koşum: DATABASE_URL=<test DB> npx tsx scripts/test_fason_kokpit.ts
// NEGATİF SONDA — 2026-11-08: (a) `COCKPIT_OPEN_WHERE`den `OPEN_BEAM_DISPATCH` kolu silinince §1b ❌; (b) dokuma kolu
//   silinince §1c ❌; (c) `OPEN_BEAM_ITEM`den `warpBeamEvents.none` silinince §1d2 ❌; (d) metrikte `roll.currentQty`
//   yerine `dispatchedQty` → §2a ❌; (e) iplik helper'ında sarım düşümü silinince §2c ❌; (f) `categoryWhere`in istasyon
//   kolu silinince §4b ❌; (g) özet `all` yerine `page` üzerinden → §5a ❌; (h) `readState` allowlist'i kaldırılınca
//   §7a ❌. Hepsi geri alındı.
// =============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";
import { Prisma, RollStatus, StationType, WarpBeamOrigin, WarpKgSource, YarnMovementKind } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { AppError } from "../src/utils/app-error";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { createWarpBeam } from "../src/services/warp-beam.service";
import { windWarpBeam } from "../src/services/warp-beam-wind.service";
import { returnWarpBeam } from "../src/services/subcontractor-beam.service";
import { returnYarn } from "../src/services/subcontractor-yarn.service";
import { applyYarnMovementTx } from "../src/services/yarn.service";
import { reconcileReasonPresets } from "../src/jobs/reason-preset-catalog.job";
import { getSubcontractorCockpit, type CockpitQueryInput } from "../src/services/subcontractor-cockpit.service";
import { addDaysToDayKey } from "../src/services/helpers/fason-expected-return.helper";
import { factoryDayEndOfKey, factoryYmd } from "../src/constants/time";
import type { SubcontractorCockpitRow } from "../src/services/subcontractor/types";
import { ensureTestDyeHouse } from "./fixture-subcontractor";
import { fixtureWarehouseId } from "./fixture-warehouse";
import { testActorId } from "./fixture-test-user";
import { assertGelistirmeVeritabani } from "./db-guard";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}
const codeOf = async (fn: () => Promise<unknown>): Promise<string> => {
  try {
    await fn();
    return "OK";
  } catch (e) {
    return e instanceof AppError ? `${e.statusCode}:${String(e.details?.code ?? "")}` : String(e);
  }
};
const TAG = `TST-FKP-${Date.now().toString(36).toUpperCase()}`;
const ROOT = path.resolve(__dirname, "..");

interface Ids {
  st: string; yarn: string; lot: string; spec: string; weaving: string;
  beamIds: string[]; woIds: string[]; rollIds: string[]; dispatchIds: string[];
}

/** Firma süzgeçli TÜM sayfalar (paylaşılan fixture firmasında başka bekçilerin sevkleri olabilir — kendi satırlarımıza bakılır). */
async function allRows(q: CockpitQueryInput): Promise<{ rows: SubcontractorCockpitRow[]; pages: number }> {
  const rows: SubcontractorCockpitRow[] = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    const r = await getSubcontractorCockpit({ ...q, limit: "200", cursor });
    rows.push(...r.data!.data);
    cursor = r.data!.nextCursor ?? undefined;
    pages += 1;
  } while (cursor && pages < 50);
  return { rows, pages };
}

function statik(): void {
  const routes = readFileSync(path.join(ROOT, "src/routes/subcontractor.routes.ts"), "utf8");
  const block = routes.slice(routes.indexOf('"/cockpit"'), routes.indexOf('"/cockpit"') + 200);
  check("§8a route `/cockpit` izin çifti subcontractor:read · workorder:read", /requireAnyPermission\("subcontractor:read", "workorder:read"\)/.test(block));
  check("§8b route prisma import etmez, servise delege eder", !/from "\.\.\/lib\/prisma"/.test(routes) && /getSubcontractorCockpit\(/.test(routes));
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(engel);
    process.exitCode = 1;
    return;
  }
  assertGelistirmeVeritabani("test_fason_kokpit");
  console.log("=== FASON KOKPİTİ (F10) BEKÇİSİ ===\n");
  statik();
  const dye = await ensureTestDyeHouse();
  const iplikFoto = await prisma.systemSetting.findUnique({ where: { key: SETTING_KEYS.IPLIK_ENABLED }, select: { value: true } });
  const devereFoto = await prisma.systemSetting.findUnique({ where: { key: SETTING_KEYS.DEVERE_ENABLED }, select: { value: true } });
  const ids: Ids = { st: "", yarn: "", lot: "", spec: "", weaving: "", beamIds: [], woIds: [], rollIds: [], dispatchIds: [] };
  try {
    await senaryo(dye, ids);
  } finally {
    await temizle(ids);
    await geriYukle(SETTING_KEYS.IPLIK_ENABLED, iplikFoto);
    await geriYukle(SETTING_KEYS.DEVERE_ENABLED, devereFoto);
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await pool.end();
  process.exitCode = fail > 0 ? 1 : 0;
}

async function geriYukle(key: string, foto: { value: Prisma.JsonValue } | null): Promise<void> {
  if (foto) await prisma.systemSetting.update({ where: { key }, data: { value: foto.value as Prisma.InputJsonValue } });
  else await prisma.systemSetting.deleteMany({ where: { key } });
}

async function senaryo(dye: { id: string; categoryId: string }, ids: Ids): Promise<void> {
  const svc = new SubcontractorService();
  const actor = await testActorId();
  const whId = await fixtureWarehouseId();
  const patos = await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } });
  const boya = await prisma.station.findFirst({ where: { code: "BOYA_FASON" }, select: { id: true } });
  if (!patos || !boya) throw new Error("Seed fixture eksik — önce 'npm run seed'");
  for (const key of [SETTING_KEYS.IPLIK_ENABLED, SETTING_KEYS.DEVERE_ENABLED]) {
    await prisma.systemSetting.upsert({ where: { key }, create: { key, value: "true" }, update: { value: "true" } });
  }
  await reconcileReasonPresets();
  const st = await prisma.station.create({ data: { name: `${TAG}-ST`, code: `${TAG}-ST`.slice(0, 32), type: StationType.EXTERNAL, defaultCategoryId: dye.categoryId }, select: { id: true } });
  ids.st = st.id;
  const yarn = await prisma.item.create({ data: { code: `${TAG}-IP`, name: `${TAG} iplik`, itemType: "YARN", unit: "KG", linearDensityDen: 300 }, select: { id: true } });
  ids.yarn = yarn.id;
  ids.lot = (await prisma.yarnLot.create({ data: { itemId: yarn.id, lotNo: `${TAG}-L1` }, select: { id: true } })).id;
  await prisma.$transaction((tx) => applyYarnMovementTx(tx, { itemId: yarn.id, warehouseId: whId, kind: YarnMovementKind.IN, qtyKg: 200, lotId: ids.lot, reason: `${TAG} giriş` }));
  ids.spec = (await prisma.warpSpec.create({ data: { code: `${TAG}-CK`, name: `${TAG} çözgü`, yarnItemId: yarn.id, endsCount: 3000 }, select: { id: true } })).id;

  const mkWo = async (n: string, stationId: string, categoryId: string | null) => {
    const wo = await prisma.workOrder.create({
      data: { workOrderNumber: `${TAG}-${n}`, type: "STOCK_PRODUCTION", status: "IN_PROGRESS", targetItemId: patos.id, steps: { create: [{ stationId, stepSequence: 1, status: "PENDING", requiredCategoryId: categoryId }] } },
      include: { steps: true },
    });
    ids.woIds.push(wo.id);
    return { woId: wo.id, stepId: wo.steps[0]!.id };
  };
  const mkRoll = async (n: string, qty: number) => {
    const r = await prisma.roll.create({ data: { barcode: `${TAG}-R${n}`, itemId: patos.id, initialQty: qty, currentQty: qty, status: RollStatus.STOCK, warehouseId: whId, width: 250 }, select: { id: true } });
    ids.rollIds.push(r.id);
    return r.id;
  };
  const mkBeam = async (n: string) => {
    const p = await createWarpBeam({ warpSpecId: ids.spec, plannedLengthM: 500, originKind: WarpBeamOrigin.PURCHASED, subcontractorId: dye.id, physicalBeamNo: `${TAG}-G${n}` });
    ids.beamIds.push(p.data.id);
    await windWarpBeam(p.data.id, { lengthM: 500, kgSource: WarpKgSource.THEORETICAL });
    return p.data.id;
  };
  const reg = (r: { data: unknown }): string => {
    const id = (r.data as { id: string }).id;
    ids.dispatchIds.push(id);
    return id;
  };
  const today = factoryYmd(new Date());
  const setDue = (id: string, days: number | null) =>
    prisma.subcontractorDispatch.update({ where: { id }, data: { expectedReturnAt: days === null ? null : factoryDayEndOfKey(addDaysToDayKey(today, days)) } });
  const q = { subcontractorId: dye.id };
  const mine = async (extra: CockpitQueryInput = {}) => {
    const { rows } = await allRows({ ...q, ...extra });
    return new Map(rows.filter((r) => ids.dispatchIds.includes(r.dispatchId)).map((r) => [r.dispatchId, r]));
  };

  // ── Fikstür: d1 top+levent+iplik (adım kategorili) · d2 levent-yalnız (istasyon varsayılanı) · d3 iptal · dW dokuma
  const w1 = await mkWo("1", boya.id, dye.categoryId);
  const b1 = await mkBeam("1");
  const d1 = reg(await svc.dispatch({ workOrderId: w1.woId, stepId: w1.stepId, subcontractorId: dye.id, rollIds: [await mkRoll("1", 100)], warpBeamIds: [b1], yarnLines: [{ itemId: yarn.id, warehouseId: whId, lotId: ids.lot, qtyKg: 60 }] }, actor));
  const w2 = await mkWo("2", st.id, null);
  const b2 = await mkBeam("2");
  const d2 = reg(await svc.dispatch({ workOrderId: w2.woId, stepId: w2.stepId, subcontractorId: dye.id, rollIds: [], warpBeamIds: [b2] }, actor));
  const w3 = await mkWo("3", boya.id, dye.categoryId);
  const d3 = reg(await svc.dispatch({ workOrderId: w3.woId, stepId: w3.stepId, subcontractorId: dye.id, rollIds: [await mkRoll("3", 50)] }, actor));
  await prisma.subcontractorDispatch.update({ where: { id: d3 }, data: { cancelledAt: new Date(), cancelReason: `${TAG} iptal`, cancelledById: actor } });
  ids.weaving = (await prisma.weavingOrder.create({ data: { weavingOrderNumber: `${TAG}-DO`, itemId: patos.id, executionKind: "SUBCONTRACTED", subcontractorId: dye.id }, select: { id: true } })).id;
  const dW = (await prisma.subcontractorDispatch.create({ data: { dispatchNo: `${TAG}-DW`, weavingOrderId: ids.weaving, subcontractorId: dye.id }, select: { id: true } })).id;
  ids.dispatchIds.push(dW);
  await setDue(d1, -1);
  await setDue(d2, 1);
  await setDue(dW, null);

  // ── §1 açık sevk tanımı
  let m = await mine();
  check("§1a ⭐ top kalemli sevk listede", m.has(d1));
  check("§1b ⭐ levent-yalnız sevk listede (top kalemsiz → OPEN_OUTSTANDING dışı)", m.has(d2));
  check("§1c ⭐ açık dokuma işinin fason belgesi listede, `weavingOrder` dolu", m.get(dW)?.weavingOrder?.id === ids.weaving && m.get(dW)?.workOrder === null);
  check("§1e iptal edilmiş sevk listede YOK", !m.has(d3));

  // ── §2 metrikler
  const r1 = m.get(d1);
  check("§2a0 d1: 100 m · 1 top · 1 levent · 60 kg; gönderilen = belge `totalQty` (top 100 + levent 500 m)", r1?.outstandingQty === "100.000" && r1.outstandingRollCount === 1 && r1.beamOutstandingCount === 1 && r1.yarnOutstandingKg === "60.000" && r1.dispatchedQty === "600.000", JSON.stringify(r1));
  const rollItem = await prisma.subcontractorDispatchItem.findFirstOrThrow({ where: { dispatchId: d1, kind: "ROLL" }, select: { id: true, rollId: true } });
  await prisma.roll.update({ where: { id: rollItem.rollId! }, data: { currentQty: 40 } }); // kısmi kabul sonrası kalan
  const yItem = await prisma.subcontractorDispatchItem.findFirstOrThrow({ where: { dispatchId: d1, kind: "YARN" }, select: { id: true } });
  await returnYarn(d1, { dispatchItemId: yItem.id, qtyKg: 20, reasonCode: "KALAN_IPLIK" }, actor);
  const bW = await createWarpBeam({ warpSpecId: ids.spec, plannedLengthM: 500, originKind: WarpBeamOrigin.SUBCONTRACT, subcontractorId: dye.id });
  ids.beamIds.push(bW.data.id);
  await windWarpBeam(bW.data.id, { lengthM: 500, kgSource: WarpKgSource.THEORETICAL, dispatchItemId: yItem.id }, actor); // 3000×300×500/9e6 = 50 kg
  m = await mine();
  check("§2a ⭐ kısmi kabul kalanı: fasonda 40 m (gönderilen 600 değişmez)", m.get(d1)?.outstandingQty === "40.000" && m.get(d1)?.dispatchedQty === "600.000", m.get(d1)?.outstandingQty);
  check("§2c ⭐ iplik: 60 − 20 dönüş − 50 sarım = −10 kg (listYarnItems formülü)", m.get(d1)?.yarnOutstandingKg === "-10.000", m.get(d1)?.yarnOutstandingKg);
  check("§2d dokuma satırı metriği boş (kalemsiz belge): 0 m · 0 levent", m.get(dW)?.outstandingQty === "0.000" && m.get(dW)?.beamOutstandingCount === 0);

  // ── §3 termin
  check("§3a overdueDays: dün → 1, yarın → −1, termin yok → null", m.get(d1)?.overdueDays === 1 && m.get(d2)?.overdueDays === -1 && m.get(dW)?.overdueDays === null);
  const over = await mine({ state: "OVERDUE" });
  const soon = await mine({ state: "DUE_SOON" });
  const nodue = await mine({ state: "NO_DUE_DATE" });
  check("§3b OVERDUE = yalnız d1", over.has(d1) && !over.has(d2) && !over.has(dW));
  check("§3c DUE_SOON = yalnız d2", soon.has(d2) && !soon.has(d1) && !soon.has(dW));
  check("§3d NO_DUE_DATE = yalnız dokuma belgesi", nodue.has(dW) && !nodue.has(d1) && !nodue.has(d2));

  // ── §4 süreç türü
  const cat = await mine({ categoryId: dye.categoryId });
  check("§4a adım kategorisi süzgeçte, satır `category` dolu", cat.has(d1) && cat.get(d1)?.category?.id === dye.categoryId);
  check("§4b ⭐ adım kategorisiz → istasyon varsayılanı süzgeçte ve satırda", cat.has(d2) && cat.get(d2)?.category?.id === dye.categoryId);
  check("§4c dokuma belgesi (adımsız) kategori süzgecine girmez", !cat.has(dW));
  const otherCat = await mine({ categoryId: "00000000-0000-4000-8000-000000000000" });
  check("§4d başka süreç türü → kendi satırlarımız yok", otherCat.size === 0);

  // ── §5 özet = liste
  const full = await allRows(q);
  const head = await getSubcontractorCockpit({ ...q, limit: "1" });
  const s = head.data!.summary;
  const sumQty = full.rows.reduce((a, r) => a.plus(r.outstandingQty), new Prisma.Decimal(0)).toFixed(3);
  check("§5a ⭐ özet sayaçları tüm sayfaların toplamı (limit 1 iken bile)",
    s.openDispatchCount === full.rows.length && s.outstandingQty === sumQty && s.overdueCount === full.rows.filter((r) => (r.overdueDays ?? 0) > 0).length,
    `${s.openDispatchCount}/${full.rows.length} ${s.outstandingQty}/${sumQty}`);
  const firm = s.firms.find((f) => f.subcontractor.id === dye.id);
  check("§5b firma şeridi: tek firma süzgecinde tek satır, sayaçlar özetle aynı", s.firms.length === 1 && firm?.openDispatchCount === s.openDispatchCount && firm.overdueCount === s.overdueCount);
  check("§5c dueSoonCount ≥ 1 (d2) ve DUE_SOON listesiyle aynı", s.dueSoonCount === (await allRows({ ...q, state: "DUE_SOON" })).rows.length);

  // ── §6 cursor
  const p1 = await getSubcontractorCockpit({ ...q, limit: "1" });
  const p2 = await getSubcontractorCockpit({ ...q, limit: "1", cursor: p1.data!.nextCursor ?? undefined });
  check("§6a sayfalar örtüşmez, sıra termin artan (d1 gecikmiş önce)", !!p1.data!.nextCursor && p1.data!.data[0]?.dispatchId !== p2.data!.data[0]?.dispatchId);
  const last = await getSubcontractorCockpit({ ...q, limit: "200" });
  check("§6b son sayfada nextCursor null", full.pages > 1 || last.data!.nextCursor === null);

  // ── §1 (devam) kapanışlar sevki düşürür
  await returnWarpBeam(d2, { warpBeamId: b2, lengthM: 500 }, actor);
  await prisma.subcontractorDispatchItem.update({ where: { id: rollItem.id }, data: { remainderClosedAt: new Date() } });
  await returnWarpBeam(d1, { warpBeamId: b1, lengthM: 500 }, actor);
  await prisma.weavingOrder.update({ where: { id: ids.weaving }, data: { status: "COMPLETED" } });
  m = await mine();
  check("§1d ⭐ levent dönünce levent-yalnız sevk düşer", !m.has(d2));
  // Dönen levent yeniden fasona çıkar (statü yine SHIPPED_OUT): eski sevki "açık" yapan yalnız kalemin dönüş olayıdır.
  const w4 = await mkWo("4", st.id, null);
  const d4 = reg(await svc.dispatch({ workOrderId: w4.woId, stepId: w4.stepId, subcontractorId: dye.id, rollIds: [], warpBeamIds: [b2] }, actor));
  m = await mine();
  check("§1d2 ⭐ aynı levent yeni sevkle çıkınca eski sevk açılmaz, yenisi listede", !m.has(d2) && m.has(d4));
  check("§1f top kalemi kapanıp levent dönünce sevk düşer (yalnız iplik kalanı kokpite girmez — beyanlı açık)", !m.has(d1));
  check("§1g dokuma işi COMPLETED → belge düşer", !m.has(dW));

  // ── §7 fail-closed
  const bad = (x: CockpitQueryInput) => codeOf(() => getSubcontractorCockpit({ ...q, ...x }));
  const E = "400:COCKPIT_FILTER_INVALID";
  check("§7a tanınmayan durum → 400", (await bad({ state: "LATE" })) === E);
  check("§7b bozuk firma uuid → 400", (await bad({ subcontractorId: "abc" })) === E);
  check("§7c bozuk süreç türü uuid → 400", (await bad({ categoryId: `${dye.categoryId},x` })) === E);
  check("§7d limit 0 / 201 / 1.5 → 400", (await bad({ limit: "0" })) === E && (await bad({ limit: "201" })) === E && (await bad({ limit: "1.5" })) === E);
  check("§7e bozuk cursor → 400", (await bad({ cursor: "zzz" })) === E);
  check("§7f çoklu durum değeri → 400", (await bad({ state: ["OVERDUE", "ALL"] })) === E);
}

async function temizle(ids: Ids): Promise<void> {
  await prisma.printedDocument.deleteMany({ where: { sourceId: { in: ids.dispatchIds } } });
  await prisma.warpBeamEvent.deleteMany({ where: { beamId: { in: ids.beamIds } } });
  if (ids.yarn) {
    await prisma.yarnMovement.deleteMany({ where: { itemId: ids.yarn } });
    await prisma.yarnStock.deleteMany({ where: { itemId: ids.yarn } });
  }
  await prisma.subcontractorDispatchItem.deleteMany({ where: { dispatchId: { in: ids.dispatchIds } } });
  await prisma.rollOperation.deleteMany({ where: { rollId: { in: ids.rollIds } } });
  await prisma.rollMovement.deleteMany({ where: { rollId: { in: ids.rollIds } } });
  await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: ids.rollIds } } });
  await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: ids.dispatchIds } } });
  await prisma.roll.deleteMany({ where: { id: { in: ids.rollIds } } });
  await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: ids.woIds } } });
  await prisma.batch.deleteMany({ where: { workOrderId: { in: ids.woIds } } });
  await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: ids.woIds } } });
  await prisma.workOrder.deleteMany({ where: { id: { in: ids.woIds } } });
  await prisma.warpBeam.deleteMany({ where: { id: { in: ids.beamIds } } });
  if (ids.weaving) await prisma.weavingOrder.deleteMany({ where: { id: ids.weaving } });
  if (ids.spec) await prisma.warpSpec.deleteMany({ where: { id: ids.spec } });
  if (ids.lot) await prisma.yarnLot.deleteMany({ where: { id: ids.lot } });
  if (ids.yarn) await prisma.item.deleteMany({ where: { id: ids.yarn } });
  if (ids.st) await prisma.station.deleteMany({ where: { id: ids.st } });
  await prisma.systemLog.deleteMany({ where: { recordId: { in: [...ids.dispatchIds, ...ids.beamIds, ...ids.woIds, ...ids.rollIds] } } });
}

main().catch(async (e) => {
  console.error(e);
  await pool.end().catch(() => undefined);
  process.exitCode = 1;
});
