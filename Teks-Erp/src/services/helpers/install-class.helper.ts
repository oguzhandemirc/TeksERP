// Barındırılan (bulut VDS) kurulum mu? İki bağımsız kaynaktan biri yeter: imzalı HAK'ın sınıfı
// ya da kurulum betiğinin yazdığı ortam değişkeni. İkisi de yalnız SERTLEŞTİRİR — hiçbiri bir
// kuralı gevşetemez; lisans okunamazsa ortam değişkeni sınıfı yine taşır.
import { getLicenseSnapshot } from "../../lib/license/runtime";

export const HOSTED_CLASS = "BARINDIRILAN";
export const INSTALL_CLASS_ENV = "TEKSERP_KURULUM_SINIFI";

export function isHostedInstallation(env: NodeJS.ProcessEnv = process.env): boolean {
  if ((env[INSTALL_CLASS_ENV] ?? "").trim().toUpperCase() === HOSTED_CLASS) return true;
  try {
    return getLicenseSnapshot().entitlement?.document.sinif === HOSTED_CLASS;
  } catch {
    return false;
  }
}
