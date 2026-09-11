// =============================================================================
// FASON KARNESİ — sorgu katmanı (ham SQL). Hesap `subcontract-scorecard-calc.helper.ts`,
// sözleşme ve birleştirme `reports/subcontract-scorecard.report.service.ts`.
// =============================================================================

import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import type { DateRange } from "../reports/_shared";

/** Dönemde sevk edilmiş, iptal edilmemiş her sevk kalemi — tek satır. */
export interface ScorecardItemRow {
  subId: string;
  subName: string;
  dispatchedQty: number;
  returnedQty: number | null;
  returnAdjQty: number | null;
  firstReceivedAt: Date | null;
  hasFull: boolean | null;
  remainderClosed: boolean;
  directShipClosed: boolean;
  wholeDelivered: boolean;
  splitDeliveredQty: number | null;
  dispatchedAt: Date;
}

/** Dönemden bağımsız AÇIK sevk + yaş satırı. */
export interface OldestOpenRow {
  dispatchId: string;
  dispatchNo: string;
  subcontractorName: string;
  dispatchedAt: Date;
  daysOpen: number;
  openItems: bigint;
  openQty: number | null;
}

/**
 * Kalem başına giden/dönen/teslim tek sorguda toplanır, firma kırılımı JS'te.
 *
 * ⚠️ `receivedAt` en ERKEN kabul satırından alınır (süre hesabı için); metraj
 * ise TÜM satırların toplamıdır. İkisi ayrı sorulardır ve tek agregasyonda
 * karıştırılırsa ya süre ya metraj yanlış çıkar.
 */
export function queryScorecardItems(range: DateRange): Promise<ScorecardItemRow[]> {
  return prisma.$queryRaw<ScorecardItemRow[]>(Prisma.sql`
    SELECT
      sub.id   AS "subId",
      sub.name AS "subName",
      sdi."dispatchedQty"::float AS "dispatchedQty",
      ret.qty                    AS "returnedQty",
      adj."netQty"               AS "returnAdjQty",
      ret."firstReceivedAt"      AS "firstReceivedAt",
      ret."hasFull"              AS "hasFull",
      (sdi."remainderClosedAt" IS NOT NULL) AS "remainderClosed",
      -- Kapanış yüklemi OUTSTANDING_ITEM'ın ikizi (fason-open-dispatch.helper.ts):
      -- topu doğrudan sevk edilmiş kalem dönmeyecektir.
      (sd."directShippedAt" IS NOT NULL OR r."directShipmentId" IS NOT NULL) AS "directShipClosed",
      -- Metre ATFI ise bu sevkin DSK'sına bağlanır: aynı top ardışık fasonda başka
      -- sevkten çıkmışsa o metre bu kalemin teslimi değildir.
      (sd."directShippedAt" IS NOT NULL OR EXISTS (
        SELECT 1 FROM direct_shipments ds
        WHERE ds.id = r."directShipmentId" AND ds."dispatchId" = sd.id
      )) AS "wholeDelivered",
      dlv.qty                    AS "splitDeliveredQty",
      sd."dispatchedAt"          AS "dispatchedAt"
    FROM subcontractor_dispatch_items sdi
    JOIN subcontractor_dispatches sd ON sd.id = sdi."dispatchId"
    JOIN subcontractors sub          ON sub.id = sd."subcontractorId"
    JOIN rolls r                     ON r.id = sdi."rollId"
    LEFT JOIN LATERAL (
      -- Kısmi doğrudan sevkin bölünme çocukları: sevk kalemi DEĞİLLER, kalem topunun
      -- çocuğu olarak doğarlar. initialQty = kesilen sevk metresi (değişmez snapshot).
      SELECT SUM(c."initialQty")::float AS qty
      FROM rolls c
      JOIN direct_shipments ds ON ds.id = c."directShipmentId"
      WHERE c."parentRollId" = sdi."rollId"
        AND ds."dispatchId" = sd.id
    ) dlv ON true
    LEFT JOIN LATERAL (
      SELECT
        -- DÖNEN METRAJ = KABUL DEFTERİ (2026-08-19, kısmi teslimat). receivedQty
        -- makbuz satırının kabul ettiği metrajdır; eski (NULL) satırlarda topun
        -- son metrajına düşülür — tüketim anında currentQty = kabul edilen kalan
        -- olduğundan iki rejim aynı sayıyı verir. Eski initialQty kaynağı YANLIŞTI:
        -- giden metrajın kendisini "döndü" sayıyor, fire HEP %0 çıkıyordu.
        SUM(COALESCE(sri."receivedQty", nr."currentQty"))::float AS qty,
        MIN(sr."receivedAt")        AS "firstReceivedAt",
        -- Kalem ancak TAM (isPartial=false) bir makbuz satırıyla kapanır;
        -- kısmi satırlar kalemi AÇIK bırakır (kalan hâlâ fasonda).
        BOOL_OR(NOT sri."isPartial") AS "hasFull"
      FROM subcontractor_receipt_items sri
      JOIN subcontractor_receipts sr ON sr.id = sri."receiptId"
      JOIN rolls nr                  ON nr.id = sri."newRollId"
      WHERE sri."sourceDispatchItemId" = sdi.id
        AND sr."cancelledAt" IS NULL
    ) ret ON true
    LEFT JOIN LATERAL (
      -- ÇEKME DÜZELTMESİ (2026-08-21). ret.qty fasonun hesabından DÜŞÜLEN
      -- metrajdır; fiziksel olarak GELEN metraj değildir. TAM kabulde defter
      -- satırı kalanın kendisidir, yani ret.qty = giden ve fark HEP 0 çıkıyordu
      -- (canlı kopyada doğrulandı: her firmada fire %0). Gerçek dönen metraj
      -- defter + sapma defterindeki çekme/fazla satırlarıdır.
      --
      -- İşaret: SCRAP eksi (metre gitti), OVERAGE artı (fazla döndü).
      -- reversedAt IS NULL — iptal edilmiş makbuzun sapması hayalet fire olur.
      SELECT SUM(CASE WHEN rv.kind = 'SCRAP' THEN -rv.qty ELSE rv.qty END)::float AS "netQty"
      FROM roll_variances rv
      WHERE rv."rollId" = sdi."rollId"
        AND rv.source = 'SUBCONTRACTOR_RETURN'
        AND rv."workOrderStepId" = sd."stepId"
        AND rv."reversedAt" IS NULL
    ) adj ON true
    WHERE sd."dispatchedAt" >= ${range.from}
      AND sd."dispatchedAt" <= ${range.to}
      AND sd."cancelledAt" IS NULL
  `);
}

