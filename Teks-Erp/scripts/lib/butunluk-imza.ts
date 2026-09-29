// İmzalı dosya listesi — ÜRETİM tarafı (satıcı Mac'i). Kapsam ve dosya özeti tek kaynaktan
// (`src/lib/license/integrity-scope.ts`), liste biçimi `integrity-list.ts`, yük şeması `integrity.ts`,
// imza protokolün `signJws`i. Liste ayrı dosyadır (`butunluk-liste.txt`); JWS yalnız onun boyunu +
// sha256'sını imzalar. Her imza, yazılmadan ÖNCE aynı kökte çalışan tarafın denetimiyle doğrulanır.
import { createHash, generateKeyPairSync, createPrivateKey, randomUUID, type KeyObject } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { JWS_MAX_LENGTH, b64uEncode, publicKeyX, signJws } from "../../src/lib/license/protocol";
import { INTEGRITY_TYP, IntegrityManifestSchema, verifyIntegrity, type IntegrityManifest } from "../../src/lib/license/integrity";
import { INTEGRITY_LIST_FILE, formatIntegrityList, type IntegrityListEntry } from "../../src/lib/license/integrity-list";
import { INTEGRITY_FILE, fileEntries, listScopedFiles, packageScope } from "../../src/lib/license/integrity-scope";

export const PACKAGE_KEY_KIND = "tekserp-paket-anahtar";

export interface PackageKeyFile {
  readonly tur: typeof PACKAGE_KEY_KIND;
  readonly surum: 1;
  readonly kid: string;
  readonly x: string;
  /** Ham Ed25519 özel anahtarı (base64url). Hazırlık anahtarı parolasızdır (0600); üretim anahtarı ayrı tören. */
  readonly d: string;
  readonly siniflar: readonly string[];
  readonly olusturma: string;
}

export function generatePackageKey(kid: string, siniflar: readonly string[]): PackageKeyFile {
  const { privateKey } = generateKeyPairSync("ed25519");
  const jwk = privateKey.export({ format: "jwk" });
  if (typeof jwk.d !== "string" || typeof jwk.x !== "string") throw new Error("anahtar dışa aktarılamadı");
  return { tur: PACKAGE_KEY_KIND, surum: 1, kid, x: jwk.x, d: jwk.d, siniflar: [...siniflar], olusturma: new Date().toISOString() };
}

/** Anahtar dosyasını yazar: var olanı EZMEZ, izin 0600. */
export function writePackageKey(dir: string, key: PackageKeyFile): string {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `${key.kid}.paket.json`);
  fs.writeFileSync(file, `${JSON.stringify(key, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  return file;
}

export function readPackageKey(file: string): { kid: string; x: string; privateKey: KeyObject } {
  const mode = fs.statSync(file).mode & 0o777;
  if (process.platform !== "win32" && (mode & 0o077) !== 0) throw new Error(`anahtar dosyası başkalarına açık (${mode.toString(8)}) — chmod 600`);
  const k = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<PackageKeyFile>;
  if (k.tur !== PACKAGE_KEY_KIND || typeof k.kid !== "string" || typeof k.x !== "string" || typeof k.d !== "string") {
    throw new Error("PAKET anahtar dosyası biçimsiz");
  }
  const privateKey = createPrivateKey({ key: { kty: "OKP", crv: "Ed25519", x: k.x, d: k.d }, format: "jwk" });
  if (publicKeyX(privateKey) !== k.x) throw new Error("anahtar dosyasında x ile d uyuşmuyor");
  return { kid: k.kid, x: k.x, privateKey };
}

export interface SignInput {
  readonly root: string;
  readonly key: { readonly kid: string; readonly x: string; readonly privateKey: KeyObject };
  readonly urun: string;
  readonly surum: string;
  readonly derlemeTarihi: string;
  readonly musteri: string | null;
  readonly paketId?: string;
  /** Filigran: kurulum kimliği (varsa). v1 şeması bu ek anahtarı DOĞRULAMADA atar; imzalı içerikte durur. */
  readonly kurulumId?: string | null;
}

export interface SignResult {
  readonly token: string;
  readonly manifest: IntegrityManifest;
  readonly entries: readonly IntegrityListEntry[];
  readonly file: string;
  readonly listFile: string;
}

/**
 * Kapsamı ölçer, liste dosyasını (`butunluk-liste.txt`) ve imzalı yükü (`butunluk.jws`) yazar,
 * sonra çalışan tarafın denetimiyle doğrular; öz-denetim düşerse iki dosya da silinir.
 */
export async function signPackageDirectory(g: SignInput): Promise<SignResult> {
  const kapsam = await packageScope(g.root);
  const files = await listScopedFiles(g.root, kapsam);
  if (files.length === 0) throw new Error("kapsamda dosya yok — paket kökü mü?");
  const entries = await fileEntries(g.root, files);
  const listBytes = formatIntegrityList(entries);
  const manifest = IntegrityManifestSchema.parse({
    v: 1,
    paketId: g.paketId ?? randomUUID(),
    urun: g.urun,
    surum: g.surum,
    derlemeTarihi: g.derlemeTarihi,
    musteri: g.musteri,
    liste: { sha256: b64uEncode(createHash("sha256").update(listBytes).digest()), boyut: listBytes.length, dosyaSayisi: entries.length },
    kapsam,
  });
  const payload: Record<string, unknown> = { ...manifest, ...(g.kurulumId ? { kurulumId: g.kurulumId } : {}) };
  const token = signJws({ typ: INTEGRITY_TYP, kid: g.key.kid, payload, privateKey: g.key.privateKey });
  if (token.length > JWS_MAX_LENGTH) throw new Error(`imzalı yük ${token.length} bayt > ${JWS_MAX_LENGTH}`);
  const file = path.join(g.root, INTEGRITY_FILE);
  const listFile = path.join(g.root, INTEGRITY_LIST_FILE);
  fs.writeFileSync(listFile, listBytes);
  fs.writeFileSync(file, `${token}\n`);
  const check = await verifyIntegrity(token, g.root, [{ kid: g.key.kid, x: g.key.x }]);
  if (check.durum !== "GECERLI") {
    fs.rmSync(file, { force: true });
    fs.rmSync(listFile, { force: true });
    throw new Error(`öz-denetim düştü: ${check.durum} ${check.kod ?? ""}`);
  }
  return { token, manifest, entries, file, listFile };
}
