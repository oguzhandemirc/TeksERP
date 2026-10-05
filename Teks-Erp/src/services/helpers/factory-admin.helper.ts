// =============================================================================
// "Fabrikanın kendi yöneticisi var mı" — TEK yüklem
// =============================================================================
// Ölçüt: kullanıcı yönetme izni (`admin:users` ya da
// `admin:*`) geçerlilik penceresinde olan en az bir AKTİF, silinmemiş fabrika hesabı;
// satıcı (sistem) hesabı sayılmaz. `/auth/me` ve fabrika yöneticisi açma ucu bunu okur.
// İzin penceresi son-admin guard'larıyla ortak: `effectiveUserAdminGrantWhere`.
// =============================================================================

import type { Prisma, PrismaClient } from "@prisma/client";
import prisma from "../../lib/prisma";

/** Kullanıcı yönetme izni sayılan kodlar (düz kod + alan joker'i). */
export const USER_ADMIN_CODES = ["admin:users", "admin:*"] as const;

/** `getEffectivePermissions` ile aynı pencere: başlamış ve süresi geçmemiş yönetici izni. */
export function effectiveUserAdminGrantWhere(now: Date): Prisma.UserPermissionWhereInput {
  return {
    permission: { code: { in: [...USER_ADMIN_CODES] } },
    AND: [
      { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
      { OR: [{ validUntil: null }, { validUntil: { gte: now } }] },
    ],
  };
}

/** Fabrika yöneticisi sayılan kullanıcı. */
export function factoryAdminWhere(now: Date): Prisma.UserWhereInput {
  return {
    isActive: true,
    deletedAt: null,
    isSystemAccount: false,
    permissions: { some: effectiveUserAdminGrantWhere(now) },
  };
}

type UserReader = Pick<PrismaClient, "user"> | Prisma.TransactionClient;

export async function factoryAdminExists(db: UserReader = prisma, now: Date = new Date()): Promise<boolean> {
  const row = await db.user.findFirst({ where: factoryAdminWhere(now), select: { id: true } });
  return row !== null;
}
