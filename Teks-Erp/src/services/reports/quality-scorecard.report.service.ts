// =============================================================================
// KALİTE KARNESİ — tekstilde 1 numaralı rapor
// =============================================================================
// Soru: "Bu dönemde ürettiğimiz kumaşın yüzde kaçı 1. kalite çıktı, ve bu geçen
// döneme göre ne oldu?" Kırılım: kumaş × renk × fason firma × gün.
//
// ── ÇIPA: `Roll.finalizedAt` (migration 20260809090000) ──────────────────────
// `updatedAt` KULLANILMAZ — o gerçek bir üretim damgası değildir (etiket yeniden
// basımı ya da not düzenlemesi de günceller; kök CLAUDE.md). `createdAt` de
// olmaz: top KK1'de doğar, kalite kararı haftalar sonra verilir. Hareketten
// türetmek de çalışmıyordu (ölçüm 2026-08-09: bitmiş topların hiçbirinde
// kapanmış `RollMovement` yok — Tambur kesim çocuğu ve elle eklenen top hiç
// hareket görmez). Çıpayı bir trigger yazar, uygulama kodu değil.
//
// ── ÖLÇÜ BİRİMİ: METRE, adet DEĞİL ──────────────────────────────────────────
// Tekstilde kalite oranı metrajla ölçülür. 1000 m 1. kalite top ile 5 m 2. kalite
// parçayı "1'e 1" saymak oranı anlamsız yapardı. Adet de döner (operatör kaç
// parça görmüş) ama BAŞLIK metriği metrajdır.
//
// ── KAPSAM: `K18_DEAD_STATUSES` DIŞLANIR, `SCRAP` DIŞLANMAZ ─────────────────
// Tüketilmiş toplar (TAMBUR_CONSUMED / SUBCONTRACTOR_CONSUMED / KARTELA_CONSUMED)
// metrajlarını ÇOCUKLARINA devretmiştir; hem ebeveyni hem çocukları saymak aynı
// kumaşı iki kez saymaktır. CANCELLED zaten "kayıt hatalıydı, mal yoktu" demek.
// `SCRAP` ise BİLİNÇLİ OLARAK İÇERİDEDİR: fire gerçek bir üretim sonucudur ve
// kalite karnesinin tam da ölçmesi gereken şeydir (aynı ayrım `batch.service`
// K18 ↔ NO_LIVE_MATERIAL kümelerinde de yapılıyor).
//
// ⚠️ GEÇMİŞE DÖNÜK DÜZELTME (restatement) BİLİNÇLİDİR: depo topu sonradan
// kesilirse ebeveyn `TAMBUR_CONSUMED` olur ve üretildiği dönemin karnesinden
// DÜŞER (metrajı artık çocuklarında). Aynı şekilde kalite sonradan "Düzelt" ile
// değiştirilirse ESKİ dönemin karnesi yeni kaliteyle okunur — bu doğrudur ve
// sektör pratiğidir (düzeltme, düzeltilen döneme yazılır). Alternatif — aynı
// kumaşı iki dönemde birden saymak — açıkça yanlış olurdu.
//
// ⚠️ METRAJ `currentQty`'dir (topun ŞU ANKİ metrajı), finalize anındaki değil —
// o an saklanmıyor. Sonradan kesilen top karnede küçülür. Aynı restatement
// ailesinden; başka bir kolon eklemeden verilebilecek en doğru cevap bu.
//
// ── "1. KALİTE" KODA GÖMÜLMEZ — KAYNAK SIRALAMA DEĞİL, ROL ──────────────────
// Başlık metriği "1. kalitenin payı"dır ve o kalite katalogtaki
// `role = FIRST` satırından çözülür (`helpers/quality-role.helper.ts`).
// Kodda `code === "1.KALITE"` araması YAPILMAZ: fabrika kaliteyi yeniden
// adlandırabilir ve sabit kod o gün sessizce yanlış bir karne üretirdi.
//
// ⚠️ 2026-09-13 DEĞİŞİKLİĞİ — eskiden kaynak `sortOrder` idi ("en ÜST SIRADAKİ
// kalite") ve dosya "'1. kalite' kavramı kodda YOK" diyordu. O cümle karar ①
// ile GEÇERSİZ oldu: kavram artık kodda VAR ve adı `QualityGradeRole.FIRST`.
// Sıralamayı kaynak bırakmak iki kusur taşıyordu:
//   1) `isActive` süzülmüyordu — PASİFLEŞTİRİLMİŞ bir kademe en küçük
//      `sortOrder`a sahipse "en üst kalite" o olurdu (sessiz yanlış karne);
//   2) daha ağırı: aynı soruya İKİNCİ bir cevap veriyordu. "Bu fabrikada 1.
//      kalite hangi satır" sorusunun tek kaynağı `role`dür; sıralama bir SUNUM
//      tercihidir ve bir gün rol ile ayrışır.
// `sortOrder` bu dosyada YALNIZ kırılım satırlarının GÖSTERİM sırası için
// okunmaya devam eder — hangi kalitenin "1. kalite" olduğunu artık söylemez.
// =============================================================================

