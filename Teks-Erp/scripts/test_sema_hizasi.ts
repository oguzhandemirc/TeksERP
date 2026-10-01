// =============================================================================
// BEKÇİ — ŞEMA HİZASI: güncelleyici, setup ve geçiş "paket şemanın gerisinde" sorusunu TEK kuralla cevaplar
// Çalıştır: npx tsx scripts/run-all-tests.ts sema_hizasi        (DB'siz; pwsh varsa §2 gerçek kabukta)
//           npx tsx scripts/test_sema_hizasi.ts --vektor-yaz    (ortak vektör dosyasını bu dosyanın tablosundan üretir)
// =============================================================================
// KURAL (yönetici kararı 2026-10-02, D8e): veritabanındaki BİTMİŞ göç adları paketin göç adlarının
// (`prisma/migrations/<ad>/migration.sql`) ALT KÜMESİ değilse ŞEMA İLERİDE — paket şemayı geri indirir,
// UYGULANMAZ. Sayı karşılaştırması bunu ölçmez (sayı eşit, ad farklı olabilir). Rust ile PS kod paylaşamaz;
// tanım bu dosyadaki tablodan doğan ortak vektörlerdir (`native/test-vektorleri/sema-hizasi.json`) ve iki yan ona
// ölçülür: Rust `cargo test` (`tekserp-guncelleyici/tests/sema_hizasi.rs`), PS bu bekçinin §2'si (pwsh).
//   §1 tek tanım: vektör dosyası = --vektor-yaz çıktısı BAYT-EŞİT · bitmiş göç SQL'i Rust (`sema.rs`) ve PS
//      (`deploy/hizmet/sema-hizasi.ps1`) literallerinde BAYT-EŞİT · Rust testi vektörleri okur
//   §2 PS davranışı (pwsh): `PaketGocAdlari` + `SemaIleride` her vektörde beklenen
//   §3 güncelleyici: `schema_check` hazırlıktan SONRA, HAZIR/uygulamadan ÖNCE; ileride → BEKLİYOR + `SEMA_ILERIDE`;
//      ölçüt `sema::ahead` (ad kümesi), sayı (`migration_count`) DEĞİL
//   §4 setup + geçiş: ortak PS'i yükler; setup göç ÖNCESİ engel + göç SONRASI ad eşitliği (sayı sorgusu yok);
//      geçiş fazla/bekleyen göçü ortak işlevle; çağrılar `@( )` ile sarılır (tek elemanlı sonuç açılmasın)
//   §5 kod aynası: `codes.rs` · panel "Sorun" etiketi · onay kuralı bekleyiş nedeni · GUNCELLEYICI.md §12
// NEGATİF SONDA (✓K, her koşumda): §1/§3/§4/§5 yüklemleri bellekte bozulmuş kopyalara koşar (mutasyonun UYGULANDIĞI
//   ölçülür); §2 için sema-hizasi.ps1'in bozulmuş kopyası pwsh'ta koşar. ÜÇ SONUÇ: kaynak okunamazsa ÖLÇÜLEMEDİ
//   (kırmızı), pwsh yoksa §2 ATLANIR (beyanlı, TEKSERP_STRICT'te kırmızı).
// =============================================================================
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { psTara } from "./lib/ps-tarama";
import { atlamaDefteri } from "./lib/atlama";

