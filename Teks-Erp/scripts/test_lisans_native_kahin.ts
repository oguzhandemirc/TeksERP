// =============================================================================
// BEKÇİ — LİSANS NATIVE ÇEKİRDEĞİ KÂHİNİ: TS protokolü (tek kaynak) ↔ Rust çekirdek (ayna)
// =============================================================================
// Çalıştırma: npx tsx scripts/test_lisans_native_kahin.ts          (DB'SİZ)
//             npx tsx scripts/test_lisans_native_kahin.ts --vektor-yaz   (vektör dosyasını TS'ten yeniden üretir)
// Native'i sına: önce `cd native/lisans-cekirdek && npm run derle` (ya da TEKSERP_LISANS_CEKIRDEK=<.node>).
//
// NE ÖLÇER: native çekirdek (`native/lisans-cekirdek` + ortak `native/tekserp-dogrulama`, Rust + napi-rs) TS protokolünün AYNASIDIR;
// ayrışırsa fabrika aynı belgeyi iki yolda farklı doğrular ve hata sessizdir.
//   §0 STATİK aynalar (native gerekmez): Rust kod kümeleri ⊆/= TS · yer tutucu listesi · Windows
//      sondası satır satır · gömülü çapanın üretim kök + PAKET listeleri = TS listeleri, bloklar `cfg` kapısız
//      ve anchor.rs'te özellik kapısı yok; TS'te hazırlık çapası YOK (tek kip) · arayüz sürümü ·
//      HKDF öneki · Rust'taki HER regex TS kaynağında (ya da canlı Zod deseninde) birebir var ·
//      iki derleme sabiti geliştirmede kapalı (native zorunlu değil · çapa kipi üretim) · Rust'taki her
//      belge türü (TYP_*) protokolün TYP kayıt defterinde aynı ad/değerle (bütünlük türü dahil) · aynanın
//      kaynağı iki crate'tedir (`lisans-cekirdek` + ORTAK `tekserp-dogrulama`) ve dosya adları ikisinde tekildir (§0l) ·
//      çapanın açık anahtarları native ağacında YALNIZ ortak `anchor.rs`te — güncelleyici kopya taşımaz (§0m)
//   §1 yükleyici: dosya yok → TS (zorunlu değil) / "yok" + her doğrulama CEKIRDEK_YOK + bütünlük
//      GEÇERSİZ, istisna yok (zorunlu) · desteklenmeyen platform · bozuk .node · zorunlu kip ortam
//      yolunu okumaz · aday sırası · §1h lisans v2 işlevlerini taşımayan eski ABI-3 ikilisi bağlama olarak TANINMAZ
//   §2 vektör dosyası (`native/lisans-cekirdek/test-vektorleri/protokol.json`, `cargo test` de okur):
//      her kaydın beklenen sonucu BUGÜNKÜ TS protokolüyle aynı (bayat vektör yok) · native'in
//      üretebildiği her kod en az bir beklenende geçiyor (kapsam) · her türde geçer + kalır · her gömülü
//      çapa vektörü üretim kipinde kayıtlı; eski hazırlık kid'i tanınmaz, üretim kid'iyle yabancı imza imzada düşer
//   §2'' LİSANS v2 vektörleri (`test-vektorleri/protokol-v2.json`, L2-1; `cargo test` de okur, L2-2): biçim · her
//      kaydın beklenen sonucu BUGÜNKÜ TS protokolüyle aynı · 11 tür · sonuç türlerinde geçer + kalır · yeni beş
//      protokol kodu beklenende · parmak izi kurallarında sonuç çeşitliliği · gömülü çapa v2 vektörleri üretim kipinde ·
//      §2''h TS ÇEKİRDEĞİ (LicenseCore v2 yüzeyi: iptal · nowMs · parmak izi kuralı) protokolle aynı karar.
//      §2c kapsamı iki dosyanın birleşimidir (v2 kodları yalnız v2 dosyasında). Yeniden üret: `--vektor-yaz [--yalniz-v2]`
//   §0d' · §0d'' · §1i · §2''' PARMAK İZİ ÇOK YOLLU TOPLAYICI (L2-10): yol tablosu TS `FINGERPRINT_PATH_LINES` = Rust
//      `PATHS` satır satır · Windows sondası tablodaki her win32 yolunu basar, fazlasını basmaz · tabloyu künyesinde
//      taşımayan eski ABI-3 ikilisi açılmaz · `test-vektorleri/toplama.json` (seçim + özet · Windows sonda çıktısı ·
//      SMBIOS yapısı; `cargo test` `tests/toplama.rs` de okur) bugünkü TS ile aynı, RAID → UniqueId sabit.
//      Yeniden üret: `--vektor-yaz --yalniz-toplama`. ✓K §8o (dizge okuyucu `];` taşıyan sonda satırında kesilmez) · §8p
//   §0l lisans v2 sabitleri Rust = TS (kullanımlar · kapanış nedenleri · parmak izi kuralları · güçlü etkenler ·
//      ufuk sınırları · iptal satır tavanı · v1/v2 eşikleri)
//   §3–§7 NATIVE (yoksa "⏭ ATLANDI — native yok", sayıyla; canlı çapa ÖLÇÜLMEDİ, yeşil sayılmaz): künye/ayna
//      listeleri canlı · ⭐ gömülü çapa CANLI (§3d: derlenmiş her .node'un `builtinAnchor()`ı — yüklenen · `dist` ·
//      `dist-uretim` · paket yolu — KENDİ kipinin TS çapasıyla birebir, dizin kipi doğru; bayat
//      ikili kırmızı) · kayıtlı vektörler native'de beklenenle aynı (kendi kipininkiler) · CANLI (taze anahtarlı)
//      vektörlerde TS = native · §4b/§5b aynısı lisans v2 vektörlerinde (istek ailesi hariç: native istek doğrulamaz) ·
//      bu makinede parmak izi toplama TS = native · zorunlu kip test derlemesini reddeder / üretim derlemesi çapa
//      enjeksiyonunu reddeder
//   §9 ⭐ ÜRETİM İKİLİSİ SONDASI (gerçek `dist-uretim` ikilisi; yoksa ATLANDI, STRICT'te kırmızı): ikili kendi
//      kipinin gömülü çapa vektörlerini beklenen sonuçla verir — eski hazırlık kid'iyle imzalı belgeyi TANIMAZ ·
//      dışarıdan çapayı reddeder · §9e kendi kipinin v2 gömülü çapa vektörleri
//   §8 ⭐ KALICI SONDA ✓K (her koşumda): karşılaştırıcı farkı ısırır, eşitte susar · bayatlık
//      denetimi mutasyona uğramış beklenenle kırmızı · kapsam denetimi eksik kodu yakalar ·
//      regex aynası değişmiş deseni yakalar · TYP aynası değişmiş/kayıtsız türü yakalar · gömülü
//      çapa blokları üç rustfmt düzeninde de okunur (ikinci anahtar `&[`i alt satıra taşır) · kip süzgeci
//      tanınmayan kipin kaydını atlar · §8k v2 bayatlık mutasyonu yakalar · §8l tek yönlü tür denetimi · §8m v2 çekirdek
//      karşılaştırıcısı mutasyonu yakalar · §8n v2 sabit aynası değişmiş/eksik sabiti yakalar, eşitte susar
//   §10 ⭐ KÖPRÜ SONDASI (L2-7): motorun köprüsü (`core-bridge.ts`) iptal metnini ve "şimdi"yi çekirdeğe AYNEN geçirir —
//      ARA'sı iptal edilen HAK SERTIFIKA_IPTAL, geçmiş "şimdi" BELGE_ILERI_TARIHLI, ALT'ı iptal edilen kira SERTIFIKA_IPTAL;
//      TS ve (test çapalı) native aynı kararı verir (native yoksa yalnız TS kolu, native kolu ATLANDI) · L2-7 S1 köprü
//      seçenekleri çekirdeğe geçirmedi → §10a · §10b ❌ (kaynakta mutasyon, sha eşit geri alındı)
//   §11 ⭐ YETENEK SONDASI (L2-7 B): `hak-ara` + `iptal` yalnız biçimsiz belgeye KENDİ protokol koduyla cevap veren çekirdekte
//      bildirilir — TS ve native dört yetenek, kullanılamayan çekirdek iki · L2-7 S17 canlı sonda kalktı → §11a ❌
//   L2-1 negatif sondaları (dosya dışı, sha eşit geri alındı): bayi ufuk tavanı · güçlü şartı · iptal denetimi
//   (protokolde) → §2''b · v2 dosya biçimi → §2''a · v2 dosyasından istek ailesi silindi → §2''c/d/e
//
// NEGATİF SONDA — dosya DIŞI mutasyonlar (commit mesajında sayılarla; her biri geri alındı, sha eşit):
//   bkz. Teks-Erp/docs/BEKCI-HARITASI.md `## lisans` satırı.
// =============================================================================
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import {
  CERT_USAGES,
  CLOSING_LEASE_REASONS,
  FINGERPRINT_RULES,
  FINGERPRINT_THRESHOLD,
  FINGERPRINT_V2_THRESHOLD,
  MODULE_KEY_KID_PREFIX,
  OFFLINE_HORIZON_DEALER_DAYS,
  OFFLINE_HORIZON_MAX_DAYS,
  OFFLINE_HORIZON_SHORT_CLASS_DAYS,
  PRODUCTION_ROOT_PUBLIC_KEYS,
  REVOCATION_MAX_ENTRIES,
  REVOCATION_USAGES,
  PACKAGE_ACCEPT_TOLERANCE_DAYS,
  STRONG_FINGERPRINT_FACTORS,
  PROTOCOL_ERROR_CODES,
  TRUST_ANCHOR_MODES,
  TYP,
  b64uDecode,
  b64uEncode,
  isTrustAnchorMode,
  rootPublicKeysFor,
  type TrustAnchorMode,
} from "../src/lib/license/protocol";
import { CORE_ERROR_CODES, CORE_UNAVAILABLE_CODE, tsLicenseCore, type LicenseCore } from "../src/lib/license/license-core";
import { INTEGRITY_LIST_FILE, INTEGRITY_MAX_FILES, INTEGRITY_MAX_LIST_BYTES } from "../src/lib/license/integrity-list";
import {
  NATIVE_ABI,
  NATIVE_PATH_ENV,
  NATIVE_REQUIRED,
  identityRejection,
  loadLicenseCoreFrom,
  nativeBuiltinAnchor,
  nativeCandidates,
  nativeFileName,
  parseNativeIdentity,
  type LoaderOptions,
} from "../src/lib/license/native";
import { isNativeBinding, nativeCore, unavailableCore, type NativeBinding } from "../src/lib/license/native-adapter";
import { capabilitiesFor } from "../src/lib/license/capabilities";
import {
  INTEGRITY_TYP,
  PACKAGE_PUBLIC_KEYS,
  PRODUCTION_PACKAGE_PUBLIC_KEYS,
  packagePublicKeysFor,
} from "../src/lib/license/integrity";
import { BUILD_ANCHOR_MODE, ROOT_PUBLIC_KEYS } from "../src/lib/license/trust-anchor";
import * as protokolModulu from "../src/lib/license/protocol";
import * as butunlukModulu from "../src/lib/license/integrity";
import { MODULE_KEY_HKDF_PREFIX } from "../src/lib/license/module-key";
import { WINDOWS_PROBE_LINES } from "../src/lib/license/fingerprint-os";
import { FINGERPRINT_PATH_LINES } from "../src/lib/license/fingerprint-paths";
import {
  VEKTOR_TOPLAMA_BICIMI,
  degerlendirToplama,
  vektorToplamaDosyasiUret,
  vektorToplamaDosyasiYolu,
  type VektorToplama,
  type VektorToplamaDosyasi,
  type VektorToplamaKaydi,
} from "./lib/lisans-cekirdek-vektor-toplama";
import { atlamaDefteri } from "./lib/atlama";
import { coreVerifyEntitlement, coreVerifyLease } from "../src/lib/license/core-bridge";
import { araHakBas, araSertifikasi, fiksturKur, iptalBas, iptalYuku, kiraBas } from "./lib/lisans-fikstur";
import {
  VEKTOR_BICIMI,
  VEKTOR_SIMDI,
  degerlendir,
  jsonEsit,
  kipteKosar,
  vektorDosyasiYolu,
  vektorDosyasiUret,
  vektorleriKur,
  type Vektor,
  type VektorDosyasi,
  type VektorKaydi,
} from "./lib/lisans-cekirdek-vektor";
import {
  V2_CEKIRDEK_DISI,
  VEKTOR_V2_BICIMI,
  degerlendirV2,
  degerlendirV2Cekirdek,
  kipteKosarV2,
  vektorleriKurV2,
  vektorV2DosyasiUret,
  vektorV2DosyasiYolu,
  type VektorV2,
  type VektorV2Dosyasi,
  type VektorV2Kaydi,
} from "./lib/lisans-cekirdek-vektor-v2";

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
/**
 * Aynanın Rust kaynağı İKİ crate'e yayılır: napi yapıştırıcısı · parmak izi · modül anahtarı `lisans-cekirdek`te,
 * doğrulama (JWS · zincir · şema · gömülü çapa · bütünlük) ORTAK `tekserp-dogrulama`da (güncelleyici de bağlar).
 * Dosya adı iki dizinde TEKİLDİR (§0l ölçer) — ad → dosya eşlemesi tahmin istemez.
 */
