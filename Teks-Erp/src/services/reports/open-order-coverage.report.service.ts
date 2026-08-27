// =============================================================================
// AÇIK SİPARİŞ KARŞILANMA — "bugün neyi sevk edebilirim, neyi üretmem gerek"
// =============================================================================
// Soru operasyoneldir ve tek bir cümleyle özetlenir: açık sipariş metrajının
// ne kadarı ELDEKİ bitmiş maldan karşılanır, ne kadarı ZATEN ÜRETİMDEKİ mala
// düşer, ne kadarı için henüz hiçbir şey yoktur.
//
// ── MOTOR YENİDEN YAZILMADI: `production-balance.service` ÇAĞRILIR ──────────
// Aynı hesabı ikinci kez yazmak iki rakam üretirdi (Üretim Dengesi ekranı ile
// bu rapor) ve hangisinin doğru olduğu sorusu cevapsız kalırdı. Motor tek.
//
// ⚠️ `order.service.getCoverageForLines` BİLEREK KULLANILMIYOR. İki sebeple
// rapor ölçeğinde YANLIŞ sonuç verir:
//   1. Zod cap'i 100 satır (`order.routes.ts`) — açık kalemler bunu aşar.
//   2. Fungible depo havuzunu HER SATIRA TAM yazar. Aynı spec'ten üç satır
//      varsa 500 m'lik depo stoğu üçüne birden sayılır → rapor "hepsi
//      karşılanıyor" der, gerçekte biri karşılanır. Ekran içi (tek sipariş)
//      kullanımında bu doğrudur, toplu raporda değildir.
//
// ── HAVUZ PAYLAŞTIRMASI: ACİLİYET SIRASI ───────────────────────────────────
// Motor havuzu SPEC düzeyinde verir (talep/depo/üretimde). "Bu kalem karşılanır
// mı" sorusunu cevaplamak için havuzu satırlara BÖLMEK gerekir ve bölüm keyfî
// olamaz: fabrika en acil siparişi önce sevk eder. Sıra termin ASC (terminsiz
// EN SONA — söz verilmemiş işi, söz verilmiş işin önüne geçirmek yanlış olurdu),
// sonra sipariş tarihi ASC, sonra sipariş no. Deterministik: aynı veri iki kez
// çalıştırılınca aynı dosya çıkar (`_breakdown` sıralama kuralının aynısı).
// =============================================================================

import { Prisma } from "@prisma/client";
import { ProductionBalanceService, type BalanceLine } from "../production-balance.service";
import { round1 } from "./_breakdown";

/** Detay tablosu tavanı — `DetailTable` sanallaştırma yapmaz. Aşım GİZLENMEZ. */
const MAX_DETAIL_LINES = 500;

export interface OpenOrderCoverageSummary {
  /** Açığı olan sipariş kalemi adedi. */
  openLineCount: number;
  /** Toplam açık metraj (istenen − sevk). */
  openQty: number;
  /** Elde duran bitmiş maldan karşılanabilen. */
  fromWarehouseQty: number;
  /** Zaten üretimdeki mala düşen. */
  fromProductionQty: number;
  /** Ne depoda ne üretimde — yeni iş emri gerekiyor. */
  uncoveredQty: number;
  /** Karşılanamayanın ham kumaşı da yok (kumaş tedariki gerekiyor). */
  materialGapQty: number;
  fullyCoveredLines: number;
  partiallyCoveredLines: number;
  uncoveredLines: number;
  /** Termini GEÇMİŞ ve hâlâ karşılanamayan — listenin en acil ucu. */
  overdueUncoveredLines: number;
  overdueUncoveredQty: number;
  /** Karşılanma oranı (%) — (depo + üretimde) / açık. */
  coveragePct: number;
}

/** Müşteri / kumaş kırılımı. Dört ölçü taşıdığı için `BreakdownRow` yetmez. */
export interface CoverageBucketRow {
  key: string;
  label: string;
  lineCount: number;
  openQty: number;
  fromWarehouseQty: number;
  fromProductionQty: number;
  uncoveredQty: number;
  coveragePct: number;
}

export type CoverageState = "HAZIR" | "KISMI" | "URETIM_GEREKLI";

