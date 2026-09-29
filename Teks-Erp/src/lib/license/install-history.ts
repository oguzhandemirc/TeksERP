// Kurulum GEÇMİŞİ okuyucusu — `kur.ps1` her kurulumda/geri almada kurulum köküne (LICENSE_DIR'in
// yanı, app\ DIŞI) bir JSON satırı EKLER; backend yoklamada son N geçerli satırı satıcıya taşır.
// Dosya yazılmaz, yalnız okunur. Biçimsiz satır atlanır (tek bozuk satır geçmişi susturmaz).
import fs from "node:fs";
import path from "node:path";
import { INSTALL_HISTORY_FILE_NAME, INSTALL_RECORD_LIMIT, InstallRecordSchema, type InstallRecord } from "./protocol";

/** Sondan okunan azami bayt — dosya büyüse de yoklama maliyeti sabit kalır. */
const TAIL_BYTES = 64 * 1024;

export function installHistoryPath(licenseDir: string): string {
  return path.join(path.dirname(path.resolve(licenseDir)), INSTALL_HISTORY_FILE_NAME);
}

function readTail(file: string): string | null {
  let fd: number | null = null;
  try {
    fd = fs.openSync(file, "r");
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    const text = buf.toString("utf8");
    // Kesilen ilk satır yarımdır: baştan okunmadıysa ilk satır sonuna kadar atlanır.
    return start > 0 ? text.slice(text.indexOf("\n") + 1) : text;
  } catch {
    return null;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

/** Son `limit` GEÇERLİ kayıt (eskiden yeniye); aynı `kayitId`nin son hâli kalır. Dosya yoksa boş. */
export function readInstallHistory(file: string, limit: number = INSTALL_RECORD_LIMIT): InstallRecord[] {
  const text = readTail(file);
  if (!text) return [];
  const byId = new Map<string, InstallRecord>();
  for (const line of text.replace(/^﻿/, "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const parsed = InstallRecordSchema.safeParse(raw);
    if (!parsed.success) continue;
    byId.delete(parsed.data.kayitId);
    byId.set(parsed.data.kayitId, parsed.data);
  }
  return [...byId.values()].slice(-limit);
}
