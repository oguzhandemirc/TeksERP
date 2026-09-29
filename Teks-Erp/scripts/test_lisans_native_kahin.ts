// =============================================================================
// BEKÇİ — LİSANS NATIVE ÇEKİRDEĞİ KÂHİNİ: TS protokolü (tek kaynak) ↔ Rust çekirdek (ayna)
// =============================================================================
// Çalıştırma: npx tsx scripts/test_lisans_native_kahin.ts          (DB'SİZ)
//             npx tsx scripts/test_lisans_native_kahin.ts --vektor-yaz   (vektör dosyasını TS'ten yeniden üretir)
// Native'i sına: önce `cd native/lisans-cekirdek && npm run derle` (ya da TEKSERP_LISANS_CEKIRDEK=<.node>).
//
// NE ÖLÇER: native çekirdek (`native/lisans-cekirdek`, Rust + napi-rs) TS protokolünün AYNASIDIR;
// ayrışırsa fabrika aynı belgeyi iki yolda farklı doğrular ve hata sessizdir.
//   §0 STATİK aynalar (native gerekmez): Rust kod kümeleri ⊆/= TS · yer tutucu listesi · Windows
//      sondası satır satır · gömülü çapa = ROOT_PUBLIC_KEYS / PACKAGE_PUBLIC_KEYS · arayüz sürümü ·
//      HKDF öneki · Rust'taki HER regex TS kaynağında (ya da canlı Zod deseninde) birebir var ·
//      derleme sabiti geliştirmede kapalı · Rust'taki her belge türü (TYP_*) protokolün TYP kayıt
//      defterinde aynı ad/değerle (bütünlük türü dahil)
//   §1 yükleyici: dosya yok → TS (zorunlu değil) / "yok" + her doğrulama CEKIRDEK_YOK + bütünlük
//      GEÇERSİZ, istisna yok (zorunlu) · desteklenmeyen platform · bozuk .node · zorunlu kip ortam
//      yolunu okumaz · aday sırası
//   §2 vektör dosyası (`native/lisans-cekirdek/test-vektorleri/protokol.json`, `cargo test` de okur):
//      her kaydın beklenen sonucu BUGÜNKÜ TS protokolüyle aynı (bayat vektör yok) · native'in
//      üretebildiği her kod en az bir beklenende geçiyor (kapsam) · her türde geçer + kalır
//   §3–§7 NATIVE (yoksa "⏭ ATLANDI — native yok", sayıyla): künye/ayna listeleri canlı · gömülü
//      çapa canlı · kayıtlı vektörler native'de beklenenle aynı · CANLI (taze anahtarlı) vektörlerde
//      TS = native · bu makinede parmak izi toplama TS = native · zorunlu kip test derlemesini
//      reddeder / üretim derlemesi çapa enjeksiyonunu reddeder
//   §8 ⭐ KALICI SONDA ✓K (her koşumda): karşılaştırıcı farkı ısırır, eşitte susar · bayatlık
//      denetimi mutasyona uğramış beklenenle kırmızı · kapsam denetimi eksik kodu yakalar ·
//      regex aynası değişmiş deseni yakalar · TYP aynası değişmiş/kayıtsız türü yakalar
//
// NEGATİF SONDA — dosya DIŞI mutasyonlar (commit mesajında sayılarla; her biri geri alındı, sha eşit):
//   bkz. Teks-Erp/docs/BEKCI-HARITASI.md `## lisans` satırı.
// =============================================================================
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { MODULE_KEY_KID_PREFIX, PROTOCOL_ERROR_CODES, ROOT_PUBLIC_KEYS, TYP, b64uDecode, b64uEncode } from "../src/lib/license/protocol";
import { CORE_ERROR_CODES, CORE_UNAVAILABLE_CODE, tsLicenseCore, type LicenseCore } from "../src/lib/license/license-core";
import {
  NATIVE_ABI,
  NATIVE_PATH_ENV,
  NATIVE_REQUIRED,
  identityRejection,
  loadLicenseCoreFrom,
  nativeCandidates,
  nativeFileName,
  type LoaderOptions,
} from "../src/lib/license/native";
import { INTEGRITY_TYP, PACKAGE_PUBLIC_KEYS } from "../src/lib/license/integrity";
import { MODULE_KEY_HKDF_PREFIX } from "../src/lib/license/module-key";
import { WINDOWS_PROBE_LINES } from "../src/lib/license/fingerprint-os";
import { atlamaDefteri } from "./lib/atlama";
import {
  VEKTOR_BICIMI,
  VEKTOR_SIMDI,
  degerlendir,
  jsonEsit,
  vektorDosyasiYolu,
  vektorDosyasiUret,
  vektorleriKur,
  type Vektor,
  type VektorDosyasi,
  type VektorKaydi,
} from "./lib/lisans-cekirdek-vektor";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
}
const ATLAMA = atlamaDefteri(() => {
  fail++;
});

