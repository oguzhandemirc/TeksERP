// =============================================================================
// Test: KALAN KAPAMASI GERİ ALMA KAPISI (reopenRemainder)
// Çalıştır: npx tsx scripts/run-all-tests.ts test_fason_reopen_remainder_guard
// =============================================================================
// Geri alma yolu topu `SUBCONTRACTOR_CONSUMED` → `AT_SUBCONTRACTOR` çeker ve
// `stepId` İSTEK GÖVDESİNDEN gelir. Kapı yalnız topun DURUMUNA bakarsa (eski
// hali) şunlar da "geri alınabilir" olur ve sistemde olmayan mal fasonda
// bekliyor görünür:
//   • TAM KABULLE tüketilmiş top (kapama kararı hiç verilmemiş),
//   • fasondan doğrudan MÜŞTERİYE sevk edilmiş top (mal fabrikada değil),
//   • başka bir adımın stepId'si (top o adıma hiç uğramamış olabilir).
// Kapı bu yüzden topun GEÇMİŞİNDEN kurulur: bu adımda o topun `remainderClosedAt`
// damgalı sevk kalemi VAR MI? Damga aynı zamanda atomik claim'dir (iki eşzamanlı
// geri almadan biri 409 alır).
// =============================================================================
import * as fs from "node:fs";
import * as path from "node:path";

import { RollStatus } from "@prisma/client";

import prisma, { pool } from "../src/lib/prisma";
import { OPEN_OUTSTANDING } from "../src/services/helpers/fason-open-dispatch.helper";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { VARIANCE_SOURCES } from "../src/constants/variance-reasons";
import { ensureTestDyeHouse } from "./fixture-subcontractor";
import { ensureTestAdmin } from "./fixture-test-user";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

const sub = new SubcontractorService();
const cards = new TravelerCardService();
const TAG = `TEST-RRG-${`${Date.now()}`.slice(-7)}`;
const ctx = { item: "", admin: "", stBoya: "", stKursun: "", sub: "", customer: "" };
const ids = { wos: [] as string[], dispatches: [] as string[] };
let bc = 0;

/** Servis hatasının 409 + `details.code` kimliği — mesaj metnine yaslanmaz. */
function hataKimligi(e: unknown): { status: number | null; code: string | null; message: string } {
  const err = e as { statusCode?: number; details?: { code?: string }; message?: string };
  return {
    status: typeof err?.statusCode === "number" ? err.statusCode : null,
    code: typeof err?.details?.code === "string" ? err.details.code : null,
    message: typeof err?.message === "string" ? err.message : String(e),
  };
}

async function reopenHatasi(stepId: string, rollId: string): Promise<{ status: number | null; code: string | null; message: string } | null> {
  try {
    await sub.reopenRemainder({ stepId, rollId }, ctx.admin);
    return null;
  } catch (e) {
    return hataKimligi(e);
  }
}

async function kurSevk(qtys: number[], tekAdim = false): Promise<{ woId: string; stepId: string; kursunStepId: string | null; dispatchId: string; rollIds: string[] }> {
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `${TAG}-WO${ids.wos.length}`,
      type: "STOCK_PRODUCTION",
      status: "IN_PROGRESS",
      targetItemId: ctx.item,
      steps: {
        create: tekAdim
          ? [{ stationId: ctx.stBoya, stepSequence: 1, status: "PENDING" as const }]
          : [
              { stationId: ctx.stBoya, stepSequence: 1, status: "PENDING" as const },
              { stationId: ctx.stKursun, stepSequence: 2, status: "PENDING" as const },
            ],
      },
    },
    include: { steps: { orderBy: { stepSequence: "asc" } } },
  });
  ids.wos.push(wo.id);
  await prisma.$transaction((tx) => cards.createForWorkOrder(tx, wo.id, ctx.admin));
  const rollIds: string[] = [];
  for (const q of qtys) {
    bc++;
    const r = await prisma.roll.create({
      data: { barcode: `TST-RRG-${`${Date.now()}`.slice(-7)}${bc}`, itemId: ctx.item, initialQty: q, currentQty: q, status: RollStatus.STOCK, width: 250, createdById: ctx.admin },
      select: { id: true },
    });
    rollIds.push(r.id);
  }
  const stepId = wo.steps[0]!.id;
  const d = await sub.dispatch({ workOrderId: wo.id, stepId, subcontractorId: ctx.sub, rollIds }, ctx.admin);
  const dispatchId = (d.data as { id: string }).id;
  ids.dispatches.push(dispatchId);
  return { woId: wo.id, stepId, kursunStepId: wo.steps[1]?.id ?? null, dispatchId, rollIds };
}

