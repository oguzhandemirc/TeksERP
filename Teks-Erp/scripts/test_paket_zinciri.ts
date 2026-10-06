// =============================================================================
// BEKÇİ — PAKET ANAHTARI KÖKÜN ALTINDA (D1): `protocol/paket-zinciri.ts` + Rust aynası `tekserp-dogrulama/src/paket_zinciri.rs`
// =============================================================================
// Çalıştırma: npx tsx scripts/test_paket_zinciri.ts               (DB'SİZ, ağsız)
//             npx tsx scripts/test_paket_zinciri.ts --vektor-yaz  (vektör dosyasını TS'ten yeniden üretir)
//
// NE ÖLÇER (tasarım `docs/design/PAKET-ANAHTARI-KOK-ALTINDA.md` §6):
//   §1 adlı vakalar → beklenen kod (geçerli KABUL/YERLEŞİK · kullanım yanlış · sınıf kökü aşıyor · imza anı dışı ·
//      iptalli KABUL RED / YERLEŞİK işaret · ⭐ tolerans sınırı bitiş+180g geçer, +1 ms düşer · `pkt-` olmayan kid ·
//      `paket-*`te sertifika · öteki kipin kökü KOK_BILINMIYOR · sınıf süzgeci · kid uyuşmazlığı · sertifika yok)
//   §2 PAKET iptal belgesi (yalnız kök, kendi typ'i) + `tekserp-iptal`e PAKET satırı şema RED + yüksek sıra kazanır
//   §3 vektör dosyası `native/test-vektorleri/paket-zinciri.json` (Rust `tests/paket_zinciri.rs` okur): her kaydın
//      beklenen sonucu BUGÜNKÜ TS'le aynı (bayat yok) · kapsam (her yeni kod en az bir kayıtta)
//   §4 ✓K bayatlık karşılaştırıcısı mutasyonda ısırır, eşitte susar
//
// NEGATİF SONDA (✓B, bir kezlik): `PACKAGE_ACCEPT_TOLERANCE_DAYS` 181 → §1 "tolerans +1 ms" kırmızı.
// =============================================================================
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import {
  DAY_MS,
  PACKAGE_ACCEPT_TOLERANCE_MS,
  PROTOCOL_ERROR_CODES,
  PackageRevocationSchema,
  TYP,
  isoToMs,
  msToIso,
  pickNewerPackageRevocation,
  signDocument,
  verifyPackageRevocation,
  verifyPackageSigned,
  verifyRevocation,
  type LicenseClass,
  type PackagePublicKey,
  type PackageRevocationDoc,
  type PackageVerifyMode,
  type RootKey,
} from "../src/lib/license/protocol";
import { anahtarUret, fiksturKur, hamImzala, iptalBas, iptalYuku, sertifikaBas, sertifikaYuku, type TestAnahtari } from "./lib/lisans-fikstur";
import { randomUUID } from "node:crypto";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
}

const TEKS = path.resolve(__dirname, "..");
const DOSYA = path.join(TEKS, "native", "test-vektorleri", "paket-zinciri.json");
const BICIM = 1;
const T0 = Date.parse("2026-10-01T00:00:00.000Z");

// ── Vektör türleri (JSON'a inen; `sinif` anahtarı YOKSA süzgeç yok, null = bilinmiyor) ─────────────
interface GuvenGirdisi {
  readonly keys: PackagePublicKey[];
  readonly roots: RootKey[];
  readonly mode: PackageVerifyMode;
  readonly nowMs?: number;
  readonly iptal: string | null;
  readonly sinif?: string | null;
}
type Vektor =
  | { readonly tur: "paket-imza"; readonly ad: string; readonly token: unknown; readonly typ: string; readonly guven: GuvenGirdisi }
  | { readonly tur: "paket-iptal"; readonly ad: string; readonly token: unknown; readonly roots: RootKey[] }
  | { readonly tur: "iptal"; readonly ad: string; readonly token: unknown; readonly roots: RootKey[] };
interface Kayit {
  readonly vektor: Vektor;
  readonly beklenen: unknown;
}

function jsonKopya(x: unknown): unknown {
  return x === undefined ? null : JSON.parse(JSON.stringify(x));
}