const RUST_KAYNAK_DIZINLERI = [path.join(NATIVE_DIZIN, "src"), path.join(TEKS, "native", "tekserp-dogrulama", "src")];
const VEKTOR_DOSYASI = vektorDosyasiYolu(TEKS);
const VEKTOR_V2_DOSYASI = vektorV2DosyasiYolu(TEKS);
const VEKTOR_TOPLAMA_DOSYASI = vektorToplamaDosyasiYolu(TEKS);
const oku = (p: string) => readFileSync(p, "utf8");
const rustDosyaYollari = (): string[] => RUST_KAYNAK_DIZINLERI.flatMap((d) => readdirSync(d).filter((f) => f.endsWith(".rs")).map((f) => path.join(d, f)));
/**
 * §0m: gömülü çapanın açık anahtarları native ağacında YALNIZ ortak `tekserp-dogrulama/src/anchor.rs`te durur —
 * lisans çekirdeği ve güncelleyici aynı listeyi BAĞLAR, kopya taşımaz (kopya kipten ve TS aynasından kopar).
 */
export function capaKopyalari(nativeKok: string, xler: readonly string[]): string[] {
  const tek = path.join("tekserp-dogrulama", "src", "anchor.rs");
  const out: string[] = [];
  const gez = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === "target" || e.name === "node_modules" || e.name.startsWith(".") || e.name.startsWith("dist")) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) gez(p);
      else if (e.name.endsWith(".rs") && path.relative(nativeKok, p) !== tek && xler.some((x) => oku(p).includes(x))) out.push(path.relative(nativeKok, p));
    }
  };
  gez(nativeKok);
  return out.sort();
}
function rustKaynak(ad: string): string {
  const dizin = RUST_KAYNAK_DIZINLERI.find((d) => existsSync(path.join(d, ad)));
  if (!dizin) throw new Error(`Rust kaynağı bulunamadı: ${ad} (${RUST_KAYNAK_DIZINLERI.map((d) => path.relative(TEKS, d)).join(" · ")})`);
  return oku(path.join(dizin, ad));
}

