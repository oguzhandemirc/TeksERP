// =============================================================================
// BEKÇİ — Fasonda top varken iş emri İPTAL EDİLEBİLİR (2026-08-17)
// Çalıştır: npx tsx scripts/test_wo_cancel_fason.ts
// =============================================================================
// Saha şikâyeti: "bir iş emrini iptal etmek çok zor, bazen iptal edilemiyor."
// Sebebi somuttu: fasonda (boyahanede) top varsa iptal SERT ENGELLENİYORDU
// ("fason malı ham stoğa geri dönemez") ve kullanıcının HİÇBİR çıkışı yoktu.
//
// Yeni kural: tamamlanmamış her iş emri iptal EDİLEBİLİR, ama fasondaki mal
// için karar AÇIKÇA verilir — iki seçenek, top top değil TOPLU:
//   RETURN_TO_STOCK → açık sevkler iptal, toplar ham stoğa
//   SCRAP           → açık sevkler iptal, toplar FİRE
//
// Bu bekçinin ölçtüğü üç şey:
//   1. Karar YOKKEN makine-okur kod döner (modal iki düğmeyi çizebilsin diye;
//      uzun bir açıklama metni saha kullanıcısına hiçbir şey anlatmıyordu).
//   2. Her iki karar da GERÇEKTEN uygulanır — top statüsü değişir.
//   3. İptal izi KOLONDA durur (audit 6 ayda arşivleniyor; sebep orada kalırsa
//      "neden iptal edildi" sorusu sessizce cevapsız kalır).
//   4. (2026-08-29 / BULGU-T1-009) Sevk KAPATILAMADIYSA iptal SERT ENGELE
//      DEĞİL AÇIK KARARA düşer. Bu bekçi eskiden yalnız mutlu yolu ölçüyordu: `cancelBulk`
//      PARÇALI başarır (`failed[]`) ve o dönüş atıldığında iptal, sevk açıkken
//      devam ediyor, boyahanedeki mal Ham Stok'ta görünüyordu. Tetikleyici
//      KISMİ KABUL: kısmi makbuz sevk kalemini KAPATMAZ ama `cancel()` "kabul
//      yapılmış" diye reddeder — yani en sık fason akışı tam bu dala düşüyor.
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { WorkOrderService } from "../src/services/workorder.service";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { ensureTestDyeHouse } from "./fixture-subcontractor";

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

async function errorOf(fn: () => Promise<unknown>): Promise<{ code?: string; message: string } | null> {
  try {
    await fn();
    return null;
  } catch (err) {
    const e = err as { message: string; details?: { code?: string } };
    return { code: e.details?.code, message: e.message };
  }
}

