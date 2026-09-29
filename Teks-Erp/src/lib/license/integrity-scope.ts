// İmzalı dosya listesinin KAPSAMI — tek kaynak: paketi imzalayan araç (`scripts/build-korumali-imza.ts`)
// listeyi buradan kurar, çalışan backend (`integrity-check.ts`) fazla dosyayı buradan arar.
// JWS 32 KB tavanı (`JWS_MAX_LENGTH`) yüzünden liste bütün paketi değil BİZİM kodu + çalışma
// zamanı ikililerini + SİSTEM hesabıyla koşan betikleri kapsar; üçüncü taraf `node_modules` ve
// kurulumda bir kez koşan migration SQL'i kapsam dışıdır (beyanlı, docs/kurallar/lisans.md).
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { b64uEncode } from "./protocol";

/** Paket kökündeki imzalı liste dosyası (JWS compact, `typ: tekserp-butunluk`). */
export const INTEGRITY_FILE = "butunluk.jws";

/** Altındaki HER dosya listede olmalı; listede olmayan dosya FAZLA sayılır. */
export const INTEGRITY_SCOPE_DIRS: readonly string[] = Object.freeze(["dist", "native", "runtime"]);

/** Kökteki tek tek dosyalar — varsa listeye girer (paket biçimi eskiyse eksik olabilir). */
export const INTEGRITY_SCOPE_FILES: readonly string[] = Object.freeze([
  "package.json",
  "package-lock.json",
  "ecosystem.config.js",
  "prisma.config.js",
  "prisma/schema.prisma",
  "kur.ps1",
  "ilk-kurulum.ps1",
  "yedekle.ps1",
  "pm2-boot.cmd",
  "uzaktan-kos.ps1",
  "bakim-rolu.ps1",
]);

/**
 * Hazırlık PAKET anahtarı yalnız TEST/DEMO paketlerini imzalar (üretim anahtarı `paket-<yıl>`,
 * Mac'te parolalı — ayrı tören). Sınıf kararı HAK'tan: ÜRETİM kurulumunda hazırlık imzası RED.
 */
export const STAGING_PACKAGE_KID_PREFIX = "paket-hazirlik";
export const STAGING_PACKAGE_CLASSES: readonly string[] = Object.freeze(["TEST", "DEMO"]);

export function isStagingPackageKid(kid: string): boolean {
  return kid === STAGING_PACKAGE_KID_PREFIX || kid.startsWith(`${STAGING_PACKAGE_KID_PREFIX}-`);
}

/** Göreli POSIX yol kapsamda mı (kapsam dizininin altı ya da kapsam dosyası). */
export function isInIntegrityScope(rel: string): boolean {
  if (INTEGRITY_SCOPE_FILES.includes(rel)) return true;
  return INTEGRITY_SCOPE_DIRS.some((d) => rel.startsWith(`${d}/`));
}

async function walk(root: string, rel: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(path.join(root, ...rel.split("/")), { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const child = `${rel}/${e.name}`;
    if (e.isDirectory()) await walk(root, child, out);
    else out.push(child);
  }
}

/** Kök altında kapsamdaki mevcut dosyalar, bayt sırasıyla sıralı (göreli POSIX). */
export async function listScopedFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  for (const d of INTEGRITY_SCOPE_DIRS) await walk(root, d, out);
  for (const f of INTEGRITY_SCOPE_FILES) {
    try {
      if ((await stat(path.join(root, ...f.split("/")))).isFile()) out.push(f);
    } catch {
      // yoksa listeye girmez
    }
  }
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export function sha256FileB64u(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(b64uEncode(hash.digest())));
  });
}

export interface IntegrityFileEntry {
  readonly yol: string;
  readonly sha256: string;
  readonly boyut: number;
}

export async function fileEntries(root: string, files: readonly string[]): Promise<IntegrityFileEntry[]> {
  const out: IntegrityFileEntry[] = [];
  for (const yol of files) {
    const full = path.join(root, ...yol.split("/"));
    out.push({ yol, sha256: await sha256FileB64u(full), boyut: (await stat(full)).size });
  }
  return out;
}
