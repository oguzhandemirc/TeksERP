// =============================================================================
// BEKÇİ — SATICI HESABININ KURULUM KİPİ (`superadmin-olustur --kurulum-stdin`, Dağıtım v2 D5, DB'siz)
// Çalıştır: npx tsx scripts/run-all-tests.ts kurulum_girdisi
// =============================================================================
// setup.exe sihirbazı satıcı parolasını araca BORUYLA verir (kullanıcının onayladığı plan: argv/ortam/
// günlük YOK). Etkileşimli kipin TTY kapısı readline'ın boruda DONMASINI önler; kurulum kipi readline
// kullanmaz ve aynı riski bayt tavanı + zaman aşımı + KATI şemayla kapatır. Ölçülen sözleşmeler:
//   §1 `kurulumGirdisiCoz`: yalnız {kullaniciAdi, parola, pin} · PIN TAM 6 hane · fazla/eksik alan RED ·
//      JSON hatası girdiden KESİT taşımaz (Node'un SyntaxError'u taşır)
//   §2 `kurulumGirdisiOku`: parçalı girdi · bayt tavanı · zaman aşımı (DONMA YOK) · boş girdi
//   §3 betik yapısı: kurulum kipi `--help`ten SONRA, TTY kapısından ÖNCE · kipte readline/console YOK ·
//      çıktı nesnelerinde parola/PIN YOK · her ProvisionErrorCode'un çıkış kodu var · rotasyon reddedilir
//   §4 uçtan uca (gerçek süreç, sahte DATABASE_URL — DB'ye GİDİLMEDEN düşen yollar): bozuk JSON · fazla alan
//      · boş girdi · tavan · --rotate → beklenen kod, süre sınırında, çıktıda SIR YOK
// NEGATİF SONDA (✓K, her koşumda): §3 yüklemi bozulmuş kopyalara koşar (kip TTY kapısının arkasına ·
//   çıktıya PIN · çıkış kodu düştü · kipte readline); her sonda mutasyonun UYGULANDIĞINI ölçer.
// DB'li yol (OLUSTURULDU / ZATEN_KURULU) `provisionSuperadmin`in kendisidir: test_superadmin_provision.
// =============================================================================
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path, { join } from "node:path";
import { PassThrough } from "node:stream";
import { KURULUM_GIRDI_TAVANI, KurulumGirdiHatasi, kurulumGirdisiCoz, kurulumGirdisiOku } from "./lib/kurulum-girdisi";

const TEKS = join(__dirname, "..");
const BETIK = join(__dirname, "superadmin-olustur.ts");
const SENTINEL = "Sentinel-Gizli-Parola-7f3a";
let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detay ? ` — ${detay}` : ""}`);
}

function hataKodu(f: () => unknown): string | null {
  try {
    f();
    return null;
  } catch (e) {
    return e instanceof KurulumGirdiHatasi ? `${e.kod}|${e.message}` : `?|${String(e)}`;
  }
}

function bolum1(): void {
  console.log("§1 kurulumGirdisiCoz");
  const g = kurulumGirdisiCoz(`{"kullaniciAdi":"satici","parola":"${SENTINEL}","pin":"012345"}`);
  check("§1a geçerli nesne çözülür (PIN baştaki sıfırla dizi)", g.kullaniciAdi === "satici" && g.parola === SENTINEL && g.pin === "012345");
  check("§1b BOM + boşluk tolere edilir", kurulumGirdisiCoz(`﻿  {"kullaniciAdi":"a1b","parola":"x","pin":"123456"}\n`).pin === "123456");
  check("§1c \\u kaçışlı Türkçe parola (sihirbaz ASCII JSON gönderir)", kurulumGirdisiCoz('{"kullaniciAdi":"abc","parola":"\\u015fifre\\u00e7","pin":"123456"}').parola === "şifreç");
  const durumlar: [string, string, string][] = [
    ["fazla alan", `{"kullaniciAdi":"a","parola":"${SENTINEL}","pin":"123456","rol":"x"}`, "GIRDI_BICIMSIZ"],
    ["eksik pin", `{"kullaniciAdi":"a","parola":"${SENTINEL}"}`, "GIRDI_BICIMSIZ"],
    ["PIN 5 hane", `{"kullaniciAdi":"a","parola":"${SENTINEL}","pin":"12345"}`, "GIRDI_BICIMSIZ"],
    ["PIN sayı tipi", `{"kullaniciAdi":"a","parola":"${SENTINEL}","pin":123456}`, "GIRDI_BICIMSIZ"],
    ["dizi", `["${SENTINEL}"]`, "GIRDI_BICIMSIZ"],
    ["bozuk JSON (sır içinde)", `{"kullaniciAdi":"a","parola":"${SENTINEL}`, "GIRDI_BICIMSIZ"],
    ["boş girdi", "   \n", "GIRDI_YOK"],
  ];
  for (const [ad, girdi, beklenen] of durumlar) {
    const r = hataKodu(() => kurulumGirdisiCoz(girdi));
    check(`§1d ${ad} → ${beklenen}, iletide SIR YOK`, r !== null && r.startsWith(`${beklenen}|`) && !r.includes(SENTINEL), r ?? "hata yok");
  }
}

