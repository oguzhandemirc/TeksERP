// =============================================================================
// TEST: TABLET İŞ EMRİ DÜZELTME — backend (hareket defteri D5a)
// Çalıştır: npx tsx scripts/test_wo_tablet_correction.ts
// =============================================================================
// Tasarım: docs/design/IS-EMRI-HAREKET-DEFTERI.md §6.1–§6.4 (S1 · S3 · S7 = A).
//   §1 renk önizlemesi YAZMAZ: plan ve defter değişmez; açık kart bayatlığı söylenir
//   §2 önizleme engeli 409 fırlatmaz, `blocked` döner (iptal edilmiş iş emri → WO_PLAN_FROZEN)
//   §3 hazır sebep kodu hareket satırına düşer (renk ve en); görünen metin satırda
//   §4 tanınmayan sebep kodu 400 REASON_CODE_INVALID, plan değişmez
//   §5 kodsuz metin katalog metnine eşitse kod TÜRETİLİR (panel serbest metni)
//   §6 yalnız tablet yetkisiyle iptal: üretimi başlamış iş emri 409 WO_CANCEL_PANEL_ONLY,
//      hiç işlem görmemiş iş emri iptal edilir
//   §7 izin kataloğu ve Hızlı İş Emri ekran yeteneği `mobile:is-emri-duzelt`i taşır
// NEGATİF SONDA (elle, 2026-09-25): `assertWorkOrderUntouched` erken `return` → §6 kırmızı;
// `planChangeReason` kodu düşürünce → §3/§5 kırmızı. Yedek kopyadan geri alındı.
// =============================================================================

import prisma from "../src/lib/prisma";
import { WorkOrderService } from "../src/services/workorder.service";
import { WorkOrderLinkService } from "../src/services/workorder-link.service";
import { PERMISSION_CATALOG } from "../src/constants/permission-catalog";
import { SCREEN_CATALOG } from "../src/constants/screen-catalog";
import { ensureTestAdmin } from "./fixture-test-user";

const svc = new WorkOrderService();
const link = new WorkOrderLinkService();

let pass = 0, fail = 0;
function check(label: string, cond: boolean, extra = ""): void {
  if (cond) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
}

let ITEM = "", ADMIN = "", ST_FASON = "", ST_TAMBUR = "", COLOR = "";
const woIds: string[] = [];

async function fikstur(): Promise<void> {
  const need = <T,>(v: T | null, label: string): T => {
    if (!v) throw new Error(`Seed fixture eksik: ${label} (önce 'npm run seed' + 'seed:fixtures')`);
    return v;
  };
  ITEM = need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "Item PATOS").id;
  ADMIN = (await ensureTestAdmin()).id;
  ST_FASON = need(await prisma.station.findFirst({ where: { code: "BOYA_FASON" }, select: { id: true } }), "BOYA_FASON").id;
  ST_TAMBUR = need(await prisma.station.findFirst({ where: { code: "TAMBUR_1" }, select: { id: true } }), "TAMBUR_1").id;
  COLOR = need(await prisma.color.findFirst({ where: { code: "MAVI" }, select: { id: true } }), "MAVI").id;
}

async function yeniWo(): Promise<string> {
  const res = await svc.create(
    { type: "STOCK_PRODUCTION", targetItemId: ITEM, width: 180, steps: [{ stationId: ST_FASON }, { stationId: ST_TAMBUR }] },
    ADMIN,
  );
  const id = (res.data as { id: string }).id;
  woIds.push(id);
  return id;
}

async function hata(fn: () => Promise<unknown>): Promise<string | null> {
  try { await fn(); return null; }
  catch (e) { return (e as { details?: { code?: string } }).details?.code ?? `HATA:${(e as Error).message}`; }
}

const olaySayisi = (id: string) => prisma.workOrderEvent.count({ where: { workOrderId: id } });

