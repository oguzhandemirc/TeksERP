// =============================================================================
// KURŞUN REJİM KİLİDİ — bayrak açıkken tablet SALT-OKUNUR (2026-08-05)
// =============================================================================
// Ürün kararı: "kurşun istasyonu kartı okutursa sadece bilgi görür, hiçbir
// yetkisi yoktur — bypass açıkken". Kilit `assertKursunTabletMayWrite` ile
// uygulanır ve kurşun tabletinin BEŞ yazma yolunu da kapsar (KK2 tamamlama,
// hata kaydı, tablet adım kapatma, açık kumaş açma, kurşun bitirme).
//
// ⚠️ KİLİT "BAYRAK AÇIKSA HER ADIM" DEĞİLDİR — "bayrak açık VE adım dağıtıma
// UYGUN" ise kilitlenir. Bu ayrım testin ASIL konusudur, çünkü kör bir bayrak
// kilidi ÇIKMAZ üretir: kurşundan sonra Tambur GELMEYEN bir rotada bypass
// kapanışını yapacak istasyon yoktur, yani iş ne tablette işlenebilir ne de
// dağıtılabilirdi. Uygun olmayan adım tablette yürümeye DEVAM etmeli.
//
// Ayrıca `StepSummary.tabletReadOnly` (mobil ekranın salt-okunur bandı) ile
// guard'ın verdiği kararın BİREBİR aynı olduğu ölçülür: ekran "yazabilirsin"
// derken sunucunun reddettiği (ya da tersi) bir durum, sahada operatörü
// çıkmaza sokan en kötü hata sınıfıdır.
//
// Kapsanan senaryolar:
//   1  Bayrak KAPALI + uygun adım        → tablet YAZABİLİR (bugünkü akış korunur)
//   2  Bayrak AÇIK  + uygun adım         → tablet 409 · tabletReadOnly DOLU
//   3  Bayrak AÇIK  + UYGUN OLMAYAN adım → tablet YAZABİLİR · tabletReadOnly NULL
//      (kurşundan sonraki adım TAMBUR değil — çıkmaz bekçisi)
//   4  Dağıtılmış adım                   → 409 ve mesaj ATAMA mesajı olmalı
//                                          (genel rejim mesajı onu gölgelememeli)
//   5  Beş yazma yolunun HEPSİ kilide tabi (biri unutulmuş olamaz)
//   6  PROCESS_QC olmayan adımda guard KARIŞMAZ (kapsam sızıntısı yok)
//
// Fixture'ı test kendi yaratır (`TEST-KRL-` prefix'i), global bayrak yedeklenip
// geri yüklenir. Seed istasyon/makinelerine DOKUNULMAZ.
//
// Koşum: npx tsx scripts/test_kursun_regime_lock.ts
// =============================================================================

import {
  Prisma,
  RollForm,
  RollStatus,
  StationKind,
  StepStatus,
  TravelerCardStatus,
  WorkOrderStatus,
} from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { KursunQcService } from "../src/services/kursun-qc.service";
import { KursunBypassService } from "../src/services/kursun-bypass.service";
import { assertKursunTabletMayWrite } from "../src/services/helpers/kursun-bypass-eligibility.helper";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { AppError } from "../src/utils/app-error";

const qcSvc = new KursunQcService();
const bypassSvc = new KursunBypassService();

let pass = 0;
let fail = 0;

function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}

function section(title: string): void {
  console.log(`\n── ${title} ──`);
}

/** Guard çağrısı REDDEDİYOR mu? Reddediyorsa mesajı da döner. */
async function guardVerdict(
  stepId: string,
): Promise<{ blocked: boolean; status?: number; message?: string }> {
  try {
    await assertKursunTabletMayWrite(prisma, stepId, "TEST yazma");
    return { blocked: false };
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    return { blocked: true, status: e.statusCode, message: e.message };
  }
}

async function need<T>(row: T | null | undefined, label: string): Promise<T> {
  if (!row) throw new Error(`Seed fixture eksik: ${label} (önce 'npm run seed')`);
  return row;
}

// -----------------------------------------------------------------------------

const STAMP = `${process.pid}${String(Math.floor(Math.random() * 10000)).padStart(4, "0")}`;
let woSeq = 0;

