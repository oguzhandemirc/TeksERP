// =============================================================================
// Test: MÜŞTERİYE DOĞRUDAN SEVK YAPILMIŞ FASON SEVKİ KİLİTLENİR
// Çalıştır: npx tsx scripts/run-all-tests.ts test_fason_direct_ship_dispatch_lock
// =============================================================================
// Kısmi (bölünmeli) doğrudan sevkte sevk DAMGALANMAZ: `directShippedAt` null
// kalır, kalan top fasonda `AT_SUBCONTRACTOR` durur, kalem outstanding görünür.
// Yani sevkin "müşteriye mal çıkardığı" bilgisini yalnız DSK kaydı taşır ve
// DSK'yı görmeyen her yol sevki iptal edilebilir/taşınabilir sanır:
//   • `cancel()` → sevk storno olur, irsaliye VOID alır, DSK ve tahsisler iptal
//     edilmiş sevke bağlı kalır (müşteriye gitmiş mal "hiç sevk edilmedi" olur),
//   • K15 birleştirme konsolidasyonu → kalemler başka sevke taşınır, kaynak sevk
//     K15_MERGE ile kapanır; fason karnesi teslim metrajını DSK'nın SEVKİNDEN
//     okuduğu için o metre ATFINI kaybeder,
//   • K16 cerrahisi → aynı şey taşıma/bölme yolundan olur.
// KURAL: DSK taşıyan sevk iptal EDİLMEZ ve kalemleri TAŞINMAZ. Fasonda kalan mal
// normal kabul ya da "kalan gelmeyecek" kapamasıyla kapanır.
// =============================================================================
import * as fs from "node:fs";
import * as path from "node:path";

import { RollStatus } from "@prisma/client";

import prisma, { pool } from "../src/lib/prisma";
import { mergeBatches, splitBatch } from "../src/services/batch.service";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { WorkOrderService } from "../src/services/workorder.service";
import { ensureTestDyeHouse } from "./fixture-subcontractor";
import { ensureTestAdmin } from "./fixture-test-user";
import { fixtureWarehouseId } from "./fixture-warehouse";
import { atlamaDefteri } from "./lib/atlama";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}
/**
 * ⚠️ ATLAMA DEFTERİ ORTAK ALTYAPIDIR — yerel kopya AÇILMAZ (kopya `"?"` sınıfını
 * temsil edemez ve sayıyı elle düzeltmeye zorlar).
 */
const ATLAMA = atlamaDefteri(() => {
  fail++;
});

function atla(label: string, neden: string, adet: number | "?" = 1): void {
  ATLAMA.atla(label, neden, adet);
}

const sub = new SubcontractorService();
const cards = new TravelerCardService();
const wos = new WorkOrderService();
const TAG = `TEST-DSL-${`${Date.now()}`.slice(-7)}`;
const ctx = { item: "", admin: "", stBoya: "", stKursun: "", sub: "", customer: "" };
const ids = { wos: [] as string[], dispatches: [] as string[] };
let bc = 0;

function hataKimligi(e: unknown): { status: number | null; code: string | null; message: string } {
  const err = e as { statusCode?: number; details?: { code?: string }; message?: string };
  return {
    status: typeof err?.statusCode === "number" ? err.statusCode : null,
    code: typeof err?.details?.code === "string" ? err.details.code : null,
    message: typeof err?.message === "string" ? err.message : String(e),
  };
}
async function hata(fn: () => Promise<unknown>): Promise<ReturnType<typeof hataKimligi> | null> {
  try { await fn(); return null; } catch (e) { return hataKimligi(e); }
}

