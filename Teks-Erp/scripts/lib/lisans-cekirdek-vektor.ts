// Lisans çekirdeği TEST VEKTÖRLERİ — TS kâhini ile native çekirdeğin ORTAK girdisi. `test_` öneki
// yok → koşucu bunu bekçi saymaz. Aynı vektör listesi iki yerde tüketilir:
//   · `test_lisans_native_kahin` — dosyadaki beklenen sonuç bugünkü TS protokolüyle aynı mı (bayatlık)
//     + native (.node) aynı vektörde aynı sonucu veriyor mu + CANLI (yeni anahtarlı) vektörde TS = native
//   · `native/lisans-cekirdek/tests/vektorler.rs` — `cargo test` aynı dosyayı Rust tarafında koşar
// Anahtarlar çalışma anında üretilir; dosyaya YALNIZ açık yarılar ve imzalı belgeler girer.
import { generateKeyPairSync, sign, randomUUID, type KeyObject } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  CLOCK_SKEW_MS,
  DAY_MS,
  JWS_MAX_LENGTH,
  TYP,
  b64uDecode,
  b64uEncode,
  msToIso,
  type CertUsage,
  type FingerprintFactor,
  type LeaseDoc,
  type RawFingerprint,
  type RootKey,
} from "../../src/lib/license/protocol";
import type { CoreResult, JwsKey, LicenseCore } from "../../src/lib/license/license-core";
import type { PackageKey } from "../../src/lib/license/integrity";
import { butunlukVektorleri } from "./lisans-butunluk-vektor";
import { moduleKeyId, wrapModuleKey } from "../../src/lib/license/module-key";
import {
  HAM_PARMAK_IZI,
  anahtarUret,
  fiksturKur,
  hakBas,
  hakYuku,
  hamImzala,
  kiraBas,
  kiraYuku,
  sertifikaBas,
  sertifikaYuku,
  type Fikstur,
  type TestAnahtari,
} from "./lisans-fikstur";

/**
 * Gömülü çapa vektörlerinin kökü: kid üretim biçiminde DEĞİL (`kok-<yıl>-<n>` — test_lisans_protokol §0i),
 * yani çapaya hiçbir zaman giremez; fikstür kökünden AYRI bir anahtar (çapa dışı bir kökün imzası).
 */
function capaDisiKok(): TestAnahtari {
  return anahtarUret("kok-fikstur-1");
}

/** `Teks-Erp/` köküne göre (paketlenmiş koşumda `__dirname` tek olduğundan kök çağırandan gelir). */
export function vektorDosyasiYolu(teksKok: string): string {
  return path.join(teksKok, "native", "lisans-cekirdek", "test-vektorleri", "protokol.json");
}
/** Dosya biçimi sürümü (vektör şekli kırılınca artar; Rust testi de okur). */
export const VEKTOR_BICIMI = 1;
/** Kayıtlı dosyanın "şimdi"si — belgeler zamana göre değil kendi imza anlarına göre doğrulanır. */
export const VEKTOR_SIMDI = Date.parse("2026-09-29T00:00:00.000Z");

export interface DosyaGirdisi {
  readonly yol: string;
  /** base64url içerik; `null` = bu yolda DİZİN kur. */
  readonly icerik: string | null;
}

export type Vektor =
  | { readonly tur: "jws"; readonly ad: string; readonly token: unknown; readonly typ: string; readonly keys: JwsKey[] }
  | { readonly tur: "sertifika"; readonly ad: string; readonly token: unknown; readonly usage: CertUsage; readonly atMs: number | null; readonly roots: RootKey[] | null }
  | { readonly tur: "hak"; readonly ad: string; readonly token: unknown; readonly roots: RootKey[] | null }
  | { readonly tur: "kira"; readonly ad: string; readonly token: unknown; readonly roots: RootKey[] | null }
  | { readonly tur: "bag"; readonly ad: string; readonly lease: unknown; readonly entitlement: unknown; readonly roots: RootKey[] | null }
  | { readonly tur: "normalize"; readonly ad: string; readonly factor: FingerprintFactor; readonly raw: string | null }
  | { readonly tur: "ozet"; readonly ad: string; readonly raw: RawFingerprint; readonly salt: string }
  | {
      readonly tur: "butunluk";
      readonly ad: string;
      readonly manifest: unknown;
      readonly keys: PackageKey[] | null;
      readonly dosyalar: DosyaGirdisi[];
      readonly kok: "var" | "yok";
    }
  | { readonly tur: "modul"; readonly ad: string; readonly wrap: unknown; readonly privateKey: string; readonly modul: string }
  | {
      readonly tur: "kiraModul";
      readonly ad: string;
      readonly lease: unknown;
      readonly entitlement: unknown;
      readonly privateKey: string;
      readonly modul: string;
      readonly kid: string;
      readonly roots: RootKey[] | null;
    }
  | { readonly tur: "tarih"; readonly ad: string; readonly metin: string };

export interface VektorKaydi {
  readonly vektor: Vektor;
  readonly beklenen: unknown;
}

export interface VektorDosyasi {
  readonly bicim: number;
  readonly not: string;
  readonly kayitlar: VektorKaydi[];
}

// ── Karşılaştırma ─────────────────────────────────────────────────────────────
/** JSON derin eşitliği (anahtar sırası önemsiz). Mesaj metni karşılaştırılmaz — yalnız sonuç/kod/değer. */
export function jsonEsit(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => jsonEsit(x, b[i]));
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && jsonEsit(Reflect.get(a, k), Reflect.get(b, k)));
}

function jsonKopya(x: unknown): unknown {
  return x === undefined ? null : JSON.parse(JSON.stringify(x));
}

function sonuc(r: CoreResult<unknown>): unknown {
  return r.ok ? { ok: true, value: jsonKopya(r.value) } : { ok: false, code: r.code };
}

function tuzCoz(salt: string): Buffer {
  const b = b64uDecode(salt);
  if (!b) throw new Error(`vektör tuzu base64url değil: ${salt}`);
  return b;
}

/** Bütünlük vektörünün dosyalarını geçici dizine kurar; `kok: "yok"` var olmayan bir yolu verir. */
function dosyalariKur(dosyalar: readonly DosyaGirdisi[]): string {
  const dir = mkdtempSync(path.join(tmpdir(), "lisans-vektor-"));
  for (const d of dosyalar) {
    const hedef = path.join(dir, ...d.yol.split("/"));
    if (d.icerik === null) {
      mkdirSync(hedef, { recursive: true });
      continue;
    }
    mkdirSync(path.dirname(hedef), { recursive: true });
    writeFileSync(hedef, tuzCoz(d.icerik));
  }
  return dir;
}

