// =============================================================================
// TeksERP - Auth Service
// =============================================================================

import prisma from "../lib/prisma";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { JwtPayload } from "../types/api.types";
import { AppError } from "../utils/app-error";

const JWT_SECRET = process.env.JWT_SECRET || "default_secret_change_me";
const JWT_EXPIRES_IN = "8h";

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
      },
    });

    if (!user || !user.isActive) {
      throw AppError.unauthorized("Geçersiz kullanıcı adı veya şifre");
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      throw AppError.unauthorized("Geçersiz kullanıcı adı veya şifre");
    }

    const permissions = await this.getEffectivePermissions(user.id);

    const payload: JwtPayload = {
      userId: user.id,
      username: user.username,
      permissions,
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

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
