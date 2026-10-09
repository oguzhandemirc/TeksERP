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
//   §6 ÖLÇÜLEMEDİ — üçüncü sonuç (yönetici kararı 2026-10-02): okunamayan yan boş küme SAYILMAZ (`sema::verdict`);
//      güncelleyici DURMAZ ama sessiz geçmez — `SEMA_OLCULEMEDI` BİLGİ satırı günlüğe + `durum.bilgi`ye (`hataKodu`
//      DEĞİL); backend `yerel.bilgi`ye geçirir (davranış), panel "Bilgi" satırı ("Sorun" değil); vektörde iki
//      ölçülemedi kaydı; setup/geçiş aynı sonucu ÇAĞIRANDA durdurur (setup `Dur`, geçiş `Engel` — davranış değişmedi)
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
import { UpdaterStatusDocSchema, type UpdaterRead } from "../src/lib/license/updater-ipc";
import { updateStatusFrom } from "../src/services/update-status.service";

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
  "(prisma/migrations/<ad>/migration.sql) alt kümesi değilse ŞEMA İLERİDE: paket şemayı geri indirir, uygulanmaz. Ad bayt-eşit. " +
  "Üç sonuç: UYUMLU · ILERIDE · OLCULEMEDI (bir yan okunamadı; null girdi — boş küme SAYILMAZ).";
const g = (ad: string) => `prisma/migrations/${ad}/migration.sql`;
type Sonuc = "UYUMLU" | "ILERIDE" | "OLCULEMEDI";
/** `null` girdi = o yan OKUNAMADI (veritabanı sorgusu düştü · paketin göç dizini hiç yok); çıktıda `null` = ölçülmedi. */
interface Vektor {
  ad: string;
  veritabani: string[] | null;
  paketYollari: string[] | null;
  paket: string[] | null;
  ileride: string[] | null;
  sonuc: Sonuc;
}
const A = "20260901000000_ilk";
const B = "20260915000000_ikinci";
const C = "20261001000000_ucuncu";
const VEKTORLER: Vektor[] = [
  { ad: "eşit", veritabani: [A, B], paketYollari: [g(A), g(B)], paket: [A, B], ileride: [], sonuc: "UYUMLU" },
  { ad: "geride (paket ileri götürür)", veritabani: [A], paketYollari: [g(A), g(B)], paket: [A, B], ileride: [], sonuc: "UYUMLU" },
  { ad: "ileride (bir fazla göç)", veritabani: [A, B, C], paketYollari: [g(A), g(B)], paket: [A, B], ileride: [C], sonuc: "ILERIDE" },
  { ad: "sayı eşit ad farklı (sayı karşılaştırması kaçırırdı)", veritabani: [A, C], paketYollari: [g(A), g(B)], paket: [A, B], ileride: [C], sonuc: "ILERIDE" },
  { ad: "boş veritabanı", veritabani: [], paketYollari: [g(A)], paket: [A], ileride: [], sonuc: "UYUMLU" },
  { ad: "göçsüz paket", veritabani: [A], paketYollari: [], paket: [], ileride: [A], sonuc: "ILERIDE" },
  { ad: "ad bayt-eşit (büyük/küçük harf ayrı)", veritabani: ["20260901000000_Ilk"], paketYollari: [g(A)], paket: [A], ileride: ["20260901000000_Ilk"], sonuc: "ILERIDE" },
  {
    ad: "migration.sql taşımayan dizin ve kilit dosyası göç değil",
    veritabani: [A, "20260920000000_bos"],
    paketYollari: [g(A), "prisma/migrations/20260920000000_bos/README.md", "prisma/migrations/migration_lock.toml", "prisma/migrations/20260921000000_derin/alt/migration.sql"],
    paket: [A],
    ileride: ["20260920000000_bos"],
    sonuc: "ILERIDE",
  },
  { ad: "tekrarlı ad tekil", veritabani: [C, A, C], paketYollari: [g(A)], paket: [A], ileride: [C], sonuc: "ILERIDE" },
  {
    ad: "sıra ordinal (büyük harf önce)",
    veritabani: ["20260930000000_b", "20260930000000_Z", "20260930000000_B"],
    paketYollari: [],
    paket: [],
    ileride: ["20260930000000_B", "20260930000000_Z", "20260930000000_b"],
    sonuc: "ILERIDE",
  },
  // ÖLÇÜLEMEDİ (yönetici kararı 2026-10-02): okunamayan yan boş küme sayılırsa veritabanı okunamayınca her paket "uyumlu",
  // dizini olmayan paket "göçsüz" görünür. Güncelleyici bu sonuçta DURMAZ (BİLGİ, SEMA_OLCULEMEDI); setup/geçiş çağıranda durur.
  { ad: "ölçülemedi: veritabanı okunamadı (boş küme sayılmaz)", veritabani: null, paketYollari: [g(A)], paket: [A], ileride: null, sonuc: "OLCULEMEDI" },
  { ad: "ölçülemedi: paketin göç dizini yok (göçsüz paketle karışmaz)", veritabani: [A], paketYollari: null, paket: null, ileride: null, sonuc: "OLCULEMEDI" },
];

