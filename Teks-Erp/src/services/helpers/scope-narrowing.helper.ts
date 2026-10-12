// Ayarla açılan yetki kapsamı daraltmaları (B5/B6). Bayrak kapalıyken bugünkü
// geniş kapsam aynen sürer; açıkken dar izinli aktör yalnız kendi kaydına dokunur.
import type { NextFunction, Request, Response } from "express";
import prisma from "../../lib/prisma";
import { matchesPermission, RBAC_DENIED_CODE } from "../../middlewares/rbac.middleware";
import { AppError } from "../../utils/app-error";
import { readSupportOwnTicketsOnlyEnabled, readWorkOrderQuickOwnOnlyEnabled } from "../system-setting.service";

/**
 * `workorder:write` taşımayan (yalnız `mobile:hizli-is-emri`) aktör, bayrak açıkken
 * yalnız kendi başlattığı iş emrinde yazma ucuna geçer; aksi 403 PERMISSION_DENIED.
 * İş emri yoksa sessiz geçer — 404'ü uç kendisi verir.
 */
export async function requireQuickWorkOrderOwnership(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const user = req.user;
    if (!user || matchesPermission(user.permissions, "workorder:write")) return next();
    if (!(await readWorkOrderQuickOwnOnlyEnabled())) return next();
    const id = String(req.params.id ?? "");
    const wo = /^[0-9a-f-]{36}$/i.test(id)
      ? await prisma.workOrder.findUnique({ where: { id }, select: { createdById: true } })
      : null;
    if (!wo || wo.createdById === user.userId) return next();
    next(AppError.forbidden("Bu iş emrini siz başlatmadınız — düzenlemek için 'workorder:write' yetkisi gerekli.", {
      code: RBAC_DENIED_CODE,
      required: "workorder:write",
    }));
  } catch (err) {
    next(err);
  }
}

/** Destek talebi okuma kapsamı: bayrak açıkken `admin:settings` taşımayan aktör yalnız kendininkini görür. */
export async function supportTicketOwnerScope(user: { userId: string; permissions: readonly string[] }): Promise<string | undefined> {
  if (matchesPermission(user.permissions, "admin:settings")) return undefined;
  return (await readSupportOwnTicketsOnlyEnabled()) ? user.userId : undefined;
}
