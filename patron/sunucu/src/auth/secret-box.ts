// Bulut hesaplarının TOTP sırlarının sarmalayıcısı: AES-256-GCM, anahtar ANAHTAR_DIZINI'nde 0600 dosya (DB'de
// DEĞİL) — DB dökümü tek başına TOTP sırlarını açmaz. Ek veri (AAD) hesap kimliğini bağlar:
// bir hesabın şifreli sırrı başka hesaba taşınamaz. Anahtar dosyası yoksa ilk açılışta
// üretilir (üstüne YAZILMAZ); kaybolursa sırlar çözülemez → hesaplar davetle sıfırlanır.
import crypto from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const SECRET_KEY_FILE = "patron-totp.key";
const PREFIX = "v1";

export class SecretBox {
  private constructor(private readonly key: Buffer) {}

  static load(keyDir: string, g: { create: boolean }): SecretBox {
    const file = path.join(keyDir, SECRET_KEY_FILE);
    if (!existsSync(file)) {
      if (!g.create) throw new Error(`Bulut sır anahtarı yok: ${file}`);
      writeFileSync(file, `${crypto.randomBytes(32).toString("base64url")}\n`, { mode: 0o600, flag: "wx" });
      chmodSync(file, 0o600);
    }
    const key = Buffer.from(readFileSync(file, "utf8").trim(), "base64url");
    if (key.length !== 32) throw new Error(`Bulut sır anahtarı biçimsiz (32 bayt değil): ${file}`);
    return new SecretBox(key);
  }

  seal(plain: string, accountId: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(`tekserp/patron-totp|${accountId}`, "utf8"));
    const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    return [PREFIX, iv.toString("base64url"), body.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
  }

  /** Çözülemezse null (yanlış anahtar, kurcalanmış ya da başka hesabın sırrı). */
  open(sealed: string, accountId: string): string | null {
    const parts = sealed.split(".");
    if (parts.length !== 4 || parts[0] !== PREFIX) return null;
    try {
      const decipher = crypto.createDecipheriv("aes-256-gcm", this.key, Buffer.from(parts[1]!, "base64url"));
      decipher.setAAD(Buffer.from(`tekserp/patron-totp|${accountId}`, "utf8"));
      decipher.setAuthTag(Buffer.from(parts[3]!, "base64url"));
      return Buffer.concat([decipher.update(Buffer.from(parts[2]!, "base64url")), decipher.final()]).toString("utf8");
    } catch {
      return null;
    }
  }
}
