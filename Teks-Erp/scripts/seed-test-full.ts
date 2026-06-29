// =============================================================================
// KAPSAMLI TEST VERİSİ — "her şeyi test edebileceğin" tanımlar + operasyonlar
// =============================================================================
// Mevcut verinin ÜSTÜNE ekler (hiçbir şey silmez). Master data'yı DOĞAL ANAHTAR
// ile (kod/isim) çözer → yeniden seed'lenmiş DB'lerde de sabit UUID'ye bağlı
// kalmaz. Operasyonel kayıtlar benzersiz bir "stamp" ile yazılır; tekrar
// çalıştırılırsa çakışmadan yeni bir set daha ekler.
//
// Çalıştır:  npx ts-node --project prisma/tsconfig.json scripts/seed-test-full.ts
//
// Üretilenler:
//   A. TANIMLAR  — 3 yeni kumaş (Krinkle/Süet/Polar) + izinli renk/özellik;
//                  3 ürün reçetesi (idempotent, upsert)
//   B. SİPARİŞ   — 4 sipariş (PENDING/APPROVED/PARTIAL_SHIPPED) satır+şube+özellik
//   C. ÜRETİM WO — TEK iş emrinde tüm istasyonlarda aksiyon (KK1 / Fason Sevk /
//                  Fason Kabul / Kurşun-KK2 / Tambur / Depo) + 4 fason dalı
//   D. WO (sipariş bağlı) — erken aşama ORDER_PRODUCTION (KK1'de bekliyor)
//   E. WO (tamamlanmış)   — tüm toplar depoda, COMPLETED (rapor/kapalı WO testi)
//   F. KARTELA   — 1 açık sevk (Kabul bekliyor) + 1 tamamlanmış kabul (kartela doğdu)
//   G. İADE      — DISPATCHED sevkiyat + SHIPPED toplar (mobil İade Girişi taraması)
// =============================================================================

import prisma from "../src/lib/prisma";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { WorkOrderService } from "../src/services/workorder.service";
import { KartelaService } from "../src/services/kartela.service";
import { ItemType, ItemUnit, RollStatus, OrderStatus, Currency } from "@prisma/client";

const sub = new SubcontractorService();
const cards = new TravelerCardService();
const kartela = new KartelaService();

// Benzersiz çalıştırma damgası (tekrar çalıştırınca çakışma yok).
const STAMP = `${Date.now()}`.slice(-6);

// ---------------------------------------------------------------------------
// Master data resolver — doğal anahtarla çöz, yoksa anlaşılır hata ver.
// ---------------------------------------------------------------------------
function req<T>(v: T | null | undefined, what: string): T {
  if (v === null || v === undefined) {
    throw new Error(`Master data eksik: ${what} bulunamadı. Önce \`npm run seed\` çalıştır.`);
  }
  return v;
}

const M = {
  adminId: "",
  // stations
  kk1: "", boya: "", zimpara: "", kursun: "", tambur: "",
  // grades
  grade1: "", gradeA1: "", gradeFire: "",
  // colors
  lacivert: "", siyah: "", mavi: "", kirmizi: "", beyaz: "", bej: "",
  // items
  patos: "",
  // subcontractor + category
  boyaCatId: "", boyerId: "",
  kartelaSubId: "",
  // customers + branches
  arda: "", ardaIst: "", moda: "", modaIzmir: "", beyazGiyim: "", yesil: "",
  // properties
  propKursunlu: "", propParlak: "", propZimparali: "", propAntibak: "",
};

