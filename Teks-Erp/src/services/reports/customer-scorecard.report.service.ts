// =============================================================================
// MÜŞTERİ KARNESİ — ABC (Pareto) + RFM
// =============================================================================
// Üç soruyu tek ekranda cevaplar:
//   • EN ÇOK kim veriyor?  → metraj sıralaması + kümülatif %80 çizgisi (ABC)
//   • EN SIK kim veriyor?  → sipariş adedi + ortalama kaç günde bir
//   • Kimi KAYBEDİYORUM?   → kendi ritmine göre gecikmiş müşteri (risk listesi)
//
// ── İKİ FARKLI ZAMAN KAPSAMI, BİLİNÇLİ ─────────────────────────────────────
// ABC ve dönem metrikleri SEÇİLİ DÖNEME aittir ("bu çeyrekte kim taşıdı").
// Ama RECENCY (kaç gündür sessiz) ve RİTİM (ortalama sipariş aralığı) dönem
// içine hapsedilemez: "son 30 günde sipariş vermedi" cümlesi, 30 günlük pencere
// seçildiğinde HERKES için doğrudur ve hiçbir şey söylemez. Bu iki ölçü
// TÜM GEÇMİŞTEN hesaplanır ve ekranda öyle etiketlenir.
//
// ── "KAYBOLAN MÜŞTERİ" TANIMI — mutlak gün DEĞİL, KENDİ RİTMİNE GÖRE ───────
// "90 gündür sipariş yok" herkes için aynı şeyi ifade etmez: haftalık sipariş
// veren müşteri için felaket, yılda iki kez alan için normaldir. Bu yüzden ölçü
// ORANDIR: geçen süre / o müşterinin ortalama sipariş aralığı. Eşik 2× —
// müşteri kendi ritminin iki katı kadar sessizse listeye girer.
//
// ⚠️ RİTİM EN AZ 3 SİPARİŞ İSTER. İki siparişten çıkan "ortalama aralık" tek bir
// gözlemdir; onunla risk hesaplamak, tek veriden trend çıkarmaktır. Az geçmişli
// müşteriler listeye GİRMEZ ve sayıları AYRICA döner (`insufficientHistory`) —
// sessizce elenmeleri "riskli müşterim yok" yanılgısı üretirdi.
//
// ── "EN SIK VEREN" TEK SAYIYLA ÖLÇÜLEMEZ (2026-09-04, saha bulgusu) ────────
// Fabrikada sipariş girişi TEK TİP DEĞİL: bazı siparişler kalem kalem (bir
// sipariş, on satır), bazıları tek tek (on sipariş, birer satır) giriliyor.
// Aynı işi veren iki müşteri bu yüzden "sipariş adedi"nde 1'e 10 görünür —
// yani `orderCount`la yapılan HER sıralama giriş alışkanlığını ölçer, müşteriyi
// değil. Bu sessiz bir hatadır: sayı makul görünür, sadece yanlıştır.
//
// Çözüm tek bir "doğru sayı" bulmak DEĞİL (yok); ölçüyü AYRIŞTIRMAK:
//   • `orderCount`        — kaç sipariş BELGESİ. Giriş alışkanlığına duyarlı.
//   • `lineCount`         — kaç KALEM. Aynı işin bir siparişe mi on siparişe mi
//                           yazıldığından bağımsız; "kaç ayrı mal istedi".
//   • `avgLinesPerOrder`  — İKİ ALIŞKANLIĞI AYIRT EDEN SAYI. ~1 ise tek tek
//                           giriyor, yüksekse kalem kalem. Bir sıralama ölçütü
//                           değil, diğer sütunların NASIL okunacağının anahtarı.
//   • `orderDayCount`     — kaç ayrı GÜN sipariş verdi. "Sıklık"ın en dürüst
//                           ölçüsü: aynı gün girilen 5 sipariş 1 temas eder ve
//                           tek tek giren müşteriyi şişirmez.
//   • `totalQty`          — kaç METRE. Alışkanlıktan TAMAMEN bağımsız; bu
//                           yüzden ABC/Pareto sıralaması hâlâ metraja dayanır.
// Ekranda beşi de yan yana durur; hiçbiri diğerinin yerine geçmez.
// =============================================================================

