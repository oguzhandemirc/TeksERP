// İmzalı bütünlük listesinin KAPSAMI — tek kaynak: paketi imzalayan araç (`scripts/lib/butunluk-imza.ts`)
// listeyi buradan kurar ve kapsamı imzalı yüke yazar; çalışan taraf (native + TS ikinci katman) FAZLA
// dosyayı imzalı yükteki kapsamda arar. Liste ayrı dosyada (`integrity-list.ts`) olduğundan JWS 32 KB
// tavanı kapsamı sınırlamaz: bizim kod + çalışma zamanı + üçüncü taraf node_modules + migration SQL'i.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, stat } from "node:fs/promises";
import path from "node:path";
import { CHAINED_INTEGRITY_FILE, b64uEncode } from "./protocol";
import { walkIntegrityScope, type IntegrityListEntry, type IntegrityScope } from "./integrity-list";

/** Paket kökündeki imzalı yük dosyası (JWS compact, `typ: tekserp-butunluk`). */
export const INTEGRITY_FILE = "butunluk.jws";

/** İmzalı yük dosyalarının OKUMA sırası (zincirli varsa o, yoksa bugünkü): yükleyici ve denetim aynı dosyayı okusun. */
export const INTEGRITY_TOKEN_FILES: readonly string[] = Object.freeze([CHAINED_INTEGRITY_FILE, INTEGRITY_FILE]);

/**
 * Altındaki HER dosya listede olmalı; listede olmayan dosya FAZLA sayılır. Pakette olmayan dizin
 * (ör. `-NodeModulesHaric`: node_modules sunucuda `npm ci` ile doğar) imzalı kapsama GİRMEZ.
 * `hizmet` (dizin/izin + hizmet kaydı betikleri) ve `gecis` (pm2 → hizmet geçişi) YÖNETİCİ/SYSTEM
 * olarak koşar: `runtime`daki iki Rust hizmet ikilisi gibi imzalı kapsamdadır (bekçi `test_paket_kapsami`).
 */
export const INTEGRITY_SCOPE_DIRS: readonly string[] = Object.freeze(["dist", "native", "runtime", "node_modules", "prisma/migrations", "hizmet", "gecis"]);

/**
 * Kökteki tek tek dosyalar — varsa listeye girer, yoksa sonradan belirmesi FAZLA'dır.
 * `ecosystem.config.js` BİLEREK yok: kur.ps1 yükseltmede sunucununkini korur (paketinki `.paket`).
 */
export const INTEGRITY_SCOPE_FILES: readonly string[] = Object.freeze([
  "package.json",
  "package-lock.json",
  "prisma.config.js",
  "prisma/schema.prisma",
  "kur.ps1",
  "ilk-kurulum.ps1",
  "yedekle.ps1",
  "pm2-boot.cmd",
  "uzaktan-kos.ps1",
  "bakim-rolu.ps1",
]);

/** Üretim PAKET anahtarının kid'i: `paket-<yıl>`, yıl içi rotasyonda `-<n>`; anahtar parolalıdır (tören). */
export function isProductionPackageKid(kid: string): boolean {
  return /^paket-\d{4}(?:-\d{1,3})?$/.test(kid);
}

/** Üretim zincirli PAKET anahtarının kid'i: `pkt-<yıl>-<n>` (kök imzalı PAKET sertifikalı, parolalı). */
export function isProductionChainPackageKid(kid: string): boolean {
  return /^pkt-\d{4}-\d{1,3}$/.test(kid);
}


/** İmzalanacak kapsam: pakette DİZİN olarak duran kapsam dizinleri + bütün kapsam dosyaları. */
export async function packageScope(root: string): Promise<IntegrityScope> {
  const dizinler: string[] = [];
  for (const d of INTEGRITY_SCOPE_DIRS) {
    try {
      if ((await stat(path.join(root, ...d.split("/")))).isDirectory()) dizinler.push(d);
    } catch {
      // pakette yok → kapsama girmez
    }
  }
  return { dizinler, dosyalar: [...INTEGRITY_SCOPE_FILES] };
}

/** Kapsamda mevcut dosyalar — çalışan tarafla AYNI yürüyüş (`walkIntegrityScope`); okunamayan dizin RED. */
export async function listScopedFiles(root: string, scope: IntegrityScope): Promise<string[]> {
  const w = await walkIntegrityScope(root, scope);
  if (w.unreadable.length > 0) throw new Error(`kapsamda okunamayan dizin: ${w.unreadable.slice(0, 5).join(", ")}`);
  return w.entries;
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

/** Liste girdileri; sembolik bağ ya da dosya olmayan girdi imzalanmaz (paket düz dosya taşır). */
export async function fileEntries(root: string, files: readonly string[]): Promise<IntegrityListEntry[]> {
  const out: IntegrityListEntry[] = [];
  for (const yol of files) {
    const full = path.join(root, ...yol.split("/"));
    const info = await lstat(full);
    if (!info.isFile()) throw new Error(`kapsamda dosya olmayan girdi: ${yol}`);
    out.push({ yol, sha256: await sha256FileB64u(full), boyut: info.size });
  }
  return out;
}
