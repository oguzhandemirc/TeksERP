// =============================================================================
// Yedek şifreleme — akış şifreleme/çözme (`.tkenc`)
// =============================================================================
// Bellek sabit kalır: dosya 64 KiB'lik parçalar hâlinde işlenir, çok GB'lık döküm
// belleğe alınmaz. Son parça IV'deki bayrakla işaretlenir; dosya kesilirse ya da
// parçalar yer değiştirirse GCM etiketi tutmaz → "kurcalanmış/yarım" teşhisi.
// =============================================================================

import crypto, { type KeyObject } from "crypto";
import fs from "fs";
import { Transform, Writable, type TransformCallback } from "stream";
import { pipeline } from "stream/promises";
import {
  BackupCryptoError,
  CHUNK_SIZE,
  HEADER_MAC_SIZE,
  HKDF_INFO_HEADER_MAC,
  HKDF_INFO_PAYLOAD,
  HKDF_INFO_WRAP,
  MAX_HEADER_BYTES,
  PAYLOAD_SALT_SIZE,
  TAG_SIZE,
  TKENC_MAGIC,
  TKENC_VERSION,
  type TkencHeader,
  type TkencRecipientStanza,
} from "./format";
import { b64u, fingerprint, fromB64u, publicKeyFromRaw, rawPublic } from "./keys";
import { parsePrefix } from "./header";

export interface Recipient {
  ad: string;
  publicRaw: Buffer;
}

const hkdf = (ikm: Buffer, salt: Buffer, info: string): Buffer =>
  Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from(info, "utf8"), 32));

function nonceFor(counter: number, last: boolean): Buffer {
  const n = Buffer.alloc(12);
  n.writeBigUInt64BE(BigInt(counter), 3); // 11 bayt BE sayaç (üst 3 bayt sıfır)
  n[11] = last ? 1 : 0;
  return n;
}

function wrapFor(r: Recipient, fileKey: Buffer): TkencRecipientStanza {
  const eph = crypto.generateKeyPairSync("x25519");
  const ephPub = rawPublic(eph.publicKey);
  const shared = crypto.diffieHellman({ privateKey: eph.privateKey, publicKey: publicKeyFromRaw(r.publicRaw) });
  if (shared.every((b) => b === 0)) throw new BackupCryptoError("ANAHTAR_BICIMI", `Alıcı anahtarı geçersiz: ${r.ad}`);
  const wrapKey = hkdf(shared, Buffer.concat([ephPub, r.publicRaw]), HKDF_INFO_WRAP);
  const c = crypto.createCipheriv("aes-256-gcm", wrapKey, Buffer.alloc(12));
  const sarili = Buffer.concat([c.update(fileKey), c.final(), c.getAuthTag()]);
  return { ad: r.ad, parmakIzi: fingerprint(r.publicRaw), epk: b64u(ephPub), sarili: b64u(sarili) };
}

/** Kimliğe (özel anahtar) karşılık gelen sarmayı açar; bulamazsa `null`. */
function unwrapWith(stanzas: TkencRecipientStanza[], identity: KeyObject): Buffer | null {
  const myPub = rawPublic(crypto.createPublicKey(identity));
  const myFp = fingerprint(myPub);
  // Parmak izi eşleşeni önce dene; ad/iz başlıkta düz yazılı olduğu için tek başına güvenilmez.
  const ordered = [...stanzas].sort((a, b) => Number(b.parmakIzi === myFp) - Number(a.parmakIzi === myFp));
  for (const s of ordered) {
    try {
      const ephPub = fromB64u(s.epk, 32);
      const shared = crypto.diffieHellman({ privateKey: identity, publicKey: publicKeyFromRaw(ephPub) });
      const wrapKey = hkdf(shared, Buffer.concat([ephPub, myPub]), HKDF_INFO_WRAP);
      const w = fromB64u(s.sarili, 48);
      const d = crypto.createDecipheriv("aes-256-gcm", wrapKey, Buffer.alloc(12));
      d.setAuthTag(w.subarray(32));
      return Buffer.concat([d.update(w.subarray(0, 32)), d.final()]);
    } catch {
      // bu sarma bu kimliğin değil — sıradakine
    }
  }
  return null;
}