import prisma from "../../lib/prisma";
import { Prisma } from "@prisma/client";
import type { DateRange } from "./_shared";
import { pctOf, round1 } from "./_breakdown";
import { isActiveLine } from "../helpers/order-line-scope.helper";
import { collectShipped, type ShippedCell } from "./_shipped";
import { hasAny, lineScopeSql, lineScopeWhere, orderScopeSql, orderScopeWhere, type ReportFilterInput } from "./_filters";
import { droppedRows, optionList, hasFilters, type Secenekler, type WithSecenekler } from "./_secenekler";
import { factoryYmd } from "../../constants/time";

/** Kümülatif pay eşikleri — klasik ABC (Pareto) sınıflandırması. */
const A_THRESHOLD = 80;
const B_THRESHOLD = 95;
/** Kendi ritminin kaç katı sessizlik "risk" sayılır. */
const AT_RISK_RATIO = 2;
/** Ritim hesabı için gereken en az sipariş adedi (aralık sayısı = n − 1). */
const MIN_ORDERS_FOR_RHYTHM = 3;

export type AbcClass = "A" | "B" | "C";

export interface CustomerRankRow {
  customerId: string;
  customerName: string;
  customerCode: string | null;
  /** Dönemdeki sipariş BELGESİ adedi. ⚠️ Giriş alışkanlığına duyarlı — tek
   *  başına "en sık veren" sıralaması için KULLANILMAZ (başlıktaki gerekçe). */
  orderCount: number;
  /** Dönemdeki aktif kalem adedi. "Kaç ayrı mal istedi" — belge sayısından
   *  bağımsız; on kalemi tek siparişe yazan müşteride de on eder. */
  lineCount: number;
  /** Kalem / sipariş. İKİ GİRİŞ ALIŞKANLIĞINI AYIRT EDEN SAYI: ~1 → tek tek
   *  giriliyor, yüksek → kalem kalem. Sıralama ölçütü değil, okuma anahtarı. */
  avgLinesPerOrder: number;
  /** Dönemde sipariş verilen ayrı GÜN sayısı (fabrika takvimi). "Sıklık"ın
   *  dürüst ölçüsü: aynı gün girilen 5 sipariş 1 temas sayılır. */
  orderDayCount: number;
  /** Dönemdeki istenen metraj (iptaller hariç). Alışkanlıktan BAĞIMSIZ ölçü —
   *  ABC sıralaması bu yüzden buna dayanır. */
  totalQty: number;
  avgOrderQty: number;
  /** Dönem metrajındaki payı (%). */
  sharePct: number;
  /** Sıralamada bu satıra kadarki kümülatif pay (%). */
  cumulativePct: number;
  abcClass: AbcClass;
  /** Dönemde verdiği siparişlerden İPTAL EDİLEN metraj (iptal sipariş +
   *  iptal kalem). "Bu müşterinin işi ne kadar sağlam" sorusu. */
  cancelledQty: number;
  /** İptal / (aktif + iptal) — metraj üzerinden (%). Adet üzerinden olsaydı
   *  1 metrelik numune iptali 5000 metrelik iptalle aynı ağırlıkta sayılırdı. */
  cancelRatePct: number;
  /** Dönemde bu müşteriye SEVK EDİLEN brüt metraj (`_shipped.ts` tek tanımı).
   *  ⚠️ Aynı siparişlere ait DEĞİL — bugün sevk edilen mal eski siparişten
   *  gelmiş olabilir. "Verdiği iş ↔ aldığı mal" karşılaştırmasıdır. */
  shippedQty: number;
  /** TÜM GEÇMİŞ — dönemle sınırlı değil. */
  lifetimeOrderCount: number;
  /** İlk siparişin tarihi (tüm geçmiş) — "ne zamandan beri müşterimiz". */
  firstOrderDate: string | null;
  lastOrderDate: string | null;
  daysSinceLastOrder: number | null;
  /** Ortalama sipariş aralığı (gün) — en az 3 sipariş yoksa null. */
  avgIntervalDays: number | null;
  /** Dönemde en çok istediği kumaş. */
  topItemName: string | null;
  /** Dönemde en çok istediği renk — kumaşla birlikte "ne alıyor" cevabı. */
  topColorName: string | null;
  prevQty?: number;
}

