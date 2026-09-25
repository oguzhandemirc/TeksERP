// =============================================================================
// Test: İşlem Dökümü (cihaz + kullanıcı ayak izi) — WorkSessionActivityService +
//       history(deviceId|userId) + DeviceService.detail + getUserById
// Çalıştır: npx tsx scripts/test_device_activity.ts
// Doğrulananlar:
//   1. Pencere içi + oturum makinesine damgalı op → MACHINE
//   2. Pencere içi + machineId NULL + operatör=oturum kullanıcısı → OPERATOR_WINDOW
//   3-4-5. Pencere DIŞI / BAŞKA makine / inherited kopya → listelenmez
//   6. Makinesiz (SHIPPING) oturum: yalnız damgasız+operatör op görünür
//   7. Movement iki-olay: giriş A'da MOVE_IN, çıkış B'de MOVE_OUT (B makinesi);
//      machineId'siz kapanış → MOVE_OUT OPERATOR_WINDOW
//   8. Canlı oturum (endedAt NULL): pencere sonu now, taze olay
//   9. KRONOLOJİK SIRA + FAZ-RANK: MOVE_IN < ERROR < KURSUN < QC2 (aynı at!) < MOVE_OUT
//  10. RollError olay kaynağı: pencere+operatör → ERROR (metre+tür); pencere dışı /
//      başka operatör → yok
//  11. summary doğru + truncated=false; 11b-c ROLL_CREATED (KK1 kumaş girişi):
//      pencere+makine/operatör → görünür (metre+kaynak+MACHINE); pencere dışı/başka → yok
//  11d-e. ROLL_CANCELLED (top durum defterinden iptal): doğru top+operatör, başka
//      operatör/iptal-değil hariç; aynı top için giriş+iptal iki ayrı kronolojik satır
//  11f. GERÇEK iptal (status UPDATE → DB trigger'ı defter satırı yazar) canlı oturumda görünür
//  12. history({deviceId}) yalnız o cihazın; history({userId}) kullanıcının TÜM
//      cihazlardaki oturumları (başka kullanıcı hariç)
//  13. DeviceService.detail: hardware dedup + etiket medyası + lastSession
//  14. getUserById: kimlik + yetki sayısı + son oturum (cihaz/yer); yok → 404
//  15. Geçersiz sessionId → 404
// İzolasyon: dedicated TEST kullanıcıları + makineler — dev verisi atıf dallarına karışamaz.
// =============================================================================
import prisma from "../src/lib/prisma";
import { roleGrade } from "./fixture-quality-grade";
import { WorkSessionService } from "../src/services/work-session.service";
import { WorkSessionActivityService } from "../src/services/work-session-activity.service";
import type { SessionActivityEvent } from "../src/services/work-session-activity.service";
import { DeviceService } from "../src/services/device.service";
import { PermissionManagementService } from "../src/services/permission-management.service";
import { WorkOrderStatus, RollStatus, StationKind } from "@prisma/client";
import type { RollOperationType } from "@prisma/client";

let pass = 0,
  fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}
async function expectErr(label: string, part: string, fn: () => Promise<unknown>) {
  try { await fn(); check(label, false, "hata bekleniyordu"); }
  catch (e) { const m = e instanceof Error ? e.message : String(e); check(label, m.includes(part), m); }
}
function need<T>(v: T | null | undefined, what: string): T {
  if (v == null) throw new Error(`Fixture bulunamadı: ${what}`);
  return v;
}

const min = (n: number) => n * 60_000;
const key = (e: SessionActivityEvent) => `${e.kind}:${e.id}`;

