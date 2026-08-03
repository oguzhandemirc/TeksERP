// =============================================================================
// TEST: Fason kabulde YANLIŞ YÖNLENDİRME — teşhis mesajları + görünürlük
// =============================================================================
//
// SAHA BULGUSU (2026-08-02/03): operatör iki senaryoda doğru işi yapamıyordu ve
// sistem onu YANLIŞ YERE bakmaya itiyordu.
//
//  1) KONUMU DÜZELTİLMİŞ PARTİ. Kabul edilmiş parti "Konumu Düzelt" ile fason
//     adımına geri alınıyor. Manuel taşıma — TASARIM GEREĞİ — topu
//     `AT_SUBCONTRACTOR` DEĞİL `IN_PRODUCTION` yapar (mal fiziksel olarak dışarı
//     çıkmadan "dışarıda" işaretlemek envanteri yalanlar; çıkış ayrıca Fason Sevk
//     ile yapılır). `listPendingReturns` yalnız AT_SUBCONTRACTOR saydığı için 0
//     bulup 400 atıyor, mobil bunu SABİT "Yanlış istasyon" başlığıyla gösteriyordu.
//     Mesaj kendini yalanlıyordu: "fason adımında bekleyen rulo yok. Mevcut konum:
//     Boyahane (Fason) (1 rulo)". Doğru yönlendirme ("önce Fason Sevk yapın")
//     hiçbir yerde yoktu; iş emri "Bekleyen" listesinden de sessizce kayboluyordu.
//
//  2) YANLIŞ İŞ EMRİNE KABUL. Mal fiziksel olarak fasonda, kayıt yanlış WO'ya
//     yapılmış. Doğru araç "Konumu Düzelt" DEĞİL, KABUL İPTALİ (`cancelReceipt`) —
//     o, orijinalleri AT_SUBCONTRACTOR'a döndürür ve sevki yeniden açar.
//
// BU TEST DAVRANIŞI DEĞİL YÖNLENDİRMEYİ KİLİTLER. Üç şeyin DEĞİŞMEDİĞİNİ de
// ayrıca kanıtlar (regresyon kapısı):
//   • manuel taşıma hâlâ AT_SUBCONTRACTOR YAPMIYOR (S1: top IN_PRODUCTION kalır),
//   • tasarımın söylediği yol hâlâ çalışıyor (S1b: sevk → kabul BAŞARILI),
//   • `cancelReceipt` içindeki K14 parti guard'ı hâlâ YERİNDE (S3: 409).
//
// Senaryolar
//   S1  sevk → kabul → "Konumu Düzelt" (fason adımına) → kart okut
//         ⇒ 400 + NEEDS_DISPATCH; mesaj "Fason Sevk" der, "yanlış istasyon" DEMEZ,
//           "Mevcut konum" listesinde fason adımı YOKTUR.
//   S5  aynı durumda "Bekleyen" listesi WO'yu `awaitingDispatch` ile GÖSTERİR
//         (kabul akışına girmez: rollCount=0, grup detayında rolls boş).
//   S1b sonra Fason Sevk → kabul ⇒ BAŞARILI (en önemli kontrol: davranış korundu).
//   S2  iptal edilmemiş makbuzlu WO'da kart okut ⇒ MAYBE_WRONG_RECEIPT + receiptId.
//   S3  parti taşınmış makbuzda getCancelPreview ⇒ batchMismatch.blocked,
//         allSafe=false, parti NUMARALARI dolu; ardından cancelReceipt ⇒ 409
//         ve guard metni önizleme metniyle BİREBİR aynı (drift yok). Üyelik
//         geri gelince iptal serbest.
//   S4  receive() hata mesajı BARKOD basar, ham UUID basmaz.
//   C   (c) dalı: gerçekten başka istasyondayken jenerik mesaj kalır ama "mevcut
//         konum" listesinden FASON adımları çıkarılır (kendini yalanlayan cümle).
//
// Rota (fixture-manual-move): Zımpara(Fason) → Boyahane(Fason) → Kurşun+KK2 → Tambur
// Çalıştır: npx tsx scripts/test_fason_wrong_station_guidance.ts
// =============================================================================
import { RollStatus, StepStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { WorkOrderManualMoveService } from "../src/services/workorder-manual-move.service";
import { createManualMoveFixture, type ManualMoveFixture } from "./fixture-manual-move";
import { ensureTestDyeHouse, type TestSubcontractor } from "./fixture-subcontractor";
import { ensureTestAdmin } from "./fixture-test-user";

const svc = new SubcontractorService();
const moveSvc = new WorkOrderManualMoveService();

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean, extra = ""): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`);
  } else {
    fail++;
    console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`);
  }
}

