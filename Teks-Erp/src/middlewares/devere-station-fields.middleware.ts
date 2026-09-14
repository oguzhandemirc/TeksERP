// =============================================================================
// TeksERP — İstasyon/makine gövdesindeki DEVERE alanlarının AÇIK doğrulaması (Faz 3 E2)
// =============================================================================
// `BaseController` modelinde her skaler kolon zaten YAZILABİLİR (DMMF allowlist, mass-assignment
// yalnız ilişkileri kapatır) — bu alanlar "kazara yazılabilir" değil, BİLEREK yazılabilir ve
// doğrulaması burada: yuva sayısı 0..32 tam sayı (0 = cağlıklı çözgü makinesi, §9.7h), yetenek
// bayrakları boolean. İstasyon TÜRÜ kuralı yazılmadı (ölçülecek; fabrika istasyonu kendi tanımlar).
// =============================================================================
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";

const stationDevereFields = z
  .object({ producesWarpBeam: z.boolean().optional(), consumesWarpBeam: z.boolean().optional() })
  .passthrough();

const machineDevereFields = z
  .object({ warpBeamSlots: z.number().int("Levent yuva sayısı tam sayı olmalı").min(0, "Levent yuva sayısı negatif olamaz").max(32, "Levent yuva sayısı en fazla 32").optional() })
  .passthrough();

export function validateStationDevereFields(req: Request, _res: Response, next: NextFunction): void {
  try {
    if (req.body && typeof req.body === "object") req.body = stationDevereFields.parse(req.body);
    next();
  } catch (e) {
    next(e);
  }
}

export function validateMachineDevereFields(req: Request, _res: Response, next: NextFunction): void {
  try {
    if (req.body && typeof req.body === "object") req.body = machineDevereFields.parse(req.body);
    next();
  } catch (e) {
    next(e);
  }
}