export interface CoverageLineRow {
  orderId: string;
  orderNumber: string;
  customerName: string;
  itemName: string;
  colorName: string | null;
  width: number | null;
  deadline: string | null;
  /** Termini geçtiyse kaç gün — aksi halde null. */
  daysLate: number | null;
  openQty: number;
  fromWarehouseQty: number;
  fromProductionQty: number;
  uncoveredQty: number;
  state: CoverageState;
}

export interface OpenOrderCoverageReport {
  summary: OpenOrderCoverageSummary;
  byCustomer: CoverageBucketRow[];
  byItem: CoverageBucketRow[];
  lines: CoverageLineRow[];
  /** Tavan aşıldıysa listelenmeyen satır sayısı — sessiz kırpma YOK. */
  linesOmitted: number;
}

const D0 = () => new Prisma.Decimal(0);

/**
 * Aciliyet sırası: termin ASC (terminsiz sona) → sipariş tarihi ASC → sipariş no.
 * Son anahtar determinizm içindir; iki koşum aynı dosyayı üretmeli.
 */
function byUrgency(a: BalanceLine, b: BalanceLine): number {
  const ad = a.deadline ? a.deadline.getTime() : Number.POSITIVE_INFINITY;
  const bd = b.deadline ? b.deadline.getTime() : Number.POSITIVE_INFINITY;
  if (ad !== bd) return ad - bd;
  const ao = a.orderDate.getTime();
  const bo = b.orderDate.getTime();
  if (ao !== bo) return ao - bo;
  return a.orderNumber.localeCompare(b.orderNumber, "tr");
}

/** Havuzdan `need` kadar çek; havuzun kalanını ve çekileni döndür. */
function draw(pool: Prisma.Decimal, need: Prisma.Decimal): [Prisma.Decimal, Prisma.Decimal] {
  const taken = Prisma.Decimal.min(pool, need);
  return [pool.minus(taken), taken];
}

interface Acc {
  lineCount: number;
  open: Prisma.Decimal;
  wh: Prisma.Decimal;
  prod: Prisma.Decimal;
}
const emptyAcc = (): Acc => ({ lineCount: 0, open: D0(), wh: D0(), prod: D0() });

function bucketRows(map: Map<string, { label: string; acc: Acc }>): CoverageBucketRow[] {
  return [...map.entries()]
    .map(([key, { label, acc }]) => {
      const uncovered = Prisma.Decimal.max(0, acc.open.minus(acc.wh).minus(acc.prod));
      return {
        key,
        label,
        lineCount: acc.lineCount,
        openQty: round1(Number(acc.open)),
        fromWarehouseQty: round1(Number(acc.wh)),
        fromProductionQty: round1(Number(acc.prod)),
        uncoveredQty: round1(Number(uncovered)),
        coveragePct: acc.open.isZero()
          ? 100
          : round1(Number(acc.wh.plus(acc.prod).div(acc.open).times(100))),
      };
    })
    // Deterministik: karşılanamayan çok olan üste (aksiyon sırası), sonra ad.
    .sort((a, b) => b.uncoveredQty - a.uncoveredQty || a.label.localeCompare(b.label, "tr"));
}

