// =============================================================================
// TeksERP - Auth Service
// =============================================================================

import prisma from "../lib/prisma";
import { Prisma, ClientType } from "@prisma/client";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomBytes, randomInt, randomUUID } from "crypto";
import { JwtPayload } from "../types/api.types";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import {
  readSessionDurationHours,
  readLoginMethods,
  readSameTypeSessionPolicy,
} from "./system-setting.service";
import { SessionRegistryService } from "./session-registry.service";

/** Login çağrılarının istemci bağlamı — Session registry + aynı-tip politika için.
 *  clientType body'den (default 'mobile'); deviceId x-device-id/req.device'den;
 *  confirmKick 'notify' politikasında "ikisi de açık kalsın" onayı. */
export interface LoginContext {
  clientType?: "electron" | "mobile";
  deviceId?: string | null;
  confirmKick?: boolean;
}

/** Personel kartı QR içeriği: TEKSU:<userId>:<32-hex token>. Makine QR'ı ham
 *  makine kodu (MAK-...) taşıdığından prefix çakışması yok. */
const CARD_CODE_RE = /^TEKSU:([0-9a-fA-F-]{36}):([0-9a-fA-F]{32})$/;

function loadJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "JWT_SECRET environment variable zorunlu ve en az 32 karakter olmalı. " +
        ".env dosyanızı kontrol edin."
    );
  }
  return secret;
}
const JWT_SECRET: string = loadJwtSecret();

export class AuthService {
  /**
   * Authenticate user and return JWT token.
   * Efektif yetki = UserPermission tablosundan validFrom/validUntil filtreli okuma.
   * Roller yok — yetki kişiye doğrudan atanır.
   */
  static async login(
    username: string,
    password: string,
    ctx?: LoginContext
  ): Promise<{ token: string; user: JwtPayload }> {
    const user = await prisma.user.findUnique({
      where: { username },
      select: {
        id: true,
        username: true,
        passwordHash: true,
        isActive: true,
        tokenVersion: true,
      },
    });

    if (!user || !user.isActive) {
      throw AppError.unauthorized("Geçersiz kullanıcı adı veya şifre");
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      throw AppError.unauthorized("Geçersiz kullanıcı adı veya şifre");
    }

    return this.issueToken(
      { id: user.id, username: user.username, tokenVersion: user.tokenVersion },
      ctx
    );
  }

  /**
   * QR personel kartıyla giriş — YALNIZ auth.loginMethods "card" içerirken
   * (kapalıyken kart altyapısı saldırı yüzeyi açmaz; klasik login HEP açık).
   * Kart içeriği "TEKSU:<userId>:<token>"; token users.cardToken'daki 32-hex sır.
   * Kart kaybolursa admin ROTASYON yapar (yeni token) → eski kart anında ölür.
   */
  static async loginWithCard(
    cardCode: string,
    ctx?: LoginContext
  ): Promise<{ token: string; user: JwtPayload }> {
    const methods = await readLoginMethods();
    if (!methods.enabled.includes("card")) {
      throw AppError.forbidden(
        "Kartla giriş kapalı — Genel Ayarlar'dan giriş yöntemlerine 'QR kart' eklenebilir"
      );
    }
    const m = CARD_CODE_RE.exec((cardCode ?? "").trim());
    if (!m) throw AppError.unauthorized("Geçersiz personel kartı");
    const user = await prisma.user.findFirst({
      where: { id: m[1], cardToken: m[2].toLowerCase(), isActive: true },
      select: { id: true, username: true, tokenVersion: true },
    });
    if (!user) {
      throw AppError.unauthorized("Kart geçersiz veya iptal edilmiş — yöneticiden yeni kart isteyin");
    }
    return this.issueToken(user, ctx);
  }

  /**
   * SALT hızlı-PIN ile giriş — YALNIZ auth.loginMethods "pin" içerirken. Kullanıcı
   * seçme/ID yok: PIN sistem genelinde BENZERSİZ (users.quickPin @unique) olduğundan
   * tek başına kimliği belirler (findUnique). Şifreden AYRI alandır.
   */
  static async loginWithQuickPin(
    pin: string,
    ctx?: LoginContext
  ): Promise<{ token: string; user: JwtPayload }> {
    const methods = await readLoginMethods();
    if (!methods.enabled.includes("pin")) {
      throw AppError.forbidden(
        "Hızlı PIN ile giriş kapalı — Genel Ayarlar'dan giriş yöntemlerine 'Hızlı PIN' eklenebilir"
      );
    }
    const normalized = (pin ?? "").trim();
    if (!/^\d{6}$/.test(normalized)) {
      throw AppError.unauthorized("Geçersiz PIN");
    }
    const user = await prisma.user.findFirst({
      where: { quickPin: normalized, isActive: true },
      select: { id: true, username: true, tokenVersion: true },
    });
    if (!user) throw AppError.unauthorized("PIN tanınmadı — yöneticinizden hızlı PIN isteyin");
    return this.issueToken(user, ctx);
  }

