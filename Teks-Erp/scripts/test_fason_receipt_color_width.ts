// TEST: Fason kabulünde RENK SEÇİMİ + EN ÖLÇÜMÜ (2026-08-05)
//
// SAHA VAKASI: `IE0508260006` iş emrinin 111 m'lik topu Boyer Tekstil'e gitti ve
// KABUL EDİLEMEDİ — iş emrinde hedef renk yoktu, ekranda da rengi seçmenin yolu
// yoktu. Geçmişte aynı duruma düşen 8 iş emri bulundu; hepsi CANCELLED.
//
// Kök neden TEK bir guard değil, ÜÇ KABUL YOLUNUN FARKLI DAVRANMASIYDI:
// guard `appliedColorId === undefined` bakıyor; mobil liste yolu `null` gönderip
// geçiyor (renk SESSİZCE siliniyor), kart-okutma yolu ve Electron alanı hiç
// göndermeyip 400 alıyordu — çünkü liste uçları `requiredCategory.appliesColor`
// taşımıyordu, istemci rengin sorulması gerektiğini BİLMİYORDU.
//
//   A1  Renksiz WO + appliedColorId → kabul GEÇER, doğan top rengi alır
//   A2  Renksiz WO + hiç renk bilgisi yok → guard hâlâ ısırır (400)
//   A3  appliedWidth makbuza VE doğan tüm toplara yazılır
//   A4  Öncelik: operatörün ölçümü kaynak topun eninden ÖNCE gelir
//   A5  Geri uyum: appliedWidth göndermeyen eski istemci → kaynak en miras alınır
//   B1  ⚠️ EN, appliesColor'dan BAĞIMSIZ — zımparada (renk vermeyen) da yazılır
//   C   Üç ucun ŞEKİL EŞİTLİĞİ — asıl saha bug'ının bekçisi
//
// ⚠️ Bu dosya `requiredCategoryId`'yi adıma YAZAN ilk fason kabul testidir. Diğer
// fason testleri onu boş bırakıyor → `appliesColor` hepsinde false → renk yolu
// bugüne dek HİÇ ölçülmedi. Kurulumdan o satırı çıkarma: test yeşil kalır ve
// hiçbir şey doğrulamaz.
//
// Çalıştır: npx tsx scripts/test_fason_receipt_color_width.ts
import prisma from "../src/lib/prisma";
import { ensureTestDyeHouse, ensureTestSander } from "./fixture-subcontractor";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { RollStatus } from "@prisma/client";
import { fixtureWarehouseId } from "./fixture-warehouse";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}
async function expectErr(label: string, code: number, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    check(label, false, "hata bekleniyordu, geçti");
  } catch (e) {
    const sc = (e as { statusCode?: number }).statusCode;
    check(label, sc === code, `statusCode ${sc}`);
  }
}

const sub = new SubcontractorService();
const cards = new TravelerCardService();

let ITEM = "", ADMIN = "", ST_BOYA = "", ST_ZIMPARA = "", ST_KURSUN = "";
let SUB_BOYER = "", CAT_BOYA = "", SUB_ZIMPARA = "", CAT_ZIMPARA = "";
let COLOR_A = "", COLOR_B = "", PROP_A = "";

const createdWoIds: string[] = [];
const allStepIds: string[] = [];
let bc = 0;
function barcode(): string {
  bc++;
  const rand = Math.floor(Math.random() * 0xffffff).toString(16).toUpperCase().padStart(6, "0");
  return `TST-FCW-${rand}${bc}`;
}