const TEKS = join(__dirname, "..");
const KOK = join(TEKS, "..");

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detay ? ` — ${detay}` : ""}`);
}
const defter = atlamaDefteri(() => fail++);

// ---------------------------------------------------------------------------
// TANIM — SQL + kural + vektör tablosu (vektör dosyası buradan doğar)
// ---------------------------------------------------------------------------
const SQL = "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY 1";
const KURAL =
  "Veritabanındaki BİTMİŞ göç adları (finished_at IS NOT NULL AND rolled_back_at IS NULL) paketin göç adlarının " +
  "(prisma/migrations/<ad>/migration.sql) alt kümesi değilse ŞEMA İLERİDE: paket şemayı geri indirir, uygulanmaz. Ad bayt-eşit.";
const g = (ad: string) => `prisma/migrations/${ad}/migration.sql`;
interface Vektor {
  ad: string;
  veritabani: string[];
  paketYollari: string[];
  paket: string[];
  ileride: string[];
}
const A = "20260901000000_ilk";
const B = "20260915000000_ikinci";
const C = "20261001000000_ucuncu";
const VEKTORLER: Vektor[] = [
  { ad: "eşit", veritabani: [A, B], paketYollari: [g(A), g(B)], paket: [A, B], ileride: [] },
  { ad: "geride (paket ileri götürür)", veritabani: [A], paketYollari: [g(A), g(B)], paket: [A, B], ileride: [] },
  { ad: "ileride (bir fazla göç)", veritabani: [A, B, C], paketYollari: [g(A), g(B)], paket: [A, B], ileride: [C] },
  { ad: "sayı eşit ad farklı (sayı karşılaştırması kaçırırdı)", veritabani: [A, C], paketYollari: [g(A), g(B)], paket: [A, B], ileride: [C] },
  { ad: "boş veritabanı", veritabani: [], paketYollari: [g(A)], paket: [A], ileride: [] },
  { ad: "göçsüz paket", veritabani: [A], paketYollari: [], paket: [], ileride: [A] },
  { ad: "ad bayt-eşit (büyük/küçük harf ayrı)", veritabani: ["20260901000000_Ilk"], paketYollari: [g(A)], paket: [A], ileride: ["20260901000000_Ilk"] },
  {
    ad: "migration.sql taşımayan dizin ve kilit dosyası göç değil",
    veritabani: [A, "20260920000000_bos"],
    paketYollari: [g(A), "prisma/migrations/20260920000000_bos/README.md", "prisma/migrations/migration_lock.toml", "prisma/migrations/20260921000000_derin/alt/migration.sql"],
    paket: [A],
    ileride: ["20260920000000_bos"],
  },
  { ad: "tekrarlı ad tekil", veritabani: [C, A, C], paketYollari: [g(A)], paket: [A], ileride: [C] },
  { ad: "sıra ordinal (büyük harf önce)", veritabani: ["20260930000000_b", "20260930000000_Z", "20260930000000_B"], paketYollari: [], paket: [], ileride: ["20260930000000_B", "20260930000000_Z", "20260930000000_b"] },
];

const VEKTOR_DOSYASI = join(TEKS, "native", "test-vektorleri", "sema-hizasi.json");
function asciiJson(v: unknown): string {
  return JSON.stringify(v).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}
function vektorMetni(): string {
  const bas = {
    bicim: 1,
    not: "Üreten: Teks-Erp/scripts/test_sema_hizasi.ts --vektor-yaz (tablo o dosyada). Elle düzenlenmez.",
    kural: KURAL,
    sql: SQL,
  };
  const kayitlar = VEKTORLER.map((v) => asciiJson({ vektor: { ad: v.ad, veritabani: v.veritabani, paketYollari: v.paketYollari }, beklenen: { paket: v.paket, ileride: v.ileride } }));
  return `${asciiJson(bas).slice(0, -1)},"kayitlar":[\n${kayitlar.join(",\n")}\n]}\n`;
}
if (process.argv.includes("--vektor-yaz")) {
  writeFileSync(VEKTOR_DOSYASI, vektorMetni());
  console.log(`yazıldı: ${VEKTOR_DOSYASI} (${VEKTORLER.length} kayıt)`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Kaynaklar
// ---------------------------------------------------------------------------
const YOL = {
  sema: "Teks-Erp/native/tekserp-guncelleyici/src/sema.rs",
  engine: "Teks-Erp/native/tekserp-guncelleyici/src/engine.rs",
  tools: "Teks-Erp/native/tekserp-guncelleyici/src/tools.rs",
  codes: "Teks-Erp/native/tekserp-guncelleyici/src/codes.rs",
  rustTest: "Teks-Erp/native/tekserp-guncelleyici/tests/sema_hizasi.rs",
  ps: "deploy/hizmet/sema-hizasi.ps1",
  kurulum: "deploy/kurulum/kurulum.ps1",
  gecis: "deploy/gecis/gecis.ps1",
  etiket: "Electron/src/pages/System/ServerUpdates/labels.ts",
  onay: "Teks-Erp/src/services/helpers/update-approval-rules.helper.ts",
  tasarim: "docs/design/GUNCELLEYICI.md",
  vektor: "Teks-Erp/native/test-vektorleri/sema-hizasi.json",
} as const;
type Ad = keyof typeof YOL;
type Kaynaklar = Record<Ad, string>;
function oku(rel: string): string | undefined {
  try {
    return readFileSync(join(KOK, rel), "utf8").replace(/^﻿/, "").replace(/\r\n/g, "\n");
  } catch {
    return undefined;
  }
}

/** Rust işlev gövdesi: `fn <ad>(`dan eşleşen kapanış süslüsüne (dize içindeki süslüler sayılmaz). */
function rustGovde(src: string, ad: string): string | null {
  const m = new RegExp(`\\bfn ${ad}\\b[^{]*\\{`).exec(src);
  if (!m) return null;
  let i = m.index + m[0].length;
  let d = 1;
  let dize = false;
  for (; i < src.length && d > 0; i++) {
    const c = src[i];
    if (dize) {
      if (c === "\\") i++;
      else if (c === '"') dize = false;
    } else if (c === '"') dize = true;
    else if (c === "{") d++;
    else if (c === "}") d--;
  }
  return d === 0 ? src.slice(m.index, i) : null;
}
/** PowerShell işlevinin YORUMSUZ kod satırları. */
function psGovde(src: string, ad: string): string | null {
  const t = psTara(src);
  const f = t.fonksiyonlar.find((x) => x.ad === ad);
  if (!f) return null;
  return t.satirlar.filter((s) => s.no >= f.bas && s.no <= f.son).map((s) => s.kod).join("\n");
}
function psKod(src: string): string {
  return psTara(src).satirlar.map((s) => s.kod).join("\n");
}
const literal = (src: string, desen: RegExp): string | null => desen.exec(src)?.[1] ?? null;

// ---------------------------------------------------------------------------
// Yüklemler (ihlal listesi döner; boş = temiz)
// ---------------------------------------------------------------------------
function tekTanim(k: Kaynaklar): string[] {
  const ih: string[] = [];
  if (k.vektor !== vektorMetni()) ih.push("vektör dosyası --vektor-yaz çıktısından farklı (elle düzenlenmiş ya da tablo değişmiş: --vektor-yaz)");
  const rs = literal(k.sema, /pub const FINISHED_MIGRATIONS_SQL: &str =\s*"([^"]*)";/);
  const ps = literal(psKod(k.ps), /^\$script:SEMA_BITMIS_GOC_SQL = "([^"]*)"\s*$/m);
  if (rs !== SQL) ih.push(`Rust FINISHED_MIGRATIONS_SQL tanımdan farklı: ${rs ?? "yok"}`);
  if (ps !== SQL) ih.push(`PS $SEMA_BITMIS_GOC_SQL tanımdan farklı: ${ps ?? "yok"}`);
  for (const p of ['"sema-hizasi.json"', "sema::ahead(", "sema::package_migrations(", "sema::FINISHED_MIGRATIONS_SQL", 'r["beklenen"]["ileride"]']) {
    if (!k.rustTest.includes(p)) ih.push(`Rust vektör testi ${p} kullanmıyor`);
  }
  return ih;
}

function guncelleyici(k: Kaynaklar): string[] {
  const ih: string[] = [];
  const cyc = rustGovde(k.engine, "cycle");
  const chk = rustGovde(k.engine, "schema_check");
  if (!cyc || !chk) return [`engine.rs ${!cyc ? "cycle" : "schema_check"} gövdesi bulunamadı`];
  const at = (s: string) => cyc.indexOf(s);
  const cagri = at("self.schema_check(");
  if (cagri < 0) ih.push("cycle şema hizasını ölçmüyor (self.schema_check çağrısı yok)");
  else {
    if ((cyc.match(/self\.schema_check\(/g) ?? []).length !== 1) ih.push("cycle'da birden çok schema_check çağrısı");
    if (!(cagri > at("self.prepare_backend(") && cagri > at("self.prepare_pg("))) ih.push("schema_check hazırlıktan (paket + PG) ÖNCE — paketin göç listesi henüz yok");
    for (const s of ["State::Ready", "self.run_pg(", "self.run_backend("]) if (at(s) < 0 || cagri > at(s)) ih.push(`schema_check ${s}'dan SONRA (ya da o yok) — ileride paket HAZIR/uygulanır`);
    const dal = cyc.slice(cagri, cyc.indexOf("return idle;", cagri));
    if (!/State::Waiting/.test(dal)) ih.push("şema ileride dalı BEKLİYOR yazmıyor");
  }
  for (const p of ["sema::ahead(", "sema::package_migrations(", "tools::finished_migrations(", "codes::SEMA_ILERIDE"]) if (!chk.includes(p)) ih.push(`schema_check ${p} kullanmıyor`);
  if (/migration_count/.test(chk)) ih.push("schema_check sayı karşılaştırıyor (migration_count) — ölçüt ad kümesi");
  const fm = rustGovde(k.tools, "finished_migrations");
  if (!fm?.includes("crate::sema::FINISHED_MIGRATIONS_SQL")) ih.push("tools::finished_migrations ortak SQL'i (sema::FINISHED_MIGRATIONS_SQL) koşmuyor");
  return ih;
}

const ORTAK_ISLEVLER = /\b(SemaIleride|GocFarki|PaketGocAdlari|SurumGocAdlari)\b/g;
function kurulumGecis(k: Kaynaklar): string[] {
  const ih: string[] = [];
  const kur = psKod(k.kurulum);
  if (!/^\. \(Join-Path \$PSScriptRoot "\.\.\\hizmet\\sema-hizasi\.ps1"\)\s*$/m.test(kur)) ih.push("kurulum.ps1 hizmet\\sema-hizasi.ps1'i yüklemiyor");
  const be = psGovde(k.kurulum, "AsamaBackend");
  if (!be) ih.push("kurulum.ps1 AsamaBackend yok");
  else {
    const goc = be.indexOf('"migrate", "deploy"');
    const once = be.search(/\$ileri = @\(SemaIleride \$once \$paketGoclari\)/);
    const dur = be.search(/if \(\$ileri\.Count\) \{ Dur "sema ileride/);
    if (goc < 0) ih.push("AsamaBackend migrate deploy bulunamadı");
    if (once < 0 || dur < 0 || once > goc || dur > goc) ih.push("setup şema ileride engeli göç ÖNCESİNDE değil (hiçbir şey değişmeden durmalı)");
    if (!/\$paketGoclari = @\(SurumGocAdlari /.test(be)) ih.push("setup paketin göç adlarını ortak SurumGocAdlari'ndan okumuyor");
    const sonra = be.slice(Math.max(goc, 0));
    if (!/@\(GocFarki \$paketGoclari \$sonra\)/.test(sonra) || !/@\(SemaIleride \$sonra \$paketGoclari\)/.test(sonra)) ih.push("setup göç SONRASI ad eşitliğini (eksik + fazla) ölçmüyor");
  }
  if (/count\(\*\) FROM _prisma_migrations/.test(kur)) ih.push("kurulum.ps1 hâlâ göç SAYISI karşılaştırıyor — ölçüt ad kümesi");
  if (!/\$\(\$script:SEMA_BITMIS_GOC_SQL\)/.test(psGovde(k.kurulum, "BitmisGoclar") ?? "")) ih.push("setup BitmisGoclar ortak SQL'i ($SEMA_BITMIS_GOC_SQL) koşmuyor");
  const gec = psKod(k.gecis);
  if (!/^\. \$script:SEMA_HIZASI\s*$/m.test(gec) || !/\$script:SEMA_HIZASI = Join-Path \(Split-Path \$script:KANAL_ADLARI -Parent\) "sema-hizasi\.ps1"/.test(gec)) ih.push("gecis.ps1 sema-hizasi.ps1'i paketteki komşusundan yüklemiyor");
  if (!/\$fazla = @\(SemaIleride \$uyg \$E\.PaketGoclari\)/.test(gec) || !/\$bekleyen = @\(GocFarki \$E\.PaketGoclari \$uyg\)/.test(gec) || !/\$E\.PaketGoclari = @\(PaketGocAdlari \$adlar\)/.test(gec))
    ih.push("geçiş fazla/bekleyen göçü ve paketin göç adlarını ortak işlevle ölçmüyor");
  for (const [ad, metin] of [["kurulum.ps1", k.kurulum], ["gecis.ps1", k.gecis]] as const) {
    for (const s of psTara(metin).satirlar) {
      for (const m of s.ciplak.matchAll(ORTAK_ISLEVLER)) {
        if (/^\s*function\s/.test(s.ciplak)) continue;
        if (s.ciplak.slice(Math.max(0, m.index! - 2), m.index) !== "@(") ih.push(`${ad}:${s.no} ${m[1]} @( ) ile sarılmamış (tek elemanlı sonuç açılır)`);
      }
    }
  }
  return ih;
}

function aynalar(k: Kaynaklar): string[] {
  const ih: string[] = [];
  if (!/^pub const SEMA_ILERIDE: &str = "SEMA_ILERIDE";$/m.test(k.codes)) ih.push("codes.rs SEMA_ILERIDE yok");
  const kodlar = /const RESULT_CODES: Record<string, string> = \{([\s\S]*?)\n\};/.exec(k.etiket)?.[1] ?? "";
  if (!/^\s*SEMA_ILERIDE: "[^"]*geri indirme[^"]*",$/m.test(kodlar)) ih.push('panel "Sorun" etiketi (labels.ts RESULT_CODES) SEMA_ILERIDE taşımıyor');
  const neden = /function installWaitingReason\([\s\S]*?\n\}/.exec(k.onay)?.[0] ?? "";
  if (!/if \(hataKodu === "SEMA_ILERIDE"\) return `[^`]*geri indirme[^`]*daha yeni[^`]*`;/.test(neden)) ih.push("onay kuralı installWaitingReason SEMA_ILERIDE nedenini söylemiyor");
  const s12 = k.tasarim.slice(k.tasarim.indexOf("## §12 Kodlar"));
  if (!/\*\*`durum\.hataKodu` \(şu anki sorun\):\*\*[^\n]*`SEMA_ILERIDE`/.test(s12)) ih.push("GUNCELLEYICI.md §12 hataKodu listesinde SEMA_ILERIDE yok");
  return ih;
}

// ---------------------------------------------------------------------------
// §2 PS davranışı (pwsh)
// ---------------------------------------------------------------------------
function pwshVar(): boolean {
  const r = spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-Command", "$PSVersionTable.PSVersion.Major"], { encoding: "utf8", timeout: 60_000 });
  return !r.error && r.status === 0 && Number((r.stdout ?? "").trim()) >= 7;
}
const KOSUCU = `param([string]$Ps, [string]$Vektor)
$ErrorActionPreference = "Stop"
. $Ps
$v = Get-Content -LiteralPath $Vektor -Raw -Encoding UTF8 | ConvertFrom-Json
$i = 0
foreach ($r in $v.kayitlar) {
  $paket = @(PaketGocAdlari ([string[]]@($r.vektor.paketYollari)))
  $ileri = @(SemaIleride ([string[]]@($r.vektor.veritabani)) $paket)
  Write-Output ("R|" + $i + "|" + ($paket -join ",") + "|" + ($ileri -join ","))
  $i++
}
`;
/** Her vektör için PS çıktısı; ayrışan kayıtlar (boş = aynı). */
function psKos(psYolu: string, dizin: string): { kod: number | null; ayrisan: string[]; satir: number } {
  const kosucu = join(dizin, "kosucu.ps1");
  writeFileSync(kosucu, KOSUCU);
  const r = spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-File", kosucu, "-Ps", psYolu, "-Vektor", VEKTOR_DOSYASI], { encoding: "utf8", timeout: 120_000 });
  const satirlar = (r.stdout ?? "").split(/\r?\n/).filter((s) => s.startsWith("R|"));
  const ayrisan: string[] = [];
  VEKTORLER.forEach((v, i) => {
    const s = satirlar.find((x) => x.startsWith(`R|${i}|`));
    const beklenen = `R|${i}|${v.paket.join(",")}|${v.ileride.join(",")}`;
    if (s !== beklenen) ayrisan.push(`${v.ad}: ${s ?? "çıktı yok"} (beklenen ${beklenen})`);
  });
  if (r.status !== 0) ayrisan.push(`pwsh çıkış ${r.status}: ${(r.stderr ?? "").split("\n").slice(0, 3).join(" ")}`);
  return { kod: r.status, ayrisan, satir: satirlar.length };
}

// ---------------------------------------------------------------------------
// KOŞU
// ---------------------------------------------------------------------------
const okunan: Partial<Kaynaklar> = {};
const eksik: string[] = [];
for (const [ad, rel] of Object.entries(YOL) as Array<[Ad, string]>) {
  const m = oku(rel);
  if (m === undefined) eksik.push(rel);
  else okunan[ad] = m;
}
check("§0 kaynaklar okundu (ÖLÇÜLEMEDİ değil)", eksik.length === 0, eksik.length ? `okunamadı: ${eksik.join(", ")}` : `${Object.keys(YOL).length} dosya`);
if (eksik.length === 0) {
  const k = okunan as Kaynaklar;
  const rapor = (label: string, ih: string[]) => check(label, ih.length === 0, ih.join(" · ") || "temiz");

  console.log("\n§1 tek tanım");
  rapor("§1 ⭐ vektörler = tablo (--vektor-yaz) · SQL Rust ve PS'te bayt-eşit · Rust testi vektörleri okur", tekTanim(k));

  console.log("\n§2 PS davranışı (pwsh) — sema-hizasi.ps1 ortak vektörlere");
  let dizin: string | null = null;
  if (!pwshVar()) defter.atla("§2 PS davranışı + ✓K PS sondaları", "pwsh 7 yok", 3);
  else {
    dizin = mkdtempSync(join(tmpdir(), "sema-hizasi-"));
    const h = psKos(join(KOK, YOL.ps), dizin);
    check("§2 ⭐ PS PaketGocAdlari + SemaIleride her vektörde beklenen (Rust'la aynı tablo)", h.ayrisan.length === 0 && h.satir === VEKTORLER.length, h.ayrisan.join(" · ") || `${h.satir} kayıt`);
  }

  console.log("\n§3 güncelleyici");
  rapor("§3 ⭐ schema_check hazırlıktan sonra, HAZIR/uygulamadan önce; ileride → BEKLİYOR + SEMA_ILERIDE; ölçüt ad kümesi", guncelleyici(k));

  console.log("\n§4 setup + geçiş");
  rapor("§4 ⭐ setup göç ÖNCESİ engel + göç SONRASI ad eşitliği, geçiş ortak işlevle; sayı sorgusu yok; çağrılar @( ) ile", kurulumGecis(k));

  console.log("\n§5 kod aynası");
  rapor("§5 SEMA_ILERIDE: codes.rs · panel Sorun etiketi · onay kuralı bekleyiş nedeni · GUNCELLEYICI.md §12", aynalar(k));

  // ✓K NEGATİF SONDALAR — bozulmuş kopyada yüklem KIRMIZI olmalı; mutasyon uygulanmadıysa sonda geçersiz.
  console.log("\n✓K negatif sondalar (bellekte bozulmuş kopya → kırmızı)");
  type Sonda = { ad: string; dosya: Ad; eski: string | RegExp; yeni: string; yuklem: (k: Kaynaklar) => string[]; parca: string };
  const SONDALAR: Sonda[] = [
    { ad: "K1 vektör beklenenini elle değiştir", dosya: "vektor", eski: '"ileride":["20261001000000_ucuncu"]', yeni: '"ileride":[]', yuklem: tekTanim, parca: "--vektor-yaz" },
    { ad: "K2 Rust SQL geri alınmışı da sayar", dosya: "sema", eski: " AND rolled_back_at IS NULL ORDER BY 1", yeni: " ORDER BY 1", yuklem: tekTanim, parca: "Rust FINISHED_MIGRATIONS_SQL" },
    { ad: "K3 PS SQL ayrıştı", dosya: "ps", eski: "WHERE finished_at IS NOT NULL", yeni: "WHERE finished_at IS NULL", yuklem: tekTanim, parca: "PS $SEMA_BITMIS_GOC_SQL" },
    { ad: "K4 güncelleyicide kontrol kaldırıldı", dosya: "engine", eski: "if let Err((code, msg)) = self.schema_check(inputs, &m.doc) {", yeni: "if let Err((code, msg)) = Ok::<(), Fail>(()) {", yuklem: guncelleyici, parca: "self.schema_check çağrısı yok" },
    { ad: "K5 kontrol sayıya döndü", dosya: "engine", eski: "let extra = sema::ahead(&db, &package);", yeni: "let extra: Vec<String> = if db.len() > package.len() { db.clone() } else { vec![] }; let _ = tools::migration_count;", yuklem: guncelleyici, parca: "sema::ahead( kullanmıyor" },
    { ad: "K6 HAZIR kontrolden önce yazılır", dosya: "engine", eski: "        // Şema hizası: paket şemanın gerisindeyse", yeni: "        let _hazir = State::Ready;\n        // Şema hizası: paket şemanın gerisindeyse", yuklem: guncelleyici, parca: "State::Ready'dan SONRA" },
    { ad: "K7 setup göç öncesi engeli kalktı", dosya: "kurulum", eski: 'if ($ileri.Count) { Dur "sema ileride', yeni: 'if ($false) { Dur "sema ileride', yuklem: kurulumGecis, parca: "göç ÖNCESİNDE değil" },
    { ad: "K8 setup sayı sorgusuna döndü", dosya: "kurulum", eski: '$tablo = PsqlStdin $bin $port $rol $uyParola $vt "SELECT to_regclass', yeni: '$say = PsqlStdin $bin $port $rol $uyParola $vt "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL;"\n  $tablo = PsqlStdin $bin $port $rol $uyParola $vt "SELECT to_regclass', yuklem: kurulumGecis, parca: "SAYISI" },
    { ad: "K9 geçiş fazlayı kendi -notcontains'iyle sayar", dosya: "gecis", eski: "$fazla = @(SemaIleride $uyg $E.PaketGoclari)", yeni: "$fazla = @($uyg | Where-Object { $E.PaketGoclari -notcontains $_ })", yuklem: kurulumGecis, parca: "ortak işlevle ölçmüyor" },
    { ad: "K10 setup çağrısı @( ) siz", dosya: "kurulum", eski: "$ileri = @(SemaIleride $once $paketGoclari)", yeni: "$ileri = SemaIleride $once $paketGoclari", yuklem: kurulumGecis, parca: "@( ) ile sarılmamış" },
    { ad: "K11 panel etiketi düştü", dosya: "etiket", eski: /\n\s*SEMA_ILERIDE: "[^"]*",/, yeni: "", yuklem: aynalar, parca: "panel" },
    { ad: "K12 onay kuralı genel dala düştü", dosya: "onay", eski: /\n\s*if \(hataKodu === "SEMA_ILERIDE"\)[^\n]*/, yeni: "", yuklem: aynalar, parca: "installWaitingReason" },
  ];
  for (const s of SONDALAR) {
    const kopya = { ...k };
    const once = kopya[s.dosya];
    kopya[s.dosya] = once.replace(s.eski, s.yeni);
    const uygulandi = kopya[s.dosya] !== once;
    const ih = s.yuklem(kopya);
    check(`✓K ${s.ad} → KIRMIZI`, uygulandi && ih.some((x) => x.includes(s.parca)), uygulandi ? ih.join(" · ") || "yüklem YEŞİL kaldı" : "mutasyon uygulanmadı (sonda geçersiz)");
  }
  if (dizin) {
    const psOrijinal = k.ps;
    const PS_SONDALARI: Array<{ ad: string; eski: string; yeni: string }> = [
      { ad: "K13 PS hiç ileride demez", eski: "if ($null -ne $x -and -not $p.Contains($x))", yeni: "if ($null -ne $x -and $false)" },
      { ad: "K14 PS büyük/küçük harfi yok sayar", eski: "New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)", yeni: "New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)" },
    ];
    for (const s of PS_SONDALARI) {
      const bozuk = psOrijinal.replace(s.eski, s.yeni);
      const yol = join(dizin, "sema-hizasi.ps1");
      writeFileSync(yol, bozuk);
      const h = psKos(yol, dizin);
      check(`✓K ${s.ad} → §2 KIRMIZI`, bozuk !== psOrijinal && h.ayrisan.length > 0, bozuk === psOrijinal ? "mutasyon uygulanmadı" : h.ayrisan.slice(0, 2).join(" · ") || "PS YEŞİL kaldı");
    }
    rmSync(dizin, { recursive: true, force: true });
  }
}

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız${defter.ozetEki()} ===`);
process.exit(fail > 0 ? 1 : 0);