async function resolveMaster(): Promise<void> {
  const admin = req(await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }), "admin kullanıcı");
  M.adminId = admin.id;

  const st = await prisma.station.findMany({ select: { id: true, name: true, kind: true } });
  M.kk1 = req(st.find((s) => s.kind === "RAW_QC"), "KK1 istasyonu").id;
  M.kursun = req(st.find((s) => s.kind === "PROCESS_QC"), "Kurşun+KK2 istasyonu").id;
  M.tambur = req(st.find((s) => s.kind === "TAMBUR"), "Tambur istasyonu").id;
  M.boya = req(st.find((s) => s.name.includes("Boyahane")), "Boyahane (Fason) istasyonu").id;
  M.zimpara = req(st.find((s) => s.name.includes("Zımpara")), "Zımpara (Fason) istasyonu").id;

  const grades = await prisma.qualityGrade.findMany({ select: { id: true, code: true } });
  M.grade1 = req(grades.find((g) => g.code === "1.KALITE"), "1.KALITE").id;
  M.gradeA1 = req(grades.find((g) => g.code === "A1"), "A1").id;
  M.gradeFire = req(grades.find((g) => g.code === "FIRE"), "FIRE").id;

  const colors = await prisma.color.findMany({ select: { id: true, code: true } });
  const c = (code: string) => req(colors.find((x) => x.code === code), `renk ${code}`).id;
  M.lacivert = c("LACIVERT"); M.siyah = c("SIYAH"); M.mavi = c("MAVI");
  M.kirmizi = c("KIRMIZI"); M.beyaz = c("BEYAZ"); M.bej = c("BEJ");

  M.patos = req(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "PATOS ürünü").id;

  const boyaCat = req(await prisma.subcontractorCategory.findFirst({ where: { name: "Boyahane" }, select: { id: true } }), "Boyahane kategorisi");
  M.boyaCatId = boyaCat.id;
  M.boyerId = req(await prisma.subcontractor.findFirst({ where: { name: { contains: "Boyer" } }, select: { id: true } }), "Boyer Boyacılık").id;
  M.kartelaSubId = req(await prisma.subcontractor.findFirst({ where: { name: { contains: "Kartela" } }, select: { id: true } }), "Kartela A.Ş.").id;

  const custs = await prisma.customer.findMany({ select: { id: true, code: true } });
  const cu = (code: string) => req(custs.find((x) => x.code === code), `müşteri ${code}`).id;
  M.arda = cu("MUS-001"); M.moda = cu("MUS-002"); M.beyazGiyim = cu("MUS-003"); M.yesil = cu("MUS-004");

  const branches = await prisma.customerBranch.findMany({ select: { id: true, name: true, customerId: true } });
  M.ardaIst = req(branches.find((b) => b.customerId === M.arda && b.name.includes("İstanbul")), "Arda İstanbul şube").id;
  M.modaIzmir = req(branches.find((b) => b.customerId === M.moda), "Moda şube").id;

  const props = await prisma.fabricProperty.findMany({ select: { id: true, name: true } });
  const p = (name: string) => req(props.find((x) => x.name === name), `özellik ${name}`).id;
  M.propKursunlu = p("Kurşunlu"); M.propParlak = p("Parlak");
  M.propZimparali = p("Zımparalı"); M.propAntibak = p("Antibakteriyel");
}

// ---------------------------------------------------------------------------
// Barkod üretici (benzersiz)
// ---------------------------------------------------------------------------
let bc = 0;
function barcode(): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  bc++;
  const rand = Math.floor(Math.random() * 0xffffff).toString(16).toUpperCase().padStart(6, "0");
  return `TST${STAMP}-${ymd}-${rand}${bc}`;
}

// Bir adımda (WorkOrderStep) duran top — açık RollMovement ile.
async function placeRoll(opts: {
  itemId: string; colorId?: string | null; width: number; qty: number;
  stepId: string | null; status: RollStatus; producedInStepId?: string | null; batchSplitId?: string | null;
}): Promise<string> {
  const r = await prisma.roll.create({
    data: {
      barcode: barcode(), itemId: opts.itemId, colorId: opts.colorId ?? null,
      initialQty: opts.qty, currentQty: opts.qty, status: opts.status,
      qualityGrade: "1.KALITE", qualityGradeId: M.grade1, width: opts.width,
      currentStepId: opts.stepId, producedInStepId: opts.producedInStepId ?? null,
      batchSplitId: opts.batchSplitId ?? null, createdById: M.adminId,
    },
  });
  if (opts.stepId) {
    await prisma.rollMovement.create({ data: { rollId: r.id, workOrderStepId: opts.stepId, qtyIn: opts.qty, operatorId: M.adminId } });
  }
  return r.id;
}

// Serbest ham stok top.
async function stockRoll(itemId: string, width: number, qty: number): Promise<string> {
  const r = await prisma.roll.create({
    data: {
      barcode: barcode(), itemId, initialQty: qty, currentQty: qty, status: RollStatus.STOCK,
      qualityGrade: "1.KALITE", qualityGradeId: M.grade1, width, createdById: M.adminId,
    },
  });
  return r.id;
}