/**
 * AÇIK sevkler + yaş (en eski 25). Yaş MUTLAK penceredir (iki an arası fark),
 * takvim günü DEĞİL → saat diliminden bağımsızdır ve çıplak now() doğrudur.
 */
export function queryOldestOpenDispatches(): Promise<OldestOpenRow[]> {
  return prisma.$queryRaw<OldestOpenRow[]>(Prisma.sql`
    SELECT
      sd.id            AS "dispatchId",
      sd."dispatchNo"  AS "dispatchNo",
      sub.name         AS "subcontractorName",
      sd."dispatchedAt" AS "dispatchedAt",
      -- tz-ok: iki an arasındaki MUTLAK fark (kaç gündür açık); takvim günü
      -- sorusu değil, bu yüzden fabrika saat dilimine kesilmez.
      EXTRACT(EPOCH FROM (now() - sd."dispatchedAt")) / 86400.0 AS "daysOpen",
      COUNT(*)                          AS "openItems",
      -- Açık bakiye = giden − kısmen dönen − müşteriye kesilen (kısmi teslimat /
      -- kısmi doğrudan sevk sonrası fasonda gerçekten bekleyen metraj).
      SUM(sdi."dispatchedQty" - COALESCE(pret.qty, 0) - COALESCE(dlv.qty, 0))::float AS "openQty"
    FROM subcontractor_dispatch_items sdi
    JOIN subcontractor_dispatches sd ON sd.id = sdi."dispatchId"
    JOIN subcontractors sub          ON sub.id = sd."subcontractorId"
    JOIN rolls r                     ON r.id = sdi."rollId"
    LEFT JOIN LATERAL (
      SELECT SUM(sri."receivedQty") AS qty
      FROM subcontractor_receipt_items sri
      JOIN subcontractor_receipts sr ON sr.id = sri."receiptId"
      WHERE sri."sourceDispatchItemId" = sdi.id
        AND sr."cancelledAt" IS NULL AND sri."isPartial"
    ) pret ON true
    LEFT JOIN LATERAL (
      SELECT SUM(c."initialQty") AS qty
      FROM rolls c
      JOIN direct_shipments ds ON ds.id = c."directShipmentId"
      WHERE c."parentRollId" = sdi."rollId" AND ds."dispatchId" = sd.id
    ) dlv ON true
    WHERE sd."cancelledAt" IS NULL
      AND sd."directShippedAt" IS NULL
      -- Kalan-kapama kalemi kapatır (fire deftere yazıldı, artık açık değil).
      AND sdi."remainderClosedAt" IS NULL
      -- Topu alt kümeyle doğrudan sevk edilen kalem dönmeyecek (OUTSTANDING_ITEM ikizi).
      AND r."directShipmentId" IS NULL
      AND NOT EXISTS (
        -- Kalem yalnız TAM (isPartial=false) makbuz satırıyla kapanır; kısmi
        -- satır kalemi AÇIK bırakır (kalan hâlâ fasonda).
        SELECT 1 FROM subcontractor_receipt_items sri
        JOIN subcontractor_receipts sr ON sr.id = sri."receiptId"
        WHERE sri."sourceDispatchItemId" = sdi.id AND sr."cancelledAt" IS NULL
          AND NOT sri."isPartial"
      )
    GROUP BY sd.id, sd."dispatchNo", sub.name, sd."dispatchedAt"
    ORDER BY sd."dispatchedAt" ASC
    LIMIT 25
  `);
}
