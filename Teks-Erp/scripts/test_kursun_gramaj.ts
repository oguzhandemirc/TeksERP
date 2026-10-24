// =============================================================================
// BEKÇİ — KURŞUN GRAMAJI: çeşit bağı + defter değeri + tek karar (KQ-D4, 2026-10-24)
// Çalıştır: npx tsx scripts/run-all-tests.ts kursun_gramaj
// =============================================================================
// Saha isteği: kurşuncu 25/50/100 gr düğmelerinden birine basar; basılan gramaj
// topa DEFTER kaydı olarak işlenir. Yeni ana veri tablosu YOK (KARAR K5):
// gramaj mevcut SEÇİM özelliğidir, `FabricProperty.variantOfPropertyId` onu
// "Kurşunlu" bayrağına bağlar, değer `RollOperation{KURSUN_APPLIED}.propertyValueId`ye
// yazılır. Düzeltme defteri değiştirmez: eski satır damgalanır, yenisi yazılır.
//
//   §1  ⭐ Eski APK gövdesi (`properties:[{propertyId, valueCode}]`, Zod'dan) →
//       KURSUN_APPLIED.propertyValueId dolar + RollProperty KURSUN + GRAMAJ(değer)
//   §2  Çeşit bağı yok → bugünkü AUTO birebir (bayrak var, değer NULL)
//   §3  ⭐ Düzeltme: eski satır damgalı ('gramaj düzeltme'), yenisi aktif; RollProperty sürüm
//   §4  ⭐ Eşzamanlı iki düzeltme (ayrı bağlantılar, kilit beklemesi ölçülür) → biri 409
//   §5  Aynı değer replay → satır ve audit sayısı DEĞİŞMEZ
//   §6  Tambur kesim çocuğu propertyValueId'yi miras alır + 5 kopya yeri statik
//   §7  Pasif değer KABUL (V9) · bilinmeyen kod 400 · REQUIRED çeşit boş 400 ·
//       OPTIONAL bayrak işaretsiz ama gramaj seçili → bayrak uygulanır
//   §8  DB CHECK: QC2_COMPLETED satırına propertyValueId reddedilir; partial unique + kendine bağ seddi
//   §9  ⭐ AST: src/ altında "KURSUN" literali yalnız quality-station.helper.ts'te
//   §10 Doğrulama 400'leri (özellik formu + İstasyon Yetenekleri) + DTO alanı
//
// FİKSTÜR KENDİ KENDİNE (TEST-KGR- damgası); seed'e bağımlı değil. KURSUN bayrağı
// koda bağlı tek sistem özelliğidir (`KURSUN_PROPERTY_CODE`) — yoksa yaratılır,
// varsa YALNIZ okunur (bağ çeşit satırında durur, KURSUN satırına yazılmaz).
//
// NEGATİF SONDALAR (2026-10-24, PR gövdesinde çıktı):
//   (a) `applyKursunOperationTx` revoke claim'i atlandı → §3 + §4 KIRMIZI
//   (b) completeQc2'ye `caps.find((c) => c.code === "KURSUN")` geri kondu → §9 KIRMIZI
//   (c) tambur kesim kopyasında `propertyValueId` düşürüldü → §6 KIRMIZI
// =============================================================================
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { RollOperationType } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { AppError } from "../src/utils/app-error";
import { KursunQcService } from "../src/services/kursun-qc.service";
import { TamburService } from "../src/services/tambur.service";
import { StationCapabilityService } from "../src/services/station-capability.service";
import { fabricPropertyService } from "../src/routes/fabric-property.routes";
import { completeQc2Schema } from "../src/controllers/kursun-qc.controller";
import { ACTIVE_ROLL_PROPERTY } from "../src/services/helpers/property-revoke.helper";
import { KURSUN_PROPERTY_CODE } from "../src/services/helpers/quality-station.helper";
import { applyKursunOperationTx, KURSUN_CORRECTION_REASON } from "../src/services/helpers/kursun-operation.helper";
import {
  loadStationPropertyCaps,
  resolveProcessApplications,
  type StationPropertyCap,
} from "../src/services/helpers/station-capability-transfer.helper";
import { roleGrade } from "./fixture-quality-grade";
import { testActorId } from "./fixture-test-user";
import { walkTs } from "./lib/ts-tarama";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}
function section(t: string): void { console.log(`\n── ${t} ──`); }

