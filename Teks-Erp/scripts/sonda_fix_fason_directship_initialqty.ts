// =============================================================================
// SONDA — fix_fason_directship_initialqty.ts gerçek hasarı görüyor mu?
// Çalıştır: npx tsx scripts/sonda_fix_fason_directship_initialqty.ts   (dev DB'ye TST- fixture yazar, siler)
// =============================================================================
// Demo DB'de DirectShipment yok; orada "0 bulgu" teşhisin kör olmadığını kanıtlamaz. Bu sonda
// gerçek servislerle kısmi doğrudan sevk kurar, eski kodun yaptığı düşümü ELLE uygular ve
// teşhis + onarımın hükmünü ölçer. Teşhis yalnız sondanın kendi sevklerine kapsanır.
//   S1 düzeltilmiş kod · kısmi sevk               → TEMİZ (tam sevk topu ayrı sayılır)
//   S2 S1 + eski düşüm                             → KESİN, eksik 100
//   S3 kısmi sevk + kısmi kabul + eski düşüm       → KESİN (eski `I < S + C` imzası KAÇIRIR)
//   S4 eski düşüm + açıklanmayan kalan değişimi    → BELİRSİZ, onarım dokunmaz
//   S5 onarım → TEMİZ + audit · bayat hükümle ikinci onarım → ATLANDI (atomik claim)
// =============================================================================
import { Prisma, RollStatus } from "@prisma/client";

import prisma, { pool } from "../src/lib/prisma";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { ensureTestDyeHouse } from "./fixture-subcontractor";
import { onar, siniflandir, teshis, type EbeveynBulgusu } from "./fix_fason_directship_initialqty";
import { assertGelistirmeVeritabani } from "./db-guard";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

