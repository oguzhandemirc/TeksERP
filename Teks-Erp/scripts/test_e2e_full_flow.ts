// =============================================================================
// ÜRETİM HATTI — UÇTAN UCA (E2E) AKIŞ TESTİ
// =============================================================================
// Tek tutarlı senaryo; üretim hattını gerçek servis metodlarıyla baştan sona
// yürütür ve HER geçişte durum (RollStatus / StepStatus / ShipmentStatus /
// OrderStatus) assert eder. Sunucu yok — service sınıfları + prisma doğrudan.
//
// Çalıştırma:
//   export DATABASE_URL="postgresql://oad@localhost:5432/teks_ci_utc?schema=public"
//   export JWT_SECRET="ci-test-secret-not-for-production"
//   export TZ=UTC
//   npx tsx scripts/test_e2e_full_flow.ts
//
// AKIŞ (root CLAUDE.md):
//   KK1/RAW_QC (ilk giriş, createInitialEntry → STOCK)
//     → İş Emri (rota: PROCESS_QC → TAMBUR)
//     → attachRolls (STOCK → IN_PRODUCTION, ilk adım = PROCESS_QC)
//     → Kurşun + KK2 (completeQc2: KURSUN_APPLIED + QC2_COMPLETED) → finishStep
//     → Tambur (finalize, final karar) → child WAREHOUSE'a iner
//     → Sevkiyat (ÇUVAL DEPO: çuval aç → okut → (tart) → depodan çuval + sipariş seç →
//        PLANNED → DISPATCHED)
//     → Mühür/rezerv YOK; DISPATCH'te stok SHIPPED + shippedQty terfi + sipariş COMPLETED
//
//   NOT — Fason (boyahane/zımpara) adımı BİLİNÇLİ atlandı: opsiyoneldir (root
//   CLAUDE.md "[opsiyonel Fason atla]"). KK1/RAW_QC istasyon ekranı bir
//   WorkOrderStep DEĞİL — ham mal girişidir (createInitialEntry); WO rotası
//   PROCESS_QC ile başlar (seed'deki gerçek üretim akışı; bkz. dashboard.service
//   "RAW_QC üretim akışına step olarak girmez").

import {
  RollStatus,
  RollOperationType,
  StationKind,
  StepStatus,
  ShipmentStatus,
  OrderStatus,
  WorkOrderStatus,
} from "@prisma/client";
import prisma from "../src/lib/prisma";
import { InventoryService } from "../src/services/inventory.service";
import { WorkOrderService } from "../src/services/workorder.service";
import { KursunQcService } from "../src/services/kursun-qc.service";
import { TamburService } from "../src/services/tambur.service";
import { ShippingService } from "../src/services/shipping.service";

const inv = new InventoryService();
const wos = new WorkOrderService();
const kursun = new KursunQcService();
const tambur = new TamburService();
const ship = new ShippingService();

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

// ── Benzersizlik: TEST-E2E- + ms zaman damgası ──────────────────────────────
const STAMP = `${Date.now()}`;
// Çuval depo modelinde tahsis SEVK ANINDA seçilen siparişlere (orderIds) spec+şube FIFO ile
// yazılır. Benzersiz/yüksek en → sevkiyat yalnız bu testin siparişiyle eşleşsin, paralel koşu
// veya başka açık sipariş karışmasın (seed tekstil enleri bu aralığa girmez).
const WIDTH = 500 + Math.floor(Math.random() * 500);
const CUT_LEN = 90; // Tambur'da kesilecek tek top (= sipariş satır metrajı → COMPLETED)
const RAW_QTY = 120; // ham topun girişteki metrajı (kalan kuyruk depoda kalır)

// ── Temizlik için biriktirilenler (ters bağımlılık sırasıyla silinecek) ─────
const createdRollIds: string[] = [];
const createdWoIds: string[] = [];
const createdOrderIds: string[] = [];
const createdShipmentIds: string[] = [];
const createdSackIds: string[] = [];

