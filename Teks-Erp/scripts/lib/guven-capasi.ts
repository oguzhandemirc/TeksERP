// Güven çapası dosyalarının AYRIŞTIRICISI + ÜRETİCİSİ — `scripts/guven-capasi-ekle.ts` (CLI) ve bekçisi
// (`test_guven_capasi_ekle.ts`) ortak kullanır. Çapa TEK kiptir (üretim): kök + PAKET listesi dört yerden TEK
// listeyle yazılır — TS kök çapası (+ satıcı ve patron bayt-eşit aynası), TS PAKET çapası, native gömülü çapa
// (`anchor.rs`, rustfmt düzeniyle). Kid biçimi `kok-*` / `paket-<yıl>`; başka biçim çapaya giremez. Biçim beklenenden
// saparsa (elle düzenleme) ayrıştırıcı DURUR: metne tahminle ekleme yapılmaz.
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  LICENSE_CLASSES,
  TRUST_ANCHOR_MODES,
  prepareTrustAnchor,
  publicKeyFromX,
  publicKeyX,
  type LicenseClass,
  type RootKey,
  type TrustAnchorMode,
} from "../../src/lib/license/protocol";
import { isProductionPackageKid } from "../../src/lib/license/integrity-scope";
import type { PackageKey } from "../../src/lib/license/integrity";
import { PRODUCTION_SIGNER_KID } from "../../../Electron/electron/guncelleme/kunye-jws.mjs";

/** Depo köküne göre yollar. Aynalar kaynağın BAYT-EŞİT kopyasıdır (`test_lisans_protokol_aynasi`). */
export const CAPA_DOSYALARI = Object.freeze({
  kokTs: "Teks-Erp/src/lib/license/protocol/kok-anahtarlar.ts",
  kokAynalari: Object.freeze(["satici/sunucu/src/lisans-protokol/kok-anahtarlar.ts", "patron/sunucu/src/lisans-protokol/kok-anahtarlar.ts"]),
  paketTs: "Teks-Erp/src/lib/license/integrity.ts",
  anchorRs: "Teks-Erp/native/tekserp-dogrulama/src/anchor.rs",
});

/** Kipin dört yerdeki blok adları. */
export const CAPA_BLOKLARI: Readonly<Record<TrustAnchorMode, { readonly kokTs: string; readonly paketTs: string; readonly kokRs: string; readonly paketRs: string }>> =
  Object.freeze({
    uretim: { kokTs: "PRODUCTION_ROOT_PUBLIC_KEYS", paketTs: "PRODUCTION_PACKAGE_PUBLIC_KEYS", kokRs: "PRODUCTION_ROOTS", paketRs: "PRODUCTION_PACKAGE_KEYS" },
  });

/** Kök kid'i `kok-<yıl>-<n>` (satıcı `anahtar.ts kok-uret` ile aynı biçim). */
export const KOK_KID_BICIMI = /^kok-\d{4}-\d{1,3}$/;
const PAKET_KID_ZEMIN = /^paket-[a-z0-9-]{1,40}$/;

/**
 * Çapaya girebilecek PAKET kid'i mi: üretim (`paket-<yıl>[-<n>]`, kural `integrity-scope.ts`te); fikstür kid'leri
 * (`paket-fikstur`) bu kuralın DIŞINDADIR.
 */
export function paketKidGecerli(kid: string): boolean {
  return PAKET_KID_ZEMIN.test(kid) && isProductionPackageKid(kid);
}

/** Kök kid'inin kipi (biçim dışıysa null). */
export function kokKipi(kid: string): TrustAnchorMode | null {
  return KOK_KID_BICIMI.test(kid) ? "uretim" : null;
}

/** PAKET kid'inin kipi (biçim dışıysa null). */
export function paketKipi(kid: string): TrustAnchorMode | null {
  return paketKidGecerli(kid) ? "uretim" : null;
}

export class CapaHatasi extends Error {
  constructor(
    readonly tur: "BICIM" | "GECERSIZ" | "CAKISMA",
    message: string,
  ) {
    super(message);
  }
}

type KipListesi<T> = Readonly<Record<TrustAnchorMode, readonly T[]>>;