const sub = new SubcontractorService();
const cards = new TravelerCardService();
const D = (n: number): Prisma.Decimal => new Prisma.Decimal(n);

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "✓" : "✗ FAIL:"} ${label}${extra ? ` — ${extra}` : ""}`);
}

let ITEM = "";
let ADMIN = "";
let ST_BOYA = "";
let ST_KURSUN = "";
let SUB_BOYER = "";
let CUSTOMER = "";
const woIds: string[] = [];
const dispatchIds: string[] = [];
let bc = 0;

async function kur(tag: string, qtys: number[]): Promise<{ woId: string; stepId: string; dispatchId: string; rollIds: string[] }> {
  const stamp = `${Date.now()}`.slice(-6);
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `IE-FDI-${tag}-${stamp}`,
      type: "STOCK_PRODUCTION",
      status: "IN_PROGRESS",
      targetItemId: ITEM,
      steps: {
        create: [
          { stationId: ST_BOYA, stepSequence: 1, status: "PENDING" },
          { stationId: ST_KURSUN, stepSequence: 2, status: "PENDING" },
        ],
      },
    },
    include: { steps: { orderBy: { stepSequence: "asc" } } },
  });
  woIds.push(wo.id);
  await prisma.$transaction((tx) => cards.createForWorkOrder(tx, wo.id, ADMIN));
  const rollIds: string[] = [];
  for (const q of qtys) {
    bc++;
    const r = await prisma.roll.create({
      data: {
        barcode: `TST-FDI-${Math.floor(Math.random() * 0xffffff).toString(16).toUpperCase()}${bc}`,
        itemId: ITEM, initialQty: q, currentQty: q, status: RollStatus.STOCK, width: 250, createdById: ADMIN,
      },
      select: { id: true },
    });
    rollIds.push(r.id);
  }
  const stepId = wo.steps[0]!.id;
  const d = await sub.dispatch({ workOrderId: wo.id, stepId, subcontractorId: SUB_BOYER, rollIds }, ADMIN);
  const dispatchId = (d.data as { id: string }).id;
  dispatchIds.push(dispatchId);
  return { woId: wo.id, stepId, dispatchId, rollIds };
}

/** Eski `createFasonShipChild`in yaptığı düşümün birebir aynısı. */
async function eskiDusum(rollId: string, qty: number): Promise<void> {
  await prisma.roll.update({ where: { id: rollId }, data: { initialQty: { decrement: qty } } });
}

function bul(bulgular: EbeveynBulgusu[], rollId: string): EbeveynBulgusu | undefined {
  return bulgular.find((b) => b.rollId === rollId);
}

/** Eski öneri: `initialQty < Σ çocuk + currentQty`. */
function eskiImza(b: EbeveynBulgusu): boolean {
  return b.initialQty.lessThan(b.kismiSevkToplami.plus(b.currentQty));
}

async function main(): Promise<void> {
  // Sonda HER koşumda fixture YAZAR ve siler — yıkıcı betik kapısı koşulsuz.
  assertGelistirmeVeritabani("sonda_fix_fason_directship_initialqty");
  const engel = hedefDbEngeli();
  if (engel) throw new Error(engel);
  const need = (v: { id: string } | null, label: string): string => {
    if (!v) throw new Error(`Seed fixture eksik: ${label}`);
    return v.id;
  };
  ITEM = need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "Item PATOS");
  ADMIN = need(await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }), "admin");
  ST_BOYA = need(await prisma.station.findFirst({ where: { code: "BOYA_FASON" }, select: { id: true } }), "BOYA_FASON");
  ST_KURSUN = need(await prisma.station.findFirst({ where: { code: "KURSUN_KK2" }, select: { id: true } }), "KURSUN_KK2");
  CUSTOMER = need(await prisma.customer.findFirst({ where: { code: "MUS-001" }, select: { id: true } }), "MUS-001");
  SUB_BOYER = (await ensureTestDyeHouse()).id;

  console.log("\n=== S0: saf yüklem ===");
  check("kısmi sevkler kod güncellemesinin iki yanında → BELİRSİZ (yalnız ilk k)",
    siniflandir({ initialQty: D(250), currentQty: D(150), sevkMetraji: D(300), cocukMetrajlari: [D(50), D(100)], kismiKabul: D(0) }).gerekce.startsWith("yalnız ilk 1/2"));
  check("çapa yoksa → BELİRSİZ",
    siniflandir({ initialQty: D(200), currentQty: D(200), sevkMetraji: null, cocukMetrajlari: [D(100)], kismiKabul: D(0) }).hukum === "BELIRSIZ");

  // S1: bir top kısmi (100/300), bir top tam sevk.
  const s1 = await kur("S1", [300, 80]);
  await sub.executeDirectShip(
    { dispatchId: s1.dispatchId, reason: "sonda kısmi", customerId: CUSTOMER, rollIds: s1.rollIds, rollShipQtys: { [s1.rollIds[0]!]: 100 } },
    ADMIN,
  );
  // S3: kısmi sevk, sonra kısmi kabul.
  const s3 = await kur("S3", [300]);
  await sub.executeDirectShip(
    { dispatchId: s3.dispatchId, reason: "sonda kısmi", customerId: CUSTOMER, rollIds: s3.rollIds, rollShipQtys: { [s3.rollIds[0]!]: 100 } },
    ADMIN,
  );
  await sub.receive(
    { workOrderId: s3.woId, stepId: s3.stepId, subcontractorId: SUB_BOYER, returns: [{ rollId: s3.rollIds[0]!, receivedQty: 100 }], newRolls: [{ qty: 100 }] },
    ADMIN,
  );
  // S4: kısmi sevk.
  const s4 = await kur("S4", [300]);
  await sub.executeDirectShip(
    { dispatchId: s4.dispatchId, reason: "sonda kısmi", customerId: CUSTOMER, rollIds: s4.rollIds, rollShipQtys: { [s4.rollIds[0]!]: 100 } },
    ADMIN,
  );

  const p1 = s1.rollIds[0]!;
  const p3 = s3.rollIds[0]!;
  const p4 = s4.rollIds[0]!;

  console.log("\n=== S1: düzeltilmiş kod ===");
  {
    const r = await teshis({ dispatchIds });
    const b = bul(r.ebeveynler, p1);
    check("körlük zemini: 3 DirectShipment, 4 sevk edilen top (1 tam + 3 çocuk), 3 ebeveyn",
      r.directShipmentSayisi === 3 && r.sevkEdilenTop === 4 && r.tamSevk === 1 && r.kismiSevkCocugu === 3 && r.ebeveynler.length === 3,
      `ds=${r.directShipmentSayisi} sevk=${r.sevkEdilenTop} tam=${r.tamSevk} çocuk=${r.kismiSevkCocugu} ebeveyn=${r.ebeveynler.length}`);
    check("sıra dışı yok", r.siraDisi.length === 0, `${r.siraDisi.length}`);
    check("S1 ebeveyn TEMİZ", b?.hukum === "TEMIZ", `${b?.hukum} ${b?.gerekce}`);
    check("S3 ebeveyn TEMİZ (kısmi kabul hasar değil)", bul(r.ebeveynler, p3)?.hukum === "TEMIZ", bul(r.ebeveynler, p3)?.gerekce);
  }

  await eskiDusum(p1, 100);
  await eskiDusum(p3, 100);
  await eskiDusum(p4, 100);
  await prisma.roll.update({ where: { id: p4 }, data: { currentQty: { decrement: 20 } } });

  console.log("\n=== S2–S4: eski düşüm uygulandı ===");
  const hasarli = await teshis({ dispatchIds });
  {
    const b1 = bul(hasarli.ebeveynler, p1);
    check("S2 KESİN", b1?.hukum === "KESIN", `${b1?.hukum} ${b1?.gerekce}`);
    check("S2 eksik 100 · olmalı 300 · iş emri ve barkod dolu",
      b1 != null && b1.kismiSevkToplami.equals(100) && b1.sevkMetraji?.equals(300) === true && b1.isEmriNo.startsWith("IE-FDI-S1") && b1.barkod != null && b1.kismiSevkler[0]?.sevkNo != null,
      `eksik=${b1?.kismiSevkToplami} D=${b1?.sevkMetraji} wo=${b1?.isEmriNo}`);
    check("S2 eski imza da yakalıyor (kısmi kabulsüz)", b1 != null && eskiImza(b1));

    const b3 = bul(hasarli.ebeveynler, p3);
    check("S3 KESİN (kısmi kabul sonrası)", b3?.hukum === "KESIN", `${b3?.hukum} ${b3?.gerekce}`);
    check("S3 eski `I < S + C` imzası bu hasarı KAÇIRIYOR", b3 != null && !eskiImza(b3),
      `I=${b3?.initialQty} S=${b3?.kismiSevkToplami} C=${b3?.currentQty}`);

    const b4 = bul(hasarli.ebeveynler, p4);
    check("S4 BELİRSİZ (kalan zinciri tutmuyor)", b4?.hukum === "BELIRSIZ" && b4.gerekce.includes("zinciri tutmuyor"), `${b4?.hukum} ${b4?.gerekce}`);
  }

  console.log("\n=== S5: onarım ===");
  {
    const sonuc = await onar(hasarli.ebeveynler);
    check("yalnız iki KESİN yazıldı, BELİRSİZ'e dokunulmadı",
      sonuc.length === 2 && sonuc.every((s) => s.sonuc === "YAZILDI") && !sonuc.some((s) => s.rollId === p4),
      JSON.stringify(sonuc.map((s) => s.sonuc)));
    const sonra = await teshis({ dispatchIds });
    check("S2 ve S3 yeniden taramada TEMİZ",
      bul(sonra.ebeveynler, p1)?.hukum === "TEMIZ" && bul(sonra.ebeveynler, p3)?.hukum === "TEMIZ");
    const p1Satir = await prisma.roll.findUnique({ where: { id: p1 }, select: { initialQty: true, currentQty: true } });
    check("S2 initialQty=300, currentQty=200 (kalan dokunulmadı)",
      p1Satir?.initialQty.equals(300) === true && p1Satir.currentQty.equals(200), `${p1Satir?.initialQty}/${p1Satir?.currentQty}`);
    const p4Satir = await prisma.roll.findUnique({ where: { id: p4 }, select: { initialQty: true } });
    check("S4 initialQty 200'de kaldı", p4Satir?.initialQty.equals(200) === true, `${p4Satir?.initialQty}`);
    const audit = await prisma.systemLog.findFirst({ where: { tableName: "ROLL", recordId: p1, action: "UPDATE" }, orderBy: { createdAt: "desc" }, select: { newData: true } });
    check("audit izi yazıldı", (audit?.newData as { event?: string } | null)?.event === "FASON_DIRECT_SHIP_INITIALQTY_RESTORE");
    const varyans = await prisma.rollVariance.count({ where: { rollId: { in: [p1, p3] } } });
    check("RollVariance yazılmadı", varyans === 0, `${varyans}`);
    const ikinci = await onar(hasarli.ebeveynler);
    check("bayat hükümle ikinci onarım → ATLANDI (atomik claim)", ikinci.length === 2 && ikinci.every((s) => s.sonuc === "ATLANDI_DEGISMIS"), JSON.stringify(ikinci.map((s) => s.sonuc)));
  }
}

async function temizle(): Promise<void> {
  if (woIds.length === 0) return;
  try {
    const steps = await prisma.workOrderStep.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } });
    const stepIds = steps.map((s) => s.id);
    const directShipments = await prisma.directShipment.findMany({ where: { dispatchId: { in: dispatchIds } }, select: { id: true } });
    const dsIds = directShipments.map((d) => d.id);
    const receipts = await prisma.subcontractorReceipt.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } });
    const receiptIds = receipts.map((r) => r.id);
    const tabanRolls = await prisma.roll.findMany({
      where: {
        OR: [
          { currentStepId: { in: stepIds } },
          { producedInStepId: { in: stepIds } },
          { parentReceiptId: { in: receiptIds } },
          { directShipmentId: { in: dsIds } },
          { barcode: { startsWith: "TST-FDI-" } },
        ],
      },
      select: { id: true },
    });
    const tabanIds = tabanRolls.map((r) => r.id);
    const cocuklar = await prisma.roll.findMany({ where: { parentRollId: { in: tabanIds } }, select: { id: true } });
    const rollIds = [...new Set([...tabanIds, ...cocuklar.map((c) => c.id)])];

    await prisma.printedDocument.deleteMany({ where: { sourceId: { in: [...dispatchIds, ...woIds, ...dsIds, ...receiptIds] } } });
    await prisma.subcontractorDirectShipAllocation.deleteMany({ where: { dispatchId: { in: dispatchIds } } });
    await prisma.rollVariance.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollOperation.deleteMany({ where: { OR: [{ rollId: { in: rollIds } }, { workOrderStepId: { in: stepIds } }] } });
    await prisma.rollMovement.deleteMany({ where: { OR: [{ rollId: { in: rollIds } }, { workOrderStepId: { in: stepIds } }] } });
    await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.subcontractorReceiptItem.deleteMany({ where: { receiptId: { in: receiptIds } } });
    await prisma.subcontractorReceiptProperty.deleteMany({ where: { receiptId: { in: receiptIds } } });
    await prisma.subcontractorDispatchItem.deleteMany({ where: { dispatchId: { in: dispatchIds } } });
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    await prisma.directShipment.deleteMany({ where: { id: { in: dsIds } } });
    await prisma.subcontractorReceipt.deleteMany({ where: { id: { in: receiptIds } } });
    await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: dispatchIds } } });
    const cardIds = (await prisma.travelerCard.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } })).map((c) => c.id);
    await prisma.travelerCardScan.deleteMany({ where: { cardId: { in: cardIds } } });
    await prisma.travelerCard.deleteMany({ where: { id: { in: cardIds } } });
    await prisma.batch.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...rollIds, ...receiptIds, ...dispatchIds, ...woIds, ...dsIds] } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
    const kalan = await prisma.roll.count({ where: { barcode: { startsWith: "TST-FDI-" } } });
    console.log(`(sonda verisi temizlendi · kalan TST-FDI top: ${kalan})`);
  } catch (e) {
    fail++;
    console.error("temizlik hatası (elle temizlik gerekebilir):", e instanceof Error ? e.message : e);
  }
}

main()
  .catch((e) => {
    fail++;
    console.error("HATA:", e);
  })
  .finally(async () => {
    await temizle();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