/** AppError'ın testte okunan yüzeyi (statusCode + details). */
interface ThrownError {
  statusCode?: number;
  message?: string;
  details?: Record<string, unknown>;
}

/** Hatayı YAKALAR ve döner; hiç fırlamazsa testi düşürür (sessiz "geçti" olmasın). */
async function expectThrow(label: string, fn: () => Promise<unknown>): Promise<ThrownError> {
  try {
    await fn();
    fail++;
    console.log(`  ✗ FAIL: ${label} — HATA BEKLENİYORDU ama geçti`);
    return {};
  } catch (e) {
    return e as ThrownError;
  }
}

// -----------------------------------------------------------------------------
// Fixture kurulumu
// -----------------------------------------------------------------------------

const fixtures: ManualMoveFixture[] = [];
const extraBatchIds: string[] = [];

interface Scenario {
  fx: ManualMoveFixture;
  firm: TestSubcontractor;
  /** seq2 — BOYA_FASON (kind=SUBCONTRACTOR, type=EXTERNAL) */
  boya: string;
  /** seq3 — KURSUN_KK2 (kind=PROCESS_QC) */
  kursun: string;
}

/**
 * Fason adımı sevke HAZIR bir WO kurar: adım ACTIVE, `requiredCategoryId`
 * fixture firmasının KENDİ kategorisinden yazılır (CLAUDE.md: tek kaynak →
 * "firma bu kategoride değil" sapması imkânsız), toplar adıma bağlı.
 */
async function newScenario(rollCount: number): Promise<Scenario> {
  const firm = await ensureTestDyeHouse();
  const fx = await createManualMoveFixture(rollCount);
  fixtures.push(fx);
  const boya = fx.stepIdBySeq[2]!;
  const kursun = fx.stepIdBySeq[3]!;
  await prisma.workOrderStep.update({
    where: { id: boya },
    data: { status: StepStatus.ACTIVE, requiredCategoryId: firm.categoryId },
  });
  await prisma.roll.updateMany({
    where: { id: { in: fx.rollIds } },
    data: { status: RollStatus.IN_PRODUCTION, currentStepId: boya },
  });
  await prisma.rollMovement.createMany({
    data: fx.rollIds.map((id) => ({ rollId: id, workOrderStepId: boya, qtyIn: 100 })),
  });
  return { fx, firm, boya, kursun };
}

// -----------------------------------------------------------------------------
// S1 + S5 + S1b + S2 + S3 — tek WO üzerinde sahadaki sırayla
// -----------------------------------------------------------------------------

