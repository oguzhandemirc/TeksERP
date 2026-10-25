// =============================================================================
// BİLDİRİM TERCİH CONTROLLER — kişisel tercih/ayar/takip + yönetici profil/fabrika uçları (plan §5.6 F4)
// =============================================================================
// Kişisel uçlar verifyToken + bayrak kapısı (kapalı → 409 `BILDIRIM_KAPALI`); satır kapsamı `req.user.userId`.
// Yönetici uçlarının izin kapısı route'tadır (`settings:notifications` | `admin:settings`).
// =============================================================================
import type { NextFunction, Request, Response } from "express";
import { assertValidUuid } from "../middlewares/uuid-param.middleware";
import { assertInboxEnabled } from "../services/notification-inbox.service";
import * as pref from "../services/notification-preference.service";
import * as profile from "../services/notification-profile.service";

type Handler = (req: Request) => Promise<unknown>;

function viewer(req: Request): pref.PreferenceViewer {
  return { userId: req.user!.userId, permissions: req.user!.permissions ?? [] };
}

function json(fn: Handler, status = 200) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await assertInboxEnabled();
      res.status(status).json({ success: true, data: await fn(req) });
    } catch (err) {
      next(err);
    }
  };
}

const param = (req: Request, k: string): string => String(req.params[k] ?? "");
const profileId = (req: Request): string => assertValidUuid(req.params.id);

export const getPreferences = json((req) => pref.getPreferences(viewer(req)));
export const putPreferences = json((req) => pref.putPreferences(viewer(req), req.body));
export const postPreferencePreview = json((req) => pref.previewPreferences(viewer(req), req.body));
export const postResetPreview = json((req) => pref.resetPreview(viewer(req)));
export const postReset = json((req) => pref.resetPreferences(viewer(req), req.body));
export const getSettings = json((req) => pref.getSettings(viewer(req)));
export const putSettings = json((req) => pref.putSettings(viewer(req), req.body));
export const getFollow = json((req) => pref.getFollow(viewer(req), param(req, "tur"), param(req, "id")));
export const putFollow = json((req) => pref.putFollow(viewer(req), param(req, "tur"), param(req, "id")));
export const deleteFollow = json((req) => pref.deleteFollow(viewer(req), param(req, "tur"), param(req, "id")));

export const getProfiles = json((req) => profile.listProfiles(req.query as Record<string, unknown>));
export const postProfile = json((req) => profile.createProfile(req.body, req.user!.userId), 201);
export const patchProfile = json((req) => profile.updateProfile(profileId(req), req.body, req.user!.userId));
export const deleteProfile = json((req) => profile.archiveProfile(profileId(req), req.user!.userId));
export const putProfileCells = json((req) => profile.replaceProfileCells(profileId(req), req.body, req.user!.userId));
export const postProfileLockPreview = json((req) => profile.lockPreview(profileId(req), req.body));
export const putProfileMembers = json((req) => profile.replaceProfileMembers(profileId(req), req.body, req.user!.userId));
export const getFactoryDefaults = json(() => profile.getFactoryDefaults());
export const putFactoryDefaults = json((req) => profile.putFactoryDefaults(req.body, req.user!.userId));
