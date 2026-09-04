import prisma from "../src/lib/prisma";
import { protectSystemAccountTarget } from "../src/middlewares/system-account.middleware";
import { AppError } from "../src/utils/app-error";
import type { Request, Response, NextFunction } from "express";

const cagir = (id: string, metod: string, kendisi: boolean): Promise<unknown> =>
  new Promise((res) => {
    const req = { params: { id }, method: metod, isSystemAccount: kendisi,
      user: { userId: "x" }, originalUrl: `/api/admin/users/${id}/reset-password` } as unknown as Request;
    void protectSystemAccountTarget(req, {} as Response, ((e?: unknown) => res(e)) as NextFunction);
  });
const d = (e: unknown) => (e instanceof AppError ? `${e.statusCode} ${e.message}` : e ? `HATA` : "GEÇTİ");

(async () => {
  const sis = await prisma.user.findFirst({ where: { isSystemAccount: true }, select: { id: true } });
  const nor = await prisma.user.findFirst({ where: { isSystemAccount: false }, select: { id: true } });
  if (!sis || !nor) { console.log("  fixture yok — ölçüm yapılamadı"); await prisma.$disconnect(); return; }
  console.log("  en yetkili + POST   + başkası :", d(await cagir(sis.id, "POST", false)));
  console.log("  en yetkili + DELETE + başkası :", d(await cagir(sis.id, "DELETE", false)));
  console.log("  en yetkili + GET    + başkası :", d(await cagir(sis.id, "GET", false)), "  <- görünürlük");
  console.log("  en yetkili + POST   + KENDİSİ :", d(await cagir(sis.id, "POST", true)), "  <- kendini yönetir");
  console.log("  NORMAL     + POST   + başkası :", d(await cagir(nor.id, "POST", false)), "  <- regresyon yok");
  await prisma.$disconnect();
})();
