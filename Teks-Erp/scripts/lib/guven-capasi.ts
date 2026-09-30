// Güven çapası dosyalarının AYRIŞTIRICISI + ÜRETİCİSİ — `scripts/guven-capasi-ekle.ts` (CLI) ve bekçisi
// (`test_guven_capasi_ekle.ts`) ortak kullanır. Dört yer TEK listeden yazılır: TS kök çapası (+ satıcı ve
// patron bayt-eşit aynası), TS PAKET çapası, native gömülü çapa (`anchor.rs`, rustfmt düzeniyle).
// Biçim beklenenden saparsa (elle düzenleme) ayrıştırıcı DURUR: metne tahminle ekleme yapılmaz.
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  LICENSE_CLASSES,
  STAGING_ROOT_CLASSES,
  prepareTrustAnchor,
  publicKeyFromX,
  publicKeyX,
  type LicenseClass,
  type RootKey,
} from "../../src/lib/license/protocol";
import { isProductionPackageKid, isStagingPackageKid } from "../../src/lib/license/integrity-scope";
import type { PackageKey } from "../../src/lib/license/integrity";

/** Depo köküne göre yollar. Aynalar kaynağın BAYT-EŞİT kopyasıdır (`test_lisans_protokol_aynasi`). */
export const CAPA_DOSYALARI = Object.freeze({
  kokTs: "Teks-Erp/src/lib/license/protocol/kok-anahtarlar.ts",
  kokAynalari: Object.freeze(["satici/sunucu/src/lisans-protokol/kok-anahtarlar.ts", "patron/sunucu/src/lisans-protokol/kok-anahtarlar.ts"]),
  paketTs: "Teks-Erp/src/lib/license/integrity.ts",
  anchorRs: "Teks-Erp/native/tekserp-dogrulama/src/anchor.rs",
});

/** Kök kid'i: üretim `kok-<yıl>-<n>` · hazırlık `hazirlik-<yıl>-<n>` (satıcı `anahtar.ts kok-uret` ile aynı biçim). */
export const KOK_KID_BICIMI = /^(?:kok|hazirlik)-\d{4}-\d{1,3}$/;
const PAKET_KID_ZEMIN = /^paket-[a-z0-9-]{1,40}$/;

/**
 * Çapaya girebilecek PAKET kid'i mi: üretim (`paket-<yıl>[-<n>]`) ya da hazırlık (`paket-hazirlik…`) — iki kural
 * `integrity-scope.ts`te; fikstür kid'leri (`paket-fikstur`) bu kuralın DIŞINDADIR.
 */
export function paketKidGecerli(kid: string): boolean {
  return PAKET_KID_ZEMIN.test(kid) && (isProductionPackageKid(kid) || isStagingPackageKid(kid));
}

export class CapaHatasi extends Error {
  constructor(
    readonly tur: "BICIM" | "GECERSIZ" | "CAKISMA",
    message: string,
  ) {
    super(message);
  }
}

export interface CapaDurumu {
  readonly kokler: readonly RootKey[];
  readonly paketler: readonly PackageKey[];
  /** Ham metinler (yeniden yazım bu metinlerin içinde yalnız blokları değiştirir). */
  readonly metin: { readonly kokTs: string; readonly paketTs: string; readonly anchorRs: string };
}

// ── TS kök çapası ────────────────────────────────────────────────────────────
const KOK_BLOK = /^export const ROOT_PUBLIC_KEYS: readonly RootKey\[\] = Object\.freeze\(\[\n([\s\S]*?)^\]\);$/m;
const KOK_GIRDI = /^ {2}Object\.freeze\(\{\n {4}kid: "([^"\n]+)",\n {4}x: "([^"\n]+)",\n {4}classes: Object\.freeze<LicenseClass\[\]>\(\[([^\]\n]*)\]\),\n {2}\}\),\n/gm;

function kokTsGirdisi(r: RootKey): string {
  return [
    "  Object.freeze({",
    `    kid: ${JSON.stringify(r.kid)},`,
    `    x: ${JSON.stringify(r.x)},`,
    `    classes: Object.freeze<LicenseClass[]>([${r.classes.map((c) => JSON.stringify(c)).join(", ")}]),`,
    "  }),",
    "",
  ].join("\n");
}

function siniflariAyristir(metin: string, nerede: string): LicenseClass[] {
  const parcalar = metin.split(", ").map((p) => /^"([A-Z]+)"$/.exec(p)?.[1]);
  if (parcalar.some((c) => !c || !(LICENSE_CLASSES as readonly string[]).includes(c))) {
    throw new CapaHatasi("BICIM", `${nerede}: sınıf listesi ayrıştırılamadı (${metin})`);
  }
  return parcalar as LicenseClass[];
}

