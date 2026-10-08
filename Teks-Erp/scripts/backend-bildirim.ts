// =============================================================================
// BACKEND SÜRÜM BİLDİRİMİ + PG PAKETİ KÜNYESİ (Dağıtım v2, docs/design/GUNCELLEYICI.md §1 · §1.6)
// =============================================================================
// Satıcı Mac'inde koşar; imza anahtarı CI'a ve pakete GİRMEZ. Yayıncı `deploy/backend-yayinla.mjs` çağırır.
//
//   npx tsx scripts/backend-bildirim.ts dogrula --zip=<paket.zip> --kanal=<kod> --kanal-turu=<uretim|hazirlik>
//       --guven-capasi=uretim --pg-cizgi=<16> --pg-en-az=<16.9> [--pg-kunye=<pg.json>] --ozet-dosyasi=<txt> --cikti=<dizin> [--min-kaynak=<sürüm>] [--zorunlu]
//   npx tsx scripts/backend-bildirim.ts imzala  … aynı … --anahtar=<PAKET anahtar dosyası>
//   npx tsx scripts/backend-bildirim.ts pg-imzala --zip=<PG sahne zip> --anahtar=<PAKET anahtar dosyası> --cikti=<dizin>
//       [--cizgi --surum --derleme --icu]: künye alanları deploy/pg/pg-surumu.json'dan (TEK KAYNAK); verilen argüman
//       kayıttan farklıysa DUR. Zip'te TEK `bin/icuuc<N>.dll` olmalı ve N = kaydın icuSurum'u.
//   npx tsx scripts/backend-bildirim.ts pg-dogrula --kunye=<pg.json> --zip=<PG sahne zip> --guven-capasi=<kip> --cikti=<dizin>
//   npx tsx scripts/backend-bildirim.ts dogrula|imzala --ortak --zip=<paket.zip> --kanal=<GRUP> --guven-capasi=uretim ...
//       (O11b: ORTAK paket güncelleme grubuna; --kanal = grup kodu, künye kanal/müşteri taşımaz, kip yalnız üretim)
//   npx tsx scripts/backend-bildirim.ts ortak-dogrula --zip=<paket.zip> --guven-capasi=uretim --pg-cizgi=<16> --pg-en-az=<16.9>
//       [--pg-kunye=<pg.json>] --cikti=<dizin>   (kurulum arşivi, O11a: ORTAK paket — kanal/grup yok, bildirim KURULMAZ)
//   npx tsx scripts/backend-bildirim.ts dogrula|imzala --ortak --tar=<tekserp-backend-oci-<sürüm>.tar> --kanal=<GRUP> ...
//       (sözleşme 5, `linux-x64-oci`: Linux/OCI teslim paketi — `scripts/lib/oci-paket.ts` dış zinciri ve imaj içi
//       imzayı TAM ölçer, imzasız taban RED; PG hedefi yok, `--pg-kunye` RED; sonuc.json `ciKokeni` imaj içi yükten)
//   npx tsx scripts/backend-bildirim.ts imaj-kimlik --arsiv=<imaj .tar.gz>   → stdout `sha256:<config özeti>` (Docker'sız)
//
// PAKET çapası kanalın çapa KİPİNDEN (G3; yayıncı kanal kaydının `backend.guvenCapasi`sını verir): o kanalın
// kurulumları yalnız o kipin PAKET anahtarlarına güvenir — öteki kipin imzalı paketi/PG künyesi burada DURUR.
//
// dogrula/imzala: zip'i geçici dizine açar, imzalı dosya listesini (`butunluk.jws`) PAKET çapasıyla TAM denetler
//   (GEÇERLİ değilse DUR), künyeyi `PAKET.json`la ve kanalla bağlar, bildirimi kurar; imzada paketi imzalayan
//   anahtarla imzalar (parola TTY'de gizli ya da stdin satırı — argümandan ASLA) ve geri doğrular.
//   `--pg-kunye` verilirse PG hedefi O KÜNYEDEN (imzası doğrulanarak) alınır; verilmezse hedef yok (küçük sürüm
//   güncellemesi olmaz). Çıktı `<cikti>/sonuc.json` + imzada `<cikti>/surum.json` (işaretçi).
// pg-imzala: PG sahne zip'inin boyu/özeti ölçülür; içerik özeti zip'teki `TEKSERP-ICERIK.sha256`dan ÖLÇÜLÜR (elle
//   yazılmaz), `bin/icuuc<icu>.dll` aranır; künye imzalanır → `<cikti>/pg.json` + `<cikti>/sonuc.json`.
// ortak-dogrula: ortak paketi (PAKET.json backendKanal null, künye müşterisiz) ÜRETİM çapasıyla TAM denetler; hazırlık
//   anahtarı, PROVA ve test çapası RED. Zincirli (`pkt-*`) liste kök çapasıyla (KABUL kipi) doğrulanır.
// ZİNCİR (3.9 D5): pakette `butunluk.jws` (paket-*) ve/veya `butunluk-zincir.jws` (pkt-*, kök imzalı PAKET sertifikası)
//   bulunur; ikisi varsa AYNI paket. `imzala`/`pg-imzala` `--anahtar` + `--zincir-anahtar` → eski takım (`surum.json`/
//   `pg.json`) + zincir takımı (`surum-zincir.json`/`pg-zincir.json`), her biri kendi kid'iyle, aynı yayinZamani. Kök
//   çapası `--kok-dosyasi` > test kök çapası (`--kok-capa` / `TEKSERP_TEST_KOK_CAPASI`, test çapasıyla AYNI kural) > üretim.
// yeniden-imzala (--surum-kunye=<surum(-zincir…).json> --zip=<yayındaki zip> | --surum-dizini=<yayındaki sürüm dizini>)
//   --anahtar=<pkt> --cikti=<dizin> [--kanal=<grup>] [--paket-iptal=<kök imzalı dağıtım iptali>] [--kok-dosyasi=<kök.json>]:
//   yayındaki sürümü YENİ PAKET sertifikasıyla yeniden imzalar (yıllık tören): sürüm/paketId/liste aynı,
//   `<ad>-<kid>.zip` + `surum-zincir-<kid>.json` (D8: değişmez dizinde YANINA). Eski takım dokunulmaz. Dizin kipinde
//   bütün zincirli adlar aday (seçim kuralı `selectChainedDocument`, YERLEŞİK + verilen iptal); zincirli aday yoksa ya
//   da hepsi geçersizse eski `surum.json` (elenenler ekrana).
// pg-yeniden-imzala (--kunye=<pg(-zincir…).json> | --pg-dizini=<d>) --anahtar=<pkt> --cikti=<dizin> [--zip] [--paket-iptal]
//   → `pg-zincir-<kid>.json` (zip değişmez).
// pg-dogrula: künyenin imzası (PAKET çapası) + zip'in boyu/özeti künyeyle birebir → `<cikti>/sonuc.json` (yayıncı okur).
// Test çapası (`--capa=<json>` ya da ortam `TEKSERP_TEST_PAKET_CAPASI`) YALNIZ bekçiler içindir ve backend
// bildiriminde YALNIZ hazırlık kanalında kabul edilir; gerçek çapa `packagePublicKeysFor(<kanalın kipi>)`.
// =============================================================================
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CHAINED_INTEGRITY_FILE,
  CHAINED_PG_POINTER_FILE,
  CHAINED_RELEASE_MANIFEST_FILE,
  PG_POINTER_FILE,
  RELEASE_MANIFEST_FILE,
  chainedFileName,
  chainedPgCandidate,
  chainedReleaseCandidate,
  parseChainedFileName,
  selectChainedDocument,
  type ChainedFamily,
  IcuVersionSchema,
  PgPackageManifestSchema,
  ReleaseManifestSchema,
  TYP,
  isChainPackageKid,
  signChainedPackageDocument,
  PgBuildSchema,
  PgMajorSchema,
  PgRequirementSchema,
  PgVersionSchema,
  ReleaseVersionSchema,
  compareVersions,
  parseJws,
  readReleasePointer,
  releasePointerText,
  signPgPackageManifest,
  signReleaseManifest,
  verifyPgPackageManifest,
  verifyReleaseManifest,
  type PgPackageManifest,
  type PgRequirement,
  type ReleaseManifest,
  type PackageTrust,
  type TrustAnchorMode,
  isTrustAnchorMode,
} from "../src/lib/license/protocol";
import { packagePublicKeysFor, verifyIntegrity, type PackageKey } from "../src/lib/license/integrity";
import type { ZodType } from "zod";
import { INTEGRITY_FILE, isProductionChainPackageKid, isProductionPackageKid } from "../src/lib/license/integrity-scope";
import { openPackageKey, packageKeyInfo, resignChainedIntegrity, type OpenedPackageKey } from "./lib/butunluk-imza";
import { assertPackageCertificateFresh, packageRoots, readPackageCertificate, readPackageRevocationFile } from "./lib/paket-sertifika";
import { PACKAGE_CERT_FIELD, PACKAGE_REVOCATION_FILE, type VerifiedPackageRevocation } from "../src/lib/license/protocol/paket-zinciri";
import { CliError, args, askPassword, kasaAdiKid } from "./lib/cli-girdi";
import { OCI_PLATFORM, ociPaketAdi, ociPaketiAc } from "./lib/oci-paket";
import { imajArsiviOlc } from "./lib/oci-arsiv";

