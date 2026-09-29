// =============================================================================
// Satıcı ANAHTAR CLI'ı — üretim ve rotasyon (kök · alt · indirme · bayi).
// =============================================================================
// Parola YALNIZ TTY'den (gizli) ya da stdin'den okunur; argv/env'den ASLA (paylaşımlı makinede
// süreç listesinden sızar). Kök imzası imza ALT SÜRECİNDE yapılır (parola onun stdin'ine gider).
// Dosyalar 0600 yazılır ve var olanın üstüne YAZILMAZ — rotasyon yeni kid ile yeni dosyadır.
// Kök dosyasının şifreli kopyası VDS DIŞINDA da saklanır (Mac + USB + kâğıt): VDS ölürse kök kaybolmasın.
//
// Kullanım (satici/sunucu içinden):
//   npx tsx scripts/anahtar.ts kok-uret --kid=kok-2026-1 [--siniflar=URETIM,TEST,DR,DEMO,BAYI,BARINDIRILAN]
//   npx tsx scripts/anahtar.ts kok-uret --kid=hazirlik-2026-1            (yalnız TEST,DEMO)
//   npx tsx scripts/anahtar.ts alt-uret --kid=alt-2026-1 --kok=kok-2026-1 [--siniflar=…] [--gun=180]
//   npx tsx scripts/anahtar.ts indirme-uret --kid=ind-2026 --kok=kok-2026-1 [--gun=365]
//   npx tsx scripts/anahtar.ts bayi-uret --kid=bayi-ornek --bayi-id=<uuid> --moduller=a.enabled,b.enabled
//                                        --siniflar=URETIM --kok=kok-2026-1 [--gun=365]
//   npx tsx scripts/anahtar.ts sirlar-uret   (portal TOTP sarma anahtarı + etkinleştirme kodu sırrı; VAR olan korunur)
//   npx tsx scripts/anahtar.ts indirme-belirteci --kanal=testfabrika[,adnansahin] [--dk=60]
//       YAYINCI indirme belirteçleri (kanal × electron/mobil, ≤ 70 dk). Parola istemez (İNDİRME alt anahtarı).
//       Çıktı stdout'a TEK satır JSON: {"v":1,"belirtecler":[{kanal,yolOneki,belirtec,exp}]} — yayın betiği
//       (scripts/lib/yayin-okuma.mjs) okur; çıktıyı dosyaya/loga yönlendirmeyin.
//   Ortak: [--dizin=<anahtar dizini>] (varsayılan ANAHTAR_DIZINI ya da ./anahtarlar)
// Stdin'den parola (TTY yoksa): her istenen parola bir satır (kök-uret: parola + tekrar).
// =============================================================================
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import {
  CertificateSchema,
  DAY_MS,
  LICENSE_CLASSES,
  ModuleKeySchema,
  STAGING_ROOT_CLASSES,
  TYP,
  UuidSchema,
  publicKeyX,
  verifyCertificate,
  type CertificateDoc,
  type CertUsage,
  type LicenseClass,
} from "../src/lisans-protokol";
import {
  assertPasswordStrength,
  readWrappedKeyFile,
  subKeyFileFor,
  wrapPrivateKey,
  writeKeyFileExclusive,
} from "../src/keys/key-files";
import { signWithWrappedKey } from "../src/keys/signer";
import { KeyStore } from "../src/keys/key-store";
import { PUBLISHER_DEFAULT_MINUTES, PublisherTokenError, publisherTokens } from "../src/keys/publisher-token";
import { ACTIVATION_CODE_PEPPER_FILE, ActivationCodeHasher } from "../src/keys/code-pepper";
import { PORTAL_SECRET_KEY_FILE, PortalSecretBox } from "../src/portal/secret-box";
import { CliError, args, askPassword } from "./lib/cli-girdi";