/** Bloğu kesin biçimle ayrıştırır: girdiler bloğu TAMAMEN kaplamalı (yeniden üretim = aynı bayt). */
function bloktanGirdiler<T>(metin: string, blok: RegExp, girdi: RegExp, uret: (m: RegExpExecArray) => T, yaz: (t: T) => string, ad: string): T[] {
  const b = blok.exec(metin);
  if (!b) throw new CapaHatasi("BICIM", `${ad} bloğu bulunamadı`);
  const govde = b[1];
  const liste: T[] = [];
  girdi.lastIndex = 0;
  for (let m = girdi.exec(govde); m; m = girdi.exec(govde)) liste.push(uret(m));
  if (liste.map(yaz).join("") !== govde) throw new CapaHatasi("BICIM", `${ad} bloğu beklenen biçimde değil (elle düzenlenmiş?) — betik güncellenmeden ekleme yapılmaz`);
  return liste;
}

// ── TS PAKET çapası ──────────────────────────────────────────────────────────
const PAKET_BLOK = /^export const PACKAGE_PUBLIC_KEYS: readonly PackageKey\[\] = Object\.freeze\(\[\n([\s\S]*?)^\]\);$/m;
const PAKET_GIRDI = /^ {2}Object\.freeze\(\{ kid: "([^"\n]+)", x: "([^"\n]+)" \}\),\n/gm;
const paketTsGirdisi = (k: PackageKey): string => `  Object.freeze({ kid: ${JSON.stringify(k.kid)}, x: ${JSON.stringify(k.x)} }),\n`;