async function woKur(): Promise<{ woId: string; stepId: string }> {
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `${TAG}-WO${ids.wos.length}`,
      type: "STOCK_PRODUCTION",
      status: "IN_PROGRESS",
      targetItemId: ctx.item,
      steps: { create: [{ stationId: ctx.stBoya, stepSequence: 1, status: "PENDING" }, { stationId: ctx.stKursun, stepSequence: 2, status: "PENDING" }] },
    },
    include: { steps: { orderBy: { stepSequence: "asc" } } },
  });
  ids.wos.push(wo.id);
  await prisma.$transaction((tx) => cards.createForWorkOrder(tx, wo.id, ctx.admin));
  return { woId: wo.id, stepId: wo.steps[0]!.id };
}

async function topKur(qty: number): Promise<string> {
  bc++;
  const r = await prisma.roll.create({
    data: { barcode: `TST-DSL-${`${Date.now()}`.slice(-7)}${bc}`, itemId: ctx.item, initialQty: qty, currentQty: qty, status: RollStatus.STOCK, warehouseId: await fixtureWarehouseId(), width: 250, createdById: ctx.admin },
    select: { id: true },
  });
  return r.id;
}

async function sevkEt(woId: string, stepId: string, rollIds: string[]): Promise<{ id: string; batchId: string | null; dispatchNo: string }> {
  const d = await sub.dispatch({ workOrderId: woId, stepId, subcontractorId: ctx.sub, rollIds }, ctx.admin);
  const id = (d.data as { id: string }).id;
  ids.dispatches.push(id);
  const row = await prisma.subcontractorDispatch.findUniqueOrThrow({ where: { id }, select: { batchId: true, dispatchNo: true } });
  return { id, batchId: row.batchId, dispatchNo: row.dispatchNo };
}

/** 300 m'lik topun 100 m'sini müşteriye sevk eder (bölünme; sevk DAMGASIZ kalır). */
async function kismiMusteriyeSevk(dispatchId: string, rollId: string, metre: number): Promise<string> {
  await sub.executeDirectShip(
    { dispatchId, reason: "bekci kismi dogrudan sevk", customerId: ctx.customer, rollIds: [rollId], rollShipQtys: { [rollId]: metre } },
    ctx.admin,
  );
  const ds = await prisma.directShipment.findFirstOrThrow({ where: { dispatchId }, select: { shipmentNo: true } });
  return ds.shipmentNo;
}