export interface CapaDurumu {
  readonly kokler: KipListesi<RootKey>;
  readonly paketler: KipListesi<PackageKey>;
  /** Ham metinler (yeniden yazım bu metinlerin içinde yalnız blokları değiştirir). */
  readonly metin: { readonly kokTs: string; readonly paketTs: string; readonly anchorRs: string };
}

// ── TS kök çapası ────────────────────────────────────────────────────────────
const tsBlok = (ad: string, tip: string): RegExp => new RegExp(`^export const ${ad}: readonly ${tip}\\[\\] = Object\\.freeze\\(\\[\\n([\\s\\S]*?)^\\]\\);$`, "m");
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
const PAKET_GIRDI = /^ {2}Object\.freeze\(\{ kid: "([^"\n]+)", x: "([^"\n]+)" \}\),\n/gm;
const paketTsGirdisi = (k: PackageKey): string => `  Object.freeze({ kid: ${JSON.stringify(k.kid)}, x: ${JSON.stringify(k.x)} }),\n`;

// ── native gömülü çapa (anchor.rs) ───────────────────────────────────────────
const rsKokBas = (ad: string): string => `pub const ${ad}: &[(&str, &str, &[&str])] =`;
const rsPaketBas = (ad: string): string => `pub const ${ad}: &[(&str, &str)] =`;
const rsKokBlok = (ad: string): RegExp => new RegExp(`^pub const ${ad}: &\\[\\(&str, &str, &\\[&str\\]\\)\\] =[\\s\\S]*?\\];$`, "m");
const rsPaketBlok = (ad: string): RegExp => new RegExp(`^pub const ${ad}: &\\[\\(&str, &str\\)\\] =[\\s\\S]*?\\];$`, "m");
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
 * Depo kökündeki dört yeri ayrıştırır ve birbirine karşı DENETLER: aynalar kaynakla bayt-eşit, native çapa TS
 * listesiyle aynı sırada aynı, liste yalnız üretim biçiminde kid taşır. Tutarsız başlangıçta ekleme
 * yapılmaz (önce bekçiler).
 */