// ---------------------------------------------------------------- yardımcılar
function keyDir(flags: Map<string, string>): string {
  const dir = path.resolve(flags.get("dizin") || process.env.ANAHTAR_DIZINI || "anahtarlar");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

function required(flags: Map<string, string>, name: string): string {
  const v = flags.get(name);
  if (!v) throw new CliError(`--${name} zorunlu`);
  return v;
}

function classList(text: string | undefined, fallback: readonly LicenseClass[]): LicenseClass[] {
  if (!text) return [...fallback];
  const list = text.split(",").map((s) => s.trim()).filter(Boolean);
  for (const c of list) if (!(LICENSE_CLASSES as readonly string[]).includes(c)) throw new CliError(`Bilinmeyen sınıf: ${c}`);
  return [...new Set(list)] as LicenseClass[];
}

function days(flags: Map<string, string>, fallback: number, max: number): number {
  const n = Number(flags.get("gun") ?? fallback);
  if (!Number.isInteger(n) || n < 1 || n > max) throw new CliError(`--gun 1–${max} olmalı`);
  return n;
}

async function signCertificate(
  dir: string,
  rootKid: string,
  cert: CertificateDoc,
): Promise<string> {
  const rootPath = path.join(dir, `${rootKid}.kok.json`);
  const root = readWrappedKeyFile(rootPath);
  const password = await askPassword(`Kök (${rootKid}) parolası: `);
  const token = await signWithWrappedKey({ keyFile: rootPath, typ: TYP.SERTIFIKA, payload: cert, password });
  const check = verifyCertificate(token, {
    roots: [{ kid: root.kid, x: root.x, classes: root.siniflar }],
    usage: cert.kullanim,
    atMs: Date.now(),
  });
  if (!check.ok) throw new CliError(`Üretilen sertifika doğrulanamadı: ${check.code}`);
  return token;
}

function certificateFor(g: {
  usage: CertUsage;
  kid: string;
  x: string;
  classes: LicenseClass[];
  validDays: number;
  dealer: { bayiId: string; moduller: string[] } | null;
}): CertificateDoc {
  const now = Date.now();
  return CertificateSchema.parse({
    v: 1,
    sertifikaId: randomUUID(),
    kullanim: g.usage,
    kid: g.kid,
    x: g.x,
    siniflar: g.classes,
    baslangic: new Date(now).toISOString(),
    bitis: new Date(now + g.validDays * DAY_MS).toISOString(),
    bayi: g.dealer,
  });
}

// ---------------------------------------------------------------- komutlar
async function generateRoot(flags: Map<string, string>): Promise<void> {
  const kid = required(flags, "kid");
  const staging = kid.startsWith("hazirlik-");
  if (!/^(kok|hazirlik)-\d{4}-\d{1,3}$/.test(kid)) throw new CliError("Kök kid biçimi: kok-<yıl>-<n> ya da hazirlik-<yıl>-<n>");
  const classes = classList(flags.get("siniflar"), staging ? STAGING_ROOT_CLASSES : LICENSE_CLASSES);
  if (staging && classes.some((c) => !STAGING_ROOT_CLASSES.includes(c))) throw new CliError("Hazırlık kökü yalnız TEST/DEMO imzalar");
  const dir = keyDir(flags);
  const target = path.join(dir, `${kid}.kok.json`);
  if (existsSync(target)) throw new CliError(`${target} zaten var — rotasyon yeni kid ile yapılır`);
  const first = await askPassword("Yeni kök parolası: ");
  const second = await askPassword("Parola (tekrar): ");
  const same = first.length === second.length && first.equals(second);
  second.fill(0);
  if (!same) {
    first.fill(0);
    throw new CliError("Parolalar eşleşmedi");
  }
  try {
    assertPasswordStrength(first);
    const { privateKey } = generateKeyPairSync("ed25519");
    const file = await wrapPrivateKey({ tur: "tekserp-kok-anahtar", kid, siniflar: classes }, privateKey, first);
    writeKeyFileExclusive(target, file);
    process.stdout.write(
      `Kök yazıldı: ${target}\n` +
        `Güven çapası satırı (ROOT_PUBLIC_KEYS — protokol sürümüyle eklenir):\n` +
        `  { kid: "${kid}", x: "${file.x}", classes: ${JSON.stringify(classes)} }\n` +
        `⚠ Şifreli dosyanın kopyasını VDS DIŞINDA saklayın (Mac + USB + kâğıt).\n`,
    );
  } finally {
    first.fill(0);
  }
}

async function generateSubKey(flags: Map<string, string>, usage: "ALT" | "INDIRME"): Promise<void> {
  const kid = required(flags, "kid");
  const prefix = usage === "ALT" ? "alt-" : "ind-";
  if (!kid.startsWith(prefix)) throw new CliError(`${usage} kid'i ${prefix} ile başlamalı`);
  const rootKid = required(flags, "kok");
  const dir = keyDir(flags);
  const target = path.join(dir, `${kid}.anahtar.json`);
  if (existsSync(target)) throw new CliError(`${target} zaten var — rotasyon yeni kid ile yapılır`);
  const root = readWrappedKeyFile(path.join(dir, `${rootKid}.kok.json`));
  const classes = classList(flags.get("siniflar"), root.siniflar);
  const { privateKey } = generateKeyPairSync("ed25519");
  const cert = certificateFor({
    usage,
    kid,
    x: publicKeyX(privateKey),
    classes,
    validDays: days(flags, usage === "ALT" ? 180 : 365, 730),
    dealer: null,
  });
  const token = await signCertificate(dir, rootKid, cert);
  writeKeyFileExclusive(target, subKeyFileFor(usage === "ALT" ? "tekserp-alt-anahtar" : "tekserp-indirme-anahtar", kid, privateKey, token));
  process.stdout.write(`${usage} anahtarı yazıldı: ${target} (sertifika ${cert.baslangic} → ${cert.bitis})\n`);
  if (usage === "INDIRME") process.stdout.write(`CF Worker açık anahtarı: { kid: "${kid}", x: "${cert.x}" }\n`);
}

async function generateDealer(flags: Map<string, string>): Promise<void> {
  const kid = required(flags, "kid");
  if (!kid.startsWith("bayi-")) throw new CliError("Bayi kid'i bayi- ile başlamalı");
  const dealerId = required(flags, "bayi-id");
  if (!UuidSchema.safeParse(dealerId).success) throw new CliError("--bayi-id UUID olmalı");
  const modules = required(flags, "moduller").split(",").map((s) => s.trim()).filter(Boolean);
  for (const m of modules) if (!ModuleKeySchema.safeParse(m).success) throw new CliError(`Modül anahtarı biçimsiz: ${m}`);
  const rootKid = required(flags, "kok");
  const dir = keyDir(flags);
  const target = path.join(dir, `${kid}.bayi.json`);
  if (existsSync(target)) throw new CliError(`${target} zaten var`);
  const classes = classList(required(flags, "siniflar"), []);
  const { privateKey } = generateKeyPairSync("ed25519");
  const cert = certificateFor({
    usage: "BAYI",
    kid,
    x: publicKeyX(privateKey),
    classes,
    validDays: days(flags, 365, 730),
    dealer: { bayiId: dealerId, moduller: modules },
  });
  const token = await signCertificate(dir, rootKid, cert);
  const dealerPassword = await askPassword("Bayi anahtarı parolası: ");
  try {
    const file = await wrapPrivateKey({ tur: "tekserp-bayi-anahtar", kid, siniflar: classes, sertifika: token }, privateKey, dealerPassword);
    writeKeyFileExclusive(target, file);
  } finally {
    dealerPassword.fill(0);
  }
  process.stdout.write(`Bayi anahtarı yazıldı: ${target}\n`);
}

/**
 * Sunucunun iki simetrik sırrı (anahtar birimi VDS'te SALT OKUNUR — sunucu açılışta üretemez): portal TOTP
 * sarma anahtarı ve etkinleştirme kodu sırrı (pepper). Var olan dosyanın üstüne YAZILMAZ; kaybolursa
 * TOTP'ler sıfırlanır / açık kodlar yeniden üretilir.
 */
function generateServerSecrets(flags: Map<string, string>): void {
  const dir = keyDir(flags);
  for (const [ad, yukle] of [
    [PORTAL_SECRET_KEY_FILE, () => PortalSecretBox.load(dir, { create: true })],
    [ACTIVATION_CODE_PEPPER_FILE, () => ActivationCodeHasher.load(dir, { create: true })],
  ] as const) {
    const vardi = existsSync(path.join(dir, ad));
    yukle();
    process.stdout.write(`${ad}: ${vardi ? "vardı, korundu" : "üretildi (0600)"}\n`);
  }
}

/** Yayıncı indirme belirteçleri — anahtar dizini yalnız OKUNUR (dizin yoksa yaratılmaz). */
function publisherDownloadTokens(flags: Map<string, string>): void {
  const dir = path.resolve(flags.get("dizin") || process.env.ANAHTAR_DIZINI || "anahtarlar");
  if (!existsSync(dir)) throw new CliError(`Anahtar dizini yok: ${dir}`);
  const channels = required(flags, "kanal").split(",").map((s) => s.trim()).filter(Boolean);
  const minutes = flags.has("dk") ? Number(flags.get("dk")) : PUBLISHER_DEFAULT_MINUTES;
  const keys = KeyStore.load({ ANAHTAR_DIZINI: dir, GUVEN_CAPASI_DOSYASI: process.env.GUVEN_CAPASI_DOSYASI || undefined });
  try {
    const belirtecler = publisherTokens(keys, { channels, minutes, nowMs: Date.now() });
    process.stdout.write(`${JSON.stringify({ v: 1, belirtecler })}\n`);
  } catch (err) {
    if (err instanceof PublisherTokenError) throw new CliError(err.message);
    throw err;
  }
}

async function main(): Promise<void> {
  const { command, flags } = args(process.argv.slice(2));
  switch (command) {
    case "kok-uret":
      return generateRoot(flags);
    case "alt-uret":
      return generateSubKey(flags, "ALT");
    case "indirme-uret":
      return generateSubKey(flags, "INDIRME");
    case "bayi-uret":
      return generateDealer(flags);
    case "sirlar-uret":
      return generateServerSecrets(flags);
    case "indirme-belirteci":
      return publisherDownloadTokens(flags);
    default:
      throw new CliError("Komut: kok-uret | alt-uret | indirme-uret | bayi-uret | sirlar-uret | indirme-belirteci (ayrıntı dosya başında)");
  }
}

main().then(
  () => process.exit(0),
  (err: Error) => {
    process.stderr.write(`HATA: ${err.message}\n`);
    process.exit(err instanceof CliError ? 2 : 1);
  },
);
