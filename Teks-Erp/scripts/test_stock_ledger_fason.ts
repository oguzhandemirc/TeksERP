// =============================================================================
// BEKÇİ — FASON DÖNÜŞÜ stok defterine ne yazar (ve NE ZAMAN YAZMAZ)?
// Çalıştır: npx tsx scripts/run-all-tests.ts stock_ledger_fason
// =============================================================================
// NEDEN VAR: fason kabulü deftere STATÜSÜZ `ENTRY` satırı yazıyordu (yalnız
// `toWarehouseId`) ⇒ stok-kümesi uçlu Σ o satırı tanım gereği dışarıda bırakıyordu.
// Taşıma (K) sırasında ölçüldü (2026-09-13, `grep -c warehouseMovement scripts/test_fason*.ts`):
// **21 fason bekçisinin hiçbiri** `warehouseMovement`a dokunmuyordu (sayıldı,
// varsayılmadı) — yani fason defteri ölçülmüyordu.
//
// ⚠️ İKİ DAL BİRDEN ÖLÇÜLÜR ve yokluğun SEBEBİ yüklemin parçasıdır:
//   · fason SON adımsa → born top `WAREHOUSE` doğar, mal fiilen rafa girer ⇒ SATIR VAR
//   · fason ARA adımsa → born top `IN_PRODUCTION` doğar, fiziksel olarak üretim
//     hattındadır, rafta DEĞİL ⇒ SATIR YOK. Bu bir "sessiz atlama" DEĞİL, **olay
//     yokluğu**dur. (Koşulsuz yazım depoya girmemiş malı depoda gösteriyordu:
//     ölçüldü 2026-09-12, `onarim_fason_donus_entry.ts` kuru koşumu: 57/57.)
//
// ⚠️ `from` UCU YOK ve bu doğru: born top BU ANDA doğdu, öncesi yok. Ebeveynin
// çıkışı fason SEVKİNDE yazılır (ayrı olay, dilim 2b) — burada `from` yazmak aynı
// malı iki kez düşmek olurdu.
//
// ÖLÇÜLENLER
//   §1 ⭐ SON ADIM: satır STATÜLÜ — to = {depo, WAREHOUSE} · `from` YOK ·
//      reasonCode FASON_RECEIPT · metraj kabul edilen miktar
//   §2 ⭐ ARA ADIM: satır YOK (olay yokluğu) — ve born top gerçekten IN_PRODUCTION
//   §3 ⭐ Kısmi kabul topu TÜKETMEZ: ebeveyn AT_SUBCONTRACTOR kalır, ona ait
//      yeni defter satırı doğmaz (fason kuralı: kısmi kabul ≠ tüketim)
//   §4 POZİTİF KONTROL: fikstür gerçekten kabul etti (born top var, makbuz var)
// =============================================================================
import { RollStatus, StepStatus, WarehouseEventType } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { STOCK_MOVE_REASON } from "../src/constants/stock-move-reasons";
import { roleGrade } from "./fixture-quality-grade";
import { ensureTestDyeHouse } from "./fixture-subcontractor";
import { fixtureWarehouseId } from "./fixture-warehouse";
import { ensureTestAdmin } from "./fixture-test-user";

const sub = new SubcontractorService();
const cards = new TravelerCardService();

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

const TAG = `TST-SLF-${Date.now()}`;
const woIds: string[] = [];
const rollIds: string[] = [];
let ITEM = "";
let GRADE = "";
let GRADE_CODE = "";
let ADMIN = "";
let ST_BOYA = "";
let ST_KURSUN = "";
let SUB = "";

async function fixtures(): Promise<void> {
  const need = <T extends { id: string }>(v: T | null, ad: string): T => {
    if (!v) throw new Error(`Seed fixture eksik: ${ad} (önce 'npm run seed')`);
    return v;
  };
  ITEM = need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "Item PATOS").id;
  const g = await roleGrade("FIRST");
  GRADE = g.id;
  GRADE_CODE = g.code;
  ADMIN = (await ensureTestAdmin()).id;
  ST_BOYA = need(await prisma.station.findFirst({ where: { code: "BOYA_FASON" }, select: { id: true } }), "Station BOYA_FASON").id;
  ST_KURSUN = need(await prisma.station.findFirst({ where: { code: "KURSUN_KK2" }, select: { id: true } }), "Station KURSUN_KK2").id;
  SUB = (await ensureTestDyeHouse()).id;
}

