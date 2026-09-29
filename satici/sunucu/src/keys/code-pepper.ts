// Etkinleştirme kodunun saklanan özeti: HMAC-SHA256(sunucu sırrı, kod). Sır (pepper) ANAHTAR_DIZINI'nde
// 0600 dosyadır, DB'de DEĞİL — DB dökümü tek başına kodu çevrimdışı denemeye açmaz. Dosya yoksa yalnız
// `create` ile üretilir (üstüne YAZILMAZ); kaybolursa açık kodlar tanınmaz → yeniden üretilir.
import crypto from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const ACTIVATION_CODE_PEPPER_FILE = "etkinlestirme-kodu.pepper";

export class ActivationCodeHasher {
  private constructor(private readonly pepper: Buffer) {}

  static load(keyDir: string, g: { create: boolean }): ActivationCodeHasher {
    const file = path.join(keyDir, ACTIVATION_CODE_PEPPER_FILE);
    if (!existsSync(file)) {
      if (!g.create) throw new Error(`Etkinleştirme kodu sırrı yok: ${file}`);
      writeFileSync(file, `${crypto.randomBytes(32).toString("base64url")}\n`, { mode: 0o600, flag: "wx" });
      chmodSync(file, 0o600);
    }
    const pepper = Buffer.from(readFileSync(file, "utf8").trim(), "base64url");
    if (pepper.length !== 32) throw new Error(`Etkinleştirme kodu sırrı biçimsiz (32 bayt değil): ${file}`);
    return new ActivationCodeHasher(pepper);
  }

  /** Kanonik kodun (TKS-XXXX-…) özeti, hex. */
  digest(code: string): string {
    return crypto.createHmac("sha256", this.pepper).update(code, "utf8").digest("hex");
  }
}
