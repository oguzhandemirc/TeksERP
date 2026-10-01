// SHA-256 (akışlı) + SHA-512 — denetlenmiş `@noble/hashes` (saf JS, `@noble/curves`un kendi bağımlılığı; aynı
// onay). Tablet APK künyesi için: kurulum dosyası belleğe alınmadan parça parça özetlenir.
// Kâhin: `kripto.test.ts` (node:crypto ile rastgele girdi + parça sınırları).
import { sha256 as nobleSha256, sha512 as nobleSha512 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

/** Akışlı SHA-256: `update` istediği kadar, `digest` bir kez. */
export class Sha256 {
  private readonly hasher = nobleSha256.create();
  private finished = false;

  update(data: Uint8Array): this {
    if (this.finished) throw new Error('Sha256: digest sonrası update');
    this.hasher.update(data);
    return this;
  }

  digest(): Uint8Array {
    if (this.finished) throw new Error('Sha256: ikinci digest');
    this.finished = true;
    return this.hasher.digest();
  }
}

export function sha256(data: Uint8Array): Uint8Array {
  return nobleSha256(data);
}

export function sha512(data: Uint8Array): Uint8Array {
  return nobleSha512(data);
}

export const hex = (b: Uint8Array): string => bytesToHex(b);
