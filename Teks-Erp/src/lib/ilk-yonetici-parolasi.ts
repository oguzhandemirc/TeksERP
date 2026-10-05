// =============================================================================
// İlk kurulum yöneticisinin parolası — Docker/korumalı imaj seed yolu
// =============================================================================
// Sabit parola YOK: operatör `ILK_YONETICI_PAROLASI` verir (politikaya uymalı) ya da
// rastgele üretilir ve seed çıktısında BİR KEZ gösterilir. İki durumda da hesap
// `mustChangePassword` ile doğar — ekrana/loga düşmüş parola ilk girişte ölür.
// =============================================================================

import { randomBytes, randomInt } from "node:crypto";
import { passwordPolicyViolation } from "../constants/password-policy";

export type IlkYoneticiParolasi = {
  parola: string;
  mustChangePassword: boolean;
  /** true → parola bu koşumda üretildi ve kurulumcuya bir kez gösterilmeli. */
  uretildi: boolean;
};

export function ilkYoneticiParolasi(verilen: string | undefined): IlkYoneticiParolasi {
  if (verilen !== undefined && verilen !== "") {
    const kusur = passwordPolicyViolation(verilen);
    if (kusur) throw new Error(`ILK_YONETICI_PAROLASI kabul edilmedi: ${kusur}`);
    return { parola: verilen, mustChangePassword: true, uretildi: false };
  }
  // 12 bayt → 16 karakter base64url (~96 bit).
  return { parola: randomBytes(12).toString("base64url"), mustChangePassword: true, uretildi: true };
}

// Karışan karakterler (0/O, 1/l/I) yok: parola ekrandan okunup elle yazılır.
const GECICI_ALFABE = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
const GECICI_UZUNLUK = 14;

/** Bir kez gösterilip ilk girişte değiştirilecek geçici parola (~81 bit). */
export function geciciParolaUret(): string {
  let parola = "";
  for (let i = 0; i < GECICI_UZUNLUK; i++) parola += GECICI_ALFABE[randomInt(GECICI_ALFABE.length)];
  return parola;
}