const VEKTOR_DOSYASI = join(TEKS, "native", "test-vektorleri", "sema-hizasi.json");
function asciiJson(v: unknown): string {
  return JSON.stringify(v).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}
function vektorMetni(): string {
  const bas = {
    bicim: 2,
    not: "Üreten: Teks-Erp/scripts/test_sema_hizasi.ts --vektor-yaz (tablo o dosyada). Elle düzenlenmez.",
    kural: KURAL,
    sql: SQL,
  };
  const kayitlar = VEKTORLER.map((v) =>
    asciiJson({ vektor: { ad: v.ad, veritabani: v.veritabani, paketYollari: v.paketYollari }, beklenen: { paket: v.paket, ileride: v.ileride, sonuc: v.sonuc } }),
  );
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
  tools: "Teks-Erp/native/tekserp-guncelleyici/src/platform/windows/araclar.rs",
  codes: "Teks-Erp/native/tekserp-guncelleyici/src/codes.rs",
  rustTest: "Teks-Erp/native/tekserp-guncelleyici/tests/sema_hizasi.rs",
  ps: "deploy/hizmet/sema-hizasi.ps1",
  kurulum: "deploy/kurulum/kurulum.ps1",
  gecis: "deploy/gecis/gecis.ps1",
  etiket: "Electron/src/pages/System/ServerUpdates/labels.ts",
  onay: "Teks-Erp/src/services/helpers/update-approval-rules.helper.ts",
  tasarim: "docs/design/GUNCELLEYICI.md",
  vektor: "Teks-Erp/native/test-vektorleri/sema-hizasi.json",
  ipc: "Teks-Erp/native/tekserp-guncelleyici/src/ipc.rs",
  ipcTs: "Teks-Erp/src/lib/license/updater-ipc.ts",
  kart: "Electron/src/pages/System/ServerUpdates/UpdateCards.tsx",
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
  for (const p of ['"sema-hizasi.json"', "sema::verdict(", "sema::package_migrations(", "sema::FINISHED_MIGRATIONS_SQL", 'r["beklenen"]["ileride"]']) {
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
  for (const p of ["sema::verdict(", "sema::package_migrations(", "tools::finished_migrations(", "codes::SEMA_ILERIDE"]) if (!chk.includes(p)) ih.push(`schema_check ${p} kullanmıyor`);
  if (/migration_count/.test(chk)) ih.push("schema_check sayı karşılaştırıyor (migration_count) — ölçüt ad kümesi");
  if (!/let extra = ahead\(&db, &package\);/.test(rustGovde(k.sema, "verdict") ?? "")) ih.push("sema::verdict ölçütü sema::ahead( (ad kümesi) kullanmıyor");
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

/** Rust `match` kolu: `<desen>`den sonraki ilk `sema::Verdict::` koluna (ya da gövde sonuna) kadar. */
function kol(govde: string, desen: string): string | null {
  const i = govde.indexOf(desen);
  if (i < 0) return null;
  const j = govde.indexOf("sema::Verdict::", i + desen.length);
  return govde.slice(i, j < 0 ? undefined : j);
}
function olculemedi(k: Kaynaklar): string[] {
  const ih: string[] = [];
  // Rust: üç sonuç; okunamayan yan Unmeasured (boş küme DEĞİL).
  for (const p of ["pub enum Verdict", "Aligned,", "Ahead(Vec<String>),", "Unmeasured(String),"]) if (!k.sema.includes(p)) ih.push(`sema.rs Verdict üç sonucu taşımıyor (${p} yok)`);
  const ver = rustGovde(k.sema, "verdict") ?? "";
  if ((ver.match(/Err\(e\) => return Verdict::Unmeasured\(/g) ?? []).length !== 2) ih.push("sema::verdict okunamayan yanı (paket + veritabanı) Unmeasured saymıyor — boş küme sayılırsa ileri şema 'uyumlu' görünür");
  const chk = rustGovde(k.engine, "schema_check") ?? "";
  if (!chk.includes("sema::verdict(")) ih.push("schema_check sonucu sema::verdict'ten almıyor");
  const olc = kol(chk, "sema::Verdict::Unmeasured(");
  if (!olc) ih.push("schema_check ölçülemedi kolu yok");
  else {
    if (!/self\.log\.info\([^;]*codes::SEMA_OLCULEMEDI/.test(olc)) ih.push("ölçülemedi kolu SEMA_OLCULEMEDI'yi günlüğe (BİLGİ) yazmıyor — sessiz geçiş");
    if (!/\*self\.notice\.borrow_mut\(\) = Some\(Notice \{ code: codes::SEMA_OLCULEMEDI/.test(olc)) ih.push("ölçülemedi kolu SEMA_OLCULEMEDI'yi durum dosyasına (durum.bilgi) yazmıyor — sessiz geçiş");
    if (/Err\(|State::Waiting|hataKodu|error_code/.test(olc) || !/\bOk\(\(\)\)/.test(olc)) ih.push("ölçülemedi kolu engel/sorun yazıyor — karar: güncelleme DURMAZ, BİLGİ düzeyi");
  }
  // Turun bilgisi önce gelir; yoksa (W1b) son 24 saatin onarım bilgisi (`onarim::recent_notice`) — tur bilgisi ezilmez.
  if (!/d\.notice = self\.notice\.borrow\(\)\.clone\(\)(?:\.or_else\(\|\| crate::onarim::recent_notice\([^;]*\))?;/.test(rustGovde(k.engine, "doc") ?? "")) ih.push("engine doc() durum.bilgi'yi taşımıyor");
  const tick = rustGovde(k.engine, "tick") ?? "";
  const sil = tick.indexOf("*self.notice.borrow_mut() = None;");
  if (sil < 0 || (tick.indexOf("self.write_status(") >= 0 && sil > tick.indexOf("self.write_status("))) ih.push("tick bilgiyi tur başında silmiyor — bayat bilgi sonraki tura taşınır");
  if (!/^pub const SEMA_OLCULEMEDI: &str = "SEMA_OLCULEMEDI";$/m.test(k.codes)) ih.push("codes.rs SEMA_OLCULEMEDI yok");
  if (!/#\[serde\(rename = "bilgi", default, skip_serializing_if = "Option::is_none"\)\]\s*pub notice: Option<Notice>,/.test(k.ipc)) ih.push("ipc.rs StatusDoc bilgi alanı yok ya da boşken yazılıyor (eski vektörler bayt-eşit kalmalı)");
  for (const p of ["finished_migrations_unreadable", "run_logged(", "SEMA_OLCULEMEDI", "st.notice", 'r["beklenen"]["sonuc"]', "sema::verdict("]) if (!k.rustTest.includes(p)) ih.push(`Rust testi ölçülemedi yolunu ölçmüyor (${p} yok)`);
  // Vektör: iki ölçülemedi kaydı — veritabanı okunamadı + paketin göç dizini yok.
  const olcKayit = k.vektor.split("\n").filter((l) => l.includes('"sonuc":"OLCULEMEDI"'));
  if (!olcKayit.some((l) => l.includes('"veritabani":null')) || !olcKayit.some((l) => l.includes('"paketYollari":null'))) ih.push("vektörde iki ölçülemedi kaydı (veritabani:null + paketYollari:null) yok");
  // Backend + panel: bilgi ayrı alanda, "Sorun" değil.
  if (!/^\s*bilgi: z\.unknown\(\)\.optional\(\),$/m.test(k.ipcTs)) ih.push("updater-ipc.ts durum şeması bilgi alanını atıyor (panele ulaşmaz)");
  const kodlar = /const RESULT_CODES: Record<string, string> = \{([\s\S]*?)\n\};/.exec(k.etiket)?.[1] ?? "";
  const bilgiler = /const NOTICES: Record<string, string> = \{([\s\S]*?)\n\};/.exec(k.etiket)?.[1] ?? "";
  if (/SEMA_OLCULEMEDI/.test(kodlar)) ih.push('panel SEMA_OLCULEMEDI\'yi "Sorun" sözlüğünde (RESULT_CODES) taşıyor — bilgi, sorun değil');
  if (!/^\s*SEMA_OLCULEMEDI: "[^"]*durdurulmadı[^"]*",$/m.test(bilgiler)) ih.push("panel bilgi etiketi (labels.ts NOTICES) SEMA_OLCULEMEDI taşımıyor");
  if (!/<InfoRow label="Bilgi">[\s\S]{0,200}noticeLabel\(y\.bilgi\.kod\)/.test(k.kart)) ih.push('panel kartı yerel.bilgi\'yi "Bilgi" satırında göstermiyor');
  // Belge: §8.0 cümlesi + §12'de hataKodu listesinin DIŞINDA.
  const s80 = k.tasarim.slice(k.tasarim.indexOf("**§8.0 Tur**"), k.tasarim.indexOf("| # | Adım (`adim`)"));
  if (!/ölçülemezse[^\n]*güncelleme DURMAZ[^\n]*`SEMA_OLCULEMEDI`/i.test(s80)) ih.push("GUNCELLEYICI.md §8.0 ölçülemedi cümlesi yok");
  const s12 = k.tasarim.slice(k.tasarim.indexOf("## §12 Kodlar"));
  if (/\*\*`durum\.hataKodu` \(şu anki sorun\):\*\*[^\n]*SEMA_OLCULEMEDI/.test(s12) || !/\*\*`durum\.bilgi\.kod`[^\n]*`SEMA_OLCULEMEDI`/.test(s12)) ih.push("GUNCELLEYICI.md §12: SEMA_OLCULEMEDI bilgi satırında değil (ya da hataKodu listesinde)");
  // Setup + geçiş (çağıran düzeyi): okunamayan yan boş küme olarak kurala girmez, DURUR.
  if (!/if \(\$r\.kod -ne 0\) \{ Dur "goc listesi okunamadi/.test(psGovde(k.kurulum, "BitmisGoclar") ?? "")) ih.push("setup BitmisGoclar okunamayınca DURMUYOR — boş liste kurala 'uyumlu' girer");
  if (!/if \(\$tablo\.kod -ne 0\) \{ Dur "veritabani olculemedi/.test(psGovde(k.kurulum, "AsamaBackend") ?? "")) ih.push("setup göç tablosu ölçülemeyince DURMUYOR");
  if (!/if \(\$g\.Kod -ne 0\) \{ Engel "goc listesi okunamadi/.test(psGovde(k.gecis, "DbEnvanteri") ?? "")) ih.push("geçiş göç listesi okunamayınca ENGELLEMİYOR");
  return ih;
}

/** Davranış: güncelleyicinin `bilgi`si backend görünümünde `yerel.bilgi`ye geçer, `hataKodu`na ve onay nedenine girmez;
 *  biçimsiz bilgi yalnız kendini düşürür. */
function backendGecis(): string[] {
  const ih: string[] = [];
  const doc = (bilgi: unknown) => ({
    v: 1, zaman: "2026-10-02T10:00:00.000Z", sonCanlilik: "2026-10-02T10:00:00.000Z", canlilikEsigiSn: 180, turSn: 60, guncelleyiciSurum: "0.1.3",
    kuruluSurum: "2.14.5", durum: "HAZIR", surum: "2.14.7", kaynakSurum: "2.14.5", urun: null, adim: null, hataKodu: null,
    mesaj: "2.14.7 hazır; ONAY_BEKLIYOR", ilerleme: null, planlanan: null, bilgi,
  });
  const gor = (bilgi: unknown) => {
    const p = UpdaterStatusDocSchema.safeParse(doc(bilgi));
    if (!p.success) return null;
    const read: UpdaterRead = { status: { kind: "ok", doc: p.data }, history: [] };
    return updateStatusFrom({ lease: null, tokens: [], read, kuruluSurum: "2.14.5", nowMs: Date.parse("2026-10-02T10:00:30.000Z") });
  };
  const iyi = gor({ kod: "SEMA_OLCULEMEDI", mesaj: "2.14.7 için şema hizası ölçülemedi (psql)" });
  if (!iyi) ih.push("bilgili durum dosyası şemadan geçmedi");
  else {
    if (iyi.yerel?.bilgi?.kod !== "SEMA_OLCULEMEDI") ih.push(`yerel.bilgi geçmedi: ${JSON.stringify(iyi.yerel?.bilgi)}`);
    if (iyi.yerel?.hataKodu !== null) ih.push(`bilgi hataKodu'na sızdı: ${iyi.yerel?.hataKodu}`);
    if ((iyi.eylemler.neden ?? "").includes("SEMA_OLCULEMEDI")) ih.push("onay nedeni bilgiyi sorun gibi okuyor");
  }
  const bozuk = gor({ kod: "küçük harf", mesaj: 5 });
  if (!bozuk) ih.push("biçimsiz bilgi bütün durum dosyasını düşürdü");
  else if (bozuk.yerel?.bilgi !== null) ih.push("biçimsiz bilgi null'a düşmedi");
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
  if ($null -eq $r.vektor.paketYollari) {
    # Paketin goc dizini yok: SurumGocAdlari ISTISNA atmali (bos kume = "gocsuz paket" ile karismasin).
    $s = "OKUNDU"
    try { [void](SurumGocAdlari (Join-Path ([IO.Path]::GetTempPath()) ("sema-yok-" + [guid]::NewGuid().ToString("N")))) } catch { $s = "OLCULEMEDI" }
    Write-Output ("R|" + $i + "|" + $s)
  } elseif ($null -ne $r.vektor.veritabani) {
    $paket = @(PaketGocAdlari ([string[]]@($r.vektor.paketYollari)))
    $ileri = @(SemaIleride ([string[]]@($r.vektor.veritabani)) $paket)
    Write-Output ("R|" + $i + "|" + ($paket -join ",") + "|" + ($ileri -join ","))
  }
  $i++
}
`;
/** PS'in beklenen satırı; veritabanı okunamayan kayıtta YOK — PS çekirdeğinde DB okuyucu yok, okumayı çağıran yapar
 *  (setup `BitmisGoclar` DUR · geçiş ENGEL; §6 ölçer). */
function psBeklenen(v: Vektor, i: number): string | null {
  if (v.paketYollari === null) return `R|${i}|OLCULEMEDI`;
  if (v.veritabani === null) return null;
  return `R|${i}|${(v.paket ?? []).join(",")}|${(v.ileride ?? []).join(",")}`;
}
const PS_KAYIT = VEKTORLER.filter((v, i) => psBeklenen(v, i) !== null).length;
/** Her vektör için PS çıktısı; ayrışan kayıtlar (boş = aynı). */
function psKos(psYolu: string, dizin: string): { kod: number | null; ayrisan: string[]; satir: number } {
  const kosucu = join(dizin, "kosucu.ps1");
  writeFileSync(kosucu, KOSUCU);
  const r = spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-File", kosucu, "-Ps", psYolu, "-Vektor", VEKTOR_DOSYASI], { encoding: "utf8", timeout: 120_000 });
  const satirlar = (r.stdout ?? "").split(/\r?\n/).filter((s) => s.startsWith("R|"));
  const ayrisan: string[] = [];
  VEKTORLER.forEach((v, i) => {
    const s = satirlar.find((x) => x.startsWith(`R|${i}|`));
    const beklenen = psBeklenen(v, i);
    if (s !== (beklenen ?? undefined)) ayrisan.push(`${v.ad}: ${s ?? "çıktı yok"} (beklenen ${beklenen ?? "çıktı yok"})`);
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
    check("§2 ⭐ PS PaketGocAdlari + SemaIleride her vektörde beklenen (Rust'la aynı tablo)", h.ayrisan.length === 0 && h.satir === PS_KAYIT, h.ayrisan.join(" · ") || `${h.satir} kayıt`);
  }

  console.log("\n§3 güncelleyici");
  rapor("§3 ⭐ schema_check hazırlıktan sonra, HAZIR/uygulamadan önce; ileride → BEKLİYOR + SEMA_ILERIDE; ölçüt ad kümesi", guncelleyici(k));

  console.log("\n§4 setup + geçiş");
  rapor("§4 ⭐ setup göç ÖNCESİ engel + göç SONRASI ad eşitliği, geçiş ortak işlevle; sayı sorgusu yok; çağrılar @( ) ile", kurulumGecis(k));

  console.log("\n§5 kod aynası");
  rapor("§5 SEMA_ILERIDE: codes.rs · panel Sorun etiketi · onay kuralı bekleyiş nedeni · GUNCELLEYICI.md §12", aynalar(k));

  console.log("\n§6 ölçülemedi — üçüncü sonuç (SEMA_OLCULEMEDI, bilgi, güncelleme sürer)");
  rapor("§6 ⭐ okunamayan yan boş küme sayılmaz · güncelleyici durmaz ama günlüğe + durum.bilgi'ye yazar · panel Bilgi (Sorun değil) · vektör · belge · setup/geçiş çağıranda durur", olculemedi(k));
  rapor("§6 ⭐ davranış: durum.bilgi → yerel.bilgi; hataKodu'na ve onay nedenine girmez; biçimsiz bilgi yalnız kendini düşürür", backendGecis());

  // ✓K NEGATİF SONDALAR — bozulmuş kopyada yüklem KIRMIZI olmalı; mutasyon uygulanmadıysa sonda geçersiz.
  console.log("\n✓K negatif sondalar (bellekte bozulmuş kopya → kırmızı)");
  type Sonda = { ad: string; dosya: Ad; eski: string | RegExp; yeni: string; yuklem: (k: Kaynaklar) => string[]; parca: string };
  const SONDALAR: Sonda[] = [
    { ad: "K1 vektör beklenenini elle değiştir", dosya: "vektor", eski: '"ileride":["20261001000000_ucuncu"]', yeni: '"ileride":[]', yuklem: tekTanim, parca: "--vektor-yaz" },
    { ad: "K2 Rust SQL geri alınmışı da sayar", dosya: "sema", eski: " AND rolled_back_at IS NULL ORDER BY 1", yeni: " ORDER BY 1", yuklem: tekTanim, parca: "Rust FINISHED_MIGRATIONS_SQL" },
    { ad: "K3 PS SQL ayrıştı", dosya: "ps", eski: "WHERE finished_at IS NOT NULL", yeni: "WHERE finished_at IS NULL", yuklem: tekTanim, parca: "PS $SEMA_BITMIS_GOC_SQL" },
    { ad: "K4 güncelleyicide kontrol kaldırıldı", dosya: "engine", eski: "if let Err((code, msg)) = self.schema_check(inputs, &m.doc) {", yeni: "if let Err((code, msg)) = Ok::<(), Fail>(()) {", yuklem: guncelleyici, parca: "self.schema_check çağrısı yok" },
    { ad: "K5 kontrol sayıya döndü", dosya: "sema", eski: "let extra = ahead(&db, &package);", yeni: "let extra: Vec<String> = if db.len() > package.len() { db.clone() } else { vec![] };", yuklem: guncelleyici, parca: "sema::ahead( (ad kümesi) kullanmıyor" },
    { ad: "K6 HAZIR kontrolden önce yazılır", dosya: "engine", eski: "        // Şema hizası: paket şemanın gerisindeyse", yeni: "        let _hazir = State::Ready;\n        // Şema hizası: paket şemanın gerisindeyse", yuklem: guncelleyici, parca: "State::Ready'dan SONRA" },
    { ad: "K7 setup göç öncesi engeli kalktı", dosya: "kurulum", eski: 'if ($ileri.Count) { Dur "sema ileride', yeni: 'if ($false) { Dur "sema ileride', yuklem: kurulumGecis, parca: "göç ÖNCESİNDE değil" },
    { ad: "K8 setup sayı sorgusuna döndü", dosya: "kurulum", eski: '$tablo = PsqlStdin $bin $port $rol $uyParola $vt "SELECT to_regclass', yeni: '$say = PsqlStdin $bin $port $rol $uyParola $vt "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL;"\n  $tablo = PsqlStdin $bin $port $rol $uyParola $vt "SELECT to_regclass', yuklem: kurulumGecis, parca: "SAYISI" },
    { ad: "K9 geçiş fazlayı kendi -notcontains'iyle sayar", dosya: "gecis", eski: "$fazla = @(SemaIleride $uyg $E.PaketGoclari)", yeni: "$fazla = @($uyg | Where-Object { $E.PaketGoclari -notcontains $_ })", yuklem: kurulumGecis, parca: "ortak işlevle ölçmüyor" },
    { ad: "K10 setup çağrısı @( ) siz", dosya: "kurulum", eski: "$ileri = @(SemaIleride $once $paketGoclari)", yeni: "$ileri = SemaIleride $once $paketGoclari", yuklem: kurulumGecis, parca: "@( ) ile sarılmamış" },
    { ad: "K11 panel etiketi düştü", dosya: "etiket", eski: /\n\s*SEMA_ILERIDE: "[^"]*",/, yeni: "", yuklem: aynalar, parca: "panel" },
    { ad: "K12 onay kuralı genel dala düştü", dosya: "onay", eski: /\n\s*if \(hataKodu === "SEMA_ILERIDE"\)[^\n]*/, yeni: "", yuklem: aynalar, parca: "installWaitingReason" },
    { ad: "K15 ölçülemedi günlüğe yazılmaz", dosya: "engine", eski: 'self.log.info(&format!("{}: {message}", codes::SEMA_OLCULEMEDI));', yeni: "", yuklem: olculemedi, parca: "günlüğe" },
    { ad: "K16 ölçülemedi durum dosyasına yazılmaz", dosya: "engine", eski: "*self.notice.borrow_mut() = Some(Notice { code: codes::SEMA_OLCULEMEDI.into(), message });", yeni: "let _ = message;", yuklem: olculemedi, parca: "durum dosyasına" },
    { ad: "K17 ölçülemedi engele döndü", dosya: "engine", eski: "message });\n                Ok(())", yeni: "message });\n                Err(fail(codes::SEMA_OLCULEMEDI, String::new()))", yuklem: olculemedi, parca: "engel/sorun" },
    { ad: "K18 okunamayan veritabanı boş küme sayılır", dosya: "sema", eski: "Err(e) => return Verdict::Unmeasured(e),", yeni: "Err(_) => vec![],", yuklem: olculemedi, parca: "boş küme" },
    { ad: "K19 bilgi tur başında silinmez", dosya: "engine", eski: "        *self.notice.borrow_mut() = None;\n", yeni: "", yuklem: olculemedi, parca: "tur başında" },
    { ad: "K20 panel bilgiyi Sorun sözlüğüne koyar", dosya: "etiket", eski: "const RESULT_CODES: Record<string, string> = {", yeni: 'const RESULT_CODES: Record<string, string> = {\n  SEMA_OLCULEMEDI: "Şema ölçülemedi",', yuklem: olculemedi, parca: "Sorun" },
    { ad: "K21 backend durum şeması bilgiyi atar", dosya: "ipcTs", eski: "  bilgi: z.unknown().optional(),\n", yeni: "", yuklem: olculemedi, parca: "panele ulaşmaz" },
    { ad: "K22 vektörün veritabanı-okunamadı kaydı boş kümeye döndü", dosya: "vektor", eski: '"veritabani":null', yeni: '"veritabani":[]', yuklem: olculemedi, parca: "iki ölçülemedi kaydı" },
    { ad: "K23 setup okunamayan göç listesini boş sayar", dosya: "kurulum", eski: 'if ($r.kod -ne 0) { Dur "goc listesi okunamadi: $($r.cikti)" }', yeni: "", yuklem: olculemedi, parca: "BitmisGoclar" },
    { ad: "K24 §8.0 ölçülemedi cümlesi düştü", dosya: "tasarim", eski: "`SEMA_OLCULEMEDI` BİLGİ düzeyinde", yeni: "uyarı", yuklem: olculemedi, parca: "§8.0" },
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
