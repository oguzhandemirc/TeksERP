// =============================================================================
// KALİTE KARNESİ YÜKLEMİ — "dönemde finalize edilen metrajın yüzde kaçı 1. kalite" (TEK kaynak)
// =============================================================================
// Kalite karnesi (`reports/quality-scorecard.report.service.ts`) ve bildirim koşulu
// `kalite.kk1-oran-dusuk` (`notification-sources/is.ts`) AYNI hücre sorgusunu ve AYNI kırılım
// üreticisini çağırır; çıpa, K18 dışlaması ve "1. kalite = rol" kararları karne dosyasının başlığında.
// =============================================================================
import prisma from "../../lib/prisma";
import { Prisma, QualityGradeRole } from "@prisma/client";
import type { DateRange } from "../reports/_shared";
import { K18_DEAD_STATUSES } from "../batch.service";
import { loadQualityRoles } from "./quality-role.helper";

/** Karne satırı (kumaş/renk/fason kırılımı). */
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

// ---------- Ham toplama ------------------------------------------------------

export interface RawCell {
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

export const UNGRADED_CODE = "__UNGRADED__";
export const UNGRADED_LABEL = "Belirsiz";

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
export async function collectPeriod(range: DateRange, beamSql: Prisma.Sql = Prisma.empty): Promise<RawCell[]> {
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
      ${beamSql}
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

export const round1 = (n: number) => Math.round(n * 10) / 10;
export const pctOf = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);

/** Hücrenin kalite kimliği — kalitesizler tek kovada toplanır. */
export function cellGradeCode(c: RawCell): string {
  return c.gradeCode ?? UNGRADED_CODE;
}

/**
 * Kırılım tablosu üretici. `keyOf`/`labelOf` boyutu seçer; geri kalan mantık
 * (toplam, üst-kalite payı, kalite sözlüğü) ortaktır — üç tabloyu üç kez yazmak
 * aralarında sessiz tanım farkı doğururdu.
 */
export function buildBreakdown(
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

// ---------- Kumaş kırılımı (karne `byItem` + bildirim koşulu) --------------------

export const itemKey = (c: RawCell) => c.itemId;
export const itemLabel = (c: RawCell) => c.itemName;

/** Kumaş kırılımı — karnenin `byItem` tablosu ve KK1 oran koşulu bu tek üreticiden okur. */
export function qualityByItem(cells: RawCell[], topCode: string | null): ScorecardBreakdownRow[] {
  return buildBreakdown(cells, itemKey, itemLabel, topCode);
}

/** "1. kalite" rolündeki kalite kodu; rol atanmamışsa null (oran ölçülemez). */
export async function firstQualityCode(): Promise<string | null> {
  const roles = await loadQualityRoles(prisma);
  return roles.find(QualityGradeRole.FIRST)?.code ?? null;
}
