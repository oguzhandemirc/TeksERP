// =============================================================================
// EMANET ÇIKIŞ — SAHİP SEÇİCİ (`GET /api/consignment-dispatches/owners`, T1 tablet)
// =============================================================================
// Depo tableti malın sahibini seçer; müşteri kartını (adres/telefon/vergi no) okumaz — en az yetki.
// Yalnız emaneti olan (sahipli levent ya da lot taşıyan) müşteriler, yalnız `{id, code, name}`; tavan sorguda.
// Pasif müşteri de listelenir (malı onundur); oluştur çözücüsü de yalnız varlığı sorar.
// =============================================================================
import prisma from "../../lib/prisma";
import { escapeLikeTerm } from "../../utils/like-escape";

export const OWNER_DEFAULT_LIMIT = 50;
export const OWNER_MAX_LIMIT = 100;

export interface ConsignmentOwnerOption { id: string; code: string; name: string }
export interface ConsignmentOwners { owners: ConsignmentOwnerOption[]; truncated: boolean }

export async function listConsignmentOwners(q: { search?: string; limit: number }): Promise<ConsignmentOwners> {
  const term = q.search ? escapeLikeTerm(q.search) : null;
  const rows = await prisma.customer.findMany({
    where: {
      OR: [{ ownedWarpBeams: { some: {} } }, { ownedYarnLots: { some: {} } }],
      ...(term ? { AND: [{ OR: [{ name: { contains: term, mode: "insensitive" } }, { code: { contains: term, mode: "insensitive" } }] }] } : {}),
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: q.limit + 1,
    select: { id: true, code: true, name: true },
  });
  return { owners: rows.slice(0, q.limit), truncated: rows.length > q.limit };
}