async function main(): Promise<void> {
  const ts = Date.now();
  const svc = new WorkOrderService();
  const woIds: string[] = [];
  const rollIds: string[] = [];
  let itemId = "";

  try {
    const item = await prisma.item.create({
      data: { code: `TEST-CANFAS-${ts}`, name: `TEST CANCEL FASON ${ts}`, itemType: "FABRIC", unit: "MT" },
      select: { id: true },
    });
    itemId = item.id;
    const station = await prisma.station.findFirst({
      where: { isActive: true, type: "EXTERNAL" },
      select: { id: true },
    });
    check("fason (EXTERNAL) istasyon bulundu", Boolean(station));
    if (!station) return;

    /** Fasonda topu olan bir iş emri kurar. */
    async function makeWo(tag: string) {
      const wo = await prisma.workOrder.create({
        data: {
          workOrderNumber: `TEST-CANFAS-${tag}-${ts}`,
          status: "IN_PROGRESS",
          type: "STOCK_PRODUCTION",
          targetItemId: item.id,
          steps: { create: [{ stationId: station!.id, stepSequence: 1, status: "ACTIVE" }] },
        },
        select: { id: true, steps: { select: { id: true } } },
      });
      woIds.push(wo.id);
      const roll = await prisma.roll.create({
        data: {
          itemId: item.id,
          initialQty: 100,
          currentQty: 100,
          status: "AT_SUBCONTRACTOR",
          currentStepId: wo.steps[0].id,
        },
        select: { id: true },
      });
      rollIds.push(roll.id);
      return { woId: wo.id, rollId: roll.id };
    }

    // ── 1) Karar YOKKEN: makine-okur kod ────────────────────────────────────
    const a = await makeWo("A");
    const err = await errorOf(() => svc.softDelete(a.woId, undefined, { reason: "müşteri vazgeçti" }));
    check("kararsız iptal reddedildi", err !== null);
    check(
      "hata MAKİNE-OKUR kod taşıyor (modal düğmeleri çizebilsin)",
      err?.code === "FASON_DECISION_REQUIRED",
      err?.code ?? err?.message ?? "",
    );

    // ── 2) RETURN_TO_STOCK ──────────────────────────────────────────────────
    await svc.softDelete(a.woId, undefined, {
      reason: "müşteri vazgeçti",
      fasonAction: "RETURN_TO_STOCK",
    });
    const woA = await prisma.workOrder.findUnique({
      where: { id: a.woId },
      select: { status: true, cancelReason: true, cancelledAt: true },
    });
    const rollA = await prisma.roll.findUnique({ where: { id: a.rollId }, select: { status: true } });
    check("iş emri iptal edildi", woA?.status === "CANCELLED", woA?.status ?? "");
    check("fasondaki top HAM STOĞA döndü", rollA?.status === "STOCK", rollA?.status ?? "");

    // ── 3) İptal izi KOLONDA ────────────────────────────────────────────────
    check("iptal sebebi kolonda", woA?.cancelReason === "müşteri vazgeçti", woA?.cancelReason ?? "—");
    check("iptal zamanı kolonda", Boolean(woA?.cancelledAt), woA?.cancelledAt?.toISOString() ?? "—");

    // ── 4) SCRAP ────────────────────────────────────────────────────────────
    const b = await makeWo("B");
    await svc.softDelete(b.woId, undefined, {
      reason: "mal bozuk geldi",
      fasonAction: "SCRAP",
    });
    const rollB = await prisma.roll.findUnique({ where: { id: b.rollId }, select: { status: true } });
    check("FİRE kararında top SCRAP oldu", rollB?.status === "SCRAP", rollB?.status ?? "");

    // ── 5) Fasonsuz iş emri hâlâ tek adımda iptal olur (regresyon) ──────────
    const plain = await prisma.workOrder.create({
      data: {
        workOrderNumber: `TEST-CANFAS-C-${ts}`,
        status: "IN_PROGRESS",
        type: "STOCK_PRODUCTION",
        targetItemId: item.id,
      },
      select: { id: true },
    });
    woIds.push(plain.id);
    await svc.softDelete(plain.id, undefined, { reason: "gereksiz açıldı" });
    const woC = await prisma.workOrder.findUnique({
      where: { id: plain.id },
      select: { status: true },
    });
    check("fasonsuz iptal karar SORMADAN çalışıyor", woC?.status === "CANCELLED", woC?.status ?? "");

    // ── 6) Tamamlanmış iş emri hâlâ iptal EDİLEMEZ (sınır korunuyor) ────────
    const done = await prisma.workOrder.create({
      data: {
        workOrderNumber: `TEST-CANFAS-D-${ts}`,
        status: "COMPLETED",
        type: "STOCK_PRODUCTION",
        targetItemId: item.id,
      },
      select: { id: true },
    });
    woIds.push(done.id);
    const doneErr = await errorOf(() =>
      svc.softDelete(done.id, undefined, { reason: "olmaz", fasonAction: "RETURN_TO_STOCK" }),
    );
    check("tamamlanmış iş emri iptal edilemiyor", doneErr !== null, doneErr?.message ?? "");

    // ── 7) KISMİ KABUL: sevk kapatılamıyorsa iptal DURUR (BULGU-T1-009) ─────
    // 100 m boyahaneye gitti, 51 m kabul edildi, 49 m fasonda kaldı. Kısmi
    // makbuz sevk kalemini KAPATMAZ → sevk hâlâ AÇIK+OUTSTANDING → iptal onu
    // `cancelBulk`a verir → `cancel()` "kabul yapılmış" diye reddeder → sonuç
    // `failed[]`e düşer. Doğru davranış: iptal reddedilir ve mal fasonda kalır.
    const admin = await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } });
    const boyaStation = await prisma.station.findFirst({ where: { code: "BOYA_FASON" }, select: { id: true } });
    const dyeHouse = await ensureTestDyeHouse();
    check("kısmi kabul fixture'ı hazır (admin + BOYA_FASON + fason firma)", Boolean(admin && boyaStation && dyeHouse));
    if (admin && boyaStation && dyeHouse) {
      const woP = await prisma.workOrder.create({
        data: {
          workOrderNumber: `TEST-CANFAS-E-${ts}`,
          status: "IN_PROGRESS",
          type: "STOCK_PRODUCTION",
          targetItemId: item.id,
          steps: { create: [{ stationId: boyaStation.id, stepSequence: 1, status: "PENDING" }] },
        },
        include: { steps: true },
      });
      woIds.push(woP.id);
      const stepP = woP.steps[0].id;
      await prisma.$transaction((tx) => new TravelerCardService().createForWorkOrder(tx, woP.id, admin.id));
      const rollP = await prisma.roll.create({
        data: {
          barcode: `TST-CANFAS-${ts}`,
          itemId: item.id,
          initialQty: 100,
          currentQty: 100,
          status: "STOCK",
          width: 250,
          createdById: admin.id,
        },
        select: { id: true },
      });
      rollIds.push(rollP.id);

      const sub = new SubcontractorService();
      await sub.dispatch(
        { workOrderId: woP.id, stepId: stepP, subcontractorId: dyeHouse.id, rollIds: [rollP.id] },
        admin.id,
      );
      await sub.receive(
        {
          workOrderId: woP.id,
          stepId: stepP,
          subcontractorId: dyeHouse.id,
          returns: [{ rollId: rollP.id, receivedQty: 51 }],
          newRolls: [{ qty: 51 }],
        },
        admin.id,
      );
      // Doğan toplar da temizlensin.
      const born = await prisma.roll.findMany({
        where: { parentReceipt: { workOrderId: woP.id } },
        select: { id: true },
      });
      rollIds.push(...born.map((b) => b.id));

      const beforeStatus = (await prisma.roll.findUnique({ where: { id: rollP.id }, select: { status: true } }))?.status;
      check("kurulum: kısmi kabul sonrası top fasonda kaldı", beforeStatus === "AT_SUBCONTRACTOR", beforeStatus ?? "");

      // ── KARAR GELMEDİ → SORU (sert engel DEĞİL) ──────────────────────────
      const partialErr = await errorOf(() =>
        svc.softDelete(woP.id, admin.id, { reason: "sipariş iptal oldu", fasonAction: "RETURN_TO_STOCK" }),
      );
      check("kalan fasondayken iptal DURDU (karar soruluyor)", partialErr !== null, partialErr?.message?.slice(0, 80) ?? "");
      check(
        "hata MAKİNE-OKUR kod taşıyor (FASON_REMAINDER_DECISION_REQUIRED)",
        partialErr?.code === "FASON_REMAINDER_DECISION_REQUIRED",
        partialErr?.code ?? "—",
      );
      check(
        "mesaj SOMUT: kaç top, kaç metre",
        Boolean(partialErr?.message.includes("fasonda") && /\d/.test(partialErr?.message ?? "")),
        partialErr?.message?.slice(0, 70) ?? "",
      );
      const rollAfter = await prisma.roll.findUnique({ where: { id: rollP.id }, select: { status: true } });
      check(
        "boyahanedeki mal HAM STOĞA DÜŞMEDİ (fasonda kaldı)",
        rollAfter?.status === "AT_SUBCONTRACTOR",
        rollAfter?.status ?? "",
      );
      const woAfter = await prisma.workOrder.findUnique({ where: { id: woP.id }, select: { status: true } });
      check("iş emri henüz iptal EDİLMEDİ", woAfter?.status === "IN_PROGRESS", woAfter?.status ?? "");

      // ── KARAR VERİLDİ → AKIŞ TAMAMLANIYOR (tek diyalog, tek onay) ────────
      // 2026-08-17 saha kuralı: "tamamlanmamış her iş emri iptal EDİLEBİLİR,
      // ama fasondaki mal için karar AÇIKÇA verilir." Sert engel o kuralı
      // bozardı; açık karar hem kuralı hem defteri korur.
      // ⚠️ SARMALI: bu çağrı patlarsa test ÇÖKER ve özet hiç basılmaz — negatif
      // sonda "kırmızı verdi" yerine "çıktı vermedi" olur, ki bu zayıf sinyaldir
      // (ölçüldü). Hata bir KONTROL olarak raporlanmalı.
      const kararErr = await errorOf(() =>
        svc.softDelete(woP.id, admin.id, {
          reason: "sipariş iptal oldu",
          fasonAction: "RETURN_TO_STOCK",
          fasonRemainderAction: "CLOSE_AS_SCRAP",
        }),
      );
      check(
        "karar verilince iptal HATASIZ tamamlandı",
        kararErr === null,
        kararErr?.message?.slice(0, 70) ?? "",
      );
      const woSon = await prisma.workOrder.findUnique({ where: { id: woP.id }, select: { status: true } });
      check("karar verilince iş emri İPTAL EDİLDİ (çıkmaz yok)", woSon?.status === "CANCELLED", woSon?.status ?? "");
      const kalem = await prisma.subcontractorDispatchItem.findFirst({
        where: { rollId: rollP.id },
        select: { remainderClosedAt: true },
      });
      check("fason kalemi KAPANDI (damga basıldı)", kalem?.remainderClosedAt != null);
      const sapma = await prisma.rollVariance.findFirst({
        where: { rollId: rollP.id, source: "SUBCONTRACTOR_REMAINDER" },
        select: { qty: true, kind: true },
      });
      check(
        "kalan metraj FİRE olarak deftere yazıldı (buharlaşmadı)",
        sapma != null && Number(sapma.qty) === 49,
        sapma ? `${sapma.kind} ${Number(sapma.qty)} m` : "defterde YOK!",
      );
      const rollSon = await prisma.roll.findUnique({ where: { id: rollP.id }, select: { status: true } });
      check(
        "mal HAM STOĞA DÜŞMEDİ (hayalet stok yok)",
        rollSon?.status !== "STOCK",
        rollSon?.status ?? "",
      );
    }

    // ── 8) İPTAL TX'İ DÜŞERSE FASON STATÜSÜ DE GERİ SARILIR (BULGU-T1-009) ──
    // Artık-kalan fason toplarının IN_PRODUCTION'a çevrilmesi eskiden havuz
    // client'ıyla, iptal tx'inin DIŞINDA koşuyordu: tx sonradan düşerse (burada
    // dispozisyon kapsam guard'ı) iş emri hâlâ açıkken toplar fason statüsünden
    // çıkmış oluyor ve geriye "işlemdeki top" gibi görünen bir kalıntı kalıyordu.
    // Sonraki iptal denemesi o topu artık fasonda görmediği için karar da
    // sormuyordu — yani kalıntı sessizce kalıcıydı.
    const c = await makeWo("F");
    const yabanci = await prisma.roll.create({
      data: { itemId: item.id, initialQty: 10, currentQty: 10, status: "STOCK" },
      select: { id: true },
    });
    rollIds.push(yabanci.id);
    const rollbackErr = await errorOf(() =>
      svc.softDelete(c.woId, undefined, {
        reason: "kapsam dışı top ile iptal",
        fasonAction: "RETURN_TO_STOCK",
        // İşlemde OLMAYAN bir top için karar → kapsam guard'ı tx İÇİNDE düşer.
        dispositions: [{ rollId: yabanci.id, action: "SCRAP" }],
      }),
    );
    check("kapsam dışı karar iptali düşürdü", rollbackErr !== null, rollbackErr?.message?.slice(0, 70) ?? "");
    const rollC = await prisma.roll.findUnique({ where: { id: c.rollId }, select: { status: true } });
    check(
      "tx geri sarıldı → top FASON statüsünde kaldı (kalıntı yok)",
      rollC?.status === "AT_SUBCONTRACTOR",
      rollC?.status ?? "",
    );
    const woF = await prisma.workOrder.findUnique({ where: { id: c.woId }, select: { status: true } });
    check("iş emri de iptal edilmedi", woF?.status === "IN_PROGRESS", woF?.status ?? "");
  } finally {
    // Fason zinciri ÖNCE (RESTRICT FK'lar: receipt/dispatch kalemleri topa bağlı).
    const recIds = (
      await prisma.subcontractorReceipt.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } })
    ).map((r) => r.id);
    const dispIds = (
      await prisma.subcontractorDispatch.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } })
    ).map((d) => d.id);
    await prisma.subcontractorReceiptItem.deleteMany({ where: { receiptId: { in: recIds } } }).catch(() => {});
    await prisma.subcontractorReceiptProperty.deleteMany({ where: { receiptId: { in: recIds } } }).catch(() => {});
    await prisma.subcontractorDispatchItem.deleteMany({ where: { dispatchId: { in: dispIds } } }).catch(() => {});
    await prisma.subcontractorReceipt.deleteMany({ where: { id: { in: recIds } } }).catch(() => {});
    await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: dispIds } } }).catch(() => {});
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
    await prisma.rollVariance.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } }).catch(() => {});
    await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: woIds } } }).catch(() => {});
    await prisma.batch.deleteMany({ where: { workOrderId: { in: woIds } } }).catch(() => {});
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } }).catch(() => {});
    await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } }).catch(() => {});
    if (itemId) await prisma.item.deleteMany({ where: { id: itemId } }).catch(() => {});
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Beklenmeyen hata:", err);
  process.exit(1);
});
