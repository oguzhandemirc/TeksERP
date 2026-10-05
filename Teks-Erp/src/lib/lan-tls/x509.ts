// Kendinden imzalı X.509 v3 sertifika kurucu (ECDSA P-256 / SHA-256), bağımlılıksız.
// Node `crypto` sertifika okur ama ÜRETEMEZ; istemci kimliği adreste değil parmak izinde
// tuttuğu için (docs/design/LAN-TLS.md §3) minimal bir DER kurucu yeterlidir.
import { createHash, createPublicKey, randomBytes, sign, type KeyObject } from "node:crypto";
import { isIP } from "node:net";

function derLength(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  for (let v = n; v > 0; v = Math.floor(v / 256)) bytes.unshift(v & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function tlv(tag: number, content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), derLength(content.length), content]);
}

const seq = (...parts: Buffer[]): Buffer => tlv(0x30, Buffer.concat(parts));
const set = (...parts: Buffer[]): Buffer => tlv(0x31, Buffer.concat(parts));
const octets = (b: Buffer): Buffer => tlv(0x04, b);
const bitString = (b: Buffer): Buffer => tlv(0x03, Buffer.concat([Buffer.from([0]), b]));
const explicit = (n: number, inner: Buffer): Buffer => tlv(0xa0 | n, inner);

function oid(dotted: string): Buffer {
  const parts = dotted.split(".").map(Number);
  const out: number[] = [parts[0] * 40 + parts[1]];
  for (const p of parts.slice(2)) {
    const chunk: number[] = [p & 0x7f];
    for (let v = Math.floor(p / 128); v > 0; v = Math.floor(v / 128)) chunk.unshift(0x80 | (v & 0x7f));
    out.push(...chunk);
  }
  return tlv(0x06, Buffer.from(out));
}

/** Pozitif INTEGER: baştaki sıfırlar atılır, yüksek bit doluysa 0x00 eklenir. */
function unsignedInteger(raw: Buffer): Buffer {
  let i = 0;
  while (i < raw.length - 1 && raw[i] === 0) i++;
  const trimmed = raw.subarray(i);
  return tlv(0x02, trimmed[0] & 0x80 ? Buffer.concat([Buffer.from([0]), trimmed]) : trimmed);
}

/** RFC 5280 §4.1.2.5: 2050 öncesi UTCTime, sonrası GeneralizedTime. */
function time(d: Date): Buffer {
  const iso = d.toISOString().replace(/[-:T]/g, "").slice(0, 14) + "Z"; // YYYYMMDDHHMMSSZ
  return d.getUTCFullYear() < 2050 ? tlv(0x17, Buffer.from(iso.slice(2), "ascii")) : tlv(0x18, Buffer.from(iso, "ascii"));
}

function name(commonName: string): Buffer {
  const rdn = (type: string, value: string): Buffer => set(seq(oid(type), tlv(0x0c, Buffer.from(value, "utf8"))));
  return seq(rdn("2.5.4.10", "TeksERP"), rdn("2.5.4.3", commonName));
}

/** dNSName yalnız ASCII ana makine adı taşır; uymayan ad SAN'a girmez (kimlik parmak izinde). */
const DNS_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,62})(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}))*$/;

function subjectAltName(names: readonly string[]): Buffer {
  const entries: Buffer[] = [];
  for (const n of names) {
    const fam = isIP(n);
    if (fam === 4) entries.push(tlv(0x87, Buffer.from(n.split(".").map(Number))));
    else if (fam === 0 && DNS_NAME.test(n)) entries.push(tlv(0x82, Buffer.from(n, "ascii")));
  }
  return seq(...entries);
}

function extension(id: string, critical: boolean, value: Buffer): Buffer {
  return seq(oid(id), ...(critical ? [tlv(0x01, Buffer.from([0xff]))] : []), octets(value));
}

export interface SelfSignedInput {
  privateKey: KeyObject;
  commonName: string;
  altNames: readonly string[];
  notBefore: Date;
  notAfter: Date;
  serial?: Buffer;
}

/** Sertifikanın DER baytları. Anahtar EC P-256 değilse atar. */
export function buildSelfSignedCertificate(input: SelfSignedInput): Buffer {
  const { privateKey } = input;
  if (privateKey.asymmetricKeyType !== "ec" || privateKey.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
    throw new Error("LAN TLS anahtarı EC P-256 olmalı");
  }
  const spki = createPublicKey(privateKey).export({ format: "der", type: "spki" });
  const sigAlg = seq(oid("1.2.840.10045.4.3.2")); // ecdsa-with-SHA256, parametresiz
  const serial = input.serial ?? randomBytes(16);
  const subjectKeyId = createHash("sha1").update(spki).digest();
  const tbs = seq(
    explicit(0, tlv(0x02, Buffer.from([2]))), // v3
    unsignedInteger(serial),
    sigAlg,
    name(input.commonName),
    seq(time(input.notBefore), time(input.notAfter)),
    name(input.commonName),
    spki,
    explicit(
      3,
      seq(
        extension("2.5.29.19", true, seq()), // basicConstraints: CA değil
        extension("2.5.29.15", true, tlv(0x03, Buffer.from([0x07, 0x80]))), // keyUsage: digitalSignature
        extension("2.5.29.37", false, seq(oid("1.3.6.1.5.5.7.3.1"))), // extKeyUsage: serverAuth
        extension("2.5.29.14", false, octets(subjectKeyId)),
        extension("2.5.29.17", false, subjectAltName(input.altNames)),
      ),
    ),
  );
  const signature = sign("sha256", tbs, { key: privateKey, dsaEncoding: "der" });
  return seq(tbs, sigAlg, bitString(signature));
}

/** Parmak izi = sertifika DER'inin SHA-256'sı, küçük harf onaltılık (istemcilerin karşılaştırdığı değer). */
export function certificateFingerprint(der: Buffer): string {
  return createHash("sha256").update(der).digest("hex");
}

export function derToPem(der: Buffer): string {
  const b64 = der.toString("base64").match(/.{1,64}/g) ?? [];
  return `-----BEGIN CERTIFICATE-----\n${b64.join("\n")}\n-----END CERTIFICATE-----\n`;
}
