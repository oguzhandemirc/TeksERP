// İPLİK LİF BİLEŞİMİ — düzenleme ucu (K7): `PUT /api/items/:id/fibers` gövdesi listenin TAMAMIDIR (replace).
// Doğrulama + yazma tek yazardan (`item-fiber.helper`); kartın son değiştireni de aynı tx'te yazılır (künye).
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { requireActorId } from "./base.service";
import { fibersAuditPayload, parseItemFibers, writeItemFibersTx } from "./helpers/item-fiber.helper";

export async function replaceItemFibers(itemId: string, raw: unknown, userId: string | undefined) {
  const actorId = requireActorId(userId, "Lif bileşimi");
  const item = await prisma.item.findUnique({ where: { id: itemId }, select: { id: true, itemType: true } });
  if (!item) throw AppError.notFound("Ürün bulunamadı.");
  if (item.itemType !== "YARN") throw AppError.badRequest("Lif bileşimi yalnız İPLİK kartına girilir.", { code: "ITEM_FIBER_YARN_ONLY" });
  const rows = (await parseItemFibers(prisma, raw ?? null, { itemType: item.itemType, itemId })) ?? [];
  const fibers = await prisma.$transaction(async (tx) => {
    await writeItemFibersTx(tx, itemId, rows);
    await tx.item.update({ where: { id: itemId }, data: { updatedById: actorId }, select: { id: true } });
    return tx.itemFiber.findMany({
      where: { itemId },
      select: { fiberTypeId: true, pct: true, fiberType: { select: { id: true, name: true, abbreviation: true } } },
      orderBy: { pct: "desc" },
    });
  });
  await AuditService.log({ userId: actorId, action: "UPDATE", tableName: "ITEM", recordId: itemId, newData: { fibers: fibersAuditPayload(rows) } });
  return fibers;
}
