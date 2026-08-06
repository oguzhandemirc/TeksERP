// =============================================================================
// DAĞITILMADAN KAPANIŞ — Tambur okutması kurşun adımını atama olmadan kapatır
// (2026-08-06)
// =============================================================================
// SAHA VAKASI: bayrak açıkken kurşun adımı bir makineye DAĞITILMAMIŞSA iş iki
// taraftan da kilitleniyordu — kurşun tableti rejim kilidi yüzünden yazamıyor,
// Tambur ise "bu adımda açık top yok" diye 400 atıyordu. Dağıtım fabrikada
// kritik bir adım değil ve personel unutuyor; mal Tambur'un önünde kalıyordu.
//
// ÜRÜN KARARI: dağıtım artık MAKİNE ATFI için bir planlama kolaylığıdır, işin
// ilerlemesinin ön koşulu DEĞİL. Sektör karşılığı milestone confirmation
// (SAP PP): kilometre taşı (Tambur) onayı öncesindeki onaylanmamış operasyonu
// kapatır.
//
// ⚠️ TESTİN ASIL KONUSU KAPSAM: kapanış "her dağıtılmamış adımda" DEĞİL,
// "bayrak AÇIK **ve** adım bypass'a UYGUN" olduğunda doğar — kurşun tabletini
// kilitleyen yüklemin AYNISI. Kapsam gevşerse (bayrak koşulu düşerse) normal
// dijital akışta KK2 girmeyi bekleyen gerçek iş sessizce atlanır ve kalite
// verisi hiç girilmemiş olur; kapsam körleşirse eski çıkmaz geri gelir.
//
// Kapsanan senaryolar:
//   1  Bayrak AÇIK + dağıtılmamış UYGUN adım → sanal bekleyen (UNASSIGNED, makine null)
//   2  Kapanış: adım COMPLETED (SKIPPED değil), toplar Tambur'da, kalite NULL
//   3  Kapanan movement'ta machineId NULL (uydurma atıf yok) + marker doğru
//   4  Marker `KURSUN_BYPASS_MARKER_PREFIX` startsWith uyumunu KORUYOR
//   5  Bayrak KAPALI → sanal bekleyen doğmaz, Tambur okutması yine 400
//   6  UYGUN OLMAYAN adım (sonraki adım Tambur değil / KK2 kaydı var) → doğmaz
//   7  DAĞITILMIŞ adım regresyonu: eski yol aynen, machineId atanan makine
//   8  Yarış: önizleme ile onay arasında dağıtım yapılırsa 409, YARIM KAPANIŞ YOK
//   9  Kapsam paritesi: eksik/fazla rollIds → 409
//  10  `unassignedClosures` sayacı: sanal kapanışı sayar, atanmışı SAYMAZ
//  11  İdempotent tekrar: kapanmış işte ikinci istek `alreadyDone` (404 değil)
//  12  Hata mesajı: 400 artık "yanlış istasyon" demekle kalmıyor, SEBEBİ söylüyor
//
// Fixture'ı test kendi yaratır (`TEST-KUC-` ön eki), global bayrak yedeklenip
// geri yüklenir. Seed istasyon/makinelerine DOKUNULMAZ.
//
// Koşum: npx tsx scripts/test_kursun_unassigned_close.ts
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
import {
  KursunBypassService,
  KURSUN_BYPASS_MARKER_PREFIX,
  KURSUN_BYPASS_UNASSIGNED_MARKER_PREFIX,
} from "../src/services/kursun-bypass.service";
import { TamburService } from "../src/services/tambur.service";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { AppError } from "../src/utils/app-error";

const bypassSvc = new KursunBypassService();
const tamburSvc = new TamburService();

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

async function need<T>(row: T | null | undefined, label: string): Promise<T> {
  if (!row) throw new Error(`Seed fixture eksik: ${label} (önce 'npm run seed')`);
  return row;
}

/** Çağrıyı yut ve hata kimliğini döndür (AppError dışı hata MASKELENMEZ). */
async function attempt(
  fn: () => Promise<unknown>,
): Promise<{ threw: boolean; status?: number; message?: string }> {
  try {
    await fn();
    return { threw: false };
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    return { threw: true, status: e.statusCode, message: e.message };
  }
}

