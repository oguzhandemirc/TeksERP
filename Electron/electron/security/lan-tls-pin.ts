// Fabrika ağında TLS — panelin sertifika sabiti (docs/design/LAN-TLS.md §6). Chromium'un doğrulama kancası
// sabitli parmak izini kabul eder, gerisini Chromium'a bırakır; sabit yalnız ana süreçte yazılır.
import { X509Certificate, createHash } from "node:crypto";
import type { Session } from "electron";
import { certVerifyDecision, parseTlsPins, TLS_PIN_KEY, withPin, type TlsPin } from "../../shared/lan-tls.js";
import { readSecureValue, writeSecureValue } from "../ipc/secure-store.ipc.js";

let cache: TlsPin[] | null = null;

export function readTlsPins(): TlsPin[] {
  if (cache) return cache;
  try {
    cache = parseTlsPins(readSecureValue(TLS_PIN_KEY));
  } catch {
    cache = [];
  }
  return cache;
}

function writeTlsPins(pins: TlsPin[]): void {
  writeSecureValue(TLS_PIN_KEY, JSON.stringify(pins));
  cache = pins;
}

export function addTlsPin(pin: TlsPin): void {
  writeTlsPins(withPin(readTlsPins(), pin));
}

/** Kurulumun sabitini kaldırır (kullanıcının açık kararı: şifreli bağlantıdan vazgeç). */
export function removeTlsPins(installationId: string | null): void {
  writeTlsPins(readTlsPins().filter((p) => p.installationId !== installationId));
}

/** Sertifikanın DER SHA-256'sı; PEM okunamazsa Chromium'un `sha256/<base64>` değeri. */
function fingerprintOf(cert: { data: string; fingerprint: string }): string {
  try {
    return createHash("sha256").update(new X509Certificate(cert.data).raw).digest("hex");
  } catch {
    return cert.fingerprint;
  }
}

export function installLanTlsVerifier(ses: Session): void {
  ses.setCertificateVerifyProc((request, callback) => {
    callback(certVerifyDecision(readTlsPins(), fingerprintOf(request.certificate)));
  });
}