// Topu bir adımdan sonrakine ilerlet.
async function advance(rollId: string, fromStep: string, toStep: string): Promise<void> {
  const r = await prisma.roll.findUnique({ where: { id: rollId }, select: { currentQty: true } });
  await prisma.rollMovement.updateMany({ where: { rollId, workOrderStepId: fromStep, exitedAt: null }, data: { exitedAt: new Date(), qtyOut: r!.currentQty } });
  await prisma.roll.update({ where: { id: rollId }, data: { currentStepId: toStep } });
  await prisma.rollMovement.create({ data: { rollId, workOrderStepId: toStep, qtyIn: r!.currentQty, operatorId: M.adminId } });
}

// =============================================================================
// A. TANIMLAR — yeni kumaşlar + izinli renk/özellik + reçeteler
// =============================================================================
async function seedDefinitions(): Promise<void> {
  const allColors = [M.lacivert, M.siyah, M.mavi, M.kirmizi, M.beyaz, M.bej];
  const defs = [
    { code: "KRINKLE", name: "KRİNKLE", colors: [M.siyah, M.lacivert, M.mavi], props: [M.propParlak, M.propKursunlu] },
    { code: "SUET", name: "SÜET", colors: [M.beyaz, M.bej, M.kirmizi], props: [M.propZimparali, M.propAntibak] },
    { code: "POLAR", name: "POLAR", colors: allColors, props: [M.propZimparali] },
  ];

  for (const d of defs) {
    const item = await prisma.item.upsert({
      where: { code: d.code },
      update: { name: d.name, isActive: true },
      create: { code: d.code, name: d.name, itemType: ItemType.FABRIC, unit: ItemUnit.MT },
    });
    // izinli renk/özellik — idempotent (sil + yeniden yaz)
    await prisma.itemAllowedColor.deleteMany({ where: { itemId: item.id } });
    await prisma.itemAllowedColor.createMany({ data: d.colors.map((colorId) => ({ itemId: item.id, colorId })) });
    await prisma.itemAllowedProperty.deleteMany({ where: { itemId: item.id } });
    await prisma.itemAllowedProperty.createMany({ data: d.props.map((propertyId) => ({ itemId: item.id, propertyId })) });
  }

  // Reçeteler (route'a bağlı değil; basit tanım)
  const standartRoute = await prisma.route.findFirst({ where: { name: { contains: "Standart" } }, select: { id: true } });
  const recipes = [
    { code: "RCP-PATOS-LAC", name: "Patos Lacivert 250", itemId: M.patos, colorId: M.lacivert, width: 250 },
    { code: "RCP-KRINKLE-SIY", name: "Krinkle Siyah 180", itemCode: "KRINKLE", colorId: M.siyah, width: 180 },
    { code: "RCP-SUET-BEY", name: "Süet Beyaz 150", itemCode: "SUET", colorId: M.beyaz, width: 150 },
  ];
  for (const r of recipes) {
    const itemId = r.itemId ?? (await prisma.item.findFirst({ where: { code: r.itemCode! }, select: { id: true } }))!.id;
    await prisma.productRecipe.upsert({
      where: { code: r.code },
      update: { name: r.name, itemId, colorId: r.colorId, width: r.width, routeId: standartRoute?.id ?? null, isActive: true },
      create: { code: r.code, name: r.name, itemId, colorId: r.colorId, width: r.width, routeId: standartRoute?.id ?? null },
    });
  }
  console.log("✓ A. Tanımlar: 3 kumaş (Krinkle/Süet/Polar) + izinli renk/özellik + 3 reçete");
}

