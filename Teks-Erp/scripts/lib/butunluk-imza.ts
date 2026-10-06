// İmzalı dosya listesi — ÜRETİM tarafı (satıcı Mac'i). Kapsam ve dosya özeti tek kaynaktan
// (`src/lib/license/integrity-scope.ts`), liste biçimi `integrity-list.ts`, yük şeması `integrity.ts`,
// imza protokolün `signJws`i. Liste ayrı dosyadır (`butunluk-liste.txt`); JWS yalnız onun boyunu +
// sha256'sını imzalar. Her imza, yazılmadan ÖNCE aynı kökte çalışan tarafın denetimiyle doğrulanır.
import { createHash, generateKeyPairSync, createPrivateKey, randomUUID, type KeyObject } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { JWS_MAX_LENGTH, LICENSE_CLASSES, b64uEncode, publicKeyX, signJws } from "../../src/lib/license/protocol";
import { openSealedKey, privateKeyFromRaw, sealPrivateKey, type SealedKey } from "../../src/lib/license/protocol/anahtar-sarma";
import { INTEGRITY_TYP, IntegrityManifestSchema, verifyIntegrity, type IntegrityManifest } from "../../src/lib/license/integrity";
import { INTEGRITY_LIST_FILE, formatIntegrityList, type IntegrityListEntry } from "../../src/lib/license/integrity-list";
import {
  INTEGRITY_FILE,
  fileEntries,
  isProductionPackageKid,
  listScopedFiles,
  packageScope,
} from "../../src/lib/license/integrity-scope";

export const PACKAGE_KEY_KIND = "tekserp-paket-anahtar";

export interface PackageKeyFile {
  readonly tur: typeof PACKAGE_KEY_KIND;
  readonly surum: 1;
  readonly kid: string;
  readonly x: string;
  /** Ham Ed25519 özel anahtarı (base64url). Yalnız bekçilerin test anahtarı parolasızdır (0600); üretim anahtarı sürüm 2. */
  readonly d: string;
  readonly siniflar: readonly string[];
  readonly olusturma: string;
}

/**
 * Üretim PAKET anahtarı (sürüm 2): özel yarı parolayla SARILI — kök anahtar dosyasıyla aynı sarma, tek uygulama
 * `protocol/anahtar-sarma.ts` (AAD tür + kid + açık yarı + sınıfları bağlar). Dosya tek başına imza attıramaz.
 */
export interface WrappedPackageKeyFile extends SealedKey {
  readonly tur: typeof PACKAGE_KEY_KIND;
  readonly surum: 2;
  readonly kid: string;
  readonly siniflar: readonly string[];
  readonly x: string;
  readonly olusturma: string;
}

export interface OpenedPackageKey {
  readonly kid: string;
  readonly x: string;
  readonly privateKey: KeyObject;
}

export function generatePackageKey(kid: string, siniflar: readonly string[]): PackageKeyFile {
  const { privateKey } = generateKeyPairSync("ed25519");
  const jwk = privateKey.export({ format: "jwk" });
  if (typeof jwk.d !== "string" || typeof jwk.x !== "string") throw new Error("anahtar dışa aktarılamadı");
  return { tur: PACKAGE_KEY_KIND, surum: 1, kid, x: jwk.x, d: jwk.d, siniflar: [...siniflar], olusturma: new Date().toISOString() };
}

/** Üretim PAKET anahtarı üretir ve parolayla sarar (parolayı çağıran sıfırlar); kid `paket-<yıl>[-<n>]` olmalı. */
export async function generateWrappedPackageKey(kid: string, password: Buffer): Promise<WrappedPackageKeyFile> {
  if (!isProductionPackageKid(kid)) throw new Error(`üretim PAKET kid'i paket-<yıl>[-<n>] biçiminde olmalı: ${kid}`);
  const { privateKey } = generateKeyPairSync("ed25519");
  const siniflar = [...LICENSE_CLASSES];
  const s = await sealPrivateKey({ tur: PACKAGE_KEY_KIND, kid, siniflar }, privateKey, password);
  return { tur: PACKAGE_KEY_KIND, surum: 2, kid, siniflar, x: s.x, kdf: s.kdf, iv: s.iv, sifreli: s.sifreli, etiket: s.etiket, olusturma: new Date().toISOString() };
}

