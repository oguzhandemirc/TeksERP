// Lisans deposu — `LICENSE_DIR` altındaki dosyalar (kurulum anahtarı, lisans kimliği, HAK, kira,
// durum, proxy, bekleyen taşıma). DB'de değil: dökümle taşınmasın ve kurulum `app\`'i
// değiştirirken silinmesin. Dizin `app\` ve `BACKUP_DIR` DIŞINDA olmak ZORUNDA —
// offsite süpürücü yedek klasöründeki her dosyayı makine dışına kopyalar.
import fs from "node:fs";
import path from "node:path";
import { createPrivateKey, generateKeyPairSync, type KeyObject } from "node:crypto";
import { z } from "zod";
import {
  JwsTextSchema,
  UuidSchema,
  IsoTimeSchema,
  b64uDecode,
  b64uEncode,
  generateFingerprintSalt,
  installationKeyId,
  publicKeyX,
} from "./protocol";
import { readDocField, readFileState, readJsonField, writeFileAtomicSync } from "./store-files";
import { generateX25519, keyFileBody, x25519FromFile } from "./store-key-file";

export { writeFileAtomicSync } from "./store-files";

export const LICENSE_FILES = {
  KEY: "kurulum-anahtari.json",
  /** Lisans kimliği (`kurulumId`): portalda doğar, etkinleştirme yanıtından öğrenilir — DB'de DEĞİL. */
  IDENTITY: "kurulum-kimligi.json",
  ENTITLEMENT: "hak.jws",
  LEASE: "kira.jws",
  STATE: "durum.json",
  PROXY: "proxy.json",
  TRANSFER: "tasima.json",
  /** Parmak izi 24 sa önbelleği (K8) — yalnız tuzlu özet; HMAC'li, bozuksa yok sayılır (`fingerprint-cache.ts`). */
  FINGERPRINT_CACHE: "parmak-izi-onbellek.json",
} as const;

/** Depo kullanılamıyorsa nedeni (kapı/ekran TR metni ayrıca üretir). */
export type StoreProblem = "APP_ICINDE" | "YEDEK_ICINDE" | "OKUNAMADI" | "YAZILAMADI";

export interface InstallationKey {
  readonly privateKey: KeyObject;
  /** Ham Ed25519 açık anahtarı (base64url). */
  readonly x: string;
  /** `kur-` + sha256(açık anahtar). */
  readonly kid: string;
  /** Parmak izi HMAC tuzu — kurulum başına, dışarı çıkmaz. */
  readonly salt: Buffer;
  readonly createdAt: string;
  /** Modül anahtarı alıcısı (Faz 2d); eski kurulumda ilk yoklamaya dek null (`ensureInstallationX25519`). */
  readonly x25519: InstallationX25519 | null;
}

/** Kurulumun X25519 anahtar çifti — ham 32 bayt, base64url. Özel yarısı LICENSE_DIR dışına çıkmaz. */
export interface InstallationX25519 {
  readonly privateX: string;
  readonly publicX: string;
}

export interface ProxyConfig {
  /** `http(s)://[kullanıcı:parola@]sunucu:port` — kimlik bilgisi taşıyabilir, loga/audit'e girmez. */
  readonly adres: string | null;
  /** NO_PROXY biçimi (virgüllü ana makine listesi). */
  readonly atla: string | null;
  readonly guncellendi: string | null;
}

export interface PendingTransfer {
  readonly talepId: string;
  readonly istendi: string;
  readonly gerekce: string | null;
  /** ONAYLANDI: satıcı onayladı, taşıma kodu portaldan gelir — yoklanmaz, kodla etkinleşmeyi bekler. */
  readonly durum?: "BEKLIYOR" | "ONAYLANDI";
}

export interface LicenseIdentity {
  readonly kurulumId: string;
  readonly ogrenildi: string;
}

export interface LicenseStoreSnapshot {
  readonly dir: string;
  readonly problem: StoreProblem | null;
  readonly key: InstallationKey | null;
  readonly identity: LicenseIdentity | null;
  readonly entitlementJws: string | null;
  readonly leaseJws: string | null;
  readonly stateJws: string | null;
  readonly proxy: ProxyConfig;
  readonly transfer: PendingTransfer | null;
  /** Bozuk bulunup kenara alınan anahtar dosyası (varsa) — ekranda görünür. */
  readonly setAsideKeyFile: string | null;
  /** Var olan ama okunamayan dosyalar (ad): YOK değildir, durum bunu ÖLÇÜLEMEDİ sayar. */
  readonly unreadable: readonly string[];
}

