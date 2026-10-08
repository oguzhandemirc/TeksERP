// PAKET sertifikası — imza aracı tarafı (docs/design/PAKET-ANAHTARI-KOK-ALTINDA.md §2.5): kök imzalı açık sertifika
// anahtar dosyasının YANINDA durur (`<kid>.sertifika.json`, `{sertifika}`; ISTEMCI'nin `panel-imza.ts` düzeniyle aynı),
// özel yarıya ve parolaya dokunmaz. Kök çapası derlemenin üretim köklerinden; test çapası yalnız bekçi içindir.
import fs from "node:fs";
import path from "node:path";
import {
  DAY_MS,
  parseJws,
  prepareTrustAnchor,
  rootPublicKeysFor,
  verifyCertificate,
  verifyPackageRevocation,
  type RootKey,
  type VerifiedPackageRevocation,
} from "../../src/lib/license/protocol";
import { isChainPackageKid } from "../../src/lib/license/protocol/paket-zinciri";
import { packageKeyInfo } from "./butunluk-imza";

export const PACKAGE_CERT_FILE_SUFFIX = ".sertifika.json";
/** Bitişine bundan az gün kalmış sertifikayla yeni paket imzalanmaz (yıllık tören yenisini basar). */
export const PACKAGE_SIGN_MIN_DAYS = 30;
/** Bekçi kök çapası (RootKey[] JSON): yalnız test çapasının kabul edildiği yerde okunur. */
export const TEST_ROOTS_ENV = "TEKSERP_TEST_KOK_CAPASI";

const COMPACT_JWS = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export interface PackageRoots {
  readonly roots: readonly RootKey[];
  /** Kaynak: derlemenin üretim kökleri · tören kök dosyası · bekçi test çapası. */
  readonly kaynak: "uretim" | "kok-dosyasi" | "test";
}

function rootsChecked(list: readonly RootKey[], where: string): readonly RootKey[] {
  const a = prepareTrustAnchor(list);
  if (!a.ok) throw new Error(`kök çapası kurulamadı (${where}: ${a.code}) — ${a.message}`);
  return list;
}

/** Kök dosyasının (`*.kok.json`) açık yarısı — tören kökü; özel yarıya ve parolaya dokunulmaz. */
export function rootsFromKeyFile(file: string): readonly RootKey[] {
  const j = JSON.parse(fs.readFileSync(file, "utf8")) as { tur?: unknown; kid?: unknown; x?: unknown; siniflar?: unknown };
  if (j.tur !== "tekserp-kok-anahtar" || typeof j.kid !== "string" || typeof j.x !== "string" || !Array.isArray(j.siniflar)) {
    throw new Error(`kök anahtar dosyası değil: ${file}`);
  }
  return rootsChecked([{ kid: j.kid, x: j.x, classes: j.siniflar as RootKey["classes"] }], file);
}

/** Kök çapası: `--kok-dosyasi` (tören) > test çapası (`--kok-capa` ya da ortam; yalnız `testIzinli`) > üretim kökleri. */
export function packageRoots(g: { readonly kokDosyasi?: string | null; readonly testCapa?: string | null; readonly testIzinli?: boolean }): PackageRoots {
  if (g.kokDosyasi) return { roots: rootsFromKeyFile(g.kokDosyasi), kaynak: "kok-dosyasi" };
  const test = g.testCapa ?? process.env[TEST_ROOTS_ENV] ?? null;
  if (test) {
    if (g.testIzinli === false) throw new Error(`test kök çapası (${TEST_ROOTS_ENV}) burada kabul edilmez — yalnız bekçi içindir`);
    console.error("⚠ TEST KÖK ÇAPASI kullanılıyor — yalnız bekçi içindir");
    const list: unknown = JSON.parse(fs.readFileSync(test, "utf8"));
    if (!Array.isArray(list)) throw new Error(`test kök çapası bir dizi ({kid,x,classes}[]) olmalı: ${test} — kök anahtar dosyası --kok-dosyasi ile verilir`);
    return { roots: rootsChecked(list as RootKey[], test), kaynak: "test" };
  }
  return { roots: rootPublicKeysFor("uretim"), kaynak: "uretim" };
}

function certPayload(certificate: string): { kid: string; x: string; baslangic: string; bitis: string } {
  const p = parseJws(certificate);
  const y = p.ok ? (p.value.payload as Record<string, unknown>) : {};
  if (typeof y.kid !== "string" || typeof y.x !== "string" || typeof y.bitis !== "string" || typeof y.baslangic !== "string") {
    throw new Error("PAKET sertifikası okunamadı (kid/x/başlangıç/bitiş)");
  }
  return { kid: y.kid, x: y.x, baslangic: y.baslangic, bitis: y.bitis };
}

/** Sertifika dosyası (`{sertifika}`) ya da ham JWS metni → compact JWS. */
export function certificateTokenFromFile(file: string): string {
  const text = fs.readFileSync(file, "utf8").trim();
  const token = text.startsWith("{") ? (JSON.parse(text) as { sertifika?: unknown }).sertifika : text;
  if (typeof token !== "string" || !COMPACT_JWS.test(token)) throw new Error(`PAKET sertifikası dosyası tanınmıyor: ${file}`);
  return token;
}

