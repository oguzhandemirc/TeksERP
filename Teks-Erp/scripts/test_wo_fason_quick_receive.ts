// =============================================================================
// BEKÇİ — Kapatmayı engelleyen fason yükü TEK adımda kabul edilir (2026-08-17)
// Çalıştır: npx tsx scripts/test_wo_fason_quick_receive.ts
// =============================================================================
// Saha şikâyeti: iş emri manuel kapatılamıyor çünkü "toplar fasonda". Eski
// cevap doğru ama işe yaramazdı ("önce fason kabul yapın") — operatör başka bir
// ekrana gidiyor ve orada kayboluyordu. Yeni yol: kapatma ekranından iki
// seçenekle tek gönderim.
//
// Ölçülen üç şey:
//   1. MERGE ("dikilerek geldi") → 10 top = 1 top, metrajlar TOPLANIR.
//   2. ONE_TO_ONE → giden top sayısı kadar top doğar.
//   3. Kabul sonrası kaynak toplar fasondan ÇIKAR (kapatma engeli kalkar).
//
// ⚠️ Motor yeniden yazılmadı: kabul mevcut `SubcontractorService.receive` ile
// yapılır. Bu test o devrin gerçekten koştuğunu ve parça sayısının moddan
// doğru türediğini doğrular.
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { workOrderFasonQuickService } from "../src/services/workorder-fason-quick.service";
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