/** Hata 400/409 mı + (verildiyse) details.code eşleşiyor mu? */
async function expectAppError(label: string, status: number, code: string | null, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    check(label, false, "hata bekleniyordu");
  } catch (e) {
    const ok = e instanceof AppError && e.statusCode === status && (code === null || e.details?.code === code);
    const det = e instanceof AppError ? `${e.statusCode} ${String(e.details?.code ?? "")} ${e.message}` : String(e);
    check(label, ok, det.slice(0, 200));
  }
}

const qcSvc = new KursunQcService();
const capSvc = new StationCapabilityService();
const STAMP = `${process.pid % 10000}${Date.now().toString(36).slice(-4)}`;
const P = `TEST-KGR-${STAMP}`;

type Fixtures = {
  rollIds: string[];
  woIds: string[];
  stationIds: string[];
  propIds: string[];
  itemIds: string[];
  kursunCreated: string | null;
};
const fx: Fixtures = { rollIds: [], woIds: [], stationIds: [], propIds: [], itemIds: [], kursunCreated: null };

/** Çöken eski koşumun TEST-KGR kalıntısı (ör. KURSUN'a bağlı çeşit → partial unique) bu koşumu düşürmesin. */
async function collectStale(): Promise<Fixtures> {
  const pre = "TEST-KGR-";
  const items = await prisma.item.findMany({ where: { code: { startsWith: pre } }, select: { id: true } });
  const itemIds = items.map((i) => i.id);
  const rolls = await prisma.roll.findMany({
    where: { OR: [{ barcode: { startsWith: pre } }, { itemId: { in: itemIds } }] },
    select: { id: true },
  });
  const wos = await prisma.workOrder.findMany({ where: { workOrderNumber: { startsWith: pre } }, select: { id: true } });
  const sts = await prisma.station.findMany({ where: { code: { startsWith: pre } }, select: { id: true } });
  const props = await prisma.fabricProperty.findMany({
    where: { OR: [{ code: { startsWith: pre } }, { name: { startsWith: "TEST KGR " } }], NOT: { code: KURSUN_PROPERTY_CODE } },
    select: { id: true },
  });
  return {
    rollIds: rolls.map((r) => r.id),
    woIds: wos.map((w) => w.id),
    stationIds: sts.map((s) => s.id),
    propIds: props.map((p) => p.id),
    itemIds,
    kursunCreated: null,
  };
}

/** Fikstür hep birleşik kurşun+KK2 istasyonu (PROCESS_QC, muayene açık — D1 migration varsayılanı). */
async function mkStation(suffix: string): Promise<string> {
  const st = await prisma.station.create({
    data: {
      code: `${P}-${suffix}`.slice(0, 32),
      name: `TEST KGR ${suffix} ${STAMP}`,
      type: "INTERNAL",
      kind: "PROCESS_QC",
      appliesProperty: true,
      inspectionEnabled: true,
    },
    select: { id: true },
  });
  fx.stationIds.push(st.id);
  return st.id;
}

async function kursunProperty(): Promise<string> {
  const hit = await prisma.fabricProperty.findUnique({ where: { code: KURSUN_PROPERTY_CODE }, select: { id: true } });
  if (hit) return hit.id;
  const row = await prisma.fabricProperty.create({
    data: { code: KURSUN_PROPERTY_CODE, name: `TEST Kurşunlu ${STAMP}`, valueType: "FLAG" },
    select: { id: true },
  });
  fx.kursunCreated = row.id;
  return row.id;
}

/** İş emri + adım (istasyonda) + o adımda üretimdeki top. */
async function mkRollAtStep(itemId: string, stationId: string, n: number): Promise<{ rollId: string; stepId: string }> {
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `${P}-WO${n}`,
      type: "STOCK_PRODUCTION",
      status: "IN_PROGRESS",
      targetItemId: itemId,
      steps: { create: [{ stationId, stepSequence: 1, status: "ACTIVE" }] },
    },
    select: { id: true, steps: { select: { id: true } } },
  });
  fx.woIds.push(wo.id);
  const stepId = wo.steps[0]!.id;
  const roll = await prisma.roll.create({
    data: { itemId, barcode: `${P}-R${n}`, initialQty: 100, currentQty: 100, status: "IN_PRODUCTION", currentStepId: stepId },
    select: { id: true },
  });
  fx.rollIds.push(roll.id);
  return { rollId: roll.id, stepId };
}

