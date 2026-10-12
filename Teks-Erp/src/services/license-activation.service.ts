// G2 etkinleştirme kilidinin servis yüzü: giriş öncesi sinyal ve satıcı imzalı muafiyet belgesinin kabulü.
import { verifyExemption, type ExemptionRejection } from "../lib/license/exemption";
import { getLicenseConfig, getLicenseSnapshot, getMeasuredFingerprint, invalidateLicenseSnapshot } from "../lib/license/runtime";
import { getLicenseStore, saveExemption } from "../lib/license/store";
import { licenseError } from "./helpers/license-wire.helper";
import { adminAction } from "./license-trail.service";

/**
 * Giriş öncesi G2 sinyali (`GET /api/auth/login-methods` → `lisansEtkinlesmedi`): kurulum etkinleştirme kilidinde mi.
 * Ayrıntı (sınıf, neden) kimliksize verilmez; motor hazır değilse false (belirsizlik durdurmaz).
 */
export function isActivationLockedBeforeLogin(): boolean {
  try {
    return getLicenseSnapshot().etkinlestirmeKilidi.sinif !== "YOK";
  } catch {
    return false;
  }
}

/** Portalın muafiyet dosyası `{ v: 1, muafiyet: "<jws>" }` (nesne ya da JSON metni); başka biçim → null (lisans yanıtıdır). */
export function exemptionTextOf(raw: unknown): string | null {
  let value = raw;
  if (typeof raw === "string") {
    const text = raw.trim().replace(/^﻿/, "");
    if (!text.startsWith("{")) return null;
    try {
      value = JSON.parse(text) as unknown;
    } catch {
      return null;
    }
  }
  const m = value !== null && typeof value === "object" ? (value as { muafiyet?: unknown }).muafiyet : undefined;
  return typeof m === "string" ? m : null;
}

const REJECTION_TEXT: Readonly<Record<ExemptionRejection, string>> = {
  BICIM: "Muafiyet belgesi okunamadı.",
  SERTIFIKA: "Muafiyet belgesinin imzacı sertifikası geçersiz.",
  IMZA: "Muafiyet belgesinin imzası doğrulanamadı.",
  SEMA: "Muafiyet belgesi biçimi tanınmadı.",
  ANAHTAR: "Muafiyet belgesi başka bir kurulum için verilmiş.",
  PARMAK_IZI: "Muafiyet belgesi başka bir makine için verilmiş.",
};

/** Muafiyeti doğrular (bu kurulumun anahtarı + makinesi) ve lisans dizinine yazar; ret 400 `LICENSE_RESPONSE_INVALID`. */
export function acceptExemption(jws: string, userId: string | null): { muafiyetId: string } {
  const keyX = getLicenseStore()?.key?.x;
  if (!keyX) throw licenseError(409, "LICENSE_STORE_UNAVAILABLE", "Lisans deposu kullanılamıyor.");
  const v = verifyExemption(jws, { keyX, roots: getLicenseConfig().roots, fingerprint: getMeasuredFingerprint() });
  if (!v.ok) {
    adminAction(userId, "muafiyet", { sonuc: v.code });
    throw licenseError(400, "LICENSE_RESPONSE_INVALID", REJECTION_TEXT[v.code], { muafiyetReddi: v.code });
  }
  saveExemption(jws);
  invalidateLicenseSnapshot();
  adminAction(userId, "muafiyet", { sonuc: "kabul", muafiyetId: v.doc.muafiyetId });
  return { muafiyetId: v.doc.muafiyetId };
}
