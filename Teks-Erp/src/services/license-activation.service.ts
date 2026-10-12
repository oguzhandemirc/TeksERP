// G2 etkinleştirme kilidinin servis yüzü: giriş öncesi sinyal ve satıcı imzalı muafiyet belgesinin kabulü.
import { getLicenseSnapshot } from "../lib/license/runtime";

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