async function main(): Promise<void> {
  console.log("\n=== DSK'lı fason sevki kilidi ===\n");
  const need = (v: { id: string } | null, label: string): string => {
    if (!v) throw new Error(`Seed fixture eksik: ${label} — önce 'npm run seed:fixtures'`);
    return v.id;
  };
  ctx.item = need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "PATOS");
  // Aktör FIXTURE'dan çözülür: seed yöneticisini adıyla aramak ortam
  // bağımlılığıdır (tavan bekçisi `test_ortam_bagimliligi_tavani` sayar).
  ctx.admin = (await ensureTestAdmin()).id;
  ctx.stBoya = need(await prisma.station.findFirst({ where: { code: "BOYA_FASON" }, select: { id: true } }), "BOYA_FASON");
  ctx.stKursun = need(await prisma.station.findFirst({ where: { code: "KURSUN_KK2" }, select: { id: true } }), "KURSUN_KK2");
  ctx.customer = need(await prisma.customer.findFirst({ where: { code: "MUS-001" }, select: { id: true } }), "MUS-001");
  ctx.sub = (await ensureTestDyeHouse()).id;

  // ── D1) SEVK İPTALİ ───────────────────────────────────────────────────────
  console.log("── D1) Müşteriye mal çıkmış sevk iptal edilemez ──");
  {
    const wo = await woKur();
    const roll = await topKur(300);
    const d = await sevkEt(wo.woId, wo.stepId, [roll]);
    const dskNo = await kismiMusteriyeSevk(d.id, roll, 100);
    const oncesi = await prisma.subcontractorDispatch.findUniqueOrThrow({ where: { id: d.id }, select: { directShippedAt: true } });
    check("D1-0 ön koşul: sevk DAMGASIZ (kısmi sevk), DSK var", oncesi.directShippedAt === null && dskNo.length > 0, dskNo);

    const e = await hata(() => sub.cancel(d.id, "bekçi iptal denemesi", ctx.admin));
    check("D1a: iptal 409 (eski kod storno ederdi)", e?.status === 409, `${e?.status} · ${e?.message.slice(0, 60)}`);
    check("D1b: gerekçe DSK numarasını söylüyor", (e?.message ?? "").includes(dskNo), e?.message.slice(0, 90) ?? "");
    const sonra = await prisma.subcontractorDispatch.findUniqueOrThrow({ where: { id: d.id }, select: { cancelledAt: true } });
    check("D1c: sevk iptal edilmedi", sonra.cancelledAt === null);
    const kalan = await prisma.roll.findUniqueOrThrow({ where: { id: roll }, select: { status: true, currentQty: true } });
    check("D1d: kalan 200 m hâlâ fasonda", kalan.status === RollStatus.AT_SUBCONTRACTOR && Number(kalan.currentQty) === 200, `${kalan.status} · ${kalan.currentQty}`);
    const dsSayi = await prisma.directShipment.count({ where: { dispatchId: d.id } });
    check("D1e: DSK kaydı duruyor", dsSayi === 1);

    // Önizleme ile uç AYNI yüklemi kullanır: ekran "iptal edilebilir" dememeli.
    const impact = (await wos.getCancelImpact(wo.woId)).data as {
      openDispatches: Array<{ dispatchNo: string; cancellable: boolean; blockReason: string | null }>;
    };
    const satir = impact.openDispatches.find((x) => x.dispatchNo === d.dispatchNo);
    check("D1f: iptal önizlemesi de 'iptal edilemez' diyor (tek kaynak)",
      satir !== undefined && satir.cancellable === false && (satir.blockReason ?? "").includes(dskNo),
      satir ? `${satir.cancellable} · ${(satir.blockReason ?? "").slice(0, 50)}` : "(satır yok)");
  }

  // ── D2) İŞ EMRİ İPTALİ — kilit çıkmaz sokak DEĞİL ─────────────────────────
  console.log("\n── D2) WO iptali: sevk kapanmaz, kalan mal kararla kapanır ──");
  {
    const wo = await woKur();
    const roll = await topKur(300);
    const d = await sevkEt(wo.woId, wo.stepId, [roll]);
    await kismiMusteriyeSevk(d.id, roll, 100);

    const e = await hata(() => wos.softDelete(wo.woId, ctx.admin, { reason: "bekçi WO iptali", fasonAction: "RETURN_TO_STOCK" }));
    check("D2a: karar sorulmadan iptal edilmiyor (FASON_REMAINDER_DECISION_REQUIRED)",
      e?.status === 409 && e.code === "FASON_REMAINDER_DECISION_REQUIRED", `${e?.status} ${e?.code ?? ""}`);

    const e2 = await hata(() => wos.softDelete(wo.woId, ctx.admin, {
      reason: "bekçi WO iptali",
      fasonAction: "RETURN_TO_STOCK",
      fasonRemainderAction: "CLOSE_AS_SCRAP",
      fasonRemainderReasonCode: "BOYA_HATASI",
    }));
    check("D2b: 'kalan gelmeyecek' kararıyla WO iptal edilebiliyor", e2 === null, e2?.message.slice(0, 80) ?? "");
    const woRow = await prisma.workOrder.findUniqueOrThrow({ where: { id: wo.woId }, select: { status: true } });
    check("D2c: WO iptal edildi", woRow.status === "CANCELLED", woRow.status);
    const dRow = await prisma.subcontractorDispatch.findUniqueOrThrow({ where: { id: d.id }, select: { cancelledAt: true } });
    check("D2d: DSK'lı sevk iptal EDİLMEDİ", dRow.cancelledAt === null);
    const kalem = await prisma.subcontractorDispatchItem.findFirstOrThrow({ where: { dispatchId: d.id }, select: { remainderClosedAt: true } });
    check("D2e: fasonda kalan metre 'kalan gelmeyecek' ile kapandı", kalem.remainderClosedAt !== null);
  }

  // ── D3) K15 PARTİ BİRLEŞTİRME KONSOLİDASYONU ──────────────────────────────
  console.log("\n── D3) K15: DSK'lı sevk konsolidasyona girmez ──");
  {
    const wo = await woKur();
    const r1 = await topKur(300);
    const r2 = await topKur(150);
    const d1 = await sevkEt(wo.woId, wo.stepId, [r1]);
    const d2 = await sevkEt(wo.woId, wo.stepId, [r2]);
    await kismiMusteriyeSevk(d1.id, r1, 100);
    if (!d1.batchId || !d2.batchId || d1.batchId === d2.batchId) {
      atla("D3", "iki sevk aynı partiye düştü — K15 konsolidasyonu kurulamıyor");
    } else {
      const e = await hata(() => mergeBatches({ batchIds: [d1.batchId!, d2.batchId!], userId: ctx.admin }));
      check("D3a: birleştirme DSK yüzünden patlamıyor", e === null, e?.message.slice(0, 80) ?? "");
      const rows = await prisma.subcontractorDispatch.findMany({
        where: { id: { in: [d1.id, d2.id] } },
        select: { id: true, cancelledAt: true, _count: { select: { items: true } } },
      });
      const a = rows.find((x) => x.id === d1.id)!;
      const b = rows.find((x) => x.id === d2.id)!;
      check("D3b: DSK'lı sevk iptal edilmedi (eski kod K15_MERGE ile kapatabilirdi)", a.cancelledAt === null);
      check("D3c: DSK'lı sevkin kalemi taşınmadı", a._count.items === 1, `${a._count.items} kalem`);
      check("D3d: diğer sevk de açık kaldı (konsolide edecek eş yok)", b.cancelledAt === null && b._count.items === 1, `${b._count.items} kalem`);
    }
  }

  // ── D4) K16 CERRAHİSİ ─────────────────────────────────────────────────────
  console.log("\n── D4) K16: DSK'lı sevkin kalemi başka partiye taşınamaz ──");
  {
    const wo = await woKur();
    const r1 = await topKur(300);
    const r2 = await topKur(150);
    const d = await sevkEt(wo.woId, wo.stepId, [r1, r2]);
    const dskNo = await kismiMusteriyeSevk(d.id, r1, 100);
    if (!d.batchId) {
      atla("D4", "sevk partisiz doğdu — K16 cerrahisi kurulamıyor");
    } else {
      const e = await hata(() => splitBatch({ batchId: d.batchId!, rollIds: [r1], userId: ctx.admin }));
      check("D4a: bölme 409 (eski kod kalemi taşır, kaynağı kapatırdı)", e?.status === 409, `${e?.status} · ${e?.message.slice(0, 60)}`);
      check("D4b: gerekçe DSK numarasını söylüyor", (e?.message ?? "").includes(dskNo), e?.message.slice(0, 90) ?? "");
      const kalemler = await prisma.subcontractorDispatchItem.count({ where: { dispatchId: d.id } });
      check("D4c: kalemler yerinde kaldı", kalemler === 2, `${kalemler} kalem`);
      const dRow = await prisma.subcontractorDispatch.findUniqueOrThrow({ where: { id: d.id }, select: { cancelledAt: true } });
      check("D4d: sevk iptal edilmedi", dRow.cancelledAt === null);
    }
  }

  // ── D5) YARIŞ: iptal ile kısmi doğrudan sevk aynı anda ───────────────────
  console.log("\n── D5) Eşzamanlı iptal + kısmi doğrudan sevk: ikisi birden olmaz ──");
  {
    const wo = await woKur();
    const roll = await topKur(300);
    const d = await sevkEt(wo.woId, wo.stepId, [roll]);
    // İki yol AYNI ANDA: guard okuması tx DIŞINDA olduğu için eski kod ikisini de
    // başarıyordu (DSK iptal edilmiş sevke asılı kalıyordu). Artık DSK koşulu
    // iptal CLAIM'inin içinde: kaybeden taraf 409 alır.
    const [iptal, sevk] = await Promise.allSettled([
      sub.cancel(d.id, "bekçi yarış iptali", ctx.admin),
      kismiMusteriyeSevk(d.id, roll, 100),
    ]);
    const row = await prisma.subcontractorDispatch.findUniqueOrThrow({
      where: { id: d.id }, select: { cancelledAt: true, _count: { select: { directShipments: true } } },
    });
    const iptalOldu = row.cancelledAt !== null;
    const dskVar = row._count.directShipments > 0;
    check("D5a: iptal ve DSK AYNI ANDA olamaz (biri 409 aldı)", !(iptalOldu && dskVar),
      `iptal=${iptalOldu} · dsk=${dskVar} · sonuçlar=${iptal.status}/${sevk.status}`);
    check("D5b: en az biri başarılı (ikisi birden düşmedi)", iptalOldu || dskVar,
      `iptal=${iptalOldu} · dsk=${dskVar}`);
    if (dskVar) {
      const kalan = await prisma.roll.findUniqueOrThrow({ where: { id: roll }, select: { status: true } });
      check("D5c: DSK kazandıysa kalan top hâlâ fasonda (iptal ebeveyni stoğa indirmedi)",
        kalan.status === RollStatus.AT_SUBCONTRACTOR, kalan.status);
    } else {
      check("D5c: iptal kazandıysa DSK kaydı hiç doğmadı", row._count.directShipments === 0);
    }
  }

  // ── D6) Kapı CLAIM'de mi (metin sondası) ─────────────────────────────────
  console.log("\n── D6) İptal claim'i DSK koşulunu taşıyor ──");
  {
    const kaynak = fs.readFileSync(
      path.resolve(__dirname, "..", "src", "services", "subcontractor.service.ts"),
      "utf8",
    );
    check("D6a: cancel claim'inde `directShipments: { none: {} }` var (tx-içi kapı)",
      /cancelledAt: null, directShipments: \{ none: \{\} \}/.test(kaynak),
      "claim yüklemi");
  }
}