type Bayraklar = ReadonlyMap<string, string>;

function sha256Dosya(yol: string): string {
  return createHash("sha256").update(fs.readFileSync(yol)).digest("hex");
}

function gerek(f: Bayraklar, ad: string): string {
  const v = f.get(ad);
  if (!v) throw new CliError(`--${ad}=… gerekli`);
  return v;
}

/** Kanalın çapa kipi (zorunlu; tanınmayan kip RED — örtük üretim/birleşik çapa yok). Üretim kanalı yalnız üretim. */
function capaKipi(f: Bayraklar, kanalTuru: string | null): TrustAnchorMode {
  const kip = gerek(f, "guven-capasi");
  if (!isTrustAnchorMode(kip)) throw new CliError(`--guven-capasi uretim (tek çapa kipi; gelen: ${kip})`);
  if (kanalTuru === "uretim" && kip !== "uretim") throw new CliError("üretim kanalı yalnız ÜRETİM çapasıyla yayınlanır (kanal kaydı backend.guvenCapasi)");
  return kip;
}

function capaOku(f: Bayraklar, kanalTuru: string | null): readonly PackageKey[] {
  const kip = capaKipi(f, kanalTuru);
  const dosya = f.get("capa") ?? process.env.TEKSERP_TEST_PAKET_CAPASI;
  if (!dosya) return packagePublicKeysFor(kip);
  if (kanalTuru !== null && kanalTuru !== "hazirlik") throw new CliError("test çapası yalnız hazırlık kanalında kabul edilir");
  console.error("⚠ TEST ÇAPASI kullanılıyor — yalnız bekçi içindir");
  return JSON.parse(fs.readFileSync(dosya, "utf8")) as PackageKey[];
}

/** Zincir güveni: kök çapası, KABUL kipi (yayıncı yeni imzayı denetler). Test kökü test çapasıyla aynı yerde serbest. */
function zincirGuveni(f: Bayraklar, kanalTuru: string | null): Omit<PackageTrust, "keys"> {
  const testIzinli = kanalTuru === null || kanalTuru === "hazirlik";
  const r = packageRoots({ kokDosyasi: f.get("kok-dosyasi") ?? null, testCapa: f.get("kok-capa") ?? null, testIzinli });
  return { roots: r.roots, mode: "KABUL", nowMs: Date.now() };
}

interface Imzaci {
  readonly dosya: string;
  readonly kid: string;
  /** pkt-* ise kök imzalı PAKET sertifikası; paket-* ise null. */
  readonly sertifika: string | null;
}

/** `--anahtar` (+ `--zincir-anahtar`) → imzacılar; pkt-* sertifikası + tazeliği parola ÖNCESİ denetlenir. */
function imzacilar(f: Bayraklar): Imzaci[] {
  const zincirDosyasi = f.get("zincir-anahtar");
  const out = [gerek(f, "anahtar"), ...(zincirDosyasi ? [zincirDosyasi] : [])].map((dosya): Imzaci => {
    const kid = packageKeyInfo(dosya).kid;
    if (!isChainPackageKid(kid)) return { dosya, kid, sertifika: null };
    const sertifika = readPackageCertificate({ keyFile: dosya, kid });
    assertPackageCertificateFresh(sertifika);
    return { dosya, kid, sertifika };
  });
  if (zincirDosyasi && (out[0]!.sertifika !== null || out[1]!.sertifika === null)) {
    throw new CliError("--zincir-anahtar çift imza içindir: --anahtar paket-*, --zincir-anahtar pkt-*");
  }
  return out;
}

/** Gömülü çapalı imza ya da (pkt-*) şemadan geçip iki zincir alanıyla imza. */
function belgeImzala<T extends Record<string, unknown>>(typ: string, schema: ZodType<T>, yuk: T, key: OpenedPackageKey, sertifika: string | null, gomulu: () => string): string {
  if (sertifika === null) return gomulu();
  return signChainedPackageDocument({ typ, schema, payload: yuk, key: { kid: key.kid, privateKey: key.privateKey }, certificate: sertifika, signedAt: new Date().toISOString() });
}

/** Takım: imzalanan işaretçi ailesi — `eski` (surum.json) · `zincir` (surum-zincir.json) · `cift`. */
function takimOf(eski: boolean, zincir: boolean): "eski" | "zincir" | "cift" {
  return eski && zincir ? "cift" : zincir ? "zincir" : "eski";
}

function paketAnahtari(dosya: string) {
  return openPackageKey(dosya, (kid) => askPassword(`PAKET anahtarı (${kid}) parolası: `, kasaAdiKid(kid)));
}

// ── PG gereksinimi (backend bildiriminin `pg` bloğu) ─────────────────────────
function pgGereksinimi(f: Bayraklar, capa: readonly PackageKey[], zincir: Omit<PackageTrust, "keys">): PgRequirement {
  const cizgi = PgMajorSchema.safeParse(Number(gerek(f, "pg-cizgi")));
  if (!cizgi.success) throw new CliError("--pg-cizgi PostgreSQL ana sürümü (ör. 16)");
  const enAz = gerek(f, "pg-en-az");
  if (!PgVersionSchema.safeParse(enAz).success) throw new CliError(`--pg-en-az ana.küçük biçiminde olmalı (ör. 16.9): ${enAz}`);
  let hedef: PgRequirement["hedef"] = null;
  const kunyeDosyasi = f.get("pg-kunye");
  if (kunyeDosyasi) {
    const k = pgKunyesiDogrula(kunyeDosyasi, { keys: capa, zincir });
    if (k.cizgi !== cizgi.data) throw new CliError(`PG künyesi ${k.cizgi} ana sürümünün, bildirim çizgisi ${cizgi.data} — ana sürüm geçişi otomatik değildir`);
    hedef = { surum: k.surum, derleme: k.derleme, paket: k.paket, icerikSha256: k.icerikSha256, icuSurum: k.icuSurum };
  }
  const p = PgRequirementSchema.safeParse({ cizgi: cizgi.data, enAz, hedef });
  if (!p.success) throw new CliError(`PG gereksinimi geçersiz: ${p.error.issues[0]?.message ?? "şema"}`);
  return p.data;
}

/**
 * PG künyesi dosyası: zincirli ailenin ön ekini taşıyan ad (`pg-zincir[-<kid>].json`) TEK adaylı seçimden geçer (ad kid'i =
 * imzalayan · pkt-* sertifikalı · iptalsiz; aileye uymayan ad RED); diğer adlar (`pg.json`) tek belge doğrulamasıyla.
 */