async function scenarioMainFlow(userId: string): Promise<void> {
  const { fx, firm, boya } = await newScenario(1);
  const original = fx.rollIds[0]!;

  // --- Hazırlık: gerçek sevk + gerçek kabul (mock yok) ---
  await svc.dispatch(
    {
      workOrderId: fx.woId,
      stepId: boya,
      subcontractorId: firm.id,
      rollIds: [original],
      allowRouteSkip: true, // seq1 zımpara fasonu bilinçli atlanıyor
    },
    userId,
  );
  const rcv1 = await svc.receive(
    {
      workOrderId: fx.woId,
      stepId: boya,
      subcontractorId: firm.id,
      returns: [{ rollId: original }],
      newRolls: [{ qty: 100 }],
    },
    userId,
  );
  const receipt1Id = (rcv1.data as { id: string }).id;
  const born1 = await prisma.roll.findFirstOrThrow({
    where: { parentReceiptId: receipt1Id },
    select: { id: true, currentStepId: true },
  });

  // --- S1: "Konumu Düzelt" ile fason adımına geri al ---
  console.log("\n── S1: konumu düzeltilmiş parti → kart okutma ──");
  await moveSvc.manualMove(
    fx.woId,
    {
      rollIds: [born1.id],
      targetStepId: boya,
      reason: "TEST — saha senaryosu: yanlış adımda kabul edildi sanılıyor",
    },
    userId,
  );
  const movedRoll = await prisma.roll.findUniqueOrThrow({
    where: { id: born1.id },
    select: { status: true, currentStepId: true },
  });
  // KAPSAM DIŞI KURALIN KANITI: manuel taşıma malı "dışarıda" işaretlemez.
  check(
    "manuel taşıma AT_SUBCONTRACTOR YAPMIYOR (tasarım korundu)",
    movedRoll.status === RollStatus.IN_PRODUCTION,
    movedRoll.status,
  );
  check("top fason adımında duruyor", movedRoll.currentStepId === boya);

  const e1 = await expectThrow("S1 kart okutma reddedilir", () =>
    svc.listPendingReturns({ workOrderId: fx.woId }),
  );
  const m1 = e1.message ?? "";
  check("S1: 400 döndü", e1.statusCode === 400, String(e1.statusCode));
  check("S1: details.code = NEEDS_DISPATCH", e1.details?.code === "NEEDS_DISPATCH", String(e1.details?.code));
  check("S1: mesaj 'Fason Sevk' diyor", m1.includes("Fason Sevk"), m1);
  check("S1: mesaj 'yanlış istasyon' DEMİYOR", !m1.toLocaleLowerCase("tr").includes("yanlış istasyon"));
  check("S1: 'Mevcut konum' listesi basılmıyor (fason adımı sayılmaz)", !m1.includes("Mevcut konum"));
  check("S1: details.stepId = fason adımı", e1.details?.stepId === boya);
  check("S1: details.workOrderId dolu", e1.details?.workOrderId === fx.woId);
  check("S1: details.rollCount = 1", e1.details?.rollCount === 1, String(e1.details?.rollCount));
  check(
    "S1: details.stationName dolu (buton metni için)",
    typeof e1.details?.stationName === "string" && (e1.details.stationName as string).length > 0,
    String(e1.details?.stationName),
  );

  // --- S5: "Bekleyen" listesinde kaybolmuyor ---
  console.log("\n── S5: 'Bekleyen' listesi görünürlüğü ──");
  const list = (await svc.listPendingReturns()).data as Array<Record<string, unknown>>;
  const row = list.find((g) => (g.step as { id: string }).id === boya);
  check("S5: satır listede VAR (sessizce kaybolmuyor)", !!row);
  check("S5: awaitingDispatch = true", row?.awaitingDispatch === true, String(row?.awaitingDispatch));
  check(
    "S5: awaitingDispatchRollCount = 1",
    row?.awaitingDispatchRollCount === 1,
    String(row?.awaitingDispatchRollCount),
  );
  check("S5: rollCount = 0 (kabul akışına GİRMEZ)", row?.rollCount === 0, String(row?.rollCount));
  check(
    "S5: awaitingDispatchQty = 100",
    Number(row?.awaitingDispatchQty ?? 0) === 100,
    String(row?.awaitingDispatchQty),
  );
  const detail = (await svc.getPendingReturnGroupDetail(boya)).data as Record<string, unknown>;
  check("S5: grup detayı awaitingDispatch = true", detail.awaitingDispatch === true);
  check("S5: grup detayı rolls BOŞ (kabul edilecek top yok)", (detail.rolls as unknown[]).length === 0);

  // --- S1b: tasarımın söylediği yol hâlâ çalışıyor ---
  console.log("\n── S1b: önce Fason Sevk, sonra kabul (davranış korundu) ──");
  await svc.dispatch(
    {
      workOrderId: fx.woId,
      stepId: boya,
      subcontractorId: firm.id,
      rollIds: [born1.id],
      allowRouteSkip: true,
    },
    userId,
  );
  const pending = (await svc.listPendingReturns({ workOrderId: fx.woId })).data as unknown;
  check("S1b: sevk sonrası kart okutma AÇILIYOR", JSON.stringify(pending).includes(born1.id));
  const rcv2 = await svc.receive(
    {
      workOrderId: fx.woId,
      stepId: boya,
      subcontractorId: firm.id,
      returns: [{ rollId: born1.id }],
      newRolls: [{ qty: 100 }],
    },
    userId,
  );
  const receipt2 = rcv2.data as { id: string; receiptNo: string };
  check("S1b: kabul BAŞARILI", !!receipt2.id && receipt2.id !== receipt1Id, receipt2.receiptNo);
  const born2Count = await prisma.roll.count({ where: { parentReceiptId: receipt2.id } });
  check("S1b: tam 1 born roll doğdu (mükerrer/öksüz yok)", born2Count === 1, String(born2Count));

  // --- S2: iptal edilmemiş makbuz varken kart okutma ---
  console.log("\n── S2: yanlış iş emrine kabul şüphesi ──");
  const e2 = await expectThrow("S2 kart okutma reddedilir", () =>
    svc.listPendingReturns({ workOrderId: fx.woId }),
  );
  const m2 = e2.message ?? "";
  check("S2: 400 döndü", e2.statusCode === 400, String(e2.statusCode));
  check(
    "S2: details.code = MAYBE_WRONG_RECEIPT",
    e2.details?.code === "MAYBE_WRONG_RECEIPT",
    String(e2.details?.code),
  );
  check("S2: details.receiptId DOLU", e2.details?.receiptId === receipt2.id, String(e2.details?.receiptId));
  check("S2: details.receiptNo mesajda geçiyor", m2.includes(String(e2.details?.receiptNo)), m2);
  check("S2: mesaj 'iptal' yönlendirmesi veriyor", m2.includes("iptal"), m2);

  // --- S3: K14 önizlemede + guard yerinde ---
  console.log("\n── S3: iptal önizlemesi K14'ü öne alıyor, guard duruyor ──");
  const born2Ids = (
    await prisma.roll.findMany({ where: { parentReceiptId: receipt2.id }, select: { id: true } })
  ).map((r) => r.id);
  const otherBatch = await prisma.batch.create({
    data: { batchNumber: `TEST-P-OTHER-${process.pid}-${Date.now() % 100000}`, workOrderId: fx.woId },
    select: { id: true, batchNumber: true },
  });
  extraBatchIds.push(otherBatch.id);
  const originalBatch = await prisma.batch.findUniqueOrThrow({
    where: { id: fx.batchId },
    select: { batchNumber: true },
  });
  // Kabulden SONRA parti üyeliği değişti (birleştirme/taşıma emsali).
  await prisma.roll.update({ where: { id: born1.id }, data: { batchId: otherBatch.id } });

  const prev = (await svc.getCancelPreview(receipt2.id)).data as {
    allSafe: boolean;
    batchMismatch: {
      blocked: boolean;
      message: string | null;
      items: Array<{ barcode: string; rollBatchNumber: string | null; dispatchBatchNumber: string | null }>;
    };
  };
  const prevMsg = prev.batchMismatch.message ?? "";
  check("S3: önizleme batchMismatch.blocked = true", prev.batchMismatch.blocked === true);
  check("S3: önizleme allSafe = false (409 sürprizi yok)", prev.allSafe === false);
  check("S3: uyuşmazlık satırı var", prev.batchMismatch.items.length === 1, String(prev.batchMismatch.items.length));
  check(
    "S3: parti NUMARALARI dolu (hangi ikisi birleştirilecek)",
    prev.batchMismatch.items[0]?.rollBatchNumber === otherBatch.batchNumber &&
      prev.batchMismatch.items[0]?.dispatchBatchNumber === originalBatch.batchNumber,
    JSON.stringify(prev.batchMismatch.items[0]),
  );
  check("S3: mesaj iki parti numarasını da basıyor", prevMsg.includes(otherBatch.batchNumber) && prevMsg.includes(originalBatch.batchNumber));
  check("S3: mesaj panele yönlendiriyor ('Birleştir')", prevMsg.includes("Birleştir"), prevMsg);

  const e3 = await expectThrow("S3 iptal reddedilir", () =>
    svc.cancelReceipt(receipt2.id, "TEST — K14 guard doğrulaması", userId, born2Ids),
  );
  check("S3: cancelReceipt 409 (GUARD YERİNDE, kaldırılmadı)", e3.statusCode === 409, String(e3.statusCode));
  check("S3: guard metni = önizleme metni (drift yok)", e3.message === prevMsg);
  check(
    "S3: eski sözleşme metni korunuyor",
    (e3.message ?? "").includes("parti üyeliği kabulden sonra değişmiş"),
  );
  check("S3: guard details.code = BATCH_MISMATCH", e3.details?.code === "BATCH_MISMATCH", String(e3.details?.code));

  // Üyelik geri gelince iptal SERBEST — guard aşırı-engellemiyor.
  await prisma.roll.update({ where: { id: born1.id }, data: { batchId: fx.batchId } });
  const prev2 = (await svc.getCancelPreview(receipt2.id)).data as {
    allSafe: boolean;
    batchMismatch: { blocked: boolean };
  };
  check("S3: üyelik dönünce önizleme allSafe = true", prev2.allSafe === true);
  check("S3: üyelik dönünce blocked = false", prev2.batchMismatch.blocked === false);
  const cancelled = await svc.cancelReceipt(receipt2.id, "TEST — tutarlı iptal", userId, born2Ids);
  check("S3: iptal başarılı (guard aşırı-engellemiyor)", cancelled.success === true);
}

