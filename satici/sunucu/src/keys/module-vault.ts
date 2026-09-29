// Modül anahtarı KASASI (Faz 2d): şifreli modül paketlerinin AES-256 anahtarları DB'de (`modul_anahtari`)
// bu kasa anahtarıyla AES-256-GCM sarılı durur; kasa anahtarı ANAHTAR_DIZINI'nde 0600 dosya (DB'de DEĞİL)
// — DB dökümü tek başına modül anahtarını açmaz. Ek veri (AAD) `kid`i bağlar: bir satırın sarması başka
// kimliğe taşınamaz. Kök anahtar gerekmez: kira alt anahtarla otomatik basıldığı gibi sarma da otomatiktir.
import crypto from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const MODULE_VAULT_KEY_FILE = "modul-kasasi.key";
const PREFIX = "v1";

export class ModuleKeyVault {
  private constructor(private readonly key: Buffer) {}

  /** Anahtar dosyası yoksa `create` ile üretilir (üstüne YAZILMAZ); kaybolursa kasa satırları açılamaz. */
  static load(keyDir: string, g: { create: boolean }): ModuleKeyVault {
    const file = path.join(keyDir, MODULE_VAULT_KEY_FILE);
    if (!existsSync(file)) {
      if (!g.create) throw new Error(`Modül kasası anahtarı yok: ${file}`);
      writeFileSync(file, `${crypto.randomBytes(32).toString("base64url")}\n`, { mode: 0o600, flag: "wx" });
      chmodSync(file, 0o600);
    }
    const key = Buffer.from(readFileSync(file, "utf8").trim(), "base64url");
    if (key.length !== 32) throw new Error(`Modül kasası anahtarı biçimsiz (32 bayt değil): ${file}`);
    return new ModuleKeyVault(key);
  }

  private aad(kid: string): Buffer {
    return Buffer.from(`tekserp/modul-kasasi|${kid}`, "utf8");
  }

  seal(moduleKey: Buffer, kid: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(this.aad(kid));
    const body = Buffer.concat([cipher.update(moduleKey), cipher.final()]);
    return [PREFIX, iv.toString("base64url"), body.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
  }

  /** Çözülemezse null (yanlış kasa anahtarı, kurcalanmış satır ya da başka kimliğin sarması). */
  open(sealed: string, kid: string): Buffer | null {
    const parts = sealed.split(".");
    if (parts.length !== 4 || parts[0] !== PREFIX) return null;
    try {
      const decipher = crypto.createDecipheriv("aes-256-gcm", this.key, Buffer.from(parts[1]!, "base64url"));
      decipher.setAAD(this.aad(kid));
      decipher.setAuthTag(Buffer.from(parts[3]!, "base64url"));
      const key = Buffer.concat([decipher.update(Buffer.from(parts[2]!, "base64url")), decipher.final()]);
      return key.length === 32 ? key : null;
    } catch {
      return null;
    }
  }
}
