// =============================================================================
// BEKÇİ — Kart okutmada adım OTURUM İSTASYONUNDAN (KQ-D2, 2026-10-24)
// =============================================================================
// Çalıştır: npx tsx scripts/run-all-tests.ts station_step_resolution
//
// NE ÖLÇER: `resolveWoStepForStation` + `KursunQcService.getByCardBarcode/
// listOpenCards`. Kurşun→KK→Tambur rotasında KK tableti kurşun adımına DÜŞMEZ
// (plan T3/T4); oturumsuz istek bugünkü "ilk akış adımı" davranışında kalır.
//   §1 KK oturumu → KK adımı (toplar KK'deyken) + toplar henüz gelmemişken
//      tamamlanmamış KK adımı (boş özet)
//   §2 Kurşun oturumu → kurşun adımı (toplar kurşundayken)
//   §3 Oturumsuz → ilk akış adımı (LEGACY; COMPLETED ise yeniden açma özeti)
//   §4 Rotada akış adımı olmayan istasyonun oturumu → LEGACY
//   §5 listOpenCards(istasyon) süzer, (null) hepsini döner; ⭐ listede görünen
//      her kart AYNI oturumla okutulunca AYNI adımı açar (liste ↔ kabul çifti)
//   §6 Aynı istasyona iki kez uğrayan rota → açık toplu adım / tamamlanmamış ilk
//   §7 Oturumun adımları hepsi COMPLETED → SON adım (yeniden açma özeti)
//   §8 Uçtan uca: okut → KK2 tamamla → adımı kapat (Kurşun, sonra KK)
//
// FİKSTÜR KENDİ KENDİNE (`TEST-KQD2-` damgası): Item + 4 istasyon + iş emirleri;
// ortamdaki veriye bağımlı değil, aktör `testActorId()`. `finally`de FK sırasıyla
// sökülür. Liste kontrolleri yalnız KENDİ iş emirlerimize bakar (ortam kartları
// listede olabilir).
//
// NEGATİF SONDALAR (2026-10-24, tekserp_kqd2_test; pozitif 32/0):
//   (a) helper SESSION dalı kapatıldı (hep LEGACY) → 12 kırmızı: §1/§1a/§2/§5b
//       liste↔okutma/§6/§7/§8b (KK okutması kapalı kurşun adımına düştü: T3)
//   (b) listOpenCards `stationId` eşitliği kaldırıldı → 5 kırmızı (§5a/§5b)
//   (c) `test_station_quality_capability` KIND_MUAF kursun-qc satırı geri → §4 ölü muaf
// =============================================================================
import {
  RollForm,
  RollStatus,
  StationKind,
  StepStatus,
  TravelerCardStatus,
  WorkOrderStatus,
} from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { KursunQcService } from "../src/services/kursun-qc.service";
import { resolveWoStepForStation } from "../src/services/helpers/station-step-resolve.helper";
import { inspectionDefaultForKind } from "../src/services/helpers/quality-station.helper";
import { testActorId } from "./fixture-test-user";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}
function section(t: string): void { console.log(`\n── ${t}`); }

const STAMP = `${process.pid}${Date.now().toString(36)}`.slice(-10).toUpperCase(); // kart barkodu normalize edilir
const svc = new KursunQcService();

const created = {
  itemId: "" as string,
  stationIds: [] as string[],
  woIds: [] as string[],
  rollIds: [] as string[],
};

let woSeq = 0;

async function makeStation(suffix: string, name: string, kind: StationKind): Promise<{ id: string; code: string }> {
  const code = `TEST-KQD2-${suffix}-${STAMP}`.slice(0, 32);
  const st = await prisma.station.create({
    data: {
      code, name: `${name} ${STAMP}`, type: "INTERNAL", kind, department: "KALITE",
      // Ham prisma doğuşu: servisin tür varsayılanı koşmaz (KQ-D1) — açık yaz.
      inspectionEnabled: inspectionDefaultForKind(kind),
    },
    select: { id: true, code: true },
  });
  created.stationIds.push(st.id);
  return st;
}

interface Wo {
  woId: string;
  card: string;
  steps: string[]; // stepSequence sırasıyla
  rollIds: string[];
}