// -----------------------------------------------------------------------------
// S4 — mesaj hijyeni: hata metninde barkod, ham UUID değil
// -----------------------------------------------------------------------------

async function scenarioMessageHygiene(userId: string): Promise<void> {
  console.log("\n── S4: receive() hata metni barkod basıyor ──");
  const { fx, firm, boya } = await newScenario(1);
  const rollId = fx.rollIds[0]!;
  const { barcode } = await prisma.roll.findUniqueOrThrow({
    where: { id: rollId },
    select: { barcode: true },
  });

  // (a) fasona hiç gönderilmemiş top
  const e4 = await expectThrow("S4 gönderilmemiş top kabulü reddedilir", () =>
    svc.receive(
      {
        workOrderId: fx.woId,
        stepId: boya,
        subcontractorId: firm.id,
        returns: [{ rollId }],
        newRolls: [{ qty: 100 }],
      },
      userId,
    ),
  );
  const m4 = e4.message ?? "";
  check("S4: mesajda BARKOD var", !!barcode && m4.includes(barcode), m4);
  check("S4: mesajda ham UUID YOK", !m4.includes(rollId));

  // (b) aynı top listede iki kez — ikinci mesaj dalı da barkod basmalı
  const e4b = await expectThrow("S4 mükerrer dönüş satırı reddedilir", () =>
    svc.receive(
      {
        workOrderId: fx.woId,
        stepId: boya,
        subcontractorId: firm.id,
        returns: [{ rollId }, { rollId }],
        newRolls: [{ qty: 100 }],
      },
      userId,
    ),
  );
  const m4b = e4b.message ?? "";
  check("S4: mükerrer mesajı barkod basıyor", !!barcode && m4b.includes(barcode), m4b);
  check("S4: mükerrer mesajında ham UUID YOK", !m4b.includes(rollId));
}

