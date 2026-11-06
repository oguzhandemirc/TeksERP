// =============================================================================
// Test: Rotasız (okutmayla, K29 `scanRouted`) iş emrinin "Şu an nerede"si — gerçek akış (2026-11-06)
// Çalıştır: npx tsx scripts/test_workorder_location_rotasiz.ts
// Kaynak: `helpers/workorder-location.helper.ts` (liste `WorkOrderService.findAll` + istasyon okutma cümlesi).
// NEDEN: rotasız İE adımsız doğar; konum yine CANLI topun durduğu adımdan okunur — adımı okutma ekler
//   (`applyScanRoute` INSERT, top taşınır). Bu bekçi zinciri ürün servisleriyle yürütür (elle satır yazmaz) ve her
//   aşamada liste ucunun `konum`unu + iki süzgeci (`konumIstasyon`, `konumSinifi`) ölçer:
//   §1 açıldı, hiç okutulmadı → PLANNED · BASLAMADI · istasyon yok · cümle "Henüz başlamadı"
//   §2 Kurşun'da okutuldu → Kurşun (PROCESS_QC rengi), 2 top; cümle "Şu an: Kurşun (2 top)"
//   §3 Kurşun bitti (toplar sonraki okutmayı bekler) → hâlâ Kurşun (son işlem gören istasyon), Planlandı'ya düşmez
//   §4 Tambur'da okutuldu → Tambur (Kurşun değil)
//   §5 Tambur'da bir top kesildi → Tambur, 1 top
//   §6 Tambur bitti → COMPLETED · BITTI · istasyon yok (istemci "Tamamlandı" basar)
//   §7 rotalı İE (aynı SCAN ayarında) → ilk adımın istasyonu; rotasız akış onu değiştirmez (regresyon)
//   §8 saf: iptal/devredilmiş İE BITTI + istasyonsuz (istemci durumdan "İptal"/"Devredildi" basar)
// NEGATİF SONDA (2026-11-06, tek tek, md5 ile geri alındı):
//   • konum yükleyicisi TAMAMLANMIŞ adımdaki topu saymadı (adım statüsünden türetme) → §3 sınıf + istasyon ❌ (51/2)
//   • `kursun-qc.service` `awaitNextScan` kapatıldı (son adım gibi depoya indir, İE kapanır) → §3 ❌ ×5 + zincir durur (20/6)
// =============================================================================
import { randomUUID } from "crypto";
import { Prisma, RollForm, RollOperationType, RollStatus, StepStatus, TravelerCardStatus, WorkOrderStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { KursunQcService } from "../src/services/kursun-qc.service";
import { TamburService } from "../src/services/tambur.service";
import { WorkOrderService } from "../src/services/workorder.service";
import { applyScanRoute } from "../src/services/workorder-scan-route.service";
import { classifyWorkOrderLocation, type WorkOrderLocation, type WorkOrderLocationClass } from "../src/services/helpers/workorder-location.helper";
import { locationSentence } from "../src/services/helpers/station-lookup-rows.helper";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { stopNotificationJobs } from "../src/jobs/notification-dispatch.job";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { testActorId } from "./fixture-test-user";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`); } else { fail++; console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}
function section(t: string): void { console.log(`\n── ${t} ──`); }

const STAMP = randomUUID().slice(0, 8).toUpperCase();
const P = `TEST-WOLR-${STAMP}`;
const KEYS = [SETTING_KEYS.PRODUCTION_ROUTE_MODE, SETTING_KEYS.PRODUCTION_SCAN_ROUTE_STATIONS] as const;
const fx = { woIds: [] as string[], rollIds: [] as string[], stationIds: [] as string[], itemIds: [] as string[], settings: new Map<string, { value: unknown } | null>() };
const wos = new WorkOrderService();

type Row = { id: string; status: WorkOrderStatus; konum: WorkOrderLocation };
/** Liste ucu (cursor kipi, tabletin çağrısı) — `filter` verilirse süzgeçli. */
async function listed(number: string, filter: Record<string, string> = {}): Promise<Row[]> {
  const q = Object.fromEntries(Object.entries(filter).map(([k, v]) => [`filter[${k}]`, v]));
  const res = (await wos.findAll({ query: { search: number, cursor: "", limit: "20", ...q } } as never)) as unknown as { data: Row[] };
  return res.data;
}

/** Aşama ölçümü: liste konumu + istasyon süzgeci + sınıf süzgeci (boğaz ikizi) aynı cevabı verir. */
async function expectAt(tag: string, wo: { id: string; number: string }, exp: { cls: WorkOrderLocationClass; stationId: string | null; tops: number; status?: WorkOrderStatus }, others: string[]): Promise<WorkOrderLocation | null> {
  const row = (await listed(wo.number)).find((r) => r.id === wo.id);
  const k = row?.konum ?? null;
  check(`${tag} sınıf ${exp.cls}`, k?.sinif === exp.cls, JSON.stringify(k));
  const first = k?.istasyonlar[0];
  check(`${tag} istasyon ${exp.stationId ? "doğru (tek)" : "yok"} · ${exp.tops} canlı top`,
    exp.stationId ? first?.istasyonId === exp.stationId && k?.istasyonlar.length === 1 && first.topSayisi === exp.tops : (k?.istasyonlar.length ?? -1) === 0 && k?.canliTop === 0,
    JSON.stringify(k?.istasyonlar.map((e) => `${e.ad}:${e.topSayisi}`)));
  if (exp.status) check(`${tag} İE durumu ${exp.status}`, row?.status === exp.status, row?.status ?? "∅");
  const byClass = (await listed(wo.number, { konumSinifi: exp.cls })).some((r) => r.id === wo.id);
  check(`${tag} süzgeç konumSinifi=${exp.cls} İE'yi döndürür (ikiz)`, byClass);
  for (const sid of [...(exp.stationId ? [exp.stationId] : []), ...others]) {
    const hit = (await listed(wo.number, { konumIstasyon: sid })).some((r) => r.id === wo.id);
    check(`${tag} süzgeç konumIstasyon ${sid === exp.stationId ? "bu istasyon → var" : "öteki istasyon → yok"}`, hit === (sid === exp.stationId));
  }
  return k;
}

