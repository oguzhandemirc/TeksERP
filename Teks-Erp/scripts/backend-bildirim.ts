// =============================================================================
// BACKEND SÜRÜM BİLDİRİMİ + PG PAKETİ KÜNYESİ (Dağıtım v2, docs/design/GUNCELLEYICI.md §1 · §1.6)
// =============================================================================
// Satıcı Mac'inde koşar; imza anahtarı CI'a ve pakete GİRMEZ. Yayıncı `deploy/backend-yayinla.mjs` çağırır.
//
//   npx tsx scripts/backend-bildirim.ts dogrula --zip=<paket.zip> --kanal=<kod> --kanal-turu=<uretim|hazirlik>
//       --guven-capasi=<uretim|hazirlik> --pg-cizgi=<16> --pg-en-az=<16.9> [--pg-kunye=<pg.json>] --ozet-dosyasi=<txt> --cikti=<dizin> [--min-kaynak=<sürüm>] [--zorunlu]
//   npx tsx scripts/backend-bildirim.ts imzala  … aynı … --anahtar=<PAKET anahtar dosyası>
//   npx tsx scripts/backend-bildirim.ts pg-imzala --zip=<PG sahne zip> --anahtar=<PAKET anahtar dosyası> --cikti=<dizin>
//       [--cizgi --surum --derleme --icu]: künye alanları deploy/pg/pg-surumu.json'dan (TEK KAYNAK); verilen argüman
//       kayıttan farklıysa DUR. Zip'te TEK `bin/icuuc<N>.dll` olmalı ve N = kaydın icuSurum'u.
//   npx tsx scripts/backend-bildirim.ts pg-dogrula --kunye=<pg.json> --zip=<PG sahne zip> --guven-capasi=<kip> --cikti=<dizin>
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
  IcuVersionSchema,
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
  type TrustAnchorMode,
  isTrustAnchorMode,
} from "../src/lib/license/protocol";
import { packagePublicKeysFor, verifyIntegrity, type PackageKey } from "../src/lib/license/integrity";
import { INTEGRITY_FILE, isStagingPackageKid } from "../src/lib/license/integrity-scope";
import { openPackageKey } from "./lib/butunluk-imza";
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
  if (!isTrustAnchorMode(kip)) throw new CliError(`--guven-capasi uretim | hazirlik (gelen: ${kip})`);
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

function paketAnahtari(dosya: string) {
  return openPackageKey(dosya, (kid) => askPassword(`PAKET anahtarı (${kid}) parolası: `));
}