function headerMac(fileKey: Buffer, prefix: Buffer): Buffer {
  return crypto.createHmac("sha256", hkdf(fileKey, Buffer.alloc(0), HKDF_INFO_HEADER_MAC)).update(prefix).digest();
}

// -----------------------------------------------------------------------------
// Şifreleme
// -----------------------------------------------------------------------------

class EncryptTransform extends Transform {
  private pending: Buffer[] = [];
  private pendingLen = 0;
  private counter = 0;
  constructor(private readonly key: Buffer, private readonly prefix: Buffer) {
    super();
    this.push(prefix);
  }
  private seal(pt: Buffer, last: boolean): void {
    const c = crypto.createCipheriv("aes-256-gcm", this.key, nonceFor(this.counter++, last));
    this.push(Buffer.concat([c.update(pt), c.final(), c.getAuthTag()]));
  }
  override _transform(chunk: Buffer, _e: BufferEncoding, cb: TransformCallback): void {
    this.pending.push(chunk);
    this.pendingLen += chunk.length;
    // Tam bir parçadan FAZLASI birikince yaz: son parçanın hangisi olduğu ancak akış bitince bilinir.
    if (this.pendingLen > CHUNK_SIZE) {
      let buf = Buffer.concat(this.pending);
      while (buf.length > CHUNK_SIZE) {
        this.seal(buf.subarray(0, CHUNK_SIZE), false);
        buf = buf.subarray(CHUNK_SIZE);
      }
      this.pending = [buf];
      this.pendingLen = buf.length;
    }
    cb();
  }
  override _flush(cb: TransformCallback): void {
    this.seal(Buffer.concat(this.pending), true);
    cb();
  }
}

