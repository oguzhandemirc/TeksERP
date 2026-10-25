// Aktif muayene yüklemi — TEK kaynak (emsal `ACTIVE_ALLOCATION`). Revize edilmiş ya da
// iptal edilmiş muayene tarihtir; liste, özet, sevk özeti ve replay bu ikiliden okur.
import { Prisma } from "@prisma/client";

export const ACTIVE_INSPECTION_WHERE = {
  supersededAt: null,
  voidedAt: null,
} satisfies Prisma.RollInspectionWhereInput;

/** Bellek ikizi — `ACTIVE_INSPECTION_WHERE` ile aynı soru. */
export function isActiveInspection(i: { supersededAt: Date | null; voidedAt: Date | null }): boolean {
  return i.supersededAt === null && i.voidedAt === null;
}

/** Ham SQL ikizi (rapor küpü) — `ri` takmalı `roll_inspections` üstünde aynı soru. */
export const ACTIVE_INSPECTION_SQL = Prisma.sql`ri."supersededAt" IS NULL AND ri."voidedAt" IS NULL`;

/** Topun bu aşamadaki aktif muayenesi — yazma ucu (409 kapısı) ve önizleme (tablet "zaten var" uyarısı) aynı sorudan okur. */
export function findActiveInspection(db: Pick<Prisma.TransactionClient, "rollInspection">, rollId: string, phase: "RAW" | "FINAL") {
  return db.rollInspection.findFirst({ where: { rollId, phase, ...ACTIVE_INSPECTION_WHERE }, select: { id: true, phase: true, revision: true } });
}