// ── PG gereksinimi (backend bildiriminin `pg` bloğu) ─────────────────────────
function pgGereksinimi(f: Bayraklar, capa: readonly PackageKey[]): PgRequirement {
  const cizgi = PgMajorSchema.safeParse(Number(gerek(f, "pg-cizgi")));
  if (!cizgi.success) throw new CliError("--pg-cizgi PostgreSQL ana sürümü (ör. 16)");
  const enAz = gerek(f, "pg-en-az");
  if (!PgVersionSchema.safeParse(enAz).success) throw new CliError(`--pg-en-az ana.küçük biçiminde olmalı (ör. 16.9): ${enAz}`);
  let hedef: PgRequirement["hedef"] = null;
  const kunyeDosyasi = f.get("pg-kunye");
  if (kunyeDosyasi) {
    const isaretci = readReleasePointer(fs.readFileSync(kunyeDosyasi, "utf8"));
    if (!isaretci.ok) throw new CliError(`PG künyesi okunamadı: ${isaretci.code}`);
    const k = verifyPgPackageManifest(isaretci.value, { keys: capa });
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
}

function backendGirdisi(f: Bayraklar): BackendGirdisi {
  const kanalTuru = gerek(f, "kanal-turu");
  if (kanalTuru !== "uretim" && kanalTuru !== "hazirlik") throw new CliError("--kanal-turu uretim | hazirlik");
  const minKaynak = f.get("min-kaynak") ?? null;
  if (minKaynak !== null && !ReleaseVersionSchema.safeParse(minKaynak).success) throw new CliError(`--min-kaynak sürüm biçiminde değil: ${minKaynak}`);
  const ozet = fs.readFileSync(gerek(f, "ozet-dosyasi"), "utf8").trim();
  if (ozet.length === 0 || ozet.length > 2000) throw new CliError(`sürüm özeti 1–2000 karakter olmalı (${ozet.length})`);
  const capa = capaOku(f, kanalTuru);
  return { zip: path.resolve(gerek(f, "zip")), kanal: gerek(f, "kanal"), kanalTuru, minKaynak, zorunlu: f.has("zorunlu"), ozet, pg: pgGereksinimi(f, capa), capa };
}

/** Paketi açar, bütünlüğünü ve künyesini denetler; bildirim yükünü kurar (imzasız). */
async function bildirimKur(g: BackendGirdisi, uyarilar: string[]): Promise<ReleaseManifest> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tekserp-bildirim-"));
  try {
    execFileSync("unzip", ["-q", g.zip, "-d", tmp]);
    const kunye = JSON.parse(fs.readFileSync(path.join(tmp, "PAKET.json"), "utf8").replace(/^﻿/, "")) as PaketKunyesi;
    if (kunye.korumali !== true) throw new CliError("yalnız KORUMALI paket yayınlanır (PAKET.json korumali=true)");
    if (kunye.korumaHedef !== "win-x64") throw new CliError(`paket hedefi win-x64 değil: ${String(kunye.korumaHedef)}`);
    if (kunye.backendKanal !== g.kanal) throw new CliError(`paket "${String(kunye.backendKanal)}" kanalı için üretilmiş, hedef "${g.kanal}" (paketle.ps1 -Musteri ${g.kanal})`);
    if (kunye.prova === true && g.kanalTuru === "uretim") throw new CliError("PROVA paketi üretim kanalına yayınlanmaz");
    const jws = fs.readFileSync(path.join(tmp, INTEGRITY_FILE), "utf8").trim();
    const rapor = await verifyIntegrity(jws, tmp, g.capa);
    if (rapor.durum !== "GECERLI" || !rapor.paket) throw new CliError(`paket bütünlüğü ${rapor.durum} (${rapor.kod ?? "?"}) — imzasız/kurcalı paket yayınlanmaz`);
    const baslik = parseJws(jws);
    if (!baslik.ok) throw new CliError(`butunluk.jws ayrıştırılamadı: ${baslik.code}`);
    const kid = baslik.value.header.kid;
    if (isStagingPackageKid(kid) && g.kanalTuru === "uretim") {
      uyarilar.push(`paket HAZIRLIK anahtarıyla (${kid}) imzalı: bu kanaldaki ÜRETİM sınıfı kurulumlar onu REDDEDER (yalnız TEST/DEMO kurar)`);
    }
    const p = rapor.paket;
    if (p.urun !== "backend") throw new CliError(`künye ürünü backend değil: ${p.urun}`);
    if (p.surum !== kunye.uygulamaSurumu) throw new CliError(`künye sürümü (${p.surum}) PAKET.json uygulamaSurumu (${String(kunye.uygulamaSurumu)}) ile aynı değil`);
    if (p.musteri !== null && p.musteri !== g.kanal) throw new CliError(`künye müşterisi ${p.musteri}, hedef kanal ${g.kanal}`);
    if (typeof kunye.commit !== "string" || typeof kunye.runtimeNodeSurumu !== "string" || typeof kunye.migrationSayisi !== "number") {
      throw new CliError("PAKET.json commit / runtimeNodeSurumu / migrationSayisi eksik");
    }
    if (g.minKaynak !== null && (compareVersions(g.minKaynak, p.surum) ?? 0) >= 0) throw new CliError(`--min-kaynak (${g.minKaynak}) sürümden (${p.surum}) eski olmalı`);
    return {
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
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function backend(komut: "dogrula" | "imzala", f: Bayraklar): Promise<void> {
  const g = backendGirdisi(f);
  const cikti = path.resolve(gerek(f, "cikti"));
  const uyarilar: string[] = [];
  const yuk = await bildirimKur(g, uyarilar);
  fs.mkdirSync(cikti, { recursive: true });
  let bildirim: string | null = null;
  if (komut === "imzala") {
    const key = await paketAnahtari(gerek(f, "anahtar"));
    if (key.kid !== yuk.paketImzaKid) throw new CliError(`anahtar ${key.kid}, paketin imzalayanı ${yuk.paketImzaKid} — bildirim paketi imzalayan anahtarla imzalanır`);
    bildirim = signReleaseManifest({ payload: yuk, key: { kid: key.kid, privateKey: key.privateKey } });
    const geri = verifyReleaseManifest(bildirim, { keys: [{ kid: key.kid, x: key.x }], kanal: g.kanal });
    if (!geri.ok) throw new Error(`öz-denetim düştü: ${geri.code}`);
    fs.writeFileSync(path.join(cikti, "surum.json"), releasePointerText(bildirim), { mode: 0o644 });
  }
  fs.writeFileSync(path.join(cikti, "sonuc.json"), `${JSON.stringify({ v: 1, kip: komut, surum: yuk.surum, bildirim: yuk, jws: bildirim, uyarilar }, null, 2)}\n`);
  for (const u of uyarilar) console.error(`⚠ ${u}`);
  const pg = yuk.pg.hedef ? ` · PG hedefi ${yuk.pg.hedef.surum}-${yuk.pg.hedef.derleme}` : " · PG hedefi yok";
  console.error(`✓ ${komut}: backend ${yuk.surum} → ${g.kanal} · paket ${yuk.paket.ad} (${yuk.paket.boyut} B) · kid ${yuk.paketImzaKid}${pg}`);
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
  const key = await paketAnahtari(gerek(f, "anahtar"));
  const token = signPgPackageManifest({ payload: yuk, key: { kid: key.kid, privateKey: key.privateKey } });
  const geri = verifyPgPackageManifest(token, { keys: [{ kid: key.kid, x: key.x }] });
  if (!geri.ok) throw new Error(`öz-denetim düştü: ${geri.code}`);
  const cikti = path.resolve(gerek(f, "cikti"));
  fs.mkdirSync(cikti, { recursive: true });
  fs.writeFileSync(path.join(cikti, "pg.json"), releasePointerText(token), { mode: 0o644 });
  fs.writeFileSync(path.join(cikti, "sonuc.json"), `${JSON.stringify({ v: 1, kip: "pg-imzala", kunye: yuk }, null, 2)}\n`);
  console.error(`✓ pg-imzala: PostgreSQL ${surum}-${derleme} (çizgi ${cizgi}, ICU ${icu}) · ${yuk.paket.ad} (${yuk.paket.boyut} B) · kid ${key.kid}`);
}

function pgDogrula(f: Bayraklar): void {
  const zip = path.resolve(gerek(f, "zip"));
  const isaretci = readReleasePointer(fs.readFileSync(gerek(f, "kunye"), "utf8"));
  if (!isaretci.ok) throw new CliError(`PG künyesi okunamadı: ${isaretci.code}`);
  const k = verifyPgPackageManifest(isaretci.value, { keys: capaOku(f, null) });
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

async function main(): Promise<void> {
  const { command, flags } = args(process.argv.slice(2));
  if (command === "dogrula" || command === "imzala") return backend(command, flags);
  if (command === "pg-imzala") return pgImzala(flags);
  if (command === "pg-dogrula") return pgDogrula(flags);
  throw new CliError("komut: dogrula | imzala | pg-imzala | pg-dogrula");
}

main().catch((e: unknown) => {
  console.error(`✖ ${e instanceof Error ? e.message : String(e)}`);
  process.exit(e instanceof CliError ? 2 : 1);
});