async function main() {
  const ts = Date.now();
  const item = need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "PATOS");
  // Kalite ROLDEN (karar ①): fabrikanın kodu bekçiye çakılı olmasın.
  const grade = await roleGrade("FIRST");
  const tamburStation = need(
    await prisma.station.findFirst({ where: { kind: StationKind.TAMBUR, isActive: true }, select: { id: true } }),
    "TAMBUR istasyonu",
  );
  const sevkStation = need(
    await prisma.station.findFirst({ where: { code: "SEVK_1", isActive: true }, select: { id: true } }),
    "SEVK_1",
  );

  // --- İzole fixture: 2 test kullanıcısı + 2 test makinesi + 2 cihaz ---
  const user = await prisma.user.create({
    data: { username: `test-devact-${ts}`, passwordHash: "x", fullName: "TEST İşlem Döküm" },
    select: { id: true },
  });
  const user2 = await prisma.user.create({
    data: { username: `test-devact2-${ts}`, passwordHash: "x", fullName: "TEST İşlem Döküm 2" },
    select: { id: true },
  });
  const machineA = await prisma.machine.create({
    data: { stationId: tamburStation.id, code: `TEST-DEVACT-A-${ts}`, name: "TEST Döküm Makine A" },
    select: { id: true },
  });
  const machineB = await prisma.machine.create({
    data: { stationId: tamburStation.id, code: `TEST-DEVACT-B-${ts}`, name: "TEST Döküm Makine B" },
    select: { id: true },
  });
  // Devralma senaryolarına adanmış izole makineler (12a/12b sayımlarına karışmasın).
  const machineC = await prisma.machine.create({
    data: { stationId: tamburStation.id, code: `TEST-DEVACT-C-${ts}`, name: "TEST Döküm Makine C" },
    select: { id: true },
  });
  const machineD = await prisma.machine.create({
    data: { stationId: tamburStation.id, code: `TEST-DEVACT-D-${ts}`, name: "TEST Döküm Makine D" },
    select: { id: true },
  });
  const device = await prisma.device.create({
    data: { deviceId: `test-devact-${ts}-1`, name: "TEST Döküm Tablet", status: "APPROVED", kind: "TABLET" },
    select: { id: true },
  });
  const device2 = await prisma.device.create({
    data: { deviceId: `test-devact-${ts}-2`, name: "TEST Döküm Tablet 2", status: "APPROVED", kind: "PHONE" },
    select: { id: true },
  });
  // Devralma senaryosu — eski/yeni oturum farklı cihazlarda, aynı makinede.
  const device3 = await prisma.device.create({
    data: { deviceId: `test-devact-${ts}-3`, name: "TEST Devralan Eski", status: "APPROVED", kind: "TABLET" },
    select: { id: true },
  });
  const device4 = await prisma.device.create({
    data: { deviceId: `test-devact-${ts}-4`, name: "TEST Devralan Yeni", status: "APPROVED", kind: "TABLET" },
    select: { id: true },
  });
  const device5 = await prisma.device.create({
    data: { deviceId: `test-devact-${ts}-5`, name: "TEST NL Cihaz", status: "APPROVED", kind: "TABLET" },
    select: { id: true },
  });
  const device6 = await prisma.device.create({
    data: { deviceId: `test-devact-${ts}-6`, name: "TEST Churn B", status: "APPROVED", kind: "TABLET" },
    select: { id: true },
  });

  const rollIds: string[] = [];
  const woIds: string[] = [];
  const sessionIds: string[] = [];
  const peripheralIds: string[] = [];

  const now = new Date();
  const base = new Date(now.getTime() - min(240));
  const at = (m: number) => new Date(base.getTime() + min(m));

  try {
    // --- Oturumlar (doğrudan create — kontrollü pencereler) ---
    const sessionA = await prisma.workSession.create({
      data: { userId: user.id, deviceId: device.id, machineId: machineA.id, stationId: tamburStation.id,
        startedAt: at(0), endedAt: at(60), endReason: "LOGOUT", lastActivityAt: at(60) }, select: { id: true } });
    const sessionB = await prisma.workSession.create({
      data: { userId: user.id, deviceId: device.id, machineId: machineB.id, stationId: tamburStation.id,
        startedAt: at(70), endedAt: at(100), endReason: "LOGOUT", lastActivityAt: at(100) }, select: { id: true } });
    const sessionShip = await prisma.workSession.create({
      data: { userId: user.id, deviceId: device.id, machineId: null, stationId: sevkStation.id,
        startedAt: at(110), endedAt: at(120), endReason: "LOGOUT", lastActivityAt: at(120) }, select: { id: true } });
    const sessionOrder = await prisma.workSession.create({
      data: { userId: user.id, deviceId: device.id, machineId: machineA.id, stationId: tamburStation.id,
        startedAt: at(150), endedAt: at(170), endReason: "LOGOUT", lastActivityAt: at(170) }, select: { id: true } });
    // KK1 kumaş girişi oturumu (top oluşturma kaynağı testi)
    const sessionKK1 = await prisma.workSession.create({
      data: { userId: user.id, deviceId: device.id, machineId: machineA.id, stationId: tamburStation.id,
        startedAt: at(180), endedAt: at(200), endReason: "LOGOUT", lastActivityAt: at(200) }, select: { id: true } });
    const sessionLive = await prisma.workSession.create({
      data: { userId: user.id, deviceId: device.id, machineId: machineA.id, stationId: tamburStation.id,
        startedAt: new Date(now.getTime() - min(10)), endedAt: null,
        lastActivityAt: new Date(now.getTime() - min(1)) }, select: { id: true } });
    sessionIds.push(sessionA.id, sessionB.id, sessionShip.id, sessionOrder.id, sessionKK1.id, sessionLive.id);

    // --- Üretim fixture'ı: WO + step + roll'lar ---
    const wo = await prisma.workOrder.create({
      data: {
        workOrderNumber: `TST-DEVACT-WO-${ts}`,
        type: "STOCK_PRODUCTION", status: WorkOrderStatus.IN_PROGRESS, width: 150, targetItemId: item.id,
        steps: { create: [{ stationId: tamburStation.id, stepSequence: 1, status: "ACTIVE" as const }] },
      },
      include: { steps: true },
    });
    woIds.push(wo.id);
    const stepId = wo.steps[0].id;
    // Fixture roll'leri TÜM oturum pencerelerinden ÖNCE oluşturulur (createdAt=at(-60))
    // → ROLL_CREATED kaynağı bunları hiçbir oturuma karıştırmaz (default now olsaydı
    // sessionLive penceresine düşerdi).
    const mkRoll = async () => {
      const r = await prisma.roll.create({
        data: { barcode: null, itemId: item.id, status: RollStatus.IN_PRODUCTION,
          currentQty: 100, initialQty: 100, width: 150, qualityGrade: grade.code, qualityGradeId: grade.id,
          createdById: user.id, currentStepId: stepId, entrySource: "SUBCONTRACTOR_RETURN",
          createdAt: at(-60) }, select: { id: true } });
      rollIds.push(r.id);
      return r.id;
    };
    const r1 = await mkRoll();
    const r2 = await mkRoll();
    const r3 = await mkRoll();
    const r4 = await mkRoll(); // sıra/hata senaryosu

    const mkOp = (
      rollId: string, operationType: RollOperationType, createdAt: Date,
      machineId: string | null, operatorId: string | null, inheritedFrom: string | null = null,
    ) =>
      prisma.rollOperation.create({
        data: { rollId, workOrderStepId: stepId, operationType, createdAt, machineId, operatorId,
          inheritedFromParentRollId: inheritedFrom, metadata: { totalMeters: 100 } }, select: { id: true } });

    // sessionA (machineA, 0..60)
    const op1 = await mkOp(r1, "TAMBUR_PROCESSED", at(10), machineA.id, null); // MACHINE
    const op2 = await mkOp(r1, "QC2_COMPLETED", at(20), null, user.id); // OPERATOR_WINDOW
    await mkOp(r1, "KURSUN_APPLIED", at(-10), machineA.id, user.id); // pencere dışı
    await mkOp(r1, "SUBCONTRACTOR_SENT", at(15), machineB.id, null); // başka makine
    await mkOp(r2, "TAMBUR_PROCESSED", at(25), machineA.id, null, r1); // inherited kopya
    // SHIPPING (110..120)
    await mkOp(r2, "QC2_COMPLETED", at(115), machineA.id, user.id); // makine damgalı → SHIPPING'de görünmez
    const opShip = await mkOp(r2, "KURSUN_APPLIED", at(115), null, user.id); // fallback → görünür
    // canlı
    const opLive = await mkOp(r3, "TAMBUR_PROCESSED", new Date(now.getTime() - min(5)), machineA.id, null);

    // --- Movement fixture'ları ---
    // çapraz-oturum: giriş A penceresinde, çıkış B penceresinde (B makinesi)
    const mCross = await prisma.rollMovement.create({
      data: { rollId: r1, workOrderStepId: stepId, qtyIn: 100, qtyOut: 95,
        enteredAt: at(30), exitedAt: at(80), operatorId: user.id, machineId: machineB.id }, select: { id: true } });
    // machineId'siz kapanış (A penceresinde giriş+çıkış)
    const mNoMachine = await prisma.rollMovement.create({
      data: { rollId: r2, workOrderStepId: stepId, qtyIn: 50, qtyOut: 50,
        enteredAt: at(35), exitedAt: at(40), operatorId: user.id, machineId: null }, select: { id: true } });

    // --- sessionOrder (machineA, 150..170): kronolojik sıra + faz-rank + hata ---
    // r4: MOVE_IN(151) < ERROR(152) < KURSUN(153) < QC2(153 AYNI) < MOVE_OUT(155)
    const mOrder = await prisma.rollMovement.create({
      data: { rollId: r4, workOrderStepId: stepId, qtyIn: 100, qtyOut: 98,
        enteredAt: at(151), exitedAt: at(155), operatorId: user.id, machineId: machineA.id }, select: { id: true } });
    const errOrder = await prisma.rollError.create({
      data: { rollId: r4, startMeter: 50, errorType: "TEST Delik",
        detectedAtStepId: stepId, detectedByUserId: user.id, detectedAt: at(152) }, select: { id: true } });
    const kursun = await mkOp(r4, "KURSUN_APPLIED", at(153), machineA.id, user.id);
    const qc2 = await mkOp(r4, "QC2_COMPLETED", at(153), machineA.id, user.id); // AYNI createdAt
    // Kapsam dışı hatalar (pencere dışı + başka operatör) — distinct startMeter (unique guard)
    await prisma.rollError.create({
      data: { rollId: r4, startMeter: 60, errorType: "TEST Pencere Dışı",
        detectedAtStepId: stepId, detectedByUserId: user.id, detectedAt: at(210) } });
    await prisma.rollError.create({
      data: { rollId: r4, startMeter: 70, errorType: "TEST Başka Operatör",
        detectedAtStepId: stepId, detectedByUserId: user2.id, detectedAt: at(160) } });

    // --- KK1 kumaş girişi (ROLL_CREATED) — sessionKK1 penceresinde (180..200) ---
    const rollKK1 = await prisma.roll.create({
      data: { barcode: `TEST-KK1-${ts}`,
        itemId: item.id, status: RollStatus.STOCK, currentQty: 120, initialQty: 120, width: 150,
        qualityGrade: grade.code, qualityGradeId: grade.id, entrySource: "SUPPLIER_RECEIPT",
        createdById: user.id, createdMachineId: machineA.id, createdAt: at(185) }, select: { id: true } });
    rollIds.push(rollKK1.id);
    // Pencere dışı giriş (görünmemeli)
    const rollOut = await prisma.roll.create({
      data: { barcode: null, itemId: item.id, status: RollStatus.STOCK, currentQty: 50, initialQty: 50,
        qualityGrade: grade.code, qualityGradeId: grade.id, entrySource: "SUPPLIER_RECEIPT",
        createdById: user.id, createdMachineId: machineA.id, createdAt: at(240) }, select: { id: true } });
    rollIds.push(rollOut.id);
    // Pencere içi ama BAŞKA makine + başka operatör (görünmemeli)
    const rollOther = await prisma.roll.create({
      data: { barcode: null, itemId: item.id, status: RollStatus.STOCK, currentQty: 50, initialQty: 50,
        qualityGrade: grade.code, qualityGradeId: grade.id, entrySource: "SUPPLIER_RECEIPT",
        createdById: user2.id, createdMachineId: machineB.id, createdAt: at(185) }, select: { id: true } });
    rollIds.push(rollOther.id);

    // --- İPTAL defter satırları (ROLL_CANCELLED kaynağı) — sessionKK1 (180..200) ---
    // Geçmiş pencere için satır DOĞRUDAN yazılır (trigger `now()` damgalar); gerçek
    // trigger yolu 11f'de canlı oturumla ölçülür. Satırlar top silinince kaskadla gider.
    const mkIptal = async (actorId: string, toStatus: RollStatus, createdAt: Date) => {
      await prisma.rollStatusEvent.create({
        data: { rollId: rollKK1.id, fromStatus: RollStatus.STOCK, toStatus, actorId, createdAt },
      });
    };
    await mkIptal(user.id, RollStatus.CANCELLED, at(190)); // görünmeli
    await mkIptal(user2.id, RollStatus.CANCELLED, at(191)); // başka operatör → görünmemeli
    await mkIptal(user.id, RollStatus.A1_STOCK, at(192)); // iptal değil → görünmemeli

    // ================= Senaryolar =================
    const list = (id: string) => WorkSessionActivityService.list(id);

    const A = await list(sessionA.id);
    const evA = A.data.events;
    const keysA = new Set(evA.map(key));

    check("1. pencere içi + oturum makinesi damgalı op → MACHINE",
      evA.find((e) => e.id === op1.id)?.attribution === "MACHINE");
    check("2. machineId NULL + operatör eşleşmesi → OPERATOR_WINDOW",
      evA.find((e) => e.id === op2.id)?.attribution === "OPERATOR_WINDOW");
    check("3-4-5. pencere dışı / başka makine / inherited kopya LİSTELENMEZ",
      evA.filter((e) => e.kind === "OPERATION").length === 2,
      `op=${evA.filter((e) => e.kind === "OPERATION").length} (beklenen 2)`);

    const Ship = await list(sessionShip.id);
    const shipOps = Ship.data.events.filter((e) => e.kind === "OPERATION");
    check("6. SHIPPING oturumu: yalnız damgasız+operatör op (OPERATOR_WINDOW)",
      shipOps.length === 1 && shipOps[0].id === opShip.id && shipOps[0].attribution === "OPERATOR_WINDOW",
      `adet=${shipOps.length}`);

    check("7a. çapraz movement: A'da MOVE_IN var, MOVE_OUT yok",
      keysA.has(`MOVE_IN:${mCross.id}`) && !keysA.has(`MOVE_OUT:${mCross.id}`));
    const B = await list(sessionB.id);
    const keysB = new Set(B.data.events.map(key));
    check("7b. çapraz movement: B'de yalnız MOVE_OUT (MACHINE)",
      !keysB.has(`MOVE_IN:${mCross.id}`) &&
        B.data.events.find((e) => e.kind === "MOVE_OUT" && e.id === mCross.id)?.attribution === "MACHINE");
    check("7c. machineId'siz kapanış → MOVE_OUT OPERATOR_WINDOW",
      evA.find((e) => e.kind === "MOVE_OUT" && e.id === mNoMachine.id)?.attribution === "OPERATOR_WINDOW");
    // 7d: kumaş adı (ürün) + MOVE_OUT kaldığı süre (enteredAt→exitedAt)
    const crossOut = B.data.events.find((e) => e.kind === "MOVE_OUT" && e.id === mCross.id);
    check("7d. MOVE_OUT: kumaş(ürün) adı dolu + kaldığı süre (giriş→çıkış = 50 dk)",
      crossOut?.roll.itemName != null && crossOut?.stayMinutes === 50,
      `item=${crossOut?.roll.itemName} stay=${crossOut?.stayMinutes}`);

    const Live = await list(sessionLive.id);
    check("8. canlı oturum (endedAt NULL): taze olay listelenir",
      Live.data.events.some((e) => e.id === opLive.id));

    // 9: kronolojik sıra + faz-rank
    const O = await list(sessionOrder.id);
    const seq = O.data.events.map(key);
    const expected = [
      `MOVE_IN:${mOrder.id}`, `ERROR:${errOrder.id}`,
      `OPERATION:${kursun.id}`, `OPERATION:${qc2.id}`, `MOVE_OUT:${mOrder.id}`,
    ];
    check("9a. tam kronolojik sıra: giriş < hata < kurşun < KK2 < çıkış",
      seq.join("|") === expected.join("|"), seq.join(" > "));
    const iK = O.data.events.findIndex((e) => e.id === kursun.id && e.kind === "OPERATION");
    const iQ = O.data.events.findIndex((e) => e.id === qc2.id && e.kind === "OPERATION");
    check("9b. AYNI createdAt'te KURSUN, QC2'den ÖNCE (faz-rank — UUID'den bağımsız)",
      iK >= 0 && iQ >= 0 && iK < iQ, `kursun@${iK} < qc2@${iQ}`);

    // 10: RollError olay kaynağı
    const errEv = O.data.events.find((e) => e.kind === "ERROR");
    check("10a. RollError ERROR olayı: metre + tür + operatör",
      errEv?.id === errOrder.id && errEv?.errorMeter === 50 && errEv?.errorType === "TEST Delik" &&
        errEv?.attribution === "OPERATOR_WINDOW" && errEv?.operator?.id === user.id);
    check("10b. pencere dışı + başka operatör hataları LİSTELENMEZ (yalnız 1 ERROR)",
      O.data.events.filter((e) => e.kind === "ERROR").length === 1);

    // 11: summary + truncated
    const s = O.data.summary;
    check("11. summary (1 giriş · 1 hata · 2 işlem · 1 çıkış) + truncated=false",
      s.moveInCount === 1 && s.errorCount === 1 && s.operationCount === 2 && s.moveOutCount === 1 &&
        s.rollCreatedCount === 0 && O.truncated === false,
      `in=${s.moveInCount} err=${s.errorCount} op=${s.operationCount} out=${s.moveOutCount} trunc=${O.truncated}`);

    // 11b: ROLL_CREATED — KK1 kumaş girişi olay kaynağı
    const KK1 = await list(sessionKK1.id);
    const rollEvents = KK1.data.events.filter((e) => e.kind === "ROLL_CREATED");
    const kk1Ev = rollEvents.find((e) => e.id === rollKK1.id);
    check("11b. KK1 kumaş girişi ROLL_CREATED: metre + kaynak + MACHINE atfı",
      rollEvents.length === 1 && kk1Ev?.qty === 120 && kk1Ev?.entrySource === "SUPPLIER_RECEIPT" &&
        kk1Ev?.attribution === "MACHINE" && kk1Ev?.roll.id === rollKK1.id,
      `adet=${rollEvents.length}`);
    check("11c. pencere dışı + başka makine/operatör girişleri LİSTELENMEZ",
      !KK1.data.events.some((e) => e.id === rollOut.id || e.id === rollOther.id) &&
        KK1.data.summary.rollCreatedCount === 1);
    // 11d: ROLL_CANCELLED — iptal olayı ayrı satır (top durum defterinden)
    const kk1Cancel = KK1.data.events.filter((e) => e.kind === "ROLL_CANCELLED");
    check("11d. iptal olayı ROLL_CANCELLED: doğru top (barkod+kumaş adı) + operatör; başka operatör/iptal-değil hariç (1 adet)",
      kk1Cancel.length === 1 && kk1Cancel[0].roll.id === rollKK1.id &&
        kk1Cancel[0].roll.barcode != null && kk1Cancel[0].roll.itemName != null &&
        kk1Cancel[0].operator?.id === user.id &&
        kk1Cancel[0].attribution === "OPERATOR_WINDOW" && KK1.data.summary.rollCancelledCount === 1,
      `iptal=${kk1Cancel.length} item=${kk1Cancel[0]?.roll.itemName}`);
    // 11e: aynı topun "girişi" ve "iptali" iki ayrı satır, kronolojik (giriş < iptal)
    const kk1Seq = KK1.data.events.filter((e) => e.roll.id === rollKK1.id).map((e) => e.kind);
    check("11e. aynı top: önce ROLL_CREATED sonra ROLL_CANCELLED (kronolojik iki olay)",
      kk1Seq.join(">") === "ROLL_CREATED>ROLL_CANCELLED", kk1Seq.join(">"));

    // 11f: GERÇEK iptal — status UPDATE'i trigger'la defter satırı doğurur, aktör
    // `cancelledById`; canlı oturumun penceresinde (şimdi) görünür.
    const rollLive = await prisma.roll.create({
      data: { barcode: `TEST-LIVE-${ts}`, itemId: item.id, status: RollStatus.STOCK, currentQty: 10, initialQty: 10,
        qualityGrade: grade.code, qualityGradeId: grade.id, entrySource: "SUPPLIER_RECEIPT", createdById: user2.id },
      select: { id: true } });
    rollIds.push(rollLive.id);
    await prisma.roll.update({
      where: { id: rollLive.id },
      data: { status: RollStatus.CANCELLED, cancelledAt: new Date(), cancelledById: user.id },
    });
    const LiveCancel = (await list(sessionLive.id)).data.events.filter(
      (e) => e.kind === "ROLL_CANCELLED" && e.roll.id === rollLive.id);
    check("11f. GERÇEK iptal (trigger'ın yazdığı defter satırı) canlı oturumda ROLL_CANCELLED + operatör",
      LiveCancel.length === 1 && LiveCancel[0].operator?.id === user.id, `adet=${LiveCancel.length}`);

    // 12: history filtreleri (cihaz + kullanıcı ayak izi)
    const otherUserSession = await prisma.workSession.create({
      data: { userId: user2.id, deviceId: device2.id, machineId: null, stationId: sevkStation.id,
        startedAt: at(130), endedAt: at(140), endReason: "LOGOUT", lastActivityAt: at(140) }, select: { id: true } });
    const userOtherDeviceSession = await prisma.workSession.create({
      data: { userId: user.id, deviceId: device2.id, machineId: null, stationId: sevkStation.id,
        startedAt: at(135), endedAt: at(145), endReason: "LOGOUT", lastActivityAt: at(145) }, select: { id: true } });
    sessionIds.push(otherUserSession.id, userOtherDeviceSession.id);

    const byDevice = await WorkSessionService.history({ deviceId: device.id, pageSize: 100 });
    const devIds = new Set((byDevice.data as Array<{ id: string }>).map((x) => x.id));
    check("12a. history({deviceId}): yalnız o cihazın 6 oturumu",
      devIds.size === 6 &&
        [sessionA, sessionB, sessionShip, sessionOrder, sessionKK1, sessionLive].every((x) => devIds.has(x.id)) &&
        !devIds.has(userOtherDeviceSession.id),
      `adet=${devIds.size}`);

    const byUser = await WorkSessionService.history({ userId: user.id, pageSize: 100 });
    const usrIds = new Set((byUser.data as Array<{ id: string }>).map((x) => x.id));
    check("12b. history({userId}): kullanıcının TÜM cihazlardaki 7 oturumu, başka kullanıcı hariç",
      usrIds.size === 7 && usrIds.has(userOtherDeviceSession.id) && !usrIds.has(otherUserSession.id),
      `adet=${usrIds.size}`);

    // 12c: DEVRALMA — eski oturum (device3, machineC, TAKEOVER at(55)) → aynı makinede
    // hemen sonra açılan yeni oturum (device4) "devralan" olarak history'ye bağlanır.
    const takeOld = await prisma.workSession.create({
      data: { userId: user2.id, deviceId: device3.id, machineId: machineC.id, stationId: tamburStation.id,
        startedAt: at(50), endedAt: at(55), endReason: "TAKEOVER", lastActivityAt: at(55) }, select: { id: true } });
    // takeNew, takeOld.endedAt'ten 250 ms SONRA başlar → ±5s tolerans dalı gerçekten sınanır.
    const takeNew = await prisma.workSession.create({
      data: { userId: user2.id, deviceId: device4.id, machineId: machineC.id, stationId: tamburStation.id,
        startedAt: new Date(at(55).getTime() + 250), endedAt: at(75), endReason: "LOGOUT",
        lastActivityAt: at(75) }, select: { id: true } });
    sessionIds.push(takeOld.id, takeNew.id);
    type Row = { id: string; successor: { id: string; device: { name: string }; user: { fullName: string } } | null };
    const byMachineC = await WorkSessionService.history({ machineId: machineC.id, pageSize: 100 });
    const oldRow = (byMachineC.data as Row[]).find((x) => x.id === takeOld.id);
    const newRow = (byMachineC.data as Row[]).find((x) => x.id === takeNew.id);
    check("12c. TAKEOVER → 'devralan' ardıl bağlandı (250ms tolerans; device4/user2)",
      oldRow?.successor?.id === takeNew.id &&
        oldRow?.successor?.device.name === "TEST Devralan Yeni" &&
        oldRow?.successor?.user.fullName === "TEST İşlem Döküm 2",
      `successor=${oldRow?.successor?.device.name}`);
    check("12d. LOGOUT/normal biten oturumda successor=null",
      newRow?.successor === null);

    // 12e: NEW_LOGIN — successor aynı CİHAZDA (device5), FARKLI makinede (deviceId dalı;
    // machineId'ye bakan kopya-yapıştır hatası burada başarısız olurdu).
    const nlOld = await prisma.workSession.create({
      data: { userId: user2.id, deviceId: device5.id, machineId: machineC.id, stationId: tamburStation.id,
        startedAt: at(85), endedAt: at(90), endReason: "NEW_LOGIN", lastActivityAt: at(90) }, select: { id: true } });
    const nlNew = await prisma.workSession.create({
      data: { userId: user.id, deviceId: device5.id, machineId: machineB.id, stationId: tamburStation.id,
        startedAt: new Date(at(90).getTime() + 250), endedAt: at(95), endReason: "LOGOUT",
        lastActivityAt: at(95) }, select: { id: true } });
    sessionIds.push(nlOld.id, nlNew.id);
    const byDevice5 = await WorkSessionService.history({ deviceId: device5.id, pageSize: 100 });
    const nlOldRow = (byDevice5.data as Row[]).find((x) => x.id === nlOld.id);
    check("12e. NEW_LOGIN → successor aynı cihazda sonraki oturum (deviceId dalı, farklı makine)",
      nlOldRow?.successor?.id === nlNew.id && nlOldRow?.successor?.user.fullName === "TEST İşlem Döküm",
      `successor=${nlOldRow?.successor?.id === nlNew.id}`);

    // 12f: HIZLI CHURN (major düzeltmenin kanıtı) — P→A→B, hepsi machineD'de ~saniyeler
    // içinde. A'nın devralanı B olmalı; ÖNCEKİ oturum P de A'nın ±5s penceresine
    // girer ama "en yakın" seçim P'yi değil B'yi (fark≈0) seçmeli.
    const T = at(200);
    const sec = (n: number) => new Date(T.getTime() + n * 1000);
    const churnP = await prisma.workSession.create({
      data: { userId: user2.id, deviceId: device3.id, machineId: machineD.id, stationId: tamburStation.id,
        startedAt: T, endedAt: sec(2), endReason: "TAKEOVER", lastActivityAt: sec(2) }, select: { id: true } });
    const churnA = await prisma.workSession.create({
      data: { userId: user2.id, deviceId: device4.id, machineId: machineD.id, stationId: tamburStation.id,
        startedAt: sec(2), endedAt: sec(4), endReason: "TAKEOVER", lastActivityAt: sec(4) }, select: { id: true } });
    const churnB = await prisma.workSession.create({
      data: { userId: user2.id, deviceId: device6.id, machineId: machineD.id, stationId: tamburStation.id,
        startedAt: sec(4), endedAt: sec(10), endReason: "LOGOUT", lastActivityAt: sec(10) }, select: { id: true } });
    sessionIds.push(churnP.id, churnA.id, churnB.id);
    const byMachineD = await WorkSessionService.history({ machineId: machineD.id, pageSize: 100 });
    const churnARow = (byMachineD.data as Row[]).find((x) => x.id === churnA.id);
    check("12f. hızlı churn: A'nın devralanı = B (en yakın), ÖNCEKİ oturum P değil",
      churnARow?.successor?.id === churnB.id && churnARow?.successor?.id !== churnP.id,
      `successor=${churnARow?.successor?.device.name} (beklenen 'TEST Churn B')`);

    // 13: cihaz detayı — donanım dedup + etiket medyası (cihazda) + lastSession
    const noSess = await DeviceService.detail(device2.id);
    check("13a. cihaz detay lastSession dolu (device2'de oturum var)", noSess.lastSession !== null);
    const printer = await prisma.peripheralDevice.create({
      data: { code: `TEST-DEVACT-PRN-${ts}`, name: "TEST Döküm Yazıcı", kind: "LABEL_PRINTER",
        connectionType: "BLUETOOTH_SPP", address: "00:11:22:33:44:55", languageOverride: "PPLA",
        deviceId: device.id, labelWidthMm: 100, labelHeightMm: 148, labelDpi: 203 }, select: { id: true } });
    peripheralIds.push(printer.id);
    await prisma.devicePeripheral.create({ data: { deviceId: device.id, peripheralId: printer.id } });
    const detail = await DeviceService.detail(device.id);
    check("13b. hardware dedup (legacy + M:N → 1) + medya dolu (100×148)",
      detail.hardware.length === 1 && Number(detail.hardware[0].labelWidthMm) === 100 && Number(detail.hardware[0].labelHeightMm) === 148,
      `adet=${detail.hardware.length}`);
    // ⚠️ `user` artık NULLABLE tipte: `detail` aktörü `maskSystemActor`tan
    // geçiriyor (satıcı hesabının giriş adı Cihazlar ekranında ham basılıyordu).
    // `WorkSession.userId` NOT NULL olduğu için değer pratikte hep dolu; kontrol
    // `?.` ile yazılır ve null gelirse yine KIRMIZI verir.
    check("13c. cihaz lastSession = en son oturum (canlı)",
      detail.lastSession?.id === sessionLive.id && detail.lastSession?.user?.id === user.id);

    // 14: getUserById — kullanıcı ayak izi başlığı
    const ud = await PermissionManagementService.getUserById(user.id);
    check("14a. getUserById: kimlik + _count.permissions + son oturum (cihaz/yer)",
      ud.id === user.id && typeof ud._count.permissions === "number" &&
        ud.lastSession?.id === sessionLive.id && ud.lastSession?.device.id === device.id &&
        ud.lastSession?.station.id === tamburStation.id);
    await expectErr("14b. getUserById(yok) → 404", "bulunamadı", () =>
      PermissionManagementService.getUserById("00000000-0000-4000-8000-000000000000"));

    // 15: geçersiz oturum → 404
    await expectErr("15. geçersiz sessionId → 404", "bulunamadı", () =>
      list("00000000-0000-4000-8000-000000000000"));
  } finally {
    const devIds = [device.id, device2.id, device3.id, device4.id, device5.id, device6.id];
    await prisma.devicePeripheral.deleteMany({ where: { deviceId: { in: devIds } } }).catch(() => {});
    await prisma.peripheralDevice.deleteMany({ where: { id: { in: peripheralIds } } }).catch(() => {});
    await prisma.rollError.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } }).catch(() => {});
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } }).catch(() => {});
    await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } }).catch(() => {});
    await prisma.workSession.deleteMany({ where: { id: { in: sessionIds } } }).catch(() => {});
    await prisma.device.deleteMany({ where: { id: { in: devIds } } }).catch(() => {});
    await prisma.machine.deleteMany({ where: { id: { in: [machineA.id, machineB.id, machineC.id, machineD.id] } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: [user.id, user2.id] } } }).catch(() => {});
  }

  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