async function main(): Promise<void> {
  const ts = Date.now();
  const subSvc = new SubcontractorService();
  const woIds: string[] = [];
  const rollIds: string[] = [];
  let itemId = "";
  let colorId = "";

  try {
    const firm = await ensureTestDyeHouse();
    const item = await prisma.item.create({
      // ⚠️ AD DA BENZERSİZ: `test_consistency` §18 aktif master-data'da mükerrer
      // ad arar. Sabit ad kullanılsaydı testin her koşumu bir mükerrer daha
      // bırakır ve BAŞKA bir bekçiyi kırmızıya düşürürdü (bu gerçekten oldu).
      data: { code: `TEST-FQR-${ts}`, name: `TEST FASON QUICK ${ts}`, itemType: "FABRIC", unit: "MT" },
      select: { id: true },
    });
    itemId = item.id;
    // Hedef renkli iş emri = tipik fabrika akışı. Renksiz (ekru) hâli ayrıca
    // aşağıda 5. bölümde sınanır — orada kabul RENK İSTER.
    const color = await prisma.color.create({
      data: { code: `TEST-FQR-C-${ts}`, name: `TEST FQR MAVI ${ts}` },
      select: { id: true },
    });
    colorId = color.id;
    const station = await prisma.station.findFirst({
      where: { isActive: true, type: "EXTERNAL" },
      select: { id: true },
    });
    check("fason istasyonu bulundu", Boolean(station));
    if (!station) return;

    /** Fasona 3 topu sevk edilmiş bir iş emri kurar. */
    async function makeDispatchedWo(tag: string, qtys: number[], withColor = true) {
      const wo = await prisma.workOrder.create({
        data: {
          workOrderNumber: `TEST-FQR-${tag}-${ts}`,
          status: "IN_PROGRESS",
          type: "STOCK_PRODUCTION",
          targetItemId: item.id,
          targetColorId: withColor ? colorId : null,
          steps: {
            create: [
              {
                stationId: station!.id,
                stepSequence: 1,
                status: "ACTIVE",
                requiredCategoryId: firm.categoryId,
                plannedSubcontractorId: firm.id,
              },
            ],
          },
        },
        select: { id: true, steps: { select: { id: true } } },
      });
      woIds.push(wo.id);
      const stepId = wo.steps[0].id;
      const made: string[] = [];
      for (const q of qtys) {
        const r = await prisma.roll.create({
          data: {
            itemId: item.id,
            initialQty: q,
            currentQty: q,
            status: "IN_PRODUCTION",
            currentStepId: stepId,
          },
          select: { id: true },
        });
        rollIds.push(r.id);
        made.push(r.id);
      }
      await subSvc.dispatch({
        workOrderId: wo.id,
        stepId,
        subcontractorId: firm.id,
        rollIds: made,
      });
      return { woId: wo.id, stepId, rollIds: made };
    }

    // ── 1) MERGE — dikilerek geldi ──────────────────────────────────────────
    const a = await makeDispatchedWo("MERGE", [100, 200, 300]);
    const prevA = await workOrderFasonQuickService.preview(a.woId);
    check("önizleme açık sevki buldu", prevA.data.groups.length === 1, `${prevA.data.groups.length} grup`);
    check(
      "grup toplam metrajı doğru",
      prevA.data.groups[0]?.totalQty === 600,
      String(prevA.data.groups[0]?.totalQty),
    );

    const resA = await workOrderFasonQuickService.apply(a.woId, { mode: "MERGE" });
    check("MERGE tek top üretti", resA.data.newRolls === 1, `${resA.data.newRolls} top`);

    const bornA = await prisma.roll.findMany({
      where: { entrySource: "SUBCONTRACTOR_RETURN", item: { id: itemId } },
      select: { id: true, initialQty: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 1,
    });
    bornA.forEach((r) => rollIds.push(r.id));
    check(
      "doğan topun metrajı TOPLAM (100+200+300)",
      Number(bornA[0]?.initialQty) === 600,
      String(bornA[0]?.initialQty),
    );

    const leftA = await prisma.roll.count({
      where: { id: { in: a.rollIds }, status: "AT_SUBCONTRACTOR" },
    });
    check("kaynak toplar fasondan çıktı", leftA === 0, `${leftA} top hâlâ fasonda`);

    // ── 2) ONE_TO_ONE — birebir ─────────────────────────────────────────────
    const b = await makeDispatchedWo("ONE", [50, 70]);
    const resB = await workOrderFasonQuickService.apply(b.woId, { mode: "ONE_TO_ONE" });
    check("ONE_TO_ONE giden kadar top üretti", resB.data.newRolls === 2, `${resB.data.newRolls} top`);

    const bornB = await prisma.roll.findMany({
      where: { entrySource: "SUBCONTRACTOR_RETURN", item: { id: itemId } },
      select: { id: true, initialQty: true },
      orderBy: { createdAt: "desc" },
      take: 2,
    });
    bornB.forEach((r) => rollIds.push(r.id));
    const qtys = bornB.map((r) => Number(r.initialQty)).sort((x, y) => x - y);
    check("metrajlar birebir taşındı", qtys.join(",") === "50,70", qtys.join(","));

    // ── 3) Parça metrajı DÜZENLENEBİLİR ─────────────────────────────────────
    const c = await makeDispatchedWo("EDIT", [80, 80]);
    const prevC = await workOrderFasonQuickService.preview(c.woId);
    const resC = await workOrderFasonQuickService.apply(c.woId, {
      mode: "MERGE",
      overrides: [{ dispatchId: prevC.data.groups[0].dispatchId, pieces: [90, 60] }],
    });
    check("düzenlenmiş parça sayısı uygulandı", resC.data.newRolls === 2, `${resC.data.newRolls}`);
    const bornC = await prisma.roll.findMany({
      where: { entrySource: "SUBCONTRACTOR_RETURN", item: { id: itemId } },
      select: { id: true, initialQty: true },
      orderBy: { createdAt: "desc" },
      take: 2,
    });
    bornC.forEach((r) => rollIds.push(r.id));
    const qtysC = bornC.map((r) => Number(r.initialQty)).sort((x, y) => x - y);
    check("düzenlenmiş metrajlar yazıldı", qtysC.join(",") === "60,90", qtysC.join(","));

    // ── 4) Açık sevk yoksa net hata ─────────────────────────────────────────
    let emptyErr = "";
    try {
      await workOrderFasonQuickService.apply(a.woId, { mode: "MERGE" });
    } catch (e) {
      emptyErr = (e as Error).message;
    }
    check("kabul edilecek sevk yoksa net hata", emptyErr.includes("açık fason sevki yok"), emptyErr);

    // ── 5) RENKSİZ iş emri: kabul RENK İSTER, önizleme bunu SÖYLER ──────────
    // "Ekru" vakası: iş emri bilinçli renksiz gidiyor. Önizleme `colorRequired`
    // demezse arayüz renk alanı çizmez ve kabul çıkışsız bir 400'e düşer.
    const d = await makeDispatchedWo("NOCOLOR", [40], false);
    const prevD = await workOrderFasonQuickService.preview(d.woId);
    check(
      "renksiz iş emrinde önizleme RENK İSTİYOR diyor",
      prevD.data.groups[0]?.colorRequired === true,
      String(prevD.data.groups[0]?.colorRequired),
    );
    let colorErr = "";
    try {
      await workOrderFasonQuickService.apply(d.woId, { mode: "MERGE" });
    } catch (e) {
      colorErr = (e as Error).message;
    }
    check("renksiz + renk gönderilmeden kabul reddedildi", colorErr.includes("rengi"), colorErr);

    const resD = await workOrderFasonQuickService.apply(d.woId, {
      mode: "MERGE",
      appliedColorId: colorId,
    });
    check("renk gönderilince kabul geçti", resD.data.receipts === 1, String(resD.data.receipts));
  } finally {
    // ⚠️ Doğan topları ID ile takip etmek YETMEZ: kabul motoru her makbuzda yeni
    // top yaratıyor ve test yarıda düşerse o id'ler listeye hiç girmiyor. Kalıntı
    // `test_consistency` §15/§16/§18'i kırmızıya düşürüyordu (ölçüldü). Bu yüzden
    // temizlik KUMAŞ üzerinden de tarar — bu testin ürettiği her şey o kumaşa bağlı.
    const bornRolls = itemId
      ? (await prisma.roll.findMany({ where: { itemId }, select: { id: true } })).map((r) => r.id)
      : [];
    const allRolls = [...new Set([...rollIds, ...bornRolls])];
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: allRolls } } }).catch(() => {});
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: allRolls } } }).catch(() => {});
    await prisma.rollVariance.deleteMany({ where: { rollId: { in: allRolls } } }).catch(() => {});
    await prisma.subcontractorReceiptItem.deleteMany({ where: { receipt: { workOrderId: { in: woIds } } } }).catch(() => {});
    await prisma.subcontractorReceipt.deleteMany({ where: { workOrderId: { in: woIds } } }).catch(() => {});
    await prisma.subcontractorDispatchItem.deleteMany({ where: { dispatch: { workOrderId: { in: woIds } } } }).catch(() => {});
    await prisma.subcontractorDispatch.deleteMany({ where: { workOrderId: { in: woIds } } }).catch(() => {});
    await prisma.roll.deleteMany({ where: { id: { in: allRolls } } }).catch(() => {});
    await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: woIds } } }).catch(() => {});
    await prisma.batch.deleteMany({ where: { workOrderId: { in: woIds } } }).catch(() => {});
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } }).catch(() => {});
    await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } }).catch(() => {});
    if (itemId) await prisma.item.deleteMany({ where: { id: itemId } }).catch(() => {});
    if (colorId) await prisma.color.deleteMany({ where: { id: colorId } }).catch(() => {});
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
