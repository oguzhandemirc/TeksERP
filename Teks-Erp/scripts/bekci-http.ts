// =============================================================================
// HTTP AYAKLI BEKÇİ KOŞUCUSU — kendi sunucusunu açar, bekçileri koşar, kapatır
// =============================================================================
// `TEST_API_URL` taşıyan bekçiler sunucu yoksa HTTP ayağını beyanla ATLAR
// (`lib/http-bekci-kapisi.ts`); günlük paket bu kontrolleri ölçmeden geçer. Bu
// koşucu verilen fixture DB'ye bakan TEK sunucuyu boş bir portta açar, adresi
// `TEST_API_URL` ile bekçilere verir ve yalnız KENDİ açtığı süreç grubunu kapatır.
//
// Koşum (Teks-Erp/ içinden; DATABASE_URL ortamdan ZORUNLU, .env okunmaz):
//   DATABASE_URL='postgresql://…/<ad>_test?schema=public' \
//     node ../scripts/agir-is.mjs -- npx tsx scripts/bekci-http.ts [--tam] [süzgeç…]
//   (varsayılan) `httpBekciKapisi(` çağıran her test_*.ts
//   --tam        bütün paket (`run-all-tests.ts`) aynı sunucuyla; atlayan dosyalar
//                sebepleri için ikinci kez tek tek koşulur
//   süzgeç       yalnız adında geçen HTTP bekçileri (ör. `superadmin rapor`);
//                `--tam` ile TEK süzgeç `run-all-tests.ts`e aynen geçer
//   TEKSERP_STRICT=1 kalan her atlamayı kırmızıya çevirir (`lib/atlama.ts`).
// Çıkış: 0 yeşil · 1 kırmızı / sunucu arızası · 2 hedef ya da kullanım reddi.
// =============================================================================
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { closeSync, createWriteStream, mkdtempSync, openSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createConnection, createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BILINMEYEN_BEYAN } from "./lib/atlama";
import { fixtureHedefEngeli, hacimHedefEngeli, hedefDbAdi, KACIS_ANAHTARLARI } from "./lib/hedef-db-kapisi";

const TEKS = join(__dirname, "..");
const SCRIPTS = __dirname;
const TSX = join(TEKS, "node_modules", ".bin", "tsx");
const SAGLIK_SURESI_MS = 120_000;
const DOSYA_SURESI_MS = 15 * 60_000;
const KAPANIS_SURESI_MS = 8_000;

/**
 * Koşucunun BİLEREK sağlamadığı ön koşullar: adıyla basılır, genel atlama sayısına
 * karışmaz. Süperadmin hesabı yalnız TTY'li `superadmin:kur` ile doğar (kök kural).
 */
const BEYANLI_ATLAMALAR: ReadonlyArray<{ dosya: string; etiket: string; neden: string }> = [
  { dosya: "test_rapor_kapisi.ts", etiket: "§7d2", neden: "süperadmin hesabı TTY ister" },
  { dosya: "test_rapor_kapisi.ts", etiket: "§7f", neden: "süperadmin hesabı TTY ister" },
];

interface Atlama {
  metin: string;
  adet: number | "?";
}

interface DosyaSonucu {
  dosya: string;
  cikis: number | null;
  sonuc: string;
  atlanan: number;
  bilinmeyen: boolean;
  atlamalar: Atlama[];
  ms: number;
}

let sunucu: ChildProcess | null = null;
let yedekDizini: string | null = null;

function ret(mesaj: string): never {
  console.error(`❌ ${mesaj}`);
  process.exit(2);
}

/** HTTP ayaklı bekçi = ortak kapıyı çağıran dosya; `TEST_API_URL`i yalnız TARAYAN bekçi (`test_script_guards`) dışarıda kalır. */
function httpBekcileri(suzgecler: string[]): string[] {
  return readdirSync(SCRIPTS)
    .filter((f) => /^test_.*\.ts$/.test(f))
    .filter((f) => readFileSync(join(SCRIPTS, f), "utf8").includes("httpBekciKapisi("))
    .filter((f) => suzgecler.length === 0 || suzgecler.some((s) => f.includes(s)))
    .sort();
}