export interface AtRiskCustomerRow {
  customerId: string;
  customerName: string;
  lastOrderDate: string;
  daysSinceLastOrder: number;
  avgIntervalDays: number;
  /** Geçen süre / ortalama aralık — 2 ve üzeri riskli. */
  overdueRatio: number;
  lifetimeOrderCount: number;
  lifetimeQty: number;
}

export interface CustomerScorecardSummary {
  /** Dönemde sipariş veren müşteri sayısı. */
  customerCount: number;
  orderCount: number;
  /** Dönemdeki aktif kalem adedi — `orderCount`la BİRLİKTE okunur. */
  lineCount: number;
  /** Fabrika genelinde kalem/sipariş. Sütunun "yüksek mi" olduğu ancak bu
   *  ortalamaya göre söylenebilir; mutlak bir eşik yoktur. */
  avgLinesPerOrder: number;
  totalQty: number;
  /** Dönemde verilen siparişlerden iptal edilen metraj + oranı. */
  cancelledQty: number;
  cancelRatePct: number;
  /** Dönemde iptal edilen sipariş BELGESİ adedi. */
  cancelledOrderCount: number;
  /** Dönemde sevk edilen BRÜT metraj — TÜM müşteriler (`_shipped.ts`).
   *  ⚠️ Satırların sevk sütunu bu toplamı vermeyebilir: bu dönemde sipariş
   *  vermeyen ama mal alan müşteri sıralamada YOKTUR. Fark yalanmaz, yazılır. */
  shippedQty: number;
  aClassCount: number;
  bClassCount: number;
  cClassCount: number;
  /** A sınıfının dönem metrajındaki payı (%) — yoğunlaşma göstergesi. */
  aClassQtyPct: number;
  /** Geçmişte sipariş vermiş ama BU DÖNEMDE hiç vermemiş müşteri sayısı. */
  dormantCount: number;
  /** Kendi ritmine göre gecikmiş müşteri sayısı. */
  atRiskCount: number;
  /** Ritim hesaplanamayacak kadar az geçmişi olan müşteri sayısı (risk dışı). */
  insufficientHistoryCount: number;
  prevCustomerCount?: number;
  prevTotalQty?: number;
}

export interface CustomerScorecard extends WithSecenekler {
  summary: CustomerScorecardSummary;
  /** Metraja göre sıralı — Pareto eğrisi bu sırayla okunur. */
  ranking: CustomerRankRow[];
  atRisk: AtRiskCustomerRow[];
}

interface PeriodAgg {
  /** R5b-c3 seçici kaynağı için (ad ömür boyu tablosundan da gelir; dönem toplayıcısı süzgeçsiz koşunca buradan). */
  customerName: string;
  orderCount: number;
  lineCount: number;
  qty: number;
  /** Fabrika takvim günü anahtarları — `size` "kaç ayrı gün sipariş verdi". */
  orderDays: Set<string>;
  cancelledOrderCount: number;
  cancelledQty: number;
  itemQty: Map<string, { name: string; code: string; qty: number }>;
  colorQty: Map<string, { name: string; qty: number }>;
}

/** Boş toplayıcı — tek yerde, alan eklenince tüm yollar birlikte güncellenir. */
const emptyAgg = (customerName: string): PeriodAgg => ({
  customerName,
  orderCount: 0,
  lineCount: 0,
  qty: 0,
  orderDays: new Set(),
  cancelledOrderCount: 0,
  cancelledQty: 0,
  itemQty: new Map(),
  colorQty: new Map(),
});

