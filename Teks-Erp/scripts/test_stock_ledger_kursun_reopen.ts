// =============================================================================
// BEKÇİ — ADIMI YENİDEN AÇMAK DEFTERDEN ÇIKIŞ YAZAR (stok defteri, reopen ters yolu)
// Çalıştır: npx tsx scripts/run-all-tests.ts stock_ledger_kursun_reopen
// =============================================================================
// NEDEN: son adımı kapatmak `finalizeRollsAtLastStep` ile depoya GİRİŞ yazıyor,
// ama adımı YENİDEN AÇMAK deftere hiç dokunmuyordu. finish → yeniden aç → finish
// turunda İKİ giriş bir çıkışsız kalıyordu.
//
// ⚠️ FİKSTÜR GERÇEK YOLDAN GEÇER (2026-09-12 denetim bulgusu): top depoda doğar
// ve `attachRolls` ile iş emrine alınır, yani defterde bir ÇIKIŞ satırı (A) da
// vardır. Bu ŞART: fikstür topu doğrudan üretimde doğurursa "yeniden açma yalnız
// KENDİ girişini tersliyor mu" sorusu ölçülemez — bekçi yeşil kalırken kapsamsız
// bir ters kayıt attach çıkışını da silebilir ve depoda HAYALET stok doğar.
//
// ÖLÇÜLENLER
//   §0 Üretime alma ÇIKIŞ satırı (A) yazdı — net −metraj
//   §1 Adımı kapatma GİRİŞ satırı (B) yazdı — net 0
//   §2 Yeniden açma TEK ters satır yazdı ve o satır B'ye bağlı
//   §3 ⭐ Tur sonunda net = −METRAJ (top ÜRETİMDE, stokta değil)
//   §4 ⭐ Üretime alma ÇIKIŞI (A) TERSLENMEDİ — kapsam dışı
//   §5 İkinci finish net'i 0'a döndürür (mal yine depoda)
//   §6 ⭐ İkinci yeniden açma İKİNCİ girişi tersler, net yine −METRAJ
//   §7 Körlük zemini: beş satır
// =============================================================================
import { RollOperationType, RollStatus, StationKind, StepStatus, WarehouseEventType, WorkOrderStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { kapaliHareketFotografi, tersKayitIddialari } from "./lib/hareket-ters-kayit";
import { KursunQcService } from "../src/services/kursun-qc.service";
import { WorkOrderService } from "../src/services/workorder.service";
import { postStockMove } from "../src/services/helpers/warehouse-ledger.helper";
import { STOCK_MOVE_REASON } from "../src/constants/stock-move-reasons";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}

const TAG = `TEST-SLKR-${Date.now()}`;
const rollIds: string[] = [];
const woIds: string[] = [];
const stepIds: string[] = [];
const gradeIds: string[] = [];
let itemId = "";
let gradeId = "";
let stationId = "";
let woId = "";
let stepId = "";

interface Satir {
  id: string;
  eventType: WarehouseEventType;
  qty: unknown;
  fromWarehouseId: string | null;
  toWarehouseId: string | null;
  fromStatus: RollStatus | null;
  toStatus: RollStatus | null;
  reasonCode: string | null;
  reversesMovementId: string | null;
}

async function satirlar(rollId: string): Promise<Satir[]> {
  return prisma.warehouseMovement.findMany({
    where: { rollId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, eventType: true, qty: true,
      fromWarehouseId: true, toWarehouseId: true, fromStatus: true, toStatus: true,
      reasonCode: true, reversesMovementId: true,
    },
  });
}

/** Defter etkisi: giriş ucu +, çıkış ucu −. */
function net(rows: Satir[]): number {
  return rows.reduce((acc, r) => {
    const q = Number(r.qty);
    return acc + (r.toWarehouseId ? q : 0) - (r.fromWarehouseId ? q : 0);
  }, 0);
}

