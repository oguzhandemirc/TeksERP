// PANEL SÜRÜM KÜNYESİ — yayın makinesi tarafı (imza aracı `scripts/panel-imza.ts` + bekçisi `test_panel_imza`).
// Künyenin biçimi/doğrulaması TEK kaynaktan: `Electron/electron/guncelleme/*.mjs` (panelin kendi doğrulayıcısı);
// burada yalnız anahtar dosyası (sarma `protocol/anahtar-sarma.ts` — tek uygulama), paket dizininin ölçümü ve
// latest.yml'e yazım var. Her imza YAZILMADAN ÖNCE panelin doğrulayıcısıyla geri doğrulanır.
import { generateKeyPairSync, type KeyObject } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { openSealedKey, privateKeyFromRaw, sealPrivateKey, type SealedKey } from "../../src/lib/license/protocol/anahtar-sarma";
import { isProductionPackageKid } from "../../src/lib/license/integrity-scope";
import { openPackageKey, PACKAGE_KEY_KIND } from "./butunluk-imza";
import { git } from "./git";
import { checkProductionAnchor, isSignerKid, type AnchorKey } from "../../../Electron/electron/guncelleme/kunye-jws.mjs";
import {
  buildReleaseDoc,
  checkUpdateInfo,
  sha512File,
  sha512HexToBase64,
  signReleaseDoc,
  verifyArtifactFile,
  verifyReleaseBlock,
  type ReleaseDoc,
} from "../../../Electron/electron/guncelleme/panel-kunye.mjs";
import { parseLatestYml, withReleaseBlock } from "../../../Electron/electron/guncelleme/latest-yml.mjs";

export const PANEL_KEY_KIND = "tekserp-panel-anahtar";
/** Ayrı panel yayın anahtarı (b seçeneği): `panel-<yıl>[-<n>]`, yalnız parolalı. */
export const PANEL_KEY_KID = /^panel-\d{4}(?:-\d{1,3})?$/;
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

/** Panel anahtar dosyası KATI: yalnız bilinen alanlar, parolalı sürüm 2, `panel-` kid'i. */
function panelKeyOf(k: Record<string, unknown>): PanelKeyFile {
  const kdf = k.kdf as Record<string, unknown> | undefined;
  const alanlar = ["tur", "surum", "kid", "siniflar", "x", "kdf", "iv", "sifreli", "etiket", "olusturma"];
  const ok =
    Object.keys(k).every((a) => alanlar.includes(a)) &&
    k.tur === PANEL_KEY_KIND &&
    k.surum === 2 &&
    typeof k.kid === "string" &&
    /^panel-[a-z0-9-]{1,40}$/.test(k.kid) &&
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

/** (b) seçeneği töreni: ayrı panel yayın anahtarı üretir ve parolayla sarar (parolayı çağıran sıfırlar). */
export async function generatePanelKey(kid: string, password: Buffer): Promise<PanelKeyFile> {
  if (!PANEL_KEY_KID.test(kid)) throw new Error(`panel anahtarı kid'i panel-<yıl>[-<n>] biçiminde olmalı: ${kid}`);
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

/** Çapa dosyası (`{anahtarlar: [{kid, x}]}`) — üretim çapası `checkProductionAnchor`dan geçmeli. */
export function readPanelAnchor(file: string = PANEL_ANCHOR_FILE, { test = false } = {}): readonly AnchorKey[] {
  const j = JSON.parse(fs.readFileSync(file, "utf8")) as { anahtarlar?: unknown };
  const list = Array.isArray(j.anahtarlar) ? (j.anahtarlar as AnchorKey[]) : [];
  if (!test) {
    const c = checkProductionAnchor(list);
    if (!c.ok) throw new Error(`panel imza çapası kullanılamaz (${c.code}): ${c.message}`);
  } else if (!list.every((k) => isSignerKid(k.kid))) {
    throw new Error("test çapasında panel künyesi imzalayamayacak kid var");
  }
  return list;
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
  readonly anchor: readonly AnchorKey[];
  readonly commit?: string;
  readonly now?: Date;
}

/**
 * Kurulum dosyasını ÖLÇER (boy + sha512), latest.yml'deki kayıtla birebir olduğunu denetler, künyeyi kurar ve
 * imzalar, panelin doğrulayıcısıyla geri doğrular (çapa · kanal · latest.yml bağı · dosya) ve ancak sonra
 * latest.yml'e yazar (geçici dosya + yeniden adlandırma).
 */
export async function signPanelPackage(g: SignInput): Promise<{ readonly doc: ReleaseDoc; readonly token: string }> {
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
  const token = signReleaseDoc({ doc, kid: g.key.kid, privateKey: g.key.privateKey });
  const next = withReleaseBlock(pkg.latestText, token);
  const check = await verifyPanelPackageText(next, pkg.setupPath, { kanal: g.kanal, anchor: g.anchor });
  if (!check.ok) throw new Error(`imzalanan künye geri doğrulanamadı (${check.code}): ${check.message} — latest.yml'e YAZILMADI`);
  const tmp = `${pkg.latestPath}.imza-${process.pid}`;
  fs.writeFileSync(tmp, next, { flag: "wx" });
  fs.renameSync(tmp, pkg.latestPath);
  return { doc, token };
}

export type PanelCheck =
  | { readonly ok: true; readonly doc: ReleaseDoc; readonly kid: string }
  | { readonly ok: false; readonly code: string; readonly message: string };

/** latest.yml metni + kurulum dosyası → panelin kabul edip etmeyeceği (yayın kapısının sorusu). */
export async function verifyPanelPackageText(text: string, setupPath: string, g: { readonly kanal: string; readonly anchor: readonly AnchorKey[] }): Promise<PanelCheck> {
  const p = parseLatestYml(text);
  if (!p.ok) return p;
  const r = verifyReleaseBlock(p.value.tekserp, { keys: g.anchor, channel: g.kanal });
  if (!r.ok) return r;
  const b = checkUpdateInfo(r.value.doc, p.value);
  if (!b.ok) return b;
  const a = await verifyArtifactFile(r.value.doc, setupPath);
  if (!a.ok) return a;
  return { ok: true, doc: r.value.doc, kid: r.value.kid };
}