export function capaDurumuOku(kok: string): CapaDurumu {
  const kokTs = oku(kok, CAPA_DOSYALARI.kokTs);
  for (const ayna of CAPA_DOSYALARI.kokAynalari) {
    if (oku(kok, ayna) !== kokTs) throw new CapaHatasi("BICIM", `${ayna} kaynakla bayt-eşit değil — önce test_lisans_protokol_aynasi`);
  }
  const paketTs = oku(kok, CAPA_DOSYALARI.paketTs);
  const anchorRs = oku(kok, CAPA_DOSYALARI.anchorRs);
  const kokler = {} as Record<TrustAnchorMode, RootKey[]>;
  const paketler = {} as Record<TrustAnchorMode, PackageKey[]>;
  for (const kip of TRUST_ANCHOR_MODES) {
    const ad = CAPA_BLOKLARI[kip];
    kokler[kip] = bloktanGirdiler<RootKey>(
      kokTs,
      tsBlok(ad.kokTs, "RootKey"),
      KOK_GIRDI,
      (m) => ({ kid: m[1], x: m[2], classes: siniflariAyristir(m[3], `${ad.kokTs} ${m[1]}`) }),
      kokTsGirdisi,
      ad.kokTs,
    );
    paketler[kip] = bloktanGirdiler<PackageKey>(paketTs, tsBlok(ad.paketTs, "PackageKey"), PAKET_GIRDI, (m) => ({ kid: m[1], x: m[2] }), paketTsGirdisi, ad.paketTs);
    const rsKokler = rsBlok<RootKey>(
      anchorRs,
      rsKokBlok(ad.kokRs),
      RS_KOK_OGE,
      rsKokBas(ad.kokRs),
      (m) => ({ kid: m[1], x: m[2], classes: [...m[3].matchAll(/"([^"]+)"/g)].map((c) => c[1] as LicenseClass) }),
      rsKokOgesi,
      ad.kokRs,
    );
    const rsPaketler = rsBlok<PackageKey>(anchorRs, rsPaketBlok(ad.paketRs), RS_PAKET_OGE, rsPaketBas(ad.paketRs), (m) => ({ kid: m[1], x: m[2] }), rsPaketOgesi, ad.paketRs);
    if (!ayniListe(rsKokler, kokler[kip])) throw new CapaHatasi("BICIM", `anchor.rs ${ad.kokRs} ≠ ${ad.kokTs} — önce test_lisans_native_kahin §0e`);
    if (!ayniListe(rsPaketler, paketler[kip])) throw new CapaHatasi("BICIM", `anchor.rs ${ad.paketRs} ≠ ${ad.paketTs} — önce test_lisans_native_kahin §0e'`);
    const yabanci = [...kokler[kip].filter((r) => kokKipi(r.kid) !== kip), ...paketler[kip].filter((k) => paketKipi(k.kid) !== kip)].map((k) => k.kid);
    if (yabanci.length) throw new CapaHatasi("BICIM", `${kip} listesinde biçim dışı kid: ${yabanci.join(", ")} (elle düzenlenmiş?)`);
  }
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
  if (!KOK_KID_BICIMI.test(r.kid)) throw new CapaHatasi("GECERSIZ", `kök kid'i biçimsiz: ${r.kid} (kok-<yıl>-<n>)`);
  if (!acikAnahtarGecerli(r.x)) throw new CapaHatasi("GECERSIZ", `${r.kid}: açık anahtar geçerli bir Ed25519 açık anahtarı değil`);
  const siniflar = r.classes as readonly string[];
  if (siniflar.length === 0 || new Set(siniflar).size !== siniflar.length || siniflar.some((c) => !(LICENSE_CLASSES as readonly string[]).includes(c))) {
    throw new CapaHatasi("GECERSIZ", `${r.kid}: sınıf listesi boş, tekrarlı ya da tanınmayan (${siniflar.join(",")})`);
  }
}

export function paketDogrula(k: PackageKey): void {
  if (!paketKidGecerli(k.kid)) throw new CapaHatasi("GECERSIZ", `PAKET kid'i biçimsiz: ${k.kid} (paket-<yıl>[-<n>])`);
  if (!acikAnahtarGecerli(k.x)) throw new CapaHatasi("GECERSIZ", `${k.kid}: açık anahtar geçerli bir Ed25519 açık anahtarı değil`);
}

// ── ekleme planı ─────────────────────────────────────────────────────────────
export interface EklemePlani {
  /** false: aynı kid + aynı anahtar zaten çapada (idempotent — yazılacak bir şey yok). */
  readonly degisir: boolean;
  /** Girdinin yazıldığı (ya da zaten bulunduğu) kip listesi. */
  readonly kip: TrustAnchorMode;
  /** Depo köküne göre yol → yeni içerik (yalnız değişenler). */
  readonly dosyalar: ReadonlyMap<string, string>;
}

/** Bütün kip listelerinin BİRLEŞİMİNDE arar: bir anahtar tek kid taşır. */
function ayniAnahtarVar<T extends { kid: string; x: string }>(listeler: KipListesi<T>, yeni: T, esit: (a: T, b: T) => boolean): boolean {
  return listedeAyniAnahtarVar(TRUST_ANCHOR_MODES.flatMap((k) => listeler[k]), yeni, esit);
}

/** Tek listede arar (istemci çapası kipsizdir): aynı kid + aynı anahtar → true; çakışma → RED. */
function listedeAyniAnahtarVar<T extends { kid: string; x: string }>(tum: readonly T[], yeni: T, esit: (a: T, b: T) => boolean): boolean {
  const kid = tum.find((k) => k.kid === yeni.kid);
  if (kid) {
    if (esit(kid, yeni)) return true;
    throw new CapaHatasi("CAKISMA", `${yeni.kid} çapada BAŞKA anahtar/sınıfla var — rotasyon yeni kid ile yapılır, satır değiştirilmez`);
  }
  const x = tum.find((k) => k.x === yeni.x);
  if (x) throw new CapaHatasi("CAKISMA", `bu açık anahtar çapada ${x.kid} adıyla zaten var — bir anahtar tek kid taşır`);
  return false;
}

/** Kök ekleme: kid'in kipinin listesi — TS kaynağı + iki ayna (aynı bayt) + anchor.rs. Yeni satır SONA. */
export function kokEklePlani(d: CapaDurumu, yeni: RootKey): EklemePlani {
  kokDogrula(yeni);
  const kip = kokKipi(yeni.kid);
  if (!kip) throw new CapaHatasi("GECERSIZ", `kök kid'inin kipi çıkarılamadı: ${yeni.kid}`);
  if (ayniAnahtarVar(d.kokler, yeni, (a, b) => a.x === b.x && JSON.stringify(a.classes) === JSON.stringify(b.classes))) return { degisir: false, kip, dosyalar: new Map() };
  const liste = [...d.kokler[kip], { kid: yeni.kid, x: yeni.x, classes: [...yeni.classes] }];
  const hazir = prepareTrustAnchor(liste);
  if (!hazir.ok) throw new CapaHatasi("GECERSIZ", `yeni ${kip} çapası geçersiz (${hazir.code}): ${hazir.message}`);
  const ad = CAPA_BLOKLARI[kip];
  const kokTs = d.metin.kokTs.replace(tsBlok(ad.kokTs, "RootKey"), () => `export const ${ad.kokTs}: readonly RootKey[] = Object.freeze([\n${liste.map(kokTsGirdisi).join("")}]);`);
  const anchorRs = d.metin.anchorRs.replace(rsKokBlok(ad.kokRs), () => rsSabiti(rsKokBas(ad.kokRs), liste.map(rsKokOgesi)));
  const dosyalar = new Map<string, string>([[CAPA_DOSYALARI.kokTs, kokTs], ...CAPA_DOSYALARI.kokAynalari.map((a): [string, string] => [a, kokTs]), [CAPA_DOSYALARI.anchorRs, anchorRs]]);
  return { degisir: true, kip, dosyalar };
}

/** PAKET anahtarı ekleme: kid'in kipinin listesi — integrity.ts + anchor.rs. Yeni satır SONA. */
export function paketEklePlani(d: CapaDurumu, yeni: PackageKey): EklemePlani {
  paketDogrula(yeni);
  const kip = paketKipi(yeni.kid);
  if (!kip) throw new CapaHatasi("GECERSIZ", `PAKET kid'inin kipi çıkarılamadı: ${yeni.kid}`);
  if (ayniAnahtarVar(d.paketler, yeni, (a, b) => a.x === b.x)) return { degisir: false, kip, dosyalar: new Map() };
  const liste = [...d.paketler[kip], { kid: yeni.kid, x: yeni.x }];
  const ad = CAPA_BLOKLARI[kip];
  const paketTs = d.metin.paketTs.replace(tsBlok(ad.paketTs, "PackageKey"), () => `export const ${ad.paketTs}: readonly PackageKey[] = Object.freeze([\n${liste.map(paketTsGirdisi).join("")}]);`);
  const anchorRs = d.metin.anchorRs.replace(rsPaketBlok(ad.paketRs), () => rsSabiti(rsPaketBas(ad.paketRs), liste.map(rsPaketOgesi)));
  return { degisir: true, kip, dosyalar: new Map([[CAPA_DOSYALARI.paketTs, paketTs], [CAPA_DOSYALARI.anchorRs, anchorRs]]) };
}

// ── İstemci çapaları (beşinci ve altıncı yer, ayrı komutlar) ─────────────────
/**
 * Panelin gömülü KÖK çapası — derlemede ana sürece girer (`guncelleme-dogrulama.ts`). Künye v:2'yi `ist-*` anahtarı
 * imzalar ve kök imzalı ISTEMCI sertifikasını taşır; çapada yalnız kök açık yarıları durur (ISTEMCI-ANAHTARI-KOK-ALTINDA §3).
 */
export const PANEL_CAPA_DOSYASI = "Electron/electron/guncelleme/imza-capasi.json";
/** Tabletin APK künyesi imza çapası — JS paketine girer (`appUpdate.service.ts`; OTA kod imzasıyla korunur). */
export const TABLET_CAPA_DOSYASI = "mobil/src/lib/apk-imza-capasi.json";
export type IstemciCapaDosyasi = typeof TABLET_CAPA_DOSYASI;

export interface TabletCapaDurumu {
  readonly liste: readonly PackageKey[];
  readonly json: Record<string, unknown>;
  readonly dosya: IstemciCapaDosyasi;
}

const tabletCapaMetni = (json: Record<string, unknown>, liste: readonly PackageKey[]): string =>
  `${JSON.stringify({ ...json, anahtarlar: liste.map((k) => ({ kid: k.kid, x: k.x })) }, null, 2)}\n`;

function jsonNesnesi(kok: string, dosya: string): { metin: string; o: Record<string, unknown> } {
  const metin = oku(kok, dosya);
  let json: unknown;
  try {
    json = JSON.parse(metin);
  } catch {
    throw new CapaHatasi("BICIM", `${dosya} JSON değil`);
  }
  return { metin, o: (typeof json === "object" && json !== null && !Array.isArray(json) ? json : {}) as Record<string, unknown> };
}

/** Tablet çapası, kesin biçim: `{_aciklama, anahtarlar: [{kid, x}]}`, `JSON.stringify(…, 2)` düzeni — elle bozulmuşsa DURUR. */
export function tabletCapasiOku(kok: string): TabletCapaDurumu {
  const dosya = TABLET_CAPA_DOSYASI;
  const { metin, o } = jsonNesnesi(kok, dosya);
  const ham = o.anahtarlar;
  const gecerli = Array.isArray(ham) && ham.every((k) => {
    const r = k as Record<string, unknown>;
    return typeof k === "object" && k !== null && Object.keys(r).join(",") === "kid,x" && typeof r.kid === "string" && typeof r.x === "string";
  });
  if (!gecerli) throw new CapaHatasi("BICIM", `${dosya}: anahtarlar [{kid, x}] dizisi değil`);
  const liste = (ham as PackageKey[]).map((k) => ({ kid: k.kid, x: k.x }));
  if (tabletCapaMetni(o, liste) !== metin) throw new CapaHatasi("BICIM", `${dosya} beklenen biçimde değil (elle düzenlenmiş?) — betik güncellenmeden ekleme yapılmaz`);
  return { liste, json: o, dosya };
}

/**
 * Tablet çapasına anahtar: (a) törenle PAKET çapasına girmiş üretim PAKET anahtarı (`paket-<yıl>`, AYNI açık yarı
 * — yeni PAKET anahtarı buradan çapaya giremez) ya da (b) ayrı istemci yayın anahtarı (`panel-<yıl>[-<n>]`).
 * Fikstür ya da biçim dışı kid RED; aynı kid + aynı anahtar → değişiklik yok; çakışma → RED. Yeni satır SONA.
 */
export function tabletEklePlani(d: CapaDurumu, p: TabletCapaDurumu, yeni: PackageKey): EklemePlani {
  if (!PRODUCTION_SIGNER_KID.test(yeni.kid)) {
    throw new CapaHatasi("GECERSIZ", `istemci imza çapası kid'i paket-<yıl>[-<n>] (PAKET anahtarı) ya da panel-<yıl>[-<n>] olmalı: ${yeni.kid}`);
  }
  if (!acikAnahtarGecerli(yeni.x)) throw new CapaHatasi("GECERSIZ", `${yeni.kid}: açık anahtar geçerli bir Ed25519 açık anahtarı değil`);
  if (yeni.kid.startsWith("paket-")) {
    const pk = d.paketler.uretim.find((k) => k.kid === yeni.kid);
    if (!pk || pk.x !== yeni.x || !isProductionPackageKid(pk.kid)) {
      throw new CapaHatasi("GECERSIZ", `${yeni.kid} bu açık anahtarla üretim PAKET çapasında yok — (a) seçeneği yalnız törenle çapaya girmiş üretim PAKET anahtarını kullanır`);
    }
  }
  // İstemci çapası tek listedir ve yalnız üretim biçiminde kid taşır (yukarıda) ⇒ planın kipi `uretim`.
  if (listedeAyniAnahtarVar(p.liste, yeni, (a, b) => a.x === b.x)) return { degisir: false, kip: "uretim", dosyalar: new Map() };
  return { degisir: true, kip: "uretim", dosyalar: new Map([[p.dosya, tabletCapaMetni(p.json, [...p.liste, { kid: yeni.kid, x: yeni.x }])]]) };
}

export interface IstemciKokCapaDurumu {
  readonly liste: readonly RootKey[];
  readonly json: Record<string, unknown>;
}

const kokCapaMetni = (json: Record<string, unknown>, liste: readonly RootKey[]): string =>
  `${JSON.stringify({ ...json, kokler: liste.map((r) => ({ kid: r.kid, x: r.x, classes: [...r.classes] })) }, null, 2)}\n`;

/** Panel kök çapası, kesin biçim: `{_aciklama, kokler: [{kid, x, classes}]}`, `JSON.stringify(…, 2)` düzeni. */
export function istemciKokCapasiOku(kok: string): IstemciKokCapaDurumu {
  const { metin, o } = jsonNesnesi(kok, PANEL_CAPA_DOSYASI);
  const ham = o.kokler;
  const gecerli = Array.isArray(ham) && ham.every((k) => {
    const r = k as Record<string, unknown>;
    return (
      typeof k === "object" &&
      k !== null &&
      Object.keys(r).join(",") === "kid,x,classes" &&
      typeof r.kid === "string" &&
      typeof r.x === "string" &&
      Array.isArray(r.classes) &&
      r.classes.every((c) => typeof c === "string")
    );
  });
  if (!gecerli) throw new CapaHatasi("BICIM", `${PANEL_CAPA_DOSYASI}: kokler [{kid, x, classes}] dizisi değil`);
  const liste = (ham as RootKey[]).map((r) => ({ kid: r.kid, x: r.x, classes: [...r.classes] }));
  if (kokCapaMetni(o, liste) !== metin) {
    throw new CapaHatasi("BICIM", `${PANEL_CAPA_DOSYASI} beklenen biçimde değil (elle düzenlenmiş?) — betik güncellenmeden ekleme yapılmaz`);
  }
  return { liste, json: o };
}

const ayniKok = (a: RootKey, b: RootKey): boolean => a.x === b.x && JSON.stringify(a.classes) === JSON.stringify(b.classes);

/**
 * Panel kök çapasına kök: YALNIZ TS üretim kök listesindeki (`PRODUCTION_ROOT_PUBLIC_KEYS`, törenle girmiş) satır,
 * kid + x + sınıflar AYNEN kopyalanır — panel kendi başına kök kabul etmez. Listede yok / biçim dışı → RED;
 * çapadaki satır TS listesindekinden farklıysa (kopya bayatlamış) → RED; aynı satır → değişiklik yok. Yeni satır SONA.
 */
export function istemciKokEklePlani(d: CapaDurumu, p: IstemciKokCapaDurumu, kokKid: string): EklemePlani {
  if (!KOK_KID_BICIMI.test(kokKid)) throw new CapaHatasi("GECERSIZ", `kök kid'i biçimsiz: ${kokKid} (kok-<yıl>-<n>)`);
  const uretim = d.kokler.uretim;
  const kaynak = uretim.find((r) => r.kid === kokKid);
  if (!kaynak) throw new CapaHatasi("GECERSIZ", `${kokKid} TS üretim kök listesinde (PRODUCTION_ROOT_PUBLIC_KEYS) yok — önce 'kok' komutuyla törenle eklenir`);
  kokDogrula(kaynak);
  for (const satir of p.liste) {
    const tsde = uretim.find((r) => r.kid === satir.kid);
    if (!tsde || !ayniKok(tsde, satir)) {
      throw new CapaHatasi("CAKISMA", `panel kök çapasındaki ${satir.kid} TS üretim kök listesindekiyle aynı değil — çapa elle değiştirilmiş ya da bayat`);
    }
  }
  const yeni = { kid: kaynak.kid, x: kaynak.x, classes: [...kaynak.classes] };
  if (listedeAyniAnahtarVar(p.liste, yeni, ayniKok)) return { degisir: false, kip: "uretim", dosyalar: new Map() };
  return { degisir: true, kip: "uretim", dosyalar: new Map([[PANEL_CAPA_DOSYASI, kokCapaMetni(p.json, [...p.liste, yeni])]]) };
}