// ── Rust kaynağından metin çıkarımı ─────────────────────────────────────────────
function rustDizge(ham: string): string {
  return ham.replace(/\\(["\\])/g, "$1");
}

/**
 * `pub const AD: [&str; N] = [ "a", "b" ];` ya da `&[&str] = &[ … ]` içindeki dizgeler. Dizinin sonu dizge DIŞINDAKİ
 * ilk `]`dir: Windows sondası satırları `$r[1];` gibi `];` taşır (yalın `\];` deseni orada keserdi, §8o).
 */
export function rustDizgeListesi(kaynak: string, ad: string): string[] | null {
  const m = new RegExp(`pub const ${ad}: [^=]+= &?\\[`).exec(kaynak);
  if (!m) return null;
  const out: string[] = [];
  let i = m.index + m[0].length;
  while (i < kaynak.length) {
    const c = kaynak[i];
    if (c === "]") return out;
    if (c !== '"') {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < kaynak.length && kaynak[j] !== '"') j += kaynak[j] === "\\" ? 2 : 1;
    out.push(rustDizge(kaynak.slice(i + 1, j)));
    i = j + 1;
  }
  return null;
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

/** `pub const AD: <tip> = <sayı>;` (alt çizgili sayı da) → sayı; yoksa NaN. */
export function rustSayiSabiti(kaynak: string, ad: string): number {
  const m = new RegExp(`pub const ${ad}: \\w+ = ([0-9_]+);`).exec(kaynak);
  return m ? Number(m[1].replace(/_/g, "")) : Number.NaN;
}

/** Lisans v2 sabitleri (L2-2): Rust (dosya, ad) → TS değeri; uyuşmayan ya da bulunamayan her sabit bir fark satırı. */
export function v2SabitFarklari(rust: (dosya: string) => string): string[] {
  const listeler: ReadonlyArray<readonly [string, string, readonly string[]]> = [
    ["schema.rs", "CERT_USAGES", CERT_USAGES],
    ["schema.rs", "REVOCATION_USAGES", REVOCATION_USAGES],
    ["schema.rs", "CLOSING_LEASE_REASONS", CLOSING_LEASE_REASONS],
    ["schema.rs", "FINGERPRINT_RULES", FINGERPRINT_RULES],
    ["fingerprint.rs", "STRONG_FACTORS", STRONG_FINGERPRINT_FACTORS],
  ];
  const sayilar: ReadonlyArray<readonly [string, string, number]> = [
    ["schema.rs", "OFFLINE_HORIZON_MAX_DAYS", OFFLINE_HORIZON_MAX_DAYS],
    ["schema.rs", "OFFLINE_HORIZON_DEALER_DAYS", OFFLINE_HORIZON_DEALER_DAYS],
    ["schema.rs", "OFFLINE_HORIZON_SHORT_CLASS_DAYS", OFFLINE_HORIZON_SHORT_CLASS_DAYS],
    ["schema.rs", "REVOCATION_MAX_ENTRIES", REVOCATION_MAX_ENTRIES],
    ["paket_zinciri.rs", "PACKAGE_ACCEPT_TOLERANCE_DAYS", PACKAGE_ACCEPT_TOLERANCE_DAYS],
    ["fingerprint.rs", "V1_MIN_MATCHES", FINGERPRINT_THRESHOLD.minMatches],
    ["fingerprint.rs", "V1_MIN_MEASURABLE", FINGERPRINT_THRESHOLD.minMeasurable],
    ["fingerprint.rs", "V2_MIN_MATCHES", FINGERPRINT_V2_THRESHOLD.minMatches],
    ["fingerprint.rs", "V2_MIN_STRONG_MATCHES", FINGERPRINT_V2_THRESHOLD.minStrongMatches],
  ];
  return [
    ...listeler.flatMap(([dosya, ad, ts]) => {
      const r = rustDizgeListesi(rust(dosya), ad);
      return jsonEsit(r, [...ts]) ? [] : [`${ad}: rust ${JSON.stringify(r)} · ts ${JSON.stringify(ts)}`];
    }),
    ...sayilar.flatMap(([dosya, ad, ts]) => {
      const r = rustSayiSabiti(rust(dosya), ad);
      return r === ts ? [] : [`${ad}: rust ${r} · ts ${ts}`];
    }),
  ];
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

function dosyaMetni(dosya: { bicim: number; not: string; kayitlar: readonly unknown[] }): string {
  const satirlar = dosya.kayitlar.map((k) => JSON.stringify(k));
  return `{"bicim":${dosya.bicim},"not":${JSON.stringify(dosya.not)},"kayitlar":[\n${satirlar.join(",\n")}\n]}\n`;
}

/** İki dosyayı da yazar; `--yalniz-v2` v1 dosyasına dokunmaz (L2-1: v1 vektörleri değişmedi, yeniden üretmek gürültü). */
async function vektorYaz(): Promise<void> {
  const toplama = vektorToplamaDosyasiUret();
  const metinToplama = `{"bicim":${toplama.bicim},"not":${JSON.stringify(toplama.not)},"tuz":${JSON.stringify(toplama.tuz)},"kayitlar":[\n${toplama.kayitlar.map((k) => JSON.stringify(k)).join(",\n")}\n]}\n`;
  writeFileSync(VEKTOR_TOPLAMA_DOSYASI, metinToplama);
  console.log(`✍️  ${path.relative(TEKS, VEKTOR_TOPLAMA_DOSYASI)} yazıldı — ${toplama.kayitlar.length} kayıt, ${metinToplama.length} bayt`);
  // `--yalniz-toplama`: L2-10 parmak izi toplama vektörleri; v1/v2 dosyalarına dokunmaz.
  if (process.argv.includes("--yalniz-toplama")) return;
  if (!process.argv.includes("--yalniz-v2")) {
    const dosya = await vektorDosyasiUret(tsLicenseCore, VEKTOR_SIMDI);
    const metin = dosyaMetni(dosya);
    writeFileSync(VEKTOR_DOSYASI, metin);
    console.log(`✍️  ${path.relative(TEKS, VEKTOR_DOSYASI)} yazıldı — ${dosya.kayitlar.length} kayıt, ${metin.length} bayt`);
  }
  const v2 = vektorV2DosyasiUret(VEKTOR_SIMDI);
  const metinV2 = dosyaMetni(v2);
  writeFileSync(VEKTOR_V2_DOSYASI, metinV2);
  console.log(`✍️  ${path.relative(TEKS, VEKTOR_V2_DOSYASI)} yazıldı — ${v2.kayitlar.length} kayıt, ${metinV2.length} bayt`);
}

const VektorV2DosyasiSchema = z.object({
  bicim: z.number(),
  not: z.string(),
  kayitlar: z.array(z.object({ vektor: z.custom<VektorV2>((x) => typeof x === "object" && x !== null && "tur" in x), beklenen: z.unknown() })),
});

const VektorToplamaDosyasiSchema = z.object({
  bicim: z.number(),
  not: z.string(),
  tuz: z.string(),
  kayitlar: z.array(z.object({ vektor: z.custom<VektorToplama>((x) => typeof x === "object" && x !== null && "tur" in x), beklenen: z.unknown() })),
});

function vektorToplamaDosyasiOku(): VektorToplamaDosyasi | null {
  if (!existsSync(VEKTOR_TOPLAMA_DOSYASI)) return null;
  const p = VektorToplamaDosyasiSchema.safeParse(JSON.parse(oku(VEKTOR_TOPLAMA_DOSYASI)));
  return p.success ? p.data : null;
}

/** Toplama bayatlığı: dosyadaki beklenen ≠ bugünkü TS değerlendirmesi olan kayıtlar. */
export function toplamaFarklari(kayitlar: readonly VektorToplamaKaydi[]): Fark[] {
  return kayitlar
    .map((k) => ({ ad: `${k.vektor.tur} · ${k.vektor.ad}`, beklenen: k.beklenen, gelen: degerlendirToplama(k.vektor) }))
    .filter((x) => !jsonEsit(x.beklenen, x.gelen));
}

function bolum2toplama(dosya: VektorToplamaDosyasi | null): void {
  console.log("\n§2''' parmak izi toplama vektörleri (toplama.json, L2-10) ↔ TS (native: cargo tests/toplama.rs)");
  check("§2'''a toplama vektör dosyası var ve biçimi güncel", !!dosya && dosya.bicim === VEKTOR_TOPLAMA_BICIMI, path.relative(TEKS, VEKTOR_TOPLAMA_DOSYASI));
  if (!dosya) return;
  const farklar = toplamaFarklari(dosya.kayitlar);
  check(
    "§2'''b ⭐ her toplama kaydının beklenen sonucu BUGÜNKÜ TS seçimiyle aynı (bayat vektör yok)",
    dosya.kayitlar.length >= 40 && farklar.length === 0,
    farklar.length ? `${farklar.length} fark — ${farkOzeti(farklar)} · yeniden üret: --vektor-yaz --yalniz-toplama` : `${dosya.kayitlar.length} kayıt`,
  );
  const durumlar = new Set(
    dosya.kayitlar.flatMap((k) => (k.vektor.tur === "toplama" ? Object.values((k.beklenen as { okuma: Record<string, { durum: string }> }).okuma).map((o) => o.durum) : [])),
  );
  check("§2'''c seçim üç durumu da kapsar (OKUNDU · DEGER_YOK · OKUNAMADI)", durumlar.size === 3, [...durumlar].join(", "));
  const platformlar = new Set(dosya.kayitlar.flatMap((k) => (k.vektor.tur === "toplama" ? [String(k.vektor.platform)] : [])));
  check("§2'''d üç platform + tabloda olmayan platform kayıtlı", ["win32", "linux", "darwin", "null"].every((p) => platformlar.has(p)), [...platformlar].join(", "));
  const raid = dosya.kayitlar.find((k) => k.vektor.ad.includes("RAID (SAHINSRV"));
  const raidYol = (raid?.beklenen as { okuma?: { f3?: { yol?: string } } } | undefined)?.okuma?.f3?.yol;
  check("§2'''e ⭐ RAID (seri genel desende) vektörü UniqueId türünü devreye sokar", raidYol === "f3.disk-kimlik", String(raidYol));
}

function vektorV2DosyasiOku(): VektorV2Dosyasi | null {
  if (!existsSync(VEKTOR_V2_DOSYASI)) return null;
  const p = VektorV2DosyasiSchema.safeParse(JSON.parse(oku(VEKTOR_V2_DOSYASI)));
  return p.success ? p.data : null;
}

/** v2 bayatlık: dosyadaki beklenen ≠ bugünkü TS değerlendirmesi olan kayıtlar. */
export function v2Farklari(kayitlar: readonly VektorV2Kaydi[]): Fark[] {
  return kayitlar
    .map((k) => ({ ad: `${k.vektor.tur} · ${k.vektor.ad}`, beklenen: k.beklenen, gelen: degerlendirV2(k.vektor) }))
    .filter((x) => !jsonEsit(x.beklenen, x.gelen));
}

/** v2 çekirdek farkları: kaydın beklenen sonucu ≠ verilen çekirdekteki değerlendirme (çekirdek dışı türler süzülmüş olmalı). */
export function v2CekirdekFarklari(core: LicenseCore, kayitlar: readonly VektorV2Kaydi[]): Fark[] {
  return kayitlar
    .map((k) => ({ ad: `${k.vektor.tur} · ${k.vektor.ad}`, beklenen: k.beklenen, gelen: degerlendirV2Cekirdek(core, k.vektor) }))
    .filter((x) => !jsonEsit(x.beklenen, x.gelen));
}

function v2CekirdekKayitlari(kayitlar: readonly VektorV2Kaydi[], kip?: TrustAnchorMode): VektorV2Kaydi[] {
  return kayitlar.filter((k) => !V2_CEKIRDEK_DISI.includes(k.vektor.tur) && (kip === undefined || kipteKosarV2(k.vektor, kip)));
}

const V2_YENI_KODLAR = ["SERTIFIKA_IPTAL", "BELGE_ILERI_TARIHLI", "UFUK_TAVANI_ASIMI", "IMZACI_KIMLIK", "ISTEK_YOL"] as const;
const V2_SONUC_TURLERI = ["hak2", "kira2", "bag2", "iptal", "istek"] as const;
const V2_TUM_TURLER = [...V2_SONUC_TURLERI, "iptalSec", "iptalGuncel", "parmakIziKarar", "tanima", "ogrenme", "ufukTavani"] as const;

/** Sonuç biçimli türlerde (ok/kod) hem GEÇER hem KALIR kaydı olmayan tür adları. */
export function v2TekYonluTurler(kayitlar: readonly VektorV2Kaydi[]): string[] {
  return V2_SONUC_TURLERI.filter((t) => {
    const k = kayitlar.filter((x) => x.vektor.tur === t);
    const gecen = k.filter((x) => z.object({ ok: z.literal(true) }).safeParse(x.beklenen).success).length;
    return gecen === 0 || gecen === k.length;
  });
}

function bolum2v2(dosya: VektorV2Dosyasi | null): void {
  console.log("\n§2'' lisans v2 vektör dosyası (protokol-v2.json) ↔ TS kâhini + TS çekirdeği (native: §4b · §5b · §9e · cargo)");
  check("§2''a v2 vektör dosyası var ve biçimi güncel", !!dosya && dosya.bicim === VEKTOR_V2_BICIMI, path.relative(TEKS, VEKTOR_V2_DOSYASI));
  if (!dosya) return;
  const farklar = v2Farklari(dosya.kayitlar);
  check(
    "§2''b ⭐ her v2 kaydının beklenen sonucu BUGÜNKÜ TS protokolüyle aynı (bayat vektör yok)",
    dosya.kayitlar.length >= 120 && farklar.length === 0,
    farklar.length ? `${farklar.length} fark — ${farkOzeti(farklar)} · yeniden üret: --vektor-yaz --yalniz-v2` : `${dosya.kayitlar.length} kayıt`,
  );
  const turler = new Set(dosya.kayitlar.map((k) => k.vektor.tur));
  const eksikTur = V2_TUM_TURLER.filter((t) => !turler.has(t));
  check("§2''c her v2 ailesi dosyada (11 tür)", eksikTur.length === 0, eksikTur.join(", ") || `${turler.size} tür`);
  const tekYonlu = v2TekYonluTurler(dosya.kayitlar);
  check("§2''d her sonuç türünde hem GEÇER hem KALIR kayıt", tekYonlu.length === 0, tekYonlu.join(", ") || `${V2_SONUC_TURLERI.length} tür`);
  const kodlar = new Set(dosya.kayitlar.map((k) => z.object({ code: z.string() }).safeParse(k.beklenen).data?.code).filter((c): c is string => !!c));
  const eksikKod = V2_YENI_KODLAR.filter((c) => !kodlar.has(c));
  check("§2''e yeni protokol kodlarının her biri en az bir beklenende", eksikKod.length === 0, eksikKod.join(", ") || `${kodlar.size} kod`);
  const karar = (kural: string) => new Set(dosya.kayitlar.filter((k) => k.vektor.tur === "parmakIziKarar" && JSON.stringify(k.beklenen).includes(`"rule":"${kural}"`)).map((k) => z.object({ result: z.string() }).safeParse(k.beklenen).data?.result));
  check("§2''f parmak izi: standart kuralda ESLESTI+ESLESMEDI, zayıf kuralda üç sonuç, v1 satırları da var", karar("standart").size === 2 && karar("zayif").size === 3 && karar("v1").size >= 2);
  const kipli = dosya.kayitlar.filter((k) => "kip" in k.vektor && k.vektor.kip !== undefined);
  const kipler = new Set(kipli.map((k) => ("kip" in k.vektor ? k.vektor.kip : undefined)));
  check(
    "§2''g gömülü çapa v2 vektörleri yalnız tanınan kipte (üretim) kayıtlı",
    kipli.length >= 2 && kipler.size === TRUST_ANCHOR_MODES.length && [...kipler].every((k) => isTrustAnchorMode(k)),
    `${kipli.length} kayıt`,
  );
  const cekirdek = v2CekirdekKayitlari(dosya.kayitlar);
  const cekirdekFark = v2CekirdekFarklari(tsLicenseCore, cekirdek);
  check(
    "§2''h ⭐ TS ÇEKİRDEĞİ (LicenseCore v2: iptal · nowMs · kural · tanıma · öğrenme · ufuk) her çekirdek vektöründe protokolle aynı",
    cekirdek.length >= 120 && cekirdekFark.length === 0,
    cekirdekFark.length ? `${cekirdekFark.length} fark — ${farkOzeti(cekirdekFark)}` : `${cekirdek.length} vektör (${dosya.kayitlar.length - cekirdek.length} istek kaydı çekirdek dışı)`,
  );
}

/** `anchor.rs`te kipin blok adları; çapa tek kip olduğundan bloklar `cfg` kapısızdır (kapı = ikinci kip izi). */
const RS_BLOKLAR: Readonly<Record<TrustAnchorMode, { readonly kok: string; readonly paket: string }>> = {
  uretim: { kok: "PRODUCTION_ROOTS", paket: "PRODUCTION_PACKAGE_KEYS" },
};

interface RsBlok<T> {
  readonly ogeler: T[];
  /** Bloğun hemen önündeki `#[cfg(...)]` satırı (yoksa null). */
  readonly kapi: string | null;
}

/**
 * `anchor.rs`teki bir çapa bloğu; rustfmt düzeninden BAĞIMSIZ (tek satır · `=` sonrası · dikey). İkinci anahtar
 * rustfmt'i `&[`i alt satıra taşımaya iter — düzene bağlı desen o gün çapayı "yok" okurdu (§8h).
 */
function rsBlok<T>(anchor: string, ad: string, tur: "kok" | "paket", uret: (m: RegExpMatchArray) => T): RsBlok<T> | null {
  const tip = tur === "kok" ? "&\\[\\(&str, &str, &\\[&str\\]\\)\\]" : "&\\[\\(&str, &str\\)\\]";
  const b = new RegExp(`(#\\[cfg\\([^\\n]*\\)\\]\\n)?pub const ${ad}: ${tip} =\\s*&\\[([\\s\\S]*?)\\];`).exec(anchor);
  if (!b) return null;
  const oge = tur === "kok" ? /\("([^"]+)", "([^"]+)", &\[([^\]]*)\]\)/g : /\("([^"]+)", "([^"]+)"\)/g;
  return { ogeler: [...b[2].matchAll(oge)].map(uret), kapi: b[1]?.trim() ?? null };
}

const rsKok = (m: RegExpMatchArray) => ({ kid: m[1], x: m[2], classes: [...m[3].matchAll(/"([^"]+)"/g)].map((c) => c[1]) });
const rsPaket = (m: RegExpMatchArray) => ({ kid: m[1], x: m[2] });

/** Gömülü çapanın kip blokları (kip → kök + PAKET); bulunamayan blok null. */
export function gomuluCapa(anchor: string): Record<TrustAnchorMode, { kok: RsBlok<ReturnType<typeof rsKok>> | null; paket: RsBlok<ReturnType<typeof rsPaket>> | null }> {
  const kip = (k: TrustAnchorMode) => ({ kok: rsBlok(anchor, RS_BLOKLAR[k].kok, "kok", rsKok), paket: rsBlok(anchor, RS_BLOKLAR[k].paket, "paket", rsPaket) });
  return Object.fromEntries(TRUST_ANCHOR_MODES.map((k) => [k, kip(k)])) as ReturnType<typeof gomuluCapa>;
}

/** `anchor.rs` kip sabitleri: MODE tek kipin adı, gömülü çapa fonksiyonları doğrudan kipin bloklarını okur. */
function kipBaglari(anchor: string): string[] {
  const eksik: string[] = [];
  for (const k of TRUST_ANCHOR_MODES) {
    const { kok, paket } = RS_BLOKLAR[k];
    const beklenen = [`pub const MODE: &str = "${k}";`, `    ${kok}\n        .iter()`, `    ${paket}.iter()`];
    for (const b of beklenen) if (!anchor.includes(b)) eksik.push(b.replace(/\n\s*/, " "));
  }
  if (/hazirlik-capasi|cfg\(feature/.test(anchor)) eksik.push("anchor.rs'te özellik kapısı (`cfg(feature …)` / `hazirlik-capasi`) var");
  return eksik;
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
  const rustYollar = rustDizgeListesi(rustKaynak("paths.rs"), "PATHS");
  check(
    "§0d' parmak izi yol tablosu (platform · etken · tür · kimlik, öncelik sırası) TS = Rust satır satır",
    FINGERPRINT_PATH_LINES.length >= 25 && jsonEsit(rustYollar, [...FINGERPRINT_PATH_LINES]),
    rustYollar ? `${FINGERPRINT_PATH_LINES.length} yol` : "paths.rs PATHS bulunamadı",
  );
  const sondaYollari = new Set([...WINDOWS_PROBE_LINES.join("\n").matchAll(/Tk(?:Val|Err) '([a-z0-9.-]+)'/g)].map((m) => m[1]));
  const tabloWin = FINGERPRINT_PATH_LINES.filter((l) => l.startsWith("win32|")).map((l) => l.split("|")[3]);
  check(
    "§0d'' Windows sondası tablodaki HER win32 yolunu basar, tabloda olmayan yol basmaz",
    tabloWin.length > 0 && jsonEsit([...sondaYollari].sort(), [...tabloWin].sort()),
    `${sondaYollari.size} yol sondada · ${tabloWin.length} tabloda`,
  );

  const anchor = rustKaynak("anchor.rs");
  const capa = gomuluCapa(anchor);
  for (const kip of TRUST_ANCHOR_MODES) {
    const tsKokler = rootPublicKeysFor(kip).map((r) => ({ kid: r.kid, x: r.x, classes: [...r.classes] }));
    const tsPaket = packagePublicKeysFor(kip).map((k) => ({ kid: k.kid, x: k.x }));
    const { kok, paket } = capa[kip];
    check(`§0e gömülü ${kip} kök çapası (${RS_BLOKLAR[kip].kok}) = TS ${kip} listesi`, !!kok && tsKokler.length > 0 && jsonEsit(kok.ogeler, tsKokler), `${tsKokler.length} kök`);
    check(`§0e' gömülü ${kip} PAKET çapası (${RS_BLOKLAR[kip].paket}) = TS ${kip} listesi`, !!paket && tsPaket.length > 0 && jsonEsit(paket.ogeler, tsPaket), `${tsPaket.length} anahtar`);
    check(
      `§0e'' ⭐ ${kip} blokları cfg kapısız (tek kip — özellikle seçilen ikinci çapa yok)`,
      !!kok && !!paket && kok.kapi === null && paket.kapi === null,
      `kök ${kok?.kapi ?? "kapısız"} · PAKET ${paket?.kapi ?? "kapısız"}`,
    );
  }
  const baglar = kipBaglari(anchor);
  check("§0e''' kip sabitleri: MODE = uretim · gömülü kök/PAKET fonksiyonları üretim bloklarını okur · özellik kapısı yok", baglar.length === 0, baglar.join(" | ") || `${TRUST_ANCHOR_MODES.length * 3} bağ`);

  const abi = /pub const ABI: u32 = (\d+);/.exec(rustKaynak("api.rs"));
  check("§0f arayüz sürümü Rust = NATIVE_ABI", Number(abi?.[1]) === NATIVE_ABI, `rust ${abi?.[1]} · ts ${NATIVE_ABI}`);
  const hkdf = /pub const HKDF_INFO_PREFIX: &str = "([^"]+)";/.exec(rustKaynak("module_key.rs"));
  check("§0g modül anahtarı HKDF öneki aynı", hkdf?.[1] === MODULE_KEY_HKDF_PREFIX, hkdf?.[1] ?? "yok");
  const kidOnek = /pub const KID_PREFIX: &str = "([^"]+)";/.exec(rustKaynak("module_key.rs"));
  check("§0g' modül anahtarı kimlik öneki aynı (Faz 2d)", kidOnek?.[1] === MODULE_KEY_KID_PREFIX, kidOnek?.[1] ?? "yok");

  const rustDosyalar = ["jws.rs", "schema.rs", "chain.rs", "iso.rs", "integrity.rs", "integrity_list.rs", "module_key.rs", "paket_zinciri.rs"].map(rustKaynak);
  const tsKaynaklar = [
    "src/lib/license/protocol/belgeler.ts",
    "src/lib/license/protocol/jws.ts",
    "src/lib/license/protocol/anahtar-zinciri.ts",
    "src/lib/license/protocol/parmak-izi.ts",
    "src/lib/license/protocol/paket-zinciri.ts",
    "src/lib/license/integrity.ts",
    "src/lib/license/integrity-list.ts",
  ].map((p) => oku(path.join(TEKS, p)));
  const zodDesenleri = [z.iso.datetime()._zod.def.pattern?.source, z.uuid()._zod.def.pattern?.source].filter((s): s is string => !!s);
  const tsKume = new Set([...tsKaynaklar.flatMap(tsDesenleri), ...zodDesenleri].map(desenNormal));
  const rust = rustDesenleri(rustDosyalar);
  const yetim = rust.filter((d) => !tsKume.has(desenNormal(d)));
  check("§0h Rust'taki HER regex TS kaynağında ya da canlı Zod deseninde birebir", rust.length >= 12 && yetim.length === 0, yetim.length ? `yetim: ${yetim.join(" · ")}` : `${rust.length} desen`);
  check("§0i derleme sabiti geliştirmede KAPALI (native zorunlu değil)", NATIVE_REQUIRED === false);
  check(
    "§0i' çapa kipi sabiti geliştirmede TANIMSIZ → üretim; derlemenin çapası üretim listeleri (hazırlık yok)",
    BUILD_ANCHOR_MODE === "uretim" && ROOT_PUBLIC_KEYS === PRODUCTION_ROOT_PUBLIC_KEYS && PACKAGE_PUBLIC_KEYS === PRODUCTION_PACKAGE_PUBLIC_KEYS,
    `${BUILD_ANCHOR_MODE} · ${ROOT_PUBLIC_KEYS.map((r) => r.kid).join(",")} · ${PACKAGE_PUBLIC_KEYS.map((k) => k.kid).join(",")}`,
  );
  check(
    "§0i'' ⭐ TS çapası TEK kip: TRUST_ANCHOR_MODES = [uretim], protokol ve bütünlük modülünde hazırlık listesi (STAGING_*) YOK",
    jsonEsit([...TRUST_ANCHOR_MODES], ["uretim"]) && !("STAGING_ROOT_PUBLIC_KEYS" in protokolModulu) && !("STAGING_PACKAGE_PUBLIC_KEYS" in butunlukModulu),
    TRUST_ANCHOR_MODES.join(","),
  );

  const yollar = rustDosyaYollari().sort();
  // Crate kökü (`lib.rs`) her crate'te vardır ve adıyla okunmaz; tekillik modül dosyaları içindir.
  const adlar = yollar.map((y) => path.basename(y)).filter((a) => a !== "lib.rs");
  const tekrarli = adlar.filter((a, i) => adlar.indexOf(a) !== i);
  check("§0l Rust modül dosya adları iki crate'te tekil (lisans-cekirdek · tekserp-dogrulama)", adlar.length >= 15 && tekrarli.length === 0, tekrarli.join(",") || `${adlar.length} dosya`);
  const capaX = [...PRODUCTION_ROOT_PUBLIC_KEYS, ...PRODUCTION_PACKAGE_PUBLIC_KEYS].map((k) => k.x);
  const ortakCapa = rustKaynak("anchor.rs");
  const kopyalar = capaKopyalari(path.join(TEKS, "native"), capaX);
  check(
    "§0m ⭐ çapa TEK KAYNAK: kök + PAKET listelerinin açık anahtarları native ağacında yalnız `tekserp-dogrulama/src/anchor.rs`te (güncelleyici/çekirdek kopyası yok)",
    capaX.length >= 2 && capaX.every((x) => ortakCapa.includes(x)) && kopyalar.length === 0,
    kopyalar.length ? `kopya: ${kopyalar.join(" · ")}` : `${capaX.length} anahtar`,
  );
  const tumRust = yollar.map(oku);
  const rustTyp = rustTypSabitleri(tumRust);
  const typFark = typFarklari(rustTyp, TYP);
  const rustTypAdlari = new Set(rustTyp.map(([ad]) => ad));
  const gereken = ["HAK", "KIRA", "SERTIFIKA", "BUTUNLUK"].filter((ad) => !rustTypAdlari.has(ad));
  check("§0j Rust'taki HER belge türü (TYP_*) protokolün TYP kayıt defterinde aynı ad ve değerle", typFark.length === 0 && gereken.length === 0, typFark.join(" · ") || (gereken.length ? `Rust'ta yok: ${gereken.join(",")}` : `${rustTyp.length} tür`));
  check("§0j' TS bütünlük türü kayıt defterinden (INTEGRITY_TYP = TYP.BUTUNLUK)", INTEGRITY_TYP === TYP.BUTUNLUK, INTEGRITY_TYP);
  const liste = rustKaynak("integrity_list.rs");
  const rustListeDosyasi = /pub const LIST_FILE: &str = "([^"]+)";/.exec(liste)?.[1];
  const rustAzami = /pub const MAX_FILES: usize = ([0-9_]+);/.exec(liste)?.[1]?.replace(/_/g, "");
  const rustAzamiBayt = /pub const MAX_LIST_BYTES: u64 = ([0-9 *]+);/.exec(liste)?.[1];
  const bayt = rustAzamiBayt ? rustAzamiBayt.split("*").reduce((a, x) => a * Number(x.trim()), 1) : NaN;
  check(
    "§0k liste dosyası sabitleri Rust = TS (ad · azami satır · azami bayt)",
    rustListeDosyasi === INTEGRITY_LIST_FILE && Number(rustAzami) === INTEGRITY_MAX_FILES && bayt === INTEGRITY_MAX_LIST_BYTES,
    `rust ${rustListeDosyasi} ${rustAzami} ${bayt}`,
  );
  const v2Fark = v2SabitFarklari(rustKaynak);
  check("§0l lisans v2 sabitleri Rust = TS (kullanımlar · iptal kullanımları · kapanış · kurallar · güçlü etkenler · ufuk · iptal tavanı · PAKET toleransı · eşikler)", v2Fark.length === 0, v2Fark.join(" | ") || "14 sabit");
}

/**
 * §1j (L2-6, G12 §3.3): native ÇAĞRISI istisna atarsa (panic → JS istisnası) sonuç "çekirdek yok"tur — doğrulamalar
 * CEKIRDEK_YOK, bütünlük GEÇERSİZ, saf kararlar sıkılaşır; istisna yukarı SIZMAZ (süreç düşmez).
 */
async function bolum1Istisna(): Promise<void> {
  console.log("\n§1j native çağrı istisnası → çekirdek yok (sızmaz)");
  const patla = (): never => {
    throw new Error("native panic");
  };
  const ad = ["kunye", "builtinAnchor", "verifyJws", "verifyCertificate", "verifyEntitlement", "verifyLease", "checkLeaseBinding", "verifyRevocation", "pickNewerRevocation", "isRevocationCurrent", "compareFingerprints", "assessIdentification", "canAutoLearnFingerprint", "offlineHorizonCeilingDays", "normalizeFactor", "digestFingerprint", "unwrapModuleKey", "unwrapLeaseModuleKey", "protectLocal", "unprotectLocal", "collectFingerprint", "verifyIntegrity"];
  const sahte = Object.fromEntries(ad.map((n) => [n, n === "verifyIntegrity" || n === "collectFingerprint" ? async () => patla() : patla])) as unknown as NativeBinding;
  const c = nativeCore(sahte);
  let sizdi: string | null = null;
  const dene = async (n: string, f: () => unknown): Promise<unknown> => {
    try {
      return await f();
    } catch {
      sizdi = n;
      return null;
    }
  };
  const sonuclar = [
    await dene("verifyEntitlement", () => c.verifyEntitlement("a.b.c")),
    await dene("verifyLease", () => c.verifyLease("a.b.c")),
    await dene("checkLeaseBinding", () => c.checkLeaseBinding("a.b.c", "a.b.c")),
    await dene("verifyRevocation", () => c.verifyRevocation("a.b.c")),
    await dene("unwrapModuleKey", () => c.unwrapModuleKey({}, "x", "finance.enabled")),
  ] as Array<{ ok: boolean; code?: string } | null>;
  const butunluk = (await dene("verifyIntegrity", () => c.verifyIntegrity("a.b.c", tmpdir()))) as { ok: boolean; value?: { durum: string } } | null;
  const karar = (await dene("compareFingerprints", () => c.compareFingerprints({ f1: null, f2: null, f3: null, f4: null, f5: null }, { f1: null, f2: null, f3: null, f4: null, f5: null }, { rule: "standart" }))) as { result: string } | null;
  const normal = await dene("normalizeFactor", () => c.normalizeFactor("f1", "abc"));
  check(
    "§1j ⭐ native istisnası SIZMAZ: belge doğrulamaları CEKIRDEK_YOK, bütünlük GEÇERSİZ, parmak izi kararı ÖLÇÜLEMEDİ, normalleştirme null",
    sizdi === null && sonuclar.every((r) => r !== null && !r.ok && r.code === CORE_UNAVAILABLE_CODE) && butunluk?.ok === true && butunluk.value?.durum === "GECERSIZ" && karar?.result === "OLCULEMEDI" && normal === null,
    sizdi ? `sızdı: ${sizdi}` : JSON.stringify(sonuclar.map((r) => r?.code)),
  );
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

    const id = { abi: NATIVE_ABI, platform: process.platform, arch: process.arch, testCapasi: false, capaKipi: "uretim" as const };
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

    const islev = () => "";
    const v1Islevleri = ["kunye", "builtinAnchor", "verifyJws", "verifyCertificate", "verifyEntitlement", "verifyLease", "checkLeaseBinding", "normalizeFactor", "digestFingerprint", "unwrapModuleKey", "unwrapLeaseModuleKey", "protectLocal", "unprotectLocal", "collectFingerprint", "verifyIntegrity"];
    const v2Islevleri = ["verifyRevocation", "pickNewerRevocation", "isRevocationCurrent", "compareFingerprints", "assessIdentification", "canAutoLearnFingerprint", "offlineHorizonCeilingDays"];
    const bagla = (adlar: readonly string[]) => Object.fromEntries(adlar.map((a) => [a, islev]));
    check(
      "§1h ⭐ lisans v2 işlevlerini taşımayan eski ABI-3 ikilisi bağlama sayılmaz (yükleyici YUKLENEMEDI), tam küme sayılır",
      !isNativeBinding(bagla(v1Islevleri)) && isNativeBinding(bagla([...v1Islevleri, ...v2Islevleri])) && v2Islevleri.every((a) => !isNativeBinding(bagla([...v1Islevleri, ...v2Islevleri.filter((x) => x !== a)]))),
      `${v2Islevleri.length} v2 işlevi`,
    );

    const kunyeTam = {
      ad: "lisans-cekirdek", surum: "0.1.0", abi: NATIVE_ABI, platform: process.platform, arch: process.arch, hedef: "x", profil: "release",
      testCapasi: true, capaKipi: "uretim", protokolKodlari: [], cekirdekKodlari: [], yerTutucular: [], windowsSondasi: [...WINDOWS_PROBE_LINES],
      parmakIziYollari: [...FINGERPRINT_PATH_LINES], modulHkdfOneki: "x", modulKidOneki: "x", korumaEntropisi: "x",
    };
    const { parmakIziYollari: _yollar, ...kunyeEski } = kunyeTam;
    check(
      "§1i ⭐ parmak izi yol tablosunu künyesinde taşımayan eski ABI-3 ikilisi açılmaz (künye sözleşme dışı → YUKLENEMEDI), tam künye açılır",
      parseNativeIdentity(JSON.stringify(kunyeEski)) === null && parseNativeIdentity(JSON.stringify(kunyeTam)) !== null,
    );
    check(
      "§1g' ⭐ çapa kipi tek: eski hazırlık çapalı ikilinin künyesi (capaKipi hazirlik) sözleşme dışı → açılmaz; üretim künyesi açılır ve aynı kipte kabul",
      parseNativeIdentity(JSON.stringify({ ...kunyeTam, capaKipi: "hazirlik" })) === null &&
        parseNativeIdentity(JSON.stringify(kunyeTam))?.capaKipi === "uretim" &&
        identityRejection({ ...id, capaKipi: "uretim" }, gelistirme) === null,
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

/** PAKET zinciri vektörlerinin (`test_paket_zinciri` üretir, Rust `tekserp-dogrulama/tests/paket_zinciri.rs` okur) kodları. */
function paketZinciriKodlari(): string[] {
  const yol = path.join(TEKS, "native", "test-vektorleri", "paket-zinciri.json");
  if (!existsSync(yol)) return [];
  const d = JSON.parse(oku(yol)) as { kayitlar?: { beklenen?: { ok?: boolean; code?: string } }[] };
  return (d.kayitlar ?? []).flatMap((k) => (k.beklenen?.ok === false && k.beklenen.code ? [k.beklenen.code] : []));
}

/** v2 beklenenlerinde geçen hata kodları (`{ok:false, code}`). */
function v2BeklenenKodlar(kayitlar: readonly VektorV2Kaydi[]): Set<string> {
  const R = z.object({ ok: z.literal(false), code: z.string() });
  return new Set(kayitlar.flatMap((k) => R.safeParse(k.beklenen).data?.code ?? []));
}

async function bolum2(dosya: VektorDosyasi | null, dosyaV2: VektorV2Dosyasi | null): Promise<void> {
  console.log("\n§2 vektör dosyası ↔ TS kâhini");
  check("§2a vektör dosyası var ve biçimi güncel", !!dosya && dosya.bicim === VEKTOR_BICIMI, path.relative(TEKS, VEKTOR_DOSYASI));
  if (!dosya) return;
  const farklar = await kayitlariKarsilastir(tsLicenseCore, dosya.kayitlar);
  check(
    "§2b her kaydın beklenen sonucu BUGÜNKÜ TS protokolüyle aynı (bayat vektör yok)",
    dosya.kayitlar.length >= 200 && farklar.length === 0,
    farklar.length ? `${farklar.length} fark — ${farkOzeti(farklar)} · yeniden üret: --vektor-yaz` : `${dosya.kayitlar.length} kayıt`,
  );
  const kodlar = new Set([...beklenenKodlar(dosya.kayitlar), ...v2BeklenenKodlar(dosyaV2?.kayitlar ?? []), ...paketZinciriKodlari()]);
  const eksik = kapsamGereken().filter((c) => !kodlar.has(c));
  check("§2c native'in üretebildiği her kod en az bir beklenende geçiyor (v1 ∪ v2 ∪ paket-zinciri.json)", eksik.length === 0, eksik.length ? `eksik: ${eksik.join(", ")}` : `${kodlar.size} kod`);
  const turler = ["jws", "sertifika", "hak", "kira", "bag", "modul"] as const;
  const eksikTur = turler.filter((t) => {
    const k = dosya.kayitlar.filter((x) => x.vektor.tur === t);
    const gecen = k.filter((x) => jsonEsit(z.object({ ok: z.boolean() }).safeParse(x.beklenen).data?.ok, true)).length;
    return gecen === 0 || gecen === k.length;
  });
  check("§2d her doğrulama türünde hem GEÇER hem KALIR vektör var", eksikTur.length === 0, eksikTur.join(", ") || "6 tür");

  // Gömülü çapa vektörleri: her biri tanınan bir kip (üretim) taşır; eski hazırlık kipli kayıt kalmadı.
  const gomulu = dosya.kayitlar.filter((k) => gomuluMu(k.vektor));
  const kipsiz = gomulu.filter((k) => !("kip" in k.vektor) || !isTrustAnchorMode(k.vektor.kip));
  const kipli = (kip: TrustAnchorMode) =>
    new Map(gomulu.filter((k) => "kip" in k.vektor && k.vektor.kip === kip).map((k) => [`${k.vektor.tur} · ${k.vektor.ad.replace(/ \[[a-z]+\]$/, "")}`, k.beklenen]));
  const u = kipli("uretim");
  check("§2e her gömülü çapa vektörü tanınan kip (üretim) taşır", kipsiz.length === 0 && u.size >= 8, `${kipsiz.length} kipsiz/tanınmayan kipli · üretim ${u.size}`);
  const kod = (b: unknown): string | undefined => {
    const r = z.object({ ok: z.literal(false), code: z.string() }).safeParse(b);
    if (r.success) return r.data.code;
    return z.object({ ok: z.literal(true), value: z.object({ kod: z.string().nullable() }) }).safeParse(b).data?.value.kod ?? undefined;
  };
  // Üretim kid'i tanınır ama imza yabancı (JWS_IMZA); eski hazırlık kid'i HİÇ tanınmaz — emekli hazırlık
  // anahtarının sahibi bile üretim derlemesine belge geçiremez.
  const beklenenler: ReadonlyArray<readonly [string, string]> = [
    ["hak · gömülü çapa: eski hazırlık kökü kid'iyle TEST HAK, yabancı imza", "KOK_BILINMIYOR"],
    ["hak · gömülü çapa: üretim kökü kid'iyle ÜRETİM HAK, yabancı imza", "JWS_IMZA"],
    ["sertifika · gömülü çapa: eski hazırlık kökü kid'i, yabancı imza", "KOK_BILINMIYOR"],
    ["sertifika · gömülü çapa: üretim kökü kid'i, yabancı imza", "JWS_IMZA"],
    ["kira · gömülü çapa: alt sertifikası eski hazırlık kökü kid'li, yabancı imza", "KOK_BILINMIYOR"],
    ["butunluk · gömülü çapa: eski hazırlık PAKET kid'i, yabancı imza", "JWS_KID"],
    ["butunluk · gömülü çapa: üretim PAKET kid'i, yabancı imza", "JWS_IMZA"],
  ];
  const sapan = beklenenler.filter(([ad, uk]) => kod(u.get(ad)) !== uk).map(([ad, uk]) => `${ad}: üretim ${kod(u.get(ad))} (beklenen ${uk})`);
  check(
    "§2f ⭐ üretim kipinde eski hazırlık kid'i tanınmaz (KOK_BILINMIYOR/JWS_KID); üretim kid'iyle yabancı imza yalnız imzada düşer",
    sapan.length === 0,
    sapan.join(" | ") || `${beklenenler.length} çift`,
  );
}

/** Gömülü çapayla koşan vektör (`roots`/`keys` null). */
function gomuluMu(v: Vektor): boolean {
  if (v.tur === "butunluk") return v.keys === null;
  return (v.tur === "sertifika" || v.tur === "hak" || v.tur === "kira" || v.tur === "bag" || v.tur === "kiraModul") && v.roots === null;
}

/** Native adayının gömülü çapa kipi (açılamazsa ya da eski ABI ise undefined; yükleyici zaten reddeder). */
function adayKipi(o: LoaderOptions): TrustAnchorMode | undefined {
  const dosya = nativeCandidates(o).find((f) => existsSync(f));
  if (!dosya) return undefined;
  try {
    const kip = (nativeBuiltinAnchor(dosya) as { kip?: unknown }).kip;
    return isTrustAnchorMode(kip) ? kip : undefined;
  } catch {
    return undefined;
  }
}

/** Dizin adının söylediği kip — derleme betiği `--uretim`i `dist-uretim/`e yazar. */
const DIZIN_KIPI: Readonly<Record<string, TrustAnchorMode>> = { "dist-uretim": "uretim" };

function tsCapasi(kip: TrustAnchorMode): unknown {
  return {
    kip,
    roots: rootPublicKeysFor(kip).map((r) => ({ kid: r.kid, x: r.x, classes: [...r.classes] })),
    packageKeys: packagePublicKeysFor(kip).map((k) => ({ kid: k.kid, x: k.x })),
  };
}

async function bolum3ile7(dosya: VektorDosyasi | null, dosyaV2: VektorV2Dosyasi | null): Promise<void> {
  // Kâhin hangi kipte derlenmiş native verilirse onu sınar: beklenen kip adayın kendi künyesinden.
  const secenek0: LoaderOptions = { required: false, cwd: TEKS, env: process.env, platform: process.platform, arch: process.arch };
  const yukle = loadLicenseCoreFrom({ ...secenek0, anchorMode: adayKipi(secenek0) });
  const canliSayi = vektorleriKur(VEKTOR_SIMDI).filter((v) => v.tur !== "tarih").length;
  const kayitSayi = (dosya?.kayitlar.filter((k) => k.vektor.tur !== "tarih").length ?? 0) + v2CekirdekKayitlari(dosyaV2?.kayitlar ?? []).length;
  const canliV2Sayi = v2CekirdekKayitlari(vektorleriKurV2(VEKTOR_SIMDI).map((vektor) => ({ vektor, beklenen: null }))).length;
  if (yukle.status.kaynak !== "native") {
    const neden = "neden" in yukle.status ? `${yukle.status.neden}: ${yukle.status.ayrinti}` : "";
    const denenen = yukle.status.kaynak === "ts" ? yukle.status.denenen.map((d) => path.relative(TEKS, d)).join(" · ") : "";
    // Adet = koşmayan KONTROL (§3a §3b §3d §4a §4b §5a §5b §6a §6b §7a); kıyaslanmayan vektörler gerekçede. Canlı çapa
    // (§3d) ÖLÇÜLMEDİ sayılır — yeşil değil: kaynak metin (§0e) güncel olsa da derlenmiş ikili bayat olabilir.
    ATLAMA.atla(
      "native yok: §3–§7 native karşılaştırması (§3d canlı çapa ÖLÇÜLMEDİ)",
      `${process.platform}-${process.arch}; ${neden}; denenen: ${denenen} — ${kayitSayi} kayıtlı + ${canliSayi + canliV2Sayi} canlı vektör kıyaslanmadı; derle: cd native/lisans-cekirdek && npm run derle`,
      10,
    );
    return;
  }
  const native = yukle.core;
  const kunye = yukle.status.kunye;
  console.log(`\n§3 native künyesi — ${path.relative(TEKS, yukle.status.dosya)} · ${kunye.hedef} · ${kunye.profil} · test çapası ${kunye.testCapasi ? "VAR" : "yok"} · çapa ${kunye.capaKipi}`);
  check("§3a künye: arayüz sürümü + platform + mimari bu süreçle aynı", kunye.abi === NATIVE_ABI && kunye.platform === process.platform && kunye.arch === process.arch);
  check(
    "§3b canlı ayna listeleri TS ile aynı (kodlar · yer tutucular · Windows sondası · parmak izi yol tablosu · HKDF öneki)",
    kunye.protokolKodlari.every((c) => (PROTOCOL_ERROR_CODES as readonly string[]).includes(c)) &&
      jsonEsit(kunye.cekirdekKodlari, [...CORE_ERROR_CODES]) &&
      jsonEsit(kunye.windowsSondasi, [...WINDOWS_PROBE_LINES]) &&
      jsonEsit(kunye.parmakIziYollari, [...FINGERPRINT_PATH_LINES]) &&
      kunye.modulHkdfOneki === MODULE_KEY_HKDF_PREFIX &&
      kunye.modulKidOneki === MODULE_KEY_KID_PREFIX,
  );
  // §3d CANLI çapa: yüklenen ikili + geliştirme dizinlerindeki öteki derlemeler (test çapalı `dist` · üretim `dist-uretim` ·
  // paket yolu) — hangisi varsa hepsi, her biri KENDİ kipinin TS çapasıyla; kip dizinle tutmalı.
  const dosyaAdi = nativeFileName(process.platform, process.arch) ?? "";
  const derlemeler = [
    ...new Set([
      yukle.status.dosya,
      ...["dist", "dist-uretim"].map((d) => path.join(NATIVE_DIZIN, d, dosyaAdi)),
      path.join(TEKS, "native", dosyaAdi),
    ]),
  ].filter((f) => existsSync(f));
  const capaFarki = derlemeler.flatMap((f) => {
    try {
      const canli = nativeBuiltinAnchor(f) as { kip?: unknown };
      const kip = isTrustAnchorMode(canli.kip) ? canli.kip : null;
      if (!kip) return [`${path.relative(TEKS, f)} çapa kipi taşımıyor (eski ABI?)`];
      const dizinKipi = DIZIN_KIPI[path.basename(path.dirname(f))];
      if (dizinKipi && dizinKipi !== kip) return [`${path.relative(TEKS, f)} ${kip} çapalı, dizini ${dizinKipi} ister`];
      return jsonEsit(canli, tsCapasi(kip)) ? [] : [`${path.relative(TEKS, f)} → ${JSON.stringify(canli).slice(0, 160)}`];
    } catch (e) {
      return [`${path.relative(TEKS, f)} açılamadı: ${e instanceof Error ? e.message : String(e)}`];
    }
  });
  check(
    "§3d ⭐ CANLI çapa: derlenmiş her .node'un builtinAnchor() = KENDİ kipinin TS kök + PAKET listeleri (birebir), kip dizinle tutarlı",
    derlemeler.length >= 1 && capaFarki.length === 0,
    capaFarki.length ? `BAYAT/AYRIŞIK (yeniden derle: npm run derle · derle:uretim): ${capaFarki.join(" | ")}` : derlemeler.map((f) => path.relative(TEKS, f)).join(" · "),
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
    const r = native.verifyEntitlement("a.b.c", rootPublicKeysFor(kunye.capaKipi));
    check("§7b üretim derlemesi dışarıdan çapayı reddeder (CAPA_ENJEKSIYONU_KAPALI)", !r.ok && r.code === "CAPA_ENJEKSIYONU_KAPALI");
    const g = native.verifyEntitlement("a.b.c");
    check("§7c üretim derlemesi gömülü çapayla doğrular (çapasız çağrı JWS katmanına iner)", !g.ok && g.code === "JWS_BICIM");
    ATLAMA.atla(
      "§4–§5 vektör kıyası",
      `yüklenen native üretim derlemesi (test çapası yok) — ${kayitSayi} kayıtlı + ${canliSayi + canliV2Sayi} canlı vektör kıyaslanmadı; kıyas için \`npm run derle\` (test-anchor)`,
      4,
    );
    return;
  }

  console.log(`\n§4 kayıtlı vektörler native'de (${kunye.capaKipi} kipinin gömülü çapa kayıtları dahil)`);
  if (dosya) {
    const kayitlar = dosya.kayitlar.filter((k) => k.vektor.tur !== "tarih" && kipteKosar(k.vektor, kunye.capaKipi));
    const farklar = await kayitlariKarsilastir(native, kayitlar);
    check("§4a her kayıtlı vektörde native = beklenen (TS kâhini)", farklar.length === 0, farklar.length ? `${farklar.length} fark — ${farkOzeti(farklar)}` : `${kayitlar.length} vektör`);
  }
  const kayitlarV2 = v2CekirdekKayitlari(dosyaV2?.kayitlar ?? [], kunye.capaKipi);
  const farklarV2 = v2CekirdekFarklari(native, kayitlarV2);
  check(
    "§4b ⭐ her kayıtlı LİSANS v2 vektöründe native = beklenen (ara zincir · iptal · ufuk · veriliş · bayt bağı · parmak izi v2)",
    kayitlarV2.length >= 120 && farklarV2.length === 0,
    farklarV2.length ? `${farklarV2.length} fark — ${farkOzeti(farklarV2)}` : `${kayitlarV2.length} vektör`,
  );

  console.log("\n§5 CANLI vektörler (taze anahtar, şimdi): TS = native");
  const canli = vektorleriKur(Date.now()).filter((v) => v.tur !== "tarih" && kipteKosar(v, kunye.capaKipi));
  const farklar: Fark[] = [];
  for (const v of canli) {
    const [t, n] = [await degerlendir(tsLicenseCore, v), await degerlendir(native, v)];
    if (!jsonEsit(t, n)) farklar.push({ ad: `${v.tur} · ${v.ad}`, beklenen: t, gelen: n });
  }
  check("§5a canlı vektörlerin HER birinde TS = native", farklar.length === 0, farklar.length ? `${farklar.length} fark — ${farkOzeti(farklar)}` : `${canli.length} vektör`);
  const canliV2 = v2CekirdekKayitlari(vektorleriKurV2(Date.now()).map((vektor) => ({ vektor, beklenen: null })), kunye.capaKipi);
  const farklarCanliV2: Fark[] = [];
  for (const { vektor } of canliV2) {
    const [t, n] = [degerlendirV2Cekirdek(tsLicenseCore, vektor), degerlendirV2Cekirdek(native, vektor)];
    if (!jsonEsit(t, n)) farklarCanliV2.push({ ad: `${vektor.tur} · ${vektor.ad}`, beklenen: t, gelen: n });
  }
  check(
    "§5b ⭐ CANLI lisans v2 vektörlerinin HER birinde TS çekirdeği = native",
    canliV2.length >= 120 && farklarCanliV2.length === 0,
    farklarCanliV2.length ? `${farklarCanliV2.length} fark — ${farkOzeti(farklarCanliV2)}` : `${canliV2.length} vektör`,
  );
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
  const iki = [{ kid: "paket-2026", x: "a" }, { kid: "paket-2027", x: "b" }];
  const duzenler = [
    `pub const PRODUCTION_PACKAGE_KEYS: &[(&str, &str)] = &[("paket-2026", "a")];`,
    `pub const PRODUCTION_PACKAGE_KEYS: &[(&str, &str)] =\n    &[("paket-2026", "a"), ("paket-2027", "b")];`,
    `pub const PRODUCTION_PACKAGE_KEYS: &[(&str, &str)] = &[\n    ("paket-2026", "a"),\n    ("paket-2027", "b"),\n];`,
  ].map((d) => gomuluCapa(d).uretim.paket);
  check(
    "§8h gömülü PAKET bloğu üç rustfmt düzeninde de okunur (tek satır · `=` sonrası · dikey), kapısız; blok yoksa null",
    jsonEsit(duzenler[0]?.ogeler, iki.slice(0, 1)) &&
      jsonEsit(duzenler[1]?.ogeler, iki) &&
      jsonEsit(duzenler[2]?.ogeler, iki) &&
      duzenler.every((d) => d?.kapi === null) &&
      gomuluCapa("pub const X: u8 = 1;").uretim.paket === null,
  );
  const kapili = gomuluCapa(`#[cfg(not(feature = "hazirlik-capasi"))]\npub const PRODUCTION_ROOTS: &[(&str, &str, &[&str])] = &[("kok-2026-1", "a", &["TEST"])];`).uretim.kok;
  const sahteBag = kipBaglari(`#[cfg(feature = "hazirlik-capasi")]\npub const MODE: &str = "uretim";\n    PRODUCTION_ROOTS\n        .iter()\n    PRODUCTION_PACKAGE_KEYS.iter()`);
  check(
    "§8i cfg kapılı blok kapısıyla okunur (§0e'' kırmızı sayar) · özellik kapısı taşıyan anchor.rs §0e''' kırmızı",
    kapili?.kapi === '#[cfg(not(feature = "hazirlik-capasi"))]' && kapili.ogeler.length === 1 && sahteBag.length === 1,
    sahteBag.join(" | "),
  );
  const eskiKipli = { tur: "hak", ad: "x", token: "a.b.c", roots: null, kip: "hazirlik" } as unknown as Vektor;
  check(
    "§8j kip süzgeci: tanınmayan (eski hazırlık) kipli kayıt üretimde koşmaz, üretim kipli koşar, kipsiz kayıt her kipte",
    !kipteKosar(eskiKipli, "uretim") &&
      kipteKosar({ tur: "hak", ad: "x", token: "a.b.c", roots: null, kip: "uretim" }, "uretim") &&
      kipteKosar({ tur: "hak", ad: "y", token: "a.b.c", roots: [] }, "uretim"),
  );
}

function bolum8toplama(dosya: VektorToplamaDosyasi | null): void {
  console.log("\n§8 ⭐ KALICI SONDALAR ✓K — parmak izi toplama (L2-10)");
  const sentetik = 'pub const PATHS: [&str; 2] = [\n    "a $r[1]; b",\n    "c \\" ]; d",\n];\npub const SONRAKI: [&str; 1] = ["x"];';
  check("§8o ✓K dizge listesi `];` taşıyan dizgede kesilmez, kaçışlı tırnağı aşar", jsonEsit(rustDizgeListesi(sentetik, "PATHS"), ["a $r[1]; b", 'c " ]; d']));
  if (!dosya || dosya.kayitlar.length === 0) {
    check("§8p ✓K toplama sondaları için toplama.json gerekli", false);
    return;
  }
  const ilk = dosya.kayitlar.find((k) => k.vektor.tur === "toplama") ?? dosya.kayitlar[0];
  const bozuk: VektorToplamaKaydi = { vektor: ilk.vektor, beklenen: { ...(ilk.beklenen as object), okuma: null } };
  check("§8p ✓K toplama bayatlık denetimi mutasyona uğramış beklenenle kırmızı, eşitte susar", toplamaFarklari([bozuk]).length === 1 && toplamaFarklari([ilk]).length === 0);
}

function bolum8v2(dosya: VektorV2Dosyasi | null): void {
  if (!dosya || dosya.kayitlar.length === 0) {
    check("§8k ✓K v2 sondaları için v2 dosyası gerekli", false);
    return;
  }
  const ilk = dosya.kayitlar[0];
  check("§8k ✓K v2 bayatlık denetimi mutasyona uğramış beklenenle kırmızı verir", v2Farklari([{ vektor: ilk.vektor, beklenen: { ok: false, code: "SAHTE_KOD" } }]).length === 1);
  const tekGecer = dosya.kayitlar.filter((k) => k.vektor.tur !== "bag2" || z.object({ ok: z.literal(true) }).safeParse(k.beklenen).success);
  check("§8l ✓K tek yönlü tür denetimi KALIR kaydı olmayan türü yakalar (bag2 retleri çıkarılınca)", v2TekYonluTurler(tekGecer).includes("bag2") && !v2TekYonluTurler(dosya.kayitlar).includes("bag2"));
  const karar = v2CekirdekKayitlari(dosya.kayitlar).find((k) => k.vektor.tur === "parmakIziKarar");
  const bozukKarar = karar ? { vektor: karar.vektor, beklenen: { ...(karar.beklenen as object), result: "ESLESTI_DEGIL" } } : null;
  check(
    "§8m ✓K v2 çekirdek karşılaştırıcısı mutasyona uğramış beklenenle kırmızı, eşitte susar; istek ailesi çekirdek dışı süzülür",
    !!karar && !!bozukKarar && v2CekirdekFarklari(tsLicenseCore, [bozukKarar]).length === 1 && v2CekirdekFarklari(tsLicenseCore, [karar]).length === 0 && v2CekirdekKayitlari(dosya.kayitlar).every((k) => k.vektor.tur !== "istek"),
  );
  const gercek = (d: string) => rustKaynak(d);
  const kaymis = (d: string) => (d === "schema.rs" ? gercek(d).replace("pub const OFFLINE_HORIZON_DEALER_DAYS: u32 = 400;", "pub const OFFLINE_HORIZON_DEALER_DAYS: u32 = 401;") : gercek(d));
  const eksik = (d: string) => (d === "fingerprint.rs" ? gercek(d).replace(/pub const STRONG_FACTORS/, "pub const GUCLU_ETKENLER") : gercek(d));
  check(
    "§8n ✓K v2 sabit aynası değişmiş sayıyı ve bulunamayan listeyi yakalar, eşitte susar",
    v2SabitFarklari(gercek).length === 0 && v2SabitFarklari(kaymis).length === 1 && v2SabitFarklari(eksik).length === 1,
  );
}

/**
 * §9 ÜRETİM İKİLİSİ SONDASI: gerçek üretim ikilisi (paketin taşıdığı derleme) kendi kipinin gömülü
 * çapa vektörlerini koşar; dışarıdan çapa veremediğimiz için ölçüm yalnız gömülü çapayladır — sorulan da tam olarak o.
 */
async function bolum9(dosya: VektorDosyasi | null, dosyaV2: VektorV2Dosyasi | null): Promise<void> {
  console.log("\n§9 ⭐ üretim ikilisi sondası (gerçek dist-uretim ikilisi)");
  const ad = nativeFileName(process.platform, process.arch);
  for (const kip of TRUST_ANCHOR_MODES) {
    const dizin = `dist-${kip}`;
    const ikili = ad ? path.join(NATIVE_DIZIN, dizin, ad) : null;
    if (!ikili || !existsSync(ikili) || !dosya) {
      ATLAMA.atla(`§9 ${kip} ikilisi`, `${dizin}/${ad ?? "?"} yok — derle: cd native/lisans-cekirdek && npm run derle:${kip}`, 4);
      continue;
    }
    const secenek: LoaderOptions = { required: false, cwd: TEKS, env: { [NATIVE_PATH_ENV]: ikili }, platform: process.platform, arch: process.arch };
    const y = loadLicenseCoreFrom({ ...secenek, anchorMode: kip });
    if (y.status.kaynak !== "native") {
      check(`§9a ${dizin} ikilisi yüklenir`, false, "neden" in y.status ? `${y.status.neden}: ${y.status.ayrinti}` : "");
      continue;
    }
    check(`§9a ${dizin} ikilisi ${kip} çapalı ve test çapasız`, y.status.kunye.capaKipi === kip && !y.status.kunye.testCapasi, `${y.status.kunye.capaKipi} · test ${y.status.kunye.testCapasi}`);
    const kayitlar = dosya.kayitlar.filter((k) => "kip" in k.vektor && k.vektor.kip === kip);
    const farklar = await kayitlariKarsilastir(y.core, kayitlar);
    check(
      `§9b ⭐ ${kip} ikilisi kendi kipinin ${kayitlar.length} gömülü çapa vektöründe beklenen sonucu verir (eski hazırlık kid'iyle imzalı belge TANINMAZ)`,
      kayitlar.length >= 8 && farklar.length === 0,
      farklar.length ? `${farklar.length} fark — ${farkOzeti(farklar)}` : "",
    );
    const r = y.core.verifyEntitlement("a.b.c", rootPublicKeysFor(kip));
    check(`§9c ${kip} ikilisi dışarıdan çapayı reddeder (CAPA_ENJEKSIYONU_KAPALI)`, !r.ok && r.code === "CAPA_ENJEKSIYONU_KAPALI");
    const kipliV2 = (dosyaV2?.kayitlar ?? []).filter((k) => "kip" in k.vektor && k.vektor.kip === kip);
    const farkV2 = v2CekirdekFarklari(y.core, kipliV2);
    check(
      `§9e ${kip} ikilisi kendi kipinin ${kipliV2.length} v2 gömülü çapa vektöründe (ara sertifika · iptal) beklenen sonucu verir`,
      kipliV2.length >= 2 && farkV2.length === 0,
      farkV2.length ? `${farkV2.length} fark — ${farkOzeti(farkV2)}` : "",
    );
  }
}

type KopruSonucu = { readonly ok: true } | { readonly ok: false; readonly code: string };
const kod = (r: KopruSonucu): string => (r.ok ? "ok" : r.code);

/** Köprünün kararları (fikstür belgeleriyle): iptalsiz · ARA iptali · geçmiş "şimdi" · ALT iptali (HAK'a dokunmaz) · kira. */
function kopruKararlari(core: LicenseCore): Record<string, string> {
  const f = fiksturKur(Date.now());
  const araId = randomUUID();
  const hak = araHakBas(f, {}, { sertifika: araSertifikasi(f, { sertifikaId: araId }) });
  const kira = kiraBas(f);
  const tarih = new Date(f.simdi - 86_400_000).toISOString();
  const iptalAra = iptalBas(f.kok, iptalYuku(f, { sira: 2, iptaller: [{ kid: f.ara.kid, sertifikaId: araId, kullanim: "HAK", tarih, neden: "kopru" }] }));
  const iptalAlt = iptalBas(f.kok, iptalYuku(f, { sira: 3, iptaller: [{ kid: f.alt.kid, sertifikaId: randomUUID(), kullanim: "ALT", tarih, neden: "kopru" }] }));
  return {
    hakDuz: kod(coreVerifyEntitlement(hak, f.kokler, core)),
    hakAraIptal: kod(coreVerifyEntitlement(hak, f.kokler, core, { revocation: iptalAra })),
    hakGecmisSimdi: kod(coreVerifyEntitlement(hak, f.kokler, core, { nowMs: f.simdi - 30 * 86_400_000 })),
    hakAltIptalSimdi: kod(coreVerifyEntitlement(hak, f.kokler, core, { revocation: iptalAlt, nowMs: f.simdi })),
    kiraDuz: kod(coreVerifyLease(kira, f.kokler, core)),
    kiraAltIptal: kod(coreVerifyLease(kira, f.kokler, core, { revocation: iptalAlt })),
  };
}

const KOPRU_BEKLENEN: Readonly<Record<string, string>> = {
  hakDuz: "ok",
  hakAraIptal: "SERTIFIKA_IPTAL",
  hakGecmisSimdi: "BELGE_ILERI_TARIHLI",
  hakAltIptalSimdi: "ok",
  kiraDuz: "ok",
  kiraAltIptal: "SERTIFIKA_IPTAL",
};

function bolum10kopru(): void {
  console.log("\n§10 ⭐ köprü sondası (iptal + nowMs çekirdeğe geçer; TS = native)");
  const ts = kopruKararlari(tsLicenseCore);
  check("§10a ⭐ TS çekirdeğinde köprü kararları beklenen (iptal ve şimdi geçiyor)", jsonEsit(ts, KOPRU_BEKLENEN), JSON.stringify(ts));
  const secenek0: LoaderOptions = { required: false, cwd: TEKS, env: process.env, platform: process.platform, arch: process.arch };
  const y = loadLicenseCoreFrom({ ...secenek0, anchorMode: adayKipi(secenek0) });
  if (y.status.kaynak !== "native" || !y.status.kunye.testCapasi) {
    ATLAMA.atla("§10b native köprü kolu", "test çapalı native yok — derle: cd native/lisans-cekirdek && npm run derle", 1);
    return;
  }
  const native = kopruKararlari(y.core);
  check("§10b ⭐ native çekirdekte köprü kararları TS ile AYNI (iptal + nowMs native'e geçiyor)", jsonEsit(native, ts) && jsonEsit(native, KOPRU_BEKLENEN), JSON.stringify(native));
}

/** §11 yetenek sondası: biçimsiz belgeye çekirdeğin KENDİ protokol koduyla cevap vermesi (TS = native). */
function bolum11yetenek(): void {
  console.log("\n§11 ⭐ yetenek sondası (L2-7 B): canlı çekirdek hak-ara + iptal bildirir; yok çekirdek bildirmez");
  const DORT = JSON.stringify(["hak-ara", "odenmis-tarih", "iptal", "parmak-izi-v2"]);
  const ts = JSON.stringify(capabilitiesFor(tsLicenseCore));
  const yok = JSON.stringify(capabilitiesFor(unavailableCore("kâhin")));
  check("§11a ⭐ TS çekirdeği canlı sondayı geçer (dört yetenek); kullanılamayan çekirdek yalnız ikisini", ts === DORT && yok === JSON.stringify(["odenmis-tarih", "parmak-izi-v2"]), `${ts} ${yok}`);
  const secenek0: LoaderOptions = { required: false, cwd: TEKS, env: process.env, platform: process.platform, arch: process.arch };
  const y = loadLicenseCoreFrom({ ...secenek0, anchorMode: adayKipi(secenek0) });
  if (y.status.kaynak !== "native") {
    ATLAMA.atla("§11b native yetenek kolu", "native yok — derle: cd native/lisans-cekirdek && npm run derle", 1);
    return;
  }
  const native = JSON.stringify(capabilitiesFor(y.core));
  check("§11b ⭐ native çekirdek biçimsiz belgeyi kendi koduyla reddeder (CEKIRDEK_YOK değil) → dört yetenek, TS ile AYNI", native === ts, native);
}

async function main(): Promise<void> {
  if (process.argv.includes("--vektor-yaz")) {
    await vektorYaz();
    return;
  }
  console.log("=== Lisans native çekirdeği kâhini ===");
  bolum0();
  await bolum1();
  await bolum1Istisna();
  const dosya = vektorDosyasiOku();
  const dosyaV2 = vektorV2DosyasiOku();
  await bolum2(dosya, dosyaV2);
  bolum2v2(dosyaV2);
  const dosyaToplama = vektorToplamaDosyasiOku();
  bolum2toplama(dosyaToplama);
  await bolum3ile7(dosya, dosyaV2);
  await bolum8(dosya);
  bolum8v2(dosyaV2);
  bolum8toplama(dosyaToplama);
  await bolum9(dosya, dosyaV2);
  bolum10kopru();
  bolum11yetenek();
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız${ATLAMA.ozetEki()} ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e: unknown) => {
  console.error("❌ bekçi çöktü:", e);
  process.exit(1);
});