/** Anahtar dosyasını yazar: var olanı EZMEZ, izin 0600. */
export function writePackageKey(dir: string, key: PackageKeyFile | WrappedPackageKeyFile): string {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `${key.kid}.paket.json`);
  fs.writeFileSync(file, `${JSON.stringify(key, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  return file;
}

function readKeyJson(file: string): Record<string, unknown> {
  const mode = fs.statSync(file).mode & 0o777;
  if (process.platform !== "win32" && (mode & 0o077) !== 0) throw new Error(`anahtar dosyası başkalarına açık (${mode.toString(8)}) — chmod 600`);
  return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
}

function plainKey(k: Record<string, unknown>): OpenedPackageKey {
  if (k.tur !== PACKAGE_KEY_KIND || k.surum !== 1 || typeof k.kid !== "string" || typeof k.x !== "string" || typeof k.d !== "string") {
    throw new Error("PAKET anahtar dosyası biçimsiz");
  }
  // Üretim kid'i parolasız dosyada bulunamaz: test biçimiyle üretim anahtarı karıştırılmasın.
  if (isProductionPackageKid(k.kid)) throw new Error(`üretim PAKET kid'i (${k.kid}) parolasız dosyada olamaz — anahtar-uret ile parolalı üretilir`);
  const privateKey = createPrivateKey({ key: { kty: "OKP", crv: "Ed25519", x: k.x, d: k.d }, format: "jwk" });
  if (publicKeyX(privateKey) !== k.x) throw new Error("anahtar dosyasında x ile d uyuşmuyor");
  return { kid: k.kid, x: k.x, privateKey };
}

const B64U = /^[A-Za-z0-9_-]+$/;

/** Sürüm 2 dosyasının alanları KATI: fazla alan (ör. düz `d`) ya da üretim dışı kid RED. */
function wrappedKeyOf(k: Record<string, unknown>): WrappedPackageKeyFile {
  const kdf = k.kdf as Record<string, unknown> | undefined;
  const alanlar = ["tur", "surum", "kid", "siniflar", "x", "kdf", "iv", "sifreli", "etiket", "olusturma"];
  const ok =
    Object.keys(k).every((a) => alanlar.includes(a)) &&
    k.tur === PACKAGE_KEY_KIND &&
    k.surum === 2 &&
    typeof k.kid === "string" &&
    typeof k.x === "string" && B64U.test(k.x) &&
    Array.isArray(k.siniflar) && k.siniflar.every((c) => typeof c === "string") &&
    typeof k.iv === "string" && B64U.test(k.iv) &&
    typeof k.sifreli === "string" && B64U.test(k.sifreli) &&
    typeof k.etiket === "string" && B64U.test(k.etiket) &&
    typeof k.olusturma === "string" &&
    !!kdf && kdf.ad === "scrypt" && typeof kdf.tuz === "string" &&
    [kdf.N, kdf.r, kdf.p].every((n) => Number.isInteger(n)) &&
    (kdf.N as number) >= 1 << 14 && (kdf.N as number) <= 1 << 17 && (kdf.r as number) >= 1 && (kdf.r as number) <= 32 && (kdf.p as number) >= 1 && (kdf.p as number) <= 16;
  if (!ok) throw new Error("parolalı PAKET anahtar dosyası biçimsiz");
  // Üretim dışı kid parolalı biçimde bulunamaz: iki biçim kid sınıfına bağlı, karıştırılmaz.
  if (!isProductionPackageKid(k.kid as string)) {
    throw new Error(`parolalı biçim yalnız üretim PAKET kid'i (paket-<yıl>) taşır: ${String(k.kid)}`);
  }
  return k as unknown as WrappedPackageKeyFile;
}

/** Parolasız (bekçi test) anahtar. Parolalı üretim anahtarı burada AÇILMAZ — `openPackageKey`. */
export function readPackageKey(file: string): OpenedPackageKey {
  const k = readKeyJson(file);
  if (k.surum === 2) throw new Error("parolalı üretim PAKET anahtarı — openPackageKey ile (parola sorularak) açılır");
  return plainKey(k);
}

