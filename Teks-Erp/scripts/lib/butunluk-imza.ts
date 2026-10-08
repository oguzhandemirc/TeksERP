// İmzalı dosya listesi — ÜRETİM tarafı (satıcı Mac'i). Kapsam ve dosya özeti tek kaynaktan
// (`src/lib/license/integrity-scope.ts`), liste biçimi `integrity-list.ts`, yük şeması `integrity.ts`,
// imza protokolün `signJws`i. Liste ayrı dosyadır (`butunluk-liste.txt`); JWS yalnız onun boyunu +
// sha256'sını imzalar. Her imza, yazılmadan ÖNCE aynı kökte çalışan tarafın denetimiyle doğrulanır.
import { createHash, generateKeyPairSync, createPrivateKey, randomUUID, type KeyObject } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { JWS_MAX_LENGTH, LICENSE_CLASSES, b64uEncode, parseJws, publicKeyX, signJws, type RootKey } from "../../src/lib/license/protocol";
import {
  CHAINED_INTEGRITY_FILE,
  PACKAGE_CERT_FIELD,
  PACKAGE_REVOCATION_FILE,
  PACKAGE_SIGNED_AT_FIELD,
  isChainPackageKid,
  verifyPackageRevocation,
} from "../../src/lib/license/protocol/paket-zinciri";
import { openSealedKey, privateKeyFromRaw, sealPrivateKey, type SealedKey } from "../../src/lib/license/protocol/anahtar-sarma";
import { INTEGRITY_TYP, IntegrityManifestSchema, verifyIntegrity, type IntegrityManifest } from "../../src/lib/license/integrity";
import { INTEGRITY_LIST_FILE, formatIntegrityList, type IntegrityListEntry } from "../../src/lib/license/integrity-list";
import {
  INTEGRITY_FILE,
  fileEntries,
  isProductionChainPackageKid,
  isProductionPackageKid,
  listScopedFiles,
  packageScope,
} from "../../src/lib/license/integrity-scope";

export const PACKAGE_KEY_KIND = "tekserp-paket-anahtar";

/** Parolalı doğan üretim imza anahtarı: gömülü çapalı `paket-<yıl>[-<n>]` ya da kök sertifikalı `pkt-<yıl>-<n>`. */
export function isProductionSigningKid(kid: string): boolean {
  return isProductionPackageKid(kid) || isProductionChainPackageKid(kid);
}

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

