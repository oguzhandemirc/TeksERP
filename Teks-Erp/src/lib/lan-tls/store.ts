// LAN TLS sertifika deposu (docs/design/LAN-TLS.md §3). Lisans deposuyla aynı yükleme kuralı:
// yok → üret · bozuk/çift uyuşmuyor → kenara al + üret (parmak izi değişir, istemciler yeniden eşleşir)
// · okunamıyor → ÜRETME (sessiz anahtar değişimi yok; TLS dinleyicisi açılmaz).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createPrivateKey, createPublicKey, generateKeyPairSync, X509Certificate, type KeyObject } from "node:crypto";
import { readFileState, writeFileAtomicSync } from "../license/store-files";
import { buildSelfSignedCertificate, certificateFingerprint, derToPem } from "./x509";

export const LAN_TLS_FILES = { KEY: "anahtar.pem", CERT: "sertifika.pem" } as const;
const MAX_PEM_BYTES = 64 * 1024;
// Takvim yılı; 2050 sonrası bitiş GeneralizedTime ile yazılır (x509.ts). Sertifika değişimi yalnız bilinçli
// (çalınma/sunucu değişimi) ve bütün cihazların yeniden eşleşmesi demektir — süre bunu zorlamasın.
export const LAN_TLS_VALIDITY_YEARS = 30;

export type LanTlsStoreResult =
  | {
      ok: true;
      keyPem: string;
      certPem: string;
      fingerprint: string;
      /** Bu açılışta yeni sertifika üretildi mi. */
      generated: boolean;
      /** Bozuk bulunup kenara alınan dosyalar (yeni parmak izi = istemciler yeniden eşleşir). */
      setAside: string[];
    }
  | { ok: false; problem: string };

function parsePair(keyPem: string, certPem: string): { fingerprint: string } | null {
  try {
    const key = createPrivateKey(keyPem);
    const cert = new X509Certificate(certPem);
    const certSpki = cert.publicKey.export({ format: "der", type: "spki" });
    const keySpki = createPublicKey(key).export({ format: "der", type: "spki" });
    if (!certSpki.equals(keySpki) || !cert.verify(cert.publicKey)) return null;
    return { fingerprint: certificateFingerprint(cert.raw) };
  } catch {
    return null;
  }
}

function addUtcYears(d: Date, years: number): Date {
  const out = new Date(d.getTime());
  out.setUTCFullYear(out.getUTCFullYear() + years);
  return out;
}

function generate(dir: string, now: Date): { keyPem: string; certPem: string; fingerprint: string } {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const host = os.hostname();
  const der = buildSelfSignedCertificate({
    privateKey: privateKey as KeyObject,
    commonName: `TeksERP ${host}`.slice(0, 64),
    altNames: [host, "localhost", "127.0.0.1"],
    notBefore: new Date(now.getTime() - 24 * 3600 * 1000), // istemci saati biraz geride olabilir
    notAfter: addUtcYears(now, LAN_TLS_VALIDITY_YEARS),
  });
  const keyPem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  const certPem = derToPem(der);
  writeFileAtomicSync(path.join(dir, LAN_TLS_FILES.KEY), keyPem, 0o600);
  writeFileAtomicSync(path.join(dir, LAN_TLS_FILES.CERT), certPem, 0o644);
  return { keyPem, certPem, fingerprint: certificateFingerprint(der) };
}

export function loadOrCreateLanTlsStore(dir: string, now: Date = new Date()): LanTlsStoreResult {
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  } catch {
    return { ok: false, problem: `dizin yazılamadı: ${dir}` };
  }
  const keyFile = path.join(dir, LAN_TLS_FILES.KEY);
  const certFile = path.join(dir, LAN_TLS_FILES.CERT);
  const keyRead = readFileState(keyFile, MAX_PEM_BYTES);
  const certRead = readFileState(certFile, MAX_PEM_BYTES);
  for (const [file, r] of [[keyFile, keyRead], [certFile, certRead]] as const) {
    if (r.kind === "OKUNAMADI" || r.kind === "BUYUK") {
      return { ok: false, problem: `${path.basename(file)} okunamıyor — yeni sertifika ÜRETİLMEDİ` };
    }
  }
  try {
    if (keyRead.kind === "METIN" && certRead.kind === "METIN") {
      const pair = parsePair(keyRead.text, certRead.text);
      if (pair) {
        return { ok: true, keyPem: keyRead.text, certPem: certRead.text, fingerprint: pair.fingerprint, generated: false, setAside: [] };
      }
    }
    // Biri yok, boş ya da çift tutarsız: var olanları kenara al, yenisini üret.
    const setAside: string[] = [];
    const stamp = now.getTime();
    for (const [file, r] of [[keyFile, keyRead], [certFile, certRead]] as const) {
      if (r.kind === "YOK") continue;
      const aside = `${file}.bozuk-${stamp}`;
      fs.renameSync(file, aside);
      setAside.push(aside);
    }
    const fresh = generate(dir, now);
    return { ok: true, ...fresh, generated: true, setAside };
  } catch (err) {
    return { ok: false, problem: `sertifika yazılamadı: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** Parmak izini gözle karşılaştırma biçimi: 4'lük gruplar, büyük harf (`AB12 CD34 …`). */
export function formatFingerprintGroups(hex: string): string {
  return (hex.toUpperCase().match(/.{1,4}/g) ?? []).join(" ");
}
