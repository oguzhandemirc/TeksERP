// =============================================================================
// STOK & ÖLÜ STOK — "ne var, kaç gündür duruyor, siparişi var mı"
// =============================================================================
// "Rulo Yaşlandırma" + "Stok Dağılımı" raporlarının yerini alır. Eksik olan şey
// ikisinin KESİŞİMİYDİ: yaşlı olmak tek başına sorun değil (sipariş bekliyor
// olabilir), siparişsiz olmak da tek başına sorun değil (dün üretilmiş olabilir).
// Nakit sıkışması **ikisi birden** olduğunda başlar.
//
// ── ÇIPA: `Roll.statusChangedAt` (migration 20260809090000) ────────────────
// Kök CLAUDE.md'nin *"gerçek stok yaşlandırma / FIFO istenirse yalnız statü
// geçişlerinde damgalanan ayrı bir kolon gerekir; `updatedAt` bunun yerine
// kullanılmamalı"* dediği kolon. `updatedAt` etiket yeniden basımıyla da
// güncellendiği için raftaki topu "dün gelmiş" gösterebiliyordu.
//
// ⚠️ ÇIPASIZ TOPLAR GİZLENMEZ. Damga trigger'dan önce doğmuş ve geriye
// doldurmada audit izi bulunamamış toplar `statusChangedAt = NULL` taşır. Bunlar
// yaş kovalarına DAĞITILMAZ (yaşları bilinmiyor) ama metrajları toplam stoğa
// GİRER ve sayıları ayrıca raporlanır — "yaşı bilinmiyor" ile "yeni" farklı
// şeylerdir ve ikincisine yuvarlamak ölü stoğu sistematik olarak gizlerdi.
//
// ── "SİPARİŞSİZ" TANIMI: talep tanımı `production-balance` ile AYNI ────────
// Açık talep = Σ(quantity − shippedQty), CANCELLED/COMPLETED dışı siparişlerden
// (rezerv/çuvallanmış düşülmez — düşüş yalnız sevkte). Spec = kumaş + renk + en.
// İkinci bir talep tanımı yazmak, Ürün Dengesi ekranıyla çelişen bir "açık"
// rakamı üretirdi.
//
// ⚠️ SİPARİŞSİZLİK SPEC BAZINDA, TOP BAZINDA DEĞİL. "Bu topun siparişi var mı"
// sorusunun cevabı yoktur — sipariş topa değil spec'e bağlanır. Bu yüzden
// spec'in stoğu talebini AŞAN kısmı siparişsiz sayılır; hangi FİZİKSEL topun
// karşılıksız olduğu iddia edilmez (edilseydi keyfi olurdu).
//
// ── INDEX BİLİNÇLİ OLARAK EKLENMEDİ ────────────────────────────────────────
// `[status, statusChangedAt]` composite'i planlanmıştı ama EKLENMEDİ: bu
// geliştirme kopyasında (99 top) EXPLAIN seq-scan cezası göstermiyor (23 buffer)
// ve `rolls` zaten 19 indeksli — kök CLAUDE.md bu tabloda index eklemeye açıkça
// dikkat çekiyor, üstelik canlıda index migration'ı vardiya dışı deploy ister.
// TETİKLEYİCİ: `rolls` ~50k satırı geçtiğinde ya da bu servisin sorgusunda
// EXPLAIN `Seq Scan` gösterdiğinde `@@index([status, statusChangedAt])` eklenir.
// =============================================================================

import prisma from "../../lib/prisma";
import { ACTIVE_LINE } from "../helpers/order-line-scope.helper";
import { OrderStatus, Prisma } from "@prisma/client";
import { pctOf, round1 } from "./_breakdown";

/** Yaş kovaları (gün) — üst sınır dahil değil; sonuncusu açık uçlu. */
const AGE_BUCKETS = [
  { key: "0-7", label: "0–7 gün", max: 7 },
  { key: "8-30", label: "8–30 gün", max: 30 },
  { key: "31-90", label: "31–90 gün", max: 90 },
  { key: "90+", label: "90 günden eski", max: Infinity },
] as const;

/** "Ölü stok" eşiği (gün) — bu yaştan eski VE siparişsiz olan. */
const DEAD_STOCK_DAYS = 90;

export interface StockAgeRow {
  key: string;
  label: string;
  count: number;
  qty: number;
  pct: number;
}

export interface StockItemRow {
  key: string;
  label: string;
  count: number;
  qty: number;
  oldestDays: number | null;
  /** Bu kumaşta açık talebi AŞAN (siparişsiz) metraj. */
  uncoveredQty: number;
}