function pgKunyesiDogrula(dosya: string, guven: { readonly keys: readonly PackageKey[]; readonly zincir: Omit<PackageTrust, "keys"> }): PgPackageManifest {
  const ad = path.basename(dosya);
  const metin = fs.readFileSync(dosya, "utf8");
  if (ad.startsWith(CHAINED_PG_POINTER_FILE.replace(/\.json$/, ""))) {
    const secim = selectChainedDocument<PgPackageManifest>("pg", [chainedPgCandidate(ad, metin, guven)]);
    if (!secim?.ok) throw new CliError(`PG künyesi doğrulanamadı: ${secim?.code ?? "SURUM_ISARETCI"} — ${secim?.message ?? ad}`);
    return secim.value.value;
  }
  const isaretci = readReleasePointer(metin);
  if (!isaretci.ok) throw new CliError(`PG künyesi okunamadı: ${isaretci.code}`);
  const k = verifyPgPackageManifest(isaretci.value, guven);
  if (!k.ok) throw new CliError(`PG künyesi doğrulanamadı: ${k.code}`);
  return k.value;
}

// ── Backend bildirimi ───────────────────────────────────────────────────────
interface PaketKunyesi {
  readonly korumali?: unknown;
  readonly korumaHedef?: unknown;
  readonly backendKanal?: unknown;
  readonly prova?: unknown;
  readonly commit?: unknown;
  readonly uygulamaSurumu?: unknown;
  readonly migrationSayisi?: unknown;
  readonly runtimeNodeSurumu?: unknown;
}

interface BackendGirdisi {
  /** Windows zip'i (`win32-x64`) ya da Linux/OCI dış tar'ı (`linux-x64-oci`) — tam biri. */
  readonly zip: string | null;
  readonly tar: string | null;
  readonly kanal: string;
  readonly kanalTuru: string;
  readonly minKaynak: string | null;
  readonly zorunlu: boolean;
  readonly ozet: string;
  readonly pg: PgRequirement;
  readonly capa: readonly PackageKey[];
  readonly zincir: Omit<PackageTrust, "keys">;
  /** O11b: ortak paket güncelleme grubuna (kanal = grup kodu); künye kanal/müşteri taşımaz. */
  readonly ortak: boolean;
}

function backendGirdisi(f: Bayraklar): BackendGirdisi {
  const ortak = f.has("ortak");
  // Ortak paketin grubu üretim sınıfıdır (hazırlık kanalı kalktı); kip yalnız üretim, `ortak-dogrula` ile aynı kural.
  if (ortak && f.has("kanal-turu") && f.get("kanal-turu") !== "uretim") throw new CliError("ortak paket güncelleme grubuna yalnız üretim sınıfıyla çıkar (--kanal-turu verilmeyebilir)");
  const kanalTuru = ortak ? "uretim" : gerek(f, "kanal-turu");
  if (kanalTuru !== "uretim" && kanalTuru !== "hazirlik") throw new CliError("--kanal-turu uretim | hazirlik");
  if (ortak && gerek(f, "guven-capasi") !== "uretim") throw new CliError("ortak paket yalnız ÜRETİM çapasıyla doğrulanır (--guven-capasi=uretim)");
  const minKaynak = f.get("min-kaynak") ?? null;
  if (minKaynak !== null && !ReleaseVersionSchema.safeParse(minKaynak).success) throw new CliError(`--min-kaynak sürüm biçiminde değil: ${minKaynak}`);
  const ozet = fs.readFileSync(gerek(f, "ozet-dosyasi"), "utf8").trim();
  if (ozet.length === 0 || ozet.length > 2000) throw new CliError(`sürüm özeti 1–2000 karakter olmalı (${ozet.length})`);
  // Ortakta test çapası bekçi içindir (ortak-dogrula ile aynı: kip yine üretim); yayıncı gerçek yüklemede onu reddeder.
  const capa = capaOku(f, ortak ? null : kanalTuru);
  const zincir = zincirGuveni(f, ortak ? null : kanalTuru);
  const tar = f.get("tar");
  if (tar !== undefined) {
    if (!ortak) throw new CliError("Linux/OCI paketi (--tar) yalnız ortak paket olarak güncelleme grubuna çıkar (--ortak)");
    if (f.has("zip")) throw new CliError("--zip ve --tar birlikte verilmez (tek paket: Windows zip'i YA DA Linux/OCI tar'ı)");
    // Konteyner PG'si bu bildirimle gelmez (sözleşme 5 şeması `pg.hedef` null ister); hedef künyesi RED.
    if (f.has("pg-kunye")) throw new CliError("--pg-kunye Linux/OCI bildiriminde verilmez (linux-x64-oci PG hedefi taşımaz)");
  }
  const pg = pgGereksinimi(f, capa, zincir);
  return { zip: tar === undefined ? path.resolve(gerek(f, "zip")) : null, tar: tar === undefined ? null : path.resolve(gerek(f, "tar")), kanal: gerek(f, "kanal"), kanalTuru, minKaynak, zorunlu: f.has("zorunlu"), ozet, pg, capa, zincir, ortak };
}

interface AcilanPaket {
  readonly kunye: PaketKunyesi;
  readonly p: NonNullable<Awaited<ReturnType<typeof verifyIntegrity>>["paket"]>;
  /** Birincil imzacı: `butunluk.jws` varsa onun kid'i, yoksa zincirli imzanınki. */
  readonly kid: string;
  /** `butunluk.jws` imzacısı (paket-*); zincir-yalnız pakette null. */
  readonly eskiKid: string | null;
  /** `butunluk-zincir.jws` imzacısı (pkt-*); yoksa null. */
  readonly zincirKid: string | null;
}

/** İki imza dosyasının her biri kendi güveniyle TAM denetlenir; ikisi varsa yükler AYNI paket. En az biri olmalı. */
async function imzalariDenetle(tmp: string, capa: readonly PackageKey[], zincir: Omit<PackageTrust, "keys">, hedef: string): Promise<{ p: AcilanPaket["p"]; eskiKid: string | null; zincirKid: string | null }> {
  const sonuc: { dosya: string; p: AcilanPaket["p"]; kid: string }[] = [];
  for (const dosya of [INTEGRITY_FILE, CHAINED_INTEGRITY_FILE]) {
    const yol = path.join(tmp, dosya);
    if (!fs.existsSync(yol)) continue;
    const jws = fs.readFileSync(yol, "utf8").trim();
    const baslik = parseJws(jws);
    if (!baslik.ok) throw new CliError(`${dosya} ayrıştırılamadı: ${baslik.code}`);
    const kid = baslik.value.header.kid;
    if ((dosya === CHAINED_INTEGRITY_FILE) !== isChainPackageKid(kid)) throw new CliError(`${dosya} ${kid} anahtarıyla imzalı — dosya ile anahtar ailesi uyuşmuyor`);
    const rapor = dosya === INTEGRITY_FILE ? await verifyIntegrity(jws, tmp, capa) : await verifyIntegrity(jws, tmp, [], zincir);
    if (rapor.durum !== "GECERLI" || !rapor.paket) throw new CliError(`paket bütünlüğü ${rapor.durum} (${rapor.kod ?? "?"}) [${dosya}] — imzasız/kurcalı paket ${hedef}`);
    sonuc.push({ dosya, p: rapor.paket, kid });
  }
  if (sonuc.length === 0) throw new CliError(`pakette ${INTEGRITY_FILE} da ${CHAINED_INTEGRITY_FILE} de yok — imzasız paket ${hedef}`);
  const [a, b] = sonuc;
  if (b && JSON.stringify(a!.p) !== JSON.stringify(b.p)) throw new CliError(`iki imza dosyası aynı paketi anlatmıyor (paketId ${a!.p.paketId} ↔ ${b.p.paketId})`);
  return { p: a!.p, eskiKid: sonuc.find((x) => x.dosya === INTEGRITY_FILE)?.kid ?? null, zincirKid: sonuc.find((x) => x.dosya === CHAINED_INTEGRITY_FILE)?.kid ?? null };
}