function bosPort(): Promise<number> {
  return new Promise((coz, reddet) => {
    const s = createServer();
    s.on("error", reddet);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as AddressInfo;
      s.close(() => coz(port));
    });
  });
}

function portAcikMi(port: number): Promise<boolean> {
  return new Promise((coz) => {
    const c = createConnection({ port, host: "127.0.0.1" });
    c.once("connect", () => { c.destroy(); coz(true); });
    c.once("error", () => coz(false));
  });
}

const bekle = (ms: number) => new Promise((r) => setTimeout(r, ms));

function logKuyrugu(yol: string, satir = 25): string {
  try {
    return readFileSync(yol, "utf8").trimEnd().split("\n").slice(-satir).map((l) => `    │ ${l}`).join("\n");
  } catch {
    return "    │ (log okunamadı)";
  }
}

async function saglikBekle(base: string, logYolu: string): Promise<void> {
  const son = Date.now() + SAGLIK_SURESI_MS;
  let sonDurum = "yanıt yok";
  while (Date.now() < son) {
    if (sunucu?.exitCode !== null || sunucu?.signalCode) {
      throw new Error(`sunucu açılırken çıktı (kod ${sunucu?.exitCode ?? sunucu?.signalCode}); log:\n${logKuyrugu(logYolu)}`);
    }
    try {
      const r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(2000) });
      const govde = (await r.json().catch(() => ({}))) as { db?: string };
      if (r.ok && govde.db === "UP") return;
      sonDurum = `HTTP ${r.status}, db=${String(govde.db)}`;
    } catch {
      // sunucu henüz dinlemiyor
    }
    await bekle(500);
  }
  throw new Error(`/health ${SAGLIK_SURESI_MS / 1000} sn'de hazır olmadı (${sonDurum}); log:\n${logKuyrugu(logYolu)}`);
}

/** Yalnız bu koşucunun doğurduğu süreç grubu kapatılır; başka hiçbir süreç hedeflenmez. */
async function sunucuyuKapat(port: number | null): Promise<void> {
  const cocuk = sunucu;
  sunucu = null;
  if (cocuk?.pid && cocuk.exitCode === null && !cocuk.signalCode) {
    const cikti = new Promise<void>((r) => cocuk.once("exit", () => r()));
    try { process.kill(-cocuk.pid, "SIGTERM"); } catch { /* grup zaten yok */ }
    const zamanAsimi = bekle(KAPANIS_SURESI_MS).then(() => "zaman-asimi" as const);
    if ((await Promise.race([cikti, zamanAsimi])) === "zaman-asimi") {
      try { process.kill(-cocuk.pid, "SIGKILL"); } catch { /* grup zaten yok */ }
      await cikti;
    }
  }
  if (yedekDizini) rmSync(yedekDizini, { recursive: true, force: true });
  yedekDizini = null;
  if (port !== null && (await portAcikMi(port))) {
    console.error(`⚠️  ${port} portu kapanıştan sonra hâlâ açık — süreç grubunu elle kontrol et.`);
  }
}

/** `lib/atlama.ts` biçimi: `⏭️  ATLANDI — <etiket> — <sebep>` + alt satırda `↳ N kontrol koşmadı`. */
function atlamalariAyikla(satirlar: string[]): Atlama[] {
  const sonuc: Atlama[] = [];
  satirlar.forEach((l, i) => {
    if (!/ATLANDI —|ATLAMA KIRMIZI —/.test(l)) return;
    const alt = satirlar[i + 1] ?? "";
    const n = alt.match(/↳\s*(\d+)\s*kontrol/);
    sonuc.push({ metin: l.trim().replace(/^⏭️\s*/, ""), adet: n ? Number(n[1]) : alt.includes("bilinmeyen") ? "?" : 1 });
  });
  return sonuc;
}