/**
 * Dönemdeki sipariş/kalem toplamları — müşteri bazlı.
 *
 * ⚠️ SATIRLAR SÜZGEÇSİZ ÇEKİLİR, ayrım JS'te `isActiveLine` ikiziyle yapılır.
 * Sebep: iptal ORANI için aynı sorgunun hem aktif hem iptal kalemi görmesi
 * gerekiyor ve Prisma aynı ilişkiyi iki farklı süzgeçle bir kerede seçemiyor.
 * İki ayrı sorgu atmak, aralarında bir yazma olduğunda payla paydayı farklı
 * anlara bağlar ve "%103 iptal" gibi imkânsız bir oran üretebilirdi.
 *
 * ⚠️ TOMBSTONE: birleştirilmiş cari (`mergedIntoId != null`) kendi satırını
 * AÇAMAZ. Birleştirme motoru siparişleri survivor'a TAŞIR (`MERGE_MAP.customer`
 * → MOVE Order), yani bugün bu süzgeç sıfır satır eler (ölçüldü: 0) — ama
 * taşınmamış tek bir sipariş, aynı müşteriyi listede İKİ KEZ gösterirdi ve
 * ikincisinin adı `collectLifetime` tombstone'u dışladığı için "—" olurdu.
 */
async function collectPeriod(range: DateRange, f: ReportFilterInput): Promise<Map<string, PeriodAgg>> {
  const scope = orderScopeWhere(f);
  const orders = await prisma.order.findMany({
    where: {
      orderDate: { gte: range.from, lte: range.to },
      // İptal siparişler de gelir: iptal ORANININ payı onlardan doğar. Aktif
      // metrajdan ayrılmaları aşağıda, `status` üzerinden yapılır.
      ...scope,
      customer: { ...(scope.customer as Prisma.CustomerWhereInput | undefined), mergedIntoId: null },
    },
    select: {
      customerId: true,
      customer: { select: { name: true } },
      status: true,
      orderDate: true,
      lines: {
        // R5b-c: kalem süzgeci seçilen kalemleri de budar (iptal edilmişler kalır, statü aşağıda ayrışır).
        where: lineScopeWhere(f),
        select: {
          quantity: true,
          cancelledAt: true,
          itemId: true,
          item: { select: { name: true, code: true } },
          colorId: true,
          color: { select: { name: true } },
        },
      },
    },
  });
  const map = new Map<string, PeriodAgg>();
  for (const o of orders) {
    let a = map.get(o.customerId);
    if (!a) {
      a = emptyAgg(o.customer.name);
      map.set(o.customerId, a);
    }

    // İPTAL EDİLMİŞ SİPARİŞ: metraja, kaleme, ritme ve GÜNE girmez — verilmemiş
    // sayılır. Yalnız iptal oranının payına yazılır (kalemleri tek tek iptal
    // işaretli olmayabilir; belge iptali hepsini kapsar).
    if (o.status === "CANCELLED") {
      a.cancelledOrderCount++;
      for (const l of o.lines) a.cancelledQty += Number(l.quantity);
      continue;
    }

    a.orderCount++;
    // "Sıklık" günü: aynı gün girilen N sipariş TEK temastır. Fabrika takvimi
    // kullanılır (UTC değil) — gece 00:30'daki giriş bir önceki iş gününe ait
    // olabilir ve iki gün gibi sayılması sıklığı yapay olarak şişirirdi.
    a.orderDays.add(factoryYmd(o.orderDate));

    for (const l of o.lines) {
      const q = Number(l.quantity);
      if (!isActiveLine(l)) {
        // İptal edilmiş kalem: aktif işe sayılmaz ama İPTAL oranına girer.
        a.cancelledQty += q;
        continue;
      }
      a.lineCount++;
      a.qty += q;
      const it = a.itemQty.get(l.itemId) ?? { name: l.item.name, code: l.item.code, qty: 0 };
      it.qty += q;
      a.itemQty.set(l.itemId, it);
      if (l.colorId && l.color) {
        const co = a.colorQty.get(l.colorId) ?? { name: l.color.name, qty: 0 };
        co.qty += q;
        a.colorQty.set(l.colorId, co);
      }
    }
  }
  return map;
}

interface LifetimeAgg {
  customerId: string;
  customerName: string;
  customerCode: string | null;
  orderCount: number;
  qty: number;
  firstOrder: Date;
  lastOrder: Date;
}

