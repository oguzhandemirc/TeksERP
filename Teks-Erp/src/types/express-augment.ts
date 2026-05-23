// =============================================================================
// TeksERP - Express Type Augmentation
// =============================================================================
// Adds `user` property to Express Request after JWT verification.
// =============================================================================

/* eslint-disable @typescript-eslint/no-empty-interface */

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
    };
  }
}

// Re-export to make this a module (required for declaration merging)
export {};