// =============================================================================
// B. SİPARİŞLER
// =============================================================================
async function seedOrders(): Promise<{ ardaOrderId: string; ardaPatosLineId: string }> {
  const krinkle = (await prisma.item.findFirst({ where: { code: "KRINKLE" }, select: { id: true } }))!.id;
  const suet = (await prisma.item.findFirst({ where: { code: "SUET" }, select: { id: true } }))!.id;
  const polar = (await prisma.item.findFirst({ where: { code: "POLAR" }, select: { id: true } }))!.id;

  // 1) Arda — APPROVED, 2 satır (Patos/Lacivert + Krinkle/Siyah), şube + özellik + kesim
  const arda = await prisma.order.create({
    data: {
      orderNumber: `ORD-${STAMP}-A`, customerId: M.arda, branchId: M.ardaIst,
      currency: Currency.TRY, status: OrderStatus.APPROVED,
      deadline: new Date(Date.now() + 21 * 86400000),
      lines: {
        create: [
          { itemId: M.patos, colorId: M.lacivert, quantity: 1500, width: 250, pieceLengthM: 400, unitPrice: 85,
            requiredProperties: { create: [{ propertyId: M.propKursunlu }] } },
          { itemId: krinkle, colorId: M.siyah, quantity: 800, width: 180, unitPrice: 92,
            requiredProperties: { create: [{ propertyId: M.propParlak }] } },
        ],
      },
    },
    include: { lines: true },
  });
  const ardaPatosLine = arda.lines.find((l) => l.itemId === M.patos)!;

  // 2) Moda — APPROVED, Patos/Mavi 2000m
  await prisma.order.create({
    data: {
      orderNumber: `ORD-${STAMP}-B`, customerId: M.moda, branchId: M.modaIzmir,
      currency: Currency.USD, status: OrderStatus.APPROVED, deadline: new Date(Date.now() + 30 * 86400000),
      lines: { create: [{ itemId: M.patos, colorId: M.mavi, quantity: 2000, width: 250, pieceLengthM: 500, unitPrice: 3.2 }] },
    },
  });

  // 3) Beyaz Giyim — PENDING (onay bekliyor), Süet/Beyaz 1200m
  await prisma.order.create({
    data: {
      orderNumber: `ORD-${STAMP}-C`, customerId: M.beyazGiyim, currency: Currency.TRY, status: OrderStatus.PENDING,
      lines: { create: [{ itemId: suet, colorId: M.beyaz, quantity: 1200, width: 150, unitPrice: 110,
        requiredProperties: { create: [{ propertyId: M.propZimparali }] } }] },
    },
  });

  // 4) Yeşil Tekstil — PARTIAL_SHIPPED, Polar/Kırmızı 900m (300 sevk edilmiş)
  await prisma.order.create({
    data: {
      orderNumber: `ORD-${STAMP}-D`, customerId: M.yesil, currency: Currency.EUR, status: OrderStatus.PARTIAL_SHIPPED,
      shippedQty: 300,
      lines: { create: [{ itemId: polar, colorId: M.kirmizi, quantity: 900, width: 220, shippedQty: 300, unitPrice: 4.5 }] },
    },
  });

  console.log("✓ B. Siparişler: 4 sipariş (APPROVED×2 / PENDING / PARTIAL_SHIPPED), satır+şube+özellik");
  return { ardaOrderId: arda.id, ardaPatosLineId: ardaPatosLine.id };
}