/** Bir vektörün BUGÜNKÜ TS sonucu (Rust testi aynı biçimi üretir; hata metni değil yalnız kod). */
function degerlendir(v: Vektor): unknown {
  switch (v.tur) {
    case "paket-imza": {
      const g = v.guven;
      let revocation = null;
      if (g.iptal !== null) {
        const r = verifyPackageRevocation(g.iptal, g.roots);
        if (!r.ok) return { iptalHatasi: r.code };
        revocation = r.value;
      }
      const trust = {
        keys: g.keys,
        roots: g.roots,
        mode: g.mode,
        revocation,
        ...(g.nowMs === undefined ? {} : { nowMs: g.nowMs }),
        ...("sinif" in g ? { installClass: g.sinif } : {}),
      };
      const r = verifyPackageSigned(v.token, v.typ, trust);
      if (!r.ok) return { ok: false, code: r.code };
      const c = r.value.chain;
      return {
        ok: true,
        kid: r.value.kid,
        payload: jsonKopya(r.value.payload),
        chain: c === null ? null : { sertifikaId: c.certificate.sertifikaId, kid: c.certificate.kid, rootKid: c.rootKid, revoked: c.revoked },
      };
    }
    case "paket-iptal": {
      const r = verifyPackageRevocation(v.token, v.roots);
      return r.ok ? { ok: true, sira: r.value.document.sira, rootKid: r.value.rootKid, sertifikaIdler: r.value.document.iptaller.map((e) => e.sertifikaId) } : { ok: false, code: r.code };
    }
    case "iptal": {
      const r = verifyRevocation(v.token, v.roots);
      return r.ok ? { ok: true, sira: r.value.document.sira } : { ok: false, code: r.code };
    }
  }
}

// ── Fikstür (anahtarlar çalışma anında; dosyaya yalnız açık yarılar ve imzalı belgeler girer) ───────
const f = fiksturKur(T0);
const PKT = anahtarUret("pkt-2026-1");
const PKT2 = anahtarUret("pkt-2026-2");
const ESKI = anahtarUret("paket-2026");
const ESKI_KEYS: PackagePublicKey[] = [{ kid: ESKI.kid, x: ESKI.x }];
const URETIM_KOKU: RootKey[] = [f.kokler[0]];
const YUK = { v: 1, ornek: "paket-zinciri", sayi: 7 };

function sertifika(konu: TestAnahtari, ek: Parameters<typeof sertifikaYuku>[3] = {}, imzalayan: TestAnahtari = f.kok, kullanim: "PAKET" | "INDIRME" = "PAKET") {
  const yuk = sertifikaYuku(f, konu, kullanim, ek);
  return { yuk, token: sertifikaBas(imzalayan, yuk) };
}
const SERT = sertifika(PKT);
const SERT_TEST = sertifika(PKT, { siniflar: ["TEST", "DEMO"] as LicenseClass[] });
const SERT_HAZIRLIK = sertifika(PKT, { siniflar: ["TEST"] as LicenseClass[] }, f.hazirlik);
const SERT_HAZIRLIK_ASAN = sertifika(PKT, { siniflar: ["URETIM"] as LicenseClass[] }, f.hazirlik);
const SERT_IND = sertifika(anahtarUret("ind-2026-9"), {}, f.kok, "INDIRME");
const BITIS = isoToMs(SERT.yuk.bitis);

function zincirli(imzalayan: TestAnahtari, sert: string | undefined, imzaAni: number | undefined, typ: string = TYP.SURUM, yuk: Record<string, unknown> = YUK): string {
  const p: Record<string, unknown> = { ...yuk };
  if (sert !== undefined) p.paketSertifikasi = sert;
  if (imzaAni !== undefined) p.imzaZamani = msToIso(imzaAni);
  return hamImzala(typ, imzalayan, p);
}

function paketIptalYuku(iptaller: PackageRevocationDoc["iptaller"], sira = 1): PackageRevocationDoc {
  return { v: 1, iptalId: randomUUID(), sira, verilis: msToIso(T0 - DAY_MS), iptaller };
}
function paketIptalBas(imzalayan: TestAnahtari, yuk: PackageRevocationDoc): string {
  return signDocument({ typ: TYP.PAKET_IPTAL, schema: PackageRevocationSchema, payload: yuk, key: imzalayan });
}
const IPTAL_SATIRI = { kid: PKT.kid, sertifikaId: SERT.yuk.sertifikaId, tarih: msToIso(T0 - DAY_MS), neden: "sızıntı" };
const IPTAL = paketIptalBas(f.kok, paketIptalYuku([IPTAL_SATIRI]));
const IPTAL_KID = paketIptalBas(f.kok, paketIptalYuku([{ ...IPTAL_SATIRI, sertifikaId: randomUUID() }], 2));
const IPTAL_BASKA = paketIptalBas(f.kok, paketIptalYuku([{ ...IPTAL_SATIRI, kid: PKT2.kid, sertifikaId: randomUUID() }], 3));