async function activeKursunOps(rollId: string) {
  return prisma.rollOperation.findMany({
    where: { rollId, operationType: RollOperationType.KURSUN_APPLIED },
    select: { id: true, revokedAt: true, revokeReason: true, propertyValueId: true, inheritedFromParentRollId: true },
    orderBy: { createdAt: "asc" },
  });
}

async function activeProps(rollId: string) {
  return prisma.rollProperty.findMany({
    where: { rollId, ...ACTIVE_ROLL_PROPERTY },
    select: { propertyId: true, value: { select: { code: true } } },
  });
}

/** HTTP gövdesi şekli: Zod'dan geçer, sonra servis (controller'ın yaptığı). */
async function postCompleteQc2(rollId: string, stepId: string, properties: unknown, actor: string) {
  const body = completeQc2Schema.parse({ rollId, stepId, ...(properties === undefined ? {} : { properties }) });
  return qcSvc.completeQc2(
    { rollId: body.rollId, stepId: body.stepId, notes: body.notes ?? null, properties: body.properties ?? null },
    actor,
    null,
  );
}

async function main(): Promise<void> {
  console.log("=== Kurşun gramajı — çeşit bağı + defter değeri (KQ-D4) ===");
  const stale = await collectStale();
  const staleN = stale.rollIds.length + stale.stationIds.length + stale.propIds.length + stale.itemIds.length + stale.woIds.length;
  if (staleN > 0) {
    console.log(`(eski TEST-KGR kalıntısı süpürülüyor: ${staleN} satır)`);
    await cleanup(stale, "TEST-KGR-");
  }
  const actor = await testActorId();
  const kursunId = await kursunProperty();
  const item = await prisma.item.create({
    data: { code: `${P}-ITM`, name: `TEST KGR kumaş ${STAMP}`, itemType: "FABRIC" },
    select: { id: true },
  });
  fx.itemIds.push(item.id);

  const stK = await mkStation("K"); // kurşun + gramaj (çeşit bağlı)
  const stPlain = await mkStation("P"); // yalnız kurşun (bugünkü kurulum)
  const stOpt = await mkStation("O"); // kurşun OPTIONAL + gramaj OPTIONAL

  const gramaj = await prisma.fabricProperty.create({
    data: {
      code: `${P}-GR`.slice(0, 32),
      name: `TEST Kurşun gramajı ${STAMP}`,
      valueType: "CHOICE",
      variantOfPropertyId: kursunId,
      values: {
        create: [
          { code: "25GR", name: "25 gr", sortOrder: 10 },
          { code: "50GR", name: "50 gr", sortOrder: 20 },
          { code: "100GR", name: "100 gr", sortOrder: 30 },
          { code: "75GR", name: "75 gr", sortOrder: 40, isActive: false },
        ],
      },
    },
    select: { id: true, values: { select: { id: true, code: true } } },
  });
  fx.propIds.push(gramaj.id);
  const vid = (code: string) => gramaj.values.find((v) => v.code === code)!.id;

  await prisma.stationProperty.createMany({
    data: [
      { stationId: stK, propertyId: kursunId, mode: "AUTO" },
      { stationId: stK, propertyId: gramaj.id, mode: "REQUIRED" },
      { stationId: stPlain, propertyId: kursunId, mode: "AUTO" },
      { stationId: stOpt, propertyId: kursunId, mode: "OPTIONAL" },
      { stationId: stOpt, propertyId: gramaj.id, mode: "OPTIONAL" },
    ],
  });

  // ── §1 ──────────────────────────────────────────────────────────────────
  section("§1 eski APK gövdesi → defter değeri + RollProperty");
  const r1 = await mkRollAtStep(item.id, stK, 1);
  const res1 = await postCompleteQc2(r1.rollId, r1.stepId, [{ propertyId: gramaj.id, valueCode: "50gr" }], actor);
  check("completeQc2 başarılı", res1.success === true);
  const ops1 = await activeKursunOps(r1.rollId);
  check("⭐ tek aktif KURSUN_APPLIED + propertyValueId = 50GR",
    ops1.length === 1 && ops1[0]!.revokedAt === null && ops1[0]!.propertyValueId === vid("50GR"),
    JSON.stringify(ops1.map((o) => o.propertyValueId)));
  const props1 = await activeProps(r1.rollId);
  check("RollProperty: KURSUN bayrağı yazıldı", props1.some((p) => p.propertyId === kursunId));
  check("RollProperty: GRAMAJ = 50GR", props1.find((p) => p.propertyId === gramaj.id)?.value?.code === "50GR");
  const audit1 = await prisma.systemLog.findFirst({
    where: { tableName: "ROLL_OPERATION", recordId: res1.data.id, action: "CREATE" },
    select: { newData: true },
  });
  check("audit yükünde valueCode = 50GR", (audit1?.newData as { valueCode?: string } | null)?.valueCode === "50GR");

  // ── §2 ──────────────────────────────────────────────────────────────────
  section("§2 çeşit bağı yok → bugünkü AUTO");
  const r2 = await mkRollAtStep(item.id, stPlain, 2);
  await postCompleteQc2(r2.rollId, r2.stepId, undefined, actor);
  const ops2 = await activeKursunOps(r2.rollId);
  check("KURSUN_APPLIED yazıldı, değer NULL", ops2.length === 1 && ops2[0]!.propertyValueId === null);
  const props2 = await activeProps(r2.rollId);
  check("RollProperty yalnız KURSUN", props2.length === 1 && props2[0]!.propertyId === kursunId,
    props2.map((p) => p.propertyId === kursunId ? "KURSUN" : "?").join(","));

  // ── §3 ──────────────────────────────────────────────────────────────────
  section("§3 düzeltme 50GR → 100GR");
  try {
    await postCompleteQc2(r1.rollId, r1.stepId, [{ propertyId: gramaj.id, valueCode: "100GR" }], actor);
    check("⭐ düzeltme isteği kabul edildi", true);
  } catch (e) {
    check("⭐ düzeltme isteği kabul edildi", false, (e as Error).message.slice(0, 120));
  }
  const ops3 = await activeKursunOps(r1.rollId);
  const old3 = ops3.find((o) => o.propertyValueId === vid("50GR"));
  const new3 = ops3.find((o) => o.propertyValueId === vid("100GR"));
  check("⭐ eski satır damgalı ('gramaj düzeltme')", !!old3?.revokedAt && old3.revokeReason === KURSUN_CORRECTION_REASON,
    JSON.stringify(old3 ?? null));
  check("⭐ yeni satır aktif (100GR), toplam 2 satır", ops3.length === 2 && !!new3 && new3.revokedAt === null);
  const gr3 = await prisma.rollProperty.findMany({ where: { rollId: r1.rollId, propertyId: gramaj.id }, select: { revokedAt: true, value: { select: { code: true } } } });
  check("RollProperty sürümlendi (aktif 100GR + damgalı 50GR)",
    gr3.length === 2 && gr3.find((g) => g.revokedAt === null)?.value?.code === "100GR");

  // ── §4 ──────────────────────────────────────────────────────────────────
  section("§4 eşzamanlı iki düzeltme → biri 409");
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => { release = r; });
  let claimed: () => void = () => {};
  const claimedP = new Promise<void>((r) => { claimed = r; });
  // Sonda (a)'da A'nın kendisi 409 alır: kapı yine açılır ki test asılı kalmasın.
  const txA = prisma.$transaction(async (tx) => {
    const out = await applyKursunOperationTx(tx, { rollId: r1.rollId, stepId: r1.stepId, valueId: vid("25GR"), userId: actor })
      .finally(() => claimed());
    await gate; // A satırı kilitli tutar; B aynı eski satırı claim etmeye çalışır
    return out;
  }, { timeout: 20_000 });
  txA.catch(() => {}); // erken red işlenmemiş sayılmasın (allSettled aşağıda okur)
  await claimedP;
  const txB = prisma.$transaction(
    (tx) => applyKursunOperationTx(tx, { rollId: r1.rollId, stepId: r1.stepId, valueId: vid("50GR"), userId: actor }),
    { timeout: 20_000 },
  );
  txB.catch(() => {});
  // B'nin kilit BEKLEDİĞİ ölçülür (zamanlamaya değil, pg_locks'a güvenilir).
  let waiting = 0;
  for (let i = 0; i < 100 && waiting === 0; i++) {
    const rows = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM pg_locks WHERE NOT granted`;
    waiting = Number(rows[0]?.n ?? 0);
    if (waiting === 0) await new Promise((r) => setTimeout(r, 50));
  }
  check("kontrol: ikinci düzeltme kilit bekliyor (yarış GERÇEKTEN kuruldu)", waiting > 0);
  release();
  const settled = await Promise.allSettled([txA, txB]);
  const ok4 = settled.filter((s) => s.status === "fulfilled").length;
  const c409 = settled.filter((s) => s.status === "rejected" && s.reason instanceof AppError && s.reason.statusCode === 409).length;
  check("⭐ biri başarılı, biri 409", ok4 === 1 && c409 === 1,
    settled.map((s) => (s.status === "fulfilled" ? `ok:${String(s.value)}` : `ret:${(s.reason as Error).message.slice(0, 60)}`)).join(" | "));
  const act4 = (await activeKursunOps(r1.rollId)).filter((o) => o.revokedAt === null);
  check("tek aktif satır kaldı (25GR)", act4.length === 1 && act4[0]!.propertyValueId === vid("25GR"));

  // ── §5 ──────────────────────────────────────────────────────────────────
  section("§5 aynı değer replay");
  const r5 = await mkRollAtStep(item.id, stK, 5);
  const first5 = await postCompleteQc2(r5.rollId, r5.stepId, [{ propertyId: gramaj.id, valueCode: "25GR" }], actor);
  const opCount = () => prisma.rollOperation.count({ where: { rollId: r5.rollId } });
  const propCount = () => prisma.rollProperty.count({ where: { rollId: r5.rollId } });
  const auditCount = () => prisma.systemLog.count({ where: { tableName: "ROLL_OPERATION", recordId: first5.data.id } });
  const [o5, p5, a5] = [await opCount(), await propCount(), await auditCount()];
  await postCompleteQc2(r5.rollId, r5.stepId, [{ propertyId: gramaj.id, valueCode: "25GR" }], actor);
  const [o5b, p5b, a5b] = [await opCount(), await propCount(), await auditCount()];
  check("operasyon satırı sayısı değişmedi", o5 === o5b, `${o5} → ${o5b}`);
  check("özellik satırı sayısı değişmedi", p5 === p5b, `${p5} → ${p5b}`);
  check("audit TEKRAR yazılmadı", a5 === a5b && a5 === 1, `${a5} → ${a5b}`);

  // ── §6 ──────────────────────────────────────────────────────────────────
  section("§6 Tambur kesim çocuğu miras");
  const parent = await prisma.roll.create({
    data: { itemId: item.id, barcode: `${P}-R6`, initialQty: 100, currentQty: 100, status: "WAREHOUSE", entrySource: "TAMBUR_MANUAL" },
    select: { id: true },
  });
  fx.rollIds.push(parent.id);
  await prisma.rollOperation.create({
    data: { rollId: parent.id, workOrderStepId: r5.stepId, operationType: RollOperationType.KURSUN_APPLIED, propertyValueId: vid("50GR") },
  });
  const cut = await new TamburService().cutWarehouseRoll(parent.id, { cutLength: 40, qualityGrade: (await roleGrade("FIRST")).code });
  const childId = cut.data!.childRoll.id;
  fx.rollIds.push(childId);
  const childOps = await activeKursunOps(childId);
  check("⭐ çocuk KURSUN_APPLIED propertyValueId = 50GR (miras)",
    childOps.length === 1 && childOps[0]!.propertyValueId === vid("50GR") && childOps[0]!.inheritedFromParentRollId === parent.id,
    JSON.stringify(childOps));
  // Beş kopya yeri (tambur ×4 + fason ×1): her miras yazımı değeri taşır.
  for (const f of ["src/services/tambur.service.ts", "src/services/subcontractor.service.ts"]) {
    const src = readFileSync(join(__dirname, "..", f), "utf8");
    const inherit = (src.match(/inheritedFromParentRollId: (parent|roll)\.id,/g) ?? []).length;
    const carry = (src.match(/propertyValueId: op\.propertyValueId,/g) ?? []).length;
    check(`${f}: her miras kopyası propertyValueId taşır`, inherit > 0 && inherit === carry, `${carry}/${inherit}`);
  }

  // ── §7 ──────────────────────────────────────────────────────────────────
  section("§7 pasif değer · yabancı değer · REQUIRED boş · OPTIONAL türetme");
  const r7 = await mkRollAtStep(item.id, stK, 7);
  await postCompleteQc2(r7.rollId, r7.stepId, [{ propertyId: gramaj.id, valueCode: "75GR" }], actor);
  const ops7 = await activeKursunOps(r7.rollId);
  check("⭐ PASİF değer (75GR) çeşitte KABUL (V9)", ops7[0]?.propertyValueId === vid("75GR"));
  check("pasif değer RollProperty'ye de yazıldı",
    (await activeProps(r7.rollId)).find((p) => p.propertyId === gramaj.id)?.value?.code === "75GR");
  const r7b = await mkRollAtStep(item.id, stK, 71);
  await expectAppError("bilinmeyen kod (999GR) 400", 400, "PROPERTY_VALUE_INVALID",
    () => postCompleteQc2(r7b.rollId, r7b.stepId, [{ propertyId: gramaj.id, valueCode: "999GR" }], actor));
  await expectAppError("REQUIRED çeşit boş 400", 400, null, () => postCompleteQc2(r7b.rollId, r7b.stepId, [], actor));
  check("reddedilen istekler satır bırakmadı", (await prisma.rollOperation.count({ where: { rollId: r7b.rollId } })) === 0);
  const r7c = await mkRollAtStep(item.id, stOpt, 72);
  await postCompleteQc2(r7c.rollId, r7c.stepId, [{ propertyId: gramaj.id, valueCode: "100GR" }], actor);
  const ops7c = await activeKursunOps(r7c.rollId);
  check("OPTIONAL kurşun işaretsiz + gramaj seçili → bayrak uygulandı (değerle)",
    ops7c.length === 1 && ops7c[0]!.propertyValueId === vid("100GR") &&
      (await activeProps(r7c.rollId)).some((p) => p.propertyId === kursunId));
  const r7d = await mkRollAtStep(item.id, stOpt, 73);
  await postCompleteQc2(r7d.rollId, r7d.stepId, [], actor);
  check("OPTIONAL ikisi de seçilmedi → kurşun YOK", (await activeKursunOps(r7d.rollId)).length === 0);
  // Saf karar: REQUIRED çeşit, bayrak işaretli ama değer yok → 400 (resolveProcessApplications).
  const capsK: StationPropertyCap[] = await loadStationPropertyCaps(prisma, stK);
  await expectAppError("resolveProcessApplications: REQUIRED çeşit değersiz 400", 400, "PROPERTY_VALUE_REQUIRED",
    async () => resolveProcessApplications(capsK, [{ propertyId: kursunId }]));
  const apps = resolveProcessApplications(capsK, [{ propertyId: gramaj.id, valueCode: "50GR" }]);
  check("resolveProcessApplications: bayrak uygulandı + valueId",
    apps.length === 1 && apps[0]!.flagPropertyId === kursunId && apps[0]!.applied && apps[0]!.valueId === vid("50GR"));

  // ── §8 ──────────────────────────────────────────────────────────────────
  section("§8 DB sedleri");
  const sedRed = async (label: string, needle: string, fn: () => Promise<unknown>) => {
    try { await fn(); check(label, false, "DB kabul etti"); }
    catch (e) { const m = String((e as Error).message) + JSON.stringify((e as { meta?: unknown }).meta ?? {}); check(label, m.includes(needle), m.slice(0, 160)); }
  };
  await sedRed("⭐ QC2_COMPLETED + propertyValueId → CHECK reddi", "roll_operations_property_value_ck", () =>
    prisma.$executeRawUnsafe(
      `INSERT INTO roll_operations (id, "rollId", "workOrderStepId", "operationType", "propertyValueId") VALUES (gen_random_uuid(), $1::uuid, $2::uuid, 'QC2_COMPLETED', $3::uuid)`,
      r7d.rollId, r7d.stepId, vid("25GR")));
  await sedRed("bir bayrağın ikinci çeşidi → partial unique reddi", "fabric_properties_variant_of_uq", () =>
    prisma.$executeRawUnsafe(
      `INSERT INTO fabric_properties (id, code, name, "valueType", "variantOfPropertyId", "updatedAt") VALUES (gen_random_uuid(), $1, $2, 'CHOICE', $3::uuid, now())`,
      `${P}-G2`.slice(0, 32), `TEST KGR ikinci çeşit ${STAMP}`, kursunId));
  await sedRed("kendine bağ → CHECK reddi", "fabric_properties_variant_not_self_ck", () =>
    prisma.$executeRawUnsafe(`UPDATE fabric_properties SET "variantOfPropertyId" = id WHERE id = $1::uuid`, gramaj.id));

  // ── §9 ──────────────────────────────────────────────────────────────────
  section("§9 AST: \"KURSUN\" literali tek yerde");
  const srcDir = join(__dirname, "..", "src");
  const hits: string[] = [];
  for (const file of walkTs(srcDir)) {
    const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    const visit = (n: ts.Node): void => {
      if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && n.text === KURSUN_PROPERTY_CODE) {
        hits.push(`${relative(srcDir, file)}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  check("tarama dolu (körlük zemini)", walkTs(srcDir).length > 100);
  check("⭐ \"KURSUN\" literali yalnız helpers/quality-station.helper.ts",
    hits.length === 1 && hits[0]!.startsWith("services/helpers/quality-station.helper.ts"), hits.join(", "));

  // ── §10 ─────────────────────────────────────────────────────────────────
  section("§10 doğrulama 400'leri + DTO");
  const flagT = await prisma.fabricProperty.create({
    data: { code: `${P}-FL`.slice(0, 32), name: `TEST KGR bayrak ${STAMP}`, valueType: "FLAG" },
    select: { id: true },
  });
  fx.propIds.push(flagT.id);
  await prisma.stationProperty.create({ data: { stationId: stK, propertyId: flagT.id, mode: "OPTIONAL" } });
  const choiceVals = [{ code: "A", name: "A" }];
  await expectAppError("FLAG özellik çeşit olamaz", 400, "PROPERTY_VARIANT_NOT_CHOICE", () =>
    fabricPropertyService.create({ name: `TEST KGR fl-v ${STAMP}`, valueType: "FLAG", stationIds: [stK], variantOfPropertyId: flagT.id, isActive: true }));
  await expectAppError("çeşide çeşit (hedef bayrak değil) 400", 400, "PROPERTY_VARIANT_PARENT_NOT_FLAG", () =>
    fabricPropertyService.create({ name: `TEST KGR ch-v ${STAMP}`, valueType: "CHOICE", values: choiceVals, stationIds: [stK], variantOfPropertyId: gramaj.id, isActive: true }));
  await expectAppError("bayrağın ikinci çeşidi 400", 400, "PROPERTY_VARIANT_TAKEN", () =>
    fabricPropertyService.create({ name: `TEST KGR ch-2 ${STAMP}`, valueType: "CHOICE", values: choiceVals, stationIds: [stK], variantOfPropertyId: kursunId, isActive: true }));
  await expectAppError("ana bayraksız istasyona çeşit (özellik formu) 400", 400, "PROPERTY_VARIANT_PARENT_NOT_BOUND", () =>
    fabricPropertyService.create({ name: `TEST KGR ch-3 ${STAMP}`, valueType: "CHOICE", values: choiceVals, stationIds: [stPlain], variantOfPropertyId: flagT.id, isActive: true }));
  const okRes = await fabricPropertyService.create({
    name: `TEST KGR çeşit ${STAMP}`, valueType: "CHOICE", values: choiceVals, stationIds: [stK], variantOfPropertyId: flagT.id, isActive: true,
  });
  const vT = (okRes.data as { id: string; variantOfPropertyId: string | null }) ;
  fx.propIds.push(vT.id);
  check("geçerli çeşit doğdu (bağ yazıldı)", vT.variantOfPropertyId === flagT.id);
  await expectAppError("kendine bağ (update) 400", 400, "PROPERTY_VARIANT_SELF", () =>
    fabricPropertyService.update(vT.id, { variantOfPropertyId: vT.id }));
  await fabricPropertyService.update(vT.id, { name: `TEST KGR çeşit+ ${STAMP}` });
  check("eski panel (alan yok) update bağa dokunmaz",
    (await prisma.fabricProperty.findUnique({ where: { id: vT.id }, select: { variantOfPropertyId: true } }))?.variantOfPropertyId === flagT.id);
  await expectAppError("bayrağın istasyonu çeşitten önce kaldırılamaz", 400, "PROPERTY_VARIANT_PARENT_NOT_BOUND", () =>
    fabricPropertyService.update(flagT.id, { stationIds: [stPlain] }));
  await expectAppError("çeşidi olan bayrak Seçim'e çevrilemez", 400, "PROPERTY_VARIANT_PARENT_TYPE_LOCK", () =>
    fabricPropertyService.update(flagT.id, { valueType: "CHOICE", values: choiceVals }));
  await expectAppError("İstasyon Yetenekleri: ana bayraksız çeşit 400", 400, "PROPERTY_VARIANT_PARENT_NOT_BOUND", () =>
    capSvc.setCapabilities(stPlain, { properties: [{ propertyId: kursunId, mode: "AUTO" }, { propertyId: gramaj.id, mode: "REQUIRED" }, { propertyId: vT.id, mode: "OPTIONAL" }] }));
  const dto = await capSvc.findByStation(stK);
  check("yetenek DTO'su variantOfPropertyId taşır",
    dto.data.properties.find((p) => p.id === gramaj.id)?.variantOfPropertyId === kursunId &&
      dto.data.properties.find((p) => p.id === kursunId)?.variantOfPropertyId === null);
  const step = await qcSvc.getStep(r1.stepId);
  check("buildStepSummary properties[].variantOfPropertyId",
    step.data.properties.find((p) => p.propertyId === gramaj.id)?.variantOfPropertyId === kursunId);
}