// ── Yardımcılar ─────────────────────────────────────────────────────────────
const rollState = async (id: string) =>
  (await prisma.roll.findUnique({
    where: { id },
    select: { status: true, currentStepId: true, shipmentId: true, sackId: true, currentQty: true },
  }))!;
const stepStatusOf = async (id: string) =>
  (await prisma.workOrderStep.findUnique({ where: { id }, select: { status: true } }))!.status;
const woStatusOf = async (id: string) =>
  (await prisma.workOrder.findUnique({ where: { id }, select: { status: true } }))!.status;
const shipmentStatusOf = async (id: string) =>
  (await prisma.shipment.findUnique({ where: { id }, select: { status: true } }))!.status;
const orderStatusOf = async (id: string) =>
  (await prisma.order.findUnique({ where: { id }, select: { status: true } }))!.status;
const shippedQtyOf = async (lineId: string) =>
  Number((await prisma.orderLine.findUnique({ where: { id: lineId }, select: { shippedQty: true } }))!.shippedQty);
const allocOf = async (lineId: string) =>
  Number((await prisma.sackAllocation.aggregate({ where: { orderLineId: lineId }, _sum: { qty: true } }))._sum.qty ?? 0);

async function main(): Promise<void> {
  console.log("=== Üretim Hattı Uçtan Uca (E2E) Testi ===\n");

  // ===========================================================================
  // HOP 0 — Master data'yı BUSINESS-KEY ile çöz (hardcoded UUID yok)
  // ===========================================================================
  const item = await prisma.item.findFirst({ where: { code: "PATOS", isActive: true }, select: { id: true } });
  const grade = await prisma.qualityGrade.findFirst({ where: { code: "1.KALITE" }, select: { id: true, targetStatus: true } });
  const processStation = await prisma.station.findFirst({
    where: { kind: StationKind.PROCESS_QC, isActive: true },
    select: { id: true, code: true },
  });
  const tamburStation = await prisma.station.findFirst({
    where: { kind: StationKind.TAMBUR, isActive: true },
    select: { id: true, code: true },
  });
  const customer = await prisma.customer.findFirst({ where: { isActive: true }, select: { id: true } });
  const admin = await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } });

  if (!item || !grade || !processStation || !tamburStation || !customer) {
    throw new Error(
      "Seed fixture eksik (Item PATOS / 1.KALITE / PROCESS_QC / TAMBUR / Customer). Önce 'npm run seed'.",
    );
  }
  const userId = admin?.id;

  check("HOP0 fixtures çözüldü (item/grade/process/tambur/customer)", true,
    `process=${processStation.code} tambur=${tamburStation.code}`);
  check("HOP0 1.KALITE targetStatus=WAREHOUSE (proses-only fabrika)",
    grade.targetStatus === RollStatus.WAREHOUSE, `targetStatus=${grade.targetStatus}`);

  // ===========================================================================
  // HOP 1 — Sipariş + satır (müşteriye). Başlangıç status doğrula.
  // ===========================================================================
  const order = await prisma.order.create({
    data: {
      orderNumber: `TEST-E2E-${STAMP}`,
      customerId: customer.id,
      status: OrderStatus.APPROVED,
      lines: { create: [{ itemId: item.id, colorId: null, width: WIDTH, quantity: CUT_LEN }] },
    },
    select: { id: true, status: true, lines: { select: { id: true } } },
  });
  createdOrderIds.push(order.id);
  const lineId = order.lines[0].id;

  check("HOP1 sipariş oluştu, status=APPROVED", order.status === OrderStatus.APPROVED, order.status);
  check("HOP1 satır henüz sevk edilmedi (shippedQty=0)", (await shippedQtyOf(lineId)) === 0);

  // ===========================================================================
  // HOP 2 — İş Emri (rota: PROCESS_QC → TAMBUR), siparişe bağlı. create() pattern.
  // ===========================================================================
  const woRes = await wos.create(
    {
      batchNumber: `TEST-E2E-WO-${STAMP}`,
      type: "ORDER_PRODUCTION",
      width: WIDTH,
      targetQuantity: RAW_QTY,
      targetItemId: item.id,
      orderLineIds: [lineId],
      steps: [
        { stationId: processStation.id, notes: null }, // Kurşun + KK2 (PROCESS_QC)
        { stationId: tamburStation.id, notes: null }, // Tambur (final karar)
      ],
    },
    userId,
  );
  const woId = woRes.data!.id;
  createdWoIds.push(woId);

  const woSteps = await prisma.workOrderStep.findMany({
    where: { workOrderId: woId },
    orderBy: { stepSequence: "asc" },
    include: { station: { select: { kind: true } } },
  });
  const processStepId = woSteps[0].id;
  const tamburStepId = woSteps[1].id;

  check("HOP2 WO oluştu", woRes.success === true);
  check("HOP2 WO type ORDER_PRODUCTION (orderLine'dan türedi)", woRes.data!.type === "ORDER_PRODUCTION", woRes.data!.type);
  check("HOP2 WO başlangıç status PLANNED", woRes.data!.status === WorkOrderStatus.PLANNED, woRes.data!.status);
  check("HOP2 rota: 1.adım PROCESS_QC", woSteps[0].station.kind === StationKind.PROCESS_QC);
  check("HOP2 rota: 2.adım TAMBUR", woSteps[1].station.kind === StationKind.TAMBUR);
  check("HOP2 her iki adım PENDING (henüz top yok)",
    woSteps[0].status === StepStatus.PENDING && woSteps[1].status === StepStatus.PENDING);
  const woLink = await prisma.workOrderToOrderLine.count({ where: { workOrderId: woId, orderLineId: lineId } });
  check("HOP2 WO↔OrderLine bağı kuruldu", woLink === 1);
  const card = await prisma.travelerCard.findFirst({
    where: { workOrderId: woId, status: "ACTIVE" },
    select: { id: true, barcode: true },
  });
  check("HOP2 refakat kartı (ACTIVE) oluştu", !!card?.barcode);

  // ===========================================================================
  // HOP 3 — KK1/RAW_QC: ham mal girişi (createInitialEntry) → STOCK top
  // ===========================================================================
  const entry = await inv.createInitialEntry(
    {
      itemId: item.id,
      colorId: null, // renksiz/ham → üretim akışına girer (STOCK)
      initialQty: RAW_QTY,
      width: WIDTH,
      qualityGrade: "1.KALITE",
    },
    userId,
  );
  const rollId = entry.data!.id;
  const rollBarcode = entry.data!.barcode!;
  createdRollIds.push(rollId);

  check("HOP3 KK1 giriş başarılı (createInitialEntry)", entry.success === true);
  check("HOP3 ham giriş → STOCK", entry.data!.status === RollStatus.STOCK, entry.data!.status);
  check("HOP3 top henüz bir adımda değil (currentStepId null)", entry.data!.currentStepId === null);

  // ===========================================================================
  // HOP 4 — attachRolls: STOCK → IN_PRODUCTION, ilk adım (PROCESS_QC)
  // ===========================================================================
  const attach = await wos.attachRolls(woId, [rollBarcode], userId);
  check("HOP4 attachRolls attached=1", attach.data!.attached === 1, `attached=${attach.data!.attached}`);
  check("HOP4 attach hatasız", (attach.data!.errors.length ?? -1) === 0, JSON.stringify(attach.data!.errors));

  let rs = await rollState(rollId);
  check("HOP4 top IN_PRODUCTION", rs.status === RollStatus.IN_PRODUCTION, rs.status);
  check("HOP4 top PROCESS_QC adımında (currentStepId)", rs.currentStepId === processStepId);
  check("HOP4 PROCESS_QC adımı ACTIVE (top girdi)", (await stepStatusOf(processStepId)) === StepStatus.ACTIVE);
  check("HOP4 WO IN_PROGRESS (üretim başladı)", (await woStatusOf(woId)) === WorkOrderStatus.IN_PROGRESS);

  // ===========================================================================
  // HOP 5a — Kurşun + KK2: completeQc2 (KURSUN_APPLIED + QC2_COMPLETED)
  // ===========================================================================
  const qc2 = await kursun.completeQc2({ rollId, stepId: processStepId }, userId);
  check("HOP5a completeQc2 başarılı", qc2.success === true);

  const qc2Done = await prisma.rollOperation.count({
    where: { rollId, workOrderStepId: processStepId, operationType: RollOperationType.QC2_COMPLETED },
  });
  check("HOP5a QC2_COMPLETED log'u yazıldı", qc2Done === 1, `count=${qc2Done}`);
  const kursunDone = await prisma.rollOperation.count({
    where: { rollId, workOrderStepId: processStepId, operationType: RollOperationType.KURSUN_APPLIED },
  });
  check("HOP5a KURSUN_APPLIED otomatik (istasyon KURSUN yetenekli)", kursunDone === 1, `count=${kursunDone}`);

  // ===========================================================================
  // HOP 5b — finishStep: PROCESS_QC kapanır, top TAMBUR'a ilerler
  // ===========================================================================
  const finishProc = await kursun.finishStep({ stepId: processStepId }, userId);
  check("HOP5b finishStep 1 top taşıdı", finishProc.data!.movedRollCount === 1, `moved=${finishProc.data!.movedRollCount}`);
  check("HOP5b PROCESS_QC adımı COMPLETED", (await stepStatusOf(processStepId)) === StepStatus.COMPLETED);

  rs = await rollState(rollId);
  check("HOP5b top TAMBUR adımına geçti (currentStepId)", rs.currentStepId === tamburStepId);
  check("HOP5b top hâlâ IN_PRODUCTION (Tambur kararı bekliyor)", rs.status === RollStatus.IN_PRODUCTION, rs.status);
  check("HOP5b TAMBUR adımı ACTIVE (top girdi)", (await stepStatusOf(tamburStepId)) === StepStatus.ACTIVE);

  // Tambur listesinde gerçekten görünüyor mu? (kart okutma yolu da çalışsın)
  const tStep = await tambur.getStep(tamburStepId);
  check("HOP5b Tambur ekranında 1 açık top listeleniyor",
    tStep.data!.rolls.length === 1 && tStep.data!.rolls[0].rollId === rollId,
    `rolls=${tStep.data!.rolls.length}`);

  // ===========================================================================
  // HOP 6 — Tambur finalize (final karar): hatasız top, tek kesim → WAREHOUSE
  // ===========================================================================
  const fin = await tambur.finalize(
    {
      rollId,
      decisions: [],
      cuts: [{ length: CUT_LEN, qualityGrade: "1.KALITE", relatedErrorIds: [] }],
      foldType: "2-KAT",
    },
    userId,
  );
  check("HOP6 finalize başarılı", fin.success === true);

  // Parent retire + child(ler) doğrula.
  const parent = await rollState(rollId);
  check("HOP6 parent TAMBUR_CONSUMED (emekliye ayrıldı)", parent.status === RollStatus.TAMBUR_CONSUMED, parent.status);
  check("HOP6 parent currentQty=0", Number(parent.currentQty) === 0, `qty=${parent.currentQty}`);
  check("HOP6 parent adımdan çıktı (currentStepId null)", parent.currentStepId === null);

  const children = await prisma.roll.findMany({
    where: { parentRollId: rollId, entrySource: "TAMBUR_SPLIT" },
    orderBy: { createdAt: "asc" },
    select: { id: true, status: true, currentQty: true, qualityGrade: true, width: true, itemId: true, colorId: true },
  });
  for (const c of children) createdRollIds.push(c.id);

  // CUT_LEN=90 kesim + RAW_QTY-CUT_LEN=30 kalan kuyruk → 2 child top, ikisi de WAREHOUSE (1.KALITE).
  check("HOP6 2 child top oluştu (kesim + kalan kuyruk)", children.length === 2, `child=${children.length}`);
  check("HOP6 tüm child'lar WAREHOUSE'a indi (depo)", children.every((c) => c.status === RollStatus.WAREHOUSE),
    children.map((c) => c.status).join(","));
  const shipChild = children.find((c) => Number(c.currentQty) === CUT_LEN);
  check("HOP6 kesilen top metrajı = CUT_LEN", !!shipChild, `qtys=${children.map((c) => c.currentQty).join(",")}`);
  check("HOP6 child eni WO eninden damgalandı", children.every((c) => Number(c.width) === WIDTH));
  check("HOP6 child sipariş spec'iyle eşleşir (item + renksiz)",
    children.every((c) => c.itemId === item.id && c.colorId === null));

  // Tambur son üretim adımı: WO + adım + kart kapanmalı.
  check("HOP6 TAMBUR adımı COMPLETED", (await stepStatusOf(tamburStepId)) === StepStatus.COMPLETED);
  check("HOP6 WO COMPLETED (son üretim adımı bitti)", (await woStatusOf(woId)) === WorkOrderStatus.COMPLETED);
  const activeCards = await prisma.travelerCard.count({ where: { workOrderId: woId, status: "ACTIVE" } });
  check("HOP6 refakat kartı ACTIVE kalmadı (kapandı)", activeCards === 0, `aktifKart=${activeCards}`);

  const shipChildId = shipChild!.id;
  const shipChildBarcode = (await prisma.roll.findUnique({
    where: { id: shipChildId },
    select: { barcode: true },
  }))!.barcode!;

  // ===========================================================================
  // HOP 7 — Sevkiyat (ÇUVAL DEPO): çuval aç → okut → (tart) → sevkiyat → dispatch
  // ===========================================================================
  // Onay bayrağı AÇIK → createShipment PLANNED kurar (doğrudan sevk etmez). Böylece
  // PLANNED'de shippedQty=0 + ayrı dispatchShipment ile DISPATCHED'e terfi granülerliği
  // test edilir. (Onay kapalı olsaydı createShipment tek adımda DISPATCHED ederdi — bkz.
  // test_sack_pool_lifecycle.) Kapı önü / AT_DOOR ara adımı YOK.
  await prisma.systemSetting.upsert({
    where: { key: "shipping.confirmationEnabled" },
    update: { value: true },
    create: { key: "shipping.confirmationEnabled", value: true },
  });

  // 7.1 — Müşteriye çuval aç (çuval MÜŞTERİYE ait) + kesilen topu çuvala okut.
  const openRes = (await ship.openSack({ customerId: customer.id }, userId)) as { data: { id: string } };
  const sackId = openRes.data.id;
  createdSackIds.push(sackId);
  await ship.scanIntoSack({ sackId, barcode: shipChildBarcode }, userId);

  let cs = await rollState(shipChildId);
  check("HOP7 çuvallanan top çuvala bağlandı (sackId set, sevkiyatsız)",
    cs.sackId === sackId && !cs.shipmentId, `sackId=${cs.sackId} shipmentId=${cs.shipmentId}`);
  check("HOP7 çuvalda ama hâlâ WAREHOUSE (mühür/sevk stok düşmedi)", cs.status === RollStatus.WAREHOUSE, cs.status);

  // 7.2 — Tart (opsiyonel) → çuval DEPODA kalır; mühür/rezerv YOK.
  await ship.weighSack({ sackId, weightKg: 38 }, userId);
  const weighed = await prisma.sack.findUnique({ where: { id: sackId }, select: { weightKg: true, shipmentId: true } });
  check("HOP7a tartıldı + çuval depoda (mühür/rezerv YOK)", Number(weighed?.weightKg) === 38 && weighed?.shipmentId === null, `kg=${weighed?.weightKg} ship=${weighed?.shipmentId}`);
  check("HOP7a shippedQty hâlâ 0 (sevk DISPATCH'te işlenir)", (await shippedQtyOf(lineId)) === 0, `shippedQty=${await shippedQtyOf(lineId)}`);
  cs = await rollState(shipChildId);
  check("HOP7a top hâlâ WAREHOUSE (stok DISPATCH'te düşer)", cs.status === RollStatus.WAREHOUSE, cs.status);
  // Tahsis yalnız sevkte yazılır → sipariş henüz APPROVED (gerçek sevk/tahsis yok).
  check("HOP7a sipariş APPROVED (henüz sevk/tahsis yok)",
    (await orderStatusOf(order.id)) === OrderStatus.APPROVED, await orderStatusOf(order.id));

  // 7.3 — Depodan çuval + sipariş seçerek sevkiyat kur (PLANNED). Tahsis sevk anında yazılır.
  const shipmentRes = (await ship.createShipment({ sackIds: [sackId], customerId: customer.id, orderIds: [order.id] }, userId)) as { data: { id: string } };
  const shipmentId = shipmentRes.data.id;
  createdShipmentIds.push(shipmentId);
  check("HOP7b sevkiyat oluştu, status=PLANNED", (await shipmentStatusOf(shipmentId)) === ShipmentStatus.PLANNED, await shipmentStatusOf(shipmentId));
  check("HOP7b SackAllocation=CUT_LEN yazıldı (shippedQty'ye SAYILMAZ)", (await allocOf(lineId)) === CUT_LEN, `alloc=${await allocOf(lineId)}`);
  check("HOP7b PLANNED'de shippedQty hâlâ 0 (düşüş dispatch'te)", (await shippedQtyOf(lineId)) === 0, `shippedQty=${await shippedQtyOf(lineId)}`);
  check("HOP7b ShipmentOrder seçilen siparişten kuruldu", (await prisma.shipmentOrder.count({ where: { shipmentId } })) === 1);
  cs = await rollState(shipChildId);
  check("HOP7b top sevkiyata bağlandı (shipmentId set), hâlâ WAREHOUSE",
    !!cs.shipmentId && cs.status === RollStatus.WAREHOUSE, `shipmentId=${cs.shipmentId} status=${cs.status}`);

  // 7.4 — Sevk (DISPATCHED): PLANNED → dispatchShipment; toplar SHIPPED, tahsis → shippedQty
  // terfi. Kapı önü / AT_DOOR ara adımı YOK — PLANNED doğrudan DISPATCHED'e geçer.
  await ship.dispatchShipment(shipmentId, { plateNumber: `34 E2E ${STAMP.slice(-3)}` }, userId);
  check("HOP7d dispatch → DISPATCHED", (await shipmentStatusOf(shipmentId)) === ShipmentStatus.DISPATCHED);
  check("HOP7d shippedQty=CUT_LEN (terfi)", (await shippedQtyOf(lineId)) === CUT_LEN, `shippedQty=${await shippedQtyOf(lineId)}`);
  cs = await rollState(shipChildId);
  check("HOP7d fiziksel stok çıktı: top SHIPPED", cs.status === RollStatus.SHIPPED, cs.status);

  // ===========================================================================
  // HOP 8 — Sipariş tam karşılandı → COMPLETED; kalan kuyruk top depoda serbest
  // ===========================================================================
  check("HOP8 sipariş DISPATCH sonrası COMPLETED (tam karşılandı, tolerans içinde)",
    (await orderStatusOf(order.id)) === OrderStatus.COMPLETED, await orderStatusOf(order.id));
  // Sevkte kullanılmayan kalan kuyruk top depoda serbest (çuvalsız/sevksiz) kalmalı.
  const tailChild = children.find((c) => c.id !== shipChildId)!;
  const tailState = await rollState(tailChild.id);
  check("HOP8 kalan kuyruk top depoda serbest (WAREHOUSE, sevksiz/çuvalsız)",
    tailState.status === RollStatus.WAREHOUSE && !tailState.shipmentId && !tailState.sackId,
    `status=${tailState.status} ship=${tailState.shipmentId} sack=${tailState.sackId}`);

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