/**
 * `route`: istasyon kimlikleri sırayla; `statuses`: adım durumları;
 * `rollsAt`: topların bulunduğu adım indeksi (null → topsuz).
 */
async function makeWo(
  route: string[],
  statuses: StepStatus[],
  rollsAt: number | null,
  rollCount = 2,
): Promise<Wo> {
  const number = `TEST-KQD2-${STAMP}-${++woSeq}`;
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: number,
      type: "STOCK_PRODUCTION",
      status: WorkOrderStatus.IN_PROGRESS,
      targetItemId: created.itemId,
      steps: {
        create: route.map((stationId, i) => ({ stationId, stepSequence: i + 1, status: statuses[i] })),
      },
    },
    select: { id: true, steps: { select: { id: true, stepSequence: true }, orderBy: { stepSequence: "asc" } } },
  });
  created.woIds.push(wo.id);
  await prisma.travelerCard.create({
    data: { cardNumber: number, barcode: number, workOrderId: wo.id, status: TravelerCardStatus.ACTIVE },
  });
  const steps = wo.steps.map((s) => s.id);
  const rollIds: string[] = [];
  if (rollsAt !== null) {
    for (let i = 0; i < rollCount; i++) {
      const roll = await prisma.roll.create({
        data: {
          barcode: null, itemId: created.itemId, initialQty: 100, currentQty: 100,
          status: RollStatus.IN_PRODUCTION, currentStepId: steps[rollsAt],
          entrySource: "SUBCONTRACTOR_RETURN", form: RollForm.ACIK,
        },
        select: { id: true },
      });
      created.rollIds.push(roll.id);
      rollIds.push(roll.id);
      await prisma.rollMovement.create({ data: { rollId: roll.id, workOrderStepId: steps[rollsAt], qtyIn: 100 } });
    }
  }
  return { woId: wo.id, card: number, steps, rollIds };
}

/** Okut → her topu KK2 tamamla → adımı kapat (tabletin yazma zinciri). */
async function runStep(card: string, stationId: string, actorId: string): Promise<{ stepId: string; rolls: number; moved: number }> {
  const sum = await svc.getByCardBarcode(card, stationId);
  for (const r of sum.data.rolls) {
    await svc.completeQc2({ rollId: r.rollId, stepId: sum.data.workOrderStepId }, actorId);
  }
  const fin = await svc.finishStep({ stepId: sum.data.workOrderStepId }, actorId);
  return { stepId: sum.data.workOrderStepId, rolls: sum.data.rolls.length, moved: fin.data.movedRollCount };
}

async function openCardSteps(stationId: string | null, woIds: string[]): Promise<Map<string, { stepId: string; card: string; stationCode: string }>> {
  const res = await svc.listOpenCards(stationId);
  const m = new Map<string, { stepId: string; card: string; stationCode: string }>();
  for (const c of res.data) {
    if (woIds.includes(c.workOrderId)) m.set(c.workOrderId, { stepId: c.stepId, card: c.cardBarcode, stationCode: c.stationCode });
  }
  return m;
}

/** ⭐ Liste ↔ kabul: listede görünen kart aynı oturumla okutulunca aynı adımı açar. */
async function listMatchesScan(label: string, stationId: string, woIds: string[]): Promise<void> {
  const listed = await openCardSteps(stationId, woIds);
  const mismatch: string[] = [];
  for (const [woId, c] of listed) {
    const sum = await svc.getByCardBarcode(c.card, stationId);
    if (sum.data.workOrderStepId !== c.stepId) mismatch.push(`${woId.slice(0, 8)}: liste ${c.stepId.slice(0, 8)} ≠ okutma ${sum.data.workOrderStepId.slice(0, 8)}`);
  }
  check(label, listed.size > 0 && mismatch.length === 0, mismatch.join(" · ") || `${listed.size} kart`);
}

