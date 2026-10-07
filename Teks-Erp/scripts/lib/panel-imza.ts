// PANEL SÜRÜM KÜNYESİ — yayın makinesi tarafı (imza aracı `scripts/panel-imza.ts` + bekçisi `test_panel_imza`).
// Künyenin biçimi/doğrulaması TEK kaynaktan: `Electron/electron/guncelleme/*.mjs` (panelin kendi doğrulayıcısı);
// burada yalnız anahtar dosyası (sarma `protocol/anahtar-sarma.ts` — tek uygulama), paket dizininin ölçümü ve
// latest.yml'e yazım var. Her imza YAZILMADAN ÖNCE panelin doğrulayıcısıyla geri doğrulanır. Künye v:2: imzalayan
// `ist-*` anahtarı, yükte kök imzalı ISTEMCI sertifikası; panel çapası yalnız kökler (ISTEMCI-ANAHTARI-KOK-ALTINDA §3).
import { createPublicKey, generateKeyPairSync, type KeyObject } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { openSealedKey, privateKeyFromRaw, sealPrivateKey, type SealedKey } from "../../src/lib/license/protocol/anahtar-sarma";
import { isProductionPackageKid } from "../../src/lib/license/integrity-scope";
import { openPackageKey, PACKAGE_KEY_KIND } from "./butunluk-imza";
import { git } from "./git";
import { checkProductionAnchor, isSignerKid, type AnchorKey } from "../../../Electron/electron/guncelleme/kunye-jws.mjs";
import { CLIENT_CERT_USAGE, prepareRootAnchor, verifyCertificate, type RootAnchorKey } from "../../../Electron/electron/guncelleme/istemci-zinciri.mjs";
import {
  buildReleaseDoc,
  checkPanelRootAnchor,
  checkUpdateInfo,
  mergeReleaseRevocations,
  sha512File,
  sha512HexToBase64,
  signReleaseDoc,
  verifyArtifactFile,
  verifyReleaseBlock,
  type ReleaseDoc,
} from "../../../Electron/electron/guncelleme/panel-kunye.mjs";
import { parseLatestYml, withReleaseBlock } from "../../../Electron/electron/guncelleme/latest-yml.mjs";

export const PANEL_KEY_KIND = "tekserp-panel-anahtar";
/**
 * İstemci yayın anahtarı: `ist-<yıl>-<n>` (künye v:2 imzacısı, kök imzalı ISTEMCI sertifikalı) ya da `panel-<yıl>[-<n>]`
 * (tablet APK künyesinin gömülü çapalı ailesi). Yalnız parolalı.
 */
export const PANEL_KEY_KID = /^(?:panel-\d{4}(?:-\d{1,3})?|ist-\d{4}-\d{1,3})$/;
/** Sertifika dosyası (`<kid>.sertifika.json`): `sertifika` alanı compact JWS (satıcının verdiği dosyayla aynı alan adı). */
export const CERT_FILE_SUFFIX = ".sertifika.json";
const COMPACT_JWS = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
/** Yayın aracı, ISTEMCI sertifikasının bitişine bundan az gün kalmışsa İMZALAMAZ (tasarım §3.3; yıllık tören yeniler). */
export const CLIENT_SIGN_MIN_DAYS = 30;
const DAY_MS = 86_400_000;
/** Depo kökü: anahtar dosyası bunun içine yazılmaz (yanlışlıkla commit'lenmesin). */
export const DEPO_KOKU = path.resolve(__dirname, "..", "..", "..");
/** Panelin gömülü üretim çapası — imza aracı da yayın kapısı da BU dosyayı okur. */
export const PANEL_ANCHOR_FILE = path.join(DEPO_KOKU, "Electron", "electron", "guncelleme", "imza-capasi.json");

export interface OpenedSigningKey {
  readonly kid: string;
  readonly privateKey: KeyObject;
}

