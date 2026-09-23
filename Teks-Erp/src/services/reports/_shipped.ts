// =============================================================================
// "DÖNEMDE SEVK EDİLEN METRAJ" — TEK TANIM
// =============================================================================
// İade Karnesi'nin PAYDASI ile Sevk & Termin Karnesi'nin BAŞLIK METRİĞİ aynı
// sorudur. İki serviste ayrı ayrı yazılsalardı kaçınılmaz olarak ayrışırlardı
// (biri doğrudan sevkleri unutur, diğeri iade geri-eklemesini) ve aynı ay için
// iki farklı sevk rakamı dolaşıma girerdi. Tanım burada, tek yerde yaşar.
//
// ── BRÜT KURALI — kök CLAUDE.md'nin beşinci tüketicisi ──────────────────────
// İade, topun `shipmentId`'sini NULL'lar (`return.service.ts:322-325`) → canlı
// sorgu NET okur. `RollReturn` satırları `fromShipmentId` ile GERİ EKLENİR.
// Kaynak `RollReturn`'dür, snapshot DEĞİL — `attachTotals`, `accounting-export`,
// `getShipmentById` ve `collectShipmentDocContent` de aynı kaynağı seçti.
//
// ⚠️ İade satırları KENDİ spec snapshot'larını taşır (`RollReturn.itemId` /
// `colorId` / `width`) ve kırılım onlardan okunur — topun BUGÜNKÜ kumaşından
// değil. Top iadeden sonra kesilmiş/düzeltilmiş olabilir; sevk anındaki kimlik
// snapshot'takidir. (Bu alanların şemadaki yorumu da tam bunu söylüyor:
// "top sonradan Tambur'da kesilse bile rapor sağlam kalsın".)
//
// ── DOĞRUDAN SEVKLER DE DAHİL ──────────────────────────────────────────────
// `DirectShipment` ayrı tablodur, tarih kolonu bile farklıdır (`shippedAt`).
// Unutulması kolay ve unutulunca sevk rakamı sessizce küçülür.
//
// ── YÖN (R1, 2026-09-23) ───────────────────────────────────────────────────
// Her hücre sevkiyatın DONMUŞ yönünü taşır (`Shipment.destination`); doğrudan sevkin
// yön kaydı yoktur → `null` ("yön kaydı yok"), yön süzgecinde hiçbir kümeye girmez.
// KG ayrı toplayıcıdadır (`collectShippedWeight`): kg ÇUVALA aittir, topa bölünmez.
// =============================================================================

import prisma from "../../lib/prisma";
import { Prisma, type ShipmentDestination } from "@prisma/client";
import type { DateRange } from "./_shared";
import { shipmentDestinationSql } from "./_destination";
import { directShipmentsMatchDestinationFilter } from "../helpers/direct-shipment-destination.helper";

/** Sevk toplayıcılarının süzgeci — yön sevkiyatın donmuş değeridir. */
export interface ShippedFilter {
  destination?: ShipmentDestination;
}

export interface ShippedCell {
  customerId: string;
  customerName: string;
  itemId: string | null;
  itemName: string | null;
  colorId: string | null;
  colorName: string | null;
  /** Sevk anında donmuş yön; `null` = yön kaydı yok (fasondan doğrudan sevk). */
  destination: ShipmentDestination | null;
  rollCount: number;
  qty: number;
}

/**
 * Dönemde sevk edilen BRÜT metrajın müşteri × kumaş × renk hücreleri.
 * Üç kaynak UNION ALL ile birleşir: canlı sevk satırları · iade geri-eklemesi ·
 * doğrudan sevkler.
 */