/** Üretim PAKET anahtarı üretir ve parolayla sarar (parolayı çağıran sıfırlar); kid `paket-<yıl>[-<n>]` ya da `pkt-<yıl>-<n>`. */
export async function generateWrappedPackageKey(kid: string, password: Buffer): Promise<WrappedPackageKeyFile> {
  if (!isProductionSigningKid(kid)) throw new Error(`üretim PAKET kid'i paket-<yıl>[-<n>] ya da pkt-<yıl>-<n> biçiminde olmalı: ${kid}`);
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
  if (isProductionSigningKid(k.kid)) throw new Error(`üretim PAKET kid'i (${k.kid}) parolasız dosyada olamaz — anahtar-uret ile parolalı üretilir`);
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
  if (!isProductionSigningKid(k.kid as string)) {
    throw new Error(`parolalı biçim yalnız üretim PAKET kid'i (paket-<yıl> · pkt-<yıl>-<n>) taşır: ${String(k.kid)}`);
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

export interface SigningKey {
  readonly kid: string;
  readonly x: string;
  readonly privateKey: KeyObject;
}

export interface SignInput {
  readonly root: string;
  /** Birincil imzacı: `paket-*` (gömülü çapa → `butunluk.jws`) ya da `pkt-*` (sertifikalı → `butunluk-zincir.jws`). */
  readonly key: SigningKey;
  /** `key` `pkt-*` ise ZORUNLU: kök imzalı PAKET sertifikası (compact JWS). */
  readonly certificate?: string;
  /** Çift imza (G1): birincil `paket-*`, bu `pkt-*` — aynı yük iki dosyada. */
  readonly zincir?: { readonly key: SigningKey; readonly certificate: string } | null;
  /** Zincirli imzanın öz-denetimi ve iptal belgesinin doğrulaması için kök çapası. */
  readonly roots?: readonly RootKey[];
  /** Paketin kökünde taşınacak en güncel dağıtım iptali (`paket-iptal.jws`, kök imzalı; yalnız zincirli pakette). */
  readonly paketIptal?: string | null;
  readonly urun: string;
  readonly surum: string;
  readonly derlemeTarihi: string;
  readonly musteri: string | null;
  readonly paketId?: string;
  /** Filigran: kurulum kimliği (varsa). v1 şeması bu ek anahtarı DOĞRULAMADA atar; imzalı içerikte durur. */
  readonly kurulumId?: string | null;
  /** CI kökeni kaydı (`ci-kokeni.ts`): ek anahtar olarak imzalı yükte durur, v1 şeması doğrulamada atar. */
  readonly ciKokeni?: Readonly<Record<string, unknown>> | null;
  /** Zincirli imzanın `imzaZamani`; verilmezse şimdi. */
  readonly now?: Date;
}

export interface SignedFile {
  readonly kid: string;
  readonly token: string;
  readonly file: string;
}

export interface SignResult {
  /** Birincil imza (`key`) — geriye uyum: `token`/`file`. */
  readonly token: string;
  readonly file: string;
  readonly manifest: IntegrityManifest;
  readonly entries: readonly IntegrityListEntry[];
  readonly listFile: string;
  /** Yazılan imza dosyaları (`butunluk.jws` ve/veya `butunluk-zincir.jws`). */
  readonly imzalar: readonly SignedFile[];
  /** Paketin kökünde `paket-iptal.jws` yazıldıysa yolu. */
  readonly iptalFile: string | null;
}

/** Zincirli imza: yük + iki zincir alanı, imzalayan `pkt-*`; sertifika bu anahtarın olmalı (protokolün doğrulayıcısı denetler). */
function signChained(payload: Record<string, unknown>, key: SigningKey, certificate: string, signedAt: string): string {
  if (!isChainPackageKid(key.kid)) throw new Error(`zincirli imza yalnız pkt-* anahtarıyla: ${key.kid}`);
  const c = parseJws(certificate);
  if (!c.ok || c.value.payload.kid !== key.kid || c.value.payload.x !== key.x) throw new Error(`PAKET sertifikası bu anahtarın (${key.kid}) değil`);
  return signJws({ typ: INTEGRITY_TYP, kid: key.kid, payload: { ...payload, [PACKAGE_CERT_FIELD]: certificate, [PACKAGE_SIGNED_AT_FIELD]: signedAt }, privateKey: key.privateKey });
}

/** İmzacı listesi: birincil + (çift imzada) zincir; aileler karışmaz, aynı aile iki kez olmaz. */
function signersOf(g: SignInput): { readonly key: SigningKey; readonly certificate: string | null }[] {
  const out: { key: SigningKey; certificate: string | null }[] = [];
  if (isChainPackageKid(g.key.kid)) {
    if (!g.certificate) throw new Error(`${g.key.kid} zincirli anahtar — PAKET sertifikası gerekli`);
    if (g.zincir) throw new Error("çift imzada birincil anahtar gömülü çapalı (paket-*) olmalı, ikinci pkt-*");
    out.push({ key: g.key, certificate: g.certificate });
  } else {
    if (g.certificate) throw new Error(`${g.key.kid} gömülü çapalı anahtar — sertifika taşıyamaz`);
    out.push({ key: g.key, certificate: null });
    if (g.zincir) {
      if (!isChainPackageKid(g.zincir.key.kid)) throw new Error(`çift imzanın ikinci anahtarı pkt-* olmalı: ${g.zincir.key.kid}`);
      out.push({ key: g.zincir.key, certificate: g.zincir.certificate });
    }
  }
  if (out.some((s) => s.certificate !== null) && !g.roots) throw new Error("zincirli imzanın öz-denetimi kök çapası ister");
  return out;
}

/**
 * Kapsamı ölçer, liste dosyasını (`butunluk-liste.txt`) ve imzalı yükü yazar — gömülü çapalı imza `butunluk.jws`,
 * zincirli (`pkt-*`) imza `butunluk-zincir.jws`; çift imzada AYNI yük (aynı paketId) iki dosyada. Her imza çalışan
 * tarafın denetimiyle doğrulanır (zincirli KABUL kipinde); öz-denetim düşerse yazılan HER dosya silinir.
 */
export async function signPackageDirectory(g: SignInput): Promise<SignResult> {
  const signers = signersOf(g);
  const now = g.now ?? new Date();
  let revocation: string | null = null;
  if (g.paketIptal) {
    if (!signers.some((s) => s.certificate !== null)) throw new Error("dağıtım iptali yalnız zincirli imzalı pakete girer");
    const v = verifyPackageRevocation(g.paketIptal, g.roots ?? []);
    if (!v.ok) throw new Error(`dağıtım iptali kökle doğrulanamadı (${v.code})`);
    revocation = g.paketIptal;
  }
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
  const listFile = path.join(g.root, INTEGRITY_LIST_FILE);
  const yazilan: string[] = [listFile];
  const imzalar: SignedFile[] = [];
  const iptalFile = revocation ? path.join(g.root, PACKAGE_REVOCATION_FILE) : null;
  try {
    fs.writeFileSync(listFile, listBytes);
    for (const s of signers) {
      const token = s.certificate === null
        ? signJws({ typ: INTEGRITY_TYP, kid: s.key.kid, payload, privateKey: s.key.privateKey })
        : signChained(payload, s.key, s.certificate, now.toISOString());
      if (token.length > JWS_MAX_LENGTH) throw new Error(`imzalı yük ${token.length} bayt > ${JWS_MAX_LENGTH}`);
      const file = path.join(g.root, s.certificate === null ? INTEGRITY_FILE : CHAINED_INTEGRITY_FILE);
      fs.writeFileSync(file, `${token}\n`);
      yazilan.push(file);
      const check = s.certificate === null
        ? await verifyIntegrity(token, g.root, [{ kid: s.key.kid, x: s.key.x }])
        : await verifyIntegrity(token, g.root, [], { roots: g.roots ?? [], mode: "KABUL", nowMs: Date.now() });
      if (check.durum !== "GECERLI") throw new Error(`öz-denetim düştü (${s.key.kid}): ${check.durum} ${check.kod ?? ""}`);
      imzalar.push({ kid: s.key.kid, token, file });
    }
    if (iptalFile && revocation) {
      fs.writeFileSync(iptalFile, `${revocation}\n`, { flag: "wx" });
      yazilan.push(iptalFile);
    }
  } catch (e) {
    for (const f of yazilan) fs.rmSync(f, { force: true });
    throw e;
  }
  const first = imzalar[0]!;
  return { token: first.token, file: first.file, manifest, entries, listFile, imzalar, iptalFile };
}

/**
 * Docker teslim künyesini (`PAKET-DOCKER.json`) imzalar: künyenin `kapsam`ındaki teslim dosyaları belgenin
 * dizininde ölçülür, liste `butunluk-liste.txt`e yazılır, `liste` alanı künyeye girer; yük künyenin TAMAMIDIR
 * (şemanın atladığı ek alanlar da imzada). Kapsamdaki dosya eksikse imza atılmaz; öz-denetim düşerse iz kalmaz.
 */
export async function signManifestDocument(file: string, key: SigningKey): Promise<{ token: string; file: string; listFile: string }> {
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