export interface PanelKeyFile extends SealedKey {
  readonly tur: typeof PANEL_KEY_KIND;
  readonly surum: 2;
  readonly kid: string;
  readonly siniflar: readonly string[];
  readonly x: string;
  readonly olusturma: string;
}

function readKeyJson(file: string): Record<string, unknown> {
  const mode = fs.statSync(file).mode & 0o777;
  if (process.platform !== "win32" && (mode & 0o077) !== 0) throw new Error(`anahtar dosyası başkalarına açık (${mode.toString(8)}) — chmod 600`);
  return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
}

const B64U = /^[A-Za-z0-9_-]+$/;

/** Panel anahtar dosyası KATI: yalnız bilinen alanlar, parolalı sürüm 2, `panel-`/`ist-` kid'i. */
function panelKeyOf(k: Record<string, unknown>): PanelKeyFile {
  const kdf = k.kdf as Record<string, unknown> | undefined;
  const alanlar = ["tur", "surum", "kid", "siniflar", "x", "kdf", "iv", "sifreli", "etiket", "olusturma"];
  const ok =
    Object.keys(k).every((a) => alanlar.includes(a)) &&
    k.tur === PANEL_KEY_KIND &&
    k.surum === 2 &&
    typeof k.kid === "string" &&
    /^(?:panel|ist)-[a-z0-9-]{1,40}$/.test(k.kid) &&
    typeof k.x === "string" && B64U.test(k.x) &&
    Array.isArray(k.siniflar) &&
    typeof k.iv === "string" && B64U.test(k.iv) &&
    typeof k.sifreli === "string" && B64U.test(k.sifreli) &&
    typeof k.etiket === "string" && B64U.test(k.etiket) &&
    typeof k.olusturma === "string" &&
    !!kdf && kdf.ad === "scrypt" && typeof kdf.tuz === "string" &&
    [kdf.N, kdf.r, kdf.p].every((n) => Number.isInteger(n)) &&
    (kdf.N as number) >= 1 << 14 && (kdf.N as number) <= 1 << 17;
  if (!ok) throw new Error("panel anahtar dosyası biçimsiz (yalnız parolalı `tekserp-panel-anahtar`, sürüm 2)");
  return k as unknown as PanelKeyFile;
}

/**
 * İmza anahtarını açar — iki karar seçeneğinin ikisi de: (a) üretim PAKET anahtarı (`paket-<yıl>`, parolalı;
 * hazırlık PAKET anahtarı RED — parolasızdır) · (b) ayrı panel yayın anahtarı (`panel-…`, parolalı). Parola
 * `ask` ile (TTY ya da stdin satırı); açılan ham özel yarı ve parola Buffer'ı iş bitince sıfırlanır.
 */
export async function openPanelSigningKey(file: string, ask: (kid: string) => Promise<Buffer>): Promise<OpenedSigningKey> {
  const k = readKeyJson(file);
  if (k.tur === PACKAGE_KEY_KIND) {
    if (typeof k.kid !== "string" || !isProductionPackageKid(k.kid)) {
      throw new Error(`panel künyesini yalnız ÜRETİM PAKET anahtarı imzalar (paket-<yıl>); verilen: ${String(k.kid)}`);
    }
    const opened = await openPackageKey(file, ask);
    return { kid: opened.kid, privateKey: opened.privateKey };
  }
  if (k.tur !== PANEL_KEY_KIND) throw new Error(`tanınmayan anahtar dosyası türü: ${String(k.tur)}`);
  const w = panelKeyOf(k);
  const password = await ask(w.kid);
  let raw: Buffer | null = null;
  try {
    raw = await openSealedKey(w, password);
    return { kid: w.kid, privateKey: privateKeyFromRaw(raw) };
  } finally {
    password.fill(0);
    raw?.fill(0);
  }
}

/** Anahtar dosyasının AÇIK yarısı (parola sorulmaz): yalnız parolalı `tekserp-panel-anahtar`. */
export function readPanelKeyPublic(file: string): { readonly kid: string; readonly x: string } {
  const w = panelKeyOf(readKeyJson(file));
  return { kid: w.kid, x: w.x };
}