async function main(): Promise<void> {
  const actorId = await testActorId();
  const item = await prisma.item.create({
    data: { code: `TEST-KQD2-${STAMP}`, name: `TEST KQD2 kumaş ${STAMP}`, itemType: "FABRIC" },
    select: { id: true },
  });
  created.itemId = item.id;
  const K = await makeStation("K", "TEST Kurşun", StationKind.PROCESS_QC);
  const Q = await makeStation("Q", "TEST KK", StationKind.PROCESS_QC);
  const T = await makeStation("T", "TEST Tambur", StationKind.TAMBUR);
  const X = await makeStation("X", "TEST Rota Dışı KK", StationKind.PROCESS_QC);
  check("fikstür: dört istasyon kuruldu (Kurşun/KK/Tambur/rota dışı)", created.stationIds.length === 4);

  const P = StepStatus.PENDING, A = StepStatus.ACTIVE, C = StepStatus.COMPLETED;
  // A: Kurşun→KK→Tambur, toplar kurşunda (uçtan uca zincirin iş emri)
  const woA = await makeWo([K.id, Q.id, T.id], [A, P, P], 0);
  // B: aynı rota, toplar kurşunda (liste süzmesinin karşı örneği)
  const woB = await makeWo([K.id, Q.id, T.id], [A, P, P], 0, 1);
  const own = [woA.woId, woB.woId];

  // ───────────────────────────────────────────────────────────────────────────
  section("§2 Kurşun oturumu, toplar kurşundayken → kurşun adımı");
  const r2 = await resolveWoStepForStation(woA.woId, K.id);
  check("§2 ⭐ Kurşun oturumu kurşun adımını çözer (SESSION)", r2.stepId === woA.steps[0] && r2.mode === "SESSION", r2.mode);
  const s2 = await svc.getByCardBarcode(woA.card, K.id);
  check("§2 özet: kurşun adımı + 2 açık top", s2.data.workOrderStepId === woA.steps[0] && s2.data.rolls.length === 2,
    `${s2.data.rolls.length} top`);

  section("§1a KK oturumu, toplar henüz kurşundayken → tamamlanmamış KK adımı (boş özet)");
  const r1a = await resolveWoStepForStation(woA.woId, Q.id);
  check("§1a ⭐ KK oturumu kurşun adımına DÜŞMEZ — KK adımı (SESSION)", r1a.stepId === woA.steps[1] && r1a.mode === "SESSION", r1a.mode);
  const s1a = await svc.getByCardBarcode(woA.card, Q.id);
  check("§1a özet: KK adımı, bekleyen top yok, durum COMPLETED değil",
    s1a.data.workOrderStepId === woA.steps[1] && s1a.data.rolls.length === 0 && s1a.data.status !== C, s1a.data.status);

  section("§3 Oturumsuz → bugünkü davranış (ilk akış adımı)");
  const r3 = await resolveWoStepForStation(woA.woId, null);
  check("§3 ⭐ oturumsuz çağrı ilk akış adımını döner (LEGACY)", r3.stepId === woA.steps[0] && r3.mode === "LEGACY", r3.mode);
  const s3 = await svc.getByCardBarcode(woA.card);
  check("§3 servis varsayılanı (stationId verilmez) = ilk akış adımı", s3.data.workOrderStepId === woA.steps[0]);

  section("§4 Rotada akış adımı olmayan istasyonun oturumu → LEGACY");
  const r4x = await resolveWoStepForStation(woA.woId, X.id);
  check("§4 ⭐ rota dışı KK oturumu = oturumsuz sonuç (LEGACY)", r4x.stepId === r3.stepId && r4x.mode === "LEGACY", r4x.mode);
  const r4t = await resolveWoStepForStation(woA.woId, T.id);
  check("§4 rotadaki Tambur (akış adımı değil) oturumu = LEGACY", r4t.stepId === r3.stepId && r4t.mode === "LEGACY", r4t.mode);

  section("§5a Açık kartlar istasyona göre süzülür (toplar kurşunda)");
  const l5K = await openCardSteps(K.id, own);
  const l5Q = await openCardSteps(Q.id, own);
  const l5N = await openCardSteps(null, own);
  check("§5a listOpenCards(Kurşun) iki kartı kurşun adımıyla döner",
    l5K.get(woA.woId)?.stepId === woA.steps[0] && l5K.get(woB.woId)?.stepId === woB.steps[0], `${l5K.size} kart`);
  check("§5a ⭐ listOpenCards(KK) kurşundaki kartları GÖSTERMEZ", l5Q.size === 0, `${l5Q.size} kart`);
  check("§5a listOpenCards(null) hepsini döner (bugünkü)", l5N.size === 2, `${l5N.size} kart`);
  const yabanci = (await svc.listOpenCards(Q.id)).data.filter((c) => c.stationCode !== Q.code);
  check("§5a listOpenCards(KK) yalnız KK istasyonunun adımlarını taşır", yabanci.length === 0, `${yabanci.length} yabancı`);
  await listMatchesScan("§5a ⭐ liste ↔ okutma: Kurşun listesindeki her kart Kurşun oturumunda aynı adımı açar", K.id, own);

  // ───────────────────────────────────────────────────────────────────────────
  section("§8a Uçtan uca: Kurşun tableti okut → KK2 tamamla → adımı kapat");
  const e1 = await runStep(woA.card, K.id, actorId);
  check("§8a kurşun adımı okutuldu, 2 top tamamlandı, 2 top taşındı",
    e1.stepId === woA.steps[0] && e1.rolls === 2 && e1.moved === 2, `${e1.rolls}/${e1.moved}`);
  const rollsNow = await prisma.roll.findMany({ where: { id: { in: woA.rollIds } }, select: { currentStepId: true } });
  check("§8a toplar KK adımında", rollsNow.every((r) => r.currentStepId === woA.steps[1]));

  section("§1 KK oturumu, toplar KK'deyken → KK adımı");
  const r1 = await resolveWoStepForStation(woA.woId, Q.id);
  check("§1 ⭐ KK oturumu KK adımını çözer (SESSION)", r1.stepId === woA.steps[1] && r1.mode === "SESSION", r1.mode);
  const s1 = await svc.getByCardBarcode(woA.card, Q.id);
  check("§1 özet: KK adımı + 2 açık top", s1.data.workOrderStepId === woA.steps[1] && s1.data.rolls.length === 2,
    `${s1.data.rolls.length} top`);
  const s3b = await svc.getByCardBarcode(woA.card, null);
  check("§3b oturumsuz: ilk akış adımı COMPLETED → onun özeti (bugünkü reopen akışı)",
    s3b.data.workOrderStepId === woA.steps[0] && s3b.data.status === C, s3b.data.status);

  section("§5b Toplar KK'ye geçince liste ayrışır");
  const l5bQ = await openCardSteps(Q.id, own);
  const l5bK = await openCardSteps(K.id, own);
  const l5bN = await openCardSteps(null, own);
  check("§5b ⭐ listOpenCards(KK) yalnız A'nın KK adımı", l5bQ.size === 1 && l5bQ.get(woA.woId)?.stepId === woA.steps[1],
    `${l5bQ.size} kart`);
  check("§5b listOpenCards(Kurşun) yalnız B'nin kurşun adımı", l5bK.size === 1 && l5bK.get(woB.woId)?.stepId === woB.steps[0],
    `${l5bK.size} kart`);
  check("§5b listOpenCards(null) ikisini de döner", l5bN.size === 2, `${l5bN.size} kart`);
  await listMatchesScan("§5b ⭐ liste ↔ okutma: KK listesindeki her kart KK oturumunda aynı adımı açar", Q.id, own);

  section("§8b Uçtan uca: KK tableti okut → KK2 tamamla → adımı kapat (Tambur'a)");
  const e2 = await runStep(woA.card, Q.id, actorId);
  check("§8b ⭐ KK adımı okutuldu, 2 top tamamlandı, Tambur'a taşındı",
    e2.stepId === woA.steps[1] && e2.rolls === 2 && e2.moved === 2, `${e2.rolls}/${e2.moved}`);
  const rollsT = await prisma.roll.findMany({ where: { id: { in: woA.rollIds } }, select: { currentStepId: true } });
  check("§8b toplar Tambur adımında", rollsT.every((r) => r.currentStepId === woA.steps[2]));

  section("§7 Oturumun adımları COMPLETED → son adımın özeti (yeniden açma)");
  const s7 = await svc.getByCardBarcode(woA.card, Q.id);
  check("§7 ⭐ KK oturumu kapanmış KK adımının özetini alır (COMPLETED, 0 top)",
    s7.data.workOrderStepId === woA.steps[1] && s7.data.status === C && s7.data.rolls.length === 0, s7.data.status);
  const woD = await makeWo([K.id, Q.id, K.id, T.id], [C, C, C, P], null);
  const r7 = await resolveWoStepForStation(woD.woId, K.id);
  check("§7 ⭐ iki kurşun adımı da COMPLETED → SON kurşun adımı (SESSION)", r7.stepId === woD.steps[2] && r7.mode === "SESSION",
    r7.mode);

  section("§6 Aynı istasyona iki kez uğrayan rota (Kurşun→KK→Kurşun)");
  const woC3 = await makeWo([K.id, Q.id, K.id, T.id], [C, C, A, P], 2);
  const r6a = await resolveWoStepForStation(woC3.woId, K.id);
  check("§6 ⭐ toplar 2. kurşun adımında → 2. kurşun adımı", r6a.stepId === woC3.steps[2] && r6a.mode === "SESSION", r6a.mode);
  const woC1 = await makeWo([K.id, Q.id, K.id, T.id], [A, P, P, P], 0);
  const r6b = await resolveWoStepForStation(woC1.woId, K.id);
  check("§6 toplar 1. kurşun adımında → 1. kurşun adımı", r6b.stepId === woC1.steps[0], r6b.mode);
  const woC2 = await makeWo([K.id, Q.id, K.id, T.id], [C, A, P, P], 1);
  const r6c = await resolveWoStepForStation(woC2.woId, K.id);
  check("§6 ⭐ toplar KK'de, 1. kurşun kapalı → tamamlanmamış ilk kurşun adımı (2.)",
    r6c.stepId === woC2.steps[2] && r6c.mode === "SESSION", r6c.mode);
  const r6n = await resolveWoStepForStation(woC3.woId, null);
  check("§6 oturumsuz aynı rota → ilk akış adımı (COMPLETED, bugünkü)", r6n.stepId === woC3.steps[0] && r6n.mode === "LEGACY");

  section("§3c LEGACY metinleri bugünkü gibi");
  const woE = await makeWo([K.id, Q.id, T.id], [A, P, P], 1, 1);
  let msg = "";
  try { await resolveWoStepForStation(woE.woId, null); } catch (e) { msg = (e as Error).message; }
  check("§3c toplar başka adımdayken oturumsuz okutma 400 'Mevcut konum' metni",
    /Mevcut konum: .*TEST KK/.test(msg), msg.slice(0, 90));
}