async function stokTopu(qty: number, durum: RollStatus = RollStatus.STOCK): Promise<string> {
  const r = await prisma.roll.create({
    data: {
      barcode: `${TAG}-${rollIds.length}`,
      itemId: ITEM,
      initialQty: qty,
      currentQty: qty,
      status: durum,
      warehouseId: await fixtureWarehouseId(),
      qualityGrade: GRADE_CODE,
      qualityGradeId: GRADE,
      createdById: ADMIN,
    },
    select: { id: true },
  });
  rollIds.push(r.id);
  return r.id;
}

/** `sonAdim=true` ⇒ fason TEK adım (born WAREHOUSE doğar); değilse iki adım. */
async function woKur(
  etiket: string,
  qty: number,
  sonAdim: boolean,
  topDurumu: RollStatus = RollStatus.STOCK,
): Promise<{ woId: string; fasonStep: string; rollId: string }> {
  const adimlar = sonAdim
    ? [{ stationId: ST_BOYA, stepSequence: 1, status: StepStatus.PENDING }]
    : [
        { stationId: ST_BOYA, stepSequence: 1, status: StepStatus.PENDING },
        { stationId: ST_KURSUN, stepSequence: 2, status: StepStatus.PENDING },
      ];
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `${TAG}-${etiket}`,
      type: "STOCK_PRODUCTION",
      status: "IN_PROGRESS",
      targetQuantity: 1000,
      targetItemId: ITEM,
      steps: { create: adimlar },
    },
    include: { steps: { orderBy: { stepSequence: "asc" } } },
  });
  woIds.push(wo.id);
  await prisma.$transaction((tx) => cards.createForWorkOrder(tx, wo.id, ADMIN));
  const rollId = await stokTopu(qty, topDurumu);
  const fasonStep = wo.steps[0]!.id;
  // ⚠️ `IN_PRODUCTION` top otomatik bağlanmaz: claim yüklemi `currentStepId`
  // eşleşmesi istiyor ve auto-attach yalnız `STOCK` için koşuyor. Fikstür bu
  // ön koşulu KENDİSİ kurar, yoksa senaryo "adımda değil" ile çöker (ölçüldü).
  if (topDurumu === RollStatus.IN_PRODUCTION) {
    await prisma.roll.update({ where: { id: rollId }, data: { currentStepId: fasonStep } });
  }
  await sub.dispatch({ workOrderId: wo.id, stepId: fasonStep, subcontractorId: SUB, rollIds: [rollId] }, ADMIN);
  return { woId: wo.id, fasonStep, rollId };
}

const bornTop = (woId: string) =>
  prisma.roll.findFirstOrThrow({
    where: { parentReceipt: { workOrderId: woId }, parentRollId: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, warehouseId: true, currentQty: true },
  });

const defter = (rollId: string) =>
  prisma.warehouseMovement.findMany({
    where: { rollId },
    select: {
      eventType: true, qty: true, reasonCode: true,
      fromWarehouseId: true, fromStatus: true, toWarehouseId: true, toStatus: true,
    },
  });