async function main(): Promise<void> {
  console.log("=== Rotasız iş emri — Şu an nerede (gerçek akış) ===");
  const engel = hedefDbEngeli();
  if (engel) { check("hedef DB yazılabilir", false, engel); return; }
  const actor = await testActorId();
  for (const k of KEYS) fx.settings.set(k, await prisma.systemSetting.findUnique({ where: { key: k }, select: { value: true } }));
  for (const [key, value] of [[KEYS[0], "SCAN"], [KEYS[1], "ALL"]] as const) {
    await prisma.systemSetting.upsert({ where: { key }, create: { key, value, description: "TEST — rotasız konum" }, update: { value } });
  }
  const itemId = (await prisma.item.create({ data: { code: `${P}-KUM`.slice(0, 32), name: `TEST WOLR kumaş ${STAMP}`, itemType: "FABRIC", unit: "MT" }, select: { id: true } })).id;
  fx.itemIds.push(itemId);
  const mkStation = async (n: string, kind: "PROCESS_QC" | "TAMBUR") => {
    const st = await prisma.station.create({ data: { code: `${P}-${n}`.slice(0, 32), name: `TEST WOLR ${n} ${STAMP}`, type: "INTERNAL", kind, department: "KALITE" }, select: { id: true } });
    fx.stationIds.push(st.id);
    return st.id;
  };
  const K = await mkStation("KURSUN", "PROCESS_QC");
  const T = await mkStation("TAMBUR", "TAMBUR");
  const grade = await prisma.qualityGrade.findFirst({ where: { role: "FIRST", isActive: true }, select: { code: true } });
  if (!grade) { check("FIRST rollü kalite var (seed)", false); return; }

  const barcodes: string[] = [];
  for (let i = 0; i < 2; i++) {
    const barcode = `${P}-R${i}`.slice(0, 40);
    const r = await prisma.roll.create({ data: { barcode, itemId, initialQty: 50, currentQty: 50, status: RollStatus.STOCK, entrySource: "SUBCONTRACTOR_RETURN", form: RollForm.ACIK }, select: { id: true } });
    fx.rollIds.push(r.id);
    barcodes.push(barcode);
  }

  // ── §1 ──
  section("§1 rotasız, hiç okutulmadı");
  const qs = await wos.quickStart({ clientToken: randomUUID(), rollBarcodes: barcodes, scanRouted: true, type: "STOCK_PRODUCTION" }, actor);
  const created = qs.data!.workOrder;
  fx.woIds.push(created.id);
  const wo = { id: created.id, number: (await prisma.workOrder.findUniqueOrThrow({ where: { id: created.id }, select: { workOrderNumber: true } })).workOrderNumber };
  check("§1 ön koşul: adımsız rotasız İE, toplar partide", (await prisma.workOrderStep.count({ where: { workOrderId: wo.id } })) === 0
    && (await prisma.workOrder.findUnique({ where: { id: wo.id }, select: { scanRouted: true } }))?.scanRouted === true);
  const k1 = await expectAt("§1", wo, { cls: "BASLAMADI", stationId: null, tops: 0, status: WorkOrderStatus.PLANNED }, [K, T]);
  check("§1 istasyon okutma cümlesi 'Henüz başlamadı'", !!k1 && locationSentence(k1) === "Henüz başlamadı", k1 ? locationSentence(k1) : "∅");

  const card = (await prisma.travelerCard.findFirst({ where: { workOrderId: wo.id, status: TravelerCardStatus.ACTIVE }, select: { barcode: true } }))!.barcode;
  const scanAt = (stationId: string) => applyScanRoute(card, { clientToken: randomUUID() }, { userId: actor, stationId, deviceId: "TEST-TABLET", machineId: null, permissions: ["*"] });

  // ── §2 ──
  section("§2 Kurşun'da okutuldu (çalışıyor)");
  const a2 = await scanAt(K);
  check("§2 ön koşul: Kurşun adımı eklendi", a2.kind === "INSERT");
  const k2 = await expectAt("§2", wo, { cls: "TEK_ISTASYON", stationId: K, tops: 2, status: WorkOrderStatus.IN_PROGRESS }, [T]);
  // Renk istemcide `tur` + `dis`ten çözülür: istasyon kartındaki tür birebir gelmeli.
  const kKind = (await prisma.station.findUniqueOrThrow({ where: { id: K }, select: { kind: true } })).kind;
  check("§2 istasyon rengi için tür = istasyonun türü, iç istasyon", k2?.istasyonlar[0]?.tur === kKind && k2.istasyonlar[0].dis === false, k2?.istasyonlar[0]?.tur ?? "∅");
  check("§2 istasyon okutma cümlesi Kurşun'u söyler", !!k2 && locationSentence(k2) === `Şu an: TEST WOLR KURSUN ${STAMP} (2 top)`, k2 ? locationSentence(k2) : "∅");

  // ── §3 ──
  section("§3 Kurşun bitti, sonraki okutma bekleniyor");
  const kStep = (await prisma.workOrderStep.findFirstOrThrow({ where: { workOrderId: wo.id, stationId: K }, select: { id: true } })).id;
  await prisma.rollOperation.createMany({ data: fx.rollIds.map((rollId) => ({ rollId, workOrderStepId: kStep, operationType: RollOperationType.QC2_COMPLETED, operatorId: actor })) });
  await new KursunQcService().finishStep({ stepId: kStep }, actor, null);
  check("§3 ön koşul: Kurşun adımı TAMAMLANDI", (await prisma.workOrderStep.findUnique({ where: { id: kStep }, select: { status: true } }))?.status === StepStatus.COMPLETED);
  await expectAt("§3", wo, { cls: "TEK_ISTASYON", stationId: K, tops: 2, status: WorkOrderStatus.IN_PROGRESS }, [T]);

  // ── §4 ──
  section("§4 Tambur'a geçti");
  const a4 = await scanAt(T);
  check("§4 ön koşul: Tambur adımı Kurşun'un arkasına eklendi", a4.kind === "INSERT");
  const k4 = await expectAt("§4", wo, { cls: "TEK_ISTASYON", stationId: T, tops: 2, status: WorkOrderStatus.IN_PROGRESS }, [K]);
  check("§4 tür TAMBUR", k4?.istasyonlar[0]?.tur === "TAMBUR");

  // ── §5 ──
  section("§5 Tambur'da bir top kesildi");
  const tambur = new TamburService();
  const cut = async (rollId: string, lengths: number[]) => {
    const f = await tambur.finalize({ rollId, decisions: [], cuts: lengths.map((length) => ({ length, qualityGrade: grade.code, relatedErrorIds: [] })) }, actor);
    fx.rollIds.push(...f.data!.splitRolls.map((r) => r.id));
  };
  await cut(fx.rollIds[0]!, [30, 20]);
  await expectAt("§5", wo, { cls: "TEK_ISTASYON", stationId: T, tops: 1, status: WorkOrderStatus.IN_PROGRESS }, [K]);

  // ── §6 ──
  section("§6 Tambur bitti → tamamlandı");
  await cut(fx.rollIds[1]!, [50]);
  await expectAt("§6", wo, { cls: "BITTI", stationId: null, tops: 0, status: WorkOrderStatus.COMPLETED }, [K, T]);

  // ── §7 ──
  section("§7 rotalı İE (regresyon)");
  const routedNo = `${P}-ROTALI`;
  const routed = await prisma.workOrder.create({
    data: {
      workOrderNumber: routedNo, type: "STOCK_PRODUCTION", status: WorkOrderStatus.IN_PROGRESS, targetItemId: itemId,
      steps: { create: [{ stationId: K, stepSequence: 1, status: StepStatus.ACTIVE }, { stationId: T, stepSequence: 2, status: StepStatus.PENDING }] },
    },
    select: { id: true, steps: { select: { id: true }, orderBy: { stepSequence: "asc" } } },
  });
  fx.woIds.push(routed.id);
  const rr = await prisma.roll.create({ data: { itemId, initialQty: 40, currentQty: 40, status: RollStatus.IN_PRODUCTION, currentStepId: routed.steps[0]!.id, producedInStepId: routed.steps[0]!.id, entrySource: "SUBCONTRACTOR_RETURN", form: RollForm.ACIK }, select: { id: true } });
  fx.rollIds.push(rr.id);
  await expectAt("§7", { id: routed.id, number: routedNo }, { cls: "TEK_ISTASYON", stationId: K, tops: 1 }, [T]);

  // ── §8 ──
  section("§8 saf: kapalı İE");
  check("§8a CANCELLED + canlı top yok → BITTI", classifyWorkOrderLocation(WorkOrderStatus.CANCELLED, []) === "BITTI");
  check("§8b SUPERSEDED + canlı top yok → BITTI", classifyWorkOrderLocation(WorkOrderStatus.SUPERSEDED, []) === "BITTI");
  check("§8c PLANNED + adımsız beklemedeki top (canlı sayılmaz) → BASLAMADI", classifyWorkOrderLocation(WorkOrderStatus.PLANNED, []) === "BASLAMADI");
}

