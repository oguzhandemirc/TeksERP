// Giriş uçlarının Turnstile kapısı (V1c) — karar `services/turnstile/turnstile-gate.ts`te; gövde Zod'dan
// önce okunur (alanlar opsiyonel, şemalar bilinmeyen alanı atar → eski istemci bayt-aynı).
import type { NextFunction, Request, Response } from "express";
import { assertTurnstileForLogin } from "../services/turnstile/turnstile-gate";

export function turnstileLoginGate(req: Request, _res: Response, next: NextFunction): void {
  const body = (req.body ?? {}) as { clientType?: unknown; turnstileToken?: unknown };
  assertTurnstileForLogin(body.clientType, body.turnstileToken, req.ip ?? null).then(() => next(), next);
}