function dosyaKos(dosya: string, ortam: NodeJS.ProcessEnv, logDizini: string): Promise<DosyaSonucu> {
  return new Promise((coz) => {
    const basla = Date.now();
    const log = createWriteStream(join(logDizini, dosya.replace(/\.ts$/, ".log")));
    const c = spawn(TSX, [join("scripts", dosya)], { cwd: TEKS, env: ortam, detached: true });
    let cikti = "";
    const isle = (parca: Buffer) => {
      const metin = parca.toString("utf8");
      cikti += metin;
      log.write(metin);
    };
    c.stdout.on("data", isle);
    c.stderr.on("data", isle);
    const zamanlayici = setTimeout(() => {
      try { process.kill(-c.pid!, "SIGKILL"); } catch { /* çıkmış */ }
    }, DOSYA_SURESI_MS);
    c.on("close", (kod) => {
      clearTimeout(zamanlayici);
      log.end();
      const satirlar = cikti.split("\n");
      const sonuc = [...satirlar].reverse().find((l) => /(?:Sonuç|SONUÇ):/.test(l))?.trim() ?? "(Sonuç satırı yok)";
      const atlanan = Number(sonuc.match(/,\s*(\d+)\s*atlandı/i)?.[1] ?? 0);
      coz({ dosya, cikis: kod, sonuc, atlanan, bilinmeyen: cikti.includes(BILINMEYEN_BEYAN), atlamalar: atlamalariAyikla(satirlar), ms: Date.now() - basla });
    });
  });
}

function beyanliMi(dosya: string, a: Atlama) {
  return BEYANLI_ATLAMALAR.find((b) => b.dosya === dosya && a.metin.includes(`ATLANDI — ${b.etiket}`));
}

/** Atlamaları beyanlı / genel diye ayırıp basar; genel (beyansız) atlanan kontrol sayısını döner. */
function atlamaRaporu(sonuclar: DosyaSonucu[]): number {
  let genel = 0;
  let beyanli = 0;
  const genelSatirlar: string[] = [];
  const beyanliSatirlar: string[] = [];
  for (const s of sonuclar) {
    let dosyaBeyanli = 0;
    for (const a of s.atlamalar) {
      const b = beyanliMi(s.dosya, a);
      if (b && a.adet !== "?") {
        dosyaBeyanli += a.adet;
        beyanliSatirlar.push(`    ${s.dosya} ${b.etiket} — ${b.neden} (${a.adet} kontrol)`);
      } else {
        genelSatirlar.push(`    ${s.dosya}: ${a.metin} [${a.adet === "?" ? "bilinmeyen sayıda" : `${a.adet} kontrol`}]`);
      }
    }
    beyanli += dosyaBeyanli;
    genel += Math.max(0, s.atlanan - dosyaBeyanli);
    if (s.bilinmeyen && !s.atlamalar.some((a) => a.adet === "?")) genelSatirlar.push(`    ${s.dosya}: ${BILINMEYEN_BEYAN}`);
    if (s.atlanan - dosyaBeyanli > 0 && s.atlamalar.length === 0) {
      genelSatirlar.push(`    ${s.dosya}: ${s.atlanan} atlandı — sebep satırı basılmadı (ortak atlama defterini kullanmıyor)`);
    }
  }
  const kosulanlar = new Set(sonuclar.map((s) => s.dosya));
  const gerceklesmeyen = BEYANLI_ATLAMALAR.filter(
    (b) => kosulanlar.has(b.dosya) && !sonuclar.some((s) => s.dosya === b.dosya && s.atlamalar.some((a) => beyanliMi(s.dosya, a) === b)),
  );

  console.log(`\nAtlanan kontrol: ${genel} genel · ${beyanli} beyanlı`);
  if (beyanliSatirlar.length) console.log(`  Beyanlı atlama (koşucu bilerek sağlamaz):\n${beyanliSatirlar.join("\n")}`);
  if (genelSatirlar.length) console.log(`  Genel atlama:\n${genelSatirlar.join("\n")}`);
  for (const b of gerceklesmeyen) console.log(`  ℹ️  beyanlı atlama gerçekleşmedi: ${b.dosya} ${b.etiket} (ön koşul bu DB'de sağlanmış olabilir)`);
  return genel;
}

