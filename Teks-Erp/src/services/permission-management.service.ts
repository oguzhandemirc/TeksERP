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
import { AuthService } from "./auth.service";
import { readLoginMethods } from "./system-setting.service";

/**
 * Yeni kullanıcının varsayılan olarak aldığı üretim istasyon izinleri (opt-out'lu).
 * Tabletler yalnız bu üç istasyonda olduğundan yeni operatör KK1↔KK2↔Tambur arası
 * serbest rotasyon yapabilir; depo/sevkiyat/fason gibi yetkiler bilinçli eklenir.
 * (Beyin fırtınası kararı — "kayıt olan istasyon yetkilerini alsın".)
 */
export const DEFAULT_OPERATOR_PERMISSION_CODES = [
  "mobile:kk1",
  "mobile:kk2-kursun",
  "mobile:tambur",
] as const;

type GrantInput = {
  permissionId: string;
  validFrom?: Date | null;
  validUntil?: Date | null;
};

// Admin UI'ya dönen kullanıcı alanları (passwordHash asla sızmaz).
const USER_SELECT = {
  id: true,
  username: true,
  fullName: true,
  isActive: true,
  createdAt: true,
} as const;

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

    // Yetki değişti → uçuştaki token'ı geçersiz kıl (anında re-login, taze izinler).
    await prisma.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } });

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
      // Yetki seti değişti → token'ı geçersiz kıl (anında re-login, taze izinler).
      if (toAdd.length || toRemove.length) {
        await tx.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } });
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

    // Yetki kaldırıldı → token'ı geçersiz kıl (iptal ANINDA geçerli).
    await prisma.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } });

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
    // Şifre sıfırlandı → mevcut tüm oturumları düşür (tokenVersion bump).
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash, tokenVersion: { increment: 1 } },
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
  // Kullanıcı CRUD (oluştur / güncelle / pasife al) — eskiden admin.routes
  // handler'ı içinde inline'dı (Routes→Services katman atlama). Tek sahip burası.
  // ---------------------------------------------------------------------------
  static async createUser(
    input: {
      username: string;
      fullName: string;
      password: string;
      isActive?: boolean;
      /** Varsayılan üretim istasyon izinlerini (KK1/KK2/Tambur) ver. Default TRUE —
       *  saha operatörü tabletle çalışabilsin diye. Yalnız web/admin kullanıcısı
       *  açarken false geçilir (temiz başlar). */
      grantOperatorDefaults?: boolean;
      /** Mobil giriş için otomatik hızlı-PIN + QR kart üret (default = grantOperatorDefaults).
       *  Oluşturma-sonrası "kimlik kartı" modalı bunları gösterir. */
      generateMobileCredentials?: boolean;
    },
    actorUserId: string | undefined
  ) {
    const exists = await prisma.user.findUnique({
      where: { username: input.username },
      select: { id: true },
    });
    if (exists) throw AppError.conflict("Bu kullanıcı adı zaten kullanılıyor");

    // Varsayılan üretim izinlerinin permission ID'leri (verilecekse) — kullanıcı
    // create'iyle aynı tx'te bağlanır ki "yarım kullanıcı" (izinsiz) kalmasın.
    const grantDefaults = input.grantOperatorDefaults ?? true;
    const defaultPerms = grantDefaults
      ? await prisma.permission.findMany({
          where: { code: { in: [...DEFAULT_OPERATOR_PERMISSION_CODES] } },
          select: { id: true, code: true },
        })
      : [];

    const passwordHash = await bcrypt.hash(input.password, 10);
    const user = await prisma.user.create({
      data: {
        username: input.username,
        fullName: input.fullName,
        passwordHash,
        isActive: input.isActive ?? true,
        ...(defaultPerms.length
          ? {
              permissions: {
                create: defaultPerms.map((p) => ({
                  permissionId: p.id,
                  grantedById: actorUserId ?? null,
                })),
              },
            }
          : {}),
      },
      select: USER_SELECT,
    });

    await AuditService.log({
      userId: actorUserId,
      action: "CREATE",
      tableName: "users",
      recordId: user.id,
      newData: {
        username: user.username,
        fullName: user.fullName,
        isActive: user.isActive,
        defaultPermissions: defaultPerms.map((p) => p.code),
      },
    });

    // Mobil kimlik: yalnız ETKİN giriş yöntemlerinin kimliği üretilir ("ne aktifse
    // onu üret" — pin etkin→hızlı PIN, card etkin→QR kart; ikisi de kapalıysa hiç).
    // User create'inden AYRI — quickPin @unique çakışması create'i düşürmesin
    // (P2002 retry AuthService'te). generateMobileCredentials=false → web kullanıcısı.
    const genCreds = input.generateMobileCredentials ?? grantDefaults;
    if (genCreds) {
      const methods = await readLoginMethods();
      if (methods.enabled.includes("pin")) {
        await AuthService.setQuickPin(user.id, {}, actorUserId).catch(() => undefined);
      }
      if (methods.enabled.includes("card")) {
        await AuthService.rotateCardToken(user.id, actorUserId).catch(() => undefined);
      }
    }

    return user;
  }

  static async updateUser(
    id: string,
    input: { fullName?: string; isActive?: boolean },
    actorUserId: string | undefined
  ) {
    const existing = await prisma.user.findUnique({
      where: { id },
      select: USER_SELECT,
    });
    if (!existing) throw AppError.notFound("Kullanıcı bulunamadı");

    // M-32: self-deactivation guard'ı SERVİSTE (tek kaynak) — eskiden yalnız
    // DELETE route'undaydı; Electron edit formu PATCH isActive:false ile bu
    // yoldan geçiyor ve tek admin:users kullanıcısı kendini kilitleyebiliyordu
    // (kurtarma DB müdahalesi).
    if (input.isActive === false) {
      this.assertNotSelfDeactivation(id, actorUserId);
      await this.assertNotLastActiveAdmin(id);
    }

    const user = await prisma.user.update({
      where: { id },
      data: input,
      select: USER_SELECT,
    });

    await AuditService.log({
      userId: actorUserId,
      action: "UPDATE",
      tableName: "users",
      recordId: id,
      oldData: { fullName: existing.fullName, isActive: existing.isActive },
      newData: input,
    });

    return user;
  }

  private static assertNotSelfDeactivation(
    targetId: string,
    actorUserId: string | undefined
  ): void {
    if (actorUserId && actorUserId === targetId) {
      throw AppError.badRequest("Kendi hesabınızı pasife alamazsınız");
    }
  }

  /** Pasifleştirilecek kullanıcı SON aktif admin:users sahibiyse blokla —
   *  kimse kullanıcı yönetimine giremez hale gelmesin. */
  private static async assertNotLastActiveAdmin(targetId: string): Promise<void> {
    const targetHasAdmin = await prisma.userPermission.findFirst({
      where: {
        userId: targetId,
        permission: { code: { in: ["admin:users", "admin:*"] } },
      },
      select: { id: true },
    });
    if (!targetHasAdmin) return;
    const otherActiveAdmin = await prisma.user.findFirst({
      where: {
        id: { not: targetId },
        isActive: true,
        permissions: {
          some: { permission: { code: { in: ["admin:users", "admin:*"] } } },
        },
      },
      select: { id: true },
    });
    if (!otherActiveAdmin) {
      throw AppError.conflict(
        "Bu kullanıcı son aktif kullanıcı-yöneticisi (admin:users) — pasife alınamaz. Önce başka bir yöneticiye yetki verin."
      );
    }
  }

  /** Soft delete (isActive=false). Self-deactivation + son-admin guard'ları serviste. */
  static async deactivateUser(id: string, actorUserId: string | undefined) {
    const existing = await prisma.user.findUnique({
      where: { id },
      select: { id: true, isActive: true },
    });
    if (!existing) throw AppError.notFound("Kullanıcı bulunamadı");

    this.assertNotSelfDeactivation(id, actorUserId);
    await this.assertNotLastActiveAdmin(id);

    const user = await prisma.user.update({
      where: { id },
      data: { isActive: false },
      select: USER_SELECT,
    });

    await AuditService.log({
      userId: actorUserId,
      action: "DELETE",
      tableName: "users",
      recordId: id,
      oldData: { isActive: existing.isActive },
      newData: { isActive: false },
    });

    return user;
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
