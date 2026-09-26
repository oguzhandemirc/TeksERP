// =============================================================================
// DEFTER DAMGASI — olay anını yazar verir, varlık başına KESİN ARTAN
// =============================================================================
// Prisma'nın `@default(now())`ı ms'lik istemci saatidir: aynı tx'te art arda yazılan iki satır aynı
// ms'e düşer ve okuyucunun `(createdAt, id)` sırası rastgele UUID'e kalır. Damga DB saatidir, ms'ye
// YUKARI yuvarlanır (Date ms taşır; aşağı kesmek µs'lik komşunun önüne düşürebilirdi) ve varlığın son
// satırından en az 1 ms sonradır. Tek çağrının satırları aynı anı paylaşır (tek eylem).
// Emsal: `swatch-event.helper` · `warp-beam-event.helper` `eventStampTx`.
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