export interface StockScorecard {
  summary: {
    /** Bitmiş depo (WAREHOUSE + A1_STOCK). */
    finishedQty: number;
    finishedCount: number;
    /**
     * Ham stok (STOCK) — işlenmeyi bekleyen HAM kumaş.
     *
     * ⚠️ Dışarıdan alınan yarı mamulü **İÇERMEZ** (2026-08-26). İkisi aynı statüyü
     * paylaşır ama farklı stok TÜRÜdür ve envanterde de ayrı sekmelerde durur;
     * burada birleşik saymak "ekran 800 diyor, rapor 950 diyor" çelişkisini üretirdi.
     */
    rawQty: number;
    rawCount: number;
    /** Dışarıdan alınan yarı mamul (STOCK + entrySource=SEMI_FINISHED). */
    semiQty: number;
    semiCount: number;
    /** Eşikten eski bitmiş stok. */
    agedQty: number;
    /** Eşikten eski VE siparişsiz — asıl "ölü stok". */
    deadQty: number;
    deadStockDays: number;
    /** Yaş çıpası olmayan toplar — kovalara dağıtılmadı, metrajı toplama dahil. */
    unagedCount: number;
    unagedQty: number;
  };
  byAge: StockAgeRow[];
  byItem: StockItemRow[];
  oldest: Array<{
    rollId: string;
    barcode: string | null;
    itemName: string;
    colorName: string | null;
    status: string;
    qty: number;
    days: number;
  }>;
}

interface StockCell {
  rollId: string;
  itemId: string;
  itemName: string;
  colorId: string | null;
  colorName: string | null;
  width: number | null;
  status: string;
  entrySource: string;
  qty: number;
  days: number | null;
}

const FINISHED = ["WAREHOUSE", "A1_STOCK"];
const RAW = ["STOCK"];
/** Ham ↔ yarı mamul ayrımı: statü aynı (STOCK), ayıran şey giriş kaynağı. */
const SEMI = "SEMI_FINISHED";

function specKey(itemId: string, colorId: string | null, width: number | null): string {
  return `${itemId}|${colorId ?? ""}|${width ?? ""}`;
}

