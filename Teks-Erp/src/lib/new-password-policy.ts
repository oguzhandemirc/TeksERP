// Yeni/değişen parola kapısı — politika + kuruluma özgü sözcükler (firma adı) TEK yerde (VDS denetimi Y2).
// Firma adı lisanstaki müşteri adıdır (senkron, bellekteki lisans görüntüsü); ürün adı her kurulumda eklenir.
import { passwordPolicyViolation } from "../constants/password-policy";
import { DEFAULT_COMPANY_NAME } from "../constants/company";
import { currentLicenseeName } from "./license/licensee-name";

export function passwordContextWords(): string[] {
  const words = [DEFAULT_COMPANY_NAME];
  const licensee = currentLicenseeName();
  if (licensee) words.push(licensee);
  return words;
}

/** Yeni ya da değişen parola için Türkçe gerekçe; uyuyorsa null. Girişte UYGULANMAZ (mevcut parola etkilenmez). */
export function newPasswordViolation(password: string): string | null {
  return passwordPolicyViolation(password, passwordContextWords());
}