export async function getOpenOrderCoverage(): Promise<OpenOrderCoverageReport> {
  // Servis singleton export etmiyor (route'ta da `new` ile kuruluyor) —
  // durumsuz olduğu için örnek başına maliyet yok.
  const groups = (await new ProductionBalanceService().getBalance()).data ?? [];

  const byCustomer = new Map<string, { label: string; acc: Acc }>();
  const byItem = new Map<string, { label: string; acc: Acc }>();
  const rows: CoverageLineRow[] = [];

  const sum = {
    open: D0(),
    wh: D0(),
    prod: D0(),
    materialGap: D0(),
    full: 0,
    partial: 0,
    none: 0,
    overdueLines: 0,
    overdueQty: D0(),
  };

  // tz-ok: "termini geçti mi" iki AN arasındaki farktır — takvim günü sorusu
  // değil, fabrika saat diliminden bağımsız.
  const now = Date.now();

  for (const grp of groups) {
    sum.materialGap = sum.materialGap.plus(grp.malzemeAcigi);

    for (const spec of grp.specs) {
      // Havuzlar SPEC düzeyinde tek — satırlara sırayla dağıtılır, kopyalanmaz.
      let whPool = new Prisma.Decimal(spec.depo);
      let prodPool = new Prisma.Decimal(spec.uretimde);

      for (const line of [...spec.lines].sort(byUrgency)) {
        const need = new Prisma.Decimal(line.remaining);
        if (need.lessThanOrEqualTo(0)) continue;

        // Önce eldeki mal (bugün sevk edilebilir), sonra üretimdeki.
        let fromWh: Prisma.Decimal;
        let fromProd: Prisma.Decimal;
        [whPool, fromWh] = draw(whPool, need);
        [prodPool, fromProd] = draw(prodPool, need.minus(fromWh));
        const uncovered = need.minus(fromWh).minus(fromProd);

        const state: CoverageState = uncovered.greaterThan(0)
          ? fromWh.plus(fromProd).isZero()
            ? "URETIM_GEREKLI"
            : "KISMI"
          : "HAZIR";
        if (state === "HAZIR") sum.full++;
        else if (state === "KISMI") sum.partial++;
        else sum.none++;

        const late =
          line.deadline && line.deadline.getTime() < now
            ? Math.floor((now - line.deadline.getTime()) / 86_400_000)
            : null;
        if (late != null && uncovered.greaterThan(0)) {
          sum.overdueLines++;
          sum.overdueQty = sum.overdueQty.plus(uncovered);
        }

        sum.open = sum.open.plus(need);
        sum.wh = sum.wh.plus(fromWh);
        sum.prod = sum.prod.plus(fromProd);

        for (const [map, key, label] of [
          [byCustomer, line.customerId, line.customerName],
          [byItem, line.itemId, line.itemName],
        ] as const) {
          let e = map.get(key);
          if (!e) {
            e = { label, acc: emptyAcc() };
            map.set(key, e);
          }
          e.acc.lineCount++;
          e.acc.open = e.acc.open.plus(need);
          e.acc.wh = e.acc.wh.plus(fromWh);
          e.acc.prod = e.acc.prod.plus(fromProd);
        }

        rows.push({
          orderId: line.orderId,
          orderNumber: line.orderNumber,
          customerName: line.customerName,
          itemName: line.itemName,
          colorName: line.colorName,
          width: line.width == null ? null : Number(line.width),
          deadline: line.deadline ? line.deadline.toISOString() : null,
          daysLate: late,
          openQty: round1(Number(need)),
          fromWarehouseQty: round1(Number(fromWh)),
          fromProductionQty: round1(Number(fromProd)),
          uncoveredQty: round1(Number(uncovered)),
          state,
        });
      }
    }
  }

  // Aksiyon sırası: geciken önce, sonra termin, sonra karşılanamayan büyük.
  rows.sort(
    (a, b) =>
      (b.daysLate ?? -1) - (a.daysLate ?? -1) ||
      (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999") ||
      b.uncoveredQty - a.uncoveredQty ||
      a.orderNumber.localeCompare(b.orderNumber, "tr"),
  );

  const openNum = Number(sum.open);
  const uncoveredTotal = Prisma.Decimal.max(0, sum.open.minus(sum.wh).minus(sum.prod));

  return {
    summary: {
      openLineCount: rows.length,
      openQty: round1(openNum),
      fromWarehouseQty: round1(Number(sum.wh)),
      fromProductionQty: round1(Number(sum.prod)),
      uncoveredQty: round1(Number(uncoveredTotal)),
      materialGapQty: round1(Number(sum.materialGap)),
      fullyCoveredLines: sum.full,
      partiallyCoveredLines: sum.partial,
      uncoveredLines: sum.none,
      overdueUncoveredLines: sum.overdueLines,
      overdueUncoveredQty: round1(Number(sum.overdueQty)),
      coveragePct:
        openNum === 0 ? 100 : round1((Number(sum.wh) + Number(sum.prod)) * 100 / openNum),
    },
    byCustomer: bucketRows(byCustomer),
    byItem: bucketRows(byItem),
    lines: rows.slice(0, MAX_DETAIL_LINES),
    linesOmitted: Math.max(0, rows.length - MAX_DETAIL_LINES),
  };
}
