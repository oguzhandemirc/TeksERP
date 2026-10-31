// =============================================================================
// CARİ KİLİDİ ROZETİ — müşteri kimlikleri → liste kilit görünümü (D4-I3)
// =============================================================================
// Panel listeleri (Cariler, İçerideki İşler, Sevke Hazır İşler) satır başına sorgu atmasın diye sayfadaki TÜM
// müşteri kimlikleri TEK SQL'de çözülür. Yüklem `activeHoldFlagsLateralSql` (cari-hold.helper; kart hesabı + eski
// fason bacağı), metin `listHoldView` — tablet çipiyle aynı kaynak; istemci metin üretmez.
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { cariHoldEmanetShipmentColumnSql } from "../system-setting.service";
import { activeHoldFlagsLateralSql, listHoldView, type HoldFlagRow, type ListHoldView } from "./cari-hold.helper";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Kilitli müşterilerin görünümü; kilitsiz müşteri haritada YOK. Boş girdide sorgu atmaz. */
export async function holdViewsByCustomer(customerIds: ReadonlyArray<string | null | undefined>): Promise<Map<string, ListHoldView>> {
  const ids = [...new Set(customerIds.filter((id): id is string => !!id && UUID_RE.test(id)))];
  if (ids.length === 0) return new Map();
  const rows = await prisma.$queryRaw<Array<{ id: string; emanet_mode: string | null } & HoldFlagRow>>(Prisma.sql`
    SELECT x.id::text AS id, hold.hold_intake, hold.hold_shipment, hold.hold_invoice,
           ${cariHoldEmanetShipmentColumnSql()} AS emanet_mode
    FROM unnest(${ids}::uuid[]) AS x(id)
    ${activeHoldFlagsLateralSql(Prisma.sql`x.id`)}
  `);
  const out = new Map<string, ListHoldView>();
  for (const r of rows) {
    const view = listHoldView(r, r.emanet_mode ?? "");
    if (view.held) out.set(r.id, view);
  }
  return out;
}

/** Kilitsiz satırın görünümü — yanıt şekli her satırda aynı kalsın. */
export const NO_HOLD_VIEW: ListHoldView = { held: false, holdScopes: [], holdText: null };

/** Cariler listesi yanıtının satırlarına `cariHold` ekler (offset ya da cursor yanıtı; şekil korunur). */
export async function withCustomerHolds<T extends { data: unknown }>(res: T): Promise<T> {
  const rows = res.data as Array<{ id: string }>;
  const holds = await holdViewsByCustomer(rows.map((r) => r.id));
  return { ...res, data: rows.map((r) => ({ ...r, cariHold: holds.get(r.id) ?? NO_HOLD_VIEW })) };
}

/** Sevke Hazır İşler satırlarına birincil müşterinin rozeti (`customerHold`) — sayfa başına tek sorgu. */
export async function withCustomerHoldRows<T extends { customerId: string | null }>(rows: T[]): Promise<Array<T & { customerHold: ListHoldView }>> {
  const holds = await holdViewsByCustomer(rows.map((r) => r.customerId));
  return rows.map((r) => ({ ...r, customerHold: (r.customerId && holds.get(r.customerId)) || NO_HOLD_VIEW }));
}