async function bolum2(): Promise<void> {
  console.log("\n§2 kurulumGirdisiOku");
  const akisla = (yaz: (a: PassThrough) => void, tavan?: number, ms?: number) => {
    const a = new PassThrough();
    const p = kurulumGirdisiOku(a, tavan, ms);
    yaz(a);
    return p.then((v) => `TAMAM|${v.kullaniciAdi}`, (e: unknown) => (e instanceof KurulumGirdiHatasi ? `${e.kod}|${e.message}` : `?|${String(e)}`));
  };
  const parcali = await akisla((a) => {
    a.write('{"kullaniciAdi":"sat');
    a.write(`ici","parola":"${SENTINEL}","pin":"654321"}`);
    a.end();
  });
  check("§2a parçalı girdi birleşir", parcali === "TAMAM|satici", parcali);
  const tavan = await akisla((a) => {
    a.write("x".repeat(KURULUM_GIRDI_TAVANI + 1));
    a.end();
  });
  check("§2b bayt tavanı aşılınca GIRDI_TAVAN", tavan.startsWith("GIRDI_TAVAN|"), tavan);
  const t0 = Date.now();
  const asim = await akisla((a) => void a.write('{"kullaniciAdi":'), undefined, 300);
  check("§2c akış kapanmazsa ZAMAN_ASIMI (donma yok)", asim.startsWith("ZAMAN_ASIMI|") && Date.now() - t0 < 5000, `${asim} · ${Date.now() - t0} ms`);
  const bos = await akisla((a) => void a.end());
  check("§2d hemen kapanan boru GIRDI_YOK", bos.startsWith("GIRDI_YOK|"), bos);
}

/** §3 yüklemi: ihlal listesi (boş = uyumlu). */
function yapiIhlalleri(m: string): string[] {
  const ih: string[] = [];
  const help = m.indexOf('argv.includes("--yardim") || argv.includes("--help")');
  const kip = m.indexOf("if (argv.includes(KURULUM_STDIN_BAYRAGI)) return kurulumKipi(argv);");
  const tty = m.indexOf("if (!process.stdin.isTTY) {");
  if (help < 0 || kip < 0 || tty < 0) ih.push("yapı okunamadı (--help / kurulum kipi / TTY kapısı)");
  else if (!(help < kip && kip < tty)) ih.push("kurulum kipi --help'ten SONRA ve TTY kapısından ÖNCE değil");
  const bas = m.indexOf("async function kurulumKipi(");
  const son = m.indexOf("/** Kapının metni");
  if (bas < 0 || son < bas) ih.push("kurulumKipi gövdesi bulunamadı");
  else {
    const g = m.slice(bas, son);
    if (/createInterface|readline|console\.(log|error|warn)/.test(g)) ih.push("kurulum kipinde readline/console (soru ya da serbest çıktı)");
    for (const y of g.match(/yaz\(\{[^}]*\}\)/g) ?? []) if (/\b(pin|parola|password)\b\s*:/.test(y) || /\.(pin|parola|password)\b/.test(y)) ih.push(`çıktı nesnesi sır taşıyor: ${y.slice(0, 80)}`);
    if (!/argv\.includes\("--rotate"\)/.test(g)) ih.push("kurulum kipi rotasyonu reddetmiyor");
    if (!/rotate: false/.test(g)) ih.push("kurulum kipi rotasyonsuz çağırmıyor");
  }
  const birlik = /export type ProvisionErrorCode =([\s\S]*?);/.exec(m);
  const kodlar = birlik ? [...birlik[1]!.matchAll(/"([A-Z_]+)"/g)].map((x) => x[1]!) : [];
  if (!kodlar.length) ih.push("ProvisionErrorCode okunamadı");
  const cikis = /export const KURULUM_CIKIS[^{]*\{([\s\S]*?)\}\)/.exec(m)?.[1] ?? "";
  for (const k of [...kodlar, "OLUSTURULDU", "ZATEN_KURULU", "GIRDI_BICIMSIZ", "GIRDI_TAVAN", "GIRDI_YOK", "ZAMAN_ASIMI", "KIP"]) {
    if (!new RegExp(`\\b${k}:\\s*\\d+`).test(cikis)) ih.push(`çıkış kodu yok: ${k}`);
  }
  return ih;
}