import prisma from "../../lib/prisma";
import { Prisma, QualityGradeRole } from "@prisma/client";
import { loadQualityRoles } from "../helpers/quality-role.helper";
import type { DateRange } from "./_shared";
import { factoryDaySql } from "../../constants/time";
import { K18_DEAD_STATUSES } from "../batch.service";

// ---------- Tipler -----------------------------------------------------------

export interface GradeShare {
  /** null = kalitesi belirlenmemiş top (katalog satırı yok). */
  gradeId: string | null;
  code: string;
  name: string;
  sortOrder: number;
  rollCount: number;
  qty: number;
  /** Dönem toplam metrajına oran (%). */
  pct: number;
  /** Karşılaştırma dönemi — yalnız karşılaştırma istendiyse dolar. */
  prevQty?: number;
  prevPct?: number;
}

export interface ScorecardBreakdownRow {
  key: string;
  label: string;
  rollCount: number;
  totalQty: number;
  /** 1. kalite rolündeki (`role=FIRST`) kalitenin bu satırdaki metrajı. */
  topGradeQty: number;
  topGradePct: number;
  /** Kalite kodu → metraj (ekranda kolonlar bu sözlükten çizilir). */
  qtyByGrade: Record<string, number>;
  prevTotalQty?: number;
  prevTopGradePct?: number;
}

export interface QualityScorecardSummary {
  rollCount: number;
  totalQty: number;
  /** Kalitesi katalogda tanımlı olan metraj. */
  gradedQty: number;
  /** Kalitesi HİÇ belirlenmemiş metraj — "0" ile karıştırılmamalı, "bilinmiyor". */
  ungradedQty: number;
  /** 1. kalite rolündeki kalite ve payı; rol atanmamışsa null (kart çizilmez). */
  topGrade: { code: string; name: string; qty: number; pct: number } | null;
  prevRollCount?: number;
  prevTotalQty?: number;
  prevTopGradePct?: number;
}

export interface QualityScorecard {
  summary: QualityScorecardSummary;
  grades: GradeShare[];
  byItem: ScorecardBreakdownRow[];
  byColor: ScorecardBreakdownRow[];
  bySubcontractor: ScorecardBreakdownRow[];
  daily: Array<{ day: string; totalQty: number; topGradeQty: number; topGradePct: number }>;
  /** Karne hangi kaliteyi "1. kalite" saydı (rolden) — ekran başlığı bunu kullanır. */
  topGradeCode: string | null;
  /** Kalite kodlarının katalog sırası — tablo kolonlarının sırası bundan gelir. */
  gradeOrder: Array<{ code: string; name: string }>;
  /** Çıpası olmayan (finalizedAt NULL) ama final statüdeki top sayısı — kapsam dürüstlüğü. */
  unanchoredRollCount: number;
}