// -----------------------------------------------------------------------------
// C — (c) dalı: jenerik mesaj kalır, "mevcut konum"dan fason adımları çıkar
// -----------------------------------------------------------------------------

async function scenarioGenericBranch(): Promise<void> {
  console.log("\n── C: gerçekten başka istasyonda — jenerik mesaj ──");
  const { fx, boya, kursun } = await newScenario(2);
  const boyaStation = await prisma.workOrderStep.findUniqueOrThrow({
    where: { id: boya },
    select: { station: { select: { name: true } } },
  });
  // Top 1 gerçekten Kurşun'da; Top 2 fason adımında ama ÖLÜ statüde
  // (SUBCONTRACTOR_CONSUMED) — eski kod bunu "mevcut konum" diye basıyordu.
  await prisma.roll.update({
    where: { id: fx.rollIds[0]! },
    data: { status: RollStatus.IN_PRODUCTION, currentStepId: kursun },
  });
  await prisma.roll.update({
    where: { id: fx.rollIds[1]! },
    data: { status: RollStatus.SUBCONTRACTOR_CONSUMED, currentStepId: boya },
  });

  const ec = await expectThrow("C kart okutma reddedilir", () =>
    svc.listPendingReturns({ workOrderId: fx.woId }),
  );
  const mc = ec.message ?? "";
  const steps = (ec.details?.currentSteps ?? []) as Array<{ stepId: string; stationName: string }>;
  check("C: 400 döndü", ec.statusCode === 400, String(ec.statusCode));
  check(
    "C: details.code = WO_NOT_AT_SUBCONTRACTOR",
    ec.details?.code === "WO_NOT_AT_SUBCONTRACTOR",
    String(ec.details?.code),
  );
  check("C: jenerik 'Mevcut konum' mesajı KALDI", mc.includes("Mevcut konum"), mc);
  check("C: currentSteps tek satır", steps.length === 1, JSON.stringify(steps));
  check("C: currentSteps = Kurşun adımı", steps[0]?.stepId === kursun, String(steps[0]?.stationName));
  check(
    "C: mesajda FASON adımı YOK (kendini yalanlayan cümle bitti)",
    !mc.includes(boyaStation.station.name),
    boyaStation.station.name,
  );
}