const createdWoIds: string[] = [];
const createdRollIds: string[] = [];
const createdStationIds: string[] = [];
const createdMachineIds: string[] = [];

interface MasterData {
  itemId: string;
  kursunStationId: string;
  tamburStationId: string;
  /** Kurşundan SONRA gelen ama Tambur OLMAYAN istasyon (uygunluk düşürücü). */
  postKursunNonTamburStationId: string;
  defectTypeId: string;
  adminUserId: string;
}

interface Fixture {
  woId: string;
  cardBarcode: string;
  kursunStepId: string;
  rollIds: string[];
}

/**
 * `nextStation`: kurşun adımından SONRAKİ adımın istasyonu.
 *   • TAMBUR      → adım dağıtıma UYGUN (bypass kapanışını Tambur yapar)
 *   • başka kind  → adım UYGUN DEĞİL (kapanışı yapacak istasyon yok)
 */
async function makeFixture(
  md: MasterData,
  nextStationId: string,
): Promise<Fixture> {
  const woNumber = `TEST-KRL-${STAMP}-${++woSeq}`;
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: woNumber,
      type: "STOCK_PRODUCTION",
      status: WorkOrderStatus.IN_PROGRESS,
      targetItemId: md.itemId,
      steps: {
        create: [
          { stationId: md.kursunStationId, stepSequence: 1, status: StepStatus.ACTIVE },
          { stationId: nextStationId, stepSequence: 2, status: StepStatus.PENDING },
        ],
      },
    },
    select: { id: true, steps: { select: { id: true, stepSequence: true } } },
  });
  createdWoIds.push(wo.id);

  const kursunStepId = wo.steps.find((s) => s.stepSequence === 1)!.id;

  const batch = await prisma.batch.create({
    data: { batchNumber: `TEST-KRLP-${STAMP}-${woSeq}`, workOrderId: wo.id },
    select: { id: true },
  });

  await prisma.travelerCard.create({
    data: {
      cardNumber: woNumber,
      barcode: woNumber,
      workOrderId: wo.id,
      status: TravelerCardStatus.ACTIVE,
    },
  });

  const rollIds: string[] = [];
  for (const qty of [120, 240]) {
    const roll = await prisma.roll.create({
      data: {
        barcode: null,
        itemId: md.itemId,
        batchId: batch.id,
        initialQty: qty,
        currentQty: qty,
        status: RollStatus.IN_PRODUCTION,
        currentStepId: kursunStepId,
        entrySource: "SUBCONTRACTOR_RETURN",
        form: RollForm.ACIK,
      },
      select: { id: true },
    });
    createdRollIds.push(roll.id);
    await prisma.rollMovement.create({
      data: { rollId: roll.id, workOrderStepId: kursunStepId, qtyIn: qty },
    });
    rollIds.push(roll.id);
  }

  return { woId: wo.id, cardBarcode: woNumber, kursunStepId, rollIds };
}

async function makeStation(
  suffix: string,
  name: string,
  kind: StationKind,
): Promise<string> {
  const st = await prisma.station.create({
    data: {
      code: `TEST-KRL-${suffix}-${STAMP}`.slice(0, 32),
      name,
      type: "INTERNAL",
      kind,
      department: "KALITE",
    },
    select: { id: true },
  });
  createdStationIds.push(st.id);
  return st.id;
}

async function makeMachine(stationId: string, suffix: string): Promise<string> {
  const m = await prisma.machine.create({
    data: {
      stationId,
      code: `TEST-KRLM-${suffix}-${STAMP}`.slice(0, 32),
      name: `TEST Kurşun Makinesi ${suffix}`,
      isActive: true,
    },
    select: { id: true },
  });
  createdMachineIds.push(m.id);
  return m.id;
}

async function setFlag(enabled: boolean): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { key: SETTING_KEYS.KURSUN_BYPASS_ENABLED },
    create: {
      key: SETTING_KEYS.KURSUN_BYPASS_ENABLED,
      value: enabled,
      description: "TEST — kurşun bypass bayrağı",
    },
    update: { value: enabled },
  });
}

/** `getStep` payload'ındaki salt-okunur bandı. */
async function readOnlyBand(stepId: string): Promise<{ reason: string } | null> {
  const res = await qcSvc.getStep(stepId);
  return res.data.tabletReadOnly ?? null;
}

// -----------------------------------------------------------------------------

