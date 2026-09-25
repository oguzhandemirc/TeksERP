// =============================================================================
// TEST: İŞ EMRİ HAREKETLERİ (D4) — defter + kaynak defterler tek çizelgede
// Çalıştır: npx tsx scripts/test_workorder_timeline.ts
// =============================================================================
// Tasarım: docs/design/IS-EMRI-HAREKET-DEFTERI.md §3, §7.
//   §1 SAF sayfalama: yeni→eski, eşit anlarda kararlı; imleç zinciri her satırı
//      bir kez verir; grup sayıları süzgeçten bağımsız; bozuk imleç 400
//   §2 GERÇEK yol (create → kilit → attachRolls → elle kapanış): çizelgede doğuş,
//      iki statü geçişi, parti doğuşu (kaynak: Batch) ve kapanış künyesi (kaynak:
//      künye) var; tetik ve kanal Türkçe; aktör adı çözüldü
//   §3 grup süzgeci yalnız o grubu döndürür, sayılar değişmez
//   §5 iş emri iptalinin dönüşleri TEK satır ("İş emri iptali — N top kaynağına döndü" + `rolls`);
//      Top Çıkar satırı ayrı kalır
//   §4 arama: iş emri no (büyük/küçük harf fark etmez) → o iş emri; top barkodu →
//      topun geçtiği iş emri; 2 karakterden kısa sorgu reddedilir
// NEGATİF SONDA (elle, 2026-09-25): servisteki künye kaynağı (`workOrderCloseSnapshot`
// okuması) yoruma alındı → §2c kırmızı; md5 ile geri alındı.
// =============================================================================

import prisma from "../src/lib/prisma";
import { WorkOrderService } from "../src/services/workorder.service";
import { WorkOrderTimelineService, pageTimeline, type TimelineItem } from "../src/services/workorder-timeline.service";
import { workOrderRollDetachService } from "../src/services/workorder-roll-detach.service";
import { roleGrade } from "./fixture-quality-grade";
import { ensureTestAdmin } from "./fixture-test-user";
import { RollStatus } from "@prisma/client";

const svc = new WorkOrderService();
const timeline = new WorkOrderTimelineService();

let pass = 0, fail = 0;
function check(label: string, cond: boolean, extra = ""): void {
  if (cond) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
}

const woIds: string[] = [];
const rollIds: string[] = [];

function sentetik(): TimelineItem[] {
  const i = (id: string, at: string, group: TimelineItem["group"]): TimelineItem => ({
    id, at, group, title: id, detail: null, reason: null, actor: null, channel: null, trigger: null, derived: false,
  });
  return [
    i("a", "2026-09-25T10:00:00.000Z", "DURUM"),
    i("b", "2026-09-25T11:00:00.000Z", "FASON"),
    i("c", "2026-09-25T11:00:00.000Z", "DURUM"),
    i("d", "2026-09-25T12:00:00.000Z", "KAPANIS"),
    i("e", "2026-09-25T09:00:00.000Z", "PARTI"),
  ];
}