const TEKS = path.resolve(__dirname, "..");
const NATIVE_DIZIN = path.join(TEKS, "native", "lisans-cekirdek");
const VEKTOR_DOSYASI = vektorDosyasiYolu(TEKS);
const oku = (p: string) => readFileSync(p, "utf8");
const rustKaynak = (ad: string) => oku(path.join(NATIVE_DIZIN, "src", ad));

// ── Rust kaynağından metin çıkarımı ─────────────────────────────────────────────
function rustDizge(ham: string): string {
  return ham.replace(/\\(["\\])/g, "$1");
}

/** `pub const AD: [&str; N] = [ "a", "b" ];` ya da `&[&str] = &[ … ]` içindeki dizgeler. */
export function rustDizgeListesi(kaynak: string, ad: string): string[] | null {
  const m = new RegExp(`pub const ${ad}: [^=]+= &?\\[([\\s\\S]*?)\\];`).exec(kaynak);
  if (!m) return null;
  return [...m[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((x) => rustDizge(x[1]));
}

/** `outcome.rs` kod kümesi (sabit ADLARI → değerleri). */
function rustKodKumesi(kaynak: string, ad: "PROTOCOL" | "CORE"): string[] | null {
  const degerler = new Map([...kaynak.matchAll(/pub const (\w+): &str = "(\w+)";/g)].map((m) => [m[1], m[2]]));
  const blok = new RegExp(`pub const ${ad}: &\\[&str\\] = &\\[([\\s\\S]*?)\\];`).exec(kaynak);
  if (!blok) return null;
  const adlar = [...blok[1].matchAll(/(\w+),/g)].map((m) => m[1]);
  return adlar.map((a) => degerler.get(a) ?? `?${a}`);
}

/** Rust'taki `Regex::new(r"…")` desenleri + `iso.rs` ZOD_DATETIME birleşimi. */
export function rustDesenleri(kaynaklar: readonly string[]): string[] {
  const out: string[] = [];
  for (const k of kaynaklar) {
    for (const m of k.matchAll(/Regex::new\(\s*r"((?:[^"])*)"/g)) out.push(m[1]);
    const zod = /const ZOD_DATETIME: &str = concat!\(([\s\S]*?)\);/.exec(k);
    if (zod) out.push([...zod[1].matchAll(/r"([^"]*)"/g)].map((x) => x[1]).join(""));
  }
  return out;
}

/** Rust'taki belge türü sabitleri: `pub const TYP_<AD>: &str = "…";` → [AD, değer]. */
export function rustTypSabitleri(kaynaklar: readonly string[]): [string, string][] {
  return kaynaklar.flatMap((k) => [...k.matchAll(/pub const TYP_(\w+): &str = "([^"]*)";/g)].map((m): [string, string] => [m[1], m[2]]));
}

/** Rust TYP_<AD> sabiti TS `TYP.<AD>` ile aynı adda ve aynı değerde değilse fark satırı. */
export function typFarklari(rust: readonly (readonly [string, string])[], ts: Readonly<Record<string, string>>): string[] {
  return rust.filter(([ad, deger]) => ts[ad] !== deger).map(([ad, deger]) => `TYP_${ad}="${deger}" (TS: ${ts[ad] ?? "yok"})`);
}

/** JS regex literallerinin kaynağı (`/…/` — satır içi, bayraksız ya da bayraklı). */
export function tsDesenleri(kaynak: string): string[] {
  return [...kaynak.matchAll(/\/(\^(?:[^/\n\\]|\\.)*\$)\/[a-z]*/g)].map((m) => m[1]);
}

/** Desen karşılaştırma biçimi: `\d` ≡ `[0-9]`, `\/` ≡ `/` (JS'te `\d` ASCII'dir; Rust'ta Unicode olduğu için [0-9] yazılır). */
export function desenNormal(d: string): string {
  return d.replace(/\\d/g, "[0-9]").replace(/\\\//g, "/");
}

// ── Karşılaştırıcılar (✓K sondaları bunları ölçer) ───────────────────────────────
interface Fark {
  readonly ad: string;
  readonly beklenen: unknown;
  readonly gelen: unknown;
}

async function kayitlariKarsilastir(core: LicenseCore, kayitlar: readonly VektorKaydi[]): Promise<Fark[]> {
  const farklar: Fark[] = [];
  for (const k of kayitlar) {
    const gelen = await degerlendir(core, k.vektor);
    if (!jsonEsit(gelen, k.beklenen)) farklar.push({ ad: `${k.vektor.tur} · ${k.vektor.ad}`, beklenen: k.beklenen, gelen });
  }
  return farklar;
}

function farkOzeti(farklar: readonly Fark[]): string {
  return farklar
    .slice(0, 5)
    .map((f) => `${f.ad}: beklenen ${JSON.stringify(f.beklenen).slice(0, 160)} · gelen ${JSON.stringify(f.gelen).slice(0, 160)}`)
    .join(" | ");
}

/** Beklenen sonuçlarda geçen kodlar (hata kodu + bütünlük raporu kodu). */
export function beklenenKodlar(kayitlar: readonly VektorKaydi[]): Set<string> {
  const out = new Set<string>();
  const R = z.object({ ok: z.literal(false), code: z.string() });
  const B = z.object({ ok: z.literal(true), value: z.object({ kod: z.string() }) });
  for (const k of kayitlar) {
    const r = R.safeParse(k.beklenen);
    if (r.success) out.add(r.data.code);
    const b = k.vektor.tur === "butunluk" ? B.safeParse(k.beklenen) : null;
    if (b?.success) out.add(b.data.value.kod);
  }
  return out;
}

const VektorDosyasiSchema = z.object({
  bicim: z.number(),
  not: z.string(),
  kayitlar: z.array(z.object({ vektor: z.custom<Vektor>((x) => typeof x === "object" && x !== null && "tur" in x), beklenen: z.unknown() })),
});

function vektorDosyasiOku(): VektorDosyasi | null {
  if (!existsSync(VEKTOR_DOSYASI)) return null;
  const p = VektorDosyasiSchema.safeParse(JSON.parse(oku(VEKTOR_DOSYASI)));
  return p.success ? p.data : null;
}

async function vektorYaz(): Promise<void> {
  const dosya = await vektorDosyasiUret(tsLicenseCore, VEKTOR_SIMDI);
  const satirlar = dosya.kayitlar.map((k) => JSON.stringify(k));
  const metin = `{"bicim":${dosya.bicim},"not":${JSON.stringify(dosya.not)},"kayitlar":[\n${satirlar.join(",\n")}\n]}\n`;
  writeFileSync(VEKTOR_DOSYASI, metin);
  console.log(`✍️  ${path.relative(TEKS, VEKTOR_DOSYASI)} yazıldı — ${dosya.kayitlar.length} kayıt, ${metin.length} bayt`);
}

// ── Bölümler ─────────────────────────────────────────────────────────────────
function bolum0(): void {
  console.log("\n§0 statik aynalar (native gerekmez)");
  const outcome = rustKaynak("outcome.rs");
  const rustProtokol = rustKodKumesi(outcome, "PROTOCOL");
  const tsProtokol = new Set<string>(PROTOCOL_ERROR_CODES);
  check("§0a Rust protokol kodları ⊆ TS PROTOCOL_ERROR_CODES", !!rustProtokol && rustProtokol.length >= 15 && rustProtokol.every((c) => tsProtokol.has(c)), `${rustProtokol?.filter((c) => !tsProtokol.has(c)).join(",") || `${rustProtokol?.length ?? 0} kod`}`);
  const rustCore = rustKodKumesi(outcome, "CORE");
  check("§0b Rust çekirdek kodları = TS CORE_ERROR_CODES", !!rustCore && jsonEsit(rustCore, [...CORE_ERROR_CODES]), `rust ${JSON.stringify(rustCore)}`);

  const tsYer = /const PLACEHOLDER_VALUES = new Set\(\[([\s\S]*?)\]\);/.exec(oku(path.join(TEKS, "src/lib/license/protocol/parmak-izi.ts")));
  const tsYerListe = tsYer ? [...tsYer[1].matchAll(/"([^"]*)"/g)].map((m) => m[1]) : [];
  const rustYer = rustDizgeListesi(rustKaynak("fingerprint.rs"), "PLACEHOLDER_VALUES");
  check("§0c yer tutucu listesi TS = Rust (sıra dahil)", tsYerListe.length >= 10 && jsonEsit(rustYer, tsYerListe), `${tsYerListe.length} değer`);

  const rustSonda = rustDizgeListesi(rustKaynak("collect.rs"), "WINDOWS_PROBE_LINES");
  check("§0d Windows parmak izi sondası satır satır aynı", WINDOWS_PROBE_LINES.length >= 5 && jsonEsit(rustSonda, [...WINDOWS_PROBE_LINES]), `${WINDOWS_PROBE_LINES.length} satır`);

  const anchor = rustKaynak("anchor.rs");
  const rustKokler = [...anchor.matchAll(/\("([^"]+)", "([^"]+)", &\[([^\]]*)\]\)/g)].map((m) => ({
    kid: m[1],
    x: m[2],
    classes: [...m[3].matchAll(/"([^"]+)"/g)].map((c) => c[1]),
  }));
  const tsKokler = ROOT_PUBLIC_KEYS.map((r) => ({ kid: r.kid, x: r.x, classes: [...r.classes] }));
  check("§0e gömülü kök çapası = ROOT_PUBLIC_KEYS", rustKokler.length === tsKokler.length && jsonEsit(rustKokler, tsKokler), `${tsKokler.length} kök`);
  const paketBlok = /BUILTIN_PACKAGE_KEYS: &\[\(&str, &str\)\] = &\[([\s\S]*?)\];/.exec(anchor);
  const rustPaket = paketBlok ? [...paketBlok[1].matchAll(/\("([^"]+)", "([^"]+)"\)/g)].map((m) => ({ kid: m[1], x: m[2] })) : null;
  check("§0e' gömülü paket çapası = PACKAGE_PUBLIC_KEYS", !!rustPaket && jsonEsit(rustPaket, PACKAGE_PUBLIC_KEYS.map((k) => ({ ...k }))), `${PACKAGE_PUBLIC_KEYS.length} anahtar`);

  const abi = /pub const ABI: u32 = (\d+);/.exec(rustKaynak("api.rs"));
  check("§0f arayüz sürümü Rust = NATIVE_ABI", Number(abi?.[1]) === NATIVE_ABI, `rust ${abi?.[1]} · ts ${NATIVE_ABI}`);
  const hkdf = /pub const HKDF_INFO_PREFIX: &str = "([^"]+)";/.exec(rustKaynak("module_key.rs"));
  check("§0g modül anahtarı HKDF öneki aynı", hkdf?.[1] === MODULE_KEY_HKDF_PREFIX, hkdf?.[1] ?? "yok");
  const kidOnek = /pub const KID_PREFIX: &str = "([^"]+)";/.exec(rustKaynak("module_key.rs"));
  check("§0g' modül anahtarı kimlik öneki aynı (Faz 2d)", kidOnek?.[1] === MODULE_KEY_KID_PREFIX, kidOnek?.[1] ?? "yok");

  const rustDosyalar = ["jws.rs", "schema.rs", "chain.rs", "iso.rs", "integrity.rs", "module_key.rs"].map(rustKaynak);
  const tsKaynaklar = [
    "src/lib/license/protocol/belgeler.ts",
    "src/lib/license/protocol/jws.ts",
    "src/lib/license/protocol/anahtar-zinciri.ts",
    "src/lib/license/protocol/parmak-izi.ts",
    "src/lib/license/integrity.ts",
  ].map((p) => oku(path.join(TEKS, p)));
  const zodDesenleri = [z.iso.datetime()._zod.def.pattern?.source, z.uuid()._zod.def.pattern?.source].filter((s): s is string => !!s);
  const tsKume = new Set([...tsKaynaklar.flatMap(tsDesenleri), ...zodDesenleri].map(desenNormal));
  const rust = rustDesenleri(rustDosyalar);
  const yetim = rust.filter((d) => !tsKume.has(desenNormal(d)));
  check("§0h Rust'taki HER regex TS kaynağında ya da canlı Zod deseninde birebir", rust.length >= 12 && yetim.length === 0, yetim.length ? `yetim: ${yetim.join(" · ")}` : `${rust.length} desen`);
  check("§0i derleme sabiti geliştirmede KAPALI (native zorunlu değil)", NATIVE_REQUIRED === false);

  const tumRust = readdirSync(path.join(NATIVE_DIZIN, "src")).filter((d) => d.endsWith(".rs")).sort().map(rustKaynak);
  const rustTyp = rustTypSabitleri(tumRust);
  const typFark = typFarklari(rustTyp, TYP);
  const rustTypAdlari = new Set(rustTyp.map(([ad]) => ad));
  const gereken = ["HAK", "KIRA", "SERTIFIKA", "BUTUNLUK"].filter((ad) => !rustTypAdlari.has(ad));
  check("§0j Rust'taki HER belge türü (TYP_*) protokolün TYP kayıt defterinde aynı ad ve değerle", typFark.length === 0 && gereken.length === 0, typFark.join(" · ") || (gereken.length ? `Rust'ta yok: ${gereken.join(",")}` : `${rustTyp.length} tür`));
  check("§0j' TS bütünlük türü kayıt defterinden (INTEGRITY_TYP = TYP.BUTUNLUK)", INTEGRITY_TYP === TYP.BUTUNLUK, INTEGRITY_TYP);
}

function secenek(g: Partial<LoaderOptions> & { cwd: string }): LoaderOptions {
  return { required: false, env: {}, platform: process.platform, arch: process.arch, ...g };
}

async function bolum1(): Promise<void> {
  console.log("\n§1 yükleyici davranışı (sahte dizinler)");
  const bos = mkdtempSync(path.join(tmpdir(), "lisans-yukleyici-"));
  try {
    const a = loadLicenseCoreFrom(secenek({ cwd: bos }));
    check("§1a dosya yok + zorunlu değil → TS yolu (DOSYA_YOK)", a.core === tsLicenseCore && a.status.kaynak === "ts" && "neden" in a.status && a.status.neden === "DOSYA_YOK");

    const b = loadLicenseCoreFrom(secenek({ cwd: bos, required: true }));
    const hak = b.core.verifyEntitlement("a.b.c");
    const kira = b.core.verifyLease("a.b.c");
    const butunluk = await b.core.verifyIntegrity("a.b.c", bos);
    const modul = b.core.unwrapModuleKey({}, "x", "finance.enabled");
    const toplanan = await b.core.collectFingerprint(Buffer.alloc(32, 1), "123456");
    check(
      "§1b dosya yok + ZORUNLU → TS'e DÜŞMEZ: kaynak yok, doğrulamalar CEKIRDEK_YOK, bütünlük GEÇERSİZ, parmak izi ölçülemedi, istisna yok",
      b.core !== tsLicenseCore &&
        b.status.kaynak === "yok" &&
        !hak.ok &&
        hak.code === CORE_UNAVAILABLE_CODE &&
        !kira.ok &&
        kira.code === CORE_UNAVAILABLE_CODE &&
        butunluk.ok &&
        butunluk.value.durum === "GECERSIZ" &&
        !modul.ok &&
        modul.code === CORE_UNAVAILABLE_CODE &&
        Object.values(toplanan.digest).every((d) => d === null),
    );

    const c = loadLicenseCoreFrom(secenek({ cwd: bos, platform: "freebsd", arch: "x64" }));
    check("§1c desteklenmeyen platform → PLATFORM_DESTEKSIZ, TS yolu", c.core === tsLicenseCore && "neden" in c.status && c.status.neden === "PLATFORM_DESTEKSIZ");

    const sahte = path.join(bos, "sahte.node");
    writeFileSync(sahte, "bu bir paylaşımlı kitaplık değil");
    const d = loadLicenseCoreFrom(secenek({ cwd: bos, env: { [NATIVE_PATH_ENV]: sahte } }));
    check("§1d bozuk .node → YUKLENEMEDI, TS yolu (süreç düşmez)", d.core === tsLicenseCore && "neden" in d.status && d.status.neden === "YUKLENEMEDI", "ayrinti" in d.status ? d.status.ayrinti.slice(0, 80) : "");

    const zorunluAday = nativeCandidates(secenek({ cwd: bos, required: true, env: { [NATIVE_PATH_ENV]: sahte } }));
    check("§1e ZORUNLU kip ortam yolunu okumaz (yalnız paket yolu)", zorunluAday.length === 1 && !zorunluAday.includes(sahte) && zorunluAday[0] === path.join(bos, "native", path.basename(zorunluAday[0])));

    const id = { abi: NATIVE_ABI, platform: process.platform, arch: process.arch, testCapasi: false };
    const zorunlu = { required: true, platform: process.platform, arch: process.arch };
    const gelistirme = { ...zorunlu, required: false };
    check(
      "§1g künye kararı: üretim derlemesi zorunlu kipte KABUL · test çapalı derleme zorunlu kipte TEST_DERLEMESI, geliştirmede kabul · abi/platform/mimari farkı KUNYE_UYUSMAZ",
      identityRejection(id, zorunlu) === null &&
        identityRejection({ ...id, testCapasi: true }, zorunlu)?.neden === "TEST_DERLEMESI" &&
        identityRejection({ ...id, testCapasi: true }, gelistirme) === null &&
        identityRejection({ ...id, abi: NATIVE_ABI + 1 }, gelistirme)?.neden === "KUNYE_UYUSMAZ" &&
        identityRejection({ ...id, platform: "freebsd" }, gelistirme)?.neden === "KUNYE_UYUSMAZ" &&
        identityRejection({ ...id, arch: "ia32" }, gelistirme)?.neden === "KUNYE_UYUSMAZ",
    );

    const aday = nativeCandidates(secenek({ cwd: bos, env: { [NATIVE_PATH_ENV]: sahte } }));
    check("§1f aday sırası: ortam → paket (app/native) → geliştirme (native/lisans-cekirdek/dist)", aday.length === 3 && aday[0] === sahte && aday[1].includes(`${path.sep}native${path.sep}lisans-cekirdek.`) && aday[2].includes(`${path.sep}dist${path.sep}`));
  } finally {
    rmSync(bos, { recursive: true, force: true });
  }
}

/** Native'in üretebildiği ve vektörlerde geçmesi gereken kodlar (enjeksiyon reddi yalnız üretim derlemesinde). */
function kapsamGereken(): string[] {
  const outcome = rustKaynak("outcome.rs");
  // Yerel koruma kodları platforma bağlıdır (DPAPI yalnız Windows) — vektörle değil §3c'de canlı ölçülür.
  const PLATFORM_KODLARI = ["CAPA_ENJEKSIYONU_KAPALI", "KORUMA_YOK", "KORUMA_HATASI"];
  return [...(rustKodKumesi(outcome, "PROTOCOL") ?? []), ...(rustKodKumesi(outcome, "CORE") ?? [])].filter((c) => !PLATFORM_KODLARI.includes(c));
}

async function bolum2(dosya: VektorDosyasi | null): Promise<void> {
  console.log("\n§2 vektör dosyası ↔ TS kâhini");
  check("§2a vektör dosyası var ve biçimi güncel", !!dosya && dosya.bicim === VEKTOR_BICIMI, path.relative(TEKS, VEKTOR_DOSYASI));
  if (!dosya) return;
  const farklar = await kayitlariKarsilastir(tsLicenseCore, dosya.kayitlar);
  check(
    "§2b her kaydın beklenen sonucu BUGÜNKÜ TS protokolüyle aynı (bayat vektör yok)",
    dosya.kayitlar.length >= 200 && farklar.length === 0,
    farklar.length ? `${farklar.length} fark — ${farkOzeti(farklar)} · yeniden üret: --vektor-yaz` : `${dosya.kayitlar.length} kayıt`,
  );
  const kodlar = beklenenKodlar(dosya.kayitlar);
  const eksik = kapsamGereken().filter((c) => !kodlar.has(c));
  check("§2c native'in üretebildiği her kod en az bir beklenende geçiyor", eksik.length === 0, eksik.length ? `eksik: ${eksik.join(", ")}` : `${kodlar.size} kod`);
  const turler = ["jws", "sertifika", "hak", "kira", "bag", "modul"] as const;
  const eksikTur = turler.filter((t) => {
    const k = dosya.kayitlar.filter((x) => x.vektor.tur === t);
    const gecen = k.filter((x) => jsonEsit(z.object({ ok: z.boolean() }).safeParse(x.beklenen).data?.ok, true)).length;
    return gecen === 0 || gecen === k.length;
  });
  check("§2d her doğrulama türünde hem GEÇER hem KALIR vektör var", eksikTur.length === 0, eksikTur.join(", ") || "6 tür");
}

async function bolum3ile7(dosya: VektorDosyasi | null): Promise<void> {
  const yukle = loadLicenseCoreFrom({ required: false, cwd: TEKS, env: process.env, platform: process.platform, arch: process.arch });
  const canliSayi = vektorleriKur(VEKTOR_SIMDI).filter((v) => v.tur !== "tarih").length;
  const kayitSayi = dosya?.kayitlar.filter((k) => k.vektor.tur !== "tarih").length ?? 0;
  if (yukle.status.kaynak !== "native") {
    const neden = "neden" in yukle.status ? `${yukle.status.neden}: ${yukle.status.ayrinti}` : "";
    const denenen = yukle.status.kaynak === "ts" ? yukle.status.denenen.map((d) => path.relative(TEKS, d)).join(" · ") : "";
    // Adet = koşmayan KONTROL (§3a §3b §4a §5a §6a §6b §7a); kıyaslanmayan vektörler gerekçede.
    ATLAMA.atla(
      "native yok: §3–§7 native karşılaştırması",
      `${process.platform}-${process.arch}; ${neden}; denenen: ${denenen} — ${kayitSayi} kayıtlı + ${canliSayi} canlı vektör kıyaslanmadı; derle: cd native/lisans-cekirdek && npm run derle`,
      7,
    );
    return;
  }
  const native = yukle.core;
  const kunye = yukle.status.kunye;
  console.log(`\n§3 native künyesi — ${path.relative(TEKS, yukle.status.dosya)} · ${kunye.hedef} · ${kunye.profil} · test çapası ${kunye.testCapasi ? "VAR" : "yok"}`);
  check("§3a künye: arayüz sürümü + platform + mimari bu süreçle aynı", kunye.abi === NATIVE_ABI && kunye.platform === process.platform && kunye.arch === process.arch);
  check(
    "§3b canlı ayna listeleri TS ile aynı (kodlar · yer tutucular · Windows sondası · HKDF öneki)",
    kunye.protokolKodlari.every((c) => (PROTOCOL_ERROR_CODES as readonly string[]).includes(c)) &&
      jsonEsit(kunye.cekirdekKodlari, [...CORE_ERROR_CODES]) &&
      jsonEsit(kunye.windowsSondasi, [...WINDOWS_PROBE_LINES]) &&
      kunye.modulHkdfOneki === MODULE_KEY_HKDF_PREFIX &&
      kunye.modulKidOneki === MODULE_KEY_KID_PREFIX,
  );
  // §3c yerel koruma (Faz 2d önbelleği): Windows'ta DPAPI gidiş-dönüş, başka platformda KORUMA_YOK (TS de).
  const koruma = native.protectLocal(b64uEncode(Buffer.from("tekserp-onbellek-sondasi")));
  if (process.platform === "win32") {
    const geri = koruma.ok ? native.unprotectLocal(koruma.value.veri) : koruma;
    check("§3c yerel koruma: DPAPI sarar ve aynı veriyi geri açar", geri.ok && Buffer.from(b64uDecode(geri.value.veri) ?? []).toString() === "tekserp-onbellek-sondasi");
  } else {
    check(
      "§3c yerel koruma: Windows dışında KORUMA_YOK (native = TS)",
      !koruma.ok && koruma.code === "KORUMA_YOK" && !tsLicenseCore.protectLocal("AA").ok,
      koruma.ok ? "native sardı?" : koruma.code,
    );
  }

  console.log("\n§6 parmak izi toplama (bu makine)");
  const tuz = Buffer.alloc(32, 0x42);
  const [tt, nn] = await Promise.all([tsLicenseCore.collectFingerprint(tuz, "7412345678901234567"), native.collectFingerprint(tuz, "7412345678901234567")]);
  const olculen = Object.values(tt.digest).filter((d) => d !== null).length;
  check("§6a OS etkenleri + F5: TS toplayıcı = native toplayıcı (aynı tuz)", jsonEsit(tt, nn), `${olculen} etken ölçüldü · ${JSON.stringify(nn.measured)}`);
  // F5 çağırandan gelir; OS'ten en az bir etken ölçülmediyse eşitlik yalnız "ikisi de boş" demektir.
  if (olculen >= 2) check("§6b kıyas anlamlı: OS'ten en az bir etken ölçüldü", olculen >= 2, `${olculen - 1} OS etkeni`);
  else ATLAMA.atla("§6b anlamlı toplama kıyası", `bu ortamda OS etkeni ölçülemedi (konteyner / yetkisiz kullanıcı) — ${JSON.stringify(nn.measured)}`);

  console.log("\n§7 zorunlu kip");
  const paketDosyasi = path.join(TEKS, "native", nativeFileName(process.platform, process.arch) ?? "yok");
  const zorunlu = loadLicenseCoreFrom({ required: true, cwd: TEKS, env: process.env, platform: process.platform, arch: process.arch });
  if (zorunlu.status.kaynak === "native") {
    check("§7a zorunlu kip paket yolundaki ÜRETİM derlemesini kabul eder", !zorunlu.status.kunye.testCapasi && zorunlu.status.dosya === paketDosyasi, path.relative(TEKS, zorunlu.status.dosya));
  } else {
    const neden = "neden" in zorunlu.status ? zorunlu.status.neden : "";
    // `.node` varsa açılmadan ÖNCE imzalı listeye bakılır (Teks-Erp kökünde liste yok → LISTE_YOK).
    const listeVar = existsSync(path.join(TEKS, "butunluk.jws"));
    const beklenen = !existsSync(paketDosyasi) ? "DOSYA_YOK" : listeVar ? "TEST_DERLEMESI" : "LISTE_YOK";
    check(`§7a zorunlu kip TS'e DÜŞMEZ — paket yolunda ${beklenen === "DOSYA_YOK" ? "dosya yok" : beklenen === "LISTE_YOK" ? "imzalı liste yok" : "test derlemesi"} → ${beklenen}`, zorunlu.status.kaynak === "yok" && neden === beklenen, neden);
  }

  if (!kunye.testCapasi) {
    // Üretim derlemesi: dışarıdan çapa verilemez → kıyas vektörleri koşamaz, ama enjeksiyon reddi ölçülür.
    const r = native.verifyEntitlement("a.b.c", ROOT_PUBLIC_KEYS);
    check("§7b üretim derlemesi dışarıdan çapayı reddeder (CAPA_ENJEKSIYONU_KAPALI)", !r.ok && r.code === "CAPA_ENJEKSIYONU_KAPALI");
    const g = native.verifyEntitlement("a.b.c");
    check("§7c üretim derlemesi gömülü çapayla doğrular (çapasız çağrı JWS katmanına iner)", !g.ok && g.code === "JWS_BICIM");
    ATLAMA.atla(
      "§4–§5 vektör kıyası",
      `yüklenen native üretim derlemesi (test çapası yok) — ${kayitSayi} kayıtlı + ${canliSayi} canlı vektör kıyaslanmadı; kıyas için \`npm run derle\` (test-anchor)`,
      2,
    );
    return;
  }

  console.log("\n§4 kayıtlı vektörler native'de");
  if (dosya) {
    const farklar = await kayitlariKarsilastir(native, dosya.kayitlar.filter((k) => k.vektor.tur !== "tarih"));
    check("§4a her kayıtlı vektörde native = beklenen (TS kâhini)", farklar.length === 0, farklar.length ? `${farklar.length} fark — ${farkOzeti(farklar)}` : `${kayitSayi} vektör`);
  }

  console.log("\n§5 CANLI vektörler (taze anahtar, şimdi): TS = native");
  const canli = vektorleriKur(Date.now()).filter((v) => v.tur !== "tarih");
  const farklar: Fark[] = [];
  for (const v of canli) {
    const [t, n] = [await degerlendir(tsLicenseCore, v), await degerlendir(native, v)];
    if (!jsonEsit(t, n)) farklar.push({ ad: `${v.tur} · ${v.ad}`, beklenen: t, gelen: n });
  }
  check("§5a canlı vektörlerin HER birinde TS = native", farklar.length === 0, farklar.length ? `${farklar.length} fark — ${farkOzeti(farklar)}` : `${canli.length} vektör`);
}

async function bolum8(dosya: VektorDosyasi | null): Promise<void> {
  console.log("\n§8 ⭐ KALICI SONDALAR ✓K");
  check("§8a karşılaştırıcı farkı ısırır (kod farkı)", !jsonEsit({ ok: false, code: "JWS_ALG" }, { ok: false, code: "JWS_TYP" }));
  check("§8b karşılaştırıcı farkı ısırır (iç içe değer, eksik anahtar)", !jsonEsit({ ok: true, value: { a: [1, { b: 2 }] } }, { ok: true, value: { a: [1, {}] } }));
  check("§8c karşılaştırıcı eşitte susar (anahtar sırası önemsiz)", jsonEsit({ a: 1, b: [null, "x"] }, { b: [null, "x"], a: 1 }));
  if (dosya && dosya.kayitlar.length > 0) {
    const ilk = dosya.kayitlar[0];
    const bozuk: VektorKaydi = { vektor: ilk.vektor, beklenen: { ok: false, code: "SAHTE_KOD" } };
    const fark = await kayitlariKarsilastir(tsLicenseCore, [bozuk]);
    check("§8d bayatlık denetimi mutasyona uğramış beklenenle kırmızı verir", fark.length === 1);
    const kodlar = beklenenKodlar(dosya.kayitlar.filter((k) => !jsonEsit(z.object({ code: z.string() }).safeParse(k.beklenen).data?.code, "JWS_ALG")));
    check("§8e kapsam denetimi eksik kodu yakalar (JWS_ALG vektörleri çıkarılınca)", !kodlar.has("JWS_ALG") && kapsamGereken().includes("JWS_ALG"));
  }
  const tsKume = new Set(tsDesenleri("const A = /^tekserp-[a-z]+$/;").map(desenNormal));
  check("§8f regex aynası değişmiş deseni yakalar, `\\d` ≡ `[0-9]` eşitliğinde susar", !tsKume.has(desenNormal("^tekserp-[a-z0-9]+$")) && tsKume.has(desenNormal("^tekserp-[a-z]+$")) && desenNormal("^\\d{4}$") === desenNormal("^[0-9]{4}$"));
  const sentetik = rustTypSabitleri([`pub const TYP_HAK: &str = "tekserp-hak";\npub const TYP_BUTUNLUK: &str = "tekserp-butunlukx";\npub const TYP_YENI: &str = "tekserp-yeni";`]);
  const sentetikFark = typFarklari(sentetik, { HAK: "tekserp-hak", BUTUNLUK: "tekserp-butunluk" });
  check("§8g TYP aynası değişmiş değeri ve kayıt defterinde olmayan türü yakalar, eşitte susar", sentetik.length === 3 && sentetikFark.length === 2 && typFarklari(sentetik.slice(0, 1), { HAK: "tekserp-hak" }).length === 0, sentetikFark.join(" · "));
}

async function main(): Promise<void> {
  if (process.argv.includes("--vektor-yaz")) {
    await vektorYaz();
    return;
  }
  console.log("=== Lisans native çekirdeği kâhini ===");
  bolum0();
  await bolum1();
  const dosya = vektorDosyasiOku();
  await bolum2(dosya);
  await bolum3ile7(dosya);
  await bolum8(dosya);
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız${ATLAMA.ozetEki()} ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e: unknown) => {
  console.error("❌ bekçi çöktü:", e);
  process.exit(1);
});
