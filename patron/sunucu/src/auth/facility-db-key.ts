// TESİS DB ANAHTARI — tesis rol parolalarının ve giriş dizini e-posta özetinin TEK anahtarı (32 bayt, 0600;
// üretimde salt okunur, önceden üretilir). Parola SAKLANMAZ, türetilir: sunucu ve hazırlayıcı aynı anahtardan
// aynı parolayı bulur; DB'de, günlükte, ortamda parola yoktur. İki kullanım alan ayrımlı HMAC'tir.
import crypto from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const FACILITY_DB_KEY_FILE = "patron-tesis-db.key";

/** Anahtar yolu: açık `TESIS_ROL_ANAHTARI_DOSYASI` (üretim sırrı) yoksa `ANAHTAR_DIZINI/patron-tesis-db.key`. */
export function facilityDbKeyPath(env: NodeJS.ProcessEnv, cwd: string): { file: string; explicit: boolean } {
  const explicit = env.TESIS_ROL_ANAHTARI_DOSYASI?.trim();
  if (explicit) return { file: path.resolve(cwd, explicit), explicit: true };
  return { file: path.resolve(cwd, env.ANAHTAR_DIZINI?.trim() || "anahtarlar", FACILITY_DB_KEY_FILE), explicit: false };
}

export class FacilityDbKey {
  private constructor(private readonly key: Buffer) {}

  /** `create`: dosya yoksa üretir (üstüne YAZMAZ). Açık sır yolu verildiyse çağıran `create:false` geçer. */
  static load(file: string, g: { create: boolean }): FacilityDbKey {
    if (!existsSync(file)) {
      if (!g.create) throw new Error(`Tesis DB anahtarı yok: ${file}`);
      try {
        writeFileSync(file, `${crypto.randomBytes(32).toString("base64url")}\n`, { mode: 0o600, flag: "wx" });
        chmodSync(file, 0o600);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      }
    }
    const key = Buffer.from(readFileSync(file, "utf8").trim(), "base64url");
    if (key.length !== 32) throw new Error(`Tesis DB anahtarı biçimsiz (32 bayt değil): ${file}`);
    return new FacilityDbKey(key);
  }

  private mac(domain: string, value: string): string {
    return crypto.createHmac("sha256", this.key).update(`${domain}\0${value}`, "utf8").digest("hex");
  }

  /** Tesis çalışma rolünün parolası (64 onaltılık). */
  rolePassword(role: string): string {
    return this.mac("tesis-rol-parolasi", role);
  }

  /** Giriş dizini anahtarı: normalleşmiş e-postanın anahtarlı özeti (merkez düz e-posta taşımaz). */
  emailDigest(normalizedEmail: string): string {
    return this.mac("giris-dizini", normalizedEmail);
  }
}
