// Kapanmış top hareketinin yeniden açılması TERS KAYIT mı — altı geri alma yolunun ortak ölçümü.
// Önce geri almadan ÖNCE kapalı satırların fotoğrafı çekilir, sonra aynı satırlar ölçülür:
// kapanış damgası (exitedAt · qtyOut · weightOut · notes) AYNI, satır damgalı, aynı giriş
// alanlarıyla yeni açık satır var. Yerinde null'lama (eski davranış) ilk iddiayı kırar.
import type { Prisma, PrismaClient } from "@prisma/client";

export interface KapaliHareket {
  id: string;
  rollId: string;
  workOrderStepId: string;
  qtyIn: string;
  qtyOut: string | null;
  weightOut: string | null;
  exitedAt: string;
  enteredAt: string;
  notes: string | null;
}

/** Aktif, KAPALI hareketlerin fotoğrafı (Decimal/Date karşılaştırılabilir metne çevrilir). */
export async function kapaliHareketFotografi(
  prisma: PrismaClient,
  where: Prisma.RollMovementWhereInput,
): Promise<KapaliHareket[]> {
  const rows = await prisma.rollMovement.findMany({
    where: { AND: [where, { revokedAt: null, exitedAt: { not: null } }] },
    select: {
      id: true, rollId: true, workOrderStepId: true, qtyIn: true, qtyOut: true,
      weightOut: true, exitedAt: true, enteredAt: true, notes: true,
    },
    orderBy: { id: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    rollId: r.rollId,
    workOrderStepId: r.workOrderStepId,
    qtyIn: r.qtyIn.toString(),
    qtyOut: r.qtyOut?.toString() ?? null,
    weightOut: r.weightOut?.toString() ?? null,
    exitedAt: r.exitedAt!.toISOString(),
    enteredAt: r.enteredAt.toISOString(),
    notes: r.notes,
  }));
}

/** [etiket, geçti, ayrıntı] üçlüleri — çağıran bekçi kendi `check`ine besler. */
export async function tersKayitIddialari(
  prisma: PrismaClient,
  onceki: KapaliHareket[],
  beklenenSebep: string,
): Promise<Array<[string, boolean, string]>> {
  const out: Array<[string, boolean, string]> = [];
  out.push(["kapalı hareket fotoğrafı BOŞ DEĞİL (ölçüm gerçekten bir satıra bakıyor)", onceki.length > 0, `${onceki.length} satır`]);
  for (const o of onceki) {
    const simdi = await prisma.rollMovement.findUnique({ where: { id: o.id } });
    const ayni = !!simdi
      && simdi.exitedAt?.toISOString() === o.exitedAt
      && (simdi.qtyOut?.toString() ?? null) === o.qtyOut
      && (simdi.weightOut?.toString() ?? null) === o.weightOut
      && simdi.notes === o.notes;
    out.push(["kapanış damgası (exitedAt · qtyOut · weightOut · notes) geri almadan sonra AYNI", ayni,
      simdi ? `exitedAt=${simdi.exitedAt?.toISOString() ?? "NULL"} qtyOut=${simdi.qtyOut ?? "NULL"} notes=${simdi.notes ?? "NULL"}` : "satır YOK"]);
    out.push([`kapalı satır ters kayıtla damgalı (revokeReason=${beklenenSebep})`,
      !!simdi?.revokedAt && simdi.revokeReason === beklenenSebep,
      `revokedAt=${simdi?.revokedAt?.toISOString() ?? "NULL"} revokeReason=${simdi?.revokeReason ?? "NULL"}`]);
    const yeni = await prisma.rollMovement.findMany({
      where: { rollId: o.rollId, workOrderStepId: o.workOrderStepId, revokedAt: null, exitedAt: null, NOT: { id: o.id } },
      select: { qtyIn: true, enteredAt: true },
    });
    const eslesen = yeni.filter((y) => y.qtyIn.toString() === o.qtyIn && y.enteredAt.toISOString() === o.enteredAt);
    out.push(["aynı adımda giriş alanları (qtyIn · enteredAt) aynı TEK yeni açık satır var", eslesen.length === 1 && yeni.length === 1,
      `${yeni.length} açık satır, ${eslesen.length} eşleşen (beklenen qtyIn=${o.qtyIn})`]);
  }
  return out;
}

/** İptal edilen toplar AKTÖRÜYLE mi iptal edildi — `roll_status_events` aktörü bu kolondan okur. */
export async function iptalAktoruIddiasi(
  prisma: PrismaClient,
  rollIds: string[],
  userId: string,
): Promise<[string, boolean, string]> {
  const rows = await prisma.roll.findMany({
    where: { id: { in: rollIds } },
    select: { status: true, cancelledAt: true, cancelledById: true },
  });
  const ok = rows.length === rollIds.length && rollIds.length > 0
    && rows.every((r) => r.status === "CANCELLED" && r.cancelledAt !== null && r.cancelledById === userId);
  return ["iptal edilen top aktörüyle damgalı (cancelledAt + cancelledById)", ok,
    rows.map((r) => `${r.status}/${r.cancelledById === userId ? "aktör✓" : `aktör=${r.cancelledById ?? "NULL"}`}`).join(", ") || "top YOK"];
}