/** Kanala özel paket (eski yol): künye kanal/müşteriyle bağlanır. */
async function kanalPaketiAc(tmp: string, g: BackendGirdisi): Promise<AcilanPaket> {
  const kunye = JSON.parse(fs.readFileSync(path.join(tmp, "PAKET.json"), "utf8").replace(/^﻿/, "")) as PaketKunyesi;
  if (kunye.korumali !== true) throw new CliError("yalnız KORUMALI paket yayınlanır (PAKET.json korumali=true)");
  if (kunye.korumaHedef !== "win-x64") throw new CliError(`paket hedefi win-x64 değil: ${String(kunye.korumaHedef)}`);
  if (kunye.backendKanal !== g.kanal) throw new CliError(`paket "${String(kunye.backendKanal)}" kanalı için üretilmiş, hedef "${g.kanal}" (paketle.ps1 -Musteri ${g.kanal})`);
  if (kunye.prova === true && g.kanalTuru === "uretim") throw new CliError("PROVA paketi üretim kanalına yayınlanmaz");
  const { p, eskiKid, zincirKid } = await imzalariDenetle(tmp, g.capa, g.zincir, "yayınlanmaz");
  if (p.urun !== "backend") throw new CliError(`künye ürünü backend değil: ${p.urun}`);
  if (p.surum !== kunye.uygulamaSurumu) throw new CliError(`künye sürümü (${p.surum}) PAKET.json uygulamaSurumu (${String(kunye.uygulamaSurumu)}) ile aynı değil`);
  if (p.musteri !== null && p.musteri !== g.kanal) throw new CliError(`künye müşterisi ${p.musteri}, hedef kanal ${g.kanal}`);
  return { kunye, p, kid: eskiKid ?? zincirKid!, eskiKid, zincirKid };
}

/** Ortak paket yalnız üretim anahtar ailesiyle imzalı olur (iki platformda aynı kural). */
function uretimAilesi(kidler: readonly (string | null)[]): void {
  for (const k of kidler) {
    if (k !== null && !isProductionPackageKid(k) && !isProductionChainPackageKid(k)) throw new CliError(`paket ${k} anahtarıyla imzalı — ortak paket yalnız üretim anahtar ailesiyle (paket-<yıl> · pkt-<yıl>-<n>)`);
  }
}

type KurulanBildirim = { yuk: ReleaseManifest; eskiKid: string | null; zincirKid: string | null; ciKokeni: unknown };

/** Linux/OCI (sözleşme 5): dış zincir + imaj içi imza `ociPaketiAc`ta TAM ölçülür; bildirim `linux-x64-oci`. */
async function ociBildirimKur(g: BackendGirdisi, tar: string): Promise<KurulanBildirim> {
  const ac = await ociPaketiAc(tar, { capa: g.capa, zincir: g.zincir });
  uretimAilesi([ac.eskiKid, ac.zincirKid]);
  if (path.basename(tar) !== ociPaketAdi(ac.p.surum)) throw new CliError(`paket dosyasının adı ${path.basename(tar)} — ${ociPaketAdi(ac.p.surum)} bekleniyor`);
  if (g.pg.hedef !== null) throw new CliError("linux-x64-oci bildirimi PG hedefi taşımaz");
  if (g.minKaynak !== null && (compareVersions(g.minKaynak, ac.p.surum) ?? 0) >= 0) throw new CliError(`--min-kaynak (${g.minKaynak}) sürümden (${ac.p.surum}) eski olmalı`);
  const yuk: ReleaseManifest = {
    v: 1,
    urun: "backend",
    platform: OCI_PLATFORM,
    kanal: g.kanal,
    surum: ac.p.surum,
    commit: ac.commit,
    derlemeTarihi: ac.p.derlemeTarihi,
    yayinZamani: new Date().toISOString(),
    paket: { ad: path.basename(tar), boyut: fs.statSync(tar).size, sha256: sha256Dosya(tar), paketId: ac.p.paketId },
    paketImzaKid: ac.kid,
    minKaynakSurum: g.minKaynak,
    gocSayisi: ac.gocSayisi,
    pg: g.pg,
    runtime: { node: ac.nodeSurum },
    notlar: { ozet: g.ozet },
    zorunlu: g.zorunlu,
    imaj: ac.imaj,
    guncelleyici: ac.guncelleyici,
  };
  const sema = ReleaseManifestSchema.safeParse(yuk);
  if (!sema.success) throw new CliError(`bildirim şemadan geçmedi: ${sema.error.issues[0]?.path.join(".")} ${sema.error.issues[0]?.message ?? ""}`);
  return { yuk, eskiKid: ac.eskiKid, zincirKid: ac.zincirKid, ciKokeni: ac.ciKokeni };
}