/** Başlığı kurar; dönen akış düz metni alıp `.tkenc` baytlarını üretir. */
export function createEncryptStream(recipients: Recipient[]): Transform {
  if (recipients.length === 0) throw new BackupCryptoError("ALICI_YOK", "Şifreleme için en az bir alıcı gerekli.");
  const fileKey = crypto.randomBytes(32);
  const header: TkencHeader = {
    surum: TKENC_VERSION,
    parca: CHUNK_SIZE,
    olusturma: new Date().toISOString(),
    alicilar: recipients.map((r) => wrapFor(r, fileKey)),
  };
  const json = Buffer.from(JSON.stringify(header), "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(json.length, 0);
  const signed = Buffer.concat([TKENC_MAGIC, len, json]);
  const salt = crypto.randomBytes(PAYLOAD_SALT_SIZE);
  const prefix = Buffer.concat([signed, headerMac(fileKey, signed), salt]);
  const payloadKey = hkdf(fileKey, salt, HKDF_INFO_PAYLOAD);
  fileKey.fill(0);
  return new EncryptTransform(payloadKey, prefix);
}

/** `src`'yi `dst`'ye şifreler. `dst` yeni yaratılır (`wx`); yarım kalırsa silinir. */
export async function encryptFile(src: string, dst: string, recipients: Recipient[]): Promise<void> {
  const enc = createEncryptStream(recipients);
  try {
    await pipeline(fs.createReadStream(src), enc, fs.createWriteStream(dst, { flags: "wx", mode: 0o600 }));
  } catch (e) {
    await fs.promises.rm(dst, { force: true }).catch(() => {});
    throw e;
  }
}

// -----------------------------------------------------------------------------
// Çözme
// -----------------------------------------------------------------------------

class DecryptTransform extends Transform {
  private buf: Buffer = Buffer.alloc(0);
  private key: Buffer | null = null;
  private counter = 0;
  /** Çözülen başlık — çağıran hangi alıcının açtığını raporlayabilsin. */
  header: TkencHeader | null = null;
  constructor(private readonly identities: KeyObject[]) {
    super();
  }
  private open(ct: Buffer, last: boolean): Buffer {
    const d = crypto.createDecipheriv("aes-256-gcm", this.key!, nonceFor(this.counter++, last));
    d.setAuthTag(ct.subarray(ct.length - TAG_SIZE));
    try {
      return Buffer.concat([d.update(ct.subarray(0, ct.length - TAG_SIZE)), d.final()]);
    } catch {
      throw new BackupCryptoError(
        "KURCALANMIS",
        "Şifreli yedeğin bütünlüğü bozuk — dosya kurcalanmış ya da yarım (parça doğrulanamadı).",
      );
    }
  }
  private tryHeader(): void {
    const p = parsePrefix(this.buf);
    if (p === "eksik") return;
    const signedLen = p.prefixLength - HEADER_MAC_SIZE - PAYLOAD_SALT_SIZE;
    let fileKey: Buffer | null = null;
    for (const id of this.identities) {
      fileKey = unwrapWith(p.header.alicilar, id);
      if (fileKey) break;
    }
    if (!fileKey) {
      const recipientList = p.header.alicilar.map((a) => `${a.ad} (${a.parmakIzi})`).join(", ");
      throw new BackupCryptoError(
        "YANLIS_ANAHTAR",
        `Verilen anahtar bu yedeği açamıyor. Yedeğin alıcıları: ${recipientList}.`,
      );
    }
    const mac = this.buf.subarray(signedLen, signedLen + HEADER_MAC_SIZE);
    if (!crypto.timingSafeEqual(mac, headerMac(fileKey, this.buf.subarray(0, signedLen)))) {
      throw new BackupCryptoError("KURCALANMIS", "Şifreli yedeğin başlığı kurcalanmış (MAC tutmuyor).");
    }
    const salt = this.buf.subarray(signedLen + HEADER_MAC_SIZE, p.prefixLength);
    this.key = hkdf(fileKey, salt, HKDF_INFO_PAYLOAD);
    fileKey.fill(0);
    this.header = p.header;
    this.buf = this.buf.subarray(p.prefixLength);
  }
  override _transform(chunk: Buffer, _e: BufferEncoding, cb: TransformCallback): void {
    try {
      this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
      if (!this.key) this.tryHeader();
      if (this.key) {
        const full = CHUNK_SIZE + TAG_SIZE;
        // Yalnız ardında veri olduğu KESİN parçaları aç — son parça flush'ta.
        while (this.buf.length > full) {
          this.push(this.open(this.buf.subarray(0, full), false));
          this.buf = this.buf.subarray(full);
        }
      }
      cb();
    } catch (e) {
      cb(e as Error);
    }
  }
  override _flush(cb: TransformCallback): void {
    try {
      if (!this.key) throw new BackupCryptoError("KESIK", "Şifreli yedek yarım (başlık eksik).");
      if (this.buf.length < TAG_SIZE) throw new BackupCryptoError("KESIK", "Şifreli yedek yarım (son parça eksik).");
      const pt = this.open(this.buf, true);
      // Boş son parça yalnız tamamen boş dosyada meşrudur (age kuralı).
      if (pt.length === 0 && this.counter > 1) {
        throw new BackupCryptoError("KURCALANMIS", "Şifreli yedeğin son parçası geçersiz.");
      }
      this.push(pt);
      this.key.fill(0);
      cb();
    } catch (e) {
      cb(e as Error);
    }
  }
}

export function createDecryptStream(identities: KeyObject[]): DecryptTransform {
  return new DecryptTransform(identities);
}

export type { DecryptTransform };

/** `src` (.tkenc) → `dst` (düz). `dst` yeni yaratılır; hata olursa silinir — yarım düz döküm kalmaz. */
export async function decryptFile(src: string, dst: string, identities: KeyObject[]): Promise<TkencHeader> {
  const dec = createDecryptStream(identities);
  try {
    await pipeline(fs.createReadStream(src), dec, fs.createWriteStream(dst, { flags: "wx", mode: 0o600 }));
  } catch (e) {
    await fs.promises.rm(dst, { force: true }).catch(() => {});
    throw e;
  }
  return dec.header!;
}

/** Tam bütünlük denetimi: çözer ama hiçbir yere yazmaz. Düz baytların sayısını döner. */
export async function verifyEncrypted(src: string, identities: KeyObject[]): Promise<{ header: TkencHeader; bytes: number }> {
  const dec = createDecryptStream(identities);
  let bytes = 0;
  await pipeline(
    fs.createReadStream(src),
    dec,
    new Writable({
      write(chunk: Buffer, _e, cb) {
        bytes += chunk.length;
        cb();
      },
    }),
  );
  return { header: dec.header!, bytes };
}