// -----------------------------------------------------------------------------
// S6 — HTTP SÖZLEŞMESİ: `details.code` KABLODAN sağ çıkıyor mu?
// -----------------------------------------------------------------------------
//
// NEDEN AYRI BİR HTTP BÖLÜMÜ (2026-08-03): yukarıdaki senaryolar servisi DOĞRUDAN
// çağırır (repo konvansiyonu) ve `AppError.details`'i bellekte okur. Ama bu
// düzeltmenin TAMAMI, `details.code`'un mobile HTTP üzerinden ulaşmasına bağlı:
// mobil aksiyon kartı ("Fason Sevk'e Git" / "Makbuzu İptal Et") o kodu okuyarak
// çiziliyor. Zincirde tek bir halka koparsa —controller `details`'i düşürse,
// route değişse, `error.middleware.ts:199`'daki serileştirme satırı silinse—
// servis testleri YİNE YEŞİL kalır ve kart sahada SESSİZCE kaybolur. Bu gece
// tekrar tekrar konuştuğumuz "susan test" sınıfı tam olarak budur.
//
// Bu yüzden burada Express app'i efemeral portta gerçekten dinletip fetch ile
// çağırıyoruz (emsal: `scripts/test_http_api.ts`).

async function scenarioHttpContract(): Promise<void> {
  console.log("\n=== S6) HTTP sözleşmesi: details.code kablodan geçiyor mu ===");

  // Fason adımında IN_PRODUCTION top → NEEDS_DISPATCH üreten durum (S1 ile aynı).
  const { fx } = await newScenario(1);

  const app = (await import("../src/app")).default;
  const server = await new Promise<import("http").Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  try {
    const port = (server.address() as { port: number }).port;
    const base = `http://127.0.0.1:${port}/api`;
    const u = await ensureTestAdmin();

    const loginRes = await fetch(`${base}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: u.username, password: u.password, clientType: "electron" }),
    });
    const loginBody = (await loginRes.json()) as { data?: { token?: string } };
    const token = loginBody.data?.token;
    check("S6: giriş yapıldı (token alındı)", loginRes.status === 200 && !!token, String(loginRes.status));
    if (!token) return;

    const res = await fetch(
      `${base}/subcontractor/pending-returns?workOrderId=${fx.woId}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const body = (await res.json()) as {
      success?: boolean;
      message?: string;
      details?: { code?: string; stepId?: string; rollCount?: number };
    };

    check("S6: HTTP 400 döndü", res.status === 400, String(res.status));
    check(
      "S6: details.code KABLODAN geldi (NEEDS_DISPATCH)",
      body.details?.code === "NEEDS_DISPATCH",
      JSON.stringify(body.details ?? null),
    );
    check(
      "S6: details yükü dolu (stepId + rollCount)",
      typeof body.details?.stepId === "string" && typeof body.details?.rollCount === "number",
      `stepId=${body.details?.stepId} rollCount=${body.details?.rollCount}`,
    );
    check(
      "S6: mesaj gövdesi de geldi ve 'Fason Sevk' diyor",
      typeof body.message === "string" && body.message.includes("Fason Sevk"),
      body.message ?? "(mesaj yok)",
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

// -----------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("=== Fason kabul — yanlış yönlendirme regresyon testi ===");
  const admin = await ensureTestAdmin();
  await scenarioMainFlow(admin.id);
  await scenarioMessageHygiene(admin.id);
  await scenarioGenericBranch();
  await scenarioHttpContract();
}

/**
 * Söküm sırası: makbuz/sevk yavruları → born roll'lar → fixture teardown.
 * Born roll'lar `parentReceiptId` ile bağlı (fixture teardown yalnız
 * `parentRollId` çocuklarını bilir), bu yüzden onları burada topluyoruz.
 */
async function cleanup(): Promise<void> {
  const woIds = fixtures.map((f) => f.woId);
  if (woIds.length === 0) return;
  try {
    const bornRolls = await prisma.roll.findMany({
      where: { parentReceipt: { workOrderId: { in: woIds } } },
      select: { id: true },
    });
    const bornIds = bornRolls.map((r) => r.id);
    const receipts = await prisma.subcontractorReceipt.findMany({
      where: { workOrderId: { in: woIds } },
      select: { id: true },
    });
    const receiptIds = receipts.map((r) => r.id);
    const dispatches = await prisma.subcontractorDispatch.findMany({
      where: { workOrderId: { in: woIds } },
      select: { id: true },
    });
    const dispatchIds = dispatches.map((d) => d.id);

    await prisma.subcontractorReceiptProperty.deleteMany({ where: { receiptId: { in: receiptIds } } });
    await prisma.subcontractorReceiptItem.deleteMany({ where: { receiptId: { in: receiptIds } } });
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: bornIds } } });
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: bornIds } } });
    await prisma.rollProperty.deleteMany({ where: { rollId: { in: bornIds } } });
    await prisma.subcontractorDispatchItem.deleteMany({ where: { dispatchId: { in: dispatchIds } } });
    await prisma.roll.deleteMany({ where: { id: { in: bornIds } } });
    // PrintedDocument kaynağa `sourceId` ile bağlıdır (polimorfik, FK yok).
    await prisma.printedDocument.deleteMany({ where: { sourceId: { in: dispatchIds } } });
    await prisma.subcontractorReceipt.deleteMany({ where: { id: { in: receiptIds } } });
    await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: dispatchIds } } });
    await prisma.systemLog.deleteMany({
      where: { recordId: { in: [...bornIds, ...receiptIds, ...dispatchIds, ...extraBatchIds] } },
    });
    await prisma.batch.deleteMany({ where: { id: { in: extraBatchIds } } });
    for (const fx of fixtures) {
      await fx.teardown();
    }
    console.log("\n(test verisi temizlendi)");
  } catch (e) {
    console.error("cleanup hata (manuel temizlik gerekebilir):", e instanceof Error ? e.message : e);
  }
}

main()
  .catch((e) => {
    console.error("HATA:", e);
    fail++;
  })
  .finally(async () => {
    await cleanup();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end().catch(() => {});
    process.exit(fail > 0 ? 1 : 0);
  });