interface SetupOpts {
  tag: string;
  count: number;
  /** Fason istasyonu (BOYA_FASON | ZIMPARA_FASON). */
  stationId: string;
  /** ⚠️ LOAD-BEARING: adımın kategorisi. Boş bırakılırsa `appliesColor` false olur
   *  ve renk yolu hiç ölçülmez — testin tamamı sessizce anlamsızlaşır. */
  requiredCategoryId: string;
  /** İş emrinin hedef rengi. Saha vakasında YOK (null) — asıl senaryo budur. */
  targetColorId?: string | null;
  /** Hedef özellik (şekil eşitliği testinde düzleştirmeyi ölçmek için). */
  targetPropertyId?: string | null;
  /** Kaynak topların eni — en önceliği testlerinde kullanılır. */
  rollWidth?: number | null;
  /** İş emrinin hedef eni (fallback zincirinin son basamağı). */
  woWidth?: number | null;
}

async function setup(o: SetupOpts): Promise<{ woId: string; fasonStep: string; nextStep: string; rollIds: string[] }> {
  const stamp = `${Date.now()}`.slice(-6);
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `IE-FCW-${o.tag}-${stamp}`,
      type: "STOCK_PRODUCTION",
      status: "IN_PROGRESS",
      targetItemId: ITEM,
      targetColorId: o.targetColorId ?? null,
      width: o.woWidth ?? null,
      steps: {
        create: [
          // requiredCategoryId ŞART — bkz. dosya başı uyarısı.
          { stationId: o.stationId, stepSequence: 1, status: "PENDING", requiredCategoryId: o.requiredCategoryId },
          { stationId: ST_KURSUN, stepSequence: 2, status: "PENDING" },
        ],
      },
      ...(o.targetPropertyId
        ? { targetProperties: { create: [{ propertyId: o.targetPropertyId }] } }
        : {}),
    },
    include: { steps: { orderBy: { stepSequence: "asc" } } },
  });
  createdWoIds.push(wo.id);
  const fasonStep = wo.steps[0].id, nextStep = wo.steps[1].id;
  allStepIds.push(fasonStep, nextStep);
  await prisma.$transaction((tx) => cards.createForWorkOrder(tx, wo.id, ADMIN));

  const rollIds: string[] = [];
  for (let i = 0; i < o.count; i++) {
    const r = await prisma.roll.create({
      data: {
        barcode: barcode(), itemId: ITEM, initialQty: 300, currentQty: 300,
        status: RollStatus.STOCK, warehouseId: await fixtureWarehouseId(),
        width: o.rollWidth ?? null,
        createdById: ADMIN,
      },
      select: { id: true },
    });
    rollIds.push(r.id);
  }
  return { woId: wo.id, fasonStep, nextStep, rollIds };
}

/** Bu kabulden doğan açık-kumaş topları. */
async function bornRolls(woId: string) {
  return prisma.roll.findMany({
    where: { parentReceipt: { workOrderId: woId } },
    select: { id: true, colorId: true, width: true },
  });
}

