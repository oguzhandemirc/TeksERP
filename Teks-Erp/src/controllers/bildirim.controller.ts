// =============================================================================
// BİLDİRİM CONTROLLER — zil akışı + gelen kutusu uçları (`/api/bildirim/*`, plan §5.6 F1)
// =============================================================================
// Uçlar KİŞİSELDİR: verifyToken yeter, izin kodu yok; satır kapsamı servisteki `userId` WHERE'idir.
// Bayrak (`bildirim.gelenKutusuEnabled`) kapalıyken özet dışı her uç 409 `BILDIRIM_KAPALI`.
// =============================================================================
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import * as hub from "../services/notification-bell-hub";
import {
  assertInboxEnabled,
  inboxSummary,
  isStreamSessionValid,
  listInbox,
  markAllRead,
  markRead,
  snooze,
  undoMarkRead,
  visibleCatalog,
  type InboxViewer,
} from "../services/notification-inbox.service";

function viewer(req: Request): InboxViewer {
  return { userId: req.user!.userId, permissions: req.user!.permissions ?? [] };
}

type Handler = (req: Request, res: Response) => Promise<unknown>;

/** Bayrak kapısı + JSON zarfı; hata zincire gider. */
function json(fn: Handler, gated = true) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (gated) await assertInboxEnabled();
      res.status(200).json({ success: true, data: await fn(req, res) });
    } catch (err) {
      next(err);
    }
  };
}

export async function getBellStream(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await assertInboxEnabled();
    const { userId, jti, tokenVersion } = req.user!;
    hub.subscribe(userId, res, () => isStreamSessionValid(userId, jti, tokenVersion));
  } catch (err) {
    next(err);
  }
}

const WaitQuery = z.object({
  rev: z.coerce.number().int().min(0).optional(),
  alarmRev: z.coerce.number().int().min(0).optional(),
  epoch: z.coerce.number().int().min(0).optional(),
});

export const getWait = json(async (req, res) => {
  const q = WaitQuery.parse(req.query);
  return hub.waitForChange(req.user!.userId, q, (release) => res.on("close", release));
});

export const getSummary = json((req) => inboxSummary(viewer(req)), false);
export const getList = json((req) => listInbox(viewer(req), req.query as Record<string, unknown>));
export const postRead = json((req) => markRead(viewer(req), req.params.id, true));
export const postUnread = json((req) => markRead(viewer(req), req.params.id, false));
export const postSnooze = json((req) => snooze(viewer(req), req.params.id, req.body));
export const postReadAll = json((req) => markAllRead(viewer(req)));
export const postUndoRead = json((req) => undoMarkRead(viewer(req), req.body));
export const getCatalog = json((req) => visibleCatalog(viewer(req)));