async function cleanup(): Promise<void> {
  console.log("\n🧹 Temizlik...");
  try {
    // HOP7 için açtığımız sevk onayı bayrağını varsayılana (KAPALI) döndür — paylaşımlı dev DB.
    await prisma.systemSetting
      .upsert({ where: { key: "shipping.confirmationEnabled" }, update: { value: false }, create: { key: "shipping.confirmationEnabled", value: false } })
      .catch(() => {});
    // Ters bağımlılık sırası (çuval havuzu): SackAllocation (Restrict) → roll↔çuval/sevkiyat
    // bağını çöz → sack → ShipmentOrder (Restrict) → shipment → roll → WO → orderLine → order.
    await prisma.sackAllocation.deleteMany({ where: { sackId: { in: createdSackIds } } }).catch(() => {});
    await prisma.roll.updateMany({ where: { id: { in: createdRollIds } }, data: { shipmentId: null, sackId: null } }).catch(() => {});
    await prisma.sack.deleteMany({ where: { id: { in: createdSackIds } } }).catch(() => {});
    await prisma.shipmentOrder.deleteMany({ where: { shipmentId: { in: createdShipmentIds } } }).catch(() => {});
    await prisma.shipment.deleteMany({ where: { id: { in: createdShipmentIds } } }).catch(() => {});

    if (createdRollIds.length > 0) {
      await prisma.rollOperation.deleteMany({ where: { rollId: { in: createdRollIds } } }).catch(() => {});
      await prisma.rollMovement.deleteMany({ where: { rollId: { in: createdRollIds } } }).catch(() => {});
      await prisma.rollProperty.deleteMany({ where: { rollId: { in: createdRollIds } } }).catch(() => {});
      await prisma.rollError.deleteMany({ where: { rollId: { in: createdRollIds } } }).catch(() => {});
      await prisma.systemLog.deleteMany({ where: { recordId: { in: createdRollIds } } }).catch(() => {});
      // parentRollId self-FK: child'ları (parentRollId set) önce sil.
      await prisma.roll.deleteMany({ where: { id: { in: createdRollIds }, parentRollId: { not: null } } }).catch(() => {});
      await prisma.roll.deleteMany({ where: { id: { in: createdRollIds } } }).catch(() => {});
    }

    for (const woId of createdWoIds) {
      await prisma.travelerCardScan.deleteMany({ where: { card: { workOrderId: woId } } }).catch(() => {});
      await prisma.travelerCard.deleteMany({ where: { workOrderId: woId } }).catch(() => {});
      await prisma.workOrderToOrderLine.deleteMany({ where: { workOrderId: woId } }).catch(() => {});
      await prisma.workOrderStep.deleteMany({ where: { workOrderId: woId } }).catch(() => {});
      await prisma.systemLog.deleteMany({ where: { recordId: woId } }).catch(() => {});
      await prisma.workOrder.delete({ where: { id: woId } }).catch(() => {});
    }

    for (const orderId of createdOrderIds) {
      await prisma.orderLine.deleteMany({ where: { orderId } }).catch(() => {});
      await prisma.order.delete({ where: { id: orderId } }).catch(() => {});
    }
    console.log("🧹 Temizlik tamam.");
  } catch (e) {
    console.error("Temizlik hatası:", e instanceof Error ? e.message : e);
  }
}

main()
  .catch((e) => {
    console.error("TEST HATASI:", e);
    fail++;
  })
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
    process.exit(fail > 0 ? 1 : 0);
  });