async function main(): Promise<void> {
  console.log("=== İş emri hareketleri (zaman çizelgesi) ===");

  // §1 saf sayfalama
  const hepsi = pageTimeline(sentetik(), { limit: 10 });
  check("§1 yeni→eski, eşit anda kimlik sırası kararlı", hepsi.data.map((x) => x.id).join("") === "dcbae");
  const toplanan: string[] = [];
  let cursor: string | undefined;
  for (let n = 0; n < 5; n++) {
    const p = pageTimeline(sentetik(), { limit: 2, cursor });
    toplanan.push(...p.data.map((x) => x.id));
    if (!p.hasMore) break;
    cursor = p.nextCursor!;
  }
  check("§1b imleç zinciri her satırı BİR kez verir (boşluk/tekrar yok)", toplanan.join("") === "dcbae", toplanan.join(""));
  const durum = pageTimeline(sentetik(), { limit: 10, groups: ["DURUM"] });
  check("§1c süzgeç yalnız grubu verir, sayılar süzgeçten bağımsız",
    durum.data.every((x) => x.group === "DURUM") && durum.data.length === 2
      && durum.groups.find((g) => g.key === "FASON")?.count === 1);
  let bozuk = false;
  try { pageTimeline(sentetik(), { limit: 2, cursor: Buffer.from("bozuk").toString("base64url") }); } catch { bozuk = true; }
  check("§1d bozuk imleç reddedilir", bozuk);

  // §2 gerçek yol
  const admin = await ensureTestAdmin();
  const item = await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } });
  const kursun = await prisma.station.findFirst({ where: { code: "KURSUN_KK2" }, select: { id: true } });
  const tambur = await prisma.station.findFirst({ where: { code: "TAMBUR_1" }, select: { id: true } });
  if (!item || !kursun || !tambur) throw new Error("Seed fixture eksik (npm run seed + seed:fixtures)");
  const grade = await roleGrade("FIRST");
  try {
    const res = await svc.create(
      { type: "STOCK_PRODUCTION", targetItemId: item.id, width: 180, steps: [{ stationId: kursun.id }, { stationId: tambur.id }] },
      admin.id,
    );
    const woId = (res.data as { id: string }).id;
    woIds.push(woId);
    await svc.lockWorkOrder(woId, admin.id);
    const barcode = `TST-WOT-${Date.now().toString(36).toUpperCase()}`;
    const r = await prisma.roll.create({
      data: { barcode, itemId: item.id, initialQty: 150, currentQty: 150, status: RollStatus.STOCK,
        qualityGrade: grade.code, qualityGradeId: grade.id, width: 180, createdById: admin.id },
      select: { id: true },
    });
    rollIds.push(r.id);
    await svc.attachRolls(woId, [barcode], admin.id);
    await svc.completeWorkOrder(woId, { reason: "TST-WOT", dispositions: [{ rollId: r.id, action: "WAREHOUSE" }] }, admin.id);

    const sayfa = await timeline.list(woId, { limit: 50 });
    const basliklar = sayfa.data.map((x) => `${x.group}:${x.title}:${x.detail ?? ""}`);
    check("§2 doğuş satırı (DURUM · İş emri açıldı)", basliklar.some((b) => b.startsWith("DURUM:İş emri açıldı:")));
    check("§2b iki statü geçişi (Planlandı → Devam Ediyor, Devam Ediyor → Tamamlandı)",
      basliklar.some((b) => b.endsWith("Planlandı → Devam Ediyor")) && basliklar.some((b) => b.endsWith("Devam Ediyor → Tamamlandı")));
    check("§2c parti doğuşu (Batch) ve kapanış künyesi kaynaklarından",
      sayfa.data.some((x) => x.group === "PARTI" && x.id.startsWith("batch:"))
        && sayfa.data.some((x) => x.group === "KAPANIS" && x.id.startsWith("snap:")));
    const kunye = sayfa.data.find((x) => x.id.startsWith("snap:"));
    check("§2c2 künye ayrıntısı Türkçe (\"N top · M m\" + verim), kod adı sızmaz",
      /^\d+ top · .+ m/.test(kunye?.detail ?? "") && !/yield/i.test(kunye?.detail ?? ""), kunye?.detail ?? "-");
    const kapanis = sayfa.data.find((x) => x.detail === "Devam Ediyor → Tamamlandı");
    check("§2d tetik ve kanal Türkçe, sebep satırda, aktör adı çözüldü",
      kapanis?.trigger === "Elle kapatma" && kapanis?.channel === "Sistem" && kapanis?.reason === "TST-WOT" && !!kapanis?.actor,
      `${kapanis?.trigger} · ${kapanis?.channel} · ${kapanis?.actor}`);
    check("§2e sıralama yeni→eski", sayfa.data.every((x, i, a) => i === 0 || a[i - 1]!.at >= x.at));

    // §3 süzgeç
    const yalniz = await timeline.list(woId, { limit: 50, groups: ["KAPANIS"] });
    check("§3 grup süzgeci yalnız KAPANIS, sayılar değişmez",
      yalniz.data.length === 1 && yalniz.groups.find((g) => g.key === "DURUM")?.count === sayfa.groups.find((g) => g.key === "DURUM")?.count);

    // §4 arama
    const no = (await prisma.workOrder.findUniqueOrThrow({ where: { id: woId }, select: { workOrderNumber: true } })).workOrderNumber;
    const noIle = await timeline.lookup(` ${no.toLowerCase()} `);
    check("§4 iş emri no ile bulunur (boşluk ve küçük harf tolere)", noIle.length === 1 && noIle[0]!.id === woId && noIle[0]!.via === "WORK_ORDER_NUMBER");
    const barkodla = await timeline.lookup(barcode);
    check("§4b top barkoduyla topun geçtiği iş emri bulunur", barkodla.some((h) => h.id === woId && h.via === "ROLL_BARCODE"));
    let kisa = false;
    try { await timeline.lookup("I"); } catch { kisa = true; }
    check("§4c 2 karakterden kısa sorgu reddedilir", kisa);
    check("§4d bulunamayan sorgu boş liste (hata değil)", (await timeline.lookup("TST-YOK-XYZ")).length === 0);

    // §5 iptal dönüşü belge düzeyinde tek satır (S6); Top Çıkar tekil kalır
    const depo = await prisma.warehouse.findFirst({ where: { isDefault: true }, select: { id: true } });
    if (!depo) throw new Error("Fikstür eksik: varsayılan depo");
    const res2 = await svc.create(
      { type: "STOCK_PRODUCTION", targetItemId: item.id, width: 180, steps: [{ stationId: kursun.id }, { stationId: tambur.id }] },
      admin.id,
    );
    const wo2 = (res2.data as { id: string }).id;
    woIds.push(wo2);
    await svc.lockWorkOrder(wo2, admin.id);
    const damga = Date.now().toString(36).toUpperCase();
    const toplar = [];
    for (const i of [0, 1, 2]) {
      const t = await prisma.roll.create({
        data: { barcode: `TST-WOT-C${i}-${damga}`, itemId: item.id, initialQty: 100, currentQty: 100, status: RollStatus.STOCK,
          warehouseId: depo.id, qualityGrade: grade.code, qualityGradeId: grade.id, width: 180, createdById: admin.id },
        select: { id: true, barcode: true },
      });
      rollIds.push(t.id);
      toplar.push(t);
    }
    await svc.attachRolls(wo2, toplar.map((t) => t.barcode!), admin.id);
    await workOrderRollDetachService.detachRoll(wo2, toplar[0]!.id, "bekçi: yanlış okutma", admin.id);
    await svc.softDelete(wo2, admin.id);
    const sayfa2 = await timeline.list(wo2, { limit: 50 });
    const donus = sayfa2.data.filter((x) => x.id.startsWith("cancel-return:"));
    const cikan = sayfa2.data.filter((x) => x.title === "Top çıkarıldı");
    check("§5 iptal dönüşü TEK satır, sayı ve toplam doğru",
      donus.length === 1 && donus[0]!.title === "İş emri iptali — 2 top kaynağına döndü" && donus[0]!.detail === "200 m",
      donus.map((x) => `${x.title} · ${x.detail}`).join(" | ") || "satır yok");
    check("§5b satır topları taşıyor (barkod · metre · döndüğü durum)",
      donus[0]?.rolls?.length === 2 && donus[0].rolls.every((r) => r.qty === 100 && r.to === "STOCK") &&
        [toplar[1]!.barcode, toplar[2]!.barcode].every((b) => donus[0]!.rolls!.some((r) => r.barcode === b)),
      JSON.stringify(donus[0]?.rolls ?? null));
    check("§5c Top Çıkar satırı ayrı ve tekil — iptalle dönen toplar tek tek yazılmaz",
      cikan.length === 1 && (cikan[0]!.detail ?? "").startsWith(toplar[0]!.barcode!), cikan.map((x) => x.detail).join(" | "));
  } finally {
    await temizle();
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

async function temizle(): Promise<void> {
  const steps = await prisma.workOrderStep.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } });
  const stepIds = steps.map((s) => s.id);
  const rolls = await prisma.roll.findMany({
    where: { OR: [{ id: { in: rollIds } }, { producedInStepId: { in: stepIds } }, { currentStepId: { in: stepIds } }] },
    select: { id: true },
  });
  const ids = rolls.map((x) => x.id);
  await prisma.systemLog.deleteMany({ where: { tableName: { in: ["ROLL", "WORK_ORDER"] }, recordId: { in: [...ids, ...woIds] } } });
  await prisma.rollOperation.deleteMany({ where: { OR: [{ rollId: { in: ids } }, { workOrderStepId: { in: stepIds } }] } });
  await prisma.rollMovement.deleteMany({ where: { OR: [{ rollId: { in: ids } }, { workOrderStepId: { in: stepIds } }] } });
  await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: ids } } });
  await prisma.roll.deleteMany({ where: { id: { in: ids } } });
  const cards = await prisma.travelerCard.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } });
  await prisma.travelerCardScan.deleteMany({ where: { cardId: { in: cards.map((c) => c.id) } } });
  await prisma.travelerCard.deleteMany({ where: { id: { in: cards.map((c) => c.id) } } });
  await prisma.batch.updateMany({ where: { workOrderId: { in: woIds } }, data: { splitFromId: null } });
  await prisma.batch.deleteMany({ where: { workOrderId: { in: woIds } } });
  await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } });
  await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
}

main().catch(async (e) => {
  console.error("HATA:", e);
  await temizle().catch((err) => console.error("temizlik hatası:", err));
  await prisma.$disconnect();
  process.exit(1);
});
