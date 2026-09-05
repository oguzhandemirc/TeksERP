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
     * İstek TÜNEL dinleyicisinden mi geldi (Cloudflare Tunnel → 127.0.0.1:REMOTE_PORT)?
     *
     * `remote-access.middleware.ts` zincirin en başında doldurur. LAN'da ve
     * uzaktan erişim kapalıyken DAİMA `false` — yani fabrika davranışı sıfır-fark.
     *
     * ⚠️ Bu bayrak `clientType`ten TÜRETİLMEZ; kaynağı isteğin kabul edildiği
     * yerel porttur ve istemci onu seçemez. Uzak/LAN ayrımı yapan her kural
     * (PIN girişi, TOTP zorunluluğu, HSTS/CSP, istemci IP başlığı) buna bakar.
     */
    isRemote?: boolean;
    /**
     * İstek SATICI (süperadmin) hesabından mı geliyor?
     *
     * `auth.middleware.verifyToken` doldurur — `User.isSystemAccount` her
     * istekte ZATEN yapılan tazelik okumasından (tokenVersion/isActive) gelir,
     * yani ek sorgu maliyeti YOKTUR ve değer DB-tazedir.
     *
     * ⚠️ `isRemote` kalıbı: middleware doldurur, İSTEMCİ SEÇEMEZ. JWT claim'i
     * DEĞİLDİR — token'a gömülseydi bayrak kaldırılan bir hesap, token'ı
     * dolana kadar süperadmin kalırdı. Modül anahtarı kapısı buna bakar.
     */
    isSystemAccount?: boolean;
    /**
     * Cloudflare Access'in doğruladığı kimlik (yalnız `isRemote` isteklerde).
     * ERP oturumunun YERİNE GEÇMEZ — kenardaki ön kapının kim olduğudur;
     * yetkilendirme yine `verifyToken` + `requirePermission` ile yapılır.
     */
    accessIdentity?: { email: string | null; sub: string | null };
  }
}

// Re-export to make this a module (required for declaration merging)
export {};