async function main(): Promise<void> {
  await fixtures();

  // ═══ §5 · §6 — FASON SEVKİ: stok kümesinden ÇIKIŞ ═══
  // Bu yol 2026-09-13'e kadar deftere HİÇ satır yazmıyordu: `STOCK`tan fasona
  // çıkan top defterde iz bırakmıyordu. ⚠️ Gerekçe VERİ SAYISI DEĞİL KOD: fabrika
  // kopyasındaki 187 `AT_SUBCONTRACTOR` topun stok kümesine GİRİŞ ucu da yoktu
  // (asimetri 0) ⇒ o sayı bu kusurun kanıtı değildi, yalnız mirastı.
  const s = await woKur("SEVK", 200, true);
  const dSevk = await defter(s.rollId);
  const cikis = dSevk.find((x) => x.eventType === WarehouseEventType.EXTERNAL);
  const topSevk = await prisma.roll.findUniqueOrThrow({
    where: { id: s.rollId },
    select: { status: true, warehouseId: true },
  });
  check(
    "§5 ⭐ FASON SEVKİ: çıkış satırı STATÜLÜ — from = {depo, STOCK} · to = {∅, AT_SUBCONTRACTOR} · FASON_DISPATCH",
    cikis !== undefined &&
      cikis.fromStatus === RollStatus.STOCK &&
      cikis.fromWarehouseId !== null &&
      cikis.toWarehouseId === null &&
      cikis.toStatus === RollStatus.AT_SUBCONTRACTOR &&
      cikis.reasonCode === STOCK_MOVE_REASON.FASON_DISPATCH &&
      Number(cikis.qty) === 200,
    JSON.stringify(cikis),
  );
  check(
    "§5b Top AT_SUBCONTRACTOR ve deposu KORUNDU (dönüş adresi) — defterin ucu NULL",
    topSevk.status === RollStatus.AT_SUBCONTRACTOR && topSevk.warehouseId !== null && cikis?.toWarehouseId === null,
    `${topSevk.status} / depo=${String(topSevk.warehouseId)}`,
  );

  // §6 — IN_PRODUCTION'dan fasona çıkış: satır YOK (stok dışından stok dışına).
  // Claim yüklemi `IN_PRODUCTION | STOCK` kabul eder; `IN_PRODUCTION` stok
  // kümesinde DEĞİLDİR ⇒ olay yokluğu, sessiz atlama değil.
  const u = await woKur("URETIM", 180, true, RollStatus.IN_PRODUCTION);
  const dUretim = await defter(u.rollId);
  const topUretim = await prisma.roll.findUniqueOrThrow({ where: { id: u.rollId }, select: { status: true } });
  check(
    "§6 ⭐ IN_PRODUCTION'dan fason sevkinde satır YOK (stok dışı → stok dışı, OLAY YOK)",
    topUretim.status === RollStatus.AT_SUBCONTRACTOR &&
      dUretim.filter((x) => x.eventType === WarehouseEventType.EXTERNAL).length === 0,
    `${topUretim.status} · çıkış satırı=${dUretim.length}`,
  );

  // ═══ §1 · §4 — FASON SON ADIM: born top rafa iner, satır STATÜLÜ ═══
  const a = await woKur("SON", 300, true);
  await sub.receive(
    { workOrderId: a.woId, stepId: a.fasonStep, subcontractorId: SUB, returns: [{ rollId: a.rollId }], newRolls: [{ qty: 290 }] },
    ADMIN,
  );
  const bornA = await bornTop(a.woId);
  rollIds.push(bornA.id);
  check(
    "§4 POZİTİF KONTROL: fikstür gerçekten kabul etti (born top WAREHOUSE'ta, depolu)",
    bornA.status === RollStatus.WAREHOUSE && bornA.warehouseId !== null,
    `${bornA.status} / depo=${String(bornA.warehouseId)}`,
  );
  const dA = await defter(bornA.id);
  const giris = dA.find((x) => x.eventType === WarehouseEventType.ENTRY);
  check(
    "§1 ⭐ SON ADIM: satır STATÜLÜ — to = {depo, WAREHOUSE} · from YOK · FASON_RECEIPT",
    giris !== undefined &&
      giris.toWarehouseId === bornA.warehouseId &&
      giris.toStatus === RollStatus.WAREHOUSE &&
      giris.fromWarehouseId === null &&
      giris.fromStatus === null &&
      giris.reasonCode === STOCK_MOVE_REASON.FASON_RECEIPT &&
      Number(giris.qty) === 290,
    JSON.stringify(giris),
  );

  // ═══ §2 — FASON ARA ADIM: born top üretim hattında, SATIR YOK ═══
  const b = await woKur("ARA", 300, false);
  await sub.receive(
    { workOrderId: b.woId, stepId: b.fasonStep, subcontractorId: SUB, returns: [{ rollId: b.rollId }], newRolls: [{ qty: 280 }] },
    ADMIN,
  );
  const bornB = await bornTop(b.woId);
  rollIds.push(bornB.id);
  const dB = await defter(bornB.id);
  check(
    "§2 ⭐ ARA ADIM: defter satırı YOK (olay yokluğu) ve born top gerçekten IN_PRODUCTION",
    bornB.status === RollStatus.IN_PRODUCTION && dB.length === 0,
    `${bornB.status} · satır=${dB.length}`,
  );

  // ═══ §3 — KISMİ KABUL topu TÜKETMEZ ═══
  // Fason kuralı: kısmi kabulde ebeveyn AT_SUBCONTRACTOR kalır, barkodu yaşar.
  // Ebeveynin ÇIKIŞ satırı bugün HİÇ yazılmıyor (dilim 2b) — bu kalem o boşluğu
  // değil, kısmi kabulün ebeveyne YENİ satır yazmadığını ölçer.
  const c = await woKur("KISMI", 400, true);
  // ⚠️ ÖNCE/SONRA KARŞILAŞTIRMASI, mutlak 0 DEĞİL: dilim 2b'den beri ebeveynin
  // SEVK çıkış satırı var (meşru). İddia "ebeveynin satırı yok" değil, "kısmi
  // kabul ebeveyne YENİ satır YAZMAZ" — mutlak sayı yazsaydım kalem 2b inerken
  // kırmızı olur ve gerçek bir davranış değişmediği hâlde kusur sanılırdı.
  const ebeveynOnce = (await defter(c.rollId)).length;
  await sub.receive(
    { workOrderId: c.woId, stepId: c.fasonStep, subcontractorId: SUB, returns: [{ rollId: c.rollId, receivedQty: 150 }], newRolls: [{ qty: 150 }] },
    ADMIN,
  );
  const ebeveyn = await prisma.roll.findUniqueOrThrow({ where: { id: c.rollId }, select: { status: true } });
  const dEbeveyn = await defter(c.rollId);
  check(
    "§3 ⭐ Kısmi kabul ebeveyni TÜKETMEDİ (AT_SUBCONTRACTOR) ve ona YENİ defter satırı yazmadı",
    ebeveyn.status === RollStatus.AT_SUBCONTRACTOR && dEbeveyn.length === ebeveynOnce,
    `${ebeveyn.status} · ebeveyn satırı ${ebeveynOnce} → ${dEbeveyn.length}`,
  );
  const bornC = await bornTop(c.woId);
  rollIds.push(bornC.id);
  const dC = await defter(bornC.id);
  check(
    "§3b Kısmi kabulün born topu satırını ALDI (körlük zemini)",
    dC.filter((x) => x.eventType === WarehouseEventType.ENTRY).length === 1,
    `satır=${dC.length}`,
  );
}

