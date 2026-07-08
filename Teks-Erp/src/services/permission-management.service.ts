// =============================================================================
// TeksERP - Permission Management Service
// =============================================================================
// Direct user → permission grant'larını ve admin UI şablonlarını yönetir.
// Rol yok; her kullanıcının yetkisi UserPermission tablosunda doğrudan tutulur.
// =============================================================================

import prisma from "../lib/prisma";
import { Prisma } from "@prisma/client";
import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { AuthService } from "./auth.service";
import { readLoginMethods } from "./system-setting.service";
import { SessionRegistryService } from "./session-registry.service";

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

/** Ad-soyad normalizasyonu: baş/son boşluk kırp + iç ardışık boşlukları TEK'e indir. */
function normalizeFullName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

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
      // Silinmiş kullanıcılar (deletedAt dolu) listede GÖRÜNMEZ — yalnız veri
      // bütünlüğü/sistem geçmişi için DB'de durur. Pasif (isActive=false, deletedAt
      // null) kayıtlar görünür ki admin aktifleştirebilsin.
      where: { deletedAt: null },
      select: {
        id: true,
        username: true,
        fullName: true,
        isActive: true,
        createdAt: true,
        _count: { select: { permissions: true } },
      },
      orderBy: [{ isActive: "desc" }, { username: "asc" }],
    });
  }

  /**
   * Kullanıcı detayı (Ayak İzi başlığı) — kimlik + yetki sayısı + SON çalışma
   * oturumu (cihaz + yer). Cihaz detayının (DeviceService.detail) analoğu.
   */
  static async getUserById(id: string) {
    const user = await prisma.user.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        username: true,
        fullName: true,
        isActive: true,
        createdAt: true,
        _count: { select: { permissions: true } },
      },
    });
    if (!user) throw AppError.notFound("Kullanıcı bulunamadı");

    // Son oturum açma — [userId, startedAt] index'i sort-free karşılar.
    const lastSession = await prisma.workSession.findFirst({
      where: { userId: id },
      orderBy: { startedAt: "desc" },
      select: {
        id: true,
        startedAt: true,
        endedAt: true,
        endReason: true,
        device: { select: { id: true, name: true, kind: true } },
        machine: { select: { id: true, code: true, name: true } },
        station: { select: { id: true, code: true, name: true, kind: true } },
      },
    });

    return { ...user, lastSession };
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

    // F255: upsert + tokenVersion bump ATOMİK. Bump KOŞULLU — yalnız tarih (veya
    // yeni satır) gerçekten değiştiyse (setUserPermissions kalıbı); idempotent
    // aynı-grant re-login zorlamaz. tx.* seri (Promise.all YOK).
    const created = await prisma.$transaction(async (tx) => {
      const before = await tx.userPermission.findUnique({
        where: { userId_permissionId: { userId, permissionId: input.permissionId } },
        select: { validFrom: true, validUntil: true },
      });
      const row = await tx.userPermission.upsert({
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
      const sameTime = (a: Date | null, b: Date | null) =>
        (a ? a.getTime() : null) === (b ? b.getTime() : null);
      const changed =
        !before ||
        !sameTime(before.validFrom, input.validFrom ?? null) ||
        !sameTime(before.validUntil, input.validUntil ?? null);
      if (changed) {
        await tx.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } });
      }
      return row;
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
  // Toplu set (idempotent): body'deki listeyi hedef state yapar. Eksikler eklenir,
  // fazlalar silinir. Tarih-taşır: her öğe {permissionId, validFrom?, validUntil?}
  // olabilir (ya da düz string — geriye-uyum, tarihler null'a sıfırlanır). Eklenen
  // satırlar tarihleri alır; KALAN mevcut satırların tarihleri de yeni değere
  // güncellenir. Herhangi bir tarih değişimi de tokenVersion++ tetikler (süreli
  // izin uygulanınca issueToken exp'i en yakın validUntil'a çekilsin → oturum
  // süresi bitince otomatik sonlansın).
  // ---------------------------------------------------------------------------
  static async setUserPermissions(
    userId: string,
    permissions: Array<string | GrantInput>,
    actorUserId: string | undefined
  ) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw AppError.notFound("Kullanıcı bulunamadı");

    // Düz string → tarihsiz öğe. Tarih verilmeyen alan null'a çözülür (sıfırlama).
    const items: Required<GrantInput>[] = permissions.map((p) =>
      typeof p === "string"
        ? { permissionId: p, validFrom: null, validUntil: null }
        : { permissionId: p.permissionId, validFrom: p.validFrom ?? null, validUntil: p.validUntil ?? null },
    );
    const permissionIds = items.map((i) => i.permissionId);

    const validPerms = await prisma.permission.findMany({
      where: { id: { in: permissionIds } },
      select: { id: true },
    });
    if (validPerms.length !== permissionIds.length) {
      throw AppError.badRequest("Bir veya daha fazla geçersiz yetki kimliği");
    }

    const existing = await prisma.userPermission.findMany({
      where: { userId },
      select: { id: true, permissionId: true, validFrom: true, validUntil: true },
    });

    const existingByPerm = new Map(existing.map((e) => [e.permissionId, e] as const));
    const target = new Set(permissionIds);
    const toAdd = items.filter((i) => !existingByPerm.has(i.permissionId));
    const toRemove = existing.filter((e) => !target.has(e.permissionId));

    // Kalan (mevcut ∩ hedef) satırlarda tarihi değişenler — update + tokenVersion tetiği.
    const sameTime = (a: Date | null, b: Date | null) =>
      (a ? a.getTime() : null) === (b ? b.getTime() : null);
    const toUpdate = items.filter((i) => {
      const ex = existingByPerm.get(i.permissionId);
      if (!ex) return false;
      return !sameTime(ex.validFrom, i.validFrom) || !sameTime(ex.validUntil, i.validUntil);
    });

    // F253: bulk set admin:users'ı ÇIKARIYORSA (mevcut var, hedef yok) sistemde
    // başka efektif admin kalmasını zorunlu kıl — son admin kendini kilitlemesin.
    const adminPerms = await prisma.permission.findMany({
      where: { code: { in: [...PermissionManagementService.ADMIN_CODES] } },
      select: { id: true },
    });
    const adminPermIds = new Set(adminPerms.map((p) => p.id));
    const currentHasAdmin = existing.some((e) => adminPermIds.has(e.permissionId));
    const targetHasAdmin = permissionIds.some((id) => adminPermIds.has(id));
    if (currentHasAdmin && !targetHasAdmin) {
      await PermissionManagementService.assertAdminCoverageAfterChange(userId, false);
    }

    await prisma.$transaction(async (tx) => {
      if (toRemove.length) {
        await tx.userPermission.deleteMany({
          where: { id: { in: toRemove.map((r) => r.id) } },
        });
      }
      if (toAdd.length) {
        await tx.userPermission.createMany({
          data: toAdd.map((i) => ({
            userId,
            permissionId: i.permissionId,
            validFrom: i.validFrom,
            validUntil: i.validUntil,
            grantedById: actorUserId ?? null,
          })),
        });
      }
      // Kalan satırların tarihlerini yeni değere güncelle (tx.* seri — Promise.all YOK).
      for (const i of toUpdate) {
        await tx.userPermission.updateMany({
          where: { userId, permissionId: i.permissionId },
          data: { validFrom: i.validFrom, validUntil: i.validUntil },
        });
      }
      // Yetki seti VEYA süre değişti → token'ı geçersiz kıl (anında re-login, taze izinler).
      if (toAdd.length || toRemove.length || toUpdate.length) {
        await tx.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } });
      }
    });

    await AuditService.log({
      userId: actorUserId,
      action: "UPDATE",
      tableName: "USER_PERMISSION_SET",
      recordId: userId,
      oldData: { permissionIds: existing.map((e) => e.permissionId) },
      newData: {
        permissions: items.map((i) => ({
          permissionId: i.permissionId,
          validFrom: i.validFrom,
          validUntil: i.validUntil,
        })),
      },
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

    // F253: son admin:users yetkisi revoke ile sökülüp sistem kilitlenmesin.
    if ((PermissionManagementService.ADMIN_CODES as readonly string[]).includes(existing.permission.code)) {
      const now = new Date();
      const otherGrant = await prisma.userPermission.findFirst({
        where: {
          userId,
          permissionId: { not: permissionId },
          ...PermissionManagementService.effectiveAdminWindow(now),
        },
        select: { id: true },
      });
      await PermissionManagementService.assertAdminCoverageAfterChange(userId, !!otherGrant);
    }

    // F255: silme + tokenVersion bump ATOMİK (ikinci yazım düşerse "iptal ANINDA
    // geçerli" invaryantı bozulmasın). Coverage guard tx'ten ÖNCE, audit SONRA.
    await prisma.$transaction([
      prisma.userPermission.delete({ where: { id: existing.id } }),
      prisma.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } }),
    ]);

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
    // Session registry'yi de temizle (tokenVersion ile birlikte — anlık iptalin ikinci
    // katmanı: eski token hem tokenVersion hem revokedAt'ten düşer). Best-effort.
    await SessionRegistryService.revokeAllForUser(userId, "PASSWORD_RESET").catch(
      () => undefined,
    );

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
        fullName: normalizeFullName(input.fullName),
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
    input: { fullName?: string },
    actorUserId: string | undefined
  ) {
    const existing = await prisma.user.findUnique({
      where: { id },
      select: { ...USER_SELECT, deletedAt: true },
    });
    if (!existing) throw AppError.notFound("Kullanıcı bulunamadı");
    // Aktiflik ARTIK burada değişmez — yalnız deactivate/reactivate/delete uçlarından
    // (guard'lar + oturum düşürme + silme-koruması orada). Düzenleme salt fullName.
    // Silinmiş kayıt düzenlenemez (yalnız geçmiş için durur).
    if (existing.deletedAt) throw AppError.badRequest("Silinmiş kullanıcı düzenlenemez");

    const user = await prisma.user.update({
      where: { id },
      data: { ...(input.fullName !== undefined ? { fullName: normalizeFullName(input.fullName) } : {}) },
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

  /** Kullanıcı-yöneticisi izin kodları (admin:users ve wildcard admin:*). */
  private static readonly ADMIN_CODES = ["admin:users", "admin:*"] as const;

  /** getEffectivePermissions ile AYNI zaman penceresi — validFrom geçmiş/boş +
   *  validUntil gelecek/boş olan admin grant'ı. F253/F254 son-admin guard'ları
   *  süresi geçmiş/henüz başlamamış yedek admin grant'ını "aktif" saymamalı. */
  private static effectiveAdminWindow(now: Date): Prisma.UserPermissionWhereInput {
    return {
      permission: { code: { in: [...this.ADMIN_CODES] } },
      AND: [
        { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
        { OR: [{ validUntil: null }, { validUntil: { gte: now } }] },
      ],
    };
  }

  /** F253: Bir admin yetkisi sökülürken (revoke/set) sistemde efektif admin:users
   *  KALMAYACAKSA blokla. willTargetRetainAdmin=true ise hedefte başka efektif admin
   *  grant'ı kaldığından kontrol atlanır. */
  private static async assertAdminCoverageAfterChange(
    targetUserId: string,
    willTargetRetainAdmin: boolean,
  ): Promise<void> {
    if (willTargetRetainAdmin) return;
    const now = new Date();
    const other = await prisma.user.findFirst({
      where: {
        id: { not: targetUserId },
        isActive: true,
        permissions: { some: this.effectiveAdminWindow(now) },
      },
      select: { id: true },
    });
    if (!other) {
      throw AppError.conflict(
        "Son aktif kullanıcı-yöneticisinin (admin:users) yetkisi kaldırılamaz — önce başka bir kullanıcıya admin:users verin.",
      );
    }
  }

  /** Pasifleştirilecek kullanıcı SON aktif admin:users sahibiyse blokla —
   *  kimse kullanıcı yönetimine giremez hale gelmesin. F254: efektif pencere uygulanır. */
  private static async assertNotLastActiveAdmin(targetId: string): Promise<void> {
    const now = new Date();
    const window = this.effectiveAdminWindow(now);
    const targetHasAdmin = await prisma.userPermission.findFirst({
      where: { userId: targetId, ...window },
      select: { id: true },
    });
    if (!targetHasAdmin) return;
    const otherActiveAdmin = await prisma.user.findFirst({
      where: {
        id: { not: targetId },
        isActive: true,
        permissions: { some: window },
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
  /**
   * GEÇİCİ PASİFE ALMA — geri alınabilir (reactivateUser ile aktifleştirilir).
   * Username ve kimlikler KORUNUR (kullanıcı aynı kimlikle geri dönebilir).
   * Silme (deleteUser) ile KARIŞTIRMA: pasif ≠ silinmiş.
   */
  static async deactivateUser(id: string, actorUserId: string | undefined) {
    const existing = await prisma.user.findUnique({
      where: { id },
      select: { id: true, isActive: true, deletedAt: true },
    });
    if (!existing) throw AppError.notFound("Kullanıcı bulunamadı");
    if (existing.deletedAt) throw AppError.badRequest("Bu kullanıcı silinmiş — pasife alınamaz");

    this.assertNotSelfDeactivation(id, actorUserId);
    await this.assertNotLastActiveAdmin(id);

    const user = await prisma.user.update({
      where: { id },
      // tokenVersion++ → açık oturumları düşür (pasif kullanıcı çalışmaya devam etmesin).
      data: { isActive: false, tokenVersion: { increment: 1 } },
      select: USER_SELECT,
    });
    await SessionRegistryService.revokeAllForUser(id, "DEACTIVATED").catch(
      () => undefined,
    );

    await AuditService.log({
      userId: actorUserId, action: "UPDATE", tableName: "users", recordId: id,
      oldData: { isActive: existing.isActive }, newData: { isActive: false, reason: "deactivated" },
    });

    return user;
  }

  /** Pasif kullanıcıyı yeniden AKTİFLEŞTİR — yalnız SİLİNMEMİŞ kayıtlarda. */
  static async reactivateUser(id: string, actorUserId: string | undefined) {
    const existing = await prisma.user.findUnique({
      where: { id },
      select: { id: true, isActive: true, deletedAt: true },
    });
    if (!existing) throw AppError.notFound("Kullanıcı bulunamadı");
    if (existing.deletedAt) throw AppError.badRequest("Silinmiş kullanıcı geri getirilemez");
    if (existing.isActive) throw AppError.badRequest("Kullanıcı zaten aktif");

    const user = await prisma.user.update({
      where: { id }, data: { isActive: true }, select: USER_SELECT,
    });
    await AuditService.log({
      userId: actorUserId, action: "UPDATE", tableName: "users", recordId: id,
      oldData: { isActive: false }, newData: { isActive: true, reason: "reactivated" },
    });
    return user;
  }

  /**
   * KALICI SİLME — GERİ ALINAMAZ. Kayıt fiziksel DURUR (veri bütünlüğü/geçmiş:
   * eski loglar/atıflar bozulmasın) ama: deletedAt damgalanır (listeden gizlenir,
   * aktifleştirilemez), username SERBEST bırakılır (del_ ön-ek → aynı isim tekrar
   * açılabilir), kimlikler (quickPin/cardToken) temizlenir, oturumlar düşürülür.
   */
  static async deleteUser(id: string, actorUserId: string | undefined) {
    const existing = await prisma.user.findUnique({
      where: { id },
      select: { id: true, username: true, isActive: true, deletedAt: true },
    });
    if (!existing) throw AppError.notFound("Kullanıcı bulunamadı");
    if (existing.deletedAt) return existing; // idempotent — zaten silinmiş

    if (actorUserId === id) throw AppError.badRequest("Kendi hesabınızı silemezsiniz");
    await this.assertNotLastActiveAdmin(id);

    const freedUsername = `del_${randomBytes(3).toString("hex")}_${existing.username}`.slice(0, 50);
    const user = await prisma.user.update({
      where: { id },
      data: {
        isActive: false,
        deletedAt: new Date(),
        username: freedUsername,
        quickPin: null,
        cardToken: null,
        tokenVersion: { increment: 1 },
      },
      select: USER_SELECT,
    });
    await SessionRegistryService.revokeAllForUser(id, "DELETED").catch(
      () => undefined,
    );

    await AuditService.log({
      userId: actorUserId, action: "DELETE", tableName: "users", recordId: id,
      oldData: { username: existing.username, isActive: existing.isActive },
      newData: { deleted: true, username: freedUsername },
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

  /** F257: yetki kimlikleri var mı doğrula + dedup — geçersiz/mükerrer id P2003/P2002
   *  (generic hata) yerine net 400 döner, şablon bayat/eksik yazılmaz. */
  private static async validatePermissionIds(ids: string[]): Promise<string[]> {
    const unique = [...new Set(ids)];
    const found = await prisma.permission.findMany({
      where: { id: { in: unique } },
      select: { id: true },
    });
    if (found.length !== unique.length) {
      throw AppError.badRequest("Bir veya daha fazla geçersiz yetki kimliği");
    }
    return unique;
  }

  static async createTemplate(
    input: { name: string; description?: string | null; permissionIds: string[] },
    actorUserId: string | undefined
  ) {
    if (!input.permissionIds.length) {
      throw AppError.badRequest("Şablon en az bir yetki içermeli");
    }
    const permissionIds = await this.validatePermissionIds(input.permissionIds);

    const created = await prisma.permissionTemplate.create({
      data: {
        name: input.name,
        description: input.description ?? null,
        permissions: {
          create: permissionIds.map((permissionId) => ({ permissionId })),
        },
      },
      include: { permissions: { include: { permission: true } } },
    });

    await AuditService.log({
      userId: actorUserId,
      action: "CREATE",
      tableName: "PERMISSION_TEMPLATE",
      recordId: created.id,
      newData: { name: created.name, permissionIds },
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

    // F257: tx'ten ÖNCE doğrula + dedup (geçersiz id → 400, mükerrer → @@unique P2002 önlenir).
    const validatedIds = input.permissionIds
      ? await this.validatePermissionIds(input.permissionIds)
      : undefined;

    const updated = await prisma.$transaction(async (tx) => {
      const data: Prisma.PermissionTemplateUpdateInput = {};
      if (input.name !== undefined) data.name = input.name;
      if (input.description !== undefined) data.description = input.description;

      const t = await tx.permissionTemplate.update({ where: { id }, data });

      if (validatedIds) {
        await tx.permissionTemplateItem.deleteMany({ where: { templateId: id } });
        if (validatedIds.length) {
          await tx.permissionTemplateItem.createMany({
            data: validatedIds.map((permissionId) => ({ templateId: id, permissionId })),
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
      // İzin EKLENDİ → uçuştaki token'ı geçersiz kıl (grant/revoke/set ile AYNI
      // invariant: "izin değişince tokenVersion++"). Merge dalı bunu atlıyordu →
      // eklenen izinler token dolana/re-login'e kadar etkisiz kalıyordu. Atomik.
      await prisma.$transaction([
        prisma.userPermission.createMany({
          data: toAdd.map((permissionId) => ({
            userId,
            permissionId,
            grantedById: actorUserId ?? null,
          })),
        }),
        prisma.user.update({
          where: { id: userId },
          data: { tokenVersion: { increment: 1 } },
        }),
      ]);
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
