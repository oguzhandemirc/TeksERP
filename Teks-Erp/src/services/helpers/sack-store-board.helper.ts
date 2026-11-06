// =============================================================================
// SEVK KAPISI BOARD'U — sayfa toplamları + cari kilidi TEK sorguda (D4-I4)
// =============================================================================
// Board eskiden iki `groupBy` (çuval · top) atıyordu; kilit çipi üçüncü okuma olmasın diye ikisi ve kilit
// lateral'i tek SQL'e katlandı (board sorgu sayısı 5 → 4; `test_sevk_kapisi_cari_kilit` §3 ölçer). Sayılar groupBy
// ile AYNI yüklem: sevkiyata bağlı her çuval / top, statü süzgeci yok (BRÜT).
// Yük birimi (2026-11-06): `sackCount` bütün birimlerdir; araba/dökme ayrıca sayılır ki tablet dökme sevkiyatı
// "1 çuval" diye yazmasın ve çıkarılamayan birime "Çuval Çıkar" önermesin (eski istemci alanları yok sayar).
// Boşalıp çözülen dökme/araba (`dissolvedAt`) sayılmaz — `LIVE_LOAD_UNIT_WHERE` ile aynı yüklem.
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { cariHoldEmanetShipmentColumnSql } from "../system-setting.service";
import { activeHoldFlagsLateralSql, listHoldView, type HoldFlagRow, type ListHoldView } from "./cari-hold.helper";

export interface BoardShipmentTotals extends ListHoldView {
  sackCount: number;
  /** `sackCount` içindeki araba (CART) ve dökme (BULK) birimleri. */
  cartCount: number;
  bulkCount: number;
  /** Canlı arabaların no'ları (sıra sırasıyla) — kart "Araba A-12" yazsın. */
  cartLabels: string[];
  rollCount: number;
  totalKg: number;
  totalQty: number;
}

type Row = { id: string; sack_count: number; cart_count: number; bulk_count: number; cart_labels: string[]; total_kg: string; roll_count: number; total_qty: string; emanet_mode: string | null } & HoldFlagRow;

/** Sayfadaki sevkiyatların çuval/top toplamları + müşterinin kilit görünümü; boş sayfada sorgu atmaz. */
export async function boardTotalsWithHold(shipmentIds: string[]): Promise<Map<string, BoardShipmentTotals>> {
  if (shipmentIds.length === 0) return new Map();
  const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
    SELECT s.id,
           (SELECT COUNT(*)::int FROM sacks k WHERE k."shipmentId" = s.id AND k."dissolvedAt" IS NULL) AS sack_count,
           (SELECT COUNT(*)::int FROM sacks k WHERE k."shipmentId" = s.id AND k."dissolvedAt" IS NULL AND k."unitKind" = 'CART') AS cart_count,
           (SELECT COUNT(*)::int FROM sacks k WHERE k."shipmentId" = s.id AND k."dissolvedAt" IS NULL AND k."unitKind" = 'BULK') AS bulk_count,
           (SELECT COALESCE(array_agg(k."unitLabel" ORDER BY k.seq NULLS LAST, k."unitLabel"), '{}') FROM sacks k WHERE k."shipmentId" = s.id AND k."dissolvedAt" IS NULL AND k."unitKind" = 'CART') AS cart_labels,
           (SELECT COALESCE(SUM(k."weightKg"), 0)::text FROM sacks k WHERE k."shipmentId" = s.id) AS total_kg,
           (SELECT COUNT(*)::int FROM rolls r WHERE r."shipmentId" = s.id) AS roll_count,
           (SELECT COALESCE(SUM(r."currentQty"), 0)::text FROM rolls r WHERE r."shipmentId" = s.id) AS total_qty,
           hold.hold_intake, hold.hold_shipment, hold.hold_invoice,
           ${cariHoldEmanetShipmentColumnSql()} AS emanet_mode
    FROM shipments s
    ${activeHoldFlagsLateralSql(Prisma.sql`s."customerId"`)}
    WHERE s.id = ANY(${shipmentIds}::uuid[])
  `);
  return new Map(
    rows.map((r) => [
      r.id,
      {
        sackCount: r.sack_count,
        cartCount: r.cart_count,
        bulkCount: r.bulk_count,
        cartLabels: r.cart_labels ?? [],
        rollCount: r.roll_count,
        totalKg: Number(r.total_kg),
        totalQty: Number(r.total_qty),
        ...listHoldView(r, r.emanet_mode ?? ""),
      },
    ]),
  );
}