/** Paketi açar, bütünlüğünü ve künyesini denetler; bildirim yükünü kurar (imzasız). */
async function bildirimKur(g: BackendGirdisi): Promise<KurulanBildirim> {
  if (g.tar !== null) return ociBildirimKur(g, g.tar);
  const zip = g.zip!;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tekserp-bildirim-"));
  try {
    execFileSync("unzip", ["-q", zip, "-d", tmp]);
    const ac = g.ortak ? await ortakPaketiAc(tmp, g.capa, g.zincir, "ortak gruba") : await kanalPaketiAc(tmp, g);
    const { kunye, p, kid } = ac;
    if (typeof kunye.commit !== "string" || typeof kunye.runtimeNodeSurumu !== "string" || typeof kunye.migrationSayisi !== "number") {
      throw new CliError("PAKET.json commit / runtimeNodeSurumu / migrationSayisi eksik");
    }
    if (g.minKaynak !== null && (compareVersions(g.minKaynak, p.surum) ?? 0) >= 0) throw new CliError(`--min-kaynak (${g.minKaynak}) sürümden (${p.surum}) eski olmalı`);
    const yuk: ReleaseManifest = {
      v: 1,
      urun: "backend",
      platform: "win32-x64",
      kanal: g.kanal,
      surum: p.surum,
      commit: kunye.commit,
      derlemeTarihi: p.derlemeTarihi,
      yayinZamani: new Date().toISOString(),
      paket: { ad: path.basename(zip), boyut: fs.statSync(zip).size, sha256: sha256Dosya(zip), paketId: p.paketId },
      paketImzaKid: kid,
      minKaynakSurum: g.minKaynak,
      gocSayisi: kunye.migrationSayisi,
      pg: g.pg,
      runtime: { node: kunye.runtimeNodeSurumu },
      notlar: { ozet: g.ozet },
      zorunlu: g.zorunlu,
    };
    return { yuk, eskiKid: ac.eskiKid, zincirKid: ac.zincirKid, ciKokeni: null };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function backend(komut: "dogrula" | "imzala", f: Bayraklar): Promise<void> {
  const g = backendGirdisi(f);
  const cikti = path.resolve(gerek(f, "cikti"));
  const uyarilar: string[] = [];
  const kur = await bildirimKur(g);
  const yuk = kur.yuk;
  fs.mkdirSync(cikti, { recursive: true });
  let bildirim: string | null = null;
  let bildirimZincir: string | null = null;
  if (komut === "imzala") {
    const im = imzacilar(f);
    for (const i of im) {
      const beklenen = i.sertifika === null ? kur.eskiKid : kur.zincirKid;
      if (i.kid !== beklenen) throw new CliError(`anahtar ${i.kid}, paketin ${i.sertifika === null ? INTEGRITY_FILE : CHAINED_INTEGRITY_FILE} imzalayanı ${beklenen ?? "YOK"} — bildirim paketi imzalayan anahtarla imzalanır`);
    }
    for (const i of im) {
      const key = await paketAnahtari(i.dosya);
      const kendi: ReleaseManifest = { ...yuk, paketImzaKid: key.kid };
      const token = belgeImzala(TYP.SURUM, ReleaseManifestSchema, kendi, key, i.sertifika, () => signReleaseManifest({ payload: kendi, key: { kid: key.kid, privateKey: key.privateKey } }));
      const geri = i.sertifika === null
        ? verifyReleaseManifest(token, { keys: [{ kid: key.kid, x: key.x }], kanal: g.kanal, platform: yuk.platform })
        : verifyReleaseManifest(token, { keys: [], kanal: g.kanal, platform: yuk.platform, zincir: g.zincir });
      if (!geri.ok) throw new Error(`öz-denetim düştü (${key.kid}): ${geri.code}`);
      if (i.sertifika === null) bildirim = token;
      else bildirimZincir = token;
    }
    if (bildirim) fs.writeFileSync(path.join(cikti, "surum.json"), releasePointerText(bildirim), { mode: 0o644 });
    if (bildirimZincir) fs.writeFileSync(path.join(cikti, CHAINED_RELEASE_MANIFEST_FILE), releasePointerText(bildirimZincir), { mode: 0o644 });
  }
  const takim = komut === "imzala" ? takimOf(bildirim !== null, bildirimZincir !== null) : takimOf(kur.eskiKid !== null, kur.zincirKid !== null);
  fs.writeFileSync(path.join(cikti, "sonuc.json"), `${JSON.stringify({ v: 1, kip: komut, surum: yuk.surum, takim, bildirim: yuk, jws: bildirim, jwsZincir: bildirimZincir, zincirKid: kur.zincirKid, ciKokeni: kur.ciKokeni, uyarilar }, null, 2)}\n`);
  for (const u of uyarilar) console.error(`⚠ ${u}`);
  const pg = yuk.pg.hedef ? ` · PG hedefi ${yuk.pg.hedef.surum}-${yuk.pg.hedef.derleme}` : " · PG hedefi yok";
  console.error(`✓ ${komut}: backend ${yuk.surum} (${yuk.platform}) → ${g.kanal} · paket ${yuk.paket.ad} (${yuk.paket.boyut} B) · takım ${takim} · kid ${[kur.eskiKid, kur.zincirKid].filter(Boolean).join(" + ")}${pg}`);
}

// ── PG paketi künyesi ───────────────────────────────────────────────────────
/** PG sürüm kaydı (TEK KAYNAK `deploy/pg/pg-surumu.json`): künye alanları buradan, argüman yalnız teyit. */
function pgKaydi(): { cizgi: string; surum: string; derleme: string; icu: string } {
  const yol = path.join(__dirname, "..", "..", "deploy", "pg", "pg-surumu.json");
  let k: { cizgi?: unknown; surum?: unknown; derleme?: unknown; yayin?: { "win-x64"?: { icuSurum?: unknown } } };
  try {
    k = JSON.parse(fs.readFileSync(yol, "utf8")) as typeof k;
  } catch (e) {
    throw new CliError(`PG sürüm kaydı okunamadı (${yol}): ${e instanceof Error ? e.message : String(e)}`);
  }
  const icu = k.yayin?.["win-x64"]?.icuSurum;
  if (typeof k.cizgi !== "string" || typeof k.surum !== "string" || typeof k.derleme !== "string" || typeof icu !== "string") {
    throw new CliError("PG sürüm kaydı eksik (cizgi · surum · derleme · yayin.win-x64.icuSurum) — önce: node scripts/test_pg_ornegi.mjs");
  }
  return { cizgi: k.cizgi, surum: k.surum, derleme: k.derleme, icu };
}

/** Argüman verildiyse kayıttakiyle AYNI olmalı; verilmediyse kayıttaki (sessiz sapma yok). */
function kayittan(f: Bayraklar, ad: string, kayitta: string): string {
  const v = f.get(ad);
  if (v !== undefined && v !== kayitta) throw new CliError(`--${ad}=${v} kayıttaki değerden (${kayitta}) farklı — tek kaynak deploy/pg/pg-surumu.json`);
  return kayitta;
}

async function pgImzala(f: Bayraklar): Promise<void> {
  const zip = path.resolve(gerek(f, "zip"));
  const kayit = pgKaydi();
  const cizgi = PgMajorSchema.parse(Number(kayittan(f, "cizgi", kayit.cizgi)));
  const surum = PgVersionSchema.parse(kayittan(f, "surum", kayit.surum));
  const derleme = PgBuildSchema.parse(Number(kayittan(f, "derleme", kayit.derleme)));
  const icu = IcuVersionSchema.parse(kayittan(f, "icu", kayit.icu));
  const liste = execFileSync("unzip", ["-Z1", zip], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }).split("\n");
  // Tek ICU: güncelleyici ve setup `bin\icuuc<N>.dll`in N'ini künyenin icuSurum'uyla karşılaştırır (D4 U2/U9).
  const icular = liste.filter((g) => /^bin\/icuuc\d+\.dll$/.test(g));
  if (!liste.includes(`bin/icuuc${icu}.dll`)) throw new CliError(`zip'te bin/icuuc${icu}.dll yok (bulunan: ${icular.join(", ") || "hiç"}) — ICU sürümü paketle uyuşmuyor`);
  if (icular.length !== 1) throw new CliError(`zip'te birden çok ICU var (${icular.join(", ")}) — künyenin icuSurum'u tek olmalı`);
  const icerik = execFileSync("unzip", ["-p", zip, "TEKSERP-ICERIK.sha256"], { maxBuffer: 16 * 1024 * 1024 });
  if (icerik.length === 0) throw new CliError("zip'te TEKSERP-ICERIK.sha256 yok ya da boş (içerik manifestosu)");
  const yuk: PgPackageManifest = {
    v: 1,
    urun: "postgresql",
    platform: "win32-x64",
    cizgi,
    surum,
    derleme,
    paket: { ad: path.basename(zip), boyut: fs.statSync(zip).size, sha256: sha256Dosya(zip) },
    icerikSha256: createHash("sha256").update(icerik).digest("hex"),
    icuSurum: icu,
    yayinZamani: new Date().toISOString(),
  };
  const im = imzacilar(f);
  const zincir = im.some((i) => i.sertifika !== null) ? zincirGuveni(f, null) : null;
  const yazilacak: { dosya: string; token: string; kid: string }[] = [];
  for (const i of im) {
    const key = await paketAnahtari(i.dosya);
    const token = belgeImzala(TYP.PG, PgPackageManifestSchema, yuk, key, i.sertifika, () => signPgPackageManifest({ payload: yuk, key: { kid: key.kid, privateKey: key.privateKey } }));
    const geri = zincir && i.sertifika !== null ? verifyPgPackageManifest(token, { keys: [], zincir }) : verifyPgPackageManifest(token, { keys: [{ kid: key.kid, x: key.x }] });
    if (!geri.ok) throw new Error(`öz-denetim düştü (${key.kid}): ${geri.code}`);
    yazilacak.push({ dosya: i.sertifika === null ? "pg.json" : CHAINED_PG_POINTER_FILE, token, kid: key.kid });
  }
  const cikti = path.resolve(gerek(f, "cikti"));
  fs.mkdirSync(cikti, { recursive: true });
  for (const y of yazilacak) fs.writeFileSync(path.join(cikti, y.dosya), releasePointerText(y.token), { mode: 0o644 });
  const takim = takimOf(yazilacak.some((y) => y.dosya === "pg.json"), yazilacak.some((y) => y.dosya === CHAINED_PG_POINTER_FILE));
  fs.writeFileSync(path.join(cikti, "sonuc.json"), `${JSON.stringify({ v: 1, kip: "pg-imzala", takim, kunye: yuk }, null, 2)}\n`);
  console.error(`✓ pg-imzala: PostgreSQL ${surum}-${derleme} (çizgi ${cizgi}, ICU ${icu}) · ${yuk.paket.ad} (${yuk.paket.boyut} B) · ${yazilacak.map((y) => `${y.dosya} (${y.kid})`).join(" + ")}`);
}

function pgDogrula(f: Bayraklar): void {
  const zip = path.resolve(gerek(f, "zip"));
  const k = pgKunyesiDogrula(gerek(f, "kunye"), { keys: capaOku(f, null), zincir: zincirGuveni(f, null) });
  const olcu = { ad: path.basename(zip), boyut: fs.statSync(zip).size, sha256: sha256Dosya(zip) };
  if (olcu.ad !== k.paket.ad || olcu.boyut !== k.paket.boyut || olcu.sha256 !== k.paket.sha256) {
    throw new CliError(`PG zip'i künyeyle TUTMUYOR (${olcu.ad} ${olcu.boyut} B) — künye başka paketin`);
  }
  const cikti = path.resolve(gerek(f, "cikti"));
  fs.mkdirSync(cikti, { recursive: true });
  fs.writeFileSync(path.join(cikti, "sonuc.json"), `${JSON.stringify({ v: 1, kip: "pg-dogrula", kunye: k }, null, 2)}\n`);
  console.error(`✓ pg-dogrula: PostgreSQL ${k.surum}-${k.derleme} · ${olcu.ad} künyeyle birebir`);
}

// ── Yeniden imza (3.9 D6, yıllık tören §5 adım 5) ─────────────────────────────
/** Yayındaki belgenin imzacısı için güven: gömülü çapa (paket-*) + kök çapası (pkt-*, sertifikası bitmiş olabilir). */
function yayindakiGuven(f: Bayraklar): { capa: readonly PackageKey[]; roots: PackageTrust["roots"] } {
  const dosya = f.get("capa") ?? process.env.TEKSERP_TEST_PAKET_CAPASI;
  const capa = dosya ? (JSON.parse(fs.readFileSync(dosya, "utf8")) as PackageKey[]) : packagePublicKeysFor("uretim");
  if (dosya) console.error("⚠ TEST ÇAPASI kullanılıyor — yalnız bekçi içindir");
  return { capa, roots: packageRoots({ kokDosyasi: f.get("kok-dosyasi") ?? null, testCapa: f.get("kok-capa") ?? null, testIzinli: true }).roots };
}

/** Yeni imzacı: yalnız `pkt-*`, yanında kök imzalı sertifika, bitişine ≥ 30 gün (parola SORULMADAN). */
function yeniImzaci(f: Bayraklar): { dosya: string; kid: string; sertifika: string } {
  const dosya = gerek(f, "anahtar");
  const kid = packageKeyInfo(dosya).kid;
  if (!isChainPackageKid(kid)) throw new CliError(`yeniden imza yalnız kök sertifikalı pkt-* anahtarıyla (gelen ${kid})`);
  const sertifika = readPackageCertificate({ keyFile: dosya, kid });
  assertPackageCertificateFresh(sertifika);
  return { dosya, kid, sertifika };
}

/** Zincirli belgenin (yükünde PAKET sertifikası olan) sertifikası verilen dağıtım iptalinde mi. */
function sertifikasiIptalli(jws: string, iptal: VerifiedPackageRevocation | null): string | null {
  if (!iptal) return null;
  const p = parseJws(jws);
  const cert = p.ok ? (p.value.payload as Record<string, unknown>)[PACKAGE_CERT_FIELD] : undefined;
  const c = typeof cert === "string" ? parseJws(cert) : null;
  if (!c?.ok) return null;
  const { sertifikaId, kid } = c.value.payload as { sertifikaId?: unknown; kid?: unknown };
  return typeof sertifikaId === "string" && iptal.document.iptaller.some((e) => e.sertifikaId === sertifikaId) ? String(kid) : null;
}

function iptalOku(f: Bayraklar, roots: PackageTrust["roots"]): { token: string; verified: VerifiedPackageRevocation } | null {
  const d = f.get("paket-iptal");
  return d ? readPackageRevocationFile(path.resolve(d), roots) : null;
}

/**
 * Yayındaki belgenin işaretçi metni: tek dosya (`--<dosyaBayragi>`) ya da dizin (`--<dizinBayragi>`). Dizinde bütün
 * `<aile>-zincir*.json` adayları seçime girer (YERLEŞİK + verilen iptal); zincirli aday yoksa ya da hiçbiri geçerli
 * değilse eski takım (`surum.json`/`pg.json`) — törenin elle "eski takımı ver" adımının otomatiği; elenenler ekrana.
 */
function yayindakiIsaretci(
  f: Bayraklar,
  aile: Exclude<ChainedFamily, "son">,
  g: { readonly capa: readonly PackageKey[]; readonly zincir: Omit<PackageTrust, "keys"> },
): { readonly metin: string; readonly ad: string; readonly dizin: string | null } {
  const dosyaBayragi = aile === "surum" ? "surum-kunye" : "kunye";
  const dizinBayragi = aile === "surum" ? "surum-dizini" : "pg-dizini";
  if (f.has(dosyaBayragi) === f.has(dizinBayragi)) throw new CliError(`--${dosyaBayragi} ya da --${dizinBayragi} (yalnız biri) gerekli`);
  if (f.has(dosyaBayragi)) {
    const yol = path.resolve(gerek(f, dosyaBayragi));
    return { metin: fs.readFileSync(yol, "utf8"), ad: path.basename(yol), dizin: null };
  }
  const dizin = path.resolve(gerek(f, dizinBayragi));
  const eskiAd = aile === "surum" ? RELEASE_MANIFEST_FILE : PG_POINTER_FILE;
  const adlar = fs.readdirSync(dizin).filter((a) => parseChainedFileName(a)?.aile === aile).sort();
  const oku = (a: string) => fs.readFileSync(path.join(dizin, a), "utf8");
  let secim: ReturnType<typeof selectChainedDocument<unknown>> = null;
  if (aile === "surum") {
    const kanal = f.get("kanal") ?? adlar.map((a) => isaretciKanali(oku(a))).find((k) => k !== null) ?? "";
    secim = selectChainedDocument<unknown>(aile, adlar.map((a) => chainedReleaseCandidate(a, oku(a), { keys: g.capa, kanal, zincir: g.zincir })));
  } else {
    secim = selectChainedDocument<unknown>(aile, adlar.map((a) => chainedPgCandidate(a, oku(a), { keys: g.capa, zincir: g.zincir })));
  }
  if (secim?.ok) {
    for (const e of secim.value.elenen) console.error(`  · elendi ${e.ad}: ${e.code}`);
    return { metin: oku(secim.value.ad), ad: secim.value.ad, dizin };
  }
  if (secim && !secim.ok) console.error(`⚠ zincirli adaylar geçersiz (${secim.code}): ${secim.message}`);
  if (!fs.existsSync(path.join(dizin, eskiAd))) throw new CliError(`${dizin}: geçerli zincirli ${aile} dosyası yok ve eski ${eskiAd} de yok`);
  console.error(`  → eski takım: ${eskiAd}`);
  return { metin: oku(eskiAd), ad: eskiAd, dizin };
}

/** İşaretçideki bildirimin (doğrulanmamış) kanalı — yalnız aday doğrulamasına kanal vermek için. */
function isaretciKanali(metin: string): string | null {
  const p = readReleasePointer(metin);
  const j = p.ok ? parseJws(p.value) : null;
  const k = j?.ok ? (j.value.payload as { kanal?: unknown }).kanal : undefined;
  return typeof k === "string" ? k : null;
}

/** `<ad>.zip` → `<ad>-<kid>.zip` (önceki yeniden imzanın `-pkt-<yıl>-<n>` eki düşer: ad büyümez). */
function yenidenAd(ad: string, kid: string): string {
  return `${ad.replace(/\.zip$/, "").replace(/-pkt-\d{4}-\d{1,3}$/, "")}-${kid}.zip`;
}

/**
 * `yeniden-imzala`: yayındaki backend sürümünü (bildirim + zip) YENİ PAKET sertifikasıyla yeniden imzalar — sürüm,
 * paketId, liste ve gömülü çapalı `butunluk.jws` AYNEN; yalnız `butunluk-zincir.jws` (+ daha yeni `paket-iptal.jws`)
 * değişir → yeni ad `<ad>-<kid>.zip` + `surum-zincir.json`. Eski takım (`surum.json`) eski zip'i göstermeye devam eder.
 * Yayındaki belgeler YERLEŞİK kipte ölçülür (eski sertifika bitmiş olabilir); imzacı sertifikası iptalliyse ve paketi
 * gömülü çapalı imza da desteklemiyorsa DUR (köken kanıtlanamaz → yeniden derle).
 */
async function yenidenImzala(f: Bayraklar): Promise<void> {
  const cikti = path.resolve(gerek(f, "cikti"));
  const yeni = yeniImzaci(f);
  const { capa, roots } = yayindakiGuven(f);
  const iptal = iptalOku(f, roots);
  const girdi = yayindakiIsaretci(f, "surum", { capa, zincir: { roots, mode: "YERLESIK", revocation: iptal?.verified ?? null } });
  const isaretci = readReleasePointer(girdi.metin);
  if (!isaretci.ok) throw new CliError(`sürüm bildirimi okunamadı: ${isaretci.code}`);
  const ham = parseJws(isaretci.value);
  const kanal = ham.ok ? (ham.value.payload as { kanal?: unknown }).kanal : undefined;
  if (typeof kanal !== "string") throw new CliError("sürüm bildiriminde kanal yok");
  if (f.has("kanal") && f.get("kanal") !== kanal) throw new CliError(`bildirim ${kanal} grubunun, beklenen ${f.get("kanal")}`);
  const eski = verifyReleaseManifest(isaretci.value, { keys: capa, kanal, zincir: { roots, mode: "YERLESIK" } });
  if (!eski.ok) throw new CliError(`yayındaki bildirim doğrulanamadı: ${eski.code}`);
  const iptalliBildirim = sertifikasiIptalli(isaretci.value, iptal?.verified ?? null);
  if (iptalliBildirim) throw new CliError(`bildirimi imzalayan ${iptalliBildirim} sertifikası İPTALLİ — yeniden imza kökeni kanıtlamaz; eski takımın surum.json'unu ver ya da sürümü yeniden derle`);
  if (eski.value.paketImzaKid === yeni.kid) throw new CliError(`bildirim zaten ${yeni.kid} ile imzalı`);
  if (!f.has("zip") && girdi.dizin === null) throw new CliError("--zip gerekli (ya da --surum-dizini)");
  const zip = f.has("zip") ? path.resolve(gerek(f, "zip")) : path.join(girdi.dizin!, eski.value.paket.ad);
  const olcu = { ad: path.basename(zip), boyut: fs.statSync(zip).size, sha256: sha256Dosya(zip) };
  const p0 = eski.value.paket;
  if (olcu.ad !== p0.ad || olcu.boyut !== p0.boyut || olcu.sha256 !== p0.sha256) throw new CliError(`zip bildirimle TUTMUYOR (${olcu.ad} ${olcu.boyut} B) — yayındaki paketin kendisi verilmeli`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tekserp-yeniden-"));
  const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), "tekserp-yeniden-ol-"));
  const yeniAd = yenidenAd(p0.ad, yeni.kid);
  const yeniZip = path.join(cikti, yeniAd);
  let zipBizim = false;
  try {
    execFileSync("unzip", ["-q", zip, "-d", tmp]);
    const once = await imzalariDenetle(tmp, capa, { roots, mode: "YERLESIK" }, "yeniden imzalanmaz");
    if (once.p.paketId !== p0.paketId || once.p.surum !== eski.value.surum) throw new CliError(`paket bildirimin paketi değil (paketId ${once.p.paketId})`);
    const zincirYolu = path.join(tmp, CHAINED_INTEGRITY_FILE);
    const iptalliPaket = fs.existsSync(zincirYolu) ? sertifikasiIptalli(fs.readFileSync(zincirYolu, "utf8").trim(), iptal?.verified ?? null) : null;
    if (iptalliPaket && once.eskiKid === null) throw new CliError(`paketin tek imzası İPTALLİ ${iptalliPaket} sertifikasıyla — köken kanıtlanamaz; sürümü yeniden derle`);
    const key = await paketAnahtari(yeni.dosya);
    const r = await resignChainedIntegrity({ root: tmp, key, certificate: yeni.sertifika, roots, paketIptal: iptal?.token ?? null });
    const kunye = JSON.parse(fs.readFileSync(path.join(tmp, "PAKET.json"), "utf8").replace(/^\uFEFF/, "")) as Record<string, unknown>;
    const guncel = { ...kunye, dosyaSayisi: Number(kunye.dosyaSayisi) + r.eklenen.length, butunlukZincirKid: key.kid };
    fs.writeFileSync(path.join(tmp, "PAKET.json"), `${JSON.stringify(guncel, null, 2)}\n`);
    fs.mkdirSync(cikti, { recursive: true });
    fs.copyFileSync(zip, yeniZip, fs.constants.COPYFILE_EXCL);
    zipBizim = true;
    execFileSync("zip", ["-q", "-X", yeniZip, CHAINED_INTEGRITY_FILE, "PAKET.json", ...(r.iptalYazildi ? [PACKAGE_REVOCATION_FILE] : [])], { cwd: tmp });
    // Yeni zip baştan açılıp iki imza da ölçülür: eski takım gömülü çapayla, zincir KABUL kipinde (yeni sertifika).
    execFileSync("unzip", ["-q", yeniZip, "-d", tmp2]);
    const kabul: Omit<PackageTrust, "keys"> = { roots, mode: "KABUL", nowMs: Date.now() };
    const sonra = await imzalariDenetle(tmp2, capa, kabul, "yeniden imzası düştü");
    if (sonra.p.paketId !== p0.paketId || sonra.zincirKid !== key.kid || sonra.eskiKid !== once.eskiKid) throw new Error("öz-denetim: yeniden imzalı paket aynı paket değil");
    const paket = { ad: yeniAd, boyut: fs.statSync(yeniZip).size, sha256: sha256Dosya(yeniZip), paketId: p0.paketId };
    const yuk: ReleaseManifest = { ...eski.value, paket, paketImzaKid: key.kid };
    const token = signChainedPackageDocument({ typ: TYP.SURUM, schema: ReleaseManifestSchema, payload: yuk, key: { kid: key.kid, privateKey: key.privateKey }, certificate: yeni.sertifika, signedAt: new Date().toISOString() });
    const geri = verifyReleaseManifest(token, { keys: [], kanal, zincir: kabul });
    if (!geri.ok) throw new Error(`öz-denetim düştü (${key.kid}): ${geri.code}`);
    const bildirimAdi = chainedFileName("surum", key.kid);
    fs.writeFileSync(path.join(cikti, bildirimAdi), releasePointerText(token), { mode: 0o644 });
    const sonuc = { v: 1, kip: "yeniden-imzala", kanal, surum: yuk.surum, eskiKid: eski.value.paketImzaKid, yeniKid: key.kid, takim: once.eskiKid ? "cift" : "zincir", girdi: girdi.ad, bildirim: bildirimAdi, paket: { eski: p0, yeni: paket }, iptalSira: r.iptalSira };
    fs.writeFileSync(path.join(cikti, "sonuc.json"), `${JSON.stringify(sonuc, null, 2)}\n`);
    zipBizim = false;
    console.error(`✓ yeniden-imzala: backend ${yuk.surum} (${kanal}) · ${eski.value.paketImzaKid} → ${key.kid} · ${yeniAd} (${paket.boyut} B) + ${bildirimAdi}${r.iptalSira !== null ? ` · dağıtım iptali sıra ${r.iptalSira}` : ""}`);
  } finally {
    if (zipBizim) fs.rmSync(yeniZip, { force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(tmp2, { recursive: true, force: true });
  }
}

/** `pg-yeniden-imzala`: yayındaki PG künyesinin yükü AYNEN, yeni PAKET sertifikasıyla → `pg-zincir-<kid>.json` (zip değişmez). */
async function pgYenidenImzala(f: Bayraklar): Promise<void> {
  const cikti = path.resolve(gerek(f, "cikti"));
  const yeni = yeniImzaci(f);
  const { capa, roots } = yayindakiGuven(f);
  const iptal = iptalOku(f, roots);
  const girdi = yayindakiIsaretci(f, "pg", { capa, zincir: { roots, mode: "YERLESIK", revocation: iptal?.verified ?? null } });
  const isaretci = readReleasePointer(girdi.metin);
  if (!isaretci.ok) throw new CliError(`PG künyesi okunamadı: ${isaretci.code}`);
  const eski = verifyPgPackageManifest(isaretci.value, { keys: capa, zincir: { roots, mode: "YERLESIK" } });
  if (!eski.ok) throw new CliError(`yayındaki PG künyesi doğrulanamadı: ${eski.code}`);
  const iptalli = sertifikasiIptalli(isaretci.value, iptal?.verified ?? null);
  if (iptalli) throw new CliError(`PG künyesini imzalayan ${iptalli} sertifikası İPTALLİ — eski takımın pg.json'unu ver ya da pg-imzala ile baştan imzala`);
  if (f.has("zip")) {
    const zip = path.resolve(gerek(f, "zip"));
    const olcu = { ad: path.basename(zip), boyut: fs.statSync(zip).size, sha256: sha256Dosya(zip) };
    if (olcu.ad !== eski.value.paket.ad || olcu.boyut !== eski.value.paket.boyut || olcu.sha256 !== eski.value.paket.sha256) throw new CliError(`PG zip'i künyeyle TUTMUYOR (${olcu.ad})`);
  }
  const key = await paketAnahtari(yeni.dosya);
  const token = signChainedPackageDocument({ typ: TYP.PG, schema: PgPackageManifestSchema, payload: eski.value, key: { kid: key.kid, privateKey: key.privateKey }, certificate: yeni.sertifika, signedAt: new Date().toISOString() });
  const geri = verifyPgPackageManifest(token, { keys: [], zincir: { roots, mode: "KABUL", nowMs: Date.now() } });
  if (!geri.ok) throw new Error(`öz-denetim düştü (${key.kid}): ${geri.code}`);
  fs.mkdirSync(cikti, { recursive: true });
  const kunyeAdi = chainedFileName("pg", key.kid);
  fs.writeFileSync(path.join(cikti, kunyeAdi), releasePointerText(token), { mode: 0o644 });
  fs.writeFileSync(path.join(cikti, "sonuc.json"), `${JSON.stringify({ v: 1, kip: "pg-yeniden-imzala", yeniKid: key.kid, girdi: girdi.ad, kunyeAdi, kunye: eski.value }, null, 2)}\n`);
  console.error(`✓ pg-yeniden-imzala: PostgreSQL ${eski.value.surum}-${eski.value.derleme} · ${key.kid} → ${kunyeAdi} (zip aynı)`);
}

// ── Ortak paket (kurulum arşivi, O11a) ──────────────────────────────────────
/**
 * Ortak paketin künye + bütünlük denetimi — TEK gövde: kurulum arşivi (`ortak-dogrula`) ve grup yayını
 * (`dogrula|imzala --ortak`) aynı kuralı paylaşır. `hedef`: hata iletisindeki yer ("ortak arşive" | "ortak gruba").
 */
async function ortakPaketiAc(tmp: string, capa: readonly PackageKey[], zincir: Omit<PackageTrust, "keys">, hedef: string): Promise<AcilanPaket> {
  const kunye = JSON.parse(fs.readFileSync(path.join(tmp, "PAKET.json"), "utf8").replace(/^﻿/, "")) as PaketKunyesi;
  if (kunye.korumali !== true) throw new CliError("yalnız KORUMALI paket (PAKET.json korumali=true)");
  if (kunye.korumaHedef !== "win-x64") throw new CliError(`paket hedefi win-x64 değil: ${String(kunye.korumaHedef)}`);
  if (kunye.backendKanal !== null) throw new CliError(`paket "${String(kunye.backendKanal)}" kanalı için üretilmiş — ${hedef} yalnız ortak paket girer (paketle.ps1 argümansız)`);
  if (kunye.prova === true) throw new CliError(`PROVA paketi ${hedef} girmez`);
  const { p, eskiKid, zincirKid } = await imzalariDenetle(tmp, capa, zincir, `${hedef} girmez`);
  uretimAilesi([eskiKid, zincirKid]);
  const kid = eskiKid ?? zincirKid!;
  if (p.urun !== "backend") throw new CliError(`künye ürünü backend değil: ${p.urun}`);
  if (p.surum !== kunye.uygulamaSurumu) throw new CliError(`künye sürümü (${p.surum}) PAKET.json uygulamaSurumu (${String(kunye.uygulamaSurumu)}) ile aynı değil`);
  if (p.musteri !== null) throw new CliError(`künye müşterisi ${p.musteri} — ortak paket müşteri taşımaz (filigran kurulumda)`);
  return { kunye, p, kid, eskiKid, zincirKid };
}

/** Ortak paketin bütünlüğü + künyesi; grup-nötr (arşiv sürüm başına TEK), bildirim kurmaz. */
async function ortakDogrula(f: Bayraklar): Promise<void> {
  // Kip yalnız üretim; test çapası bekçi içindir (çağıran arşivci onu ortamdan siler, --capa geçirmez).
  if (gerek(f, "guven-capasi") !== "uretim") throw new CliError("ortak paket yalnız ÜRETİM çapasıyla doğrulanır (--guven-capasi=uretim)");
  const capa = capaOku(f, null);
  const zincir = zincirGuveni(f, null);
  const pg = pgGereksinimi(f, capa, zincir);
  const zip = path.resolve(gerek(f, "zip"));
  const cikti = path.resolve(gerek(f, "cikti"));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tekserp-ortak-"));
  try {
    execFileSync("unzip", ["-q", zip, "-d", tmp]);
    const { p, kid, eskiKid, zincirKid } = await ortakPaketiAc(tmp, capa, zincir, "ortak arşive");
    fs.mkdirSync(cikti, { recursive: true });
    fs.writeFileSync(path.join(cikti, "sonuc.json"), `${JSON.stringify({ v: 1, kip: "ortak-dogrula", surum: p.surum, paketId: p.paketId, paketImzaKid: kid, takim: takimOf(eskiKid !== null, zincirKid !== null), zincirKid, pg, uyarilar: [] }, null, 2)}\n`);
    console.error(`✓ ortak-dogrula: backend ${p.surum} · kid ${kid}${pg.hedef ? ` · PG hedefi ${pg.hedef.surum}-${pg.hedef.derleme}` : " · PG hedefi yok"}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** `imaj-kimlik --arsiv=<imaj .tar.gz>`: imaj kimliği = config özeti, arşivden (Docker deposunun `.Id`'si değil). */
async function imajKimlik(f: Bayraklar): Promise<void> {
  let o;
  try {
    o = await imajArsiviOlc(path.resolve(gerek(f, "arsiv")));
  } catch (e) {
    throw new CliError(`imaj arşivi ölçülemedi: ${e instanceof Error ? e.message : String(e)}`);
  }
  process.stdout.write(`${o.kimlik}\n`);
}

async function main(): Promise<void> {
  const { command, flags } = args(process.argv.slice(2));
  if (command === "dogrula" || command === "imzala") return backend(command, flags);
  if (command === "imaj-kimlik") return imajKimlik(flags);
  if (command === "ortak-dogrula") return ortakDogrula(flags);
  if (command === "pg-imzala") return pgImzala(flags);
  if (command === "pg-dogrula") return pgDogrula(flags);
  if (command === "yeniden-imzala") return yenidenImzala(flags);
  if (command === "pg-yeniden-imzala") return pgYenidenImzala(flags);
  throw new CliError("komut: dogrula | imzala | imaj-kimlik | ortak-dogrula | pg-imzala | pg-dogrula | yeniden-imzala | pg-yeniden-imzala");
}

main().catch((e: unknown) => {
  console.error(`✖ ${e instanceof Error ? e.message : String(e)}`);
  process.exit(e instanceof CliError ? 2 : 1);
});
