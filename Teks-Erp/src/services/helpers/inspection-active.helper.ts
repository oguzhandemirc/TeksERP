// Aktif muayene yüklemi — TEK kaynak (emsal `ACTIVE_ALLOCATION`). Revize edilmiş ya da
// iptal edilmiş muayene tarihtir; liste, özet, sevk özeti ve replay bu ikiliden okur.
import type { Prisma } from "@prisma/client";

export const ACTIVE_INSPECTION_WHERE = {
  supersededAt: null,
  voidedAt: null,
} satisfies Prisma.RollInspectionWhereInput;

/** Bellek ikizi — `ACTIVE_INSPECTION_WHERE` ile aynı soru. */
export function isActiveInspection(i: { supersededAt: Date | null; voidedAt: Date | null }): boolean {
  return i.supersededAt === null && i.voidedAt === null;
}