/** Açılan özel anahtarın açık yarısı (base64url x) — dosyadaki `x` ile eşleşme ölçümü için. */
export function publicXOf(privateKey: KeyObject): string {
  return String(createPublicKey(privateKey).export({ format: "jwk" }).x);
}

/** (b) seçeneği töreni: ayrı panel yayın anahtarı üretir ve parolayla sarar (parolayı çağıran sıfırlar). */
export async function generatePanelKey(kid: string, password: Buffer): Promise<PanelKeyFile> {
  if (!PANEL_KEY_KID.test(kid)) throw new Error(`istemci anahtarı kid'i ist-<yıl>-<n> ya da panel-<yıl>[-<n>] biçiminde olmalı: ${kid}`);
  const { privateKey } = generateKeyPairSync("ed25519");
  const s = await sealPrivateKey({ tur: PANEL_KEY_KIND, kid, siniflar: [] }, privateKey, password);
  return { tur: PANEL_KEY_KIND, surum: 2, kid, siniflar: [], x: s.x, kdf: s.kdf, iv: s.iv, sifreli: s.sifreli, etiket: s.etiket, olusturma: new Date().toISOString() };
}

/** Anahtar dosyasını yazar: depo İÇİNE değil, var olanı EZMEZ, izin 0600. */
export function writePanelKey(dir: string, key: PanelKeyFile): string {
  const abs = path.resolve(dir);
  const rel = path.relative(DEPO_KOKU, abs);
  if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) throw new Error(`panel anahtarı depo içine yazılmaz: ${abs}`);
  fs.mkdirSync(abs, { recursive: true, mode: 0o700 });
  const file = path.join(abs, `${key.kid}.panel.json`);
  fs.writeFileSync(file, `${JSON.stringify(key, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  return file;
}

/** İmzacı çapası (`{anahtarlar: [{kid, x}]}`; tablet APK künyesi) — üretim çapası `checkProductionAnchor`dan geçmeli. */
export function readSignerAnchor(file: string, { test = false } = {}): readonly AnchorKey[] {
  const j = JSON.parse(fs.readFileSync(file, "utf8")) as { anahtarlar?: unknown };
  const list = Array.isArray(j.anahtarlar) ? (j.anahtarlar as AnchorKey[]) : [];
  if (!test) {
    const c = checkProductionAnchor(list);
    if (!c.ok) throw new Error(`istemci imza çapası kullanılamaz (${c.code}): ${c.message} — ${path.relative(DEPO_KOKU, file)}`);
  } else if (!list.every((k) => isSignerKid(k.kid))) {
    throw new Error("test çapasında künye imzalayamayacak kid var");
  }
  return list;
}

/** Panel kök çapası (`{kokler: [{kid, x, classes}]}`) — üretimde `kok-<yıl>-<n>` zorunlu, test kipinde yalnız geçerli kök çapası. */
export function readPanelAnchor(file: string = PANEL_ANCHOR_FILE, { test = false } = {}): readonly RootAnchorKey[] {
  const j = JSON.parse(fs.readFileSync(file, "utf8")) as { kokler?: unknown };
  const list = Array.isArray(j.kokler) ? (j.kokler as RootAnchorKey[]) : [];
  const c = test ? prepareRootAnchor(list) : checkPanelRootAnchor(list);
  if (!c.ok) throw new Error(`panel kök çapası kullanılamaz (${c.code}): ${c.message} — ${path.relative(DEPO_KOKU, file)}`);
  return list;
}

/** Anahtarın ISTEMCI sertifikası: verilen dosya ya da anahtar dosyasının yanındaki `<kid>.sertifika.json`. */
export function readClientCertificate(g: { readonly keyFile: string; readonly kid: string; readonly file?: string }): string {
  const file = g.file ?? path.join(path.dirname(g.keyFile), `${g.kid}${CERT_FILE_SUFFIX}`);
  let j: unknown;
  try {
    j = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`ISTEMCI sertifikası okunamadı (${file}): ${e instanceof Error ? e.message : String(e)}`);
  }
  const s = typeof j === "object" && j !== null ? (j as { sertifika?: unknown }).sertifika : undefined;
  if (typeof s !== "string" || !COMPACT_JWS.test(s)) throw new Error(`ISTEMCI sertifika dosyası biçimsiz (sertifika alanı compact JWS değil): ${file}`);
  return s;
}

/** Sertifikanın kalan günü; ISTEMCI sertifikası JWS'inden (imza burada değil, `verifyCertificate`te ölçülür). */
function certificateWindow(certificate: string): { readonly kid: string; readonly bitis: string } {
  const p = JSON.parse(Buffer.from(certificate.split(".")[1] ?? "", "base64url").toString("utf8")) as { kid?: unknown; bitis?: unknown };
  if (typeof p.kid !== "string" || typeof p.bitis !== "string" || Number.isNaN(Date.parse(p.bitis))) throw new Error("ISTEMCI sertifikası okunamadı (kid/bitiş)");
  return { kid: p.kid, bitis: p.bitis };
}

/** 30 gün kapısı (§3.3): bitişe 30 günden az kalmış ISTEMCI sertifikasıyla imza YOK — DUR + yıllık tören iletisi. */
export function assertCertificateFresh(certificate: string, now: Date = new Date()): void {
  const w = certificateWindow(certificate);
  const kalan = (Date.parse(w.bitis) - now.getTime()) / DAY_MS;
  if (kalan < CLIENT_SIGN_MIN_DAYS) {
    throw new Error(
      `ISTEMCI sertifikası ${w.kid} bitişine ${kalan.toFixed(1)} gün kaldı (< ${CLIENT_SIGN_MIN_DAYS}) — bununla İMZALANMAZ; ` +
        "yıllık dönem töreni (`uretim-toren.mjs donem --istemci`) yeni sertifikayı basar ve yayındakileri yeniden imzalar",
    );
  }
}

/**
 * `sertifika-ekle`: satıcının verdiği ISTEMCI sertifikası BU anahtarın mı ve köke bağlı mı — kök çapasındaki bir kök
 * imzalamış, kullanım ISTEMCI, kid ve `x` anahtar dosyasınınkiyle AYNI (uyuşmazsa RED), şu an pencerede. Sonra
 * anahtarın yanına `<kid>.sertifika.json` (0600, var olanı ezmez; aynı içerik varsa dokunmaz).
 */
export function attachClientCertificate(g: {
  readonly keyFile: string;
  readonly certificate: string;
  readonly anchor: readonly RootAnchorKey[];
  readonly now?: Date;
}): { readonly file: string; readonly kid: string; readonly rootKid: string; readonly bitis: string; readonly yazildi: boolean } {
  const key = readPanelKeyPublic(g.keyFile);
  if (!key.kid.startsWith("ist-")) throw new Error(`ISTEMCI sertifikası yalnız ist-* anahtarına eklenir; verilen: ${key.kid}`);
  if (!COMPACT_JWS.test(g.certificate)) throw new Error("ISTEMCI sertifikası compact JWS değil");
  const now = g.now ?? new Date();
  const v = verifyCertificate(g.certificate, { roots: g.anchor, usage: CLIENT_CERT_USAGE, atMs: now.getTime() });
  if (!v.ok) throw new Error(`ISTEMCI sertifikası köke karşı doğrulanamadı (${v.code}): ${v.message}`);
  const c = v.value.document as { kid: string; x: string; bitis: string };
  if (c.kid !== key.kid) throw new Error(`sertifika başka anahtarın: sertifika kid ${c.kid}, anahtar ${key.kid} — EKLENMEDİ`);
  if (c.x !== key.x) throw new Error(`sertifikadaki açık anahtar (x) bu anahtar dosyasınınki DEĞİL (${key.kid}) — EKLENMEDİ`);
  const file = path.join(path.dirname(g.keyFile), `${key.kid}${CERT_FILE_SUFFIX}`);
  const body = `${JSON.stringify({ sertifika: g.certificate }, null, 2)}\n`;
  if (fs.existsSync(file)) {
    if (fs.readFileSync(file, "utf8") === body) return { file, kid: key.kid, rootKid: v.value.rootKid, bitis: c.bitis, yazildi: false };
    throw new Error(`${file} zaten var ve farklı — üstüne yazılmaz`);
  }
  fs.writeFileSync(file, body, { mode: 0o600, flag: "wx" });
  return { file, kid: key.kid, rootKid: v.value.rootKid, bitis: c.bitis, yazildi: true };
}

export interface PanelPackage {
  readonly dir: string;
  readonly latestPath: string;
  readonly latestText: string;
  readonly setupPath: string;
  readonly surum: string;
}

/** Paket dizini (`Electron/release/<kanal>/<sürüm>/`): latest.yml + içinde adı geçen TEK kurulum dosyası. */
export function readPanelPackage(dir: string): PanelPackage {
  const latestPath = path.join(dir, "latest.yml");
  const latestText = fs.readFileSync(latestPath, "utf8");
  const p = parseLatestYml(latestText);
  if (!p.ok) throw new Error(p.message);
  const files = p.value.files;
  const url = files.length === 1 ? files[0]?.url : undefined;
  if (typeof url !== "string" || url !== `TeksERP-${p.value.version}-Setup.exe`) {
    throw new Error(`latest.yml tek bir TeksERP-${p.value.version}-Setup.exe listelemeli (bulunan: ${files.map((f) => String(f.url)).join(", ")})`);
  }
  return { dir, latestPath, latestText, setupPath: path.join(dir, url), surum: p.value.version };
}

function gitCommit(): string {
  return git(["rev-parse", "HEAD"], { cwd: DEPO_KOKU }).trim();
}

export interface SignInput {
  readonly dir: string;
  readonly kanal: string;
  readonly key: OpenedSigningKey;
  /** Kök imzalı ISTEMCI sertifikası (compact JWS) — `key.kid`in. */
  readonly certificate: string;
  /** İsteğe bağlı güncel dağıtım iptali (JWS) — künye bloğuna `iptal` olarak girer. */
  readonly iptal?: string;
  readonly anchor: readonly RootAnchorKey[];
  readonly commit?: string;
  readonly now?: Date;
}

/**
 * Kurulum dosyasını ÖLÇER (boy + sha512), latest.yml'deki kayıtla birebir olduğunu denetler, künyeyi kurar ve
 * imzalar, panelin doğrulayıcısıyla geri doğrular (çapa · kanal · latest.yml bağı · dosya) ve ancak sonra
 * latest.yml'e yazar (geçici dosya + yeniden adlandırma).
 */
export async function signPanelPackage(g: SignInput): Promise<{ readonly doc: ReleaseDoc; readonly token: string }> {
  assertCertificateFresh(g.certificate, g.now ?? new Date());
  const pkg = readPanelPackage(g.dir);
  const olcum = await sha512File(pkg.setupPath);
  const yml = parseLatestYml(pkg.latestText);
  if (!yml.ok) throw new Error(yml.message);
  const f = yml.value.files[0]!;
  if (f.size !== olcum.size || f.sha512 !== sha512HexToBase64(olcum.sha512)) {
    throw new Error(`latest.yml kurulum dosyasıyla uyuşmuyor (boy/sha512) — eski derleme kalıntısı olabilir: ${pkg.setupPath}`);
  }
  const doc = buildReleaseDoc({
    kanal: g.kanal,
    surum: pkg.surum,
    commit: g.commit ?? gitCommit(),
    yayinZamani: (g.now ?? new Date()).toISOString(),
    paket: { ad: path.basename(pkg.setupPath), boyut: olcum.size, sha512: olcum.sha512 },
    capa: g.anchor.map((k) => k.kid),
  });
  const now = g.now ?? new Date();
  const token = signReleaseDoc({ doc, kid: g.key.kid, privateKey: g.key.privateKey, certificate: g.certificate, signedAt: now.toISOString() });
  const next = withReleaseBlock(pkg.latestText, token, { iptal: g.iptal ?? null });
  const check = await verifyPanelPackageText(next, pkg.setupPath, { kanal: g.kanal, anchor: g.anchor, nowMs: now.getTime() });
  if (!check.ok) throw new Error(`imzalanan künye geri doğrulanamadı (${check.code}): ${check.message} — latest.yml'e YAZILMADI`);
  const tmp = `${pkg.latestPath}.imza-${process.pid}`;
  fs.writeFileSync(tmp, next, { flag: "wx" });
  fs.renameSync(tmp, pkg.latestPath);
  return { doc, token };
}