// ---------- Ham toplama ------------------------------------------------------

interface RawCell {
  gradeId: string | null;
  gradeCode: string | null;
  gradeName: string | null;
  gradeSort: number | null;
  itemId: string;
  itemName: string;
  colorId: string | null;
  colorName: string | null;
  subId: string | null;
  subName: string | null;
  /** Top fason dönüşünde mi doğdu — firma çözülemese bile bilinir. */
  fromSubcontractor: boolean;
  rollCount: number;
  qty: number;
}

const UNGRADED_CODE = "__UNGRADED__";
const UNGRADED_LABEL = "Belirsiz";

/**
 * Dönemin TEK sorgusu: tüm kırılım boyutları aynı GROUP BY'da toplanır, alt
 * tablolar JS'te bu hücrelerden türetilir.
 *
 * NEDEN TEK SORGU: dört ayrı sorgu (kalite / kumaş / renk / fason) aynı satırları
 * dört kez tarardı ve daha kötüsü — aralarında bir yazma olursa toplamları
 * BİRBİRİNİ TUTMAZDI ("kumaş kırılımı 1200 m, renk kırılımı 1180 m" gibi). Tek
 * kaynaktan türetmek bu sınıf tutarsızlığı yapısal olarak imkânsız kılar.
 * Kardinalite sınırlı: dönemde GÖRÜLEN (kalite × kumaş × renk × fason) bileşimi.
 */
async function collectPeriod(range: DateRange): Promise<RawCell[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      gradeId: string | null;
      gradeCode: string | null;
      gradeName: string | null;
      gradeSort: number | null;
      itemId: string;
      itemName: string;
      colorId: string | null;
      colorName: string | null;
      subId: string | null;
      subName: string | null;
      fromSubcontractor: boolean;
      rollCount: bigint;
      qty: number | null;
    }>
  >(Prisma.sql`
    SELECT
      r."qualityGradeId"        AS "gradeId",
      qg.code                   AS "gradeCode",
      qg.name                   AS "gradeName",
      qg."sortOrder"            AS "gradeSort",
      r."itemId"                AS "itemId",
      i.name                    AS "itemName",
      r."colorId"               AS "colorId",
      c.name                    AS "colorName",
      sr."subcontractorId"      AS "subId",
      sub.name                  AS "subName",
      (r."entrySource" = 'SUBCONTRACTOR_RETURN') AS "fromSubcontractor",
      COUNT(*)                  AS "rollCount",
      SUM(r."currentQty")::float AS "qty"
    FROM rolls r
    JOIN items i                       ON i.id  = r."itemId"
    LEFT JOIN quality_grades qg        ON qg.id = r."qualityGradeId"
    LEFT JOIN colors c                 ON c.id  = r."colorId"
    -- Fason atfı: top fason dönüşünde DOĞDUYSA makbuzu üzerinden firmaya bağlanır.
    --
    -- ⚠️ entrySource DE SEÇİLİR ve bu LOAD-BEARING. Ölçüldü (2026-08-09, fabrika
    -- kopyası): fason dönüşünde doğmuş 21 topun yalnız 6'sında parentReceiptId
    -- dolu. Yalnız JOIN'e bakılsaydı kalan 15 top "Fabrika içi" satırında
    -- toplanırdı — eksik veri değil, YANLIŞ ATIF: fasonun ürettiği kaliteyi
    -- fabrikanın hanesine yazmak, raporun cevaplamak için var olduğu sorunun
    -- (hangi boyahane iyi çalışıyor) tam tersini söyler. Üçüncü kova bu yüzden var.
    LEFT JOIN subcontractor_receipts sr ON sr.id = r."parentReceiptId"
    LEFT JOIN subcontractors sub        ON sub.id = sr."subcontractorId"
    WHERE r."finalizedAt" >= ${range.from}
      AND r."finalizedAt" <= ${range.to}
      AND r.status::text NOT IN (${Prisma.join(K18_DEAD_STATUSES.map((s) => s as string))})
    GROUP BY r."qualityGradeId", qg.code, qg.name, qg."sortOrder",
             r."itemId", i.name, r."colorId", c.name, sr."subcontractorId", sub.name,
             (r."entrySource" = 'SUBCONTRACTOR_RETURN')
  `);

  return rows.map((r) => ({
    gradeId: r.gradeId,
    gradeCode: r.gradeCode,
    gradeName: r.gradeName,
    gradeSort: r.gradeSort,
    itemId: r.itemId,
    itemName: r.itemName,
    colorId: r.colorId,
    colorName: r.colorName,
    subId: r.subId,
    subName: r.subName,
    fromSubcontractor: Boolean(r.fromSubcontractor),
    rollCount: Number(r.rollCount),
    qty: Number(r.qty ?? 0),
  }));
}

