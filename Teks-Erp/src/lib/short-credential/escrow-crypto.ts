// Anahtar emaneti: 32 baytlık anahtarı yedek alıcılarına `.tkenc` biçiminde mühürler/açar.
// Yedek şifrelemesiyle AYNI biçim — kâğıt müşteri/satıcı anahtarı ya da yerel anahtar açar.
import type { KeyObject } from "node:crypto";
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createDecryptStream, createEncryptStream, fingerprint, type Recipient } from "../backup-crypto";

async function runThrough(input: Buffer, t: NodeJS.ReadWriteStream): Promise<Buffer> {
  const parts: Buffer[] = [];
  await pipeline(
    Readable.from([input]),
    t,
    new Writable({
      write(chunk: Buffer, _e, cb) {
        parts.push(chunk);
        cb();
      },
    }),
  );
  return Buffer.concat(parts);
}

export async function sealKey(key: Buffer, recipients: Recipient[]): Promise<string> {
  return (await runThrough(key, createEncryptStream(recipients))).toString("base64url");
}

export async function openSealedKey(sealed: string, identities: KeyObject[]): Promise<Buffer> {
  return runThrough(Buffer.from(sealed, "base64url"), createDecryptStream(identities));
}

/** Alıcı kümesinin kararlı imzası — değişince emanet yeniden mühürlenir. */
export function recipientSetSignature(recipients: Array<{ publicRaw: Buffer }>): string {
  return recipients.map((r) => fingerprint(r.publicRaw)).sort().join(",");
}