const GECERLI = zincirli(PKT, SERT.token, T0);
const guven = (ek: Partial<GuvenGirdisi> = {}): GuvenGirdisi => ({ keys: ESKI_KEYS, roots: f.kokler, mode: "KABUL", nowMs: T0, iptal: null, ...ek });

/** Adlı vaka + TS'in vermesi GEREKEN kod (taze üretimde sabitlenir; bayatlık ayrı ölçülür). */
const VAKALAR: { vektor: Vektor; kod: string }[] = [
  { kod: "OK", vektor: { tur: "paket-imza", ad: "geçerli KABUL", token: GECERLI, typ: TYP.SURUM, guven: guven() } },
  { kod: "OK", vektor: { tur: "paket-imza", ad: "geçerli YERLEŞİK (nowMs yok)", token: GECERLI, typ: TYP.SURUM, guven: guven({ mode: "YERLESIK", nowMs: undefined }) } },
  { kod: "OK", vektor: { tur: "paket-imza", ad: "geçerli PG typ", token: zincirli(PKT, SERT.token, T0, TYP.PG), typ: TYP.PG, guven: guven() } },
  { kod: "OK", vektor: { tur: "paket-imza", ad: "eski paket-* gömülü çapadan", token: hamImzala(TYP.SURUM, ESKI, YUK), typ: TYP.SURUM, guven: guven() } },
  { kod: "OK", vektor: { tur: "paket-imza", ad: "eski paket-* kök yokken de", token: hamImzala(TYP.SURUM, ESKI, YUK), typ: TYP.SURUM, guven: guven({ roots: [] }) } },
  { kod: "BELGE_SEMA", vektor: { tur: "paket-imza", ad: "paket-* sertifika taşıyamaz", token: zincirli(ESKI, SERT.token, T0), typ: TYP.SURUM, guven: guven() } },
  { kod: "BELGE_SEMA", vektor: { tur: "paket-imza", ad: "paket-* yalnız imza anı taşıyamaz", token: zincirli(ESKI, undefined, T0), typ: TYP.SURUM, guven: guven() } },
  { kod: "JWS_KID", vektor: { tur: "paket-imza", ad: "paket-* süzülmüş anahtar", token: hamImzala(TYP.SURUM, ESKI, YUK), typ: TYP.SURUM, guven: guven({ keys: [] }) } },
  { kod: "GUVEN_CAPASI_BOS", vektor: { tur: "paket-imza", ad: "pkt-* kök yok", token: GECERLI, typ: TYP.SURUM, guven: guven({ roots: [] }) } },
  { kod: "JWS_TYP", vektor: { tur: "paket-imza", ad: "pkt-* typ yanlış", token: GECERLI, typ: TYP.PG, guven: guven() } },
  { kod: "PAKET_SERTIFIKA_YOK", vektor: { tur: "paket-imza", ad: "pkt-* sertifika yok", token: zincirli(PKT, undefined, T0), typ: TYP.SURUM, guven: guven() } },
  { kod: "PAKET_SERTIFIKA_YOK", vektor: { tur: "paket-imza", ad: "pkt-* imza anı yok", token: zincirli(PKT, SERT.token, undefined), typ: TYP.SURUM, guven: guven() } },
  { kod: "SERTIFIKA_KULLANIM", vektor: { tur: "paket-imza", ad: "kullanım yanlış (INDIRME)", token: zincirli(PKT, SERT_IND.token, T0), typ: TYP.SURUM, guven: guven() } },
  { kod: "BELGE_SEMA", vektor: { tur: "paket-imza", ad: "PAKET sertifikasında pkt- olmayan kid", token: zincirli(PKT, hamImzala(TYP.SERTIFIKA, f.kok, { ...sertifikaYuku(f, ESKI, "PAKET") }), T0), typ: TYP.SURUM, guven: guven() } },
  { kod: "KOK_SINIF_YETKISIZ", vektor: { tur: "paket-imza", ad: "sınıf kökü aşıyor", token: zincirli(PKT, SERT_HAZIRLIK_ASAN.token, T0), typ: TYP.SURUM, guven: guven() } },
  { kod: "KOK_BILINMIYOR", vektor: { tur: "paket-imza", ad: "öteki kipin kökü", token: zincirli(PKT, SERT_HAZIRLIK.token, T0), typ: TYP.SURUM, guven: guven({ roots: URETIM_KOKU }) } },
  { kod: "PAKET_SERTIFIKA_ZAMAN", vektor: { tur: "paket-imza", ad: "imza anı bitişten sonra", token: zincirli(PKT, SERT.token, BITIS + DAY_MS), typ: TYP.SURUM, guven: guven({ mode: "YERLESIK" }) } },
  { kod: "PAKET_SERTIFIKA_ZAMAN", vektor: { tur: "paket-imza", ad: "imza anı başlangıçtan önce", token: zincirli(PKT, SERT.token, T0 - 30 * DAY_MS), typ: TYP.SURUM, guven: guven({ mode: "YERLESIK" }) } },
  { kod: "JWS_KID", vektor: { tur: "paket-imza", ad: "sertifika başka pkt anahtarının", token: zincirli(PKT2, SERT.token, T0), typ: TYP.SURUM, guven: guven() } },
  { kod: "JWS_IMZA", vektor: { tur: "paket-imza", ad: "kurcalı imza", token: `${GECERLI.slice(0, -4)}AAAA`, typ: TYP.SURUM, guven: guven() } },
  { kod: "PAKET_SERTIFIKA_IPTAL", vektor: { tur: "paket-imza", ad: "iptalli KABUL", token: GECERLI, typ: TYP.SURUM, guven: guven({ iptal: IPTAL }) } },
  { kod: "PAKET_SERTIFIKA_IPTAL", vektor: { tur: "paket-imza", ad: "iptalli KABUL (yalnız kid eşleşir)", token: GECERLI, typ: TYP.SURUM, guven: guven({ iptal: IPTAL_KID }) } },
  { kod: "OK", vektor: { tur: "paket-imza", ad: "iptal başka sertifikanın", token: GECERLI, typ: TYP.SURUM, guven: guven({ iptal: IPTAL_BASKA }) } },
  { kod: "OK", vektor: { tur: "paket-imza", ad: "iptalli YERLEŞİK işaretli geçer", token: GECERLI, typ: TYP.SURUM, guven: guven({ mode: "YERLESIK", iptal: IPTAL }) } },
  { kod: "OK", vektor: { tur: "paket-imza", ad: "tolerans sınırı bitiş+180g", token: GECERLI, typ: TYP.SURUM, guven: guven({ nowMs: BITIS + PACKAGE_ACCEPT_TOLERANCE_MS }) } },
  { kod: "PAKET_SERTIFIKA_ZAMAN", vektor: { tur: "paket-imza", ad: "tolerans +1 ms", token: GECERLI, typ: TYP.SURUM, guven: guven({ nowMs: BITIS + 180 * DAY_MS + 1 }) } },
  { kod: "PAKET_SERTIFIKA_ZAMAN", vektor: { tur: "paket-imza", ad: "KABUL nowMs yok", token: GECERLI, typ: TYP.SURUM, guven: guven({ nowMs: undefined }) } },
  { kod: "OK", vektor: { tur: "paket-imza", ad: "YERLEŞİK tolerans dışında da geçer", token: GECERLI, typ: TYP.SURUM, guven: guven({ mode: "YERLESIK", nowMs: BITIS + 400 * DAY_MS }) } },
  { kod: "OK", vektor: { tur: "paket-imza", ad: "sınıf kümede", token: zincirli(PKT, SERT_TEST.token, T0), typ: TYP.SURUM, guven: guven({ sinif: "TEST" }) } },
  { kod: "PAKET_SERTIFIKA_SINIF", vektor: { tur: "paket-imza", ad: "sınıf kümede değil", token: zincirli(PKT, SERT_TEST.token, T0), typ: TYP.SURUM, guven: guven({ sinif: "URETIM" }) } },
  { kod: "PAKET_SERTIFIKA_SINIF", vektor: { tur: "paket-imza", ad: "sınıf bilinmiyor (null)", token: GECERLI, typ: TYP.SURUM, guven: guven({ sinif: null }) } },
  { kod: "OK", vektor: { tur: "paket-imza", ad: "eski paket-* sınıf süzgecinden etkilenmez", token: hamImzala(TYP.SURUM, ESKI, YUK), typ: TYP.SURUM, guven: guven({ sinif: null }) } },
  { kod: "OK", vektor: { tur: "paket-iptal", ad: "geçerli", token: IPTAL, roots: f.kokler } },
  { kod: "OK", vektor: { tur: "paket-iptal", ad: "hazırlık kökü imzalar", token: paketIptalBas(f.hazirlik, paketIptalYuku([IPTAL_SATIRI])), roots: f.kokler } },
  { kod: "KOK_BILINMIYOR", vektor: { tur: "paket-iptal", ad: "pkt anahtarı imzalayamaz", token: hamImzala(TYP.PAKET_IPTAL, PKT, paketIptalYuku([IPTAL_SATIRI])), roots: f.kokler } },
  { kod: "JWS_TYP", vektor: { tur: "paket-iptal", ad: "tekserp-iptal türü kabul edilmez", token: hamImzala(TYP.IPTAL, f.kok, paketIptalYuku([IPTAL_SATIRI])), roots: f.kokler } },
  { kod: "BELGE_SEMA", vektor: { tur: "paket-iptal", ad: "satır kid pkt- değil", token: hamImzala(TYP.PAKET_IPTAL, f.kok, paketIptalYuku([{ ...IPTAL_SATIRI, kid: "alt-2026-1" }])), roots: f.kokler } },
  { kod: "BELGE_SEMA", vektor: { tur: "paket-iptal", ad: "tekrarlı sertifika", token: hamImzala(TYP.PAKET_IPTAL, f.kok, paketIptalYuku([IPTAL_SATIRI, IPTAL_SATIRI])), roots: f.kokler } },
  { kod: "GUVEN_CAPASI_BOS", vektor: { tur: "paket-iptal", ad: "kök yok", token: IPTAL, roots: [] } },
  { kod: "OK", vektor: { tur: "iptal", ad: "tekserp-iptal ALT satırı", token: iptalBas(f.kok, iptalYuku(f, { iptaller: [{ kid: "alt-2026-1", sertifikaId: randomUUID(), kullanim: "ALT", tarih: msToIso(T0 - DAY_MS), neden: "x" }] })), roots: f.kokler } },
  { kod: "BELGE_SEMA", vektor: { tur: "iptal", ad: "tekserp-iptal PAKET satırı RED", token: hamImzala(TYP.IPTAL, f.kok, { ...iptalYuku(f), iptaller: [{ kid: PKT.kid, sertifikaId: randomUUID(), kullanim: "PAKET", tarih: msToIso(T0 - DAY_MS), neden: "x" }] }), roots: f.kokler } },
];

