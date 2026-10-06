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
//   npx tsx scripts/anahtar.ts ara-uret --kid=ara-2026-1 --kok=kok-2026-1 [--siniflar=URETIM,DR,DEMO,TEST] [--gun=120]
//       HAK ARA İMZACISI (G4): kök imzalı `HAK` sertifikası + ara parolasıyla sarılı dosya (<kid>.ara.json). Stdin: kök
//       parolası, sonra ara parolası (yeni + tekrar; kökten FARKLI olmalı — ara parolası portalda VDS'te yazılır).
//   npx tsx scripts/anahtar.ts iptal-uret --kok=kok-2026-1 --kok-dizin=<kökün dizini> --cikti=<dosya> [--onceki=<önceki iptal belgesi>]
//                                        [--iptal=<anahtar/sertifika dosyası>[,…]] [--neden=<metin>]
//       Sertifika İPTAL belgesi (`tekserp-iptal`, yalnız kök): önceki belgenin bütün satırları taşınır, sıra +1.
//   npx tsx scripts/anahtar.ts kuyruk-imzala --kok=kok-2026-1 --kok-dizin=<kökün dizini> --kuyruk=<kuyruk.json> --cikti=<dosya>
//       Kök imzası bekleyen HAK'ları (VDS'ten `kuyruk-disa-aktar`) kökle imzalar; yük AYNEN imzalanır.
//   VDS (konteyner içinde, DB'li): `kuyruk-disa-aktar` (stdout'a kuyruk JSON'u) · `donem-ice-aktar [--dosya=<yol>]`
//       (stdin ya da dosyadan tören paketinin ice-aktar.json'u: iptal belgesi + kök imzalı HAK'lar).
//   npx tsx scripts/anahtar.ts emekliye-ayir --kid=<kid>[,…] [--uygula] [--dizin=…]
//       Eski ALT · İNDİRME · ARA anahtarının ÖZEL yarısını siler, açık yarı + sertifikası <kid>.sertifika.json olarak
//       kalır; aynı türde daha yeni anahtar yoksa RED. Varsayılan KURU: yalnız ne yapılacağını listeler.
//   npx tsx scripts/anahtar.ts sirlar-uret   (portal TOTP sarma anahtarı + etkinleştirme kodu sırrı + modül kasası anahtarı; VAR olan korunur)
//   npx tsx scripts/anahtar.ts indirme-belirteci --kanal=testfabrika[,adnansahin] [--dk=60] [--capa=uretim|hazirlik]
//       YAYINCI indirme belirteçleri (kanal × electron/mobil, ≤ 70 dk). Parola istemez (İNDİRME alt anahtarı).
//       Çapa kipi: --capa > GUVEN_CAPASI (konteyner ortamı) > anahtar dizinindeki köklerin tek ailesi; belirsizse RED.
//       Çıktı stdout'a TEK satır JSON: {"v":1,"belirtecler":[{kanal,yolOneki,belirtec,exp}]} — yayın betiği
//       (scripts/lib/yayin-okuma.mjs) okur; çıktıyı dosyaya/loga yönlendirmeyin.
//   Ortak: [--dizin=<anahtar dizini>] (varsayılan ANAHTAR_DIZINI ya da ./anahtarlar) · [--kok-dizin=<kökün dizini>] (alt/indirme/ara:
//   kök başka dizindeyse — dönem töreni kökü tören dizininden okur, yeni anahtarı dönem paketine yazar)
// Stdin'den parola (TTY yoksa): her istenen parola bir satır (kök-uret: parola + tekrar).
// =============================================================================
import { generateKeyPairSync, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import {
  CertificateSchema,
  DAY_MS,
  EntitlementSchema,
  LICENSE_CLASSES,
  ModuleKeySchema,
  REVOCATION_MAX_ENTRIES,
  STAGING_ROOT_CLASSES,
  TYP,
  UuidSchema,
  decodeDocument,
  parseJws,
  publicKeyX,
  verifyCertificate,
  verifyEntitlement,
  verifyRevocation,
  type CertificateDoc,
  type CertUsage,
  type LicenseClass,
  type RevocationDoc,
  type RootKey,
} from "../src/lisans-protokol";
import {
  RETIRED_KEY_TYPE,
  RetiredKeyFileSchema,
  assertPasswordStrength,
  readSubKeyFile,
  readWrappedKeyFile,
  subKeyFileFor,
  wrapPrivateKey,
  writeKeyFileExclusive,
  type RetiredKeyFile,
} from "../src/keys/key-files";
import { signWithWrappedKey } from "../src/keys/signer";
import { runAsCli } from "../src/lib/request-scope";
import { KeyStore, anchorModeOfKeyDir } from "../src/keys/key-store";
import { PUBLISHER_DEFAULT_MINUTES, PublisherTokenError, publisherTokens } from "../src/keys/publisher-token";
import { generateServerSecrets } from "../src/keys/server-secrets";
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

/** Kök dosyasının dizini: `--kok-dizin` (dönem töreni: kök tören dizininde, çıktı dönem paketinde) ya da çıktı dizini. */
function rootDir(flags: Map<string, string>, dir: string): string {
  const d = flags.get("kok-dizin");
  return d ? path.resolve(d) : dir;
}

async function signCertificate(
  dir: string,
  rootKid: string,
  cert: CertificateDoc,
): Promise<string> {
  const rootPath = path.join(dir, `${rootKid}.kok.json`);
  const root = readWrappedKeyFile(rootPath);
  const password = await askPassword(`Kök (${rootKid}) parolası: `);
  const token = await runAsCli(() => signWithWrappedKey({ keyFile: rootPath, typ: TYP.SERTIFIKA, payload: cert, password }));
  const check = verifyCertificate(token, {
    roots: [{ kid: root.kid, x: root.x, classes: root.siniflar }],
    usage: cert.kullanim,
    atMs: Date.now(),
  });
  if (!check.ok) throw new CliError(`Üretilen sertifika doğrulanamadı: ${check.code}`);
  return token;
}

/** Kök dosyasının açık yarısı — imzalanan belge bununla doğrulanmadan dosyaya yazılmaz. */
function rootAnchorOf(dir: string, rootKid: string): { path: string; anchor: RootKey[]; classes: LicenseClass[] } {
  const rootPath = path.join(dir, `${rootKid}.kok.json`);
  if (!existsSync(rootPath)) throw new CliError(`Kök dosyası yok: ${rootPath}`);
  const root = readWrappedKeyFile(rootPath);
  if (root.tur !== "tekserp-kok-anahtar") throw new CliError(`${rootPath} kök anahtarı değil`);
  return { path: rootPath, anchor: [{ kid: root.kid, x: root.x, classes: root.siniflar }], classes: root.siniflar };
}

/** Parolanın KOPYASIYLA imza (asıl parola birden çok imzada kullanılır; kopya alt süreçte sıfırlanır). */
async function signWithCopy(keyFile: string, typ: "tekserp-hak" | "tekserp-iptal" | "tekserp-sertifika", payload: Record<string, unknown>, password: Buffer): Promise<string> {
  const copy = Buffer.from(password);
  try {
    return await runAsCli(() => signWithWrappedKey({ keyFile, typ, payload, password: copy }));
  } finally {
    copy.fill(0);
  }
}

function writePublicFile(target: string, content: unknown): void {
  if (existsSync(target)) throw new CliError(`${target} zaten var — üstüne yazılmaz`);
  writeKeyFileExclusive(target, content);
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
  const root = readWrappedKeyFile(path.join(rootDir(flags, dir), `${rootKid}.kok.json`));
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
  const token = await signCertificate(rootDir(flags, dir), rootKid, cert);
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

/** Ara imzacının varsayılan sınıfları (tören parametresi); kökün yetkisiyle kesişir. */
const INTERMEDIATE_DEFAULT_CLASSES: readonly LicenseClass[] = ["URETIM", "DR", "DEMO", "TEST"];
/** Ara imzacı · ALT · İNDİRME dönem ömrü (G4 §2.4: 90 + 30 gün örtüşme). */
const PERIOD_DAYS = 120;

/**
 * HAK ARA İMZACISI: kök imzalı `HAK` sertifikası (sınıflar kökün alt kümesi, ≤ 120 gün) + ara parolasıyla sarılı
 * özel yarı. Ara parolası KÖK PAROLASINDAN FARKLI olmalı: ara parolası VDS'te portal formunda yazılır, kök parolası
 * VDS'e hiç gitmez. Dosya üstüne yazılmaz (rotasyon yeni kid'dir).
 */
async function generateIntermediate(flags: Map<string, string>): Promise<void> {
  const kid = required(flags, "kid");
  if (!/^ara-(?:hazirlik-)?\d{4}-\d{1,3}$/.test(kid)) throw new CliError("Ara imzacı kid biçimi: ara-<yıl>-<n> (hazırlık kökünde ara-hazirlik-<yıl>-<n>)");
  const rootKid = required(flags, "kok");
  const dir = keyDir(flags);
  const target = path.join(dir, `${kid}.ara.json`);
  if (existsSync(target)) throw new CliError(`${target} zaten var — rotasyon yeni kid ile yapılır`);
  const root = rootAnchorOf(rootDir(flags, dir), rootKid);
  const fallback = INTERMEDIATE_DEFAULT_CLASSES.filter((c) => root.classes.includes(c));
  const classes = classList(flags.get("siniflar"), fallback);
  if (classes.length === 0) throw new CliError(`Kök ${rootKid} ara imzacıya verilebilecek sınıf taşımıyor`);
  const outside = classes.filter((c) => !root.classes.includes(c));
  if (outside.length > 0) throw new CliError(`Kök ${rootKid} bu sınıflara yetkili değil: ${outside.join(", ")}`);
  const validDays = days(flags, PERIOD_DAYS, PERIOD_DAYS);
  const { privateKey } = generateKeyPairSync("ed25519");
  const cert = certificateFor({ usage: "HAK", kid, x: publicKeyX(privateKey), classes, validDays, dealer: null });
  const rootPassword = await askPassword(`Kök (${rootKid}) parolası: `);
  let token: string;
  try {
    token = await signWithCopy(root.path, TYP.SERTIFIKA, cert, rootPassword);
    const check = verifyCertificate(token, { roots: root.anchor, usage: "HAK", atMs: Date.now() });
    if (!check.ok) throw new CliError(`Üretilen ara imzacı sertifikası doğrulanamadı: ${check.code}`);
    const first = await askPassword("Yeni ara imzacı parolası: ");
    const second = await askPassword("Ara imzacı parolası (tekrar): ");
    try {
      const same = first.length === second.length && timingSafeEqual(first, second);
      if (!same) throw new CliError("Ara imzacı parolaları eşleşmedi");
      const sameAsRoot = first.length === rootPassword.length && timingSafeEqual(first, rootPassword);
      if (sameAsRoot) throw new CliError("Ara imzacı parolası kök parolasından FARKLI olmalı (ara parolası VDS'te yazılır, kökünki asla)");
      assertPasswordStrength(first);
      const file = await wrapPrivateKey({ tur: "tekserp-ara-anahtar", kid, siniflar: classes, sertifika: token }, privateKey, first);
      writeKeyFileExclusive(target, file);
    } finally {
      first.fill(0);
      second.fill(0);
    }
  } finally {
    rootPassword.fill(0);
  }
  process.stdout.write(`Ara imzacı yazıldı: ${target} (sınıflar ${classes.join("·")}; sertifika ${cert.baslangic} → ${cert.bitis})\n`);
}

/** İptal belgesi dosyası: `iptal-uret` çıktısı (`{tur: "tekserp-iptal-belgesi", belge}`) ya da düz JWS. */
function revocationTokenOf(file: string): string {
  const text = readFileSync(file, "utf8").trim();
  if (!text.startsWith("{")) return text;
  const raw = JSON.parse(text) as { tur?: unknown; belge?: unknown };
  if (raw.tur !== "tekserp-iptal-belgesi" || typeof raw.belge !== "string") throw new CliError(`İptal belgesi dosyası tanınmıyor: ${file}`);
  return raw.belge;
}

/** Bir anahtar/sertifika dosyasından gömülü sertifika JWS'i (ALT · İNDİRME · ARA · BAYİ · emekli künye). */
function certificateTokenOf(file: string): string {
  const raw = JSON.parse(readFileSync(file, "utf8")) as { tur?: unknown; sertifika?: unknown };
  if (typeof raw.sertifika !== "string" || raw.sertifika.length === 0) throw new CliError(`Sertifika taşımayan dosya: ${file}`);
  if (raw.tur === "tekserp-kok-anahtar") throw new CliError(`Kök iptal edilemez (yalnız yeni derleme): ${file}`);
  return raw.sertifika;
}

// PAKET sertifikası buraya girmez: iptali ayrı belgededir (`tekserp-paketiptal`).
const CERT_USAGE_OF_FILE: Readonly<Record<string, RevocationDoc["iptaller"][number]["kullanim"]>> = {
  "tekserp-alt-anahtar": "ALT",
  "tekserp-indirme-anahtar": "INDIRME",
  "tekserp-ara-anahtar": "HAK",
  "tekserp-bayi-anahtar": "BAYI",
};

/**
 * İPTAL BELGESİ (yalnız kök): önceki belge (varsa) kökle doğrulanır ve BÜTÜN satırları taşınır (iptal sessizce geri
 * alınamaz), `sira` = önceki + 1 (yoksa 1). Yeni satırlar verilen dosyaların kök imzalı sertifikalarından.
 */
async function generateRevocation(flags: Map<string, string>): Promise<void> {
  const rootKid = required(flags, "kok");
  const target = path.resolve(required(flags, "cikti"));
  if (existsSync(target)) throw new CliError(`${target} zaten var — üstüne yazılmaz`);
  const root = rootAnchorOf(path.resolve(required(flags, "kok-dizin")), rootKid);
  let previous: RevocationDoc | null = null;
  if (flags.get("onceki")) {
    const v = verifyRevocation(revocationTokenOf(path.resolve(flags.get("onceki")!)), root.anchor);
    if (!v.ok) throw new CliError(`Önceki iptal belgesi bu kökle doğrulanamadı: ${v.code}`);
    previous = v.value.document;
  }
  const neden = (flags.get("neden") ?? "").trim();
  if (neden.length > 200) throw new CliError("--neden en çok 200 karakter");
  const now = Date.now();
  const entries = [...(previous?.iptaller ?? [])];
  for (const file of (flags.get("iptal") ?? "").split(",").map((x) => x.trim()).filter(Boolean)) {
    const raw = JSON.parse(readFileSync(path.resolve(file), "utf8")) as { tur?: unknown; kaynakTur?: unknown };
    if (raw.tur === "tekserp-kok-anahtar") throw new CliError(`Kök iptal edilemez (yalnız yeni derleme): ${file}`);
    const fileType = String(raw.tur === RETIRED_KEY_TYPE ? raw.kaynakTur : raw.tur);
    const usage = CERT_USAGE_OF_FILE[fileType];
    if (!usage) throw new CliError(`İptal edilecek dosyanın türü tanınmıyor: ${file}`);
    const token = certificateTokenOf(path.resolve(file));
    const parsed = parseJws(token);
    const start = parsed.ok && typeof parsed.value.payload.baslangic === "string" ? Date.parse(parsed.value.payload.baslangic) : NaN;
    const cert = verifyCertificate(token, { roots: root.anchor, usage, atMs: start });
    if (!cert.ok) throw new CliError(`Sertifika bu kökle doğrulanamadı (${cert.code}): ${file}`);
    const doc = cert.value.document;
    if (entries.some((e) => e.sertifikaId === doc.sertifikaId)) continue;
    entries.push({ kid: doc.kid, sertifikaId: doc.sertifikaId, kullanim: usage, tarih: new Date(now).toISOString(), neden: neden || "dönem töreni" });
  }
  if (entries.length > REVOCATION_MAX_ENTRIES) throw new CliError(`İptal satırı en çok ${REVOCATION_MAX_ENTRIES}`);
  const payload: RevocationDoc = { v: 1, iptalId: randomUUID(), sira: (previous?.sira ?? 0) + 1, verilis: new Date(now).toISOString(), iptaller: entries };
  const password = await askPassword(`Kök (${rootKid}) parolası: `);
  let token: string;
  try {
    token = await signWithCopy(root.path, TYP.IPTAL, payload, password);
  } finally {
    password.fill(0);
  }
  const check = verifyRevocation(token, root.anchor);
  if (!check.ok || check.value.document.sira !== payload.sira) throw new CliError(`Üretilen iptal belgesi doğrulanamadı: ${check.ok ? "sıra" : check.code}`);
  writePublicFile(target, { v: 1, tur: "tekserp-iptal-belgesi", sira: payload.sira, belge: token });
  process.stdout.write(`İptal belgesi yazıldı: ${target} (sıra ${payload.sira}, ${entries.length} satır)\n`);
}

/**
 * Kök kuyruğunu imzalar (Mac, tören): her yük şemadan AYNEN geçmeli (şema bir alanı düşürürse RED — imzalanan,
 * kuyruktaki yükün kendisi olsun), imzacı sertifikası taşımamalı ve kökün sınıfında olmalı.
 */
async function signRootQueue(flags: Map<string, string>): Promise<void> {
  const rootKid = required(flags, "kok");
  const target = path.resolve(required(flags, "cikti"));
  if (existsSync(target)) throw new CliError(`${target} zaten var — üstüne yazılmaz`);
  const root = rootAnchorOf(path.resolve(required(flags, "kok-dizin")), rootKid);
  const input = JSON.parse(readFileSync(path.resolve(required(flags, "kuyruk")), "utf8")) as { v?: unknown; tur?: unknown; talepler?: unknown };
  if (input.v !== 1 || input.tur !== "tekserp-kok-kuyrugu" || !Array.isArray(input.talepler)) throw new CliError("Kuyruk dosyası tanınmıyor (tekserp-kok-kuyrugu)");
  const requests = input.talepler as { talepId?: unknown; hakId?: unknown; surum?: unknown; yuk?: unknown }[];
  for (const r of requests) {
    if (typeof r.talepId !== "string" || !UuidSchema.safeParse(r.talepId).success) throw new CliError("Kuyrukta talep kimliği biçimsiz");
    const decoded = decodeDocument(EntitlementSchema, r.yuk);
    if (!decoded.ok) throw new CliError(`Talep ${r.talepId}: yük HAK şemasına uymuyor (${decoded.message})`);
    if (canonical(decoded.value) !== canonical(r.yuk)) throw new CliError(`Talep ${r.talepId}: yük şemadan AYNEN geçmiyor — imzalanmadı`);
    if (decoded.value.imzaciSertifikasi || decoded.value.bayiSertifikasi) throw new CliError(`Talep ${r.talepId}: kök imzalı HAK imzacı sertifikası taşıyamaz`);
    if (!root.classes.includes(decoded.value.sinif)) throw new CliError(`Talep ${r.talepId}: kök ${rootKid} ${decoded.value.sinif} sınıfına yetkili değil`);
    if (decoded.value.hakId !== r.hakId || decoded.value.surum !== r.surum) throw new CliError(`Talep ${r.talepId}: yükün hakId/sürümü talep satırıyla uyuşmuyor`);
  }
  const password = await askPassword(`Kök (${rootKid}) parolası: `);
  const signed: { talepId: string; hakId: string; surum: number; belge: string }[] = [];
  try {
    for (const r of requests) {
      const belge = await signWithCopy(root.path, TYP.HAK, r.yuk as Record<string, unknown>, password);
      const v = verifyEntitlement(belge, root.anchor);
      if (!v.ok || v.value.signer.kind !== "KOK") throw new CliError(`Talep ${String(r.talepId)}: imzalanan HAK doğrulanamadı`);
      signed.push({ talepId: String(r.talepId), hakId: v.value.document.hakId, surum: v.value.document.surum, belge });
    }
  } finally {
    password.fill(0);
  }
  writePublicFile(target, { v: 1, tur: "tekserp-kok-imzali-haklar", haklar: signed });
  process.stdout.write(`Kök imzalı HAK: ${signed.length} talep → ${target}\n`);
}

function canonical(value: unknown): string {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, walk((v as Record<string, unknown>)[k])]));
    return v;
  };
  return JSON.stringify(walk(value));
}

