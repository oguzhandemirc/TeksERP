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
import { openPackageKey, packageKeyInfo, type OpenedPackageKey } from "./lib/butunluk-imza";
import { assertPackageCertificateFresh, packageRoots, readPackageCertificate } from "./lib/paket-sertifika";
import { CliError, args, askPassword } from "./lib/cli-girdi";

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
  return openPackageKey(dosya, (kid) => askPassword(`PAKET anahtarı (${kid}) parolası: `));
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
    const isaretci = readReleasePointer(fs.readFileSync(kunyeDosyasi, "utf8"));
    if (!isaretci.ok) throw new CliError(`PG künyesi okunamadı: ${isaretci.code}`);
    const k = verifyPgPackageManifest(isaretci.value, { keys: capa, zincir });
    if (!k.ok) throw new CliError(`PG künyesi doğrulanamadı: ${k.code}`);
    if (k.value.cizgi !== cizgi.data) throw new CliError(`PG künyesi ${k.value.cizgi} ana sürümünün, bildirim çizgisi ${cizgi.data} — ana sürüm geçişi otomatik değildir`);
    hedef = { surum: k.value.surum, derleme: k.value.derleme, paket: k.value.paket, icerikSha256: k.value.icerikSha256, icuSurum: k.value.icuSurum };
  }
  const p = PgRequirementSchema.safeParse({ cizgi: cizgi.data, enAz, hedef });
  if (!p.success) throw new CliError(`PG gereksinimi geçersiz: ${p.error.issues[0]?.message ?? "şema"}`);
  return p.data;
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
  readonly zip: string;
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
  return { zip: path.resolve(gerek(f, "zip")), kanal: gerek(f, "kanal"), kanalTuru, minKaynak, zorunlu: f.has("zorunlu"), ozet, pg: pgGereksinimi(f, capa, zincir), capa, zincir, ortak };
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

/** Paketi açar, bütünlüğünü ve künyesini denetler; bildirim yükünü kurar (imzasız). */
async function bildirimKur(g: BackendGirdisi): Promise<{ yuk: ReleaseManifest; eskiKid: string | null; zincirKid: string | null }> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tekserp-bildirim-"));
  try {
    execFileSync("unzip", ["-q", g.zip, "-d", tmp]);
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
      paket: { ad: path.basename(g.zip), boyut: fs.statSync(g.zip).size, sha256: sha256Dosya(g.zip), paketId: p.paketId },
      paketImzaKid: kid,
      minKaynakSurum: g.minKaynak,
      gocSayisi: kunye.migrationSayisi,
      pg: g.pg,
      runtime: { node: kunye.runtimeNodeSurumu },
      notlar: { ozet: g.ozet },
      zorunlu: g.zorunlu,
    };
    return { yuk, eskiKid: ac.eskiKid, zincirKid: ac.zincirKid };
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
        ? verifyReleaseManifest(token, { keys: [{ kid: key.kid, x: key.x }], kanal: g.kanal })
        : verifyReleaseManifest(token, { keys: [], kanal: g.kanal, zincir: g.zincir });
      if (!geri.ok) throw new Error(`öz-denetim düştü (${key.kid}): ${geri.code}`);
      if (i.sertifika === null) bildirim = token;
      else bildirimZincir = token;
    }
    if (bildirim) fs.writeFileSync(path.join(cikti, "surum.json"), releasePointerText(bildirim), { mode: 0o644 });
    if (bildirimZincir) fs.writeFileSync(path.join(cikti, CHAINED_RELEASE_MANIFEST_FILE), releasePointerText(bildirimZincir), { mode: 0o644 });
  }
  const takim = komut === "imzala" ? takimOf(bildirim !== null, bildirimZincir !== null) : takimOf(kur.eskiKid !== null, kur.zincirKid !== null);
  fs.writeFileSync(path.join(cikti, "sonuc.json"), `${JSON.stringify({ v: 1, kip: komut, surum: yuk.surum, takim, bildirim: yuk, jws: bildirim, jwsZincir: bildirimZincir, zincirKid: kur.zincirKid, uyarilar }, null, 2)}\n`);
  for (const u of uyarilar) console.error(`⚠ ${u}`);
  const pg = yuk.pg.hedef ? ` · PG hedefi ${yuk.pg.hedef.surum}-${yuk.pg.hedef.derleme}` : " · PG hedefi yok";
  console.error(`✓ ${komut}: backend ${yuk.surum} → ${g.kanal} · paket ${yuk.paket.ad} (${yuk.paket.boyut} B) · takım ${takim} · kid ${[kur.eskiKid, kur.zincirKid].filter(Boolean).join(" + ")}${pg}`);
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
  const isaretci = readReleasePointer(fs.readFileSync(gerek(f, "kunye"), "utf8"));
  if (!isaretci.ok) throw new CliError(`PG künyesi okunamadı: ${isaretci.code}`);
  const k = verifyPgPackageManifest(isaretci.value, { keys: capaOku(f, null), zincir: zincirGuveni(f, null) });
  if (!k.ok) throw new CliError(`PG künyesi doğrulanamadı: ${k.code}`);
  const olcu = { ad: path.basename(zip), boyut: fs.statSync(zip).size, sha256: sha256Dosya(zip) };
  if (olcu.ad !== k.value.paket.ad || olcu.boyut !== k.value.paket.boyut || olcu.sha256 !== k.value.paket.sha256) {
    throw new CliError(`PG zip'i künyeyle TUTMUYOR (${olcu.ad} ${olcu.boyut} B) — künye başka paketin`);
  }
  const cikti = path.resolve(gerek(f, "cikti"));
  fs.mkdirSync(cikti, { recursive: true });
  fs.writeFileSync(path.join(cikti, "sonuc.json"), `${JSON.stringify({ v: 1, kip: "pg-dogrula", kunye: k.value }, null, 2)}\n`);
  console.error(`✓ pg-dogrula: PostgreSQL ${k.value.surum}-${k.value.derleme} · ${olcu.ad} künyeyle birebir`);
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
  for (const k of [eskiKid, zincirKid]) {
    if (k !== null && !isProductionPackageKid(k) && !isProductionChainPackageKid(k)) throw new CliError(`paket ${k} anahtarıyla imzalı — ortak paket yalnız üretim anahtar ailesiyle (paket-<yıl> · pkt-<yıl>-<n>)`);
  }
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

async function main(): Promise<void> {
  const { command, flags } = args(process.argv.slice(2));
  if (command === "dogrula" || command === "imzala") return backend(command, flags);
  if (command === "ortak-dogrula") return ortakDogrula(flags);
  if (command === "pg-imzala") return pgImzala(flags);
  if (command === "pg-dogrula") return pgDogrula(flags);
  throw new CliError("komut: dogrula | imzala | ortak-dogrula | pg-imzala | pg-dogrula");
}

main().catch((e: unknown) => {
  console.error(`✖ ${e instanceof Error ? e.message : String(e)}`);
  process.exit(e instanceof CliError ? 2 : 1);
});