export type PanelCheck =
  | { readonly ok: true; readonly doc: ReleaseDoc; readonly kid: string; readonly rootKid: string }
  | { readonly ok: false; readonly code: string; readonly message: string; readonly detay?: string };

/** latest.yml metni + kurulum dosyası → panelin kabul edip etmeyeceği (yayın kapısının sorusu). */
export async function verifyPanelPackageText(
  text: string,
  setupPath: string,
  g: { readonly kanal: string; readonly anchor: readonly RootAnchorKey[]; readonly nowMs?: number },
): Promise<PanelCheck> {
  const p = parseLatestYml(text);
  if (!p.ok) return p;
  const revocation = mergeReleaseRevocations(p.value.tekserp, { roots: g.anchor, stored: null, fromToken: null }).revocation;
  const r = verifyReleaseBlock(p.value.tekserp, { roots: g.anchor, channel: g.kanal, nowMs: g.nowMs ?? Date.now(), revocation });
  if (!r.ok) return r;
  const b = checkUpdateInfo(r.value.doc, p.value);
  if (!b.ok) return b;
  const a = await verifyArtifactFile(r.value.doc, setupPath);
  if (!a.ok) return a;
  return { ok: true, doc: r.value.doc, kid: r.value.kid, rootKid: r.value.rootKid };
}