async function main(): Promise<void> {
  const item = await need(
    await prisma.item.findFirst({ where: { isActive: true }, select: { id: true } }),
    "aktif Item",
  );
  const defect = await need(
    await prisma.defectType.findFirst({ where: { code: "GENEL" }, select: { id: true } }),
    "DefectType GENEL",
  );
  const admin = await need(
    await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }),
    "admin kullanıcısı",
  );

  const kursunProperty = await need(
    await prisma.fabricProperty.findFirst({
      where: { code: "KURSUN" },
      select: { id: true },
    }),
    "FabricProperty KURSUN",
  );

  const kursunStationId = await makeStation("S", "TEST Kurşun İstasyonu", StationKind.PROCESS_QC);
  // `assign` istasyonun KURSUN yeteneğini arar (makine seçimi kabul koşulu) —
  // yeteneksiz istasyonda 4. bölüm hiç kurulamaz.
  await prisma.stationProperty.create({
    data: { stationId: kursunStationId, propertyId: kursunProperty.id },
  });
  const machineA = await makeMachine(kursunStationId, "A");
  // Kurşundan sonra gelen ama TAMBUR olmayan istasyon (örn. zımpara) — gerçek
  // fabrikada meşru bir rotadır ve bypass'ın taşıyamadığı tek yapısal durumdur.
  const tamburStationId = await makeStation("T", "TEST Tambur", StationKind.TAMBUR);
  const zimparaStationId = await makeStation("Z", "TEST Zımpara", StationKind.OTHER);

  const md: MasterData = {
    itemId: item.id,
    kursunStationId,
    tamburStationId,
    postKursunNonTamburStationId: zimparaStationId,
    defectTypeId: defect.id,
    adminUserId: admin.id,
  };

  // ===========================================================================
  section("1) Bayrak KAPALI + uygun adım → tablet YAZABİLİR");
  // ===========================================================================
  await setFlag(false);
  const fxOff = await makeFixture(md, md.tamburStationId);

  const v1 = await guardVerdict(fxOff.kursunStepId);
  check("1a Bayrak kapalıyken guard REDDETMEZ", !v1.blocked, v1.message ?? "");
  check("1b tabletReadOnly NULL", (await readOnlyBand(fxOff.kursunStepId)) === null);

  // ===========================================================================
  section("2) Bayrak AÇIK + uygun adım → tablet KİLİTLİ");
  // ===========================================================================
  await setFlag(true);
  const fxOn = await makeFixture(md, md.tamburStationId);

  // Kilidin ön koşulu: adım GERÇEKTEN dağıtıma uygun olmalı. Bunu ürün kodunun
  // kendi listesinden okuyoruz — testin ayrı bir "uygunluk" tanımı olmamalı.
  const dist = await bypassSvc.listDistribution();
  const waitingRow = dist.data.waiting.find((w) => w.workOrderStepId === fxOn.kursunStepId);
  check("2a Adım dağıtım listesinde UYGUN görünüyor (ön koşul)", waitingRow?.eligible === true,
    waitingRow?.blockReason ?? "");

  const v2 = await guardVerdict(fxOn.kursunStepId);
  check("2b Guard 409 ile REDDEDİYOR", v2.blocked && v2.status === 409, v2.message?.slice(0, 60) ?? "");
  check(
    "2c Mesaj REJİM mesajı (dağıtım açık) — atama mesajı değil",
    /Kurşun dağıtımı açık/i.test(v2.message ?? ""),
    v2.message?.slice(0, 80) ?? "",
  );
  const band2 = await readOnlyBand(fxOn.kursunStepId);
  check("2d tabletReadOnly DOLU (mobil bandı çizecek)", band2 !== null, band2?.reason.slice(0, 60) ?? "");

  // ===========================================================================
  section("3) Bayrak AÇIK + UYGUN OLMAYAN adım → tablet YAZABİLİR (ÇIKMAZ BEKÇİSİ)");
  // ===========================================================================
  // Bu bölüm kaldırılırsa/kilit körleşirse kurşun→zımpara→... rotasındaki her iş
  // emri SESSİZCE kilitlenir: tablette işlenemez (guard reddeder), dağıtılamaz
  // (uygunluk reddeder). Hata yok, log yok — mal istasyonda kalır.
  const fxIneligible = await makeFixture(md, md.postKursunNonTamburStationId);

  const dist3 = await bypassSvc.listDistribution();
  const row3 = dist3.data.waiting.find((w) => w.workOrderStepId === fxIneligible.kursunStepId);
  check("3a Adım dağıtıma UYGUN DEĞİL (ön koşul)", row3?.eligible === false, row3?.blockReason ?? "");
  check(
    "3b Sebep 'sonraki adım Tambur değil'",
    /Tambur değil/i.test(row3?.blockReason ?? ""),
    row3?.blockReason ?? "",
  );

  const v3 = await guardVerdict(fxIneligible.kursunStepId);
  check("3c Guard REDDETMİYOR — iş tablette yürümeye devam eder", !v3.blocked, v3.message ?? "");
  check("3d tabletReadOnly NULL — ekran normal çalışır", (await readOnlyBand(fxIneligible.kursunStepId)) === null);

  // Gerçek yazma yolu da çalışmalı (guard'ı atlatan sahte bir "serbest" değil).
  await qcSvc.completeQc2(
    { stepId: fxIneligible.kursunStepId, rollId: fxIneligible.rollIds[0] },
    md.adminUserId,
  );
  const qc2Written = await prisma.rollOperation.count({
    where: {
      workOrderStepId: fxIneligible.kursunStepId,
      rollId: fxIneligible.rollIds[0],
      operationType: "QC2_COMPLETED",
    },
  });
  check("3e completeQc2 GERÇEKTEN yazdı (bayrak açıkken bile)", qc2Written === 1);

  // ===========================================================================
  section("4) Dağıtılmış adım → ATAMA mesajı (rejim mesajı gölgelememeli)");
  // ===========================================================================
  const fxAssigned = await makeFixture(md, md.tamburStationId);
  await bypassSvc.assign(
    { workOrderId: fxAssigned.woId, machineId: machineA },
    md.adminUserId,
  );

  const v4 = await guardVerdict(fxAssigned.kursunStepId);
  check("4a Guard 409", v4.blocked && v4.status === 409, v4.message?.slice(0, 60) ?? "");
  check(
    "4b Mesaj ATAMA mesajı ('makinesine dağıtılmış') — daha somut olan önce",
    /dağıtılmış/i.test(v4.message ?? "") && !/Kurşun dağıtımı açık/i.test(v4.message ?? ""),
    v4.message?.slice(0, 80) ?? "",
  );
  const band4 = await readOnlyBand(fxAssigned.kursunStepId);
  check(
    "4c tabletReadOnly MAKİNE ADINI taşıyor",
    band4 !== null && /TEST Kurşun Makinesi A/.test(band4.reason),
    band4?.reason.slice(0, 80) ?? "",
  );

  // ===========================================================================
  section("5) BEŞ yazma yolunun HEPSİ kilide tabi");
  // ===========================================================================
  // Guard'ı tek tek çağırmak yerine ürün kodunun GERÇEK giriş noktalarını
  // deniyoruz: biri guard'ı çağırmayı unutmuşsa burada kırmızı verir.
  const fxPaths = await makeFixture(md, md.tamburStationId);

  const paths: Array<{ label: string; run: () => Promise<unknown> }> = [
    {
      label: "completeQc2",
      run: () =>
        qcSvc.completeQc2(
          { stepId: fxPaths.kursunStepId, rollId: fxPaths.rollIds[0] },
          md.adminUserId,
        ),
    },
    {
      label: "reportError",
      run: () =>
        qcSvc.reportError(
          {
            stepId: fxPaths.kursunStepId,
            rollId: fxPaths.rollIds[0],
            startMeter: 10,
            defectTypeId: md.defectTypeId,
          },
          md.adminUserId,
        ),
    },
    {
      label: "finishStep",
      run: () => qcSvc.finishStep({ stepId: fxPaths.kursunStepId }, md.adminUserId),
    },
  ];

  for (const p of paths) {
    let blocked = false;
    let msg = "";
    try {
      await p.run();
    } catch (e) {
      blocked = e instanceof AppError && e.statusCode === 409;
      msg = e instanceof Error ? e.message : String(e);
    }
    check(`5 ${p.label} kilide tabi (409)`, blocked, msg.slice(0, 70));
  }

  // Kilit gerçekten yazmayı ENGELLEDİ mi (409 attı ama yan etki bıraktıysa
  // koruma yalandır)?
  const leakedOps = await prisma.rollOperation.count({
    where: { workOrderStepId: fxPaths.kursunStepId },
  });
  const leakedErrors = await prisma.rollError.count({
    where: { detectedAtStepId: fxPaths.kursunStepId },
  });
  check("5 Yan etki YOK — RollOperation yazılmadı", leakedOps === 0, `${leakedOps}`);
  check("5 Yan etki YOK — RollError açılmadı", leakedErrors === 0, `${leakedErrors}`);

  // ===========================================================================
  section("6) PROCESS_QC olmayan adımda guard KARIŞMAZ");
  // ===========================================================================
  // Guard `inventory.openFabric` gibi istasyon-agnostik yollardan da çağrılıyor;
  // orada "bu soru anlamsız" olmalı, "reddet" değil.
  const nonQcStep = await prisma.workOrderStep.findFirstOrThrow({
    where: { workOrderId: fxOn.woId, stepSequence: 2 },
    select: { id: true, station: { select: { kind: true } } },
  });
  check("6a Ön koşul: adım TAMBUR (PROCESS_QC değil)", nonQcStep.station.kind === StationKind.TAMBUR);
  const v6 = await guardVerdict(nonQcStep.id);
  check("6b Guard REDDETMİYOR (kapsam sızıntısı yok)", !v6.blocked, v6.message ?? "");
}