/** Vektörü verilen çekirdekte değerlendirir; `tarih` yalnız TS'te (native'in tarih ucu yok, Rust testi ölçer). */
export async function degerlendir(core: LicenseCore, v: Vektor): Promise<unknown> {
  switch (v.tur) {
    case "jws":
      return sonuc(core.verifyJws(v.token, v.typ, v.keys));
    case "sertifika":
      return sonuc(core.verifyCertificate(v.token, { usage: v.usage, atMs: v.atMs ?? Number.NaN, ...(v.roots ? { roots: v.roots } : {}) }));
    case "hak":
      return sonuc(core.verifyEntitlement(v.token, v.roots ?? undefined));
    case "kira":
      return sonuc(core.verifyLease(v.token, v.roots ?? undefined));
    case "bag":
      return sonuc(core.checkLeaseBinding(v.lease, v.entitlement, v.roots ?? undefined));
    case "normalize":
      return { deger: core.normalizeFactor(v.factor, v.raw) };
    case "ozet":
      try {
        return { ozet: core.digestFingerprint(v.raw, tuzCoz(v.salt)) };
      } catch {
        return { hata: true };
      }
    case "butunluk": {
      const dir = dosyalariKur(v.dosyalar);
      try {
        const kok = v.kok === "yok" ? path.join(dir, "olmayan-kok") : dir;
        return sonuc(await core.verifyIntegrity(v.manifest, kok, v.keys ?? undefined));
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
    case "modul":
      return sonuc(core.unwrapModuleKey(v.wrap, v.privateKey, v.modul));
    case "kiraModul":
      return sonuc(
        core.unwrapLeaseModuleKey({
          lease: v.lease,
          entitlement: v.entitlement,
          privateKeyX: v.privateKey,
          modul: v.modul,
          kid: v.kid,
          ...(v.roots ? { roots: v.roots } : {}),
        }),
      );
    case "tarih": {
      const ms = Date.parse(v.metin);
      return { ms: Number.isNaN(ms) ? null : ms };
    }
  }
}

// ── Belge üreticileri ─────────────────────────────────────────────────────────
/** Başlık/yük/imzayı SERBEST kurar (biçimsiz belge sondaları: şema ve başlık denetimini atlar). */
function hamJws(g: {
  readonly baslik?: unknown;
  readonly baslikMetni?: string;
  readonly yuk?: unknown;
  readonly yukMetni?: string;
  readonly anahtar: KeyObject;
  readonly imzaBayt?: (imza: Buffer) => Buffer;
}): string {
  const h = b64uEncode(g.baslikMetni ?? JSON.stringify(g.baslik));
  const p = b64uEncode(g.yukMetni ?? JSON.stringify(g.yuk));
  const imza = sign(null, Buffer.from(`${h}.${p}`, "ascii"), g.anahtar);
  return `${h}.${p}.${b64uEncode(g.imzaBayt ? g.imzaBayt(imza) : imza)}`;
}

function jwsParcalari(token: string): [string, string, string] {
  const [a, b, c] = token.split(".");
  return [a ?? "", b ?? "", c ?? ""];
}

/** Base64url metnin son karakterini değiştirir (kurcalama / kanonik olmayan kuyruk). */
function sonKarakter(metin: string, yeni: string): string {
  return `${metin.slice(0, -1)}${yeni}`;
}

function kokAnahtari(a: TestAnahtari, classes: RootKey["classes"]): RootKey {
  return { kid: a.kid, x: a.x, classes };
}

function jwsVektorleri(f: Fikstur): Vektor[] {
  const hak = hakBas(f);
  const [h, p, s] = jwsParcalari(hak);
  const kok: JwsKey[] = [{ kid: f.kok.kid, x: f.kok.x }];
  const baslik = (ek: Record<string, unknown>) => ({ alg: "EdDSA", typ: TYP.HAK, kid: f.kok.kid, ...ek });
  const yuk = hakYuku(f);
  const v = (ad: string, token: unknown, g: { typ?: string; keys?: JwsKey[] } = {}): Vektor => ({
    tur: "jws",
    ad,
    token,
    typ: g.typ ?? TYP.HAK,
    keys: g.keys ?? kok,
  });
  const baskaAnahtar = anahtarUret(f.kok.kid);
  return [
    v("geçerli HAK", hak),
    v("alg none", hamJws({ baslik: baslik({ alg: "none" }), yuk, anahtar: f.kok.privateKey })),
    v("alg HS256", hamJws({ baslik: baslik({ alg: "HS256" }), yuk, anahtar: f.kok.privateKey })),
    v("alg eksik", hamJws({ baslik: { typ: TYP.HAK, kid: f.kok.kid }, yuk, anahtar: f.kok.privateKey })),
    v("alg iki kez (son kazanır: EdDSA)", hamJws({ baslikMetni: `{"alg":"none","alg":"EdDSA","typ":"${TYP.HAK}","kid":"${f.kok.kid}"}`, yuk, anahtar: f.kok.privateKey })),
    v("başlıkta jwk", hamJws({ baslik: baslik({ jwk: { kty: "OKP", crv: "Ed25519", x: f.kok.x } }), yuk, anahtar: f.kok.privateKey })),
    v("başlıkta crit", hamJws({ baslik: baslik({ crit: ["exp"] }), yuk, anahtar: f.kok.privateKey })),
    v("başlıkta __proto__", hamJws({ baslikMetni: `{"alg":"EdDSA","typ":"${TYP.HAK}","kid":"${f.kok.kid}","__proto__":{"x":1}}`, yuk, anahtar: f.kok.privateKey })),
    v("typ eksik", hamJws({ baslik: { alg: "EdDSA", kid: f.kok.kid }, yuk, anahtar: f.kok.privateKey })),
    v("typ biçimsiz", hamJws({ baslik: baslik({ typ: "TEKSERP-HAK" }), yuk, anahtar: f.kok.privateKey })),
    v("typ beklenenden farklı", hak, { typ: TYP.KIRA }),
    v("kid eksik", hamJws({ baslik: { alg: "EdDSA", typ: TYP.HAK }, yuk, anahtar: f.kok.privateKey })),
    v("kid biçimsiz", hamJws({ baslik: baslik({ kid: "KOK" }), yuk, anahtar: f.kok.privateKey })),
    v("kid sayı", hamJws({ baslik: baslik({ kid: 7 }), yuk, anahtar: f.kok.privateKey })),
    v("kid bilinmiyor", hak, { keys: [{ kid: "kok-2099-1", x: f.kok.x }] }),
    v("aynı kid başka anahtar", hak, { keys: [{ kid: f.kok.kid, x: baskaAnahtar.x }] }),
    v("anahtar biçimsiz (kanonik değil)", hak, { keys: [{ kid: f.kok.kid, x: sonKarakter(f.kok.x, f.kok.x.endsWith("A") ? "B" : "A") }] }),
    v("tekrarlı kid, ilki biçimsiz", hak, { keys: [{ kid: f.kok.kid, x: "kisa" }, { kid: f.kok.kid, x: f.kok.x }] }),
    v("tekrarlı kid, ilki doğru", hak, { keys: [{ kid: f.kok.kid, x: f.kok.x }, { kid: f.kok.kid, x: baskaAnahtar.x }] }),
    v("yük kurcalı", `${h}.${b64uEncode(JSON.stringify({ ...yuk, surum: 9 }))}.${s}`),
    v("imza kurcalı", hamJws({ baslik: baslik({}), yuk, anahtar: f.kok.privateKey, imzaBayt: (b) => Buffer.from(b.map((x, i) => (i === 5 ? x ^ 1 : x))) })),
    v("imza 63 bayt", hamJws({ baslik: baslik({}), yuk, anahtar: f.kok.privateKey, imzaBayt: (b) => b.subarray(0, 63) })),
    v("imza kanonik olmayan kuyruk", `${h}.${p}.${sonKarakter(s, s.endsWith("A") ? "B" : "A")}`),
    v("imza dolgulu", `${h}.${p}.${s}==`),
    v("iki parça", `${h}.${p}`),
    v("dört parça", `${h}.${p}.${s}.x`),
    v("boş metin", ""),
    v("metin değil (null)", null),
    v("metin değil (sayı)", 42),
    v("metin değil (nesne)", { token: hak }),
    v("32 KB tavanı aşıldı", `${h}.${p}.${s}${"A".repeat(JWS_MAX_LENGTH)}`),
    v("başlık dizi", hamJws({ baslikMetni: "[1,2]", yuk, anahtar: f.kok.privateKey })),
    v("başlık JSON değil", hamJws({ baslikMetni: "{alg", yuk, anahtar: f.kok.privateKey })),
    v("yük dizi", hamJws({ baslik: baslik({}), yukMetni: "[]", anahtar: f.kok.privateKey })),
    v("yük JSON değil", hamJws({ baslik: baslik({}), yukMetni: "{\"a\":", anahtar: f.kok.privateKey })),
    v("yükte büyük sayı (1e400)", hamJws({ baslik: baslik({}), yukMetni: "{\"v\":1e400}", anahtar: f.kok.privateKey })),
    v("yükte __proto__ (JWS katmanı yükü süzmez)", hamJws({ baslik: baslik({}), yukMetni: "{\"v\":1,\"__proto__\":{\"a\":1}}", anahtar: f.kok.privateKey })),
    v("yükte Türkçe + vekil çifti", hamJws({ baslik: baslik({}), yuk: { ad: "Şahin İplik 🧵", v: 1 }, anahtar: f.kok.privateKey })),
    v("başlıkta yabancı alfabe (base64)", `${h}+.${p}.${s}`),
  ];
}

function sertifikaVektorleri(f: Fikstur): Vektor[] {
  const alt = sertifikaBas(f.kok, sertifikaYuku(f, f.alt, "ALT"));
  const yuk = sertifikaYuku(f, f.alt, "ALT");
  const baslangic = Date.parse(yuk.baslangic);
  const bitis = Date.parse(yuk.bitis);
  const yabanci = anahtarUret("kok-2030-9");
  const v = (ad: string, token: unknown, g: { usage?: CertUsage; atMs?: number | null; roots?: RootKey[] | null } = {}): Vektor => ({
    tur: "sertifika",
    ad,
    token,
    usage: g.usage ?? "ALT",
    atMs: g.atMs === undefined ? f.simdi : g.atMs,
    roots: g.roots === undefined ? f.kokler : g.roots,
  });
  const ham = (ek: Record<string, unknown>) => hamImzala(TYP.SERTIFIKA, f.kok, { ...yuk, ...ek });
  return [
    v("geçerli ALT", alt),
    v("tanınmayan alan atılır", ham({ fazlaAlan: "x" })),
    v("imza anı başlangıç − tolerans (sınır, geçer)", alt, { atMs: baslangic - CLOCK_SKEW_MS }),
    v("imza anı başlangıç − tolerans − 1 ms", alt, { atMs: baslangic - CLOCK_SKEW_MS - 1 }),
    v("imza anı bitiş + tolerans (sınır, geçer)", alt, { atMs: bitis + CLOCK_SKEW_MS }),
    v("imza anı bitiş + tolerans + 1 ms", alt, { atMs: bitis + CLOCK_SKEW_MS + 1 }),
    v("imza anı NaN", alt, { atMs: null }),
    // Kesirli damga: V8 `Date.parse` ilk üç haneyi KESER (…,1239 → 123 ms); yuvarlayan ayna sınırda ayrışır.
    v("başlangıç 4 kesir hanesi, tam sınır (kesme)", ham({ baslangic: "2026-09-19T00:00:00.1239Z" }), { atMs: Date.parse("2026-09-19T00:00:00.123Z") - CLOCK_SKEW_MS }),
    v("bitiş 7 kesir hanesi, tam sınır (kesme)", ham({ bitis: "2027-03-18T00:00:00.9999999Z" }), { atMs: Date.parse("2027-03-18T00:00:00.999Z") + CLOCK_SKEW_MS }),
    v("kullanım farklı", alt, { usage: "BAYI" }),
    v("tanınmayan kök", sertifikaBas(yabanci, sertifikaYuku(f, f.alt, "ALT"))),
    v("hazırlık kökü ÜRETİM sınıfı veremez", sertifikaBas(f.hazirlik, sertifikaYuku(f, f.alt, "ALT", { siniflar: ["URETIM"] }))),
    v("hazırlık kökü TEST verebilir", sertifikaBas(f.hazirlik, sertifikaYuku(f, f.alt, "ALT", { siniflar: ["TEST"] }))),
    v("kid öneki kullanımla uyuşmuyor", ham({ kid: "ind-2026" })),
    v("ALT sertifikasında bayi tavanı", ham({ bayi: { bayiId: randomUUID(), moduller: [] } })),
    v("bitiş başlangıçtan önce", ham({ bitis: yuk.baslangic })),
    v("x kanonik değil", ham({ x: sonKarakter(f.alt.x, f.alt.x.endsWith("A") ? "B" : "A") })),
    v("sınıf listesi boş", ham({ siniflar: [] })),
    v("sınıf listesinde tekrar", ham({ siniflar: ["TEST", "TEST"] })),
    v("sertifikaId uuid değil", ham({ sertifikaId: "123" })),
    v("uuid sürüm 9 (Zod RED)", ham({ sertifikaId: "12345678-1234-9234-8234-123456789012" })),
    v("uuid nil (Zod kabul)", ham({ sertifikaId: "00000000-0000-0000-0000-000000000000" })),
    v("v:2", ham({ v: 2 })),
    v("v metin", ham({ v: "1" })),
    v("v eksik", hamImzala(TYP.SERTIFIKA, f.kok, Object.fromEntries(Object.entries(yuk).filter(([k]) => k !== "v")))),
    v("HAK belgesi sertifika yerine", hakBas(f)),
    v("çapa boş", alt, { roots: [] }),
    v("çapa kid biçimsiz", alt, { roots: [{ kid: "KOK-1", x: f.kok.x, classes: ["URETIM"] }] }),
    v("çapa kid tekrarlı", alt, { roots: [kokAnahtari(f.kok, ["URETIM"]), kokAnahtari(f.kok, ["TEST"])] }),
    v("çapa sınıfsız", alt, { roots: [kokAnahtari(f.kok, [])] }),
    v("çapada hazırlık kökü ÜRETİM'e genişletilmiş", alt, { roots: [kokAnahtari(f.hazirlik, ["TEST", "URETIM"])] }),
    v("çapa anahtarı biçimsiz", alt, { roots: [{ kid: f.kok.kid, x: "abc", classes: ["URETIM"] }] }),
    v("gömülü çapa: kök tanınmıyor", sertifikaBas(capaDisiKok(), sertifikaYuku(f, f.alt, "ALT")), { roots: null }),
    v("gömülü çapa: hazırlık kid'i, yabancı imza", sertifikaBas(anahtarUret("hazirlik-2026-1"), sertifikaYuku(f, f.alt, "ALT", { siniflar: ["TEST"] })), { roots: null }),
  ];
}

function bayiSertifikasi(f: Fikstur, bayiId: string, ek: Parameters<typeof sertifikaYuku>[3] = {}): string {
  return sertifikaBas(
    f.kok,
    sertifikaYuku(f, f.bayi, "BAYI", {
      siniflar: ["URETIM", "TEST"],
      bayi: { bayiId, moduller: ["production.enabled", "finance.enabled", "ticaret.enabled"] },
      ...ek,
    }),
  );
}

function hakVektorleri(f: Fikstur): Vektor[] {
  const v = (ad: string, token: unknown, roots: RootKey[] | null = f.kokler): Vektor => ({ tur: "hak", ad, token, roots });
  const ham = (ek: Record<string, unknown>, imzalayan: TestAnahtari = f.kok) => hamImzala(TYP.HAK, imzalayan, { ...hakYuku(f), ...ek });
  const bayiId = randomUUID();
  const bayiHak = (ek: Record<string, unknown> = {}, sertifika = bayiSertifikasi(f, bayiId)) =>
    hamImzala(TYP.HAK, f.bayi, { ...hakYuku(f), bayiId, bayiSertifikasi: sertifika, ...ek });
  const emoji = (n: number) => "🧵".repeat(n);
  return [
    v("geçerli kök imzalı ÜRETİM", hakBas(f)),
    v("tanınmayan alan atılır (iç içe dahil)", ham({ fazla: 1, musteri: { id: f.musteriId, ad: "Deneme", fazla: true } })),
    v("hazırlık kökü TEST", hakBas(f, { sinif: "TEST" }, f.hazirlik)),
    v("hazırlık kökü ÜRETİM imzalayamaz", ham({ sinif: "URETIM" }, f.hazirlik)),
    v("kök imzalı HAK bayi sertifikası taşıyamaz", ham({ bayiId, bayiSertifikasi: bayiSertifikasi(f, bayiId) })),
    v("bayi imzalı tavan içinde", bayiHak()),
    v("bayi imzalı tavan dışı modül", bayiHak({ moduller: ["production.enabled", "iplik.enabled"] })),
    v("bayi imzalı tavan dışı sınıf", bayiHak({ sinif: "DR" })),
    v("bayi kimliği uyuşmuyor", bayiHak({ bayiId: randomUUID() })),
    v("bayi sertifikası başka anahtarın", bayiHak({}, sertifikaBas(f.kok, sertifikaYuku(f, anahtarUret("bayi-b2"), "BAYI", { bayi: { bayiId, moduller: [] } })))),
    v("bayi yolunda ALT sertifikası (kullanım)", bayiHak({}, sertifikaBas(f.kok, sertifikaYuku(f, anahtarUret("alt-2026-9"), "ALT")))),
    v(
      "bayi sertifikası imza anında dolmuş",
      bayiHak({}, bayiSertifikasi(f, bayiId, { baslangic: msToIso(f.simdi - 300 * DAY_MS), bitis: msToIso(f.simdi - 200 * DAY_MS) })),
    ),
    v("bayi yolunda veriliş biçimsiz ama ES tarihi", bayiHak({ verilis: "2026-09-28" })),
    v("bayi yolunda veriliş metin değil", bayiHak({ verilis: 5 })),
    v("bilinmeyen kid, gömülü sertifika yok", hamImzala(TYP.HAK, anahtarUret("kok-2031-1"), hakYuku(f))),
    v("lisansNo biçimsiz", ham({ lisansNo: "TKS-26-1" })),
    v("modül tekrarlı", ham({ moduller: ["finance.enabled", "finance.enabled"] })),
    v("modül adı büyük harfle başlıyor", ham({ moduller: ["Finance.enabled"] })),
    v("modül listesi 65", ham({ moduller: Array.from({ length: 65 }, (_, i) => `m${i}.enabled`) })),
    v("müşteri adı boş", ham({ musteri: { id: f.musteriId, ad: "" } })),
    v("müşteri adı 200 UTF-16 (100 emoji, sınır)", ham({ musteri: { id: f.musteriId, ad: emoji(100) } })),
    v("müşteri adı 202 UTF-16 (101 emoji)", ham({ musteri: { id: f.musteriId, ad: emoji(101) } })),
    v("müşteri dizi", ham({ musteri: [f.musteriId] })),
    v("sürüm 0", ham({ surum: 0 })),
    v("sürüm kesirli", ham({ surum: 1.5 })),
    v("sürüm 2^53 (güvenli tamsayı değil)", ham({ surum: 2 ** 53 })),
    v("veriliş saniyesiz (Zod kabul)", ham({ verilis: "2026-09-28T00:00Z" })),
    v("veriliş 7 kesir hanesi", ham({ verilis: "2026-09-28T00:00:00.1234567Z" })),
    v("bakım ofsetli", ham({ bakimBitis: "2027-09-28T00:00:00+03:00" })),
    v("veriliş 30 Şubat", ham({ verilis: "2026-02-30T00:00:00Z" })),
    v("artık gün 2028-02-29", ham({ verilis: "2028-02-29T00:00:00Z" })),
    v("bayi sertifikalı ama bayiId yok", ham({ bayiSertifikasi: "x.y.z" })),
    v("P0 kurulum kimliği boş dizge (istekte meşru, HAK'ta RED)", ham({ kurulumId: "" })),
    v("P0 kurulum kimliği yok", hamImzala(TYP.HAK, f.kok, Object.fromEntries(Object.entries(hakYuku(f)).filter(([k]) => k !== "kurulumId")))),
    v("kalıcı metin", ham({ kalici: "evet" })),
    v("v:2", ham({ v: 2 })),
    v("v null", ham({ v: null })),
    v("kira belgesi HAK yerine", kiraBas(f)),
    v("çapa boş", hakBas(f), []),
    v("çözümsüz metin", "a.b.c"),
    v("gömülü çapa: kök tanınmıyor", hakBas(f, {}, capaDisiKok()), null),
  ];
}

function kiraVektorleri(f: Fikstur): Vektor[] {
  const v = (ad: string, token: unknown, roots: RootKey[] | null = f.kokler): Vektor => ({ tur: "kira", ad, token, roots });
  const ham = (ek: Record<string, unknown>, imzalayan: TestAnahtari = f.alt) => hamImzala(TYP.KIRA, imzalayan, { ...kiraYuku(f), ...ek });
  const yuk = kiraYuku(f);
  const verilis = Date.parse(yuk.verilis);
  const yaptirim = (ek: Record<string, unknown>) => ({ ...yuk.yaptirim, ...ek });
  const altSahte = anahtarUret(f.alt.kid);
  return [
    v("geçerli", kiraBas(f)),
    v("iç içe tanınmayan alanlar atılır", ham({ fazla: 1, yaptirim: yaptirim({ fazla: 2 }), kanal: { kod: "deneme-kanal", guncelSurumler: { backend: "2.11.2", fazla: "x" }, fazla: 3 } })),
    v("parmak izinde fazla alan (katı nesne)", ham({ parmakIzi: { ...f.parmakIzi, f6: null } })),
    v("parmak izinde eksik alan", ham({ parmakIzi: { f1: null, f2: null, f3: null, f4: null } })),
    v("K3 tarihsiz", ham({ yaptirim: yaptirim({ kademe: "K3", kisitlamaTarihi: null }) })),
    v("K3 tarihli", ham({ yaptirim: yaptirim({ kademe: "K3", kisitlamaTarihi: msToIso(f.simdi + 7 * DAY_MS) }) })),
    v("K9", ham({ yaptirim: yaptirim({ kademe: "K9" }) })),
    v("mesaj 500", ham({ yaptirim: yaptirim({ mesaj: "ş".repeat(500) }) })),
    v("mesaj 501", ham({ yaptirim: yaptirim({ mesaj: "ş".repeat(501) }) })),
    v("ömür tam 45 gün", ham({ bitis: msToIso(verilis + 45 * DAY_MS) })),
    v("ömür 45 gün + 1 ms", ham({ bitis: msToIso(verilis + 45 * DAY_MS + 1) })),
    v("ömür sınırı kesirli damgalarla (kesme → tam 45 gün)", ham({ verilis: "2026-09-28T00:00:00.0001Z", bitis: "2026-11-12T00:00:00.0009Z" })),
    v("bitiş = veriliş", ham({ bitis: yuk.verilis })),
    v("ek süre 60", ham({ ekSureGun: 60 })),
    v("ek süre 61", ham({ ekSureGun: 61 })),
    v("yoklama aralığı 4", ham({ yoklamaAraligiDk: 4 })),
    v("eşitleme aralığı 0", ham({ esitlemeAraligiDk: 0 })),
    v("eşitleme aralığı 1440", ham({ esitlemeAraligiDk: 1440 })),
    v("kanal kodu biçimsiz", ham({ kanal: { kod: "-kanal", guncelSurumler: {} } })),
    v("panel sürümü iki haneli", ham({ kanal: { kod: "deneme", guncelSurumler: { panel: "1.2" } } })),
    v("tablet sürümü ön sürüm etiketli", ham({ kanal: { kod: "deneme", guncelSurumler: { tablet: "1.3.2-beta.1" } } })),
    v("kurulum anahtar kimliği biçimsiz", ham({ kurulumAnahtarKimligi: "kur-kisa" })),
    v("devredildi metin", ham({ devredildi: "hayir" })),
    v("alt sertifika imza anında dolmuş", ham({ altSertifika: sertifikaBas(f.kok, sertifikaYuku(f, f.alt, "ALT", { baslangic: msToIso(f.simdi - 300 * DAY_MS), bitis: msToIso(f.simdi - 200 * DAY_MS) })) })),
    v("alt sertifika gelecekte başlıyor", ham({ altSertifika: sertifikaBas(f.kok, sertifikaYuku(f, f.alt, "ALT", { baslangic: msToIso(f.simdi + DAY_MS), bitis: msToIso(f.simdi + 100 * DAY_MS) })) })),
    v("alt sertifikayı tanınmayan kök imzalamış", ham({ altSertifika: sertifikaBas(anahtarUret("kok-2032-1"), sertifikaYuku(f, f.alt, "ALT")) })),
    v("alt sertifika yerine BAYİ sertifikası", ham({ altSertifika: bayiSertifikasi(f, randomUUID()) })),
    v("kira başka kid'le imzalı", ham({}, anahtarUret("alt-2026-2"))),
    v("kira aynı kid başka anahtarla imzalı", ham({}, altSahte)),
    v("alt sertifika yok", hamImzala(TYP.KIRA, f.alt, Object.fromEntries(Object.entries(yuk).filter(([k]) => k !== "altSertifika")))),
    v("veriliş yok", hamImzala(TYP.KIRA, f.alt, Object.fromEntries(Object.entries(yuk).filter(([k]) => k !== "verilis")))),
    v("veriliş ES tarihi (saatsiz) — sertifika geçer, şema RED", ham({ verilis: "2026-09-28" })),
    // P0: imzasız satıcı saati güvenilir saate girmez (D4), imzalı tek saat kaynağı kiranın `sunucuSaati`dir;
    // lisans kimliği kiradır (D14) — istekte boş kurulum kimliği meşru, kirada değil.
    v("P0 sunucu saati yok", hamImzala(TYP.KIRA, f.alt, Object.fromEntries(Object.entries(yuk).filter(([k]) => k !== "sunucuSaati")))),
    v("P0 sunucu saati saatsiz", ham({ sunucuSaati: "2026-09-28" })),
    v("P0 kurulum kimliği yok", hamImzala(TYP.KIRA, f.alt, Object.fromEntries(Object.entries(yuk).filter(([k]) => k !== "kurulumId")))),
    v("P0 kurulum kimliği boş dizge (istekte meşru, kirada RED)", ham({ kurulumId: "" })),
    v("P0 kurulum kimliği null", ham({ kurulumId: null })),
    ...kiraHakVektorleri(f, ham),
    v("HAK belgesi kira yerine", hakBas(f)),
    v("çapa boş (önce ayrıştırma, sonra çapa)", kiraBas(f), []),
    v("çapa boş, biçimsiz metin", "x", []),
    v("gömülü çapa: alt sertifikanın kökü tanınmıyor", kiraBas(f, { altSertifika: sertifikaBas(capaDisiKok(), sertifikaYuku(f, f.alt, "ALT")) }), null),
  ];
}

/** Faz 2d: kirada `modulAnahtarlari` şeması (atılan alan · modül bağı · kid biçimi · tekrarsızlık · tavan). */
function kiraHakVektorleri(f: Fikstur, ham: (ek: Record<string, unknown>) => string): Vektor[] {
  const v = (ad: string, token: unknown): Vektor => ({ tur: "kira", ad, token, roots: f.kokler });
  const alici = generateKeyPairSync("x25519").publicKey.export({ format: "jwk" });
  const acik = typeof alici.x === "string" ? alici.x : "";
  const anahtar = Buffer.alloc(32, 0x3c);
  const hak = { modul: "depo.multiEnabled", surum: 1, kid: moduleKeyId(anahtar), sarma: wrapModuleKey({ moduleKey: anahtar, recipientPublicX: acik, modul: "depo.multiEnabled" }) };
  return [
    v("2d modül anahtarı hakkı geçerli", ham({ modulAnahtarlari: [hak] })),
    v("2d modül hakkı boş liste", ham({ modulAnahtarlari: [] })),
    v("2d hakta ve sarmada tanınmayan alan atılır", ham({ modulAnahtarlari: [{ ...hak, fazla: 1, sarma: { ...hak.sarma, fazla: 2 } }] })),
    v("2d sarmanın modülü hakkınkinden farklı", ham({ modulAnahtarlari: [{ ...hak, modul: "finance.enabled" }] })),
    v("2d kid biçimsiz", ham({ modulAnahtarlari: [{ ...hak, kid: "mk-kisa" }] })),
    v("2d kid tekrarlı", ham({ modulAnahtarlari: [hak, hak] })),
    v("2d hak sürümü 0", ham({ modulAnahtarlari: [{ ...hak, surum: 0 }] })),
    v("2d sarılı 63 karakter", ham({ modulAnahtarlari: [{ ...hak, sarma: { ...hak.sarma, sarili: hak.sarma.sarili.slice(1) } }] })),
    v("2d geçici anahtar biçimsiz", ham({ modulAnahtarlari: [{ ...hak, sarma: { ...hak.sarma, epk: "abc" } }] })),
    v("2d liste null", ham({ modulAnahtarlari: null })),
    v("2d liste 33", ham({ modulAnahtarlari: Array.from({ length: 33 }, (_, i) => ({ ...hak, kid: moduleKeyId(Buffer.alloc(32, i)) })) })),
  ];
}

/** Faz 2d: anahtar YALNIZ doğrulanmış kiradan — HAK, dondurma, hak, başka kurulum, kid, bağ. */
function kiraModulVektorleri(f: Fikstur): Vektor[] {
  const cift = generateKeyPairSync("x25519");
  const jwk = cift.privateKey.export({ format: "jwk" });
  const ozel = typeof jwk.d === "string" ? jwk.d : "";
  const acik = typeof jwk.x === "string" ? jwk.x : "";
  const baska = generateKeyPairSync("x25519").privateKey.export({ format: "jwk" });
  const baskaOzel = typeof baska.d === "string" ? baska.d : "";
  const modul = "finance.enabled";
  const anahtar = Buffer.alloc(32, 0x7e);
  const kid = moduleKeyId(anahtar);
  const hak = (m: string = modul, k: Buffer = anahtar, kimlik: string = kid) => ({ modul: m, surum: 2, kid: kimlik, sarma: wrapModuleKey({ moduleKey: k, recipientPublicX: acik, modul: m }) });
  const kira = (ek: Partial<LeaseDoc> = {}) => kiraBas(f, { modulAnahtarlari: [hak()], ...ek });
  const v = (ad: string, lease: unknown, g: { entitlement?: unknown; privateKey?: string; modul?: string; kid?: string } = {}): Vektor => ({
    tur: "kiraModul",
    ad,
    lease,
    entitlement: g.entitlement ?? hakBas(f),
    privateKey: g.privateKey ?? ozel,
    modul: g.modul ?? modul,
    kid: g.kid ?? kid,
    roots: f.kokler,
  });
  const yaptirim = { kademe: "K2" as const, mesaj: null, kisitlamaTarihi: null, donmusModuller: [modul], guncellemeDonuk: false };
  const yanlisKimlik = moduleKeyId(Buffer.alloc(32, 0x11));
  return [
    v("geçerli", kira()),
    v("HAK'ta yok", kira(), { entitlement: hakBas(f, { moduller: ["production.enabled"] }) }),
    v("K2 dondurulmuş (hak kirada olsa bile)", kira({ yaptirim })),
    v("kirada hak yok", kiraBas(f)),
    v("kirada başka kid", kira(), { kid: yanlisKimlik }),
    v("başka kurulumun özel anahtarı", kira(), { privateKey: baskaOzel }),
    v("kid anahtarın özeti değil", kiraBas(f, { modulAnahtarlari: [hak(modul, anahtar, yanlisKimlik)] }), { kid: yanlisKimlik }),
    v("kira HAK'a bağlı değil", kira({ hakSurum: 2 })),
    v("kira imzasız/bozuk", "a.b.c"),
    v("HAK bozuk", kira(), { entitlement: "a.b.c" }),
    v("özel anahtar biçimsiz", kira(), { privateKey: "abc" }),
    v("başka modülün hakkı istenen modüle geçmez", kiraBas(f, { modulAnahtarlari: [hak("ticaret.enabled")] }), { kid }),
  ];
}

function bagVektorleri(f: Fikstur): Vektor[] {
  const v = (ad: string, lease: unknown, entitlement: unknown): Vektor => ({ tur: "bag", ad, lease, entitlement, roots: f.kokler });
  const testAlt = sertifikaBas(f.kok, sertifikaYuku(f, f.alt, "ALT", { siniflar: ["TEST"] }));
  return [
    v("bağlı", kiraBas(f), hakBas(f)),
    v("HAK sürümü farklı", kiraBas(f, { hakSurum: 2 }), hakBas(f)),
    v("başka kurulumun kirası", kiraBas(f, { kurulumId: randomUUID() }), hakBas(f)),
    v("başka HAK", kiraBas(f, { hakId: randomUUID() }), hakBas(f)),
    v("alt anahtar ÜRETİM'e yetkisiz", kiraBas(f, { altSertifika: testAlt }), hakBas(f)),
    v("kira bozuk", "a.b.c", hakBas(f)),
    v("HAK bozuk", kiraBas(f), hakBas(f, {}, f.hazirlik)),
  ];
}

function normalizeVektorleri(): Vektor[] {
  const girdiler: Array<[FingerprintFactor, string | null, string]> = [
    ["f1", "{6F1C2B9A-0D3E-4B57-9A11-3C5E7D9F0B24}", "Windows MachineGuid"],
    ["f1", "6f1c2b9a0d3e4b57", "16 hex (alt sınır)"],
    ["f1", "6f1c2b9a0d3e4b5", "15 hex"],
    ["f1", "a".repeat(64), "64 aynı hane (tek düze)"],
    ["f1", "ab".repeat(32), "64 hex"],
    ["f1", "ab".repeat(32) + "c", "65 hex"],
    ["f1", "6f1c2b9a0d3e4b57xyz", "hex dışı"],
    ["f2", "4C4C4544-0051-3010-8052-B7C04F4E3332", "SMBIOS UUID"],
    ["f2", "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF", "tek düze F"],
    ["f2", "00000000-0000-0000-0000-000000000000", "sıfır UUID"],
    ["f3", "S4EVNX0N912345", "NVMe seri"],
    ["f3", "Volume0", "RAID genel seri"],
    ["f3", "volume", "yalın volume"],
    ["f3", "VOLUME12", "büyük harf volume"],
    ["f3", "Volume0a", "volume + harf (ölçülebilir)"],
    ["f3", "abc", "3 karakter"],
    ["f3", "  eui.0025_3858_91b0_1234  ", "boşluk + noktalama"],
    ["f4", "PF3K7Q2A", "anakart seri"],
    ["f4", "To Be Filled By O.E.M.", "yer tutucu"],
    ["f4", "Default string", "yer tutucu"],
    ["f4", "System Serial Number", "yer tutucu"],
    ["f4", "0123456789", "yer tutucu rakam"],
    ["f4", "None", "yer tutucu none"],
    ["f4", "１２３４ＡＢ", "NFKC tam genişlik"],
    ["f4", "ﬁle12", "NFKC bağlı harf"],
    ["f4", "x²³⁴⁵", "NFKC üst simge"],
    ["f4", "Ⅻ①②③", "NFKC Roma rakamı + daire içi"],
    ["f4", "İstanbul", "Türkçe büyük İ (ASCII dışı düşer)"],
    ["f4", "ışık1234", "Türkçe küçük ı"],
    ["f4", "㎏㎏㎏㎏", "NFKC birim işareti"],
    ["f4", "", "boş"],
    ["f4", "   ", "yalnız boşluk"],
    ["f4", null, "yok"],
    ["f5", "7412345678901234567", "PG system_identifier"],
    ["f5", "123456789012345678901", "21 hane"],
    ["f5", "12a4", "harf içeren"],
    ["f5", "0", "tek hane (tek düze)"],
    ["f5", "10", "iki hane"],
  ];
  const yerTutucular = ["none", "null", "unknown", "defaultstring", "tobefilledbyoem", "notapplicable", "notspecified", "systemserialnumber", "systemproductname", "chassisserialnumber", "baseboardserialnumber"];
  return [
    ...girdiler.map(([factor, raw, ad]): Vektor => ({ tur: "normalize", ad: `${factor} ${ad}`, factor, raw })),
    ...yerTutucular.map((y): Vektor => ({ tur: "normalize", ad: `yer tutucu ${y}`, factor: "f4", raw: y.toUpperCase() })),
  ];
}

function ozetVektorleri(f: Fikstur): Vektor[] {
  const tuz = b64uEncode(f.tuz);
  return [
    { tur: "ozet", ad: "beş etken", raw: HAM_PARMAK_IZI, salt: tuz },
    { tur: "ozet", ad: "kısmi (f2/f3 ölçülemedi)", raw: { f1: HAM_PARMAK_IZI.f1, f4: HAM_PARMAK_IZI.f4, f5: HAM_PARMAK_IZI.f5 }, salt: tuz },
    { tur: "ozet", ad: "aynı değer iki etkende (alan öneki ayırır)", raw: { f3: "ABCD1234", f4: "ABCD1234" }, salt: tuz },
    { tur: "ozet", ad: "16 bayt tuz (alt sınır)", raw: HAM_PARMAK_IZI, salt: b64uEncode(Buffer.alloc(16, 3)) },
    { tur: "ozet", ad: "15 bayt tuz (programcı hatası)", raw: HAM_PARMAK_IZI, salt: b64uEncode(Buffer.alloc(15, 3)) },
    { tur: "ozet", ad: "hiç etken yok", raw: {}, salt: tuz },
  ];
}

function modulVektorleri(): Vektor[] {
  const alici = generateKeyPairSync("x25519");
  const aliciJwk = alici.privateKey.export({ format: "jwk" });
  const baska = generateKeyPairSync("x25519").privateKey.export({ format: "jwk" });
  const ozel = typeof aliciJwk.d === "string" ? aliciJwk.d : "";
  const baskaOzel = typeof baska.d === "string" ? baska.d : "";
  const acik = typeof aliciJwk.x === "string" ? aliciJwk.x : "";
  const anahtar = Buffer.alloc(32, 0x5a);
  const sarma = wrapModuleKey({ moduleKey: anahtar, recipientPublicX: acik, modul: "finance.enabled" });
  const v = (ad: string, wrap: unknown, g: { privateKey?: string; modul?: string } = {}): Vektor => ({
    tur: "modul",
    ad,
    wrap,
    privateKey: g.privateKey ?? ozel,
    modul: g.modul ?? "finance.enabled",
  });
  const sarili = b64uDecode(sarma.sarili) ?? Buffer.alloc(0);
  return [
    v("geçerli", sarma),
    v("tanınmayan alan yok sayılır", { ...sarma, fazla: 1 }),
    v("modül uyuşmuyor", sarma, { modul: "depo.multiEnabled" }),
    v("başka kurulumun anahtarı", sarma, { privateKey: baskaOzel }),
    v("sarma kurcalı", { ...sarma, sarili: b64uEncode(Buffer.from(sarili.map((b, i) => (i === 40 ? b ^ 1 : b)))) }),
    v("modül adı sarmada değiştirilmiş (HKDF bağı)", { ...sarma, modul: "depo.multiEnabled" }, { modul: "depo.multiEnabled" }),
    v("geçici anahtar sıfır (düşük mertebe)", { ...sarma, epk: b64uEncode(Buffer.alloc(32)) }),
    v("geçici anahtar 31 bayt", { ...sarma, epk: b64uEncode(Buffer.alloc(31, 1)) }),
    v("sarılı 47 bayt", { ...sarma, sarili: b64uEncode(sarili.subarray(0, 47)) }),
    v("v:2", { ...sarma, v: 2 }),
    v("modül adı geçersiz", { ...sarma, modul: "Finance" }),
    v("sarma null", null),
    v("sarma dizi", [sarma]),
    v("özel anahtar biçimsiz", sarma, { privateKey: "abc" }),
  ];
}

function tarihVektorleri(): Vektor[] {
  // Yalnız ES biçimi (UTC/ofsetli) + Zod biçimi: saat dilimsiz yerel saat ve V8'in eski
  // ayrıştırıcısı BİLEREK dışarıda (native'de NaN — `iso.rs` başlığındaki beyanlı sapma).
  const metinler = [
    "2026-01-01T00:00Z",
    "2026-01-01T00:00:00Z",
    "2026-01-01T00:00:00.1Z",
    "2026-01-01T00:00:00.1239Z",
    "2026-01-01T00:00:00.9999999Z",
    "2026-02-30T00:00:00Z",
    "2026-13-01T00:00:00Z",
    "2026-01-00T00:00:00Z",
    "2026-01-01T23:60:00Z",
    "2026-01-01T23:59:60Z",
    "2026-01-01T24:00Z",
    "2026-01-01T24:00:00.000Z",
    "2026-01-01T24:00:01Z",
    "2026",
    "2026-07",
    "2026-07-15",
    "-000001-01-01T00:00:00Z",
    "-000000-01-01T00:00:00Z",
    "+275760-09-13T00:00:00Z",
    "+275760-09-13T00:00:00.001Z",
    "2026-01-01T00:00:00.123+01:00",
    "2026-01-01T00:00:00-23:59",
    "2026-01-01T00:00:00+24:00",
    "0000-02-29T00:00Z",
    "2400-02-29T00:00:00Z",
    "9999-12-31T23:59:59.999Z",
    "2026-01-01T00:00:00.Z",
    "2026-01-01T00:00:00,5Z",
    "2026-01-01T1:00:00Z",
    " 2026-01-01T00:00:00Z",
    "garbage",
    "",
  ];
  return metinler.map((metin): Vektor => ({ tur: "tarih", ad: JSON.stringify(metin), metin }));
}

/** Verilen "şimdi" ile taze anahtarlı TAM vektör listesi. */
export function vektorleriKur(simdi: number): Vektor[] {
  const f = fiksturKur(simdi);
  return [
    ...jwsVektorleri(f),
    ...sertifikaVektorleri(f),
    ...hakVektorleri(f),
    ...kiraVektorleri(f),
    ...bagVektorleri(f),
    ...normalizeVektorleri(),
    ...ozetVektorleri(f),
    ...butunlukVektorleri(f),
    ...modulVektorleri(),
    ...kiraModulVektorleri(f),
    ...tarihVektorleri(),
  ];
}

/** Kayıt biçimi — açık anahtarlar ve imzalı belgeler; özel anahtar YOK (modül vektörünün X25519 test anahtarı hariç: yalnız o vektör için üretilir). */
export async function vektorDosyasiUret(core: LicenseCore, simdi: number): Promise<VektorDosyasi> {
  const kayitlar: VektorKaydi[] = [];
  for (const vektor of vektorleriKur(simdi)) kayitlar.push({ vektor, beklenen: await degerlendir(core, vektor) });
  return {
    bicim: VEKTOR_BICIMI,
    not: "Üreten: Teks-Erp/scripts/test_lisans_native_kahin.ts --vektor-yaz (TS kâhini). Elle düzenlenmez.",
    kayitlar,
  };
}