/**
 * Yayındaki künyeyi YENİDEN imzalar (yıllık tören §6 adım 4): eski blok çapaya karşı KENDİ imza anında geçerli olmalı
 * (kök tanınıyor · ISTEMCI · imza · iptal edilmemiş — çalınan anahtarın künyesi yeniden imzalanmaz) ve kanal bu grup.
 * Künye yükü AYNEN kalır (sürüm · paket özeti · `yayinZamani` · `capa`); yalnız imzacı, sertifika ve `imzaZamani`
 * değişir; bloktaki iptal taşınır. Yeni sertifikanın kökü paketin `capa`sında olmalı; 30 gün kapısı geçerli. Kurulum
 * dosyası gerekmez — paket baytı değişmez, latest.yml ↔ künye bağı ölçülür.
 */
export function resignPanelRelease(g: {
  readonly latestText: string;
  readonly kanal: string;
  readonly key: OpenedSigningKey;
  readonly certificate: string;
  readonly anchor: readonly RootAnchorKey[];
  readonly now?: Date;
}): { readonly text: string; readonly doc: ReleaseDoc; readonly oncekiKid: string; readonly yeniKid: string } {
  const now = g.now ?? new Date();
  if (!g.key.kid.startsWith("ist-")) throw new Error(`künyeyi yalnız ist-* anahtarı imzalar; verilen: ${g.key.kid}`);
  assertCertificateFresh(g.certificate, now);
  const p = parseLatestYml(g.latestText);
  if (!p.ok) throw new Error(p.message);
  const block = p.value.tekserp as { bildirim?: unknown; iptal?: unknown } | null;
  if (!block || typeof block.bildirim !== "string") throw new Error("latest.yml imzalı künye taşımıyor — yeniden imzalanacak bir şey yok");
  let eskiAn: number;
  try {
    eskiAn = Date.parse(String((JSON.parse(Buffer.from(block.bildirim.split(".")[1] ?? "", "base64url").toString("utf8")) as { imzaZamani?: unknown }).imzaZamani));
  } catch {
    eskiAn = Number.NaN;
  }
  if (!Number.isFinite(eskiAn)) throw new Error("yayındaki künyenin imza zamanı okunamadı");
  const revocation = mergeReleaseRevocations(block, { roots: g.anchor, stored: null, fromToken: null }).revocation;
  const eski = verifyReleaseBlock(block, { roots: g.anchor, channel: g.kanal, nowMs: eskiAn, revocation });
  if (!eski.ok) throw new Error(`yayındaki künye geçerli değil (${eski.code}): ${eski.message} — yeniden İMZALANMAZ`);
  const bag = checkUpdateInfo(eski.value.doc, p.value);
  if (!bag.ok) throw new Error(`yayındaki latest.yml künyeyle uyuşmuyor (${bag.code}) — yeniden İMZALANMAZ`);
  const sertifikaKoku = verifyCertificate(g.certificate, { roots: g.anchor, usage: CLIENT_CERT_USAGE, atMs: now.getTime() });
  if (!sertifikaKoku.ok) throw new Error(`yeni ISTEMCI sertifikası doğrulanamadı (${sertifikaKoku.code}): ${sertifikaKoku.message}`);
  if (!eski.value.doc.capa.includes(sertifikaKoku.value.rootKid)) {
    throw new Error(`yeni sertifikanın kökü ${sertifikaKoku.value.rootKid} paketin çapasında değil (${eski.value.doc.capa.join(", ")})`);
  }
  if ((sertifikaKoku.value.document as { x: string }).x !== publicXOf(g.key.privateKey)) throw new Error("sertifika imza anahtarının değil (x uyuşmuyor)");
  const token = signReleaseDoc({ doc: eski.value.doc, kid: g.key.kid, privateKey: g.key.privateKey, certificate: g.certificate, signedAt: now.toISOString() });
  const text = withReleaseBlock(g.latestText, token, { iptal: typeof block.iptal === "string" ? block.iptal : null });
  const q = parseLatestYml(text);
  if (!q.ok) throw new Error(q.message);
  const yeni = verifyReleaseBlock(q.value.tekserp, { roots: g.anchor, channel: g.kanal, nowMs: now.getTime(), revocation });
  if (!yeni.ok) throw new Error(`yeniden imzalanan künye geri doğrulanamadı (${yeni.code}): ${yeni.message}`);
  const bag2 = checkUpdateInfo(yeni.value.doc, q.value);
  if (!bag2.ok || JSON.stringify(yeni.value.doc) !== JSON.stringify(eski.value.doc)) throw new Error("yeniden imzada künye yükü değişti — YAZILMADI");
  return { text, doc: yeni.value.doc, oncekiKid: eski.value.kid, yeniKid: g.key.kid };
}

/** Kök anahtar dosyasının (`*.kok.json`) AÇIK yarısından tek köklü çapa — tören, satıcının kendi köküyle ölçer. */
export function rootAnchorFromKeyFile(file: string): readonly RootAnchorKey[] {
  const j = JSON.parse(fs.readFileSync(file, "utf8")) as { tur?: unknown; kid?: unknown; x?: unknown; siniflar?: unknown };
  if (j.tur !== "tekserp-kok-anahtar" || typeof j.kid !== "string" || typeof j.x !== "string" || !Array.isArray(j.siniflar)) {
    throw new Error(`kök anahtar dosyası değil: ${file}`);
  }
  const list = [{ kid: j.kid, x: j.x, classes: j.siniflar as string[] }] as unknown as RootAnchorKey[];
  const c = prepareRootAnchor(list);
  if (!c.ok) throw new Error(`kök dosyasından çapa kurulamadı (${c.code}): ${c.message}`);
  return list;
}