function bolum3(): void {
  console.log("\n§3 betik yapısı (superadmin-olustur.ts)");
  const m = readFileSync(BETIK, "utf8").replace(/\r\n/g, "\n");
  const ih = yapiIhlalleri(m);
  check("§3a ⭐ kurulum kipi --help'ten sonra TTY kapısından önce · readline/console yok · çıktıda sır yok · her hata kodunun çıkışı var · rotasyon yok", ih.length === 0, ih.join(" | ") || "temiz");
  const sondalar: [string, string][] = [
    ["kip TTY kapısının ARKASINA taşındı", m.replace("  if (argv.includes(KURULUM_STDIN_BAYRAGI)) return kurulumKipi(argv);\n", "").replace("  const cikis = new SessizCikis();", "  if (argv.includes(KURULUM_STDIN_BAYRAGI)) return kurulumKipi(argv);\n  const cikis = new SessizCikis();")],
    ["çıktıya PIN eklendi", m.replace('kullaniciAdi: sonuc.username });', 'kullaniciAdi: sonuc.username, pin: sonuc.kind === "exists" ? "" : sonuc.pin });')],
    ["PIN_TAKEN çıkış kodu düştü", m.replace("  PIN_TAKEN: 14,\n", "")],
    ["kipte readline", m.replace("  let g: KurulumGirdisi;", '  const rl = createInterface({ input: process.stdin });\n  void rl;\n  let g: KurulumGirdisi;')],
  ];
  for (const [ad, mut] of sondalar) {
    const uygulandi = mut !== m;
    check(`§3 sonda: ${ad} → kırmızı`, uygulandi && yapiIhlalleri(mut).length > 0, uygulandi ? "" : "MUTASYON UYGULANMADI");
  }
}

function kos(girdi: string | null, ek: string[] = []): Promise<{ kod: number | null; cikti: string; ms: number; asti: boolean }> {
  const tsx = join(TEKS, "node_modules", ".bin", "tsx");
  return new Promise((resolve) => {
    const t0 = Date.now();
    const c = spawn(tsx, [BETIK, "--kurulum-stdin", ...ek], {
      cwd: TEKS,
      stdio: ["pipe", "pipe", "pipe"],
      // Sahte adres: bu yollar DB'ye GİTMEDEN düşmeli (gitseydi bağlantı hatası verirdi).
      // JWT_SECRET: betiğin import ettiği auth.service yüklenirken ister (sahada .env verir).
      env: { ...process.env, DATABASE_URL: "postgresql://yok:yok@127.0.0.1:9/yok", DOTENV_CONFIG_PATH: join(TEKS, "yok.env"), JWT_SECRET: "k".repeat(48) },
    });
    let cikti = "";
    c.stdout.on("data", (d: Buffer) => (cikti += d.toString("utf8")));
    c.stderr.on("data", (d: Buffer) => (cikti += d.toString("utf8")));
    if (girdi !== null) c.stdin.write(girdi);
    c.stdin.end();
    const z = setTimeout(() => {
      c.kill("SIGKILL");
      resolve({ kod: null, cikti, ms: Date.now() - t0, asti: true });
    }, 45_000);
    c.on("close", (kod) => {
      clearTimeout(z);
      resolve({ kod, cikti, ms: Date.now() - t0, asti: false });
    });
  });
}

async function bolum4(): Promise<void> {
  console.log("\n§4 uçtan uca (gerçek süreç, DB'ye gitmeyen yollar)");
  if (!existsSync(join(TEKS, "node_modules", ".bin", "tsx"))) {
    check("§4 ÖLÇÜLEMEDİ — tsx yok", false);
    return;
  }
  const durumlar: [string, string | null, string[], number, string][] = [
    ["bozuk JSON (sır içinde)", `{"kullaniciAdi":"satici","parola":"${SENTINEL}`, [], 20, "GIRDI_BICIMSIZ"],
    ["fazla alan", `{"kullaniciAdi":"satici","parola":"${SENTINEL}","pin":"123456","isSystemAccount":true}`, [], 20, "GIRDI_BICIMSIZ"],
    ["hemen kapanan boru", null, [], 20, "GIRDI_YOK"],
    ["tavan", "x".repeat(KURULUM_GIRDI_TAVANI + 10), [], 20, "GIRDI_TAVAN"],
    ["--rotate", `{"kullaniciAdi":"satici","parola":"${SENTINEL}","pin":"123456"}`, ["--rotate"], 22, "KIP"],
  ];
  for (const [ad, girdi, ek, beklenen, kod] of durumlar) {
    const r = await kos(girdi, ek);
    const json = r.cikti.split("\n").map((s) => s.trim()).filter((s) => s.startsWith("{")).pop() ?? "";
    let j: { sonuc?: string; kod?: string } = {};
    try {
      j = JSON.parse(json) as typeof j;
    } catch {
      /* aşağıda kırmızı */
    }
    check(`§4 ${ad} → çıkış ${beklenen} [${kod}], donma yok, çıktıda SIR YOK`,
      !r.asti && r.kod === beklenen && j.sonuc === "HATA" && j.kod === kod && !r.cikti.includes(SENTINEL),
      r.asti ? "ASILI KALDI" : `kod=${r.kod} · ${json.slice(0, 120)} · ${r.ms} ms`);
  }
}

async function main(): Promise<void> {
  console.log("test_kurulum_girdisi — satıcı hesabının kurulum kipi (DB'siz)\n");
  bolum1();
  await bolum2();
  bolum3();
  await bolum4();
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

void path;
main().catch((e: unknown) => {
  console.error(`⛔ BEKLENMEYEN: ${e instanceof Error ? e.stack : String(e)}`);
  process.exit(1);
});
