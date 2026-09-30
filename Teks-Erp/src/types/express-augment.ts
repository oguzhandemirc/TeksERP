// =============================================================================
// TeksERP - Express Type Augmentation
// =============================================================================
// Adds `user` property to Express Request after JWT verification.
// =============================================================================

import { JwtPayload } from "./api.types";

// Augment the core module that Express's Request actually extends from
declare module "express-serve-static-core" {
  interface Request {
    user?: JwtPayload;
    /**
     * Mobil tabletten gelen x-device-id header'ı çözümlendiğinde dolu olur.
     * machineId null ise cihaz eşleşmemiş demektir; ilgili işlem yine de kaydedilebilir
     * (geriye uyum) ama hangi makineye ait olduğu bilinmez.
     */
    device?: {
      id: string;
      deviceId: string;
      name: string;
      machineId: string | null;
      /** TABLET / PHONE / DESKTOP — çalışma oturumu zorunluluğu yalnız saha
       *  cihazlarına (TABLET/PHONE) uygulanır; DESKTOP (Electron) muaf. */
      kind: string;
    };
    /**
     * İstek SATICI (süperadmin) hesabından mı geliyor?
     *
     * `auth.middleware.verifyToken` doldurur — `User.isSystemAccount` her
     * istekte ZATEN yapılan tazelik okumasından (tokenVersion/isActive) gelir,
     * yani ek sorgu maliyeti YOKTUR ve değer DB-tazedir.
     *
     * ⚠️ Middleware doldurur, İSTEMCİ SEÇEMEZ. JWT claim'i
     * DEĞİLDİR — token'a gömülseydi bayrak kaldırılan bir hesap, token'ı
     * dolana kadar süperadmin kalırdı. Modül anahtarı kapısı buna bakar.
     */
    isSystemAccount?: boolean;
  }
}

// Re-export to make this a module (required for declaration merging)
export {};