async function teardown(): Promise<void> {
  const { woIds, rollIds, stationIds, itemId } = created;
  const adimlar: Array<[string, () => Promise<unknown>]> = [
    ["rollOperation", () => prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } })],
    ["rollProperty", () => prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } })],
    ["rollMovement", () => prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } })],
    ["roll", () => prisma.roll.deleteMany({ where: { id: { in: rollIds } } })],
    ["travelerCard", () => prisma.travelerCard.deleteMany({ where: { workOrderId: { in: woIds } } })],
    ["workOrderStep", () => prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } })],
    ["workOrder", () => prisma.workOrder.deleteMany({ where: { id: { in: woIds } } })],
    ["systemLog", () => prisma.systemLog.deleteMany({ where: { recordId: { in: [...woIds, ...rollIds] } } })],
    ["station", () => prisma.station.deleteMany({ where: { id: { in: stationIds } } })],
    ["item", () => (itemId ? prisma.item.deleteMany({ where: { id: itemId } }) : Promise.resolve())],
  ];
  for (const [ad, sil] of adimlar) {
    try { await sil(); } catch (e) { console.log(`   ⚠️ temizlik ${ad}: ${(e as Error).message.split("\n")[0]}`); }
  }
}

(async () => {
  console.log("=== Kart okutmada adım oturum istasyonundan (KQ-D2) ===");
  try {
    await main();
  } catch (e) {
    fail++;
    console.error("HATA:", e instanceof Error ? (e.stack ?? e.message) : e);
  } finally {
    await teardown();
  }
  if (pass + fail === 0) { fail++; console.log("❌ hiçbir kontrol koşmadı"); }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exitCode = fail > 0 ? 1 : 0;
  await prisma.$disconnect();
  await pool.end();
})();
