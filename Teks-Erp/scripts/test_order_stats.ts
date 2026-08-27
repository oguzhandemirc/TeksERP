// =============================================================================
// TeksERP - Sipariş özet şeridi (`GET /api/orders/stats`) bekçisi
// =============================================================================
// TEK İDDİA: şeridin saydığı küme ile listenin gösterdiği küme AYNIDIR.
//
// Neden mekanik bekçi gerekiyor: ikisi ayrı metotlardan besleniyor
// (`getOrderStats` ↔ `findAll`) ve where'i ayrı ayrı kurmaları hiçbir hata
// vermezdi — yalnız üstteki sayı ile alttaki tablo sessizce ayrışırdı.
// `BaseService.buildListWhere` bu yüzden tek nokta; bu test o tekliği ölçer.
//
// ⚠️ İKİNCİ İDDİA (asimetri, bilinçli): ADET listenin aynasıdır ama METRAJ
// iptalleri HER ZAMAN dışlar. Biri diğerine uydurulursa ya iptal edilmiş
// siparişin metrajı açık stok gibi görünür ya da şeridin toplamı listenin
// satır sayısını tutmaz. Test ikisini AYRI AYRI kilitler.
// =============================================================================

import { Request } from "express";
import prisma from "../src/lib/prisma";
import { orderService } from "../src/routes/order.routes";
import type { OrderStats } from "../src/services/order.service";
import type { PaginatedResponse } from "../src/types/api.types";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`);
  }
}

const req = (query: Record<string, string>): Request => ({ query }) as unknown as Request;

const DAY = 24 * 60 * 60 * 1000;

async function statsOf(q: Record<string, string>): Promise<OrderStats> {
  return (await orderService.getOrderStats(req(q))).data as OrderStats;
}

/** Listenin gerçek satır sayısı (offset yolu — `pagination.total`). */
async function listTotal(q: Record<string, string>): Promise<number> {
  const res = (await orderService.findAll(
    req({ ...q, page: "1", pageSize: "1" }),
  )) as PaginatedResponse<unknown>;
  return res.pagination.total;
}

/** Şerit ↔ liste eşitliği — bu dosyanın var olma sebebi. */
async function assertMirror(label: string, q: Record<string, string>, expected: number): Promise<void> {
  const [s, total] = [await statsOf(q), await listTotal(q)];
  check(`${label} — şerit = liste`, s.totalCount === total, `şerit=${s.totalCount} liste=${total}`);
  check(`${label} — beklenen adet ${expected}`, s.totalCount === expected, `gelen=${s.totalCount}`);
}

async function main(): Promise<void> {
  const ts = Date.now();
  const TAG = `TEST-OSTAT-${ts}`;

  // ⚠️ TEMİZLİK KURULUMU DA KAPSAR. Fixture yaratımı `try` DIŞINDA kalırsa
  // kurulumun ortasında düşen bir koşum (zorunlu alan eksik, unique çakışması…)
  // `finally`ye hiç girmez ve yarım fixture dev DB'sinde kalır — ölçüldü:
  // ilk koşum `itemType` eksikliğinden düştü ve müşteri satırı sızdı, sonraki
  // `test_consistency` taramasında gürültü olarak göründü. Kod TAG öneki ile
  // silindiği için hangi nesnelerin doğduğunu ayrıca takip etmeye gerek yok.
  try {
    // ── Fixture: kendi müşterisi + kendi kumaş/renkleri → komşu veriden izole ──
    const customer = await prisma.customer.create({
      data: { code: `${TAG}-C`, name: `${TAG} MUSTERI` },
      select: { id: true },
    });
    const i1 = await prisma.item.create({ data: { code: `${TAG}-I1`, name: `${TAG} KUMAS 1`, itemType: "FABRIC" }, select: { id: true } });
    const i2 = await prisma.item.create({ data: { code: `${TAG}-I2`, name: `${TAG} KUMAS 2`, itemType: "FABRIC" }, select: { id: true } });
    const k1 = await prisma.color.create({ data: { code: `${TAG}-K1`, name: `${TAG} RENK 1` }, select: { id: true } });
    const k2 = await prisma.color.create({ data: { code: `${TAG}-K2`, name: `${TAG} RENK 2` }, select: { id: true } });

    const now = Date.now();
    const mk = async (
      no: string,
      status: "APPROVED" | "CANCELLED" | "COMPLETED",
      line: { itemId: string; colorId: string; quantity: number; shippedQty?: number },
      opts: { deadline?: Date; createdAt?: Date; shippedQty?: number } = {},
    ) =>
      prisma.order.create({
        data: {
          orderNumber: `${TAG}-${no}`,
          customerId: customer.id,
          status,
          ...(opts.deadline ? { deadline: opts.deadline } : {}),
          ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
          ...(opts.shippedQty != null ? { shippedQty: opts.shippedQty } : {}),
          lines: { create: [line] },
        },
        select: { id: true },
      });

    // O1 eski tarihli (tarih aralığı filtresini ölçmek için), O2 gecikmiş,
    // O3 bu hafta terminli, O4 iptal (metrajı HİÇBİR kapsamda sayılmamalı),
    // O5 tamamlanmış + sevkli.
    await mk("O1", "APPROVED", { itemId: i1.id, colorId: k1.id, quantity: 100 }, { createdAt: new Date(now - 40 * DAY) });
    await mk("O2", "APPROVED", { itemId: i1.id, colorId: k2.id, quantity: 200 }, { deadline: new Date(now - 5 * DAY) });
    await mk("O3", "APPROVED", { itemId: i2.id, colorId: k1.id, quantity: 300 }, { deadline: new Date(now + 3 * DAY) });
    await mk("O4", "CANCELLED", { itemId: i1.id, colorId: k1.id, quantity: 500 });
    await mk(
      "O5",
      "COMPLETED",
      { itemId: i2.id, colorId: k2.id, quantity: 400, shippedQty: 400 },
      { shippedQty: 400 },
    );

    const C = { "filter[customerId]": customer.id };
    const HIDE = { ...C, "filter[hideCancelled]": "true" };

    // ── 1) Aynalama: her filtre kombinasyonunda şerit = liste ──
    console.log("\n── 1) Şerit ↔ liste aynalaması ──");
    await assertMirror("iptaller gizli", HIDE, 4);
    await assertMirror("iptaller görünür", C, 5);
    await assertMirror("kumaş I1 (gizli)", { ...HIDE, "filter[itemId]": i1.id }, 2);
    await assertMirror("kumaş I1 (görünür)", { ...C, "filter[itemId]": i1.id }, 3);
    await assertMirror("I1 + K1 aynı kalemde", { ...C, "filter[itemId]": i1.id, "filter[colorId]": k1.id }, 2);
    await assertMirror("çoklu kumaş CSV", { ...HIDE, "filter[itemId]": `${i1.id},${i2.id}` }, 4);
    await assertMirror("durum = APPROVED", { ...C, "filter[status]": "APPROVED" }, 3);
    await assertMirror("woState = NONE", { ...HIDE, "filter[woState]": "NONE" }, 4);
    await assertMirror(
      "tarih aralığı (son 10 gün)",
      { ...HIDE, dateField: "createdAt", dateFrom: new Date(now - 10 * DAY).toISOString() },
      3,
    );

    // ── 2) NEGATİF SONDA: extraWhere gerçekten uygulanıyor mu? ──
    // `buildListWhere`'den `extraWhere` düşerse itemId/colorId/hideCancelled
    // sessizce yok sayılır ve bütün sayılar 5'e eşitlenir — 1. bölüm hâlâ
    // "şerit = liste" derdi (ikisi de aynı yanlışı yapardı). Bu yüzden
    // süzgeçlerin FARK YARATTIĞI ayrıca ölçülür.
    console.log("\n── 2) Negatif sonda: süzgeçler fark yaratıyor mu ──");
    const hepsi = await statsOf(C);
    const sadeceI1 = await statsOf({ ...C, "filter[itemId]": i1.id });
    const gizli = await statsOf(HIDE);
    check("itemId süzgeci kümeyi daraltıyor", sadeceI1.totalCount < hepsi.totalCount, `${sadeceI1.totalCount} !< ${hepsi.totalCount}`);
    check("hideCancelled süzgeci kümeyi daraltıyor", gizli.totalCount < hepsi.totalCount, `${gizli.totalCount} !< ${hepsi.totalCount}`);

    // ── 3) Durum kırılımı ──
    console.log("\n── 3) Durum kırılımı ──");
    check("byStatus.APPROVED = 3", gizli.byStatus.APPROVED === 3, JSON.stringify(gizli.byStatus));
    check("byStatus.COMPLETED = 1", gizli.byStatus.COMPLETED === 1, JSON.stringify(gizli.byStatus));
    check("iptaller gizliyken CANCELLED kovası YOK", gizli.byStatus.CANCELLED === undefined, JSON.stringify(gizli.byStatus));
    check("iptaller görünürken CANCELLED = 1", hepsi.byStatus.CANCELLED === 1, JSON.stringify(hepsi.byStatus));

    // ── 4) METRAJ: iptaller HER İKİ kapsamda da dışarıda ──
    console.log("\n── 4) Metraj kapsamı (asimetri) ──");
    check("istenen metraj = 1000 (iptaller gizliyken)", gizli.totalOrderedQty === 1000, `${gizli.totalOrderedQty}`);
    check(
      "istenen metraj iptaller GÖRÜNÜRKEN de 1000 — iptalin 500'ü sayılmaz",
      hepsi.totalOrderedQty === 1000,
      `${hepsi.totalOrderedQty}`,
    );
    check("sevk edilen metraj = 400", gizli.totalShippedQty === 400, `${gizli.totalShippedQty}`);
    check("açık metraj = 600", gizli.totalOpenQty === 600, `${gizli.totalOpenQty}`);
    check("açık metraj asla negatif değil", gizli.totalOpenQty >= 0, `${gizli.totalOpenQty}`);

    // ── 5) Termin ve iş emri sayaçları ──
    console.log("\n── 5) Termin / iş emri sayaçları ──");
    check("geciken = 1 (O2)", gizli.overdueCount === 1, `${gizli.overdueCount}`);
    check("bu hafta terminli = 1 (O3)", gizli.dueThisWeekCount === 1, `${gizli.dueThisWeekCount}`);
    check("iş emri yok = 4", gizli.noWorkOrderCount === 4, `${gizli.noWorkOrderCount}`);
    check(
      "geciken sayacı iptali saymaz",
      (await statsOf(C)).overdueCount === 1,
      "iptalli sipariş terminsiz olsa da kapsam dışı kalmalı",
    );
  } finally {
    // TAG öneğiyle sil — kurulum yarıda kaldıysa hangi nesnelerin doğduğunu
    // bilmiyoruz, önek hepsini kapsar. Order silinince lines CASCADE düşer.
    await prisma.order.deleteMany({ where: { orderNumber: { startsWith: TAG } } });
    await prisma.customer.deleteMany({ where: { code: { startsWith: TAG } } });
    await prisma.item.deleteMany({ where: { code: { startsWith: TAG } } });
    await prisma.color.deleteMany({ where: { code: { startsWith: TAG } } });
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