async function cleanup(): Promise<void> {
  const del = async (ad: string, f: () => Promise<unknown>) => {
    try { await f(); } catch (e) { fail++; console.log(`❌ temizlik ${ad}: ${(e as Error).message.split("\n")[0]}`); }
  };
  for (const k of KEYS) {
    const prev = fx.settings.get(k);
    if (prev === null || prev === undefined) await del("ayar", () => prisma.systemSetting.deleteMany({ where: { key: k } }));
    else await del("ayar", () => prisma.systemSetting.update({ where: { key: k }, data: { value: prev.value as Prisma.InputJsonValue } }));
  }
  const rollIds = [...new Set([...fx.rollIds, ...(await prisma.roll.findMany({ where: { batch: { workOrderId: { in: fx.woIds } } }, select: { id: true } })).map((r) => r.id)])];
  const stepIds = (await prisma.workOrderStep.findMany({ where: { workOrderId: { in: fx.woIds } }, select: { id: true } })).map((s) => s.id);
  await del("systemLog", () => prisma.systemLog.deleteMany({ where: { recordId: { in: [...stepIds, ...fx.woIds, ...rollIds] } } }));
  for (const t of ["serviceBillingLink", "rollMeterReading", "rollProperty", "rollOperation", "rollMovement", "rollError", "rollVariance", "warehouseMovement"] as const) {
    await del(t, () => (prisma[t] as unknown as { deleteMany: (a: unknown) => Promise<unknown> }).deleteMany({ where: { rollId: { in: rollIds } } }));
  }
  await del("roll bağları", () => prisma.roll.updateMany({ where: { id: { in: rollIds } }, data: { currentStepId: null, producedInStepId: null, batchId: null, parentRollId: null } }));
  await del("roll", () => prisma.roll.deleteMany({ where: { id: { in: rollIds } } }));
  for (const wid of fx.woIds) {
    await del("hedef", () => prisma.workOrderTargetValue.deleteMany({ where: { workOrderId: wid } }));
    // work_order_events / kapanış künyesi append-only: iş emri silinince kaskatla gider; rollStatusEvent topla.
    await del("kart taraması", () => prisma.travelerCardScan.deleteMany({ where: { card: { workOrderId: wid } } }));
    await del("kart", () => prisma.travelerCard.deleteMany({ where: { workOrderId: wid } }));
    await del("parti", () => prisma.batch.deleteMany({ where: { workOrderId: wid } }));
    await del("adım", () => prisma.workOrderStep.deleteMany({ where: { workOrderId: wid } }));
    await del("iş emri", () => prisma.workOrder.deleteMany({ where: { id: wid } }));
  }
  await del("istasyon", () => prisma.station.deleteMany({ where: { id: { in: fx.stationIds } } }));
  await del("kalem", () => prisma.item.deleteMany({ where: { id: { in: fx.itemIds } } }));
  check("temizlik: TEST-WOLR kalıntısı yok", (await prisma.workOrder.count({ where: { id: { in: fx.woIds } } })) === 0 && (await prisma.roll.count({ where: { id: { in: rollIds } } })) === 0);
}

main()
  .catch((e) => { fail++; console.error("HATA:", e instanceof Error ? (e.stack ?? e.message) : e); })
  .finally(async () => {
    stopNotificationJobs();
    await cleanup().catch((e) => { fail++; console.error("TEMİZLİK HATASI:", e); });
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
    await pool.end();
  });
