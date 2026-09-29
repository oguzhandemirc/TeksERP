// Lisans kimliği TEK DİKİŞ taraması (D14 · I3-2 V1): imzalı istek, zil, patron bulutu eşitleme ve
// gelen kutusu lisans kimliğini `getLicenseInstallationId` (= anlık görüntünün `licenseId`si,
// LICENSE_DIR) üzerinden okur; DB `installationId`si yalnız BEYANLI bilgi yüzeylerinde okunur.
// `test_lisans_motoru` §21 bu taramanın sonucunu ölçer (DB'siz, saf metin).
import fs from "node:fs";
import path from "node:path";

const SRC = path.resolve(__dirname, "../../src");

/** DB olgularını (`getLicenseDbFacts`) okuyabilen dosyalar — her biri kimlik DEĞİL bilgi yüzeyi. */
export const DB_FACTS_READERS: Readonly<Record<string, string>> = {
  "lib/license/runtime.ts": "olguların sahibi; `hazir` yüklemi DB kimliğinin VARLIĞINA bakar, değerine değil",
  "services/license-view.service.ts": "Lisans ekranı `detay.kurulum.veritabaniKimligi` (yalnız bilgi)",
  "services/helpers/license-wire.helper.ts": "`ortam.installationId` satıcıya ipucu (yalnız bilgi, imzada yok)",
};

/** Lisans kimliğini kullanan kanallar: DB kimliği kaynağını (olgular / kimlik işi) hiç almamalı. */
export const IDENTITY_CHANNEL_FILES: readonly string[] = [
  "cloud-sync/eligibility.ts",
  "cloud-sync/sync-round.ts",
  "cloud-sync/cloud-client.ts",
  "jobs/cloud-sync.job.ts",
  "jobs/cloud-inbox.job.ts",
  "jobs/license-doorbell.job.ts",
  "services/patron-cloud.service.ts",
];

const DB_ID_SOURCES = /\b(getLicenseDbFacts|getCachedInstallationIdentity|ensureInstallationIdentity)\b|\bidentity\.installationId\b/;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

export interface SeamScan {
  /** `getLicenseDbFacts(` çağıran ama beyanlı okuyucu olmayan dosyalar. */
  readonly undeclaredDbFactsReaders: string[];
  /** Beyanlı ama artık okumayan (ölü beyan) dosyalar. */
  readonly staleDeclarations: string[];
  /** Kimlik kanalında DB kimliği kaynağı geçen dosyalar. */
  readonly channelViolations: string[];
  /** Var olmayan kanal dosyası (yeniden adlandırma: tarama körleşmesin). */
  readonly missingChannelFiles: string[];
  /** `getLicenseInstallationId` gövdesi anlık görüntünün `licenseId`sini okuyor ve DB olgusuna dokunmuyor mu. */
  readonly seamReadsLicenseStore: boolean;
}

export function scanLicenseIdentitySeam(root: string = SRC): SeamScan {
  const files = walk(root).map((f) => path.relative(root, f).split(path.sep).join("/"));
  const readers = files.filter((rel) => {
    const text = fs.readFileSync(path.join(root, rel), "utf8");
    return rel === "lib/license/runtime.ts" ? /\bfacts\.installationId\b/.test(text) : /\bgetLicenseDbFacts\s*\(/.test(text);
  });
  const channelViolations = IDENTITY_CHANNEL_FILES.filter((rel) => {
    const p = path.join(root, rel);
    return fs.existsSync(p) && DB_ID_SOURCES.test(fs.readFileSync(p, "utf8"));
  });
  const runtime = fs.readFileSync(path.join(root, "lib/license/runtime.ts"), "utf8");
  const body = /export function getLicenseInstallationId\(\)[^{]*\{([\s\S]*?)\n\}/.exec(runtime)?.[1] ?? "";
  return {
    undeclaredDbFactsReaders: readers.filter((r) => !(r in DB_FACTS_READERS)),
    staleDeclarations: Object.keys(DB_FACTS_READERS).filter((r) => !readers.includes(r)),
    channelViolations,
    missingChannelFiles: IDENTITY_CHANNEL_FILES.filter((rel) => !fs.existsSync(path.join(root, rel))),
    seamReadsLicenseStore: /getLicenseSnapshot\(\)\.licenseId/.test(body) && !/\bfacts\b|getLicenseDbFacts/.test(body),
  };
}