function kirmiziOzeti(s: DosyaSonucu, logDizini: string): void {
  const yol = join(logDizini, s.dosya.replace(/\.ts$/, ".log"));
  console.log(`❌ ${s.dosya} (çıkış ${s.cikis}) — ${yol}`);
  for (const l of readFileSync(yol, "utf8").split("\n").filter((x) => /^\s*(❌|✗)\s/.test(x)).slice(0, 12)) console.log(`    ${l.trim()}`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const tam = argv.includes("--tam");
  const suzgecler = argv.filter((a) => !a.startsWith("--"));

  // Kaçış bir karardır ve bu koşucu onu kimseye devretmez: sunucu yalnız fixture DB'ye açılır.
  for (const anahtar of KACIS_ANAHTARLARI) {
    if (process.env[anahtar]) console.log(`ℹ️  ${anahtar} bu koşucuda GEÇERSİZ — yok sayıldı.`);
    delete process.env[anahtar];
  }
  if (!process.env.DATABASE_URL) ret("DATABASE_URL ortamda yok — .env okunmaz, hedefi komut satırında tam ver.");
  const dbAdi = hedefDbAdi();
  if (dbAdi.startsWith("tekserp_fabrika_")) ret(`'${dbAdi}' fabrika verisidir; bu koşucu ona sunucu açmaz.`);
  const adEngeli = fixtureHedefEngeli();
  if (adEngeli) ret(adEngeli);
  const hacim = await hacimHedefEngeli();
  if (hacim.engel) ret(hacim.engel);

  if (tam && suzgecler.length > 1) ret("--tam yalnız TEK süzgeç alır (run-all-tests.ts alt dize süzgeci).");
  const dosyalar = tam ? [] : httpBekcileri(suzgecler);
  if (!tam && dosyalar.length === 0) ret(`süzgeçle eşleşen HTTP bekçisi yok (${suzgecler.join(", ")}).`);

  const port = await bosPort();
  const base = `http://127.0.0.1:${port}`;
  const jwt = process.env.JWT_SECRET || randomBytes(48).toString("hex");
  const logDizini = mkdtempSync(join(tmpdir(), "tekserp-bekci-http-"));
  yedekDizini = mkdtempSync(join(tmpdir(), "tekserp-bekci-http-yedek-"));
  const logYolu = join(logDizini, "sunucu.log");

  console.log(`🎯 Hedef veritabanı: ${dbAdi} (top: ${hacim.topSayisi ?? "?"})`);
  console.log(`🖥️  Sunucu: ${base} · loglar: ${logDizini}`);

  const temizle = async (kod: number) => {
    await sunucuyuKapat(port);
    process.exit(kod);
  };
  process.once("SIGINT", () => void temizle(130));
  process.once("SIGTERM", () => void temizle(143));

  // Boş dize dotenv'in .env'den doldurmasını da keser: emekli tünel anahtarı, mDNS ilanı,
  // yedek zamanlayıcısı ve kurulum profili test sunucusunda KAPALI kalır.
  const sunucuOrtami: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: process.env.DATABASE_URL,
    JWT_SECRET: jwt,
    PORT: String(port),
    HOST: "127.0.0.1",
    REMOTE_PORT: "",
    DISCOVERY_MDNS_ENABLED: "false",
    BACKUP_SCHEDULE_ENABLED: "false",
    BACKUP_DIR: yedekDizini,
    BACKUP_OFFSITE_DIR: "",
    BACKUP_RCLONE_REMOTE: "",
    TEKSERP_PROFIL: "",
  };
  const logFd = openSync(logYolu, "w");
  sunucu = spawn(TSX, ["src/server.ts"], { cwd: TEKS, env: sunucuOrtami, detached: true, stdio: ["ignore", logFd, logFd] });
  closeSync(logFd);

  try {
    await saglikBekle(base, logYolu);
  } catch (e) {
    console.error(`❌ Sunucu açılamadı: ${(e as Error).message}`);
    await temizle(1);
  }
  console.log(`✅ Sunucu hazır (pid ${sunucu?.pid}).\n`);

  const testOrtami: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: process.env.DATABASE_URL, JWT_SECRET: jwt, TEST_API_URL: base };
  let kirmizi = false;

  if (tam) {
    let cikti = "";
    const kod = await new Promise<number | null>((coz) => {
      const c = spawn(TSX, [join("scripts", "run-all-tests.ts"), ...suzgecler], { cwd: TEKS, env: testOrtami, stdio: ["ignore", "pipe", "inherit"] });
      c.stdout.on("data", (p: Buffer) => { process.stdout.write(p); cikti += p.toString("utf8"); });
      c.on("close", coz);
    });
    kirmizi = kod !== 0;
    console.log(`\n=== bekci-http --tam: paket çıkış kodu ${kod} ===`);
    // Paket koşucusu atlama SEBEBİNİ basmaz; atlayan dosyalar sebepleri için tek tek yeniden koşulur.
    const atlayanlar = [...new Set([...cikti.matchAll(/^\s*⚠️\s+(test_\S+\.ts) — \d+ atlandı/gm)].map((m) => m[1]))];
    if (atlayanlar.length) {
      console.log(`\nSebep turu: ${atlayanlar.length} dosya yeniden koşuluyor…`);
      const sonuclar: DosyaSonucu[] = [];
      for (const dosya of atlayanlar) sonuclar.push(await dosyaKos(dosya, testOrtami, logDizini));
      atlamaRaporu(sonuclar);
    }
  } else {
    const sonuclar: DosyaSonucu[] = [];
    for (const dosya of dosyalar) {
      process.stdout.write(`▶ ${dosya.padEnd(34)} `);
      const s = await dosyaKos(dosya, testOrtami, logDizini);
      sonuclar.push(s);
      console.log(`${s.cikis === 0 ? "✅" : "❌"} ${s.sonuc} (${(s.ms / 1000).toFixed(1)}s)`);
    }
    const kirmizilar = sonuclar.filter((s) => s.cikis !== 0);
    // Sunucu verildiği hâlde "ayakta değil" diyen bekçi ya adresi okumuyor ya sunucu koşumda düştü.
    const sunucuyuGormeyen = sonuclar.filter((s) => s.atlamalar.some((a) => a.metin.includes("ayakta değil")));

    console.log(`\n=== bekci-http: ${sonuclar.length} dosya · ${sonuclar.length - kirmizilar.length} yeşil · ${kirmizilar.length} kırmızı ===`);
    for (const s of kirmizilar) kirmiziOzeti(s, logDizini);
    atlamaRaporu(sonuclar);
    if (sunucuyuGormeyen.length > 0) {
      console.log(`❌ Sunucu verildiği hâlde "ayakta değil" diyen bekçi: ${sunucuyuGormeyen.map((s) => s.dosya).join(", ")}`);
    }
    kirmizi = kirmizilar.length > 0 || sunucuyuGormeyen.length > 0;
  }

  if (!(await portAcikMi(port))) {
    console.log("❌ Sunucu koşum sırasında düştü; atlamalar bu yüzden olabilir. Log kuyruğu:");
    console.log(logKuyrugu(logYolu));
    kirmizi = true;
  }
  await temizle(kirmizi ? 1 : 0);
}

main().catch(async (e) => {
  console.error(`❌ bekci-http beklenmedik hata: ${(e as Error).stack ?? e}`);
  await sunucuyuKapat(null);
  process.exit(1);
});