// ---------- Türetme ----------------------------------------------------------

const round1 = (n: number) => Math.round(n * 10) / 10;
const pctOf = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);

/** Hücrenin kalite kimliği — kalitesizler tek kovada toplanır. */
function cellGradeCode(c: RawCell): string {
  return c.gradeCode ?? UNGRADED_CODE;
}

/**
 * Kırılım tablosu üretici. `keyOf`/`labelOf` boyutu seçer; geri kalan mantık
 * (toplam, üst-kalite payı, kalite sözlüğü) ortaktır — üç tabloyu üç kez yazmak
 * aralarında sessiz tanım farkı doğururdu.
 */
function buildBreakdown(
  cells: RawCell[],
  keyOf: (c: RawCell) => string,
  labelOf: (c: RawCell) => string,
  topCode: string | null,
): ScorecardBreakdownRow[] {
  const map = new Map<string, ScorecardBreakdownRow>();
  for (const c of cells) {
    const key = keyOf(c);
    let row = map.get(key);
    if (!row) {
      row = {
        key,
        label: labelOf(c),
        rollCount: 0,
        totalQty: 0,
        topGradeQty: 0,
        topGradePct: 0,
        qtyByGrade: {},
      };
      map.set(key, row);
    }
    row.rollCount += c.rollCount;
    row.totalQty += c.qty;
    const gc = cellGradeCode(c);
    row.qtyByGrade[gc] = (row.qtyByGrade[gc] ?? 0) + c.qty;
    if (topCode && gc === topCode) row.topGradeQty += c.qty;
  }
  const out = [...map.values()];
  for (const row of out) {
    row.totalQty = round1(row.totalQty);
    row.topGradeQty = round1(row.topGradeQty);
    row.topGradePct = pctOf(row.topGradeQty, row.totalQty);
    for (const k of Object.keys(row.qtyByGrade)) row.qtyByGrade[k] = round1(row.qtyByGrade[k]);
  }
  // Metrajı büyükten küçüğe: operatörün ilk baktığı satır en çok ürettiğimiz
  // kumaş olsun. Eşitlikte ada göre — deterministik sıra (aynı istek aynı çıktı).
  out.sort((a, b) => b.totalQty - a.totalQty || a.label.localeCompare(b.label, "tr"));
  return out;
}

/** Karşılaştırma dönemindeki satırları anahtara göre mevcut satırlara işler. */
function attachPrevBreakdown(
  current: ScorecardBreakdownRow[],
  prevCells: RawCell[],
  keyOf: (c: RawCell) => string,
  labelOf: (c: RawCell) => string,
  topCode: string | null,
): void {
  const prev = new Map(buildBreakdown(prevCells, keyOf, labelOf, topCode).map((r) => [r.key, r]));
  for (const row of current) {
    const p = prev.get(row.key);
    // Önceki dönemde HİÇ olmayan satır: 0 yazılır (gerçekten sıfır üretim) —
    // `undefined` bırakmak ekranda "veri yok" ile "üretim yok"u karıştırırdı.
    row.prevTotalQty = p ? p.totalQty : 0;
    row.prevTopGradePct = p ? p.topGradePct : 0;
  }
}

