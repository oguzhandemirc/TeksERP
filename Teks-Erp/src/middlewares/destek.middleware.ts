// =============================================================================
// DESTEK KAPISI — Etkili Destek entegrasyonu kapalıysa uçlar 403 MODULE_DISABLED
// =============================================================================
// Bayrak DB ayarı değil `.env`tir (`DESTEK_API_URL` + `DESTEK_API_KEY`) + lisans tesis kimliği;
// kapı ortamı ve lisans anlığını okur, DB'ye ve dışarıya dokunmaz. Kapalıyken 404 değil 403 döner: uç var,
// bu kurulumda kapalı (modül kapılarıyla aynı sözleşme, `details.code`).
// İzin kapısının YERİNE geçmez: destek uçları giriş yapmış herkese açıktır (izin
// kodu açılmadı); firma geneli görünümün izin denetimi serviste yapılır.
// =============================================================================
import { Request, Response, NextFunction } from "express";
import { readSupportDeskConfig } from "../services/helpers/destek-transport.helper";
import { AppError } from "../utils/app-error";

export function requireSupportDeskEnabled(_req: Request, _res: Response, next: NextFunction): void {
  if (readSupportDeskConfig() === null) {
    next(
      AppError.forbidden("Destek talebi özelliği bu kurulumda kapalı.", { code: "MODULE_DISABLED", modul: "destek" }),
    );
    return;
  }
  next();
}