/** Ortamdan yapılandırma + anahtar deposu (konteyner içi; çapa ortamın kipinden). */
async function cliContext() {
  const { loadEnvFile } = await import("../src/lib/env");
  const { loadConfig } = await import("../src/config");
  loadEnvFile();
  const config = loadConfig(process.env, path.resolve(__dirname, ".."));
  return { keys: KeyStore.load(config) };
}

/** VDS: kök kuyruğunu stdout'a basar (tören girdisi; açık belge, sır taşımaz). */
async function exportQueue(): Promise<void> {
  const { prisma } = await import("../src/lib/prisma");
  const { exportRootQueue } = await import("../src/services/root-queue.service");
  try {
    process.stdout.write(`${JSON.stringify(await exportRootQueue(prisma))}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

async function readAllInput(flags: Map<string, string>): Promise<string> {
  if (flags.get("dosya")) return readFileSync(path.resolve(flags.get("dosya")!), "utf8");
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * VDS: tören paketinin `ice-aktar.json`ını içe aktarır — önce iptal belgesi (defter, sıra tekdüze), sonra kök imzalı
 * HAK'lar (kuyruktaki yükle birebir). Her adımın sonucu basılır; biri düşerse çıkış 1 (diğerleri yine denenir).
 */
async function importPeriod(flags: Map<string, string>): Promise<void> {
  const input = JSON.parse(await readAllInput(flags)) as { v?: unknown; tur?: unknown; iptal?: unknown; haklar?: unknown };
  if (input.v !== 1 || input.tur !== "tekserp-donem-ice-aktar") throw new CliError("İçe aktarma dosyası tanınmıyor (tekserp-donem-ice-aktar)");
  const ctx = await cliContext();
  const { prisma } = await import("../src/lib/prisma");
  const { importRevocation } = await import("../src/services/revocation.service");
  const { importRootSignedEntitlement } = await import("../src/services/root-queue.service");
  const actor = "cli:donem-ice-aktar";
  let failed = 0;
  try {
    if (typeof input.iptal === "string") {
      try {
        const r = await importRevocation({ token: input.iptal, anchor: ctx.keys.anchor, actor });
        process.stdout.write(`iptal belgesi sıra ${r.sira}: ${r.durum} (${r.kidler.length} anahtar)\n`);
      } catch (err) {
        failed++;
        process.stdout.write(`iptal belgesi: RED — ${(err as Error).message}\n`);
      }
    }
    for (const h of Array.isArray(input.haklar) ? (input.haklar as { talepId?: unknown; belge?: unknown }[]) : []) {
      try {
        if (typeof h.talepId !== "string" || typeof h.belge !== "string") throw new CliError("talep satırı biçimsiz");
        const r = await importRootSignedEntitlement(ctx, { talepId: h.talepId, belge: h.belge, actor });
        process.stdout.write(`HAK talebi ${h.talepId}: ${r.durum}${r.surum ? ` (sürüm ${r.surum})` : ""}\n`);
      } catch (err) {
        failed++;
        process.stdout.write(`HAK talebi ${String(h.talepId)}: RED — ${(err as Error).message}\n`);
      }
    }
  } finally {
    await prisma.$disconnect();
  }
  if (failed > 0) throw new Error(`${failed} kalem içe aktarılamadı`);
}

const RETIRABLE: Readonly<Record<string, { suffix: string; tur: RetiredKeyFile["kaynakTur"] }>> = {
  "alt-": { suffix: ".anahtar.json", tur: "tekserp-alt-anahtar" },
  "ind-": { suffix: ".anahtar.json", tur: "tekserp-indirme-anahtar" },
  "ara-": { suffix: ".ara.json", tur: "tekserp-ara-anahtar" },
};

/**
 * Eski anahtarın ÖZEL yarısını siler, açık yarı + sertifikası `<kid>.sertifika.json` olarak kalır (eski belgeler
 * onunla doğrulanır). Aynı türde sertifikası DAHA YENİ başlayan bir anahtar dizinde yoksa RED (imzasız kalmasın).
 * Varsayılan KURU: yapılacağı listeler; `--uygula` ile yazar/siler. Dizin anahtar birimidir (VDS'te yazılır bağla).
 */
function retireKeys(flags: Map<string, string>): void {
  const dir = path.resolve(flags.get("dizin") || process.env.ANAHTAR_DIZINI || "anahtarlar");
  if (!existsSync(dir)) throw new CliError(`Anahtar dizini yok: ${dir}`);
  const apply = flags.has("uygula");
  const kids = required(flags, "kid").split(",").map((x) => x.trim()).filter(Boolean);
  const plan: { kid: string; file: string; archive: string; body: RetiredKeyFile }[] = [];
  for (const kid of kids) {
    const kind = Object.entries(RETIRABLE).find(([prefix]) => kid.startsWith(prefix));
    if (!kind) throw new CliError(`Emekliye ayrılabilen türler ALT · İNDİRME · ARA: ${kid}`);
    const [prefix, meta] = kind;
    const file = path.join(dir, `${kid}${meta.suffix}`);
    const archive = path.join(dir, `${kid}.sertifika.json`);
    if (!existsSync(file) && existsSync(archive)) {
      process.stdout.write(`${kid}: zaten emekli (${path.basename(archive)}) — atlandı\n`);
      continue;
    }
    if (!existsSync(file)) throw new CliError(`Anahtar dosyası yok: ${file}`);
    if (existsSync(archive)) throw new CliError(`Emekli künyesi zaten var ama özel yarı da duruyor: ${file}`);
    const loaded = meta.tur === "tekserp-ara-anahtar" ? readWrappedKeyFile(file) : readSubKeyFile(file);
    if (loaded.tur !== meta.tur || !loaded.sertifika) throw new CliError(`${file} beklenen türde değil (${meta.tur})`);
    const start = (token: string): number => {
      const p = parseJws(token);
      return p.ok && typeof p.value.payload.baslangic === "string" ? Date.parse(p.value.payload.baslangic) : NaN;
    };
    const mine = start(loaded.sertifika);
    const newer = listKeyFiles(dir, meta.suffix).filter((f) => {
      const n = path.basename(f);
      if (!n.startsWith(prefix) || n === path.basename(file) || kids.some((k) => n === `${k}${meta.suffix}`)) return false;
      try {
        const other = meta.tur === "tekserp-ara-anahtar" ? readWrappedKeyFile(f) : readSubKeyFile(f);
        return other.tur === meta.tur && typeof other.sertifika === "string" && start(other.sertifika) > mine;
      } catch {
        return false;
      }
    });
    if (newer.length === 0) throw new CliError(`${kid}: aynı türde daha yeni anahtar yok — emekliye ayrılırsa imza durur`);
    const body = RetiredKeyFileSchema.parse({ tur: RETIRED_KEY_TYPE, surum: 1, kid, kaynakTur: meta.tur, x: loaded.x, sertifika: loaded.sertifika, emeklilik: new Date().toISOString() });
    plan.push({ kid, file, archive, body });
  }
  for (const p of plan) process.stdout.write(`${apply ? "" : "[kuru] "}${p.kid}: özel yarı silinir (${path.basename(p.file)}) → ${path.basename(p.archive)}\n`);
  if (!apply) {
    process.stdout.write("Kuru koşum — hiçbir şey değişmedi. Uygulamak için --uygula.\n");
    return;
  }
  for (const p of plan) {
    writeKeyFileExclusive(p.archive, p.body);
    RetiredKeyFileSchema.parse(JSON.parse(readFileSync(p.archive, "utf8")));
    unlinkSync(p.file);
  }
  process.stdout.write(`${plan.length} anahtar emekliye ayrıldı.\n`);
}

function listKeyFiles(dir: string, suffix: string): string[] {
  return readdirSync(dir).filter((n) => n.endsWith(suffix)).map((n) => path.join(dir, n));
}

/**
 * Sunucunun üç simetrik sırrının TEK üreticisi (anahtar birimi VDS'te SALT OKUNUR — sunucu ve CLI'lar yalnız okur):
 * portal TOTP sarma anahtarı · etkinleştirme kodu sırrı (pepper) · modül kasası anahtarı. Var olanın üstüne
 * YAZILMAZ; kaybolursa TOTP'ler sıfırlanır / açık kodlar yeniden üretilir / kasa satırları açılamaz.
 */
function generateSecrets(flags: Map<string, string>): void {
  for (const { file, created } of generateServerSecrets(keyDir(flags))) {
    process.stdout.write(`${file}: ${created ? "üretildi (0600)" : "vardı, korundu"}\n`);
  }
}

/** Yayıncı indirme belirteçleri — anahtar dizini yalnız OKUNUR (dizin yoksa yaratılmaz). */
function publisherDownloadTokens(flags: Map<string, string>): void {
  const dir = path.resolve(flags.get("dizin") || process.env.ANAHTAR_DIZINI || "anahtarlar");
  if (!existsSync(dir)) throw new CliError(`Anahtar dizini yok: ${dir}`);
  const channels = required(flags, "kanal").split(",").map((s) => s.trim()).filter(Boolean);
  const minutes = flags.has("dk") ? Number(flags.get("dk")) : PUBLISHER_DEFAULT_MINUTES;
  const dosya = process.env.GUVEN_CAPASI_DOSYASI || undefined;
  const kip = flags.get("capa") ?? process.env.GUVEN_CAPASI ?? anchorModeOfKeyDir(dir) ?? undefined;
  if (kip !== undefined && kip !== "uretim" && kip !== "hazirlik") throw new CliError(`Güven çapası kipi tanınmıyor: ${kip} (uretim|hazirlik)`);
  if (kip === undefined && !dosya) throw new CliError("Güven çapası kipi belirsiz: --capa=uretim|hazirlik (anahtar dizininde tek aileden kök yok)");
  let keys: KeyStore;
  try {
    keys = KeyStore.load({ ANAHTAR_DIZINI: dir, GUVEN_CAPASI: kip, GUVEN_CAPASI_DOSYASI: dosya });
  } catch (err) {
    throw new CliError((err as Error).message);
  }
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
      return generateSecrets(flags);
    case "indirme-belirteci":
      return publisherDownloadTokens(flags);
    case "ara-uret":
      return generateIntermediate(flags);
    case "iptal-uret":
      return generateRevocation(flags);
    case "kuyruk-imzala":
      return signRootQueue(flags);
    case "kuyruk-disa-aktar":
      return exportQueue();
    case "donem-ice-aktar":
      return importPeriod(flags);
    case "emekliye-ayir":
      return retireKeys(flags);
    default:
      throw new CliError(
        "Komut: kok-uret | alt-uret | indirme-uret | bayi-uret | ara-uret | iptal-uret | kuyruk-imzala | kuyruk-disa-aktar | donem-ice-aktar | emekliye-ayir | sirlar-uret | indirme-belirteci (ayrıntı dosya başında)",
      );
  }
}

main().then(
  () => process.exit(0),
  (err: Error) => {
    process.stderr.write(`HATA: ${err.message}\n`);
    process.exit(err instanceof CliError ? 2 : 1);
  },
);