// ---------- Ana giriş --------------------------------------------------------

export async function getQualityScorecard(
  range: DateRange,
  compareRange: DateRange | null = null,
): Promise<QualityScorecard> {
  // Katalog GÖSTERİM sırası veriden gelir (kırılım satırları bu sırayla çizilir).
  const catalog = await prisma.qualityGrade.findMany({
    orderBy: { sortOrder: "asc" },
    select: { id: true, code: true, name: true, sortOrder: true },
  });
  // "1. kalite" ROLDEN çözülür, SIRALAMADAN değil (dosya başlığı, karar ①).
  // `find` kullanılır `require` değil: karne bir OKUMA yüzeyidir — rolsüz
  // katalogda 400 vermek yerine başlık metriğini `null` bırakır (ekran
  // "1. kalite payı" kartını çizmez). Yazma yolları `require` ile fail-closed.
  const roles = await loadQualityRoles(prisma);
  const topGrade = roles.find(QualityGradeRole.FIRST);
  const topCode = topGrade?.code ?? null;

  const [cells, prevCells, dailyRows, unanchored] = await Promise.all([
    collectPeriod(range),
    compareRange ? collectPeriod(compareRange) : Promise.resolve<RawCell[]>([]),
    // Günlük seri: gün FABRİKA takvim gününde kesilir (gece vardiyası bir önceki
    // güne düşmesin — `constants/time.ts`).
    prisma.$queryRaw<Array<{ day: Date; totalQty: number | null; topQty: number | null }>>(Prisma.sql`
      SELECT
        ${factoryDaySql('r."finalizedAt"')} AS day,
        SUM(r."currentQty")::float          AS "totalQty",
        SUM(r."currentQty") FILTER (WHERE qg.code = ${topCode})::float AS "topQty"
      FROM rolls r
      LEFT JOIN quality_grades qg ON qg.id = r."qualityGradeId"
      WHERE r."finalizedAt" >= ${range.from}
        AND r."finalizedAt" <= ${range.to}
        AND r.status::text NOT IN (${Prisma.join(K18_DEAD_STATUSES.map((s) => s as string))})
      GROUP BY 1
      ORDER BY 1
    `),
    // KAPSAM DÜRÜSTLÜĞÜ: çıpası olmayan final-statülü toplar. Bunlar hiçbir
    // dönemde görünmez; sayıyı GİZLEMEK yerine ekrana taşıyoruz — kullanıcı
    // karnenin neyi kapsamadığını bilmeden ona güvenmemeli.
    prisma.roll.count({
      where: {
        finalizedAt: null,
        status: { in: ["WAREHOUSE", "A1_STOCK", "SCRAP"] },
      },
    }),
  ]);

  // ── Kalite dağılımı ────────────────────────────────────────────────────────
  const gradeMap = new Map<string, GradeShare>();
  let totalQty = 0;
  let rollCount = 0;
  for (const c of cells) {
    totalQty += c.qty;
    rollCount += c.rollCount;
    const code = cellGradeCode(c);
    let g = gradeMap.get(code);
    if (!g) {
      g = {
        gradeId: c.gradeId,
        code,
        name: c.gradeName ?? UNGRADED_LABEL,
        // Kalitesizler HER ZAMAN sona: katalog sırasının dışındalar, araya
        // girerlerse "en üst kalite" okuması bozulurdu.
        sortOrder: c.gradeSort ?? Number.MAX_SAFE_INTEGER,
        rollCount: 0,
        qty: 0,
        pct: 0,
      };
      gradeMap.set(code, g);
    }
    g.rollCount += c.rollCount;
    g.qty += c.qty;
  }

  const prevTotals = prevCells.reduce(
    (acc, c) => {
      acc.qty += c.qty;
      acc.rolls += c.rollCount;
      const code = cellGradeCode(c);
      acc.byGrade.set(code, (acc.byGrade.get(code) ?? 0) + c.qty);
      return acc;
    },
    { qty: 0, rolls: 0, byGrade: new Map<string, number>() },
  );

  const grades = [...gradeMap.values()].sort((a, b) => a.sortOrder - b.sortOrder);
  for (const g of grades) {
    g.qty = round1(g.qty);
    g.pct = pctOf(g.qty, totalQty);
    if (compareRange) {
      g.prevQty = round1(prevTotals.byGrade.get(g.code) ?? 0);
      g.prevPct = pctOf(g.prevQty, prevTotals.qty);
    }
  }

  const topQty = topCode ? (gradeMap.get(topCode)?.qty ?? 0) : 0;
  const ungradedQty = gradeMap.get(UNGRADED_CODE)?.qty ?? 0;

  // ── Kırılımlar ─────────────────────────────────────────────────────────────
  const itemKey = (c: RawCell) => c.itemId;
  const itemLabel = (c: RawCell) => c.itemName;
  const colorKey = (c: RawCell) => c.colorId ?? "__NOCOLOR__";
  const colorLabel = (c: RawCell) => c.colorName ?? "Renksiz / Ham";
  // Fason boyutu ÜÇ kovalıdır ve üçüncüsü sessizliği kırmak için var (bkz.
  // `collectPeriod` içindeki JOIN notu): firması çözülemeyen bir fason dönüşü
  // "Fabrika içi"ne yazılamaz — atfı bilmemek ile fabrikaya yazmak farklı şeyler.
  const subKey = (c: RawCell) => c.subId ?? (c.fromSubcontractor ? "__SUB_UNKNOWN__" : "__INHOUSE__");
  const subLabel = (c: RawCell) =>
    c.subName ?? (c.fromSubcontractor ? "Fason (firma belirsiz)" : "Fabrika içi");

  const byItem = buildBreakdown(cells, itemKey, itemLabel, topCode);
  const byColor = buildBreakdown(cells, colorKey, colorLabel, topCode);
  const bySubcontractor = buildBreakdown(cells, subKey, subLabel, topCode);

  if (compareRange) {
    attachPrevBreakdown(byItem, prevCells, itemKey, itemLabel, topCode);
    attachPrevBreakdown(byColor, prevCells, colorKey, colorLabel, topCode);
    attachPrevBreakdown(bySubcontractor, prevCells, subKey, subLabel, topCode);
  }

  // ── Özet ───────────────────────────────────────────────────────────────────
  const summary: QualityScorecardSummary = {
    rollCount,
    totalQty: round1(totalQty),
    gradedQty: round1(totalQty - ungradedQty),
    ungradedQty: round1(ungradedQty),
    // Ad da ROL satırından gelir — `catalog[0].name` sıralamanın ilkiydi ve
    // rolle ayrışabilirdi (kod bir satırı, ad başka satırı gösterirdi).
    topGrade: topGrade
      ? { code: topGrade.code, name: topGrade.name, qty: round1(topQty), pct: pctOf(topQty, totalQty) }
      : null,
  };
  if (compareRange) {
    summary.prevRollCount = prevTotals.rolls;
    summary.prevTotalQty = round1(prevTotals.qty);
    summary.prevTopGradePct = pctOf(topCode ? (prevTotals.byGrade.get(topCode) ?? 0) : 0, prevTotals.qty);
  }

  return {
    summary,
    grades,
    byItem,
    byColor,
    bySubcontractor,
    daily: dailyRows.map((r) => {
      const total = Number(r.totalQty ?? 0);
      const top = Number(r.topQty ?? 0);
      return {
        day: r.day.toISOString().slice(0, 10),
        totalQty: round1(total),
        topGradeQty: round1(top),
        topGradePct: pctOf(top, total),
      };
    }),
    topGradeCode: topCode,
    gradeOrder: [...catalog.map((g) => ({ code: g.code, name: g.name })), { code: UNGRADED_CODE, name: UNGRADED_LABEL }],
    unanchoredRollCount: unanchored,
  };
}