function kodu(b: unknown): string {
  const r = b as { ok?: boolean; code?: string; iptalHatasi?: string };
  if (r.iptalHatasi) return `IPTAL:${r.iptalHatasi}`;
  return r.ok ? "OK" : String(r.code);
}

function bayatlar(kayitlar: readonly Kayit[]): string[] {
  return kayitlar.filter((k) => JSON.stringify(degerlendir(k.vektor)) !== JSON.stringify(k.beklenen)).map((k) => `${k.vektor.tur}:${k.vektor.ad}`);
}

const TAZE: Kayit[] = VAKALAR.map((v) => ({ vektor: jsonKopya(v.vektor) as Vektor, beklenen: degerlendir(v.vektor) }));

function bolum1(): void {
  console.log("\n§1 — adlı vakalar (paket imzası · iptal belgeleri)");
  for (const v of VAKALAR) {
    const got = kodu(degerlendir(v.vektor));
    check(`§1 ${v.vektor.tur} · ${v.vektor.ad} → ${v.kod}`, got === v.kod, got === v.kod ? "" : `gelen ${got}`);
  }
  const ok = degerlendir(VAKALAR[0].vektor) as { payload?: Record<string, unknown>; chain?: { revoked: boolean } };
  check("§1z dönen yükten zincir alanları ayıklanır", JSON.stringify(ok.payload) === JSON.stringify(YUK));
  const yer = degerlendir(VAKALAR.find((v) => v.vektor.ad === "iptalli YERLEŞİK işaretli geçer")!.vektor) as { chain?: { revoked: boolean } };
  check("§1y YERLEŞİK iptal yalnız işaret (chain.revoked=true)", yer.chain?.revoked === true && ok.chain?.revoked === false);
}