// =============================================================================
// C. ÜRETİM WO — tüm istasyonlarda aksiyonlu zengin senaryo (Patos/Lacivert/250)
// =============================================================================
async function seedProductionWO(): Promise<string> {
  const WIDTH = 250, ITEM = M.patos, COLOR = M.lacivert;
  const WS = { kk1: "", boya: "", kursun: "", tambur: "" };

  const wo = await prisma.workOrder.create({
    data: {
      batchNumber: `WO-${STAMP}-FULL`, type: "STOCK_PRODUCTION", status: "IN_PROGRESS",
      width: WIDTH, targetQuantity: 5000, targetItemId: ITEM, targetColorId: COLOR,
      plannedEndDate: new Date(Date.now() + 14 * 86400000),
      targetProperties: { create: [{ propertyId: M.propKursunlu }] },
      steps: {
        create: [
          { stationId: M.kk1, stepSequence: 1, status: "ACTIVE" },
          { stationId: M.boya, stepSequence: 2, status: "ACTIVE", requiredCategoryId: M.boyaCatId, plannedSubcontractorId: M.boyerId, notes: "Lacivert — ton tutturulması önemli. Numune onaylı." },
          { stationId: M.kursun, stepSequence: 3, status: "ACTIVE" },
          { stationId: M.tambur, stepSequence: 4, status: "ACTIVE" },
        ],
      },
    },
    include: { steps: true },
  });
  for (const s of wo.steps) {
    if (s.stationId === M.kk1) WS.kk1 = s.id;
    else if (s.stationId === M.boya) WS.boya = s.id;
    else if (s.stationId === M.kursun) WS.kursun = s.id;
    else if (s.stationId === M.tambur) WS.tambur = s.id;
  }
  await prisma.$transaction((tx) => cards.createForWorkOrder(tx, wo.id, M.adminId));

  // Fason dalı yardımcı (boyahaneye sevk; receive ise born roll → Kurşun adımına çıkar)
  async function fasonWave(count: number, qty: number, receive: boolean): Promise<{ dispatchNo: string; bornId: string | null }> {
    const rollIds: string[] = [];
    for (let i = 0; i < count; i++) rollIds.push(await stockRoll(ITEM, WIDTH, qty));
    const d = await sub.dispatch({ workOrderId: wo.id, stepId: WS.boya, subcontractorId: M.boyerId, rollIds }, M.adminId);
    const dispatchNo = (d.data as { dispatchNo: string }).dispatchNo;
    if (!receive) return { dispatchNo, bornId: null };
    const bornQty = Math.round(qty * count * 0.96);
    await sub.receive({ workOrderId: wo.id, stepId: WS.boya, subcontractorId: M.boyerId, returns: rollIds.map((rollId) => ({ rollId })), newRolls: [{ qty: bornQty }] }, M.adminId);
    const born = await prisma.roll.findFirst({
      where: { parentReceipt: { workOrderId: wo.id }, currentStepId: WS.kursun, status: RollStatus.IN_PRODUCTION, parentRollId: null },
      orderBy: { createdAt: "desc" }, select: { id: true },
    });
    return { dispatchNo, bornId: born?.id ?? null };
  }

  // 1) KK1'de bekleyen ham toplar
  await placeRoll({ itemId: ITEM, width: WIDTH, qty: 320, stepId: WS.kk1, status: RollStatus.IN_PRODUCTION, producedInStepId: WS.kk1 });
  await placeRoll({ itemId: ITEM, width: WIDTH, qty: 280, stepId: WS.kk1, status: RollStatus.IN_PRODUCTION, producedInStepId: WS.kk1 });
  // 2) Boyahane adımında Fason Sevk bekleyen toplar (KK1 bitmiş)
  await placeRoll({ itemId: ITEM, width: WIDTH, qty: 300, stepId: WS.boya, status: RollStatus.IN_PRODUCTION, producedInStepId: WS.kk1 });
  await placeRoll({ itemId: ITEM, width: WIDTH, qty: 300, stepId: WS.boya, status: RollStatus.IN_PRODUCTION, producedInStepId: WS.kk1 });

  // 3) Fason dalları (farklı konumlarda)
  await fasonWave(2, 300, false);                                  // AÇIK — Fason Kabul bekliyor
  await fasonWave(2, 250, true);                                   // DÖNDÜ → Kurşun
  const atTambur = await fasonWave(2, 260, true);                  // DÖNDÜ → Tambur
  if (atTambur.bornId) await advance(atTambur.bornId, WS.kursun, WS.tambur);

  const done = await fasonWave(2, 250, true);                      // DÖNDÜ → Tambur kesimi → Depo
  if (done.bornId) {
    await advance(done.bornId, WS.kursun, WS.tambur);
    const born = await prisma.roll.findUnique({ where: { id: done.bornId }, select: { currentQty: true, batchSplitId: true } });
    const total = Number(born!.currentQty), half = Math.round(total / 2);
    await prisma.rollMovement.updateMany({ where: { rollId: done.bornId, workOrderStepId: WS.tambur, exitedAt: null }, data: { exitedAt: new Date(), qtyOut: total } });
    await prisma.roll.update({ where: { id: done.bornId }, data: { status: RollStatus.TAMBUR_CONSUMED, currentStepId: null, currentQty: 0 } });
    for (const q of [half, total - half]) {
      await prisma.roll.create({
        data: { barcode: barcode(), itemId: ITEM, colorId: COLOR, initialQty: q, currentQty: q, status: RollStatus.WAREHOUSE,
          qualityGrade: "1.KALITE", qualityGradeId: M.grade1, width: WIDTH, producedInStepId: WS.tambur, parentRollId: done.bornId,
          batchSplitId: born!.batchSplitId, createdById: M.adminId },
      });
    }
  }

  // 4) Serbest ham stok (KK1 / Hızlı İş Emri / Fason Sevk auto-attach testi)
  await stockRoll(ITEM, WIDTH, 500);
  await stockRoll(ITEM, WIDTH, 500);

  console.log(`✓ C. Üretim WO: ${wo.batchNumber} — KK1/Fason Sevk/Fason Kabul/Kurşun/Tambur/Depo hepsinde aksiyon + 4 fason dalı`);
  return wo.id;
}