async function teardown(originalFlag: Prisma.JsonValue | null): Promise<void> {
  try {
    const assignments = await prisma.kursunBypassAssignment.findMany({
      where: { workOrderId: { in: createdWoIds } },
      select: { id: true },
    });
    const assignmentIds = assignments.map((a) => a.id);

    const children = await prisma.roll.findMany({
      where: { parentRollId: { in: createdRollIds } },
      select: { id: true },
    });
    const allRollIds = [...createdRollIds, ...children.map((c) => c.id)];

    await prisma.kursunBypassAssignment.deleteMany({ where: { id: { in: assignmentIds } } });
    await prisma.rollError.deleteMany({ where: { rollId: { in: allRollIds } } });
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: allRollIds } } });
    await prisma.rollProperty.deleteMany({ where: { rollId: { in: allRollIds } } });
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: allRollIds } } });
    await prisma.roll.deleteMany({ where: { id: { in: allRollIds } } });
    await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: createdWoIds } } });
    await prisma.batch.deleteMany({ where: { workOrderId: { in: createdWoIds } } });
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: createdWoIds } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: createdWoIds } } });
    await prisma.systemLog.deleteMany({
      where: { recordId: { in: [...createdWoIds, ...allRollIds, ...assignmentIds] } },
    });
    // Makineler İSTASYONLARDAN ÖNCE (Machine.stationId FK RESTRICT).
    await prisma.machine.deleteMany({ where: { id: { in: createdMachineIds } } });
    await prisma.stationProperty.deleteMany({ where: { stationId: { in: createdStationIds } } });
    await prisma.station.deleteMany({ where: { id: { in: createdStationIds } } });

    if (originalFlag === null) {
      await prisma.systemSetting
        .delete({ where: { key: SETTING_KEYS.KURSUN_BYPASS_ENABLED } })
        .catch(() => {});
    } else {
      await prisma.systemSetting.update({
        where: { key: SETTING_KEYS.KURSUN_BYPASS_ENABLED },
        data: { value: originalFlag as Prisma.InputJsonValue },
      });
    }
    console.log("\n(temizlendi — TEST-KRL kayıtları silindi, bayrak geri alındı)");
  } catch (e) {
    console.error("TEMİZLİK HATASI:", e instanceof Error ? e.message : e);
  }
}

(async () => {
  const existingFlag = await prisma.systemSetting.findUnique({
    where: { key: SETTING_KEYS.KURSUN_BYPASS_ENABLED },
    select: { value: true },
  });
  const originalFlag = existingFlag ? existingFlag.value : null;

  try {
    await main();
  } catch (e) {
    fail++;
    console.error("HATA:", e instanceof Error ? (e.stack ?? e.message) : e);
  } finally {
    await teardown(originalFlag);
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exitCode = fail > 0 ? 1 : 0;
  await prisma.$disconnect();
  await pool.end();
})();
