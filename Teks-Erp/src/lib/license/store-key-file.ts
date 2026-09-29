// Kurulum anahtar dosyasının X25519 yarısı (Faz 2d): üretim, dosyadan okuma (tutarlılık) ve dosya
// gövdesi. Özel yarı yalnız LICENSE_DIR'deki anahtar dosyasında durur; modül anahtarları buna sarılır.
import { createPublicKey, generateKeyPairSync } from "node:crypto";
import { b64uDecode, b64uEncode, x25519RawPublic } from "./protocol";
import { x25519Private } from "./module-key";
import type { InstallationKey, InstallationX25519 } from "./store";

/** Dosyadaki çift tutarlı mı (özel yarıdan türeyen açık yarı eşit); değilse null — Ed25519 kimliği bozulmaz, ilk yoklamada yenilenir. */
export function x25519FromFile(raw: { d: string; x: string }): InstallationX25519 | null {
  const d = b64uDecode(raw.d);
  if (!d || d.length !== 32) return null;
  try {
    const publicX = b64uEncode(x25519RawPublic(createPublicKey(x25519Private(d))));
    return publicX === raw.x ? { privateX: raw.d, publicX } : null;
  } catch {
    return null;
  }
}

export function generateX25519(): InstallationX25519 {
  const { privateKey, publicKey } = generateKeyPairSync("x25519");
  const jwk = privateKey.export({ format: "jwk" });
  if (typeof jwk.d !== "string") throw new Error("x25519 özel anahtarı dışa aktarılamadı");
  return { privateX: jwk.d, publicX: b64uEncode(x25519RawPublic(publicKey)) };
}

export function keyFileBody(key: Omit<InstallationKey, "kid">): string {
  const pkcs8 = key.privateKey.export({ format: "der", type: "pkcs8" });
  return JSON.stringify(
    {
      v: 1,
      ed25519: { pkcs8: b64uEncode(pkcs8), x: key.x },
      x25519: key.x25519 ? { d: key.x25519.privateX, x: key.x25519.publicX } : null,
      tuz: b64uEncode(key.salt),
      olusturuldu: key.createdAt,
    },
    null,
    2,
  );
}