const durum = async (rollId: string): Promise<{ status: RollStatus; stepId: string | null; dsId: string | null }> => {
  const r = await prisma.roll.findUnique({ where: { id: rollId }, select: { status: true, currentStepId: true, directShipmentId: true } });
  return { status: r!.status, stepId: r!.currentStepId, dsId: r!.directShipmentId };
};

async function main(): Promise<void> {
  console.log("\n=== Kalan kapaması geri alma kapısı ===\n");
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

  // ── G1) MEŞRU GERİ ALMA — korunan davranış ───────────────────────────────
  console.log("── G1) Kapama yapılmış top geri alınabilir (korunan davranış) ──");
  {
    const z = await kurSevk([100]);
    await sub.closeRemainder({ stepId: z.stepId, rollId: z.rollIds[0]!, reasonCode: "BOYA_HATASI" }, ctx.admin);
    const hata = await reopenHatasi(z.stepId, z.rollIds[0]!);
    check("G1a: geri alma çalışır (hata yok)", hata === null, hata?.message ?? "");
    const d = await durum(z.rollIds[0]!);
    check("G1b: top yeniden fasonda ve adımda", d.status === RollStatus.AT_SUBCONTRACTOR && d.stepId === z.stepId, `${d.status}`);
    const kalem = await prisma.subcontractorDispatchItem.findFirst({ where: { dispatchId: z.dispatchId }, select: { remainderClosedAt: true } });
    check("G1c: kapama damgası kalktı", kalem?.remainderClosedAt === null);
    const sapma = await prisma.rollVariance.findMany({ where: { rollId: z.rollIds[0]!, source: VARIANCE_SOURCES.SUBCONTRACTOR_REMAINDER }, select: { reversedAt: true } });
    check("G1d: fire satırı silinmedi, terslendi", sapma.length > 0 && sapma.every((v) => v.reversedAt !== null), `${sapma.length} satır`);
    check("G1e: sevk yeniden OPEN_OUTSTANDING", (await prisma.subcontractorDispatch.count({ where: { id: z.dispatchId, ...OPEN_OUTSTANDING } })) === 1);
    const hareket = await prisma.rollMovement.findFirst({
      where: { rollId: z.rollIds[0]!, workOrderStepId: z.stepId, revokedAt: null },
      select: { exitedAt: true, qtyOut: true, notes: true },
    });
    check("G1g: hareket yeniden AÇILDI (exitedAt/qtyOut null, notes REMAINDER_REOPENED)",
      hareket?.exitedAt === null && hareket.qtyOut === null && hareket.notes === "REMAINDER_REOPENED",
      `${hareket?.notes} · exitedAt ${hareket?.exitedAt ? "DOLU" : "null"}`);
    const adim = await prisma.workOrderStep.findUniqueOrThrow({ where: { id: z.stepId }, select: { status: true } });
    check("G1h: adım ACTIVE", adim.status === "ACTIVE", adim.status);

    const ikinci = await reopenHatasi(z.stepId, z.rollIds[0]!);
    check("G1f: ikinci geri alma 409 REMAINDER_NOT_CLOSED (top artık fasonda)",
      ikinci?.status === 409 && ikinci.code === "REMAINDER_NOT_CLOSED", `${ikinci?.status} ${ikinci?.code ?? ""}`);
  }

  // ── G2) DOĞRUDAN MÜŞTERİYE SEVK EDİLMİŞ TOP ──────────────────────────────
  console.log("\n── G2) Müşteriye giden top fasona diriltilemez ──");
  {
    const z = await kurSevk([200, 200]);
    await sub.executeDirectShip({ dispatchId: z.dispatchId, reason: "kapı bekçisi alt küme", customerId: ctx.customer, rollIds: [z.rollIds[0]!] }, ctx.admin);
    const oncesi = await durum(z.rollIds[0]!);
    check("G2a ön koşul: top tüketildi ve DSK'ya bağlandı", oncesi.status === RollStatus.SUBCONTRACTOR_CONSUMED && oncesi.dsId !== null);
    const hata = await reopenHatasi(z.stepId, z.rollIds[0]!);
    check("G2b: 409 ROLL_DIRECT_SHIPPED (eski kapı topu fasona geri alırdı)",
      hata?.status === 409 && hata.code === "ROLL_DIRECT_SHIPPED", `${hata?.status} ${hata?.code ?? ""}`);
    const sonrasi = await durum(z.rollIds[0]!);
    check("G2c: top değişmedi", sonrasi.status === RollStatus.SUBCONTRACTOR_CONSUMED && sonrasi.stepId === null && sonrasi.dsId !== null, `${sonrasi.status}`);
  }

  // ── G3) TAM KABULLE TÜKETİLMİŞ TOP ───────────────────────────────────────
  console.log("\n── G3) Kabul edilmiş top 'kapama geri alma' ile diriltilemez ──");
  {
    const z = await kurSevk([150]);
    await sub.receive({ workOrderId: z.woId, stepId: z.stepId, subcontractorId: ctx.sub, returns: [{ rollId: z.rollIds[0]! }], newRolls: [{ qty: 150 }] }, ctx.admin);
    const oncesi = await durum(z.rollIds[0]!);
    check("G3a ön koşul: kaynak top tam kabulle tüketildi", oncesi.status === RollStatus.SUBCONTRACTOR_CONSUMED);
    const hata = await reopenHatasi(z.stepId, z.rollIds[0]!);
    check("G3b: 409 REMAINDER_NOT_CLOSED_AT_STEP (kapama kararı hiç verilmemiş)",
      hata?.status === 409 && hata.code === "REMAINDER_NOT_CLOSED_AT_STEP", `${hata?.status} ${hata?.code ?? ""}`);
    const sonrasi = await durum(z.rollIds[0]!);
    check("G3c: top tüketilmiş kaldı", sonrasi.status === RollStatus.SUBCONTRACTOR_CONSUMED && sonrasi.stepId === null);
  }

  // ── G4) GÖVDEDEN GELEN YANLIŞ ADIM ───────────────────────────────────────
  console.log("\n── G4) Kapama başka adımda: gövdedeki stepId kanıt değildir ──");
  {
    const z = await kurSevk([120]);
    await sub.closeRemainder({ stepId: z.stepId, rollId: z.rollIds[0]!, reasonCode: "BOYA_HATASI" }, ctx.admin);
    // İki adımlı rota → kurşun adımı DAİMA var (tek adımlı varyant yalnız G5'te).
    const hata = await reopenHatasi(z.kursunStepId!, z.rollIds[0]!);
    check("G4a: yanlış adımla 409 REMAINDER_NOT_CLOSED_AT_STEP (eski kapı topu O adıma taşırdı)",
      hata?.status === 409 && hata.code === "REMAINDER_NOT_CLOSED_AT_STEP", `${hata?.status} ${hata?.code ?? ""}`);
    const d = await durum(z.rollIds[0]!);
    check("G4b: top kapalı kaldı, kurşun adımına taşınmadı", d.status === RollStatus.SUBCONTRACTOR_CONSUMED && d.stepId === null, `${d.status} · step ${d.stepId ? "DOLU" : "null"}`);
    const kalem = await prisma.subcontractorDispatchItem.findFirst({ where: { dispatchId: z.dispatchId }, select: { remainderClosedAt: true } });
    check("G4c: kapama damgası duruyor", kalem?.remainderClosedAt !== null);
    void z.kursunStepId;
  }

  // ── G5) SON ADIM FASON: geri alma İŞ EMRİNİ ve KARTI da diriltir ─────────
  console.log("\n── G5) Tek adımlı rota: WO ve refakat kartı da dirilir ──");
  {
    const z = await kurSevk([90], true);
    await sub.closeRemainder({ stepId: z.stepId, rollId: z.rollIds[0]!, reasonCode: "BOYA_HATASI" }, ctx.admin);
    const kapali = await prisma.workOrder.findUniqueOrThrow({ where: { id: z.woId }, select: { status: true } });
    const kartKapali = await prisma.travelerCard.findFirstOrThrow({ where: { workOrderId: z.woId }, select: { status: true } });
    check("G5-0 ön koşul: kapama WO'yu ve kartı COMPLETED yaptı",
      kapali.status === "COMPLETED" && kartKapali.status === "COMPLETED", `${kapali.status} · kart ${kartKapali.status}`);

    const hata = await reopenHatasi(z.stepId, z.rollIds[0]!);
    check("G5a: geri alma çalıştı", hata === null, hata?.message ?? "");
    const wo = await prisma.workOrder.findUniqueOrThrow({ where: { id: z.woId }, select: { status: true } });
    const kart = await prisma.travelerCard.findFirstOrThrow({ where: { workOrderId: z.woId }, select: { status: true } });
    const adim = await prisma.workOrderStep.findUniqueOrThrow({ where: { id: z.stepId }, select: { status: true } });
    check("G5b: WO yeniden IN_PROGRESS (eski kod COMPLETED bırakıyordu → ikinci sevk 409)", wo.status === "IN_PROGRESS", wo.status);
    check("G5c: refakat kartı yeniden ACTIVE", kart.status === "ACTIVE", kart.status);
    check("G5d: adım ACTIVE", adim.status === "ACTIVE", adim.status);
    const iz = await prisma.travelerCardScan.count({
      where: { card: { workOrderId: z.woId }, notes: { contains: "kalan kapaması geri alındı" } },
    });
    check("G5e: kartta geri alma izi var", iz === 1, `${iz} kayıt`);
  }

  // ── G6) Kardeş top müşteriye gitti → sevk damgalandı; MEŞRU kapama yine geri alınır
  console.log("\n── G6) Damgalı sevkte meşru kapama geri alınabilir ──");
  {
    const z = await kurSevk([200, 200]);
    await sub.closeRemainder({ stepId: z.stepId, rollId: z.rollIds[1]!, reasonCode: "BOYA_HATASI" }, ctx.admin);
    await sub.executeDirectShip({ dispatchId: z.dispatchId, reason: "kapı bekçisi damga", customerId: ctx.customer, rollIds: [z.rollIds[0]!] }, ctx.admin);
    // ⚠️ FIXTURE DAMGASI: damga ölçütü artık kalemlerin topundan okunuyor, yani bu
    // karışık sevk servis yoluyla DAMGALANMAZ (o düzeltme ayrı iştir). Kapının
    // kendisi TARİHSEL damgalı satırlarda da tutmalı → damga elle yazılır.
    await prisma.subcontractorDispatch.update({
      where: { id: z.dispatchId },
      data: { directShippedAt: new Date(), directShipReason: "fixture: tarihsel damga" },
    });
    const damga = await prisma.subcontractorDispatch.findUniqueOrThrow({ where: { id: z.dispatchId }, select: { directShippedAt: true } });
    check("G6-0 ön koşul: sevk damgalı (tarihsel satır şekli)", damga.directShippedAt !== null);

    const hata = await reopenHatasi(z.stepId, z.rollIds[1]!);
    check("G6a: kapama geri alınabiliyor (eski süzgeç sonsuza dek 409 veriyordu)", hata === null, hata?.message.slice(0, 80) ?? "");
    const d = await durum(z.rollIds[1]!);
    check("G6b: kapatılmış top yeniden fasonda", d.status === RollStatus.AT_SUBCONTRACTOR && d.stepId === z.stepId, d.status);
    const sevkEdilen = await durum(z.rollIds[0]!);
    check("G6c: müşteriye giden top diriltilmedi", sevkEdilen.status === RollStatus.SUBCONTRACTOR_CONSUMED && sevkEdilen.dsId !== null);
  }

  // ── G10) İŞ EMRİ TERMİNAL: geri alma fail-closed ─────────────────────────
  console.log("\n── G10) İptal edilmiş iş emrinde kapama geri alınamaz ──");
  {
    const z = await kurSevk([110]);
    await sub.closeRemainder({ stepId: z.stepId, rollId: z.rollIds[0]!, reasonCode: "BOYA_HATASI" }, ctx.admin);
    await prisma.workOrder.update({ where: { id: z.woId }, data: { status: "CANCELLED" } });
    const hata = await reopenHatasi(z.stepId, z.rollIds[0]!);
    check("G10a: 409 WORK_ORDER_TERMINAL (eski kod topu iptalli WO'ya geri koyardı)",
      hata?.status === 409 && hata.code === "WORK_ORDER_TERMINAL", `${hata?.status} ${hata?.code ?? ""}`);
    const d = await durum(z.rollIds[0]!);
    check("G10b: top kapalı kaldı", d.status === RollStatus.SUBCONTRACTOR_CONSUMED && d.stepId === null, d.status);
  }

  // ── G7) KAPAT → AÇ → KAPAT → AÇ: defter büyür, damga gidip gelir ─────────
  console.log("\n── G7) İki tur kapama/geri alma: iki sapma satırı, ikisi de terslenmiş ──");
  {
    const z = await kurSevk([120]);
    for (const tur of [1, 2]) {
      await sub.closeRemainder({ stepId: z.stepId, rollId: z.rollIds[0]!, reasonCode: "BOYA_HATASI" }, ctx.admin);
      const acik = await prisma.rollVariance.count({
        where: { rollId: z.rollIds[0]!, source: VARIANCE_SOURCES.SUBCONTRACTOR_REMAINDER, reversedAt: null },
      });
      check(`G7-${tur}a: kapama AKTİF sapma satırı yazdı (tur ${tur})`, acik === 1, `${acik} aktif satır`);
      const hata = await reopenHatasi(z.stepId, z.rollIds[0]!);
      check(`G7-${tur}b: geri alma çalıştı (tur ${tur})`, hata === null, hata?.message.slice(0, 60) ?? "");
    }
    const sapmalar = await prisma.rollVariance.findMany({
      where: { rollId: z.rollIds[0]!, source: VARIANCE_SOURCES.SUBCONTRACTOR_REMAINDER },
      select: { reversedAt: true },
    });
    check("G7c: defter BÜYÜDÜ — iki satır, hiçbiri silinmedi", sapmalar.length === 2, `${sapmalar.length} satır`);
    check("G7d: iki satır da terslenmiş (aktif satır yok)", sapmalar.every((v) => v.reversedAt !== null));
    const kalem = await prisma.subcontractorDispatchItem.findFirstOrThrow({
      where: { dispatchId: z.dispatchId }, select: { remainderClosedAt: true },
    });
    check("G7e: DURUM bayrağı null'a döndü", kalem.remainderClosedAt === null);
    const izler = await prisma.travelerCardScan.count({
      where: { card: { workOrderId: z.woId }, notes: { contains: "kalan" } },
    });
    check("G7f: kartta dört iz var (iki kapama + iki geri alma)", izler === 4, `${izler} iz`);
  }

  // ── G8) KALAN 0 İKEN KAPAMA: çıkışsız damga yasak ────────────────────────
  console.log("\n── G8) Kalan 0 iken kapama 409 (damga var defter yok olmasın) ──");
  {
    const z = await kurSevk([80]);
    // Ölçülmüş boşluğun şekli: `recordVarianceTx` 0 metrajda satır YAZMAZ, yani
    // kapama damgayı basar ama defterde satır olmaz. Kalan metreyi fixture ile
    // 0'a indiriyoruz (servis yolu 0'a indirmiyor).
    await prisma.roll.update({ where: { id: z.rollIds[0]! }, data: { currentQty: 0 } });
    let kod: string | null = null;
    let statu: number | null = null;
    try {
      await sub.closeRemainder({ stepId: z.stepId, rollId: z.rollIds[0]!, reasonCode: "BOYA_HATASI" }, ctx.admin);
    } catch (e) {
      const k = hataKimligi(e);
      kod = k.code;
      statu = k.status;
    }
    check("G8a: 409 REMAINDER_NOTHING_TO_CLOSE", statu === 409 && kod === "REMAINDER_NOTHING_TO_CLOSE", `${statu} ${kod ?? ""}`);
    const kalem = await prisma.subcontractorDispatchItem.findFirstOrThrow({
      where: { dispatchId: z.dispatchId }, select: { remainderClosedAt: true },
    });
    check("G8b: damga BASILMADI (çıkışsız kapama yok)", kalem.remainderClosedAt === null);
    const sapma = await prisma.rollVariance.count({
      where: { rollId: z.rollIds[0]!, source: VARIANCE_SOURCES.SUBCONTRACTOR_REMAINDER },
    });
    check("G8c: defterde de satır yok", sapma === 0, `${sapma} satır`);
  }

  // ── G9) src'de sapma satırı SİLEN kod yok (defter append-only) ───────────
  console.log("\n── G9) src taraması: rollVariance.delete* yok ──");
  {
    const kok = path.resolve(__dirname, "..", "src");
    const dosyalar: string[] = [];
    const gez = (d: string): void => {
      for (const g of fs.readdirSync(d, { withFileTypes: true })) {
        const tam = path.join(d, g.name);
        if (g.isDirectory()) gez(tam);
        else if (g.name.endsWith(".ts")) dosyalar.push(tam);
      }
    };
    gez(kok);
    const ihlal = dosyalar.filter((f) => /rollVariance\.delete/.test(fs.readFileSync(f, "utf8")));
    check("G9a: körlük zemini — src taraması dosya buldu", dosyalar.length > 100, `${dosyalar.length} dosya`);
    check("G9b: hiçbir serviste rollVariance.delete* yok (geri alma TERSLER)", ihlal.length === 0,
      ihlal.map((f) => path.relative(kok, f)).join(", "));
  }
}

async function temizle(): Promise<void> {
  if (ids.wos.length === 0) return;
  try {
    const woIds = ids.wos;
    const dispatchIds = ids.dispatches;
    const stepIds = (await prisma.workOrderStep.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } })).map((s) => s.id);
    const dsIds = (await prisma.directShipment.findMany({ where: { dispatchId: { in: dispatchIds } }, select: { id: true } })).map((d) => d.id);
    const receiptIds = (await prisma.subcontractorReceipt.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } })).map((r) => r.id);
    const taban = (await prisma.roll.findMany({
      where: { OR: [{ currentStepId: { in: stepIds } }, { producedInStepId: { in: stepIds } }, { parentReceiptId: { in: receiptIds } }, { directShipmentId: { in: dsIds } }, { barcode: { startsWith: "TST-RRG-" } }] },
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
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exitCode = fail > 0 ? 1 : 0;
  });