async function cleanup(created: Fixtures = fx, prefix: string = P): Promise<void> {
  const ids = created.rollIds;
  const steps = async (sil: () => Promise<unknown>, ad: string) => {
    try { await sil(); } catch (e) { fail++; console.log(`❌ temizlik ${ad}: ${(e as Error).message.split("\n")[0]}`); }
  };
  await steps(() => prisma.rollProperty.deleteMany({ where: { rollId: { in: ids } } }), "rollProperty");
  await steps(() => prisma.rollVariance.deleteMany({ where: { rollId: { in: ids } } }), "rollVariance");
  await steps(() => prisma.rollMovement.deleteMany({ where: { rollId: { in: ids } } }), "rollMovement");
  await steps(() => prisma.rollOperation.deleteMany({ where: { OR: [{ rollId: { in: ids } }, { inheritedFromParentRollId: { in: ids } }] } }), "rollOperation");
  await steps(() => prisma.warehouseMovement.deleteMany({ where: { rollId: { in: ids }, reversesMovementId: { not: null } } }), "warehouseMovement ters");
  await steps(() => prisma.warehouseMovement.deleteMany({ where: { rollId: { in: ids } } }), "warehouseMovement");
  await steps(() => prisma.roll.deleteMany({ where: { id: { in: ids } } }), "roll");
  await steps(() => prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: created.woIds } } }), "workOrderStep");
  await steps(() => prisma.workOrder.deleteMany({ where: { id: { in: created.woIds } } }), "workOrder");
  await steps(() => prisma.stationProperty.deleteMany({ where: { stationId: { in: created.stationIds } } }), "stationProperty");
  await steps(() => prisma.stationProperty.deleteMany({ where: { propertyId: { in: created.propIds } } }), "stationProperty(prop)");
  // Çeşit bağı önce sökülür (self-FK RESTRICT).
  await steps(() => prisma.fabricProperty.updateMany({ where: { id: { in: created.propIds } }, data: { variantOfPropertyId: null } }), "variant bağı");
  await steps(() => prisma.fabricPropertyValue.deleteMany({ where: { propertyId: { in: created.propIds } } }), "fabricPropertyValue");
  await steps(() => prisma.fabricProperty.deleteMany({ where: { id: { in: created.propIds } } }), "fabricProperty");
  if (created.kursunCreated) {
    const kid = created.kursunCreated;
    await steps(() => prisma.fabricProperty.deleteMany({ where: { id: kid } }), "KURSUN (bu koşum yarattı)");
  }
  await steps(() => prisma.station.deleteMany({ where: { id: { in: created.stationIds } } }), "station");
  await steps(() => prisma.item.deleteMany({ where: { id: { in: created.itemIds } } }), "item");
  const left = await prisma.roll.count({ where: { barcode: { startsWith: prefix } } });
  check("temizlik: TEST-KGR top kalıntısı yok", left === 0, String(left));
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