/**
 * TÜM GEÇMİŞ toplamları — recency ve ritim için. Dönemle sınırlı DEĞİL
 * (başlıktaki gerekçe). İptal edilmiş siparişler ritmi bozmasın diye dışlanır:
 * iptal edilen sipariş "temas" sayılır ama "iş" sayılmaz ve ikisini karıştırmak
 * risk listesini sessizce boşaltırdı.
 */
async function collectLifetime(f: ReportFilterInput): Promise<LifetimeAgg[]> {
  return prisma.$queryRaw<
    Array<{
      customerId: string;
      customerName: string;
      customerCode: string | null;
      orderCount: bigint;
      qty: number | null;
      firstOrder: Date;
      lastOrder: Date;
    }>
  >(Prisma.sql`
    SELECT c.id                                   AS "customerId",
           c.name                                 AS "customerName",
           c.code                                 AS "customerCode",
           COUNT(DISTINCT o.id)                   AS "orderCount",
           COALESCE(SUM(ol.quantity), 0)::float8  AS qty,
           MIN(o."orderDate")                     AS "firstOrder",
           MAX(o."orderDate")                     AS "lastOrder"
    FROM customers c
    JOIN orders o        ON o."customerId" = c.id AND o.status <> 'CANCELLED' ${orderScopeSql(f)}
    -- aktif-kalem: ömür boyu metraj da iptal edilmiş kalemi saymaz.
    LEFT JOIN order_lines ol ON ol."orderId" = o.id AND ol."cancelledAt" IS NULL ${lineScopeSql(f)}
    WHERE c."mergedIntoId" IS NULL
    GROUP BY c.id, c.name, c.code
  `).then((rows) =>
    rows.map((r) => ({
      customerId: r.customerId,
      customerName: r.customerName,
      customerCode: r.customerCode,
      orderCount: Number(r.orderCount),
      qty: round1(r.qty ?? 0),
      firstOrder: r.firstOrder,
      lastOrder: r.lastOrder,
    })),
  );
}

const cellMatches = (f: ReportFilterInput, c: ShippedCell): boolean =>
  (!hasAny(f.itemId) || (c.itemId != null && f.itemId.includes(c.itemId))) && (!hasAny(f.colorId) || (c.colorId != null && f.colorId.includes(c.colorId)));

