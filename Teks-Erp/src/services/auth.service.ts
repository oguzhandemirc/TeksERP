// =============================================================================
// TeksERP - Auth Service
// =============================================================================

import prisma from "../lib/prisma";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomBytes } from "crypto";
import { JwtPayload } from "../types/api.types";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { readSessionDurationHours, readAuthLoginMode } from "./system-setting.service";

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
    password: string
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

    return this.issueToken({ id: user.id, username: user.username, tokenVersion: user.tokenVersion });
  }

  /**
   * QR personel kartıyla giriş — YALNIZ auth.loginMode="card" iken (kapalıyken
   * kart altyapısı saldırı yüzeyi açmaz; PIN girişi her modda çalışır — fallback).
   * Kart içeriği "TEKSU:<userId>:<token>"; token users.cardToken'daki 32-hex sır.
   * Kart kaybolursa admin ROTASYON yapar (yeni token) → eski kart anında ölür.
   */
  static async loginWithCard(
    cardCode: string
  ): Promise<{ token: string; user: JwtPayload }> {
    const mode = await readAuthLoginMode();
    if (mode !== "card") {
      throw AppError.forbidden(
        "Kartla giriş kapalı — Genel Ayarlar'dan giriş yöntemi 'Kart' yapılabilir"
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
    return this.issueToken(user);
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

  /** JWT üretimi — login ve loginWithCard'ın ortak çıkışı. */
  private static async issueToken(user: {
    id: string;
    username: string;
    tokenVersion: number;
  }): Promise<{ token: string; user: JwtPayload }> {
    const permissions = await this.getEffectivePermissions(user.id);

    const payload: JwtPayload = {
      userId: user.id,
      username: user.username,
      permissions,
      tokenVersion: user.tokenVersion,
    };

    // Oturum ömrü runtime ayardan (auth.sessionDurationHours, default 8) — saniyeye çevrilir.
    const sessionHours = await readSessionDurationHours();
    const token = jwt.sign(payload, JWT_SECRET, {
      expiresIn: sessionHours * 60 * 60,
    });

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