async function main(): Promise<void> {
  console.log("\n=== Adımı yeniden açma: defter ters kaydı ===\n");
  const svc = new KursunQcService();
  const wos = new WorkOrderService();
  const warehouse = await prisma.warehouse.findFirst({ where: { isDefault: true }, select: { id: true } });
  if (!warehouse) throw new Error("Varsayılan depo yok (ensureDefaultWarehouse koşmamış)");

  itemId = (await prisma.item.create({ data: { code: TAG, name: `${TAG} kumaş`, itemType: "FABRIC" }, select: { id: true } })).id;
  const grade = await prisma.qualityGrade.create({
    // ⚠️ AD da damgalanır: kardeş bekçiler ("Test depo kalitesi") ile `nameFold`
    // unique'i çakışıyor ve artık kalırsa ikinci koşum P2002'ye düşüyor.
    data: { code: `${TAG}-W`, name: `${TAG} depo kalitesi`, targetStatus: RollStatus.WAREHOUSE },
    select: { id: true, code: true },
  });
  gradeId = grade.id;
  // ⚠️ Kendi istasyonunu kurar: "ortamdaki herhangi bir PROCESS_QC" üstüne test
  // kurmak temiz DB'de düşer, dolu DB'de vakumen yeşil kalır.
  const station = await prisma.station.create({
    data: { code: `${TAG}-IST`.slice(0, 32), name: `${TAG} KK2`, kind: StationKind.PROCESS_QC, type: "INTERNAL" },
    select: { id: true },
  });
  stationId = station.id;

  const wo = await prisma.workOrder.create({
    data: { workOrderNumber: `${TAG}-WO`, status: WorkOrderStatus.PLANNED },
    select: { id: true },
  });
  woId = wo.id;
  // TEK adım → `nextStep` yok → finish son-adım dalını (finalize) sürer.
  const step = await prisma.workOrderStep.create({
    data: { workOrderId: woId, stationId, stepSequence: 1, status: StepStatus.PENDING },
    select: { id: true },
  });
  stepId = step.id;

  // ── §0 — top DEPODA doğar ve GERÇEK yoldan üretime alınır ─────────────────
  const barcode = `${TAG}-R`;
  const roll = await prisma.roll.create({
    data: {
      barcode, itemId, initialQty: 100, currentQty: 100,
      status: RollStatus.WAREHOUSE, warehouseId: warehouse.id, entrySource: "SUPPLIER_RECEIPT",
      qualityGrade: grade.code, qualityGradeId: gradeId,
    },
    select: { id: true },
  });
  rollIds.push(roll.id);

  const att = await wos.attachRolls(woId, [barcode]);
  const tur0 = await satirlar(roll.id);
  const cikisA = tur0[0];
  check(
    "§0 ⭐ Üretime alma ÇIKIŞ satırı yazdı (fikstür gerçek yoldan geçiyor)",
    att.data?.attached === 1 && tur0.length === 1 && cikisA?.fromWarehouseId === warehouse.id &&
      cikisA?.reasonCode === STOCK_MOVE_REASON.PRODUCTION_ISSUE && net(tur0) === -100,
    `alınan=${att.data?.attached} satır=${tur0.length} net=${net(tur0)}`,
  );

  // `finishStep`in kapısı: bu adımda fiilen yapılmış QC2 kaydı olmayan top varsa
  // adım kapanmaz. Kayıt yeniden açmada KORUNUR, ikinci tur için tekrar gerekmez.
  await prisma.rollOperation.create({
    data: { rollId: roll.id, workOrderStepId: stepId, operationType: RollOperationType.QC2_COMPLETED },
  });

  // ── §1 — birinci finish ───────────────────────────────────────────────────
  await svc.finishStep({ stepId });
  const tur1 = await satirlar(roll.id);
  const girisB = tur1.find((r) => r.toWarehouseId !== null && r.reversesMovementId === null);
  check(
    "§1 Adımı kapatma depoya GİRİŞ yazdı — net 0 (mal çıktığı yere döndü)",
    tur1.length === 2 && girisB?.eventType === WarehouseEventType.PRODUCTION &&
      girisB?.toWarehouseId === warehouse.id && girisB?.toStatus === RollStatus.WAREHOUSE && net(tur1) === 0,
    `satır=${tur1.length} net=${net(tur1)}`,
  );

  // ── §2..§4 — birinci reopen ───────────────────────────────────────────────
  const fotoKursun = await kapaliHareketFotografi(prisma, { rollId: roll.id, workOrderStepId: stepId });
  await svc.reopenStep({ stepId });
  for (const [e, ok, d] of await tersKayitIddialari(prisma, fotoKursun, "KURSUN_REOPEN")) check(`§2h hareket: ${e}`, ok, d);
  const tur2 = await satirlar(roll.id);
  const tersler1 = tur2.filter((r) => r.reversesMovementId !== null);
  check(
    "§2 Yeniden açma TEK ters satır yazdı ve o satır GİRİŞE (B) bağlı",
    tersler1.length === 1 && tersler1[0]?.reversesMovementId === girisB?.id &&
      tersler1[0]?.reasonCode === STOCK_MOVE_REASON.KURSUN_REOPEN,
    `ters=${tersler1.length} bağ=${tersler1[0]?.reversesMovementId === girisB?.id}`,
  );
  // Bağ alanlarının OKUNDUĞU `test_stock_ledger_helper` §4d'de ölçülüyor; burada
  // gerçekten YAZILDIĞI ölçülüyor — `workOrderStepId` canlı bir FK olduğu için
  // bu satır aynı zamanda damganın uçtan uca taşındığının kanıtı.
  const tersAdim = await prisma.warehouseMovement.findUniqueOrThrow({
    where: { id: tersler1[0]!.id },
    select: { workOrderStepId: true },
  });
  check(
    "§2b ⭐ Ters satır ileri satırın `workOrderStepId` damgasını TAŞIDI",
    tersAdim.workOrderStepId === stepId,
    `damga=${String(tersAdim.workOrderStepId)}`,
  );
  check(
    "§3 ⭐ Net = −METRAJ: top ÜRETİMDE, stokta görünmüyor",
    net(tur2) === -100,
    `net=${net(tur2)} (0 çıkarsa depoda HAYALET stok var)`,
  );
  check(
    "§4 ⭐ Üretime alma ÇIKIŞI (A) TERSLENMEDİ — kapsam dışı",
    !tur2.some((r) => r.reversesMovementId === cikisA?.id),
    `A terslendi mi=${tur2.some((r) => r.reversesMovementId === cikisA?.id)}`,
  );
  const canli = await prisma.roll.findUnique({ where: { id: roll.id }, select: { status: true, currentStepId: true } });
  check("§4b Top IN_PRODUCTION'a ve bu adıma geri çekildi", canli?.status === RollStatus.IN_PRODUCTION && canli?.currentStepId === stepId);

  // ── §5 + §6 — ikinci tur ──────────────────────────────────────────────────
  await svc.finishStep({ stepId });
  const tur3 = await satirlar(roll.id);
  check("§5 İkinci finish net'i 0'a döndürdü (mal yine depoda)", tur3.length === 4 && net(tur3) === 0, `satır=${tur3.length} net=${net(tur3)}`);
  const girisC = tur3.find((r) => r.reversesMovementId === null && r.toWarehouseId !== null && r.id !== girisB?.id);

  await svc.reopenStep({ stepId });
  const tur4 = await satirlar(roll.id);
  const tersler2 = tur4.filter((r) => r.reversesMovementId !== null);
  check(
    "§6 ⭐ İkinci yeniden açma İKİNCİ girişi tersledi, net yine −METRAJ",
    tersler2.length === 2 && tersler2.some((r) => r.reversesMovementId === girisC?.id) && net(tur4) === -100,
    `ters=${tersler2.length} net=${net(tur4)}`,
  );
  check("§7 Körlük zemini: beş satır (A + B + tersB + C + tersC)", tur4.length === 5, `n=${tur4.length}`);

  /**
   * §8/§9 için bağımsız senaryo: kendi WO + adımı, depoda doğan top, GERÇEK
   * `attachRolls` yolundan üretime alma ve QC2 damgası. Her senaryo ayrı adımda
   * çünkü `reopenStep` ADIM bazlı çalışır — aynı adımı paylaşan senaryolar
   * birbirinin turunu geri açardı.
   */
  const senaryoKur = async (ek: string, g = grade): Promise<{ rollId: string; stepId: string }> => {
    const w = await prisma.workOrder.create({
      data: { workOrderNumber: `${TAG}-WO-${ek}`, status: WorkOrderStatus.PLANNED },
      select: { id: true },
    });
    woIds.push(w.id);
    const st = await prisma.workOrderStep.create({
      data: { workOrderId: w.id, stationId, stepSequence: 1, status: StepStatus.PENDING },
      select: { id: true },
    });
    stepIds.push(st.id);
    const bc = `${TAG}-${ek}`;
    const r = await prisma.roll.create({
      data: {
        barcode: bc, itemId, initialQty: 100, currentQty: 100,
        status: RollStatus.WAREHOUSE, warehouseId: warehouse.id, entrySource: "SUPPLIER_RECEIPT",
        qualityGrade: g.code, qualityGradeId: g.id,
      },
      select: { id: true },
    });
    rollIds.push(r.id);
    await wos.attachRolls(w.id, [bc]);
    await prisma.rollOperation.create({
      data: { rollId: r.id, workOrderStepId: st.id, operationType: RollOperationType.QC2_COMPLETED },
    });
    return { rollId: r.id, stepId: st.id };
  };

  // ── §8 — GEÇİŞ DALI: damgasız eski satır ──────────────────────────────────
  // Adım damgası bugünden yazılıyor; damga eklenmeden önce yazılmış satırlarda
  // YOK. Kapsam yalnız `workOrderStepId = step.id` olsaydı reopen hiçbir şey
  // terslemez, defter topu depoda gösterirken top üretime dönerdi — aynı hatanın
  // TERS YÖNLÜSÜ. Fikstür damgayı bilerek siliyor (eski veriyi taklit).
  const s2 = await senaryoKur("S2");
  await svc.finishStep({ stepId: s2.stepId });
  await prisma.warehouseMovement.updateMany({
    where: { rollId: s2.rollId, reasonCode: STOCK_MOVE_REASON.PRODUCTION_RECEIPT },
    data: { workOrderStepId: null },
  });
  await svc.reopenStep({ stepId: s2.stepId });
  const s2Rows = await satirlar(s2.rollId);
  check(
    "§8 ⭐ Damgasız eski satır da terslendi (geçiş dalı) — net −METRAJ",
    s2Rows.filter((r) => r.reversesMovementId !== null).length === 1 && net(s2Rows) === -100,
    `ters=${s2Rows.filter((r) => r.reversesMovementId !== null).length} net=${net(s2Rows)}`,
  );

  // ── §9 — AĞIR VARYANT: iki finalize geçmişi ───────────────────────────────
  // Top daha önce BAŞKA bir iş emrini bitirmişse onun damgasız girişi de defterde
  // duruyor. Kapsam `OR workOrderStepId IS NULL` diye TEK yüklemde yazılsaydı o
  // eski giriş de aday olurdu ve reopen GEÇMİŞİ değiştirirdi. İki adımlı sorgu
  // (önce damgalı, bulunamazsa damgasız) bunu engeller.
  const s3 = await senaryoKur("S3");
  const eskiGirisId = await prisma.$transaction(async (tx) =>
    postStockMove(tx, {
      rollId: s3.rollId,
      eventType: WarehouseEventType.PRODUCTION,
      qty: 100,
      to: { warehouseId: warehouse.id, status: RollStatus.WAREHOUSE },
      reasonCode: STOCK_MOVE_REASON.PRODUCTION_RECEIPT,
    }),
  );
  await svc.finishStep({ stepId: s3.stepId });
  await svc.reopenStep({ stepId: s3.stepId });
  const s3Rows = await satirlar(s3.rollId);
  check(
    "§9 ⭐ ESKİ iş emrinin damgasız girişine DOKUNULMADI (geçmiş değişmez)",
    !s3Rows.some((r) => r.reversesMovementId === eskiGirisId) &&
      s3Rows.filter((r) => r.reversesMovementId !== null).length === 1,
    `eski terslendi mi=${s3Rows.some((r) => r.reversesMovementId === eskiGirisId)} ters=${s3Rows.filter((r) => r.reversesMovementId !== null).length}`,
  );

  // ── §10 — FİRE (SCRAP) dalı: giriş hiç yazılmaz ───────────────────────────
  // Kalite SCRAP'e çözülürse `finalizeRollsAtLastStep` GİRİŞ YAZMAZ (mal stoğa
  // dönmüyor, fireye gidiyor). Kapsamsız ters kayıt bu dalda üretime-alma
  // ÇIKIŞINI tersleyip fire mala SAF HAYALET GİRİŞ yazıyordu. Kapsamlı çağrıda
  // terslenecek satır bulunamaz — ve `bulunamayan` burada MEŞRU bir sayıdır,
  // tutarsızlık değil (fire yolunun tanımı gereği giriş yok).
  const gScrap = await prisma.qualityGrade.create({
    data: { code: `${TAG}-S`, name: `${TAG} fire kalitesi`, targetStatus: RollStatus.SCRAP },
    select: { id: true, code: true },
  });
  gradeIds.push(gScrap.id);
  const s4 = await senaryoKur("S4", gScrap);
  await svc.finishStep({ stepId: s4.stepId });
  const s4Finish = await satirlar(s4.rollId);
  await svc.reopenStep({ stepId: s4.stepId });
  const s4Rows = await satirlar(s4.rollId);
  check(
    "§10 ⭐ Fire dalında ters satır YAZILMADI (çıkış terslenip hayalet giriş doğmadı)",
    s4Finish.length === 1 && s4Rows.length === 1 && net(s4Rows) === -100,
    `finish=${s4Finish.length} reopen=${s4Rows.length} net=${net(s4Rows)}`,
  );

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

async function cleanup(): Promise<void> {
  try {
    if (rollIds.length) {
      // Ters satırlar ÖNCE: `reversesMovementId` FK'sı RESTRICT.
      await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds }, reversesMovementId: { not: null } } });
      await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.rollVariance.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.systemLog.deleteMany({ where: { recordId: { in: rollIds } } });
      await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    }
    const tumWo = [...(woId ? [woId] : []), ...woIds];
    const tumStep = [...(stepId ? [stepId] : []), ...stepIds];
    if (tumWo.length) await prisma.batch.deleteMany({ where: { workOrderId: { in: tumWo } } });
    if (tumStep.length) await prisma.workOrderStep.deleteMany({ where: { id: { in: tumStep } } });
    if (tumWo.length) {
      await prisma.systemLog.deleteMany({ where: { recordId: { in: tumWo } } });
      await prisma.workOrder.deleteMany({ where: { id: { in: tumWo } } });
    }
    if (stationId) await prisma.station.deleteMany({ where: { id: stationId } });
    const tumGrade = [...(gradeId ? [gradeId] : []), ...gradeIds];
    if (tumGrade.length) await prisma.qualityGrade.deleteMany({ where: { id: { in: tumGrade } } });
    if (itemId) await prisma.item.deleteMany({ where: { id: itemId } });
    console.log("(test verisi temizlendi)");
  } catch (e) { console.error("cleanup hata:", e instanceof Error ? e.message : e); }
}

main()
  .catch((e) => { console.error("💥 ÇÖKTÜ:", e); fail++; })
  .finally(async () => { await cleanup(); await prisma.$disconnect(); await pool.end(); process.exit(fail > 0 ? 1 : 0); });