/** Anahtarın sertifikası: `--sertifika` verilmişse o, yoksa anahtarın yanındaki `<kid>.sertifika.json` (yoksa RED). */
export function readPackageCertificate(g: { readonly keyFile: string; readonly kid: string; readonly file?: string | null }): string {
  const file = g.file ?? path.join(path.dirname(g.keyFile), `${g.kid}${PACKAGE_CERT_FILE_SUFFIX}`);
  if (!fs.existsSync(file)) {
    throw new Error(`${g.kid} PAKET sertifikası yok: ${file} — kök imzalı sertifika \`build-korumali-imza.ts sertifika-ekle\` ile eklenir`);
  }
  const token = certificateTokenFromFile(file);
  if (certPayload(token).kid !== g.kid) throw new Error(`sertifika başka anahtarın (${certPayload(token).kid}), imzalayan ${g.kid}`);
  return token;
}

/** Yeni paket imzası için: bitişine 30 günden az kalmış sertifikayla imza YOK (yıllık tören yenisini basar). */
export function assertPackageCertificateFresh(certificate: string, now: Date = new Date()): void {
  const c = certPayload(certificate);
  const kalan = (Date.parse(c.bitis) - now.getTime()) / DAY_MS;
  if (!(kalan >= PACKAGE_SIGN_MIN_DAYS)) {
    throw new Error(
      `PAKET sertifikası ${c.kid} bitişine ${kalan.toFixed(1)} gün kaldı (< ${PACKAGE_SIGN_MIN_DAYS}) — bununla İMZALANMAZ; yıllık dönem töreni yeni sertifikayı basar`,
    );
  }
}

/**
 * `sertifika-ekle`: kök imzalı PAKET sertifikası BU anahtarın mı — kök çapadaki bir kök imzalamış, kullanım PAKET,
 * kid ve `x` anahtar dosyasınınkiyle AYNI (uyuşmazsa RED), şu an pencerede. Parola istemez. Sonra anahtarın yanına
 * `<kid>.sertifika.json` (0600, var olanı ezmez; aynı içerik varsa dokunmaz).
 */
export function attachPackageCertificate(g: {
  readonly keyFile: string;
  readonly certificate: string;
  readonly roots: readonly RootKey[];
  readonly now?: Date;
}): { readonly file: string; readonly kid: string; readonly rootKid: string; readonly bitis: string; readonly yazildi: boolean } {
  const key = packageKeyInfo(g.keyFile);
  if (!isChainPackageKid(key.kid)) throw new Error(`PAKET sertifikası yalnız pkt-* anahtarına eklenir; verilen: ${key.kid}`);
  if (!COMPACT_JWS.test(g.certificate)) throw new Error("PAKET sertifikası compact JWS değil");
  const now = g.now ?? new Date();
  const v = verifyCertificate(g.certificate, { roots: g.roots, usage: "PAKET", atMs: now.getTime() });
  if (!v.ok) throw new Error(`PAKET sertifikası köke karşı doğrulanamadı (${v.code}): ${v.message}`);
  const c = v.value.document;
  if (c.kid !== key.kid) throw new Error(`sertifika başka anahtarın: sertifika kid ${c.kid}, anahtar ${key.kid} — EKLENMEDİ`);
  if (c.x !== key.x) throw new Error(`sertifikadaki açık anahtar (x) bu anahtar dosyasınınki DEĞİL (${key.kid}) — EKLENMEDİ`);
  const file = path.join(path.dirname(g.keyFile), `${key.kid}${PACKAGE_CERT_FILE_SUFFIX}`);
  const body = `${JSON.stringify({ sertifika: g.certificate }, null, 2)}\n`;
  if (fs.existsSync(file)) {
    if (fs.readFileSync(file, "utf8") === body) return { file, kid: key.kid, rootKid: v.value.rootKid, bitis: c.bitis, yazildi: false };
    throw new Error(`${file} zaten var ve farklı — üstüne yazılmaz`);
  }
  fs.writeFileSync(file, body, { mode: 0o600, flag: "wx" });
  return { file, kid: key.kid, rootKid: v.value.rootKid, bitis: c.bitis, yazildi: true };
}

/** Dağıtım iptali dosyası (ham JWS ya da `{belge}` sarmalı) → kökle doğrulanmış belge + ham metin. */
export function readPackageRevocationFile(file: string, roots: readonly RootKey[]): { readonly token: string; readonly verified: VerifiedPackageRevocation } {
  const text = fs.readFileSync(file, "utf8").trim();
  const token = text.startsWith("{") ? (JSON.parse(text) as { belge?: unknown }).belge : text;
  if (typeof token !== "string") throw new Error(`dağıtım iptali dosyası tanınmıyor: ${file}`);
  const v = verifyPackageRevocation(token, roots);
  if (!v.ok) throw new Error(`dağıtım iptali kökle doğrulanamadı (${v.code}): ${v.message}`);
  return { token, verified: v.value };
}
