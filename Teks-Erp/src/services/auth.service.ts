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
   */
  static async login(
    username: string,
    password: string
  ): Promise<{ token: string; user: JwtPayload }> {
    // Find user with roles and permissions
    const user = await prisma.user.findUnique({
      where: { username },
      include: {
        roles: {
          include: {
            role: {
              include: {
                permissions: {
                  include: {
                    permission: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!user || !user.isActive) {
      throw AppError.unauthorized("Geçersiz kullanıcı adı veya şifre");
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      throw AppError.unauthorized("Geçersiz kullanıcı adı veya şifre");
    }

    // Extract role names and unique permission codes
    const roles = user.roles.map((ur) => ur.role.name);
    const permissionSet = new Set<string>();
    for (const ur of user.roles) {
      for (const rp of ur.role.permissions) {
        permissionSet.add(rp.permission.code);
      }
    }
    const permissions = Array.from(permissionSet);

    const payload: JwtPayload = {
      userId: user.id,
      username: user.username,
      roles,
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
}