function bolum2(): void {
  console.log("\n§2 — PAKET iptal: yüksek sıra kazanır");
  const a = verifyPackageRevocation(IPTAL, f.kokler);
  const b = verifyPackageRevocation(IPTAL_KID, f.kokler);
  if (!a.ok || !b.ok) return check("§2 fikstür iptalleri doğrulanır", false);
  check("§2a yüksek sıra gelen kazanır", pickNewerPackageRevocation(a.value, b.value) === b.value);
  check("§2b düşük sıra gelen yok sayılır", pickNewerPackageRevocation(b.value, a.value) === b.value);
  check("§2c eşit sıra yok sayılır (mevcut kalır)", pickNewerPackageRevocation(a.value, { ...a.value }) === a.value);
  check("§2d boş + gelen = gelen; mevcut + null = mevcut", pickNewerPackageRevocation(null, a.value) === a.value && pickNewerPackageRevocation(a.value, null) === a.value);
}

function dosyaOku(): { bicim: number; kayitlar: Kayit[] } | null {
  if (!existsSync(DOSYA)) return null;
  return JSON.parse(readFileSync(DOSYA, "utf8")) as { bicim: number; kayitlar: Kayit[] };
}

function bolum3(): void {
  console.log("\n§3 — vektör dosyası (native/test-vektorleri/paket-zinciri.json)");
  const d = dosyaOku();
  check(`§3a dosya var ve biçim ${BICIM}`, d !== null && d.bicim === BICIM && d.kayitlar.length === VAKALAR.length, d ? `${d.kayitlar.length} kayıt` : "yok — --vektor-yaz");
  if (!d) return;
  const bayat = bayatlar(d.kayitlar);
  check("§3b ⭐ bayat değil (beklenen = bugünkü TS)", bayat.length === 0, bayat.slice(0, 5).join(" · ") || "temiz");
  const adlar = new Set(VAKALAR.map((v) => `${v.vektor.tur}:${v.vektor.ad}`));
  check("§3c dosyadaki adlar = vaka adları (tekil)", adlar.size === VAKALAR.length && d.kayitlar.every((k) => adlar.has(`${k.vektor.tur}:${k.vektor.ad}`)));
  const kodlar = new Set(d.kayitlar.map((k) => kodu(k.beklenen)));
  const gereken = PROTOCOL_ERROR_CODES.filter((c) => c.startsWith("PAKET_SERTIFIKA_"));
  check("§3d kapsam: her PAKET_SERTIFIKA_* kodu en az bir kayıtta", gereken.length === 4 && gereken.every((c) => kodlar.has(c)), gereken.filter((c) => !kodlar.has(c)).join(",") || `${gereken.length} kod`);
}