// -----------------------------------------------------------------------------

const STAMP = `${process.pid}${String(Math.floor(Math.random() * 10000)).padStart(4, "0")}`;
let woSeq = 0;

const createdWoIds: string[] = [];
const createdRollIds: string[] = [];
const createdStationIds: string[] = [];
const createdMachineIds: string[] = [];
const createdAssignmentIds: string[] = [];

interface MasterData {
  itemId: string;
  kursunStationId: string;
  tamburStationId: string;
  /** Kurşundan SONRA gelen ama Tambur OLMAYAN istasyon (uygunluk düşürücü). */
  zimparaStationId: string;
  machineId: string;
  adminUserId: string;
}

interface Fixture {
  woId: string;
  woNumber: string;
  cardBarcode: string;
  kursunStepId: string;
  nextStepId: string;
  rollIds: string[];
}

async function makeFixture(md: MasterData, nextStationId: string): Promise<Fixture> {
  const woNumber = `TEST-KUC-${STAMP}-${++woSeq}`;
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
  const nextStepId = wo.steps.find((s) => s.stepSequence === 2)!.id;

  const batch = await prisma.batch.create({
    data: { batchNumber: `TEST-KUCP-${STAMP}-${woSeq}`, workOrderId: wo.id },
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

  return { woId: wo.id, woNumber, cardBarcode: woNumber, kursunStepId, nextStepId, rollIds };
}

async function makeStation(
  suffix: string,
  name: string,
  kind: StationKind,
): Promise<string> {
  const st = await prisma.station.create({
    data: {
      code: `TEST-KUC-${suffix}-${STAMP}`.slice(0, 32),
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

/** Kapanan (exitedAt dolu) kurşun hareketleri. */
async function closedMovements(stepId: string) {
  return prisma.rollMovement.findMany({
    where: { workOrderStepId: stepId, exitedAt: { not: null } },
    select: { rollId: true, machineId: true, notes: true, qtyIn: true, qtyOut: true },
  });
}

// -----------------------------------------------------------------------------

async function main(): Promise<void> {
  const item = await need(
    await prisma.item.findFirst({ where: { isActive: true }, select: { id: true } }),
    "aktif Item",
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
  // Yetenek: dağıtımsız kapanış da `copyStationCapabilitiesToRoll` çağırıyor —
  // topun KURSUN özelliğini gerçekten kazandığını ölçebilmek için gerekli.
  await prisma.stationProperty.create({
    data: { stationId: kursunStationId, propertyId: kursunProperty.id },
  });
  const machine = await prisma.machine.create({
    data: {
      stationId: kursunStationId,
      code: `TEST-KUCM-${STAMP}`.slice(0, 32),
      name: `TEST Kurşun Makinesi`,
      isActive: true,
    },
    select: { id: true },
  });
  createdMachineIds.push(machine.id);

  const tamburStationId = await makeStation("T", "TEST Tambur", StationKind.TAMBUR);
  const zimparaStationId = await makeStation("Z", "TEST Zımpara", StationKind.OTHER);

  const md: MasterData = {
    itemId: item.id,
    kursunStationId,
    tamburStationId,
    zimparaStationId,
    machineId: machine.id,
    adminUserId: admin.id,
  };

  // ===========================================================================
  section("1) Bayrak AÇIK + dağıtılmamış UYGUN adım → SANAL bekleyen");
  // ===========================================================================
  await setFlag(true);
  const fx = await makeFixture(md, md.tamburStationId);

  // Ön koşul: adım GERÇEKTEN dağıtıma uygun olmalı — ürün kodunun kendi
  // listesinden okunur, testin ayrı bir "uygunluk" tanımı olmamalı.
  const dist1 = await bypassSvc.listDistribution();
  const waitingRow = dist1.data.waiting.find((w) => w.workOrderStepId === fx.kursunStepId);
  check(
    "1a Adım dağıtım listesinde UYGUN görünüyor (ön koşul)",
    waitingRow?.eligible === true,
    waitingRow?.blockReason ?? "",
  );

  const pending = await bypassSvc.findPendingForTambur(fx.woId);
  check("1b Sanal bekleyen ÜRETİLDİ (atama yokken null dönmüyor)", pending !== null);
  check("1c source = UNASSIGNED", pending?.source === "UNASSIGNED", String(pending?.source));
  check("1d assignmentId NULL (ortada atama satırı yok)", pending?.assignmentId === null);
  check(
    "1e machineId/machineName NULL (atıf UYDURULMUYOR)",
    pending?.machineId === null && pending?.machineName === null,
  );
  check(
    "1f stationId adımın KENDİ istasyonu (yetenek kaynağı)",
    pending?.stationId === md.kursunStationId,
  );
  check("1g Kapsam: 2 top, 360 m", pending?.rollCount === 2 && pending?.totalMeters === 360,
    `${pending?.rollCount} top / ${pending?.totalMeters} m`);

  // Tambur bağlamı da aynı bekleyeni taşımalı — mobil ekranın okuduğu yer orası.
  const ctx = await tamburSvc.getTamburContext(fx.cardBarcode);
  check(
    "1h getTamburContext bypassPending taşıyor (kart açılabilir)",
    ctx.data.bypassPending?.source === "UNASSIGNED",
  );

  // ===========================================================================
  section("2+3+4) Kapanış: adım COMPLETED, toplar Tambur'da, atıf boş, marker doğru");
  // ===========================================================================
  const res = await bypassSvc.completeFromTambur(
    { cardBarcode: fx.cardBarcode, rollIds: fx.rollIds },
    admin.id,
    null,
  );
  check("2a Kapanış başarılı", res.success && res.data.alreadyDone === false);
  check("2b 2 top taşındı", res.data.movedRollCount === 2, String(res.data.movedRollCount));
  check("2c tamburStepId doğru adım", res.data.tamburStepId === fx.nextStepId);

  const kursunStep = await prisma.workOrderStep.findUnique({
    where: { id: fx.kursunStepId },
    select: { status: true },
  });
  check(
    "2d Kurşun adımı COMPLETED (SKIPPED DEĞİL)",
    kursunStep?.status === StepStatus.COMPLETED,
    String(kursunStep?.status),
  );

  const rollsAfter = await prisma.roll.findMany({
    where: { id: { in: fx.rollIds } },
    select: { id: true, currentStepId: true, qualityGrade: true, status: true },
  });
  check(
    "2e Toplar Tambur adımında",
    rollsAfter.every((r) => r.currentStepId === fx.nextStepId),
  );
  check(
    "2f Kalite NULL kaldı (kaliteyi Tambur belirler)",
    rollsAfter.every((r) => r.qualityGrade === null),
  );
  check(
    "2g Statü IN_PRODUCTION korunuyor",
    rollsAfter.every((r) => r.status === RollStatus.IN_PRODUCTION),
  );

  const movs = await closedMovements(fx.kursunStepId);
  check("3a 2 hareket kapandı", movs.length === 2, String(movs.length));
  check(
    "3b machineId NULL — uydurma makine atfı YOK",
    movs.every((m) => m.machineId === null),
  );
  check(
    "3c qtyOut = qtyIn (bypass'ta kesim/fire kararı yok)",
    movs.every((m) => m.qtyOut !== null && m.qtyIn.equals(m.qtyOut!)),
  );
  check(
    "4a Marker UNASSIGNED ön ekiyle başlıyor",
    movs.every((m) => m.notes?.startsWith(`${KURSUN_BYPASS_UNASSIGNED_MARKER_PREFIX}:`) === true),
    movs[0]?.notes ?? "",
  );
  // ⚠️ BU KONTROL LOAD-BEARING: `hasBypassClosureOnProcessQcTx` (inventory) ve
  // `loadBypassEligibilitySignals.closedNonBypass` bu satırları BASE ön ekle
  // tanıyor. Uyum koparsa çok-partili işin İKİNCİ turu "bypass dışı kapanmış
  // hareket var" diye uygunluğunu kaybeder ve iş yeniden çıkmaza düşer.
  check(
    "4b Marker BASE ön ek uyumunu koruyor (startsWith)",
    movs.every((m) => m.notes?.startsWith(KURSUN_BYPASS_MARKER_PREFIX) === true),
  );

  const props = await prisma.rollProperty.count({
    where: { rollId: { in: fx.rollIds }, propertyId: kursunProperty.id },
  });
  check("4c İstasyon yetenekleri (KURSUN) toplara kopyalandı", props === 2, String(props));

  // ===========================================================================
  section("5) Bayrak KAPALI → sanal bekleyen DOĞMAZ (rejim kapsamı)");
  // ===========================================================================
  // Kapsam gevşerse normal dijital akışta KK2 girmeyi bekleyen GERÇEK iş
  // sessizce atlanır ve kalite verisi hiç girilmemiş olur.
  await setFlag(false);
  const fxOff = await makeFixture(md, md.tamburStationId);
  const pendingOff = await bypassSvc.findPendingForTambur(fxOff.woId);
  check("5a Bayrak kapalıyken sanal bekleyen YOK", pendingOff === null);

  const scanOff = await attempt(() => tamburSvc.getTamburContext(fxOff.cardBarcode));
  check("5b Tambur okutması yine 400", scanOff.threw && scanOff.status === 400,
    scanOff.message?.slice(0, 70) ?? "");

  const completeOff = await attempt(() =>
    bypassSvc.completeFromTambur(
      { cardBarcode: fxOff.cardBarcode, rollIds: fxOff.rollIds },
      admin.id,
      null,
    ),
  );
  check(
    "5c Kapanış ucu da reddediyor (UI'ya güvenilmiyor)",
    completeOff.threw && completeOff.status === 404,
    completeOff.message?.slice(0, 60) ?? "",
  );
  const stillOpenOff = await prisma.rollMovement.count({
    where: { workOrderStepId: fxOff.kursunStepId, exitedAt: null },
  });
  check("5d Toplar kurşunda kaldı (hiçbir şey kapanmadı)", stillOpenOff === 2);

  // ===========================================================================
  section("6) UYGUN OLMAYAN adım → sanal bekleyen DOĞMAZ (çıkmaz bekçisi)");
  // ===========================================================================
  await setFlag(true);

  // 6a — Kurşundan sonraki adım TAMBUR DEĞİL (kurşun → zımpara). Gerçek fabrikada
  // meşru bir rotadır; kapanışı yapacak istasyon olmadığı için sanal bekleyen
  // doğmamalı, iş tablette yürümeye DEVAM etmeli.
  const fxZimpara = await makeFixture(md, md.zimparaStationId);
  const pendingZ = await bypassSvc.findPendingForTambur(fxZimpara.woId);
  check("6a Sonraki adım Tambur değilse sanal bekleyen YOK", pendingZ === null);

  // 6b — Adımda KK2 kaydı VAR → iş dijital olarak işlenmiş, sessizce kapatılamaz.
  const fxQc2 = await makeFixture(md, md.tamburStationId);
  await prisma.rollOperation.create({
    data: {
      rollId: fxQc2.rollIds[0],
      workOrderStepId: fxQc2.kursunStepId,
      operationType: "QC2_COMPLETED",
      operatorId: admin.id,
    },
  });
  const pendingQc2 = await bypassSvc.findPendingForTambur(fxQc2.woId);
  check("6b KK2 kaydı olan adımda sanal bekleyen YOK", pendingQc2 === null);

  const completeQc2 = await attempt(() =>
    bypassSvc.completeFromTambur(
      { cardBarcode: fxQc2.cardBarcode, rollIds: fxQc2.rollIds },
      admin.id,
      null,
    ),
  );
  check(
    "6c Kapanış ucu 409 ile SOMUT SEBEP söylüyor (sessiz ret yok)",
    completeQc2.threw && completeQc2.status === 409 && /KK2/i.test(completeQc2.message ?? ""),
    completeQc2.message?.slice(0, 70) ?? "",
  );

  // ===========================================================================
  section("7) DAĞITILMIŞ adım regresyonu — eski yol aynen çalışıyor");
  // ===========================================================================
  const fxAssigned = await makeFixture(md, md.tamburStationId);
  const assignRes = await bypassSvc.assign(
    { workOrderId: fxAssigned.woId, machineId: md.machineId },
    admin.id,
  );
  createdAssignmentIds.push(assignRes.data.assignmentId);

  const pendingAssigned = await bypassSvc.findPendingForTambur(fxAssigned.woId);
  check("7a source = ASSIGNED", pendingAssigned?.source === "ASSIGNED");
  check("7b machineId DOLU (atıf biliniyor)", pendingAssigned?.machineId === md.machineId);

  await bypassSvc.completeFromTambur(
    { cardBarcode: fxAssigned.cardBarcode, rollIds: fxAssigned.rollIds },
    admin.id,
    null,
  );
  const movsAssigned = await closedMovements(fxAssigned.kursunStepId);
  check(
    "7c Kapanan harekette machineId = ATANAN MAKİNE (regresyon yok)",
    movsAssigned.length === 2 && movsAssigned.every((m) => m.machineId === md.machineId),
  );
  check(
    "7d Marker BASE ön ekle (UNASSIGNED değil)",
    movsAssigned.every(
      (m) =>
        m.notes?.startsWith(`${KURSUN_BYPASS_MARKER_PREFIX}:`) === true &&
        m.notes?.startsWith(KURSUN_BYPASS_UNASSIGNED_MARKER_PREFIX) === false,
    ),
    movsAssigned[0]?.notes ?? "",
  );

  // ===========================================================================
  section("8) ÖNİZLEME↔ONAY tutarsızlığı + EŞZAMANLI okutma");
  // ===========================================================================
  // ⚠️ KAPSAM DÜRÜSTLÜĞÜ: 8a–8e ÖN KONTROLÜ ölçer (tx dışı). `completeFromTambur`
  // içindeki tx-İÇİ tazeleme bunlarla tetiklenmez — tek iş parçacıklı testte ön
  // kontrol her zaman önce reddediyor (negatif sondayla doğrulandı: o blok
  // körleştirilince bu bölüm yeşil kalıyor). Gerçek eşzamanlılık özelliği 8f–8h'de
  // ölçülür: N paralel okutmadan YALNIZ BİRİ kapatır.
  const fxRace = await makeFixture(md, md.tamburStationId);
  const racePending = await bypassSvc.findPendingForTambur(fxRace.woId);
  check("8a Önizleme UNASSIGNED olarak alındı", racePending?.source === "UNASSIGNED");

  const raceAssign = await bypassSvc.assign(
    { workOrderId: fxRace.woId, machineId: md.machineId },
    admin.id,
  );
  createdAssignmentIds.push(raceAssign.data.assignmentId);

  // Artık atanmış → `completeFromTambur` ATANMIŞ dala girer ve normal kapanış
  // yapar. Sanal dalın kendisinin yarışta ne yaptığını ölçmek için doğrudan
  // kapanışı çağırıyoruz: atama satırı bulunduğu için sanal dal HİÇ seçilmez.
  const rehydrated = await bypassSvc.findPendingForTambur(fxRace.woId);
  check(
    "8b Dağıtımdan sonra bekleyen ASSIGNED'a döndü (sanal dal devre dışı)",
    rehydrated?.source === "ASSIGNED",
  );

  // 8c — Asıl yarış: adım ARTIK UYGUN DEĞİLKEN sanal kapanış denenirse.
  // (Önizleme alınmış, sonra tablette KK2 yazılmış senaryosu.)
  const fxRace2 = await makeFixture(md, md.tamburStationId);
  const race2Pending = await bypassSvc.findPendingForTambur(fxRace2.woId);
  check("8c Önizleme alındı", race2Pending?.source === "UNASSIGNED");
  await prisma.rollOperation.create({
    data: {
      rollId: fxRace2.rollIds[0],
      workOrderStepId: fxRace2.kursunStepId,
      operationType: "QC2_COMPLETED",
      operatorId: admin.id,
    },
  });
  const race2 = await attempt(() =>
    bypassSvc.completeFromTambur(
      { cardBarcode: fxRace2.cardBarcode, rollIds: fxRace2.rollIds },
      admin.id,
      null,
    ),
  );
  check("8d Onay 409 ile reddedildi", race2.threw && race2.status === 409,
    race2.message?.slice(0, 70) ?? "");
  const race2Open = await prisma.rollMovement.count({
    where: { workOrderStepId: fxRace2.kursunStepId, exitedAt: null },
  });
  check("8e YARIM KAPANIŞ YOK — 2 top hâlâ açık", race2Open === 2, String(race2Open));

  // 8f–8h — GERÇEK EŞZAMANLILIK. Atama satırı olmadığı için "claim" işini
  // `closeBypassMovementsTx`'in `exitedAt IS NULL` guard'ı görüyor. Bu koruma
  // düşerse iki tablet aynı topu İKİ KEZ Tambur'a taşır (ya da tek top için iki
  // açık hareket doğar) — sahada "top iki kere geldi" olarak görünür.
  //
  // ⚠️ `Promise.allSettled` BURADA MEŞRU: perf kuralı tek tx client'ını paylaşmaya
  // ilişkindir; burada üç AYRI transaction var (KK1 bekçisi emsali). Sıralı hale
  // "düzeltilirse" bu kontrol sessizce ölür.
  const fxConc = await makeFixture(md, md.tamburStationId);
  const concPending = await bypassSvc.findPendingForTambur(fxConc.woId);
  check("8f Eşzamanlılık fixture'ı hazır", concPending?.source === "UNASSIGNED");

  const concResults = await Promise.allSettled(
    Array.from({ length: 3 }, () =>
      bypassSvc.completeFromTambur(
        { cardBarcode: fxConc.cardBarcode, rollIds: fxConc.rollIds },
        admin.id,
        null,
      ),
    ),
  );
  const realMoves = concResults.filter(
    (r) => r.status === "fulfilled" && r.value.data.movedRollCount > 0,
  ).length;
  check(
    "8g 3 paralel okutmadan YALNIZ BİRİ topları taşıdı",
    realMoves === 1,
    `${realMoves} taşıma`,
  );
  const concMovs = await prisma.rollMovement.findMany({
    where: { rollId: { in: fxConc.rollIds }, workOrderStepId: fxConc.nextStepId },
    select: { id: true },
  });
  check(
    "8h Tambur adımında top başına TEK giriş hareketi (çift taşıma yok)",
    concMovs.length === 2,
    `${concMovs.length} hareket`,
  );

  // ===========================================================================
  section("9) Kapsam paritesi — eksik/fazla rollIds → 409");
  // ===========================================================================
  const fxScope = await makeFixture(md, md.tamburStationId);
  const scopeShort = await attempt(() =>
    bypassSvc.completeFromTambur(
      { cardBarcode: fxScope.cardBarcode, rollIds: [fxScope.rollIds[0]] },
      admin.id,
      null,
    ),
  );
  check(
    "9a Eksik kapsam 409 (adımda açık top kalırdı)",
    scopeShort.threw && scopeShort.status === 409,
    scopeShort.message?.slice(0, 70) ?? "",
  );
  const scopeOpen = await prisma.rollMovement.count({
    where: { workOrderStepId: fxScope.kursunStepId, exitedAt: null },
  });
  check("9b Yarım kapanış yok — 2 top hâlâ açık", scopeOpen === 2, String(scopeOpen));

  const foreign = await makeFixture(md, md.tamburStationId);
  const scopeExtra = await attempt(() =>
    bypassSvc.completeFromTambur(
      {
        cardBarcode: fxScope.cardBarcode,
        rollIds: [...fxScope.rollIds, foreign.rollIds[0]],
      },
      admin.id,
      null,
    ),
  );
  check(
    "9c Fazla/yabancı top 409",
    scopeExtra.threw && scopeExtra.status === 409,
    scopeExtra.message?.slice(0, 70) ?? "",
  );

  // ===========================================================================
  section("10) Planlamacı sayacı — sanal kapanışı sayar, atanmışı SAYMAZ");
  // ===========================================================================
  const dist2 = await bypassSvc.listDistribution();
  const stats = dist2.data.unassignedClosures;
  check("10a Sayaç payload'da var", stats !== undefined && stats.days === 7);
  // §2'de 1 adım (2 top) dağıtımsız kapandı. Aynı DB'de başka kayıtlar da
  // olabileceği için ALT SINIR ölçülür; ayrım testi 10c'de yapılır.
  check("10b Dağıtımsız kapanış sayıldı", (stats?.stepCount ?? 0) >= 1, `${stats?.stepCount} adım`);

  const countedSteps = await prisma.rollMovement.findMany({
    where: {
      exitedAt: { not: null },
      notes: { startsWith: KURSUN_BYPASS_UNASSIGNED_MARKER_PREFIX },
    },
    select: { workOrderStepId: true },
  });
  const countedSet = new Set(countedSteps.map((r) => r.workOrderStepId));
  check("10c Sanal kapanışın adımı sayaç kümesinde", countedSet.has(fx.kursunStepId));
  check(
    "10d ATANMIŞ kapanışın adımı sayaç kümesinde DEĞİL",
    !countedSet.has(fxAssigned.kursunStepId),
  );

  // ===========================================================================
  section("11) İdempotent tekrar — kapanmış işte ikinci istek 404 DEĞİL");
  // ===========================================================================
  // Offline kuyruk replay'i / yanıtı kaybolmuş istek: operatör AYNI okutmayı
  // tekrar gönderir. Atama satırı olmadığı için izin tek kaynağı marker'dır.
  const replay = await bypassSvc.completeFromTambur(
    { cardBarcode: fx.cardBarcode, rollIds: fx.rollIds },
    admin.id,
    null,
  );
  check("11a Tekrar isteği BAŞARILI (404 değil)", replay.success);
  check("11b alreadyDone = true", replay.data.alreadyDone === true);
  check("11c Hiçbir top ikinci kez taşınmadı", replay.data.movedRollCount === 0);

  // ===========================================================================
  section("12) Hata mesajı — 'yanlış istasyon' demekle kalmıyor, SEBEBİ söylüyor");
  // ===========================================================================
  // fxZimpara: kurşundan sonra Tambur yok → Tambur adımı hiç tanımlı değil,
  // mesaj 404 olur. UYGUN OLMAYAN ama Tambur'u OLAN rota için fxQc2 kullanılır.
  const msgProbe = await attempt(() => tamburSvc.getByCardBarcode(fxQc2.cardBarcode));
  check("12a Okutma reddedildi (400)", msgProbe.threw && msgProbe.status === 400,
    String(msgProbe.status));
  check(
    "12b Mesaj SOMUT sebep taşıyor (yalnız 'yanlış istasyon' değil)",
    /KK2|kurşun tabletinden/i.test(msgProbe.message ?? ""),
    msgProbe.message?.slice(0, 110) ?? "",
  );
  check(
    "12c Yanıltıcı 'yanlış istasyonda okutmuş olabilirsiniz' cümlesi YOK",
    !/yanlış istasyonda/i.test(msgProbe.message ?? ""),
  );
}

// -----------------------------------------------------------------------------

async function teardown(originalFlag: Prisma.JsonValue | null): Promise<void> {
  try {
    const children = await prisma.roll.findMany({
      where: { parentRollId: { in: createdRollIds } },
      select: { id: true },
    });
    const allRollIds = [...createdRollIds, ...children.map((c) => c.id)];

    await prisma.kursunBypassAssignment.deleteMany({
      where: { workOrderId: { in: createdWoIds } },
    });
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
      where: {
        recordId: { in: [...createdWoIds, ...allRollIds, ...createdAssignmentIds] },
      },
    });
    // Makineler İSTASYONLARDAN ÖNCE (Machine.stationId FK RESTRICT).
    await prisma.machine.deleteMany({ where: { id: { in: createdMachineIds } } });
    await prisma.stationProperty.deleteMany({
      where: { stationId: { in: createdStationIds } },
    });
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
    console.log("\n(temizlendi — TEST-KUC kayıtları silindi, bayrak geri alındı)");
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