export async function getCustomerScorecard(
  range: DateRange,
  compareRange: DateRange | null = null,
  filters: ReportFilterInput = {},
): Promise<CustomerScorecard> {
  const [period, lifetime, prevPeriod, shippedCells, unfiltered] = await Promise.all([
    collectPeriod(range, filters),
    collectLifetime(filters),
    compareRange ? collectPeriod(compareRange, filters) : Promise.resolve(null),
    // "Dönemde sevk edilen metraj" TEK TANIM (`_shipped.ts`) — brüt, doğrudan
    // sevkler dahil, iade geri-eklemeli. İkinci bir tanım üretmiyoruz. Yön süzgeci sevk
    // sütununda SEVKİYATIN donmuş yönüdür (müşteri listesi ise sipariş zincirinden).
    collectShipped(range, { destination: filters.destination }),
    // R5b-c3: seçici kaynağı süzgeçten bağımsız — süzgeçli istek dönem toplayıcısını bir kez daha süzgeçsiz koşar (beyanlı ×2).
    hasFilters(filters) ? collectPeriod(range, {}) : Promise.resolve(null),
  ]);
  const source = unfiltered ?? period;
  const secenekler: Secenekler = {
    customerId: optionList([...source.entries()].map(([id, a]) => ({ id, ad: a.customerName }))),
    itemId: optionList([...source.values()].flatMap((a) => [...a.itemQty.entries()].map(([id, it]) => ({ id, ad: it.name, kod: it.code })))),
  };

  const byId = new Map(lifetime.map((l) => [l.customerId, l]));
  // R5b-c: sevk hücreleri ortak tanımdan (`_shipped`) gelir, süzgeç burada — müşteri/hedef için "ömür boyu
  // listede var mı" (o liste süzgeçli), kalem/renk için hücrenin kendisi.
  const shippedByCustomer = new Map<string, number>();
  for (const c of shippedCells) {
    if (!byId.has(c.customerId) || !cellMatches(filters, c)) continue;
    shippedByCustomer.set(c.customerId, (shippedByCustomer.get(c.customerId) ?? 0) + c.qty);
  }
  // tz-ok: "kaç gündür sessiz" iki AN arasındaki farktır, takvim günü değil.
  const now = Date.now();
  const daysBetween = (a: Date, b: number) => Math.floor((b - a.getTime()) / 86_400_000);

  /**
   * Ortalama sipariş aralığı = (ilk↔son sipariş süresi) / (sipariş sayısı − 1).
   * Aralık sayısı n−1'dir; n'e bölmek ritmi sistematik olarak KISA gösterir ve
   * herkesi riskli yapardı.
   */
  const rhythm = (l: LifetimeAgg): number | null => {
    if (l.orderCount < MIN_ORDERS_FOR_RHYTHM) return null;
    const spanDays = (l.lastOrder.getTime() - l.firstOrder.getTime()) / 86_400_000;
    if (spanDays <= 0) return null;
    return round1(spanDays / (l.orderCount - 1));
  };

  /**
   * Kalem/sipariş oranı İKİ ONDALIK basar (diğer ölçüler bir). Sebep: bu sayı
   * bir MİKTAR değil AYIRT EDİCİ; 1.0 ile 1.4 arasındaki fark "tek tek giriyor"
   * ile "bazen ikili giriyor"u ayırır ve tek ondalığa yuvarlanınca komşu
   * müşteriler aynı değere çöküp sütun bilgi taşımaz olur.
   */
  const round2 = (n: number): number => Math.round(n * 100) / 100;

  const totalQty = round1([...period.values()].reduce((s, a) => s + a.qty, 0));
  const orderCount = [...period.values()].reduce((s, a) => s + a.orderCount, 0);
  const lineCount = [...period.values()].reduce((s, a) => s + a.lineCount, 0);
  const cancelledQty = round1([...period.values()].reduce((s, a) => s + a.cancelledQty, 0));
  const cancelledOrderCount = [...period.values()].reduce((s, a) => s + a.cancelledOrderCount, 0);
  const shippedTotal = round1(shippedCells.reduce((s, c) => s + c.qty, 0));

  const rows: CustomerRankRow[] = [...period.entries()]
    .map(([customerId, agg]) => {
      const lt = byId.get(customerId);
      // Deterministik "favori": metraj DESC, eşitlikte ada göre. Sıralama
      // anahtarı tek olsaydı eşit metrajlı iki kumaşta sonuç koşumdan koşuma
      // değişir ve rapor kendini tekrar etmezdi.
      const top = (m: Map<string, { name: string; qty: number }>) =>
        [...m.values()].sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name, "tr"))[0] ??
        null;
      const topItem = top(agg.itemQty);
      const topColor = top(agg.colorQty);
      return {
        customerId,
        customerName: lt?.customerName ?? "—",
        customerCode: lt?.customerCode ?? null,
        orderCount: agg.orderCount,
        lineCount: agg.lineCount,
        avgLinesPerOrder: agg.orderCount > 0 ? round2(agg.lineCount / agg.orderCount) : 0,
        orderDayCount: agg.orderDays.size,
        totalQty: round1(agg.qty),
        avgOrderQty: agg.orderCount > 0 ? round1(agg.qty / agg.orderCount) : 0,
        sharePct: pctOf(agg.qty, totalQty),
        cumulativePct: 0, // aşağıda doldurulur
        abcClass: "C" as AbcClass,
        cancelledQty: round1(agg.cancelledQty),
        // Payda AKTİF + İPTAL: "verdiği işin ne kadarını geri çekti". Paydaya
        // yalnız aktifi koymak, her şeyi iptal eden müşteride %∞ üretirdi.
        cancelRatePct: pctOf(agg.cancelledQty, agg.qty + agg.cancelledQty),
        shippedQty: round1(shippedByCustomer.get(customerId) ?? 0),
        lifetimeOrderCount: lt?.orderCount ?? agg.orderCount,
        firstOrderDate: lt ? lt.firstOrder.toISOString() : null,
        lastOrderDate: lt ? lt.lastOrder.toISOString() : null,
        daysSinceLastOrder: lt ? daysBetween(lt.lastOrder, now) : null,
        avgIntervalDays: lt ? rhythm(lt) : null,
        topItemName: topItem?.name ?? null,
        topColorName: topColor?.name ?? null,
        ...(prevPeriod ? { prevQty: round1(prevPeriod.get(customerId)?.qty ?? 0) } : {}),
      };
    })
    // Deterministik: metraj DESC, eşitlikte sipariş adedi, sonra ad.
    .sort(
      (a, b) =>
        b.totalQty - a.totalQty ||
        b.orderCount - a.orderCount ||
        a.customerName.localeCompare(b.customerName, "tr"),
    );

  // Kümülatif pay + ABC sınıfı — sıralı liste üzerinde tek geçiş.
  let cum = 0;
  for (const r of rows) {
    cum += r.sharePct;
    r.cumulativePct = round1(Math.min(cum, 100));
    r.abcClass = r.cumulativePct <= A_THRESHOLD ? "A" : r.cumulativePct <= B_THRESHOLD ? "B" : "C";
  }
  // Sınır düzeltmesi: %80'i AŞAN ilk satır da A'dır — aksi halde eşiği tek
  // başına aşan büyük bir müşteri B'ye düşer ve "A sınıfı %80 taşır" cümlesi
  // yalan olur (klasik Pareto kesme kuralı).
  const firstNonA = rows.findIndex((r) => r.abcClass !== "A");
  if (firstNonA > 0 && rows[firstNonA - 1]!.cumulativePct < A_THRESHOLD) {
    rows[firstNonA]!.abcClass = "A";
  } else if (firstNonA === 0 && rows.length > 0) {
    rows[0]!.abcClass = "A";
  }

  // ── Risk listesi: TÜM müşteriler üzerinden (dönemde sipariş vermeyenler de) ──
  const atRisk: AtRiskCustomerRow[] = [];
  let insufficientHistory = 0;
  let dormant = 0;
  for (const l of lifetime) {
    if (!period.has(l.customerId)) dormant++;
    const interval = rhythm(l);
    if (interval === null) {
      insufficientHistory++;
      continue;
    }
    const days = daysBetween(l.lastOrder, now);
    const ratio = round1(days / interval);
    if (ratio >= AT_RISK_RATIO) {
      atRisk.push({
        customerId: l.customerId,
        customerName: l.customerName,
        lastOrderDate: l.lastOrder.toISOString(),
        daysSinceLastOrder: days,
        avgIntervalDays: interval,
        overdueRatio: ratio,
        lifetimeOrderCount: l.orderCount,
        lifetimeQty: l.qty,
      });
    }
  }
  // En çok gecikmiş ve en değerli olan üste; deterministik son anahtar ad.
  atRisk.sort(
    (a, b) =>
      b.overdueRatio - a.overdueRatio ||
      b.lifetimeQty - a.lifetimeQty ||
      a.customerName.localeCompare(b.customerName, "tr"),
  );

  const aRows = rows.filter((r) => r.abcClass === "A");
  return {
    summary: {
      customerCount: rows.length,
      orderCount,
      lineCount,
      avgLinesPerOrder: orderCount > 0 ? round2(lineCount / orderCount) : 0,
      totalQty,
      cancelledQty,
      cancelRatePct: pctOf(cancelledQty, totalQty + cancelledQty),
      cancelledOrderCount,
      shippedQty: shippedTotal,
      aClassCount: aRows.length,
      bClassCount: rows.filter((r) => r.abcClass === "B").length,
      cClassCount: rows.filter((r) => r.abcClass === "C").length,
      aClassQtyPct: pctOf(
        aRows.reduce((s, r) => s + r.totalQty, 0),
        totalQty,
      ),
      dormantCount: dormant,
      atRiskCount: atRisk.length,
      insufficientHistoryCount: insufficientHistory,
      ...(prevPeriod
        ? {
            prevCustomerCount: prevPeriod.size,
            prevTotalQty: round1([...prevPeriod.values()].reduce((s, a) => s + a.qty, 0)),
          }
        : {}),
    },
    ranking: rows,
    atRisk,
    secenekler,
    dusenSatir: droppedRows(unfiltered?.size ?? null, period.size),
  };
}
