// =============================================================================
// TeksERP - Permission Management Service
// =============================================================================
// Direct user → permission grant'larını ve admin UI şablonlarını yönetir.
// Rol yok; her kullanıcının yetkisi UserPermission tablosunda doğrudan tutulur.
// =============================================================================

import prisma from "../lib/prisma";
import { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";

type GrantInput = {
  permissionId: string;
  validFrom?: Date | null;
  validUntil?: Date | null;
};

export class PermissionManagementService {
  // ---------------------------------------------------------------------------
  // Yetki kataloğu — admin UI grid'i için
  // ---------------------------------------------------------------------------
  static async listPermissions() {
    return prisma.permission.findMany({
      orderBy: [{ category: "asc" }, { module: "asc" }, { code: "asc" }],
    });
  }

  // ---------------------------------------------------------------------------
  // Kullanıcı listesi (admin paneli için minimal alanlar)
  // ---------------------------------------------------------------------------
  static async listUsers() {
    return prisma.user.findMany({
      select: {
        id: true,
        username: true,
        fullName: true,
        isActive: true,
        createdAt: true,
        _count: { select: { permissions: true } },
      },
      orderBy: { username: "asc" },
    });
  }

  // ---------------------------------------------------------------------------
  // Bir kullanıcının direct grant'ları
  // ---------------------------------------------------------------------------
  static async getUserPermissions(userId: string) {
    const exists = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!exists) throw AppError.notFound("Kullanıcı bulunamadı");

    return prisma.userPermission.findMany({
      where: { userId },
      include: { permission: true },
      orderBy: { permission: { code: "asc" } },
    });
  }

  // ---------------------------------------------------------------------------
  // Tek yetki ekle (validFrom/validUntil opsiyonel)
  // ---------------------------------------------------------------------------
  static async grantPermission(
    userId: string,
    input: GrantInput,
    actorUserId: string | undefined
  ) {
    const [user, permission] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { id: true } }),
      prisma.permission.findUnique({ where: { id: input.permissionId }, select: { id: true, code: true } }),
    ]);
    if (!user) throw AppError.notFound("Kullanıcı bulunamadı");
    if (!permission) throw AppError.notFound("Yetki bulunamadı");

    const created = await prisma.userPermission.upsert({
      where: { userId_permissionId: { userId, permissionId: input.permissionId } },
      create: {
        userId,
        permissionId: input.permissionId,
        validFrom: input.validFrom ?? null,
        validUntil: input.validUntil ?? null,
        grantedById: actorUserId ?? null,
      },
      update: {
        validFrom: input.validFrom ?? null,
        validUntil: input.validUntil ?? null,
        grantedById: actorUserId ?? null,
      },
      include: { permission: true },
    });

    await AuditService.log({
      userId: actorUserId,
      action: "CREATE",
      tableName: "USER_PERMISSION",
      recordId: created.id,
      newData: {
        userId,
        permissionCode: permission.code,
        validFrom: input.validFrom,
        validUntil: input.validUntil,
      },
    });

    return created;
  }

  // ---------------------------------------------------------------------------
  // Toplu set (idempotent): body'deki permissionIds listesini hedef state yapar.
  // Eksikler eklenir, fazlalar silinir. validFrom/validUntil sıfırlanır.
  // ---------------------------------------------------------------------------
  static async setUserPermissions(
    userId: string,
    permissionIds: string[],
    actorUserId: string | undefined
  ) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw AppError.notFound("Kullanıcı bulunamadı");

    const validPerms = await prisma.permission.findMany({
      where: { id: { in: permissionIds } },
      select: { id: true },
    });
    if (validPerms.length !== permissionIds.length) {
      throw AppError.badRequest("Bir veya daha fazla geçersiz yetki kimliği");
    }

    const existing = await prisma.userPermission.findMany({
      where: { userId },
      select: { id: true, permissionId: true },
    });

    const existingIds = new Set(existing.map((e) => e.permissionId));
    const target = new Set(permissionIds);
    const toAdd = permissionIds.filter((id) => !existingIds.has(id));
    const toRemove = existing.filter((e) => !target.has(e.permissionId));

    await prisma.$transaction(async (tx) => {
      if (toRemove.length) {
        await tx.userPermission.deleteMany({
          where: { id: { in: toRemove.map((r) => r.id) } },
        });
      }
      if (toAdd.length) {
        await tx.userPermission.createMany({
          data: toAdd.map((permissionId) => ({
            userId,
            permissionId,
            grantedById: actorUserId ?? null,
          })),
        });
      }
    });

    await AuditService.log({
      userId: actorUserId,
      action: "UPDATE",
      tableName: "USER_PERMISSION_SET",
      recordId: userId,
      oldData: { permissionIds: existing.map((e) => e.permissionId) },
      newData: { permissionIds },
    });

    return this.getUserPermissions(userId);
  }

  // ---------------------------------------------------------------------------
  // Tek yetki kaldır
  // ---------------------------------------------------------------------------
  static async revokePermission(
    userId: string,
    permissionId: string,
    actorUserId: string | undefined
  ) {
    const existing = await prisma.userPermission.findUnique({
      where: { userId_permissionId: { userId, permissionId } },
      include: { permission: { select: { code: true } } },
    });
    if (!existing) throw AppError.notFound("Yetki ataması bulunamadı");

    await prisma.userPermission.delete({ where: { id: existing.id } });

    await AuditService.log({
      userId: actorUserId,
      action: "DELETE",
      tableName: "USER_PERMISSION",
      recordId: existing.id,
      oldData: { userId, permissionCode: existing.permission.code },
    });
  }

  // ---------------------------------------------------------------------------
  // Admin şifre sıfırlama — eski şifre sorulmaz
  // ---------------------------------------------------------------------------
  static async resetUserPassword(
    userId: string,
    newPassword: string,
    actorUserId: string | undefined
  ) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true },
    });
    if (!user) throw AppError.notFound("Kullanıcı bulunamadı");
    if (newPassword.length < 6) {
      throw AppError.badRequest("Şifre en az 6 karakter olmalı");
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });

    await AuditService.log({
      userId: actorUserId,
      action: "UPDATE",
      tableName: "USER_PASSWORD",
      recordId: userId,
      newData: { username: user.username, resetByAdmin: true },
    });
  }

  // ---------------------------------------------------------------------------
  // Şablon (admin UI kısayolu) — runtime'da User'a bağlı değil
  // ---------------------------------------------------------------------------
  static async listTemplates() {
    return prisma.permissionTemplate.findMany({
      include: { permissions: { include: { permission: true } } },
      orderBy: { name: "asc" },
    });
  }

  static async getTemplate(id: string) {
    const t = await prisma.permissionTemplate.findUnique({
      where: { id },
      include: { permissions: { include: { permission: true } } },
    });
    if (!t) throw AppError.notFound("Şablon bulunamadı");
    return t;
  }

  static async createTemplate(
    input: { name: string; description?: string | null; permissionIds: string[] },
    actorUserId: string | undefined
  ) {
    if (!input.permissionIds.length) {
      throw AppError.badRequest("Şablon en az bir yetki içermeli");
    }

    const created = await prisma.permissionTemplate.create({
      data: {
        name: input.name,
        description: input.description ?? null,
        permissions: {
          create: input.permissionIds.map((permissionId) => ({ permissionId })),
        },
      },
      include: { permissions: { include: { permission: true } } },
    });

    await AuditService.log({
      userId: actorUserId,
      action: "CREATE",
      tableName: "PERMISSION_TEMPLATE",
      recordId: created.id,
      newData: { name: created.name, permissionIds: input.permissionIds },
    });

    return created;
  }

  static async updateTemplate(
    id: string,
    input: { name?: string; description?: string | null; permissionIds?: string[] },
    actorUserId: string | undefined
  ) {
    const existing = await prisma.permissionTemplate.findUnique({
      where: { id },
      include: { permissions: true },
    });
    if (!existing) throw AppError.notFound("Şablon bulunamadı");

    const updated = await prisma.$transaction(async (tx) => {
      const data: Prisma.PermissionTemplateUpdateInput = {};
      if (input.name !== undefined) data.name = input.name;
      if (input.description !== undefined) data.description = input.description;

      const t = await tx.permissionTemplate.update({ where: { id }, data });

      if (input.permissionIds) {
        await tx.permissionTemplateItem.deleteMany({ where: { templateId: id } });
        if (input.permissionIds.length) {
          await tx.permissionTemplateItem.createMany({
            data: input.permissionIds.map((permissionId) => ({ templateId: id, permissionId })),
          });
        }
      }

      return t;
    });

    await AuditService.log({
      userId: actorUserId,
      action: "UPDATE",
      tableName: "PERMISSION_TEMPLATE",
      recordId: id,
      oldData: {
        name: existing.name,
        permissionIds: existing.permissions.map((p) => p.permissionId),
      },
      newData: input,
    });

    return this.getTemplate(updated.id);
  }

  static async deleteTemplate(id: string, actorUserId: string | undefined) {
    const existing = await prisma.permissionTemplate.findUnique({ where: { id } });
    if (!existing) throw AppError.notFound("Şablon bulunamadı");

    await prisma.permissionTemplate.delete({ where: { id } });

    await AuditService.log({
      userId: actorUserId,
      action: "DELETE",
      tableName: "PERMISSION_TEMPLATE",
      recordId: id,
      oldData: { name: existing.name },
    });
  }

  // ---------------------------------------------------------------------------
  // Şablonu kullanıcıya uygula — UserPermission'a kopyalar (link kalmaz).
  // mode="merge"   : mevcut yetkilere ekler (varsa atlar)
  // mode="replace" : kullanıcının tüm yetkilerini şablon ile değiştirir
  // ---------------------------------------------------------------------------
  static async applyTemplate(
    userId: string,
    templateId: string,
    mode: "merge" | "replace",
    actorUserId: string | undefined
  ) {
    const [user, template] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { id: true } }),
      prisma.permissionTemplate.findUnique({
        where: { id: templateId },
        include: { permissions: true },
      }),
    ]);
    if (!user) throw AppError.notFound("Kullanıcı bulunamadı");
    if (!template) throw AppError.notFound("Şablon bulunamadı");

    const templatePermIds = template.permissions.map((p) => p.permissionId);

    if (mode === "replace") {
      return this.setUserPermissions(userId, templatePermIds, actorUserId);
    }

    // merge: eksik olanları ekle
    const existing = await prisma.userPermission.findMany({
      where: { userId },
      select: { permissionId: true },
    });
    const existingIds = new Set(existing.map((e) => e.permissionId));
    const toAdd = templatePermIds.filter((id) => !existingIds.has(id));

    if (toAdd.length) {
      await prisma.userPermission.createMany({
        data: toAdd.map((permissionId) => ({
          userId,
          permissionId,
          grantedById: actorUserId ?? null,
        })),
      });
    }

    await AuditService.log({
      userId: actorUserId,
      action: "UPDATE",
      tableName: "USER_PERMISSION_SET",
      recordId: userId,
      newData: { appliedTemplateId: templateId, mode, addedPermissionIds: toAdd },
    });

    return this.getUserPermissions(userId);
  }
}
