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
import { resolveBeamLotFilter, rollsOfBeamsSql, type BeamLotFilterInput } from "../helpers/warp-beam-roll-filter.helper";
import { factoryDaySql } from "../../constants/time";
import { K18_DEAD_STATUSES } from "../batch.service";
import {
  UNGRADED_CODE, UNGRADED_LABEL, buildBreakdown, cellGradeCode, collectPeriod, itemKey, itemLabel, pctOf, qualityByItem, round1,
  type RawCell, type ScorecardBreakdownRow,
} from "../helpers/quality-first-share.helper";

export type { ScorecardBreakdownRow };

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
  beamInput: BeamLotFilterInput = {},
): Promise<QualityScorecard> {
  // Levent/lot ekseni (R5b-b): top → CONSUMED.rollId; süzgeç yoksa parça boş, sorgular bayt bayt eski.
  const beamFilter = await resolveBeamLotFilter(prisma, beamInput);
  const beamSql = rollsOfBeamsSql(beamFilter);
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
    collectPeriod(range, beamSql),
    compareRange ? collectPeriod(compareRange, beamSql) : Promise.resolve<RawCell[]>([]),
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
        ${beamSql}
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
  const colorKey = (c: RawCell) => c.colorId ?? "__NOCOLOR__";
  const colorLabel = (c: RawCell) => c.colorName ?? "Renksiz / Ham";
  // Fason boyutu ÜÇ kovalıdır ve üçüncüsü sessizliği kırmak için var (bkz.
  // `collectPeriod` içindeki JOIN notu): firması çözülemeyen bir fason dönüşü
  // "Fabrika içi"ne yazılamaz — atfı bilmemek ile fabrikaya yazmak farklı şeyler.
  const subKey = (c: RawCell) => c.subId ?? (c.fromSubcontractor ? "__SUB_UNKNOWN__" : "__INHOUSE__");
  const subLabel = (c: RawCell) =>
    c.subName ?? (c.fromSubcontractor ? "Fason (firma belirsiz)" : "Fabrika içi");

  const byItem = qualityByItem(cells, topCode);
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
