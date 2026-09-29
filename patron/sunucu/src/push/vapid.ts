// WEB PUSH VAPID ANAHTAR ÇİFTİ — `ANAHTAR_DIZINI/patron-vapid.json` (0600; DB'de ve repoda DEĞİL). Dosya yoksa ilk
// açılışta üretilir (üstüne YAZILMAZ); kaybolursa web aboneliklerinin hepsi yenilenmek zorunda kalır.
// Gizli anahtar yalnız bu sınıfın kapanışında yaşar: JSON'a, `util.inspect`e, hata iletisine GİRMEZ (bekçi ölçer).
import { chmodSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { generateKeyPairSync } from "node:crypto";
import path from "node:path";
import { inspect } from "node:util";

export const VAPID_KEY_FILE = "patron-vapid.json";
const B64URL = /^[A-Za-z0-9_-]+$/;

function generate(): { publicKey: string; privateKey: string } {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = privateKey.export({ format: "jwk" });
  if (!jwk.d || !jwk.x || !jwk.y) throw new Error("VAPID anahtarı üretilemedi");
  const pub = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]);
  return { publicKey: pub.toString("base64url"), privateKey: jwk.d };
}

export class VapidKeys {
  readonly publicKey: string;
  readonly #privateKey: string;

  private constructor(publicKey: string, privateKey: string) {
    this.publicKey = publicKey;
    this.#privateKey = privateKey;
  }

  static load(keyDir: string, g: { create: boolean }): VapidKeys {
    const file = path.join(keyDir, VAPID_KEY_FILE);
    if (!existsSync(file)) {
      if (!g.create) throw new Error(`VAPID anahtar dosyası yok: ${file}`);
      writeFileSync(file, `${JSON.stringify(generate())}\n`, { mode: 0o600, flag: "wx" });
    }
    chmodSync(file, 0o600);
    if ((statSync(file).mode & 0o077) !== 0) throw new Error(`VAPID anahtar dosyası başkalarınca okunabilir: ${file}`);
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      throw new Error(`VAPID anahtar dosyası biçimsiz: ${file}`);
    }
    const r = raw as { publicKey?: unknown; privateKey?: unknown };
    const pub = typeof r.publicKey === "string" && B64URL.test(r.publicKey) ? Buffer.from(r.publicKey, "base64url") : null;
    const priv = typeof r.privateKey === "string" && B64URL.test(r.privateKey) ? Buffer.from(r.privateKey, "base64url") : null;
    if (!pub || pub.length !== 65 || pub[0] !== 4 || !priv || priv.length !== 32) throw new Error(`VAPID anahtar dosyası biçimsiz: ${file}`);
    return new VapidKeys(r.publicKey as string, r.privateKey as string);
  }

  /** web-push'un `vapidDetails`i — YALNIZ gönderim çağrısının argümanı olarak kullanılır, saklanmaz/loglanmaz. */
  details(subject: string): { subject: string; publicKey: string; privateKey: string } {
    return { subject, publicKey: this.publicKey, privateKey: this.#privateKey };
  }

  toJSON(): { publicKey: string } {
    return { publicKey: this.publicKey };
  }

  toString(): string {
    return `VapidKeys(${this.publicKey.slice(0, 8)}…)`;
  }

  [inspect.custom](): string {
    return this.toString();
  }
}