export async function getStockScorecard(): Promise<StockScorecard> {
  const [rows, demandRows] = await Promise.all([
    prisma.$queryRaw<
      Array<{
        rollId: string; itemId: string; itemName: string;
        colorId: string | null; colorName: string | null; width: number | null;
        status: string; entrySource: string; qty: number; days: number | null; barcode: string | null;
      }>
    >(Prisma.sql`
      SELECT
        r.id AS "rollId", r.barcode,
        r."itemId" AS "itemId", i.name AS "itemName",
        r."colorId" AS "colorId", c.name AS "colorName",
        r.width::float AS "width",
        r.status::text AS "status",
        r."entrySource"::text AS "entrySource",
        r."currentQty"::float AS "qty",
        -- tz-ok: raftaki bekleme YAŞI iki an arası mutlak farktır, takvim günü değil.
        CASE WHEN r."statusChangedAt" IS NULL THEN NULL
             -- tz-ok: raf yaşı mutlak farktır (yukarıdaki satırın devamı).
             ELSE EXTRACT(EPOCH FROM (now() - r."statusChangedAt")) / 86400.0 END AS "days"
      FROM rolls r
      JOIN items i       ON i.id = r."itemId"
      LEFT JOIN colors c ON c.id = r."colorId"
      WHERE r.status::text IN (${Prisma.join([...FINISHED, ...RAW])})
        -- Sevke okutulmuş / çuvala girmiş top artık "raf" değildir; kalırsa
        -- ölü stok rakamı çıkmak üzere olan malı da sayardı.
        AND r."shipmentId" IS NULL
        AND r."sackId" IS NULL
    `),
    // Açık talep — tanım `production-balance.service` ile BİREBİR.
    prisma.orderLine.findMany({
      // İptal edilmiş kalem talep sayılmaz → o spec "siparişsiz" (ölü stok
      // adayı) olarak görünmeli. Süzgeç düşerse ölü stok OLDUĞUNDAN AZ çıkar.
      where: {
        order: { status: { notIn: [OrderStatus.CANCELLED, OrderStatus.COMPLETED] } },
        ...ACTIVE_LINE,
      },
      select: { itemId: true, colorId: true, width: true, quantity: true, shippedQty: true },
    }),
  ]);

  const cells: StockCell[] = rows.map((r) => ({
    rollId: r.rollId,
    itemId: r.itemId,
    itemName: r.itemName,
    colorId: r.colorId,
    colorName: r.colorName,
    width: r.width,
    status: r.status,
    entrySource: r.entrySource,
    qty: Number(r.qty),
    days: r.days === null ? null : Number(r.days),
  }));
  const barcodeById = new Map(rows.map((r) => [r.rollId, r.barcode]));

  // ── Spec bazında açık talep ────────────────────────────────────────────────
  const demandBySpec = new Map<string, number>();
  for (const l of demandRows) {
    const open = Math.max(0, Number(l.quantity) - Number(l.shippedQty));
    if (open <= 0) continue;
    const k = specKey(l.itemId, l.colorId, l.width === null ? null : Number(l.width));
    demandBySpec.set(k, (demandBySpec.get(k) ?? 0) + open);
  }

  const finished = cells.filter((c) => FINISHED.includes(c.status));
  // Ham ↔ yarı mamul: aynı statü, farklı stok türü. Envanterdeki iki sekmeyle
  // BİREBİR aynı ayrım (`rollScope=RAW_STOCK_PURE` / `SEMI_FINISHED`) — ikisi
  // ayrışırsa aynı soruya iki rakam veren iki yüzey doğar.
  const raw = cells.filter((c) => RAW.includes(c.status) && c.entrySource !== SEMI);
  const semi = cells.filter((c) => RAW.includes(c.status) && c.entrySource === SEMI);

  // ── Siparişsiz metraj — SPEC bazında, top bazında değil (başlık notu) ──────
  const stockBySpec = new Map<string, number>();
  for (const c of finished) {
    const k = specKey(c.itemId, c.colorId, c.width);
    stockBySpec.set(k, (stockBySpec.get(k) ?? 0) + c.qty);
  }
  const uncoveredBySpec = new Map<string, number>();
  for (const [k, stock] of stockBySpec) {
    uncoveredBySpec.set(k, Math.max(0, stock - (demandBySpec.get(k) ?? 0)));
  }

  // ── Yaş kovaları (yalnız BİTMİŞ stok; ham stok yaşlandırması ayrı soru) ────
  const finishedQty = finished.reduce((a, c) => a + c.qty, 0);
  const byAge: StockAgeRow[] = AGE_BUCKETS.map((b) => ({
    key: b.key, label: b.label, count: 0, qty: 0, pct: 0,
  }));
  let unagedCount = 0;
  let unagedQty = 0;
  let agedQty = 0;
  for (const c of finished) {
    if (c.days === null) {
      unagedCount += 1;
      unagedQty += c.qty;
      continue;
    }
    const idx = AGE_BUCKETS.findIndex((b) => c.days! <= b.max);
    const row = byAge[idx === -1 ? byAge.length - 1 : idx];
    if (row) {
      row.count += 1;
      row.qty += c.qty;
    }
    if (c.days > DEAD_STOCK_DAYS) agedQty += c.qty;
  }
  for (const r of byAge) {
    r.qty = round1(r.qty);
    r.pct = pctOf(r.qty, finishedQty);
  }

  // ── Ölü stok: eşikten eski VE spec'i siparişsiz ────────────────────────────
  // Spec'in siparişsiz metrajı, o spec'in ESKİ toplarına ORANTILI dağıtılır:
  // hangi fiziksel topun karşılıksız olduğu iddia edilemez (başlık notu), ama
  // "eski VE siparişsiz" kesişimi ölçülebilir bir büyüklüktür.
  let deadQty = 0;
  const oldBySpec = new Map<string, number>();
  for (const c of finished) {
    if (c.days !== null && c.days > DEAD_STOCK_DAYS) {
      const k = specKey(c.itemId, c.colorId, c.width);
      oldBySpec.set(k, (oldBySpec.get(k) ?? 0) + c.qty);
    }
  }
  for (const [k, oldQty] of oldBySpec) {
    // Siparişsiz metraj spec'in TAMAMINA aittir; eski kısmı aşamaz.
    deadQty += Math.min(oldQty, uncoveredBySpec.get(k) ?? 0);
  }

  // ── Kumaş kırılımı ─────────────────────────────────────────────────────────
  const itemMap = new Map<string, StockItemRow>();
  const itemUncovered = new Map<string, number>();
  for (const [k, unc] of uncoveredBySpec) {
    const itemId = k.split("|")[0] ?? "";
    itemUncovered.set(itemId, (itemUncovered.get(itemId) ?? 0) + unc);
  }
  for (const c of finished) {
    let row = itemMap.get(c.itemId);
    if (!row) {
      row = { key: c.itemId, label: c.itemName, count: 0, qty: 0, oldestDays: null, uncoveredQty: 0 };
      itemMap.set(c.itemId, row);
    }
    row.count += 1;
    row.qty += c.qty;
    if (c.days !== null) row.oldestDays = row.oldestDays === null ? c.days : Math.max(row.oldestDays, c.days);
  }
  const byItem = [...itemMap.values()].map((r) => ({
    ...r,
    qty: round1(r.qty),
    oldestDays: r.oldestDays === null ? null : round1(r.oldestDays),
    uncoveredQty: round1(itemUncovered.get(r.key) ?? 0),
  }));
  byItem.sort((a, b) => b.qty - a.qty || a.label.localeCompare(b.label, "tr"));

  const oldest = finished
    .filter((c) => c.days !== null)
    .sort((a, b) => (b.days ?? 0) - (a.days ?? 0))
    .slice(0, 25)
    .map((c) => ({
      rollId: c.rollId,
      barcode: barcodeById.get(c.rollId) ?? null,
      itemName: c.itemName,
      colorName: c.colorName,
      status: c.status,
      qty: round1(c.qty),
      days: round1(c.days ?? 0),
    }));

  return {
    summary: {
      finishedQty: round1(finishedQty),
      finishedCount: finished.length,
      rawQty: round1(raw.reduce((a, c) => a + c.qty, 0)),
      rawCount: raw.length,
      semiQty: round1(semi.reduce((a, c) => a + c.qty, 0)),
      semiCount: semi.length,
      agedQty: round1(agedQty),
      deadQty: round1(deadQty),
      deadStockDays: DEAD_STOCK_DAYS,
      unagedCount,
      unagedQty: round1(unagedQty),
    },
    byAge,
    byItem,
    oldest,
  };
}