function bolum4(): void {
  console.log("\n§4 — ✓K kalıcı sonda");
  const saglam = TAZE.slice(0, 3);
  check("§4a bayatlık denetimi özdeş kayıtta SUSAR", bayatlar(saglam).length === 0);
  const bozuk = saglam.map((k, i) => (i === 1 ? { ...k, beklenen: { ok: false, code: "JWS_IMZA" } } : k));
  check("§4b bayatlık denetimi mutasyonlu beklenende ISIRIR", bayatlar(bozuk).length === 1);
}

function vektorYaz(): void {
  mkdirSync(path.dirname(DOSYA), { recursive: true });
  const bas = JSON.stringify({ bicim: BICIM, not: "Üreten: Teks-Erp/scripts/test_paket_zinciri.ts --vektor-yaz (TS kâhini). Elle düzenlenmez." });
  writeFileSync(DOSYA, `${bas.slice(0, -1)},"kayitlar":[\n${TAZE.map((k) => JSON.stringify(k)).join(",\n")}\n]}\n`);
  console.log(`✓ ${path.relative(TEKS, DOSYA)} — ${TAZE.length} kayıt`);
}

function main(): void {
  if (process.argv.includes("--vektor-yaz")) return vektorYaz();
  bolum1();
  bolum2();
  bolum3();
  bolum4();
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