// =============================================================================
// D. Sipariş-bağlı erken WO (ORDER_PRODUCTION — KK1'de bekliyor)
// =============================================================================
async function seedOrderLinkedWO(ardaPatosLineId: string): Promise<void> {
  const WIDTH = 250, ITEM = M.patos, COLOR = M.lacivert;
  const wo = await prisma.workOrder.create({
    data: {
      batchNumber: `WO-${STAMP}-ORD`, type: "ORDER_PRODUCTION", status: "IN_PROGRESS",
      width: WIDTH, targetQuantity: 1500, targetItemId: ITEM, targetColorId: COLOR,
      plannedEndDate: new Date(Date.now() + 18 * 86400000),
      targetProperties: { create: [{ propertyId: M.propKursunlu }] },
      orderLinks: { create: [{ orderLineId: ardaPatosLineId, allocatedQty: 1500 }] },
      steps: {
        create: [
          { stationId: M.kk1, stepSequence: 1, status: "ACTIVE" },
          { stationId: M.boya, stepSequence: 2, status: "ACTIVE", requiredCategoryId: M.boyaCatId, plannedSubcontractorId: M.boyerId, notes: "Arda siparişi — Kurşunlu istendi." },
          { stationId: M.kursun, stepSequence: 3, status: "ACTIVE" },
          { stationId: M.tambur, stepSequence: 4, status: "ACTIVE" },
        ],
      },
    },
    include: { steps: true },
  });
  await prisma.$transaction((tx) => cards.createForWorkOrder(tx, wo.id, M.adminId));
  const kk1Step = wo.steps.find((s) => s.stationId === M.kk1)!.id;
  // KK1'de bekleyen 2 ham + 2 serbest stok (girişe hazır)
  await placeRoll({ itemId: ITEM, width: WIDTH, qty: 400, stepId: kk1Step, status: RollStatus.IN_PRODUCTION, producedInStepId: kk1Step });
  await placeRoll({ itemId: ITEM, width: WIDTH, qty: 350, stepId: kk1Step, status: RollStatus.IN_PRODUCTION, producedInStepId: kk1Step });
  await stockRoll(ITEM, WIDTH, 600);
  console.log(`✓ D. Sipariş-bağlı WO: ${wo.batchNumber} (ORDER_PRODUCTION, KK1'de bekliyor, ${"ORD-" + STAMP + "-A"}'ya bağlı)`);
}

// =============================================================================
// E. Tamamlanmış WO — tüm toplar depoda, COMPLETED
// =============================================================================
async function seedCompletedWO(): Promise<void> {
  const WIDTH = 250, ITEM = M.patos, COLOR = M.mavi;
  const wo = await prisma.workOrder.create({
    data: {
      batchNumber: `WO-${STAMP}-DONE`, type: "STOCK_PRODUCTION", status: "COMPLETED",
      width: WIDTH, targetQuantity: 1200, targetItemId: ITEM, targetColorId: COLOR,
      plannedEndDate: new Date(Date.now() - 2 * 86400000),
      steps: {
        create: [
          { stationId: M.kk1, stepSequence: 1, status: "COMPLETED" },
          { stationId: M.boya, stepSequence: 2, status: "COMPLETED", requiredCategoryId: M.boyaCatId, plannedSubcontractorId: M.boyerId },
          { stationId: M.kursun, stepSequence: 3, status: "COMPLETED" },
          { stationId: M.tambur, stepSequence: 4, status: "COMPLETED" },
        ],
      },
    },
    include: { steps: true },
  });
  const tamburStep = wo.steps.find((s) => s.stationId === M.tambur)!.id;
  // 3 bitmiş depo topu (sevke/kartelaya hazır)
  for (const q of [380, 410, 360]) {
    await placeRoll({ itemId: ITEM, colorId: COLOR, width: WIDTH, qty: q, stepId: null, status: RollStatus.WAREHOUSE, producedInStepId: tamburStep });
  }
  console.log(`✓ E. Tamamlanmış WO: ${wo.batchNumber} (COMPLETED, 3 depo topu Patos/Mavi)`);
}