async function temizle(): Promise<void> {
  if (ids.wos.length === 0) return;
  try {
    const woIds = ids.wos;
    const dispatchIds = (await prisma.subcontractorDispatch.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } })).map((d) => d.id);
    const stepIds = (await prisma.workOrderStep.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } })).map((s) => s.id);
    const dsIds = (await prisma.directShipment.findMany({ where: { dispatchId: { in: dispatchIds } }, select: { id: true } })).map((d) => d.id);
    const receiptIds = (await prisma.subcontractorReceipt.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } })).map((r) => r.id);
    const taban = (await prisma.roll.findMany({
      where: { OR: [{ currentStepId: { in: stepIds } }, { producedInStepId: { in: stepIds } }, { parentReceiptId: { in: receiptIds } }, { directShipmentId: { in: dsIds } }, { barcode: { startsWith: "TST-DSL-" } }] },
      select: { id: true },
    })).map((r) => r.id);
    const cocuk = (await prisma.roll.findMany({ where: { parentRollId: { in: taban } }, select: { id: true } })).map((r) => r.id);
    const rollIds = [...new Set([...taban, ...cocuk])];
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
  } catch (e) {
    console.error("temizlik hatası:", e instanceof Error ? e.message : e);
    fail++;
  }
}

main()
  .catch((e) => { console.error("HATA:", e); fail++; })
  .finally(async () => {
    await temizle();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız${ATLAMA.ozetEki()} ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exitCode = fail > 0 ? 1 : 0;
  });
