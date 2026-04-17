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
  }
}

// Re-export to make this a module (required for declaration merging)
export {};