// ── native gömülü çapa (anchor.rs) ───────────────────────────────────────────
const RS_KOK_BAS = "pub const BUILTIN_ROOTS: &[(&str, &str, &[&str])] =";
const RS_PAKET_BAS = "pub const BUILTIN_PACKAGE_KEYS: &[(&str, &str)] =";
const RS_KOK_BLOK = /^pub const BUILTIN_ROOTS: &\[\(&str, &str, &\[&str\]\)\] =[\s\S]*?\];$/m;
const RS_PAKET_BLOK = /^pub const BUILTIN_PACKAGE_KEYS: &\[\(&str, &str\)\] =[\s\S]*?\];$/m;
/** Kâhin §0e ile aynı desen (`test_lisans_native_kahin`). */
const RS_KOK_OGE = /\("([^"]+)", "([^"]+)", &\[([^\]]*)\]\)/g;
const RS_PAKET_OGE = /\("([^"]+)", "([^"]+)"\)/g;
/** `native/rustfmt.toml` (çalışma alanı) `max_width`. */
export const RUSTFMT_GENISLIK = 140;

const rsKokOgesi = (r: RootKey): string => `(${JSON.stringify(r.kid)}, ${JSON.stringify(r.x)}, &[${r.classes.map((c) => JSON.stringify(c)).join(", ")}])`;
const rsPaketOgesi = (k: PackageKey): string => `(${JSON.stringify(k.kid)}, ${JSON.stringify(k.x)})`;

/**
 * rustfmt'in (`use_small_heuristics = "Max"`) bu sabit biçimi için seçtiği düzen: sığarsa tek satır,
 * sığmazsa `=` sonrası tek satır, o da sığmazsa her öğe kendi satırında (sondaki virgülle).
 */
export function rsSabiti(bas: string, ogeler: readonly string[]): string {
  const govde = `&[${ogeler.join(", ")}];`;
  if (`${bas} ${govde}`.length <= RUSTFMT_GENISLIK) return `${bas} ${govde}`;
  if (`    ${govde}`.length <= RUSTFMT_GENISLIK) return `${bas}\n    ${govde}`;
  const satirlar = ogeler.map((o) => `    ${o},`);
  const uzun = satirlar.find((s) => s.length > RUSTFMT_GENISLIK);
  if (uzun) throw new CapaHatasi("BICIM", `anchor.rs öğesi ${RUSTFMT_GENISLIK} karakteri aşıyor — rustfmt düzeni bu betiğin dışında: ${uzun.trim().slice(0, 40)}…`);
  return `${bas} &[\n${satirlar.join("\n")}\n];`;
}

function rsBlok<T>(metin: string, blok: RegExp, oge: RegExp, bas: string, uret: (m: RegExpExecArray) => T, yaz: (t: T) => string, ad: string): T[] {
  const b = blok.exec(metin);
  if (!b) throw new CapaHatasi("BICIM", `anchor.rs ${ad} bulunamadı`);
  const liste: T[] = [];
  oge.lastIndex = 0;
  for (let m = oge.exec(b[0]); m; m = oge.exec(b[0])) liste.push(uret(m));
  if (liste.length === 0 || rsSabiti(bas, liste.map(yaz)) !== b[0]) {
    throw new CapaHatasi("BICIM", `anchor.rs ${ad} beklenen (rustfmt) biçimde değil — betik güncellenmeden ekleme yapılmaz`);
  }
  return liste;
}

// ── durum ────────────────────────────────────────────────────────────────────
const oku = (kok: string, yol: string): string => readFileSync(path.join(kok, yol), "utf8");

function ayniListe(a: readonly (RootKey | PackageKey)[], b: readonly (RootKey | PackageKey)[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Depo kökündeki dört yeri ayrıştırır ve birbirine karşı DENETLER: aynalar kaynakla bayt-eşit, native
 * çapa TS çapasıyla aynı sırada aynı. Tutarsız başlangıçta ekleme yapılmaz (önce bekçiler).
 */
export function capaDurumuOku(kok: string): CapaDurumu {
  const kokTs = oku(kok, CAPA_DOSYALARI.kokTs);
  for (const ayna of CAPA_DOSYALARI.kokAynalari) {
    if (oku(kok, ayna) !== kokTs) throw new CapaHatasi("BICIM", `${ayna} kaynakla bayt-eşit değil — önce test_lisans_protokol_aynasi`);
  }
  const paketTs = oku(kok, CAPA_DOSYALARI.paketTs);
  const anchorRs = oku(kok, CAPA_DOSYALARI.anchorRs);
  const kokler = bloktanGirdiler<RootKey>(
    kokTs,
    KOK_BLOK,
    KOK_GIRDI,
    (m) => ({ kid: m[1], x: m[2], classes: siniflariAyristir(m[3], `ROOT_PUBLIC_KEYS ${m[1]}`) }),
    kokTsGirdisi,
    "ROOT_PUBLIC_KEYS",
  );
  const paketler = bloktanGirdiler<PackageKey>(paketTs, PAKET_BLOK, PAKET_GIRDI, (m) => ({ kid: m[1], x: m[2] }), paketTsGirdisi, "PACKAGE_PUBLIC_KEYS");
  const rsKokler = rsBlok<RootKey>(
    anchorRs,
    RS_KOK_BLOK,
    RS_KOK_OGE,
    RS_KOK_BAS,
    (m) => ({ kid: m[1], x: m[2], classes: [...m[3].matchAll(/"([^"]+)"/g)].map((c) => c[1] as LicenseClass) }),
    rsKokOgesi,
    "BUILTIN_ROOTS",
  );
  const rsPaketler = rsBlok<PackageKey>(anchorRs, RS_PAKET_BLOK, RS_PAKET_OGE, RS_PAKET_BAS, (m) => ({ kid: m[1], x: m[2] }), rsPaketOgesi, "BUILTIN_PACKAGE_KEYS");
  if (!ayniListe(rsKokler, kokler)) throw new CapaHatasi("BICIM", "anchor.rs BUILTIN_ROOTS ≠ ROOT_PUBLIC_KEYS — önce test_lisans_native_kahin §0e");
  if (!ayniListe(rsPaketler, paketler)) throw new CapaHatasi("BICIM", "anchor.rs BUILTIN_PACKAGE_KEYS ≠ PACKAGE_PUBLIC_KEYS — önce test_lisans_native_kahin §0e'");
  return { kokler, paketler, metin: { kokTs, paketTs, anchorRs } };
}

// ── doğrulama ────────────────────────────────────────────────────────────────
/** Açık anahtar gerçek bir Ed25519 açık anahtarı mı (kanonik base64url, 32 bayt, geri dönüşte aynı). */
export function acikAnahtarGecerli(x: string): boolean {
  const k = publicKeyFromX(x);
  if (!k) return false;
  try {
    return publicKeyX(k) === x;
  } catch {
    return false;
  }
}

export function kokDogrula(r: RootKey): void {
  if (!KOK_KID_BICIMI.test(r.kid)) throw new CapaHatasi("GECERSIZ", `kök kid'i biçimsiz: ${r.kid} (kok-<yıl>-<n> ya da hazirlik-<yıl>-<n>)`);
  if (!acikAnahtarGecerli(r.x)) throw new CapaHatasi("GECERSIZ", `${r.kid}: açık anahtar geçerli bir Ed25519 açık anahtarı değil`);
  const siniflar = r.classes as readonly string[];
  if (siniflar.length === 0 || new Set(siniflar).size !== siniflar.length || siniflar.some((c) => !(LICENSE_CLASSES as readonly string[]).includes(c))) {
    throw new CapaHatasi("GECERSIZ", `${r.kid}: sınıf listesi boş, tekrarlı ya da tanınmayan (${siniflar.join(",")})`);
  }
  if (r.kid.startsWith("hazirlik-") && r.classes.some((c) => !STAGING_ROOT_CLASSES.includes(c))) {
    throw new CapaHatasi("GECERSIZ", `${r.kid}: hazırlık kökü yalnız ${STAGING_ROOT_CLASSES.join("/")} imzalar`);
  }
}

export function paketDogrula(k: PackageKey): void {
  if (!paketKidGecerli(k.kid)) throw new CapaHatasi("GECERSIZ", `PAKET kid'i biçimsiz: ${k.kid} (paket-<yıl>[-<n>] ya da paket-hazirlik…)`);
  if (!acikAnahtarGecerli(k.x)) throw new CapaHatasi("GECERSIZ", `${k.kid}: açık anahtar geçerli bir Ed25519 açık anahtarı değil`);
}

// ── ekleme planı ─────────────────────────────────────────────────────────────
export interface EklemePlani {
  /** false: aynı kid + aynı anahtar zaten çapada (idempotent — yazılacak bir şey yok). */
  readonly degisir: boolean;
  /** Depo köküne göre yol → yeni içerik (yalnız değişenler). */
  readonly dosyalar: ReadonlyMap<string, string>;
}

function ayniAnahtarVar<T extends { kid: string; x: string }>(liste: readonly T[], yeni: T, esit: (a: T, b: T) => boolean): boolean {
  const kid = liste.find((k) => k.kid === yeni.kid);
  if (kid) {
    if (esit(kid, yeni)) return true;
    throw new CapaHatasi("CAKISMA", `${yeni.kid} çapada BAŞKA anahtar/sınıfla var — rotasyon yeni kid ile yapılır, satır değiştirilmez`);
  }
  const x = liste.find((k) => k.x === yeni.x);
  if (x) throw new CapaHatasi("CAKISMA", `bu açık anahtar çapada ${x.kid} adıyla zaten var — bir anahtar tek kid taşır`);
  return false;
}

/** Kök ekleme: TS kaynağı + iki ayna (aynı bayt) + anchor.rs BUILTIN_ROOTS. Yeni satır SONA. */
export function kokEklePlani(d: CapaDurumu, yeni: RootKey): EklemePlani {
  kokDogrula(yeni);
  if (ayniAnahtarVar(d.kokler, yeni, (a, b) => a.x === b.x && JSON.stringify(a.classes) === JSON.stringify(b.classes))) return { degisir: false, dosyalar: new Map() };
  const liste = [...d.kokler, { kid: yeni.kid, x: yeni.x, classes: [...yeni.classes] }];
  const hazir = prepareTrustAnchor(liste);
  if (!hazir.ok) throw new CapaHatasi("GECERSIZ", `yeni çapa geçersiz (${hazir.code}): ${hazir.message}`);
  const kokTs = d.metin.kokTs.replace(KOK_BLOK, () => `export const ROOT_PUBLIC_KEYS: readonly RootKey[] = Object.freeze([\n${liste.map(kokTsGirdisi).join("")}]);`);
  const anchorRs = d.metin.anchorRs.replace(RS_KOK_BLOK, () => rsSabiti(RS_KOK_BAS, liste.map(rsKokOgesi)));
  const dosyalar = new Map<string, string>([[CAPA_DOSYALARI.kokTs, kokTs], ...CAPA_DOSYALARI.kokAynalari.map((a): [string, string] => [a, kokTs]), [CAPA_DOSYALARI.anchorRs, anchorRs]]);
  return { degisir: true, dosyalar };
}

/** PAKET anahtarı ekleme: integrity.ts `PACKAGE_PUBLIC_KEYS` + anchor.rs BUILTIN_PACKAGE_KEYS. Yeni satır SONA. */
export function paketEklePlani(d: CapaDurumu, yeni: PackageKey): EklemePlani {
  paketDogrula(yeni);
  if (ayniAnahtarVar(d.paketler, yeni, (a, b) => a.x === b.x)) return { degisir: false, dosyalar: new Map() };
  const liste = [...d.paketler, { kid: yeni.kid, x: yeni.x }];
  const paketTs = d.metin.paketTs.replace(PAKET_BLOK, () => `export const PACKAGE_PUBLIC_KEYS: readonly PackageKey[] = Object.freeze([\n${liste.map(paketTsGirdisi).join("")}]);`);
  const anchorRs = d.metin.anchorRs.replace(RS_PAKET_BLOK, () => rsSabiti(RS_PAKET_BAS, liste.map(rsPaketOgesi)));
  return { degisir: true, dosyalar: new Map([[CAPA_DOSYALARI.paketTs, paketTs], [CAPA_DOSYALARI.anchorRs, anchorRs]]) };
}