const KeyFileSchema = z.object({
  v: z.literal(1),
  ed25519: z.object({ pkcs8: z.string().min(40), x: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }),
  /** Şifreli modül anahtarlarının alıcısı (Faz 2d); eski dosyada null — ilk yoklamada doğar. */
  x25519: z.object({ d: z.string().regex(/^[A-Za-z0-9_-]{43}$/), x: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).nullable(),
  tuz: z.string().min(22),
  olusturuldu: IsoTimeSchema,
});
const StateFileSchema = z.object({ v: z.literal(1), jws: JwsTextSchema });
const ProxyFileSchema = z.object({
  v: z.literal(1),
  adres: z.string().max(500).nullable(),
  atla: z.string().max(500).nullable(),
  guncellendi: IsoTimeSchema.nullable(),
});
const TransferFileSchema = z.object({
  v: z.literal(1),
  talepId: UuidSchema,
  istendi: IsoTimeSchema,
  gerekce: z.string().max(500).nullable(),
  durum: z.enum(["BEKLIYOR", "ONAYLANDI"]).optional(),
});
const IdentityFileSchema = z.object({ v: z.literal(1), kurulumId: UuidSchema, ogrenildi: IsoTimeSchema });

/** Anahtar dosyası birkaç yüz bayttır; boş ya da bundan büyüğü OKUNAMADI (sessiz anahtar değişimi yok). */
const MAX_KEY_BYTES = 8 * 1024;
const EMPTY_PROXY: ProxyConfig = Object.freeze({ adres: null, atla: null, guncellendi: null });

let current: LicenseStoreSnapshot | null = null;

function sameOrInside(child: string, parent: string): boolean {
  const norm = (p: string): string => (process.platform === "win32" ? path.resolve(p).toLowerCase() : path.resolve(p));
  const rel = path.relative(norm(parent), norm(child));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** `LICENSE_DIR` (env) ya da kurulum kökü\lisans; `app\` ve `BACKUP_DIR` içi RED (fail-closed). */
export function resolveLicenseDir(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): { dir: string; problem: StoreProblem | null } {
  const configured = env.LICENSE_DIR?.trim();
  const dir = configured ? path.resolve(configured) : path.resolve(cwd, "..", "lisans");
  if (sameOrInside(dir, cwd)) return { dir, problem: "APP_ICINDE" };
  const backupDir = env.BACKUP_DIR?.trim();
  if (backupDir && sameOrInside(dir, backupDir)) return { dir, problem: "YEDEK_ICINDE" };
  return { dir, problem: null };
}

function keyFromFile(raw: unknown): InstallationKey | null {
  const parsed = KeyFileSchema.safeParse(raw);
  if (!parsed.success) return null;
  const der = b64uDecode(parsed.data.ed25519.pkcs8);
  const salt = b64uDecode(parsed.data.tuz);
  if (!der || !salt || salt.length < 16) return null;
  try {
    const privateKey = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
    if (privateKey.asymmetricKeyType !== "ed25519") return null;
    const x = publicKeyX(privateKey);
    if (x !== parsed.data.ed25519.x) return null;
    // Tutarsız X25519 Ed25519 kimliğini BOZMAZ (taşıma gerektirmesin): null sayılır, ilk yoklamada yenilenir.
    const x25519 = parsed.data.x25519 ? x25519FromFile(parsed.data.x25519) : null;
    return { privateKey, x, kid: installationKeyId(x), salt, createdAt: parsed.data.olusturuldu, x25519 };
  } catch {
    return null;
  }
}

function generateKey(dir: string): InstallationKey {
  const { privateKey } = generateKeyPairSync("ed25519");
  const x = publicKeyX(privateKey);
  const key = { privateKey, x, salt: generateFingerprintSalt(), createdAt: new Date().toISOString(), x25519: generateX25519() };
  writeFileAtomicSync(path.join(dir, LICENSE_FILES.KEY), keyFileBody(key));
  return { ...key, kid: installationKeyId(x) };
}

function emptySnapshot(dir: string, problem: StoreProblem | null, unreadable: readonly string[] = []): LicenseStoreSnapshot {
  return {
    dir,
    problem,
    key: null,
    identity: null,
    entitlementJws: null,
    leaseJws: null,
    stateJws: null,
    proxy: EMPTY_PROXY,
    transfer: null,
    setAsideKeyFile: null,
    unreadable,
  };
}

/**
 * Deponun tamamını SENKRON yükler (sunucu dinlemeye başlamadan önce çağrılır). Anahtar YOKSA
 * (ENOENT) üretir; içeriği bozuksa kenara alıp yenisini üretir (eski anahtara bağlı lisans taşıma
 * ister); okunamıyor/boş/aşırı büyükse ÜRETMEZ — depo OKUNAMADI kalır (sessiz anahtar değişimi yok).
 */
export function loadLicenseStoreSync(opts: { dir?: string } = {}): LicenseStoreSnapshot {
  const resolved = opts.dir ? { dir: path.resolve(opts.dir), problem: null } : resolveLicenseDir();
  if (resolved.problem) {
    current = emptySnapshot(resolved.dir, resolved.problem);
    return current;
  }
  const dir = resolved.dir;
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  } catch {
    current = emptySnapshot(dir, "YAZILAMADI");
    return current;
  }
  let setAsideKeyFile: string | null = null;
  let key: InstallationKey | null = null;
  const keyFile = path.join(dir, LICENSE_FILES.KEY);
  const keyRead = readFileState(keyFile, MAX_KEY_BYTES);
  if (keyRead.kind === "OKUNAMADI" || keyRead.kind === "BOS" || keyRead.kind === "BUYUK") {
    // G12 §3.1-1: anahtar okunamazsa YALNIZ imza durur — belgeler yine okunur, kararlar (kapı · tavan · yaptırım)
    // DB izindeki açık anahtarla doğrulanıp sürer. Anahtar ÜRETİLMEZ (sessiz anahtar değişimi yok).
    const unreadable = [LICENSE_FILES.KEY];
    current = { ...emptySnapshot(dir, "OKUNAMADI", unreadable), ...loadDocuments(dir, unreadable) };
    return current;
  }
  try {
    if (keyRead.kind === "YOK") {
      key = generateKey(dir);
    } else {
      let raw: unknown = null;
      try {
        raw = JSON.parse(keyRead.text) as unknown;
      } catch {
        raw = null;
      }
      key = keyFromFile(raw);
      if (!key) {
        setAsideKeyFile = `${keyFile}.bozuk-${Date.now()}`;
        fs.renameSync(keyFile, setAsideKeyFile);
        key = generateKey(dir);
      }
    }
  } catch {
    current = emptySnapshot(dir, "YAZILAMADI");
    return current;
  }
  const unreadable: string[] = [];
  current = { dir, problem: null, key, setAsideKeyFile, ...loadDocuments(dir, unreadable) };
  return current;
}

type StoreDocuments = Omit<LicenseStoreSnapshot, "dir" | "problem" | "key" | "setAsideKeyFile">;

/** Anahtar dışındaki depo dosyaları; okunamayan her dosya `unreadable`a düşer (yok sayılmaz). */
function loadDocuments(dir: string, unreadable: string[]): StoreDocuments {
  const stateRaw = readJsonField(path.join(dir, LICENSE_FILES.STATE), unreadable);
  const stateParsed = StateFileSchema.safeParse(stateRaw);
  const proxyParsed = ProxyFileSchema.safeParse(readJsonField(path.join(dir, LICENSE_FILES.PROXY), unreadable));
  const transferParsed = TransferFileSchema.safeParse(readJsonField(path.join(dir, LICENSE_FILES.TRANSFER), unreadable));
  const identityParsed = IdentityFileSchema.safeParse(readJsonField(path.join(dir, LICENSE_FILES.IDENTITY), unreadable));
  return {
    identity: identityParsed.success ? { kurulumId: identityParsed.data.kurulumId, ogrenildi: identityParsed.data.ogrenildi } : null,
    entitlementJws: readDocField(path.join(dir, LICENSE_FILES.ENTITLEMENT), unreadable),
    leaseJws: readDocField(path.join(dir, LICENSE_FILES.LEASE), unreadable),
    // Biçimsiz durum dosyası "var ama bozuk" demektir: imza doğrulaması düşürsün diye metin korunur.
    stateJws: stateParsed.success ? stateParsed.data.jws : stateRaw === undefined ? null : "bozuk",
    proxy: proxyParsed.success
      ? { adres: proxyParsed.data.adres, atla: proxyParsed.data.atla, guncellendi: proxyParsed.data.guncellendi }
      : EMPTY_PROXY,
    transfer: transferParsed.success
      ? {
          talepId: transferParsed.data.talepId,
          istendi: transferParsed.data.istendi,
          gerekce: transferParsed.data.gerekce,
          durum: transferParsed.data.durum ?? "BEKLIYOR",
        }
      : null,
    unreadable,
  };
}

export function getLicenseStore(): LicenseStoreSnapshot | null {
  return current;
}

function requireWritable(): LicenseStoreSnapshot {
  if (!current || current.problem || !current.key) {
    throw new Error(`Lisans deposu yazılamaz (${current?.problem ?? "YUKLENMEDI"})`);
  }
  return current;
}

function writeDoc(file: string, text: string): void {
  const s = requireWritable();
  writeFileAtomicSync(path.join(s.dir, file), `${text}\n`);
}

/** Yazılan dosya artık okunabilir: okunamayanlar listesinden düşer. */
function withoutUnreadable(s: LicenseStoreSnapshot, file: string): readonly string[] {
  return s.unreadable.filter((n) => n !== file);
}

/** Lisans kimliği YALNIZ doğrulanmış kiradan öğrenilir (etkinleştirme yanıtı); DB kimliği buraya yazılmaz. */
export function saveLicenseIdentity(kurulumId: string): LicenseIdentity {
  const s = requireWritable();
  const identity: LicenseIdentity = { kurulumId: UuidSchema.parse(kurulumId), ogrenildi: new Date().toISOString() };
  writeFileAtomicSync(path.join(s.dir, LICENSE_FILES.IDENTITY), JSON.stringify({ v: 1, ...identity }));
  current = { ...s, identity, unreadable: withoutUnreadable(s, LICENSE_FILES.IDENTITY) };
  return identity;
}

export function saveEntitlement(jws: string): void {
  writeDoc(LICENSE_FILES.ENTITLEMENT, jws);
  const s = requireWritable();
  current = { ...s, entitlementJws: jws, unreadable: withoutUnreadable(s, LICENSE_FILES.ENTITLEMENT) };
}

export function saveLease(jws: string): void {
  writeDoc(LICENSE_FILES.LEASE, jws);
  const s = requireWritable();
  current = { ...s, leaseJws: jws, unreadable: withoutUnreadable(s, LICENSE_FILES.LEASE) };
}

export function saveStateRecord(jws: string): void {
  writeDoc(LICENSE_FILES.STATE, JSON.stringify({ v: 1, jws }));
  const s = requireWritable();
  current = { ...s, stateJws: jws, unreadable: withoutUnreadable(s, LICENSE_FILES.STATE) };
}

export function saveProxy(cfg: { adres: string | null; atla: string | null }): ProxyConfig {
  const next: ProxyConfig = { adres: cfg.adres, atla: cfg.atla, guncellendi: new Date().toISOString() };
  writeDoc(LICENSE_FILES.PROXY, JSON.stringify({ v: 1, ...next }));
  const s = requireWritable();
  current = { ...s, proxy: next, unreadable: withoutUnreadable(s, LICENSE_FILES.PROXY) };
  return next;
}

export function saveTransfer(t: PendingTransfer | null): void {
  const s = requireWritable();
  const file = path.join(s.dir, LICENSE_FILES.TRANSFER);
  if (t === null) fs.rmSync(file, { force: true });
  else writeFileAtomicSync(file, JSON.stringify({ v: 1, ...t }));
  current = { ...s, transfer: t, unreadable: withoutUnreadable(s, LICENSE_FILES.TRANSFER) };
}

/**
 * Eski kurulumun (x25519 null) X25519 çiftini üretir ve anahtar dosyasına yazar; varsa aynısını döndürür.
 * Yoklama/etkinleştirme gövdesi kurulmadan ÇAĞRILIR. Yazılamazsa null (yoklama anahtarsız sürer).
 */
export function ensureInstallationX25519(): InstallationX25519 | null {
  if (!current || current.problem || !current.key) return null;
  if (current.key.x25519) return current.key.x25519;
  const s = current;
  const key = s.key!;
  const next: InstallationKey = { ...key, x25519: generateX25519() };
  try {
    writeFileAtomicSync(path.join(s.dir, LICENSE_FILES.KEY), keyFileBody(next));
  } catch {
    return null;
  }
  current = { ...s, key: next };
  return next.x25519;
}

/** Test-only: bellek kopyasını sıfırlar (dosyalara dokunmaz). */
export function __resetLicenseStoreForTests(): void {
  current = null;
}
