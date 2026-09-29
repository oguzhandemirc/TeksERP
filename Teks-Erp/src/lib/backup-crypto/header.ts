// =============================================================================
// Yedek şifreleme — `.tkenc` başlığı (anahtarsız okunur): şifreli mi, kimler açar,
// yapısı sağlam mı. İçerik bütünlüğü anahtar ister (`stream.ts`).
// =============================================================================

import fs from "fs";
import {
  BackupCryptoError,
  CHUNK_SIZE,
  HEADER_MAC_SIZE,
  MAX_HEADER_BYTES,
  PAYLOAD_SALT_SIZE,
  TAG_SIZE,
  TKENC_MAGIC,
  TKENC_VERSION,
  type TkencHeader,
} from "./format";

function validateHeader(j: unknown): TkencHeader {
  const h = j as Partial<TkencHeader>;
  const ok =
    h.surum === TKENC_VERSION &&
    h.parca === CHUNK_SIZE &&
    typeof h.olusturma === "string" &&
    Array.isArray(h.alicilar) &&
    h.alicilar.length > 0 &&
    h.alicilar.every(
      (a) =>
        a &&
        typeof a.ad === "string" &&
        typeof a.parmakIzi === "string" &&
        typeof a.epk === "string" &&
        typeof a.sarili === "string",
    );
  if (!ok) throw new BackupCryptoError("BICIM", "Şifreli yedeğin başlığı tanınmıyor (sürüm ya da alanlar).");
  return h as TkencHeader;
}

// -----------------------------------------------------------------------------
// Başlık okuma (anahtarsız) — "şifreli mi", "kimler açar", "yapısı sağlam mı"
// -----------------------------------------------------------------------------

export interface HeaderInfo {
  header: TkencHeader;
  /** Sihir + uzunluk + başlık + MAC + yük tuzu — yükün başladığı ofset. */
  prefixLength: number;
}

export function parsePrefix(buf: Buffer): HeaderInfo | "eksik" {
  if (buf.length < TKENC_MAGIC.length + 4) return "eksik";
  if (!buf.subarray(0, TKENC_MAGIC.length).equals(TKENC_MAGIC)) {
    throw new BackupCryptoError("BICIM", "Dosya şifreli yedek değil (sihirli bayt yok).");
  }
  const jsonLen = buf.readUInt32BE(TKENC_MAGIC.length);
  if (jsonLen === 0 || jsonLen > MAX_HEADER_BYTES) {
    throw new BackupCryptoError("BICIM", "Şifreli yedeğin başlık uzunluğu geçersiz.");
  }
  const jsonEnd = TKENC_MAGIC.length + 4 + jsonLen;
  const prefixLength = jsonEnd + HEADER_MAC_SIZE + PAYLOAD_SALT_SIZE;
  if (buf.length < prefixLength) return "eksik";
  let parsed: unknown;
  try {
    parsed = JSON.parse(buf.subarray(TKENC_MAGIC.length + 4, jsonEnd).toString("utf8"));
  } catch {
    throw new BackupCryptoError("BICIM", "Şifreli yedeğin başlığı okunamadı.");
  }
  return { header: validateHeader(parsed), prefixLength };
}

/** İlk 8 bayt sihir mi? Okunamazsa `false` (çağıran dosyayı ayrıca ele alır). */
export async function isEncryptedBackup(file: string): Promise<boolean> {
  let fh: fs.promises.FileHandle | null = null;
  try {
    fh = await fs.promises.open(file, "r");
    const b = Buffer.alloc(TKENC_MAGIC.length);
    const { bytesRead } = await fh.read(b, 0, b.length, 0);
    return bytesRead === b.length && b.equals(TKENC_MAGIC);
  } catch {
    return false;
  } finally {
    await fh?.close().catch(() => {});
  }
}

export async function readHeader(file: string): Promise<HeaderInfo> {
  const fh = await fs.promises.open(file, "r");
  try {
    const first = Buffer.alloc(TKENC_MAGIC.length + 4);
    const r1 = await fh.read(first, 0, first.length, 0);
    const p1 = parsePrefix(first.subarray(0, r1.bytesRead));
    if (p1 !== "eksik") return p1;
    if (r1.bytesRead < first.length) throw new BackupCryptoError("KESIK", "Şifreli yedek yarım (başlık eksik).");
    const need = TKENC_MAGIC.length + 4 + first.readUInt32BE(TKENC_MAGIC.length) + HEADER_MAC_SIZE + PAYLOAD_SALT_SIZE;
    const all = Buffer.alloc(need);
    const r2 = await fh.read(all, 0, need, 0);
    const p2 = parsePrefix(all.subarray(0, r2.bytesRead));
    if (p2 === "eksik") throw new BackupCryptoError("KESIK", "Şifreli yedek yarım (başlık eksik).");
    return p2;
  } finally {
    await fh.close();
  }
}

/**
 * Anahtarsız yapısal denetim: başlık okunur ve yük boyu parça düzenine uyar mı bakılır.
 * Etiketleri doğrulamaz (anahtar gerekir) — tam bütünlük `decryptFile`/`verifyEncrypted`.
 */
export async function inspectEncrypted(file: string): Promise<{ header: TkencHeader; payloadBytes: number }> {
  const info = await readHeader(file);
  const size = (await fs.promises.stat(file)).size;
  const payload = size - info.prefixLength;
  const full = CHUNK_SIZE + TAG_SIZE;
  const lastLen = payload <= 0 ? 0 : ((payload - 1) % full) + 1;
  if (payload < TAG_SIZE || lastLen < TAG_SIZE) {
    throw new BackupCryptoError("KESIK", "Şifreli yedek yarım (parça düzeni tutmuyor).");
  }
  return { header: info.header, payloadBytes: payload };
}