async function main(): Promise<void> {
  console.log("=== Tablet iş emri düzeltme — backend ===");
  await fikstur();
  try {
    const a = await yeniWo();
    const once = await olaySayisi(a);
    const p = (await link.previewTargetColorChange(a, COLOR)).data;
    const renk = (await prisma.workOrder.findUniqueOrThrow({ where: { id: a }, select: { targetColorId: true } })).targetColorId;
    check("§1 önizleme yazmaz (renk ve defter yerinde), engel yok, kart bayatlığı söylenir",
      renk === null && (await olaySayisi(a)) === once && p.blocked === null && p.cardWillBeStale === true,
      JSON.stringify(p));

    const iptal = await yeniWo();
    await svc.softDelete(iptal, ADMIN, { reason: "bekçi fikstürü" });
    const pb = (await link.previewTargetColorChange(iptal, COLOR)).data;
    check("§2 önizleme engeli fırlatmaz, blocked döner (WO_PLAN_FROZEN)", pb.blocked?.code === "WO_PLAN_FROZEN", JSON.stringify(pb.blocked));

    await link.changeTargetColor(a, COLOR, "Müşteri isteği değiştirdi", ADMIN, { reasonCode: "MUSTERI_DEGISTIRDI" });
    await link.changeWidth(a, 190, "İş emri yanlış değerle açılmıştı", ADMIN, { reasonCode: "YANLIS_GIRILMIS" });
    const satirlar = await prisma.workOrderEvent.findMany({ where: { workOrderId: a, type: "FIELD_CHANGED" } });
    const r = satirlar.find((e) => e.field === "targetColorId");
    const w = satirlar.find((e) => e.field === "width");
    check("§3 renk ve en satırında hazır sebep kodu ve görünen metin",
      r?.reasonCode === "MUSTERI_DEGISTIRDI" && r.reason === "Müşteri isteği değiştirdi"
        && w?.reasonCode === "YANLIS_GIRILMIS" && w.reason === "İş emri yanlış değerle açılmıştı",
      `${r?.reasonCode}/${w?.reasonCode}`);

    const gecersiz = await hata(() => link.changeWidth(a, 200, "uydurma kod", ADMIN, { reasonCode: "UYDURMA" }));
    const en = (await prisma.workOrder.findUniqueOrThrow({ where: { id: a }, select: { width: true } })).width;
    check("§4 tanınmayan kod 400 REASON_CODE_INVALID, en değişmedi", gecersiz === "REASON_CODE_INVALID" && Number(en) === 190, `${gecersiz} · ${en}`);

    await link.changeWidth(a, 195, "Mal ölçüldüğünde plandan farklı çıktı", ADMIN);
    const turetilen = (await prisma.workOrderEvent.findMany({ where: { workOrderId: a, field: "width" }, orderBy: { createdAt: "desc" }, take: 1 }))[0];
    check("§5 kodsuz metin katalog metnine eşit → kod türetilir", turetilen?.reasonCode === "OLCUMDE_FARKLI", String(turetilen?.reasonCode));

    const b = await yeniWo();
    await svc.lockWorkOrder(b, ADMIN);
    const tabletBasladi = await hata(() => svc.softDelete(b, ADMIN, { untouchedOnly: true }));
    const bDurum = (await prisma.workOrder.findUniqueOrThrow({ where: { id: b }, select: { status: true } })).status;
    const c = await yeniWo();
    const tabletYeni = await hata(() => svc.softDelete(c, ADMIN, { untouchedOnly: true }));
    const cDurum = (await prisma.workOrder.findUniqueOrThrow({ where: { id: c }, select: { status: true } })).status;
    check("§6 tablet iptali: başlamış iş emri 409 WO_CANCEL_PANEL_ONLY (yerinde), hiç işlem görmemiş iptal edilir",
      tabletBasladi === "WO_CANCEL_PANEL_ONLY" && bDurum === "IN_PROGRESS" && tabletYeni === null && cDurum === "CANCELLED",
      `${tabletBasladi}/${bDurum} · ${tabletYeni}/${cDurum}`);

    const kod = PERMISSION_CATALOG.find((x) => x.code === "mobile:is-emri-duzelt");
    const ekran = SCREEN_CATALOG.find((x) => x.key === "HizliIsEmri");
    check("§7 izin kataloğu + Hızlı İş Emri yeteneği mobile:is-emri-duzelt",
      kod?.module === "MOBILE" && !!ekran?.capabilities.some((cap) => cap.code === "mobile:is-emri-duzelt"));
  } finally {
    await temizle();
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

async function temizle(): Promise<void> {
  const cards = await prisma.travelerCard.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } });
  const cardIds = cards.map((x) => x.id);
  const stepIds = (await prisma.workOrderStep.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } })).map((x) => x.id);
  await prisma.travelerCardScan.deleteMany({ where: { cardId: { in: cardIds } } });
  await prisma.travelerCard.deleteMany({ where: { id: { in: cardIds } } });
  await prisma.systemLog.deleteMany({ where: { recordId: { in: [...woIds, ...stepIds] } } });
  await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } });
  await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
}

main().catch(async (e) => {
  console.error("HATA:", e);
  await temizle().catch((err) => console.error("temizlik hatası:", err));
  await prisma.$disconnect();
  process.exit(1);
});