  /**
   * Admin: kullanıcıya hızlı PIN ata. `pin` verilirse (6 hane) o kullanılır —
   * BAŞKASINDA varsa 409 (benzersizlik kimliğin temeli); verilmezse çakışmayan
   * rastgele 6 hane üretilir. Düz döner (admin operatöre iletir). Açık oturumlar
   * etkilenmez. `clear=true` → PIN kaldırılır (salt-PIN girişi kapanır).
   */
  static async setQuickPin(
    userId: string,
    input: { pin?: string; clear?: boolean },
    actorUserId?: string
  ): Promise<{ pin: string | null }> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, isActive: true, quickPin: true },
    });
    if (!user || !user.isActive) throw AppError.notFound("Kullanıcı bulunamadı veya pasif");

    if (input.clear) {
      await prisma.user.update({ where: { id: userId }, data: { quickPin: null } });
      await AuditService.log({
        userId: actorUserId, action: "UPDATE", tableName: "USER_QUICK_PIN",
        recordId: userId, newData: { username: user.username, cleared: true },
      }).catch(() => undefined);
      return { pin: null };
    }

    if (input.pin !== undefined) {
      const manual = input.pin.trim();
      if (!/^\d{6}$/.test(manual)) throw AppError.badRequest("Hızlı PIN 6 haneli rakam olmalı");
      try {
        await prisma.user.update({ where: { id: userId }, data: { quickPin: manual } });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
          throw AppError.conflict(
            "Bu PIN başka bir kullanıcıda tanımlı — hızlı PIN benzersiz olmalı (farklı bir PIN girin veya rastgele üretin)"
          );
        }
        throw e;
      }
      await AuditService.log({
        userId: actorUserId, action: "UPDATE", tableName: "USER_QUICK_PIN",
        recordId: userId, newData: { username: user.username, rotated: user.quickPin != null },
      }).catch(() => undefined);
      return { pin: manual };
    }

    // Rastgele üret — P2002'de yeniden dene (1M kombinasyonda çakışma nadir).
    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate = String(randomInt(0, 1_000_000)).padStart(6, "0");
      try {
        await prisma.user.update({ where: { id: userId }, data: { quickPin: candidate } });
        await AuditService.log({
          userId: actorUserId, action: "UPDATE", tableName: "USER_QUICK_PIN",
          recordId: userId, newData: { username: user.username, rotated: user.quickPin != null },
        }).catch(() => undefined);
        return { pin: candidate };
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue;
        throw e;
      }
    }
    throw AppError.internal("Benzersiz PIN üretilemedi — tekrar deneyin");
  }

  /**
   * Admin: personel kartı sırrını üret/YENİLE (rotasyon). Yeni 32-hex token yazılır;
   * dönen cardCode QR olarak basılır. Eski kart anında geçersiz. Açık JWT oturumları
   * ETKİLENMEZ (tokenVersion bump yok — yalnız kart kimliği değişir).
   */
  static async rotateCardToken(
    userId: string,
    actorUserId?: string
  ): Promise<{ cardCode: string; rotated: boolean }> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, isActive: true, cardToken: true },
    });
    if (!user || !user.isActive) throw AppError.notFound("Kullanıcı bulunamadı veya pasif");
    const token = randomBytes(16).toString("hex"); // 32-hex
    await prisma.user.update({ where: { id: userId }, data: { cardToken: token } });
    await AuditService.log({
      userId: actorUserId,
      action: "UPDATE",
      tableName: "USER_CARD_TOKEN",
      recordId: userId,
      newData: { username: user.username, rotated: user.cardToken != null },
    }).catch(() => undefined);
    return { cardCode: `TEKSU:${user.id}:${token}`, rotated: user.cardToken != null };
  }

  /**
   * Admin: kullanıcının mobil kimlik bilgilerini OKU — hızlı PIN + QR kart kodu.
   * Panel bunları HER ZAMAN gösterir (kart QR sürekli görünür, mevcut PIN görünür).
   * GÜVENLİK: her ikisi de düz saklandığından geri okunabilir; bu uç yalnız
   * admin:users yetkisiyle çağrılır ("bu ekranı yalnız yönetici görür" kararı).
   */
  static async getUserCredentials(
    userId: string
  ): Promise<{ quickPin: string | null; cardCode: string | null }> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, quickPin: true, cardToken: true },
    });
    if (!user) throw AppError.notFound("Kullanıcı bulunamadı");
    return {
      quickPin: user.quickPin,
      cardCode: user.cardToken ? `TEKSU:${user.id}:${user.cardToken}` : null,
    };
  }

  /** JWT üretimi — login/loginWithCard/loginWithQuickPin'in ortak çıkışı. Session
   *  registry'ye kayıt açar (aynı-tip politikası burada uygulanır) ve jti'yi jwtid
   *  olarak token'a gömer → middleware anlık iptal kontrolü yapabilir. 'notify'
   *  politikası + onaysız çakışma → openLoginSession 409 SESSION_EXISTS fırlatır. */
  private static async issueToken(
    user: {
      id: string;
      username: string;
      tokenVersion: number;
    },
    ctx?: LoginContext
  ): Promise<{ token: string; user: JwtPayload }> {
    const permissions = await this.getEffectivePermissions(user.id);

    // Oturum ömrü runtime ayardan (auth.sessionDurationHours, default 8) — saniyeye çevrilir.
    const sessionHours = await readSessionDurationHours();
    const expiresInSec = sessionHours * 60 * 60;

    // jti = Session satırı anahtarı; JWT exp ile hizalı expiresAt hesapla.
    const jti = randomUUID();
    const expiresAt = new Date(Date.now() + expiresInSec * 1000);
    const deviceType: ClientType =
      ctx?.clientType === "electron" ? ClientType.ELECTRON : ClientType.MOBILE;
    const policy = await readSameTypeSessionPolicy();

    // Oturum kaydını AÇ (token imzalanmadan önce — notify çakışmasında token üretilmez).
    await SessionRegistryService.openLoginSession({
      userId: user.id,
      deviceType,
      deviceId: ctx?.deviceId ?? null,
      jti,
      expiresAt,
      policy,
      confirmKick: ctx?.confirmKick,
    });

    // jti token'a jwt.sign jwtid ile eklenir — sign payload'ında jti TUTMUYORUZ
    // (jsonwebtoken "jti already present" hatası verir). Dönen JwtPayload jti taşır.
    const signPayload = {
      userId: user.id,
      username: user.username,
      permissions,
      tokenVersion: user.tokenVersion,
    };
    const token = jwt.sign(signPayload, JWT_SECRET, {
      expiresIn: expiresInSec,
      jwtid: jti,
    });

    const payload: JwtPayload = { ...signPayload, jti };
    return { token, user: payload };
  }

  /**
   * Verify and decode a JWT token.
   */
  static verifyToken(token: string): JwtPayload {
    try {
      return jwt.verify(token, JWT_SECRET) as JwtPayload;
    } catch {
      throw AppError.unauthorized("Geçersiz veya süresi dolmuş token");
    }
  }

  /**
   * Hash a plain-text password.
   */
  static async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 10);
  }

  /**
   * Mobil login ekranı için aktif mobil kullanıcı listesi —
   * yalnız `mobile:*`/`mobile:<ekran>` yetkisi olanlar (web kullanıcıları sızdırılmaz).
   */
  static async listMobileUsers(): Promise<
    Array<{ id: string; username: string; fullName: string }>
  > {
    // Emniyet tavanı: mobil login ekranının kullanıcı seçicisi — gerçekte onlarca
    // operatör. `take` ile sınırsız okumayı kapatıyoruz (pratikte hiç dolmaz).
    return prisma.user.findMany({
      where: {
        isActive: true,
        permissions: {
          some: {
            permission: { code: { startsWith: "mobile:" } },
          },
        },
      },
      select: { id: true, username: true, fullName: true },
      orderBy: { fullName: "asc" },
      take: 500,
    });
  }

  /**
   * GET /api/auth/me için aktif kullanıcı özeti — pasif/yok ise null.
   */
  static async getActiveUserSummary(
    userId: string
  ): Promise<{ id: string; username: string; fullName: string } | null> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, fullName: true, isActive: true },
    });
    if (!user || !user.isActive) return null;
    return { id: user.id, username: user.username, fullName: user.fullName };
  }

  /**
   * Bir kullanıcının şu an geçerli efektif permission code'larını döner.
   * validFrom/validUntil pencereleri filtrelenir.
   */
  static async getEffectivePermissions(userId: string): Promise<string[]> {
    const now = new Date();
    const grants = await prisma.userPermission.findMany({
      where: {
        userId,
        AND: [
          { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
          { OR: [{ validUntil: null }, { validUntil: { gte: now } }] },
        ],
      },
      select: { permission: { select: { code: true } } },
    });
    const set = new Set<string>();
    for (const g of grants) set.add(g.permission.code);
    return Array.from(set);
  }
}