export async function collectShipped(range: DateRange, f: ShippedFilter = {}): Promise<ShippedCell[]> {
  // Yön süzgeci aktifken doğrudan sevk (yön kaydı yok) hiçbir kümeye girmez.
  const withDirect = directShipmentsMatchDestinationFilter(f.destination);
  const rows = await prisma.$queryRaw<
    Array<{
      customerId: string;
      customerName: string;
      itemId: string | null;
      itemName: string | null;
      colorId: string | null;
      colorName: string | null;
      destination: ShipmentDestination | null;
      rollCount: bigint;
      qty: number | null;
    }>
  >(Prisma.sql`
    WITH disp AS (
      SELECT id, "customerId", destination FROM shipments
      -- ⚠️ status süzgeci İKİNCİ SAVUNMA HATTIDIR ve bekçi onun kaybını
      -- GÖREMEZ (ölçüldü: kaldırıldığında test yeşil kalıyor). Sebep: storno
      -- (undoDispatch) dispatchedAt'i NULL'lar, yani PLANNED bir sevkiyatın
      -- tarihi zaten olmaz ve alttaki aralık süzgeci onu eler. Süzgeç bu
      -- invariant'a GÜVENMEMEK için duruyor — silmeden önce onu kimin
      -- koruduğunu bil.
      WHERE status = 'DISPATCHED'
        AND "dispatchedAt" >= ${range.from} AND "dispatchedAt" <= ${range.to}
        ${shipmentDestinationSql(f.destination, "shipments")}
    ),
    parts AS (
      -- 1) Sevkiyatta DURAN toplar (iade sonrası eksilmiş canlı küme)
      SELECT d."customerId", d.destination, r."itemId", r."colorId", 1::int AS cnt, r."currentQty" AS qty
      FROM rolls r JOIN disp d ON d.id = r."shipmentId"
      UNION ALL
      -- 2) İADE GERİ-EKLEMESİ — spec snapshot'ı iadenin KENDİ satırından okunur
      SELECT d."customerId", d.destination, rr."itemId", rr."colorId", 1::int, rr.qty
      FROM roll_returns rr JOIN disp d ON d.id = rr."fromShipmentId"
      WHERE rr."cancelledAt" IS NULL
      ${withDirect ? Prisma.sql`UNION ALL
      -- 3a) Doğrudan sevklerin KUMAŞ KIRILIMI — bağlı toplardan.
      SELECT ds."customerId", NULL::"ShipmentDestination", r."itemId", r."colorId", 1::int, r."currentQty"
      FROM direct_shipments ds JOIN rolls r ON r."directShipmentId" = ds.id
      WHERE ds."shippedAt" >= ${range.from} AND ds."shippedAt" <= ${range.to}
      UNION ALL
      -- 3b) MUTABAKAT SATIRI: doğrudan sevkin metrajı DENORMALİZE totalQty'dir
      -- ve Sevkiyatlar ekranı (listShipments.mapDirect) onu kullanır. Bağlı
      -- topların toplamı ondan sapabilir (top sonradan kesilmiş olabilir, ya da
      -- hiç bağ kurulmamış olabilir). Farkı kumaşı BİLİNMEYEN bir satır olarak
      -- eklemek iki şeyi birden sağlar: TOPLAM Sevkiyatlar ekranıyla birebir
      -- kalır, ve kırılım uydurma bir kumaşa yazılmaz. Fark sıfırsa satır doğmaz.
      SELECT ds."customerId", NULL::"ShipmentDestination", NULL::uuid, NULL::uuid, 0::int,
             ds."totalQty" - COALESCE((
               SELECT SUM(r2."currentQty") FROM rolls r2 WHERE r2."directShipmentId" = ds.id
             ), 0)
      FROM direct_shipments ds
      WHERE ds."shippedAt" >= ${range.from} AND ds."shippedAt" <= ${range.to}
        AND ds."totalQty" <> COALESCE((
              SELECT SUM(r2."currentQty") FROM rolls r2 WHERE r2."directShipmentId" = ds.id
            ), 0)` : Prisma.empty}
    )
    SELECT
      p."customerId" AS "customerId",
      cu.name        AS "customerName",
      p."itemId"     AS "itemId",
      i.name         AS "itemName",
      p."colorId"    AS "colorId",
      c.name         AS "colorName",
      p.destination  AS "destination",
      SUM(p.cnt)     AS "rollCount",
      SUM(p.qty)::float AS "qty"
    FROM parts p
    JOIN customers cu   ON cu.id = p."customerId"
    LEFT JOIN items i   ON i.id  = p."itemId"
    LEFT JOIN colors c  ON c.id  = p."colorId"
    GROUP BY p."customerId", cu.name, p."itemId", i.name, p."colorId", c.name, p.destination
  `);

  return rows.map((r) => ({
    customerId: r.customerId,
    customerName: r.customerName,
    itemId: r.itemId,
    itemName: r.itemName,
    colorId: r.colorId,
    colorName: r.colorName,
    destination: r.destination,
    rollCount: Number(r.rollCount),
    qty: Number(r.qty ?? 0),
  }));
}

/** Yalnız toplam gerekiyorsa (İade Karnesi paydası) — aynı tanımdan türetilir. */
export async function shippedGrossTotal(range: DateRange, f: ShippedFilter = {}): Promise<number> {
  const cells = await collectShipped(range, f);
  return cells.reduce((a, c) => a + c.qty, 0);
}

export interface ShippedWeightCell {
  customerId: string;
  destination: ShipmentDestination;
  /** Tartılı çuvalların brüt (dara dahil) toplamı — tartısız çuval 0 SAYILMAZ, dışarıda kalır. */
  kg: number;
  weighedSacks: number;
  totalSacks: number;
}

/**
 * Dönemde sevk edilen çuvalların BRÜT kg'ı (dara dahil, sevk anındaki tartı), müşteri × yön.
 * Kapsam her hücrede: "tartılı N / M çuval" — tartısız çuval "ölçülmedi"dir, 0 değil.
 * Kısmi iadede kg DÜŞÜLMEZ: kg sevk anındaki brüt çuval ağırlığıdır, iade kg'ı ayrıca ölçülmez.
 * Doğrudan sevkte çuval yok ⇒ kg hiç ölçülmez, bu toplayıcıya girmez.
 */
export async function collectShippedWeight(range: DateRange, f: ShippedFilter = {}): Promise<ShippedWeightCell[]> {
  const rows = await prisma.$queryRaw<
    Array<{ customerId: string; destination: ShipmentDestination; kg: number | null; weighed: bigint; total: bigint }>
  >(Prisma.sql`
    SELECT s."customerId" AS "customerId", s.destination AS destination,
           COALESCE(SUM(k."weightKg") FILTER (WHERE k."weightKg" > 0), 0)::float AS kg,
           COUNT(*) FILTER (WHERE k."weightKg" > 0) AS weighed,
           COUNT(*) AS total
    FROM shipments s JOIN sacks k ON k."shipmentId" = s.id
    WHERE s.status = 'DISPATCHED'
      AND s."dispatchedAt" >= ${range.from} AND s."dispatchedAt" <= ${range.to}
      ${shipmentDestinationSql(f.destination, "s")}
    GROUP BY s."customerId", s.destination
  `);
  return rows.map((r) => ({
    customerId: r.customerId,
    destination: r.destination,
    kg: Number(r.kg ?? 0),
    weighedSacks: Number(r.weighed),
    totalSacks: Number(r.total),
  }));
}