// =============================================================================
// F. KARTELA — 1 açık sevk (Kabul bekliyor) + 1 tamamlanmış kabul (kartela doğdu)
// =============================================================================
async function seedKartela(): Promise<void> {
  // Kartela için serbest depo topları üret (Patos/Lacivert, bitmiş)
  const warehouseRoll = async (qty: number) =>
    placeRoll({ itemId: M.patos, colorId: M.lacivert, width: 250, qty, stepId: null, status: RollStatus.WAREHOUSE, producedInStepId: null });

  // 1) AÇIK sevk — Kabul bekliyor
  const openRolls = [await warehouseRoll(120), await warehouseRoll(90)];
  const openD = await kartela.dispatch({ subcontractorId: M.kartelaSubId, rollIds: openRolls, driverName: "Ahmet Yılmaz", plateNumber: "34 KRT 001" }, M.adminId);

  // 2) TAMAMLANMIŞ kabul — kartelalar doğdu
  const doneRoll = await warehouseRoll(150);
  const doneD = await kartela.dispatch({ subcontractorId: M.kartelaSubId, rollIds: [doneRoll] }, M.adminId);
  await kartela.receive({
    subcontractorId: M.kartelaSubId, dispatchId: (doneD.data as { id: string }).id, manifestNo: `KRT-MANIFEST-${STAMP}`,
    returns: [{ rollId: doneRoll, count: 12, bulkLengthCm: 30, bulkWeightKg: 0.15 }],
  }, M.adminId);

  console.log(`✓ F. Kartela: açık sevk ${(openD.data as { dispatchNo: string }).dispatchNo} (Kabul bekliyor) + tamamlanmış kabul (12 kartela doğdu)`);
}

// =============================================================================
// G. İADE hazır — DISPATCHED sevkiyat + SHIPPED toplar (mobil İade Girişi taraması)
// =============================================================================
async function seedReturnReady(ardaOrderId: string): Promise<void> {
  const shipment = await prisma.shipment.create({
    data: {
      shipmentNo: `SHP-${STAMP}-IADE`, customerId: M.arda, branchId: M.ardaIst, status: "DISPATCHED",
      plateNumber: "34 SVK 042", driverName: "Mehmet Demir", readyAt: new Date(Date.now() - 5 * 86400000), dispatchedAt: new Date(Date.now() - 4 * 86400000),
      orders: { create: [{ orderId: ardaOrderId }] },
    },
  });
  // SHIPPED toplar (Patos/Lacivert/250 — Arda Patos satırının spec'iyle eşleşir → aday sipariş çıkar)
  for (const q of [250, 230, 240]) {
    await prisma.roll.create({
      data: { barcode: barcode(), itemId: M.patos, colorId: M.lacivert, initialQty: q, currentQty: q, status: RollStatus.SHIPPED,
        qualityGrade: "1.KALITE", qualityGradeId: M.grade1, width: 250, shipmentId: shipment.id, createdById: M.adminId },
    });
  }
  console.log(`✓ G. İade hazır: ${shipment.shipmentNo} (DISPATCHED) + 3 SHIPPED top — mobil İade Girişi'nde okutulabilir`);
}

// =============================================================================
(async () => {
  console.log(`\n🌱 Kapsamlı test verisi yükleniyor (damga: ${STAMP})…\n`);
  await resolveMaster();
  await seedDefinitions();
  const { ardaOrderId, ardaPatosLineId } = await seedOrders();
  const fullWoId = await seedProductionWO();
  await seedOrderLinkedWO(ardaPatosLineId);
  await seedCompletedWO();
  await seedKartela();
  await seedReturnReady(ardaOrderId);

  // Özet — üretim WO dalları
  const branches = await new WorkOrderService().getBranches(fullWoId);
  console.log(`\n✅ Bitti. Üretim WO (WO-${STAMP}-FULL) dalları:`);
  for (const b of (branches.data as { branches: Array<Record<string, unknown>> }).branches) {
    const pos = (b.currentPositions as Array<{ label: string; count: number; totalMeters: number }> | undefined)
      ?.map((p) => `${p.label}:${p.count}/${p.totalMeters}m`).join(", ") || "fasonda";
    console.log(`   ${b.dispatchNo} ${String(b.status).padEnd(9)} → ${pos}`);
  }
  console.log(`\n   Test kullanıcı: admin / 123123`);
  console.log(`   Electron : İş Emirleri → WO-${STAMP}-FULL → "Tam Ekran Aç" (dağılım şeridi + dallar)`);
  console.log(`   Mobil    : refakat kartını okut → KK1 / Fason Sevk / Fason Kabul / Kurşun / Tambur / Depo`);
  console.log(`   Sevkiyat : çuval-depo durumları için ayrıca \`npm run seed:sevkiyat\``);
  await prisma.$disconnect();
})().catch((e) => {
  console.error("HATA:", e);
  process.exit(1);
});
