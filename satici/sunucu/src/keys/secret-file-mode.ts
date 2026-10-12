// SIR DOSYASI İZNİ — parolasız özel yarı ya da sır taşıyan dosya diğer kullanıcılara açıksa (mode & 0o007) açılış
// DURUR: iç API sırrıyla (`lib/internal-bearer.ts`) aynı kural; grup okuması (0640/0440, konteyner grubu) serbest.
// Geliştirme kaçışı yalnız NODE_ENV≠production + ANAHTAR_IZIN_UYARI=1 beyanıyla (uyarı basılır, yüklenir).
import { statSync } from "node:fs";
import path from "node:path";

export class SecretFileModeError extends Error {}

export function assertSecretFileMode(file: string, env: NodeJS.ProcessEnv = process.env): void {
  if (process.platform === "win32") return;
  const mode = statSync(file).mode & 0o777;
  if ((mode & 0o007) === 0) return;
  const name = path.basename(file);
  const detail = `${name} diğer kullanıcılara açık (izin 0${mode.toString(8)}); en çok 0640 olmalı — düzeltme: chmod 600 ${name}`;
  if (env.NODE_ENV !== "production" && env.ANAHTAR_IZIN_UYARI === "1") {
    console.warn(`[satici] UYARI (geliştirme beyanı ANAHTAR_IZIN_UYARI=1): ${detail}`);
    return;
  }
  throw new SecretFileModeError(`Sır dosyası izni güvensiz, sunucu açılmıyor: ${detail}`);
}
