// Bayi kapsamı: oturumun bayisi ve "kendi" kaydı. Başkasınınki "bulunamadı"dır (var olduğu sızmaz).
import type { Hak, Kurulum, Musteri, Tesis } from "@prisma/client";
import { notFoundError } from "../lib/errors";
import type { Db } from "../lib/prisma";
import type { PortalRequestContext } from "./portal-http";

export function dealerOf(c: PortalRequestContext): string {
  const id = c.session.user.bayiId;
  // Oturum kapısı BAYI rolünü bayisiz geçirmez (DB CHECK de); savunma: bayisiz oturum hiçbir şey görmez.
  if (!id) throw notFoundError("Bayi");
  return id;
}

export async function ownedCustomer(db: Db, dealerId: string, id: string): Promise<Musteri> {
  const row = await db.musteri.findFirst({ where: { id, bayiId: dealerId } });
  if (!row) throw notFoundError("Müşteri");
  return row;
}

export async function ownedSite(db: Db, dealerId: string, id: string): Promise<Tesis> {
  const row = await db.tesis.findFirst({ where: { id, musteri: { bayiId: dealerId } } });
  if (!row) throw notFoundError("Tesis");
  return row;
}

export async function ownedInstallation(db: Db, dealerId: string, id: string): Promise<Kurulum> {
  const row = await db.kurulum.findFirst({ where: { id, tesis: { musteri: { bayiId: dealerId } } } });
  if (!row) throw notFoundError("Kurulum");
  return row;
}

export async function ownedEntitlement(db: Db, dealerId: string, id: string): Promise<Hak> {
  const row = await db.hak.findFirst({ where: { id, kurulum: { tesis: { musteri: { bayiId: dealerId } } } } });
  if (!row) throw notFoundError("Hak");
  return row;
}

export const withPath = (body: object, id: string) => ({ ...body, _yol: id });
