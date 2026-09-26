// =============================================================================
// TEST: KARTELA HAREKETLERİ — okuma yüzeyi (K3)
// Çalıştır: npx tsx scripts/test_swatch_event_timeline.ts
// =============================================================================
// Tasarım: docs/design/KARTELA-HAREKET-DEFTERI.md §5.3. Fikstür tek yazardan kurulur:
//   §1 arama TAM eşleşme: kart no · çuval no · sevkiyat no · kabul no
//   §2 ⭐ TEK SÜZGEÇ: her süzgeçte grup sayaçlarının toplamı = sayfalanan satır sayısı ve
//      her grubun sayacı = o grupla süzülen satır sayısı (sayaç ayrı koşul taşırsa kırmızı)
//   §3 imleç: küçük sayfalarla bütün satırlar TAM BİR KEZ, (createdAt, id) azalan; aynı tx
//      anını paylaşan satırlar imleçte kaybolmaz
//   §4 fail-closed: bozuk imleç / kimlik 400, tanınmayan grup 400 (denetleyici)
//   §5 Türkçe satır: başlık, durum geçişi, donuk belge numaraları, aktör, kanal, tetik
//   §6 tarih süzgeci fabrika günüyle
//   §7 istatistik: `count` yalnız stok (getStock ile aynı), `byStatus` kırılımı
// =============================================================================

import { randomUUID } from "crypto";
import type { NextFunction, Request, Response } from "express";
import { SwatchEventType } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { createSwatchesTx, transitionSwatchesTx } from "../src/services/helpers/swatch-event.helper";
import { kartelaTimelineService, type KartelaEventFilter } from "../src/services/kartela-timeline.service";
import { KartelaController } from "../src/controllers/kartela.controller";
import { TamburService } from "../src/services/tambur.service";
import { kartelaService } from "../src/services/kartela.service";
import { SWATCH_EVENT_GROUPS, type SwatchEventGroup } from "../src/constants/swatch-event-labels";
import { factoryYmd } from "../src/constants/time";
import { ensureTestAdmin } from "./fixture-test-user";
import { ensureTestKartela } from "./fixture-subcontractor";

let pass = 0, fail = 0;
function check(label: string, cond: boolean, extra = ""): void {
  if (cond) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
}

const TS = Date.now().toString().slice(-7);
let ITEM = "", CUSTOMER = "", RECEIPT = "", SACK = "", SHIPMENT = "";
const ids: string[] = [];

/** Süzgeçteki bütün satırlar, küçük sayfalarla (imleç yolu da ölçülür). */
async function hepsi(f: KartelaEventFilter, groups?: SwatchEventGroup[]) {
  const out: Array<{ id: string; at: string; group: SwatchEventGroup }> = [];
  let cursor: string | undefined;
  for (let i = 0; i < 200; i++) {
    const p = await kartelaTimelineService.list(f, { groups, cursor, limit: 2 });
    out.push(...p.data);
    if (!p.hasMore) return out;
    cursor = p.nextCursor!;
  }
  throw new Error("sayfalama bitmedi");
}

async function denetleyici(query: Record<string, string>): Promise<number> {
  const c = new KartelaController();
  let status = 200;
  const res = { status: (s: number) => { status = s; return res; }, json: () => res } as unknown as Response;
  let hata: unknown;
  await c.listEvents({ query } as unknown as Request, res, ((e: unknown) => { hata = e; }) as NextFunction);
  return hata ? ((hata as { statusCode?: number }).statusCode ?? 500) : status;
}

