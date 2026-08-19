// =============================================================================
// İSTEK BAĞLAMI — "nereden yapıldı" bilgisini 251 çağrıya taşımadan (Faz B3)
// =============================================================================
// Tasarım: docs/design/AUDIT-DERINLESTIRME-TASARIM.md
//
// SORUN: ISO 27001 A.8.15 log kaydında "NEREDE/NASIL" bileşenini ister. Bizde
// 96.026 DOMAIN audit kaydının HİÇBİRİNDE IP/cihaz yoktu — yalnız AUTH
// olaylarında vardı. Sahada 10 tablet AYNI kullanıcıyla çalışırken "hangi
// tabletten yapıldı" sorusu cevapsızdı.
//
// NEDEN AsyncLocalStorage: `AuditService.log` 85 SERVİS dosyasından 251 kez
// çağrılıyor ve servisler `req`'i görmüyor. Cihaz bilgisini imzalara eklemek
// 251 çağrı noktasını değiştirmek + her yeni çağrıda unutulabilecek bir adım
// daha demekti. ALS bağlamı istek başına bir kez kurar; audit onu kendisi okur.
//
// ⚠️ `req` NESNESİNİN KENDİSİ saklanır, alanları KOPYALANMAZ: `req.user`
// (verifyToken) ve `req.device` (resolveDevice) bağlam kurulduktan SONRA
// doluyor. Kopyalasaydık audit her zaman boş okurdu — sıraya bağımlı, sessiz
// bir hata olurdu.
//
// ⚠️ BAĞLAM YOKSA (job/script/test) her şey `null` döner ve audit yine yazılır.
// Cihaz bilgisi olmadığı için kaydı DÜŞÜRMEK, elimizdeki izi kaybetmek olurdu.
// =============================================================================

import { AsyncLocalStorage } from "async_hooks";
import type { Request } from "express";

interface RequestContext {
  req: Request;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** İsteği bağlam içinde çalıştırır — middleware tarafından çağrılır. */
export function runWithRequestContext(req: Request, fn: () => void): void {
  storage.run({ req }, fn);
}

/** Audit için "nereden" bilgisi. Bağlam yoksa hepsi null. */
export interface RequestOrigin {
  ipAddress: string | null;
  deviceId: string | null;
  machineId: string | null;
  userId: string | null;
}

export function currentOrigin(): RequestOrigin {
  const ctx = storage.getStore();
  if (!ctx) return { ipAddress: null, deviceId: null, machineId: null, userId: null };
  const { req } = ctx;
  return {
    // `req.ip` proxy arkasında X-Forwarded-For'u okur (app'te trust proxy ayarı).
    ipAddress: req.ip ?? null,
    deviceId: req.device?.deviceId ?? null,
    machineId: req.device?.machineId ?? null,
    userId: req.user?.userId ?? null,
  };
}