async function cleanup(): Promise<void> {
  const tumToplar = await prisma.roll
    .findMany({ where: { OR: [{ id: { in: rollIds } }, { parentReceipt: { workOrderId: { in: woIds } } }] }, select: { id: true } })
    .catch(() => []);
  const ids = [...new Set([...rollIds, ...tumToplar.map((r) => r.id)])];
  if (ids.length) {
    // FK sırası: ters satır → hareket → sapma → top.
    await prisma.warehouseMovement.deleteMany({ where: { reversesMovement: { rollId: { in: ids } } } }).catch(() => {});
    await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: ids } } }).catch(() => {});
    await prisma.rollVariance.deleteMany({ where: { rollId: { in: ids } } }).catch(() => {});
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: ids } } }).catch(() => {});
    await prisma.rollProperty.deleteMany({ where: { rollId: { in: ids } } }).catch(() => {});
  }
  if (woIds.length) {
    await prisma.subcontractorReceipt.deleteMany({ where: { workOrderId: { in: woIds } } }).catch(() => {});
    await prisma.subcontractorDispatch.deleteMany({ where: { workOrderId: { in: woIds } } }).catch(() => {});
  }
  if (ids.length) await prisma.roll.deleteMany({ where: { id: { in: ids } } }).catch(() => {});
  if (woIds.length) {
    await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: woIds } } }).catch(() => {});
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } }).catch(() => {});
    await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } }).catch(() => {});
  }
}

main()
  .catch((e) => {
    console.error("\n💥 ÇÖKTÜ:", e);
    fail++;
  })
  .finally(async () => {
    await cleanup();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