async function main(): Promise<void> {
  console.log("=== Kartela Hareketleri — okuma yüzeyi ===");
  try {
    const admin = await ensureTestAdmin();
    const firm = await ensureTestKartela();
    ITEM = (await prisma.item.create({ data: { code: `TEST-KTL-${TS}`, name: `Kartela Çizelge ${TS}`, itemType: "FABRIC" } })).id;
    CUSTOMER = (await prisma.customer.create({ data: { code: `TEST-KTL-${TS}`, name: `Kartela Çizelge Müşteri ${TS}` } })).id;
    const receipt = await prisma.kartelaReceipt.create({ data: { receiptNo: `TST-KTL-KR-${TS}`, subcontractorId: firm.id } });
    RECEIPT = receipt.id;
    const sack = await prisma.sack.create({ data: { sackNo: `TST-KTL-CV-${TS}` } });
    SACK = sack.id;
    const shipment = await prisma.shipment.create({ data: { shipmentNo: `TST-KTL-SV-${TS}`, customerId: CUSTOMER } });
    SHIPMENT = shipment.id;
    const ctx = (trigger: string) => ({ trigger, userId: admin.id });
    await prisma.$transaction(async (tx) => {
      const sw = await createSwatchesTx(tx, [0, 1, 2, 3].map((i) => ({
        cardNumber: `TST-KTL-${TS}-${i}`, barcode: `TST-KTLB-${TS}-${i}`, itemId: ITEM, parentReceiptId: RECEIPT,
      })), ctx("KARTELA_RECEIVE"));
      ids.push(...sw.map((s) => s.id));
      await transitionSwatchesTx(tx, SwatchEventType.SACKED, { scope: { ids: [ids[0], ids[1]] }, sack: { id: SACK }, ctx: ctx("SACK_SCAN") });
      await tx.sack.update({ where: { id: SACK }, data: { shipmentId: SHIPMENT } });
      await transitionSwatchesTx(tx, SwatchEventType.SHIPMENT_ADDED, { scope: { sackIds: [SACK] }, shipment: { id: SHIPMENT }, ctx: ctx("SHIPMENT_CREATE") });
      await transitionSwatchesTx(tx, SwatchEventType.REDUCED, { scope: { ids: [ids[2]] }, reductionId: randomUUID(), ctx: { ...ctx("KARTELA_STOCK_REDUCE"), reason: "numune" } });
    });
    const [a] = ids;

    // §1 arama
    const kart = await hepsi({ search: `TST-KTL-${TS}-0` });
    const cuval = await hepsi({ search: sack.sackNo });
    const sevk = await hepsi({ search: shipment.shipmentNo });
    const kabul = await hepsi({ search: receipt.receiptNo });
    check("§1 kart no → yalnız o kartelanın 3 satırı (doğuş · çuval · sevkiyat)", kart.length === 3);
    check("§1b çuval no → iki çuval + iki sevkiyat satırı (satırda donuk çuval no)", cuval.length === 4, `${cuval.length}`);
    check("§1c sevkiyat no → iki sevkiyat satırı", sevk.length === 2, `${sevk.length}`);
    check("§1d kabul no → o kabulde doğan kartelaların bütün satırları", kabul.length === 9, `${kabul.length}`);

    // §2 TEK SÜZGEÇ — sayaçlar ile liste aynı koşuldan
    const bozuk: string[] = [];
    for (const f of [{ search: receipt.receiptNo }, { search: sack.sackNo }, { swatchId: a }, { search: `TST-KTL-${TS}-2` }] as KartelaEventFilter[]) {
      const ilk = await kartelaTimelineService.list(f, { limit: 1 });
      const tum = await hepsi(f);
      const toplam = ilk.groups.reduce((s, g) => s + g.count, 0);
      if (toplam !== tum.length) bozuk.push(`${JSON.stringify(f)}: sayaç ${toplam} ≠ liste ${tum.length}`);
      for (const g of ilk.groups) {
        const grupta = await hepsi(f, [g.key]);
        if (grupta.length !== g.count || grupta.some((r) => r.group !== g.key)) bozuk.push(`${JSON.stringify(f)} ${g.key}: sayaç ${g.count} ≠ liste ${grupta.length}`);
      }
    }
    check("§2 ⭐ her süzgeçte grup sayaçları = liste (toplamda ve grup başına)", bozuk.length === 0, bozuk.join(" · "));
    const ilk = await kartelaTimelineService.list({ search: receipt.receiptNo }, { limit: 50 });
    check("§2b sayaç şeridi dört grubu sabit sırayla döner", JSON.stringify(ilk.groups.map((g) => g.key)) === JSON.stringify(SWATCH_EVENT_GROUPS));

    // §3 imleç
    const sirali = kabul.every((r, i) => i === 0 || r.at < kabul[i - 1].at || (r.at === kabul[i - 1].at && r.id < kabul[i - 1].id));
    check("§3 imleç: 2'lik sayfalarla 9 satır TAM BİR KEZ, (createdAt, id) azalan",
      new Set(kabul.map((r) => r.id)).size === kabul.length && sirali && kabul.map((r) => r.id).join() === ilk.data.map((r) => r.id).join());

    // §4 fail-closed
    let bozukImlec = 0, bozukKimlik = 0;
    try { await kartelaTimelineService.list({}, { cursor: "xyz", limit: 5 }); } catch (e) { bozukImlec = (e as { statusCode?: number }).statusCode ?? 0; }
    try { await kartelaTimelineService.list({ swatchId: "abc" }, { limit: 5 }); } catch (e) { bozukKimlik = (e as { statusCode?: number }).statusCode ?? 0; }
    const grupRed = await denetleyici({ group: "KABUL,YANLIS" });
    const grupTamam = await denetleyici({ group: "KABUL,CUVAL", search: receipt.receiptNo });
    check("§4 bozuk imleç / kimlik 400, tanınmayan grup 400, bilinen grup 200", bozukImlec === 400 && bozukKimlik === 400 && grupRed === 400 && grupTamam === 200,
      `${bozukImlec} · ${bozukKimlik} · ${grupRed} · ${grupTamam}`);

    // §5 Türkçe satır
    const u = await prisma.user.findUniqueOrThrow({ where: { id: admin.id }, select: { fullName: true, username: true } });
    const adminAdi = u.fullName || u.username;
    const aRows = (await kartelaTimelineService.list({ swatchId: a }, { limit: 10 })).data;
    const sackRow = aRows.find((r) => r.group === "CUVAL");
    const shipRow = aRows.find((r) => r.group === "SEVKIYAT");
    const bornRow = aRows.find((r) => r.group === "KABUL");
    check("§5 başlık · geçiş · donuk belge no · aktör · kanal · tetik Türkçe",
      sackRow?.title === "Çuvala girdi" && sackRow.detail === `Stokta → Çuvalda · Çuval ${sack.sackNo}` && sackRow.trigger === "Çuvala okutma"
        && shipRow?.detail === `Çuvalda → Sevkiyatta · Çuval ${sack.sackNo} · Sevkiyat ${shipment.shipmentNo}`
        && bornRow?.detail === `— → Stokta · Kabul ${receipt.receiptNo}` && bornRow.channel === "Sistem"
        && aRows.every((r) => r.actor === adminAdi) && aRows[0].card === `TST-KTL-${TS}-0`,
      `${sackRow?.detail} | ${shipRow?.detail} | ${bornRow?.detail}`);

    // §6 tarih
    const bugun = factoryYmd();
    const dun = factoryYmd(new Date(Date.now() - 36 * 3600_000));
    check("§6 tarih süzgeci fabrika günüyle: bugün hepsi, dünle biten aralık hiçbiri",
      (await hepsi({ search: receipt.receiptNo, dateFrom: bugun, dateTo: bugun })).length === 9
        && (await hepsi({ search: receipt.receiptNo, dateTo: dun })).length === 0);

    // §7 istatistik
    const stats = (await new TamburService().getSwatchStats({ itemId: ITEM })).data!;
    const stok = ((await kartelaService.getStock({ itemId: ITEM })).data ?? []).reduce((s, g) => s + g.count, 0);
    check("§7 istatistik: count yalnız stok (getStock ile aynı), kırılım durumları sayar",
      stats.count === stok && stats.count === 1 && stats.byStatus.IN_SHIPMENT === 2 && stats.byStatus.REDUCED === 1 && stats.byStatus.IN_STOCK === 1,
      `count ${stats.count} · stok ${stok} · ${JSON.stringify(stats.byStatus)}`);
  } finally {
    await temizle();
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

async function temizle(): Promise<void> {
  await prisma.swatch.deleteMany({ where: { id: { in: ids } } });
  if (SACK) await prisma.sack.deleteMany({ where: { id: SACK } });
  if (SHIPMENT) await prisma.shipment.deleteMany({ where: { id: SHIPMENT } });
  if (RECEIPT) await prisma.kartelaReceipt.deleteMany({ where: { id: RECEIPT } });
  if (ITEM) await prisma.item.deleteMany({ where: { id: ITEM } });
  if (CUSTOMER) await prisma.customer.deleteMany({ where: { id: CUSTOMER } });
}

main().catch(async (e) => {
  console.error("HATA:", e);
  await temizle().catch((err) => console.error("temizlik hatası:", err));
  await prisma.$disconnect();
  process.exit(1);
});
