// =============================================================================
// DEFTER DAMGASI — olay anını yazar verir, varlık başına KESİN ARTAN
// =============================================================================
// Prisma'nın `@default(now())`ı ms'lik istemci saatidir: aynı tx'te art arda yazılan iki satır aynı
// ms'e düşer ve okuyucunun `(createdAt, id)` sırası rastgele UUID'e kalır. Damga DB saatidir, ms'ye
// YUKARI yuvarlanır (Date ms taşır; aşağı kesmek µs'lik komşunun önüne düşürebilirdi) ve varlığın son
// satırından en az 1 ms sonradır. Tek çağrının satırları aynı anı paylaşır (tek eylem).
// Damga SQL'i YALNIZ bu dosyada yaşar (`test_defter_damgasi_kaynagi`). Top durum defterini aynı algoritmayla
// DB tetikleyicisi damgalar (`20260926170000_roll_status_event_sira`).
// =============================================================================

import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

/** İş emri hareket defteri (`work_order_events`) — iş emri başına. */
export async function workOrderEventStampTx(tx: Tx, workOrderIds: string[]): Promise<Date> {
  const rows = await tx.$queryRaw<Array<{ at: Date }>>`
    SELECT GREATEST(
      to_timestamp(ceil(extract(epoch FROM clock_timestamp()) * 1000) / 1000), -- tz-ok: timestamptz, tx başı değil ŞU AN
      (SELECT max("createdAt") + interval '1 millisecond' FROM work_order_events WHERE "workOrderId" = ANY(${workOrderIds}::uuid[]))
    ) AS at`;
  return rows[0]!.at;
}

/** Depo/stok hareket defteri (`warehouse_movements`) — top başına. */
export async function warehouseMovementStampTx(tx: Tx, rollIds: string[]): Promise<Date> {
  const rows = await tx.$queryRaw<Array<{ at: Date }>>`
    SELECT GREATEST(
      to_timestamp(ceil(extract(epoch FROM clock_timestamp()) * 1000) / 1000), -- tz-ok: timestamptz, tx başı değil ŞU AN
      (SELECT max("createdAt") + interval '1 millisecond' FROM warehouse_movements WHERE "rollId" = ANY(${rollIds}::uuid[]))
    ) AS at`;
  return rows[0]!.at;
}

/** Kartela olay defteri (`swatch_events`) — kartela başına; tek ifadenin satırları farklı kartelalardır. */
export async function swatchEventStampTx(tx: Tx, swatchIds: string[]): Promise<Date> {
  const rows = await tx.$queryRaw<Array<{ at: Date }>>`
    SELECT GREATEST(
      to_timestamp(ceil(extract(epoch FROM clock_timestamp()) * 1000) / 1000), -- tz-ok: timestamptz, tx başı değil ŞU AN
      (SELECT max("createdAt") + interval '1 millisecond' FROM swatch_events WHERE "swatchId" = ANY(${swatchIds}::uuid[]))
    ) AS at`;
  return rows[0]!.at;
}

/** Levent defteri (`warp_beam_events`) — levent başına; doff damgası (`readDbNow`) ile aynı DB saati. */
export async function warpBeamEventStampTx(tx: Tx, beamId: string): Promise<Date> {
  const rows = await tx.$queryRaw<Array<{ at: Date }>>`
    SELECT GREATEST(
      to_timestamp(ceil(extract(epoch FROM clock_timestamp()) * 1000) / 1000), -- tz-ok: timestamptz, doff damgasıyla aynı DB saati; tx başı değil ŞU AN
      (SELECT max("createdAt") + interval '1 millisecond' FROM warp_beam_events WHERE "beamId" = ${beamId}::uuid)
    ) AS at`;
  return rows[0]!.at;
}

/** Fabrika saat dilimi dönem defteri (`factory_timezone_periods`) — defter tek varlıktır (kurulum); aynı `validFrom`da son satır kazanır. */
export async function factoryTimezonePeriodStampTx(tx: Tx): Promise<Date> {
  const rows = await tx.$queryRaw<Array<{ at: Date }>>`
    SELECT GREATEST(
      to_timestamp(ceil(extract(epoch FROM clock_timestamp()) * 1000) / 1000), -- tz-ok: timestamptz, tx başı değil ŞU AN
      (SELECT max("createdAt") + interval '1 millisecond' FROM factory_timezone_periods)
    ) AS at`;
  return rows[0]!.at;
}