/** Dosyanın açık yüzü (kid · x · parolalı mı) — özel yarıya dokunmaz, parola istemez. */
export function packageKeyInfo(file: string): { readonly kid: string; readonly x: string; readonly parolali: boolean } {
  const k = readKeyJson(file);
  if (k.surum === 2) {
    const w = wrappedKeyOf(k);
    return { kid: w.kid, x: w.x, parolali: true };
  }
  const p = plainKey(k);
  return { kid: p.kid, x: p.x, parolali: false };
}

/**
 * İki biçimi de açar: parolasız (test) doğrudan; parolalıysa parolayı `askPassword`tan ister — açılan ham
 * özel yarı ve parola Buffer'ı iş bitince SIFIRLANIR. Yanlış parola: `KeyFileError` YANLIS_PAROLA.
 */
export async function openPackageKey(file: string, askPassword: (kid: string) => Promise<Buffer>): Promise<OpenedPackageKey> {
  const k = readKeyJson(file);
  if (k.surum !== 2) return plainKey(k);
  const w = wrappedKeyOf(k);
  const password = await askPassword(w.kid);
  let raw: Buffer | null = null;
  try {
    raw = await openSealedKey(w, password);
    return { kid: w.kid, x: w.x, privateKey: privateKeyFromRaw(raw) };
  } finally {
    password.fill(0);
    raw?.fill(0);
  }
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
  /** CI kökeni kaydı (`ci-kokeni.ts`): ek anahtar olarak imzalı yükte durur, v1 şeması doğrulamada atar. */
  readonly ciKokeni?: Readonly<Record<string, unknown>> | null;
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
  const payload: Record<string, unknown> = { ...manifest, ...(g.kurulumId ? { kurulumId: g.kurulumId } : {}), ...(g.ciKokeni ? { ciKokeni: g.ciKokeni } : {}) };
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

/**
 * Docker teslim künyesini (`PAKET-DOCKER.json`) imzalar: künyenin `kapsam`ındaki teslim dosyaları belgenin
 * dizininde ölçülür, liste `butunluk-liste.txt`e yazılır, `liste` alanı künyeye girer; yük künyenin TAMAMIDIR
 * (şemanın atladığı ek alanlar da imzada). Kapsamdaki dosya eksikse imza atılmaz; öz-denetim düşerse iz kalmaz.
 */
export async function signManifestDocument(file: string, key: SignInput["key"]): Promise<{ token: string; file: string; listFile: string }> {
  const root = path.dirname(file);
  const doc = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  const kapsam = IntegrityManifestSchema.shape.kapsam.safeParse(doc.kapsam);
  if (!kapsam.success) throw new Error(`künyede kapsam biçimsiz: ${kapsam.error.issues[0]?.message ?? "şema"}`);
  const files = await listScopedFiles(root, kapsam.data);
  const eksik = kapsam.data.dosyalar.filter((f) => !files.includes(f));
  if (eksik.length > 0 || files.length === 0) throw new Error(`teslim dosyası eksik: ${eksik.join(", ") || "kapsam boş"}`);
  const entries = await fileEntries(root, files);
  const listBytes = formatIntegrityList(entries);
  const payload: Record<string, unknown> = {
    ...doc,
    liste: { sha256: b64uEncode(createHash("sha256").update(listBytes).digest()), boyut: listBytes.length, dosyaSayisi: entries.length },
  };
  const parsed = IntegrityManifestSchema.safeParse(payload);
  if (!parsed.success) throw new Error(`künye tekserp-butunluk yükü değil: ${parsed.error.issues[0]?.message ?? "şema"}`);
  const token = signJws({ typ: INTEGRITY_TYP, kid: key.kid, payload, privateKey: key.privateKey });
  if (token.length > JWS_MAX_LENGTH) throw new Error(`imzalı belge ${token.length} bayt > ${JWS_MAX_LENGTH}`);
  const listFile = path.join(root, INTEGRITY_LIST_FILE);
  fs.writeFileSync(listFile, listBytes);
  const check = await verifyIntegrity(token, root, [{ kid: key.kid, x: key.x }]);
  if (check.durum !== "GECERLI") {
    fs.rmSync(listFile, { force: true });
    throw new Error(`öz-denetim düştü: ${check.durum} ${check.kod ?? ""}`);
  }
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
  const out = `${file}.jws`;
  fs.writeFileSync(out, `${token}\n`);
  return { token, file: out, listFile };
}