async function main(): Promise<void> {
  const item = await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } });
  const admin = await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } });
  const boya = await prisma.station.findFirst({ where: { code: "BOYA_FASON" }, select: { id: true } });
  const zimpara = await prisma.station.findFirst({ where: { code: "ZIMPARA_FASON" }, select: { id: true } });
  const kursun = await prisma.station.findFirst({ where: { code: "KURSUN_KK2" }, select: { id: true } });
  const boyer = await ensureTestDyeHouse();
  const sander = await ensureTestSander();
  // Renk/özellik kataloğundan iki aktif satır — business-key değil "herhangi
  // aktif" seçiliyor çünkü test rengin KİMLİĞİNİ değil TAŞINDIĞINI ölçüyor.
  const colors = await prisma.color.findMany({ where: { isActive: true }, take: 2, select: { id: true }, orderBy: { code: "asc" } });
  const prop = await prisma.fabricProperty.findFirst({ where: { isActive: true }, select: { id: true } });
  if (!item || !admin || !boya || !zimpara || !kursun) throw new Error("Seed fixture eksik — önce 'npm run seed'");
  if (colors.length < 2) throw new Error("En az 2 aktif renk gerekli — önce 'npm run seed'");
  if (!prop) throw new Error("En az 1 aktif özellik gerekli — önce 'npm run seed'");
  ITEM = item.id; ADMIN = admin.id; ST_BOYA = boya.id; ST_ZIMPARA = zimpara.id; ST_KURSUN = kursun.id;
  SUB_BOYER = boyer.id; CAT_BOYA = boyer.categoryId;
  SUB_ZIMPARA = sander.id; CAT_ZIMPARA = sander.categoryId;
  COLOR_A = colors[0].id; COLOR_B = colors[1].id; PROP_A = prop.id;

  // ═══ A1 — SAHA VAKASI: renksiz WO + operatörün seçtiği renk → KABUL GEÇER ═══
  console.log("\n=== A1: hedef rengi OLMAYAN iş emrinde operatör rengi seçer → kabul geçer ===");
  {
    const { woId, fasonStep, rollIds } = await setup({
      tag: "A1", count: 1, stationId: ST_BOYA, requiredCategoryId: CAT_BOYA, targetColorId: null,
    });
    await sub.dispatch({ workOrderId: woId, stepId: fasonStep, subcontractorId: SUB_BOYER, rollIds }, ADMIN);
    const res = await sub.receive(
      { workOrderId: woId, stepId: fasonStep, subcontractorId: SUB_BOYER,
        appliedColorId: COLOR_A, appliedWidth: 145,
        returns: [{ rollId: rollIds[0] }], newRolls: [{ qty: 290 }] },
      ADMIN,
    );
    check("A1: kabul BAŞARILI (bu senaryo eskiden 400 ile kilitliydi)", res.success === true);
    const born = await bornRolls(woId);
    check("A1: 1 açık-kumaş top doğdu", born.length === 1);
    check("A1: doğan top operatörün seçtiği rengi aldı", born[0]?.colorId === COLOR_A,
      `colorId=${born[0]?.colorId ?? "null"}`);
  }

  // ═══ A2 — GUARD HÂLÂ ISIRIYOR (gevşetilmedi) ═══
  console.log("\n=== A2: renksiz WO + hiç renk bilgisi gönderilmezse → 400 ===");
  {
    const { woId, fasonStep, rollIds } = await setup({
      tag: "A2", count: 1, stationId: ST_BOYA, requiredCategoryId: CAT_BOYA, targetColorId: null,
    });
    await sub.dispatch({ workOrderId: woId, stepId: fasonStep, subcontractorId: SUB_BOYER, rollIds }, ADMIN);
    await expectErr("A2: appliedColorId HİÇ gönderilmezse 400", 400, () =>
      sub.receive(
        { workOrderId: woId, stepId: fasonStep, subcontractorId: SUB_BOYER,
          returns: [{ rollId: rollIds[0] }], newRolls: [{ qty: 290 }] },
        ADMIN,
      ),
    );
    const born = await bornRolls(woId);
    check("A2: reddedilen kabulden top DOĞMADI", born.length === 0);
  }

  // ═══ A3 — EN: makbuza VE doğan tüm toplara ═══
  console.log("\n=== A3: appliedWidth makbuza ve doğan TÜM toplara yazılır ===");
  {
    const { woId, fasonStep, rollIds } = await setup({
      tag: "A3", count: 1, stationId: ST_BOYA, requiredCategoryId: CAT_BOYA, targetColorId: COLOR_A,
    });
    await sub.dispatch({ workOrderId: woId, stepId: fasonStep, subcontractorId: SUB_BOYER, rollIds }, ADMIN);
    const res = await sub.receive(
      { workOrderId: woId, stepId: fasonStep, subcontractorId: SUB_BOYER,
        appliedWidth: 158.5,
        returns: [{ rollId: rollIds[0] }], newRolls: [{ qty: 140 }, { qty: 150 }] },
      ADMIN,
    );
    const receiptId = (res.data as { id: string }).id;
    const receipt = await prisma.subcontractorReceipt.findUnique({
      where: { id: receiptId }, select: { appliedWidth: true },
    });
    check("A3: makbuza yazıldı (SubcontractorReceipt.appliedWidth)",
      Number(receipt?.appliedWidth) === 158.5, `${receipt?.appliedWidth}`);
    const born = await bornRolls(woId);
    check("A3: 2 parça doğdu", born.length === 2);
    check("A3: EN her iki parçaya da uygulandı (kabul başına tek değer)",
      born.length === 2 && born.every((r) => Number(r.width) === 158.5),
      born.map((r) => String(r.width)).join(","));
  }

  // ═══ A4 — ÖNCELİK: ölçüm > kaynak topun eni ═══
  console.log("\n=== A4: operatörün ölçümü kaynak topun eninden ÖNCE gelir ===");
  {
    const { woId, fasonStep, rollIds } = await setup({
      tag: "A4", count: 1, stationId: ST_BOYA, requiredCategoryId: CAT_BOYA,
      targetColorId: COLOR_A, rollWidth: 250, woWidth: 330,
    });
    await sub.dispatch({ workOrderId: woId, stepId: fasonStep, subcontractorId: SUB_BOYER, rollIds }, ADMIN);
    await sub.receive(
      { workOrderId: woId, stepId: fasonStep, subcontractorId: SUB_BOYER,
        appliedWidth: 160,
        returns: [{ rollId: rollIds[0] }], newRolls: [{ qty: 290 }] },
      ADMIN,
    );
    const born = await bornRolls(woId);
    // Kaynak 250, WO 330, ölçüm 160 → 160 kazanmalı. Eski kod "kumaş eni boyahanede
    // değişmez" varsayıyordu ve kaynağı öne alıyordu; ram/fikse/sanfor tam da eni
    // değiştiren operasyonlardır.
    check("A4: doğan topun eni ÖLÇÜM (160), kaynak (250) ya da WO (330) değil",
      Number(born[0]?.width) === 160, `${born[0]?.width}`);
  }

  // ═══ A5 — GERİ UYUM: eski istemci en göndermez ═══
  console.log("\n=== A5: appliedWidth göndermeyen eski istemci → kaynak en miras alınır ===");
  {
    const { woId, fasonStep, rollIds } = await setup({
      tag: "A5", count: 1, stationId: ST_BOYA, requiredCategoryId: CAT_BOYA,
      targetColorId: COLOR_A, rollWidth: 250,
    });
    await sub.dispatch({ workOrderId: woId, stepId: fasonStep, subcontractorId: SUB_BOYER, rollIds }, ADMIN);
    const res = await sub.receive(
      { workOrderId: woId, stepId: fasonStep, subcontractorId: SUB_BOYER,
        returns: [{ rollId: rollIds[0] }], newRolls: [{ qty: 290 }] },
      ADMIN,
    );
    check("A5: en'siz payload hâlâ KABUL EDİLİR (sahadaki eski APK kırılmaz)", res.success === true);
    const born = await bornRolls(woId);
    check("A5: en verilmediğinde kaynak topun eni miras alınır", Number(born[0]?.width) === 250,
      `${born[0]?.width}`);
    const receiptId = (res.data as { id: string }).id;
    const receipt = await prisma.subcontractorReceipt.findUnique({
      where: { id: receiptId }, select: { appliedWidth: true },
    });
    check("A5: makbuzun appliedWidth'i NULL (ölçüm yapılmadı — uydurma değer yazılmaz)",
      receipt?.appliedWidth === null);
  }

  // ═══ B1 — KURALIN KENDİSİ: EN, appliesColor'dan BAĞIMSIZ ═══
  console.log("\n=== B1: renk VERMEYEN fasonda (zımpara) da en yazılır ===");
  {
    const { woId, fasonStep, rollIds } = await setup({
      tag: "B1", count: 1, stationId: ST_ZIMPARA, requiredCategoryId: CAT_ZIMPARA,
      targetColorId: null, rollWidth: null,
    });
    await sub.dispatch({ workOrderId: woId, stepId: fasonStep, subcontractorId: SUB_ZIMPARA, rollIds }, ADMIN);
    // Renk hiç gönderilmiyor ve GEREKMİYOR (appliesColor=false → guard tetiklenmez).
    const res = await sub.receive(
      { workOrderId: woId, stepId: fasonStep, subcontractorId: SUB_ZIMPARA,
        appliedWidth: 172,
        returns: [{ rollId: rollIds[0] }], newRolls: [{ qty: 290 }] },
      ADMIN,
    );
    check("B1: renk vermeyen fasonda kabul renksiz GEÇER (renk sorulmaz)", res.success === true);
    const born = await bornRolls(woId);
    check("B1: doğan top renksiz (zımpara renk vermez)", born[0]?.colorId === null);
    // ⚠️ ASIL KURAL: en ile renk aynı `if` altında birleştirilirse bu satır düşer,
    // BAŞKA HİÇBİR ŞEY düşmez ve zımparadan dönen top sonsuza dek ensiz kalır.
    check("B1: ⚠️ EN YİNE DE YAZILDI — appliesColor'a bağlanmamalı",
      Number(born[0]?.width) === 172, `${born[0]?.width}`);
    const receiptId = (res.data as { id: string }).id;
    const receipt = await prisma.subcontractorReceipt.findUnique({
      where: { id: receiptId }, select: { appliedWidth: true },
    });
    check("B1: makbuza da yazıldı", Number(receipt?.appliedWidth) === 172);
  }

  // ═══ C — ÜÇ UCUN ŞEKİL EŞİTLİĞİ (asıl saha bug'ının bekçisi) ═══
  console.log("\n=== C: üç kabul yolu da aynı alanları taşır (appliesColor · targetColor · düz targetProperties) ===");
  {
    const { woId, fasonStep, rollIds } = await setup({
      tag: "C", count: 1, stationId: ST_BOYA, requiredCategoryId: CAT_BOYA,
      targetColorId: COLOR_B, targetPropertyId: PROP_A, woWidth: 330,
    });
    // Sevk edip KABUL ETMİYORUZ — toplar fasonda beklerken üç uç da onları görmeli.
    await sub.dispatch({ workOrderId: woId, stepId: fasonStep, subcontractorId: SUB_BOYER, rollIds }, ADMIN);

    type Grp = {
      step: { id: string; requiredCategory?: { appliesColor?: boolean; appliesProperty?: boolean } | null };
      workOrder: {
        batchNumber?: string;
        width?: number | null;
        targetColor?: { id: string } | null;
        targetProperties?: Array<Record<string, unknown>>;
      };
    };
    const byStep = (arr: unknown): Grp | undefined =>
      (arr as Grp[]).find((g) => g.step?.id === fasonStep);

    const listAll = byStep((await sub.listPendingReturns()).data);          // DAL B (arg yok)
    const listWo = byStep((await sub.listPendingReturns({ workOrderId: woId })).data); // DAL A
    const detail = (await sub.getPendingReturnGroupDetail(fasonStep)).data as Grp;      // DETAY

    const surfaces: Array<[string, Grp | undefined]> = [
      ["liste (tüm)", listAll],
      ["liste (iş emri)", listWo],
      ["adım detayı", detail],
    ];

    for (const [name, g] of surfaces) {
      check(`C: ${name} — grup bulundu`, !!g);
      if (!g) continue;
      // 1) appliesColor — SAHA BUG'ININ TA KENDİSİ. İki liste ucunda YOKTU; kabulü
      //    kart okutarak açan operatör rengin sorulması gerektiğini bilmiyordu.
      check(`C: ${name} — requiredCategory.appliesColor TAŞINIYOR`,
        g.step?.requiredCategory?.appliesColor === true,
        String(g.step?.requiredCategory?.appliesColor));
      // 2) targetColor — ön seçim bu alandan besleniyor.
      check(`C: ${name} — workOrder.targetColor taşınıyor ve doğru`,
        g.workOrder?.targetColor?.id === COLOR_B);
      // 2b) workOrder.width — tablet "uygulanan" panelini KAPALI açmak için buna
      //     bakar (iş emrinde en varsa operatöre sorulmaz). Taşınmazsa panel her
      //     kabulde açılır ve operatör eni elle yazar; hata çıkmaz, sadece yorulur.
      check(`C: ${name} — workOrder.width taşınıyor (panelin kapalı açılması buna bağlı)`,
        g.workOrder?.width === 330, String(g.workOrder?.width));
      // 3) targetProperties DÜZLEŞTİRİLMİŞ olmalı: pivot kabuğu (`{property:{…}}`)
      //    dışarı sızarsa istemci listeyi boş okur ve kabulde topların özellikleri
      //    (zımparalı/sanforlu) SESSİZCE kaybolur.
      const tp = g.workOrder?.targetProperties ?? [];
      check(`C: ${name} — targetProperties dolu`, tp.length === 1, `len=${tp.length}`);
      check(`C: ${name} — targetProperties DÜZ ({id,code,name}), pivot kabuğu değil`,
        tp.length === 1 && !("property" in tp[0]) && tp[0].id === PROP_A);
    }
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

async function cleanup(): Promise<void> {
  if (createdWoIds.length === 0) return;
  try {
    const rolls = await prisma.roll.findMany({
      where: {
        OR: [
          { currentStepId: { in: allStepIds } },
          { producedInStepId: { in: allStepIds } },
          { parentReceipt: { workOrderId: { in: createdWoIds } } },
          { barcode: { startsWith: "TST-FCW-" } },
        ],
      },
      select: { id: true },
    });
    const rollIds = rolls.map((r) => r.id);
    const receipts = await prisma.subcontractorReceipt.findMany({ where: { workOrderId: { in: createdWoIds } }, select: { id: true } });
    const receiptIds = receipts.map((r) => r.id);
    const dispatches = await prisma.subcontractorDispatch.findMany({ where: { workOrderId: { in: createdWoIds } }, select: { id: true } });
    const dispatchIds = dispatches.map((d) => d.id);
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.subcontractorReceiptItem.deleteMany({ where: { receiptId: { in: receiptIds } } });
    await prisma.subcontractorReceiptProperty.deleteMany({ where: { receiptId: { in: receiptIds } } });
    await prisma.subcontractorDispatchItem.deleteMany({ where: { dispatchId: { in: dispatchIds } } });
    // ⚠️ RESTRICT FK — sapma defteri satırı duran top SİLİNEMEZ (2026-08-21'den beri
    // fason kabulünde giden↔dönen metraj farkı da deftere yazılıyor). Silinmezse
    // temizlik 23001 ile yarıda kalır ve arkasında hayalet kayıt bırakır.
    await prisma.rollVariance.deleteMany({ where: { roll: { id: { in: rollIds } } } });
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    await prisma.subcontractorReceipt.deleteMany({ where: { id: { in: receiptIds } } });
    await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: dispatchIds } } });
    await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: createdWoIds } } });
    await prisma.batch.deleteMany({ where: { workOrderId: { in: createdWoIds } } });
    await prisma.workOrderTargetProperty.deleteMany({ where: { workOrderId: { in: createdWoIds } } });
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: createdWoIds } } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...rollIds, ...receiptIds, ...dispatchIds, ...createdWoIds] } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: createdWoIds } } });
    console.log("(test verisi temizlendi)");
  } catch (e) {
    console.error("cleanup hata (manuel temizlik gerekebilir):", e instanceof Error ? e.message : e);
  }
}

main()
  .catch((e) => { console.error("HATA:", e); fail++; })
  .finally(async () => { await cleanup(); await prisma.$disconnect(); process.exit(fail > 0 ? 1 : 0); });
