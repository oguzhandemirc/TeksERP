// =============================================================================
// SENARYO Y — yedek şifreleme uçtan uca (plan §8 "Senaryo Y", Faz 0 dilim 0.2)
// =============================================================================
// Koşum (Teks-Erp/ içinden; hedef YALNIZ `_test` DB — fabrika DB'lerine ASLA):
//   DATABASE_URL='postgresql://…/<ad>_test?schema=public' PG_BIN_DIR=<pg16 istemcisi> \
//     node ../scripts/agir-is.mjs -- npx tsx scripts/senaryo-yedek.ts
// Gerçek pg_dump/pg_restore (istemci sunucuyla AYNI ana sürüm), paketlenen araç
// (`dist/tools/yedek-sifrele.cjs`, önce `build-araclar.mjs` ile derlenir) ve süreç
// içi HTTP (bu sürecin kendi 127.0.0.1 dinleyicisi — ikinci Node süreci yok).
//
//   Y1 döküm → doğrula → şifrele → ÜÇ alıcının her biriyle ayrı çöz → pg_restore --list
//      birebir; offsite ve ikinci hedef (yedekle.ps1, pwsh varsa) klasöründe düz dosya yok
//   Y2 panel yolu: önizleme parolasız 403 · yanlış 403 · doğru 200 + tam doğrulama;
//      kopyaya geri yükleme parolayla çözer ve DOĞRULANMIŞ kopya kurar
//   Y3 sarılı yerel anahtar parolasız offsite dosyayı AÇAMAZ, müşteri anahtarı açar
//   Y4 yerel anahtarsız sunucuda şifreli dosyanın teşhisi "şifreli — çöz" (bozuk DEĞİL)
//   Y5 eski düz yedek önizlemede ok, kopyaya geri yüklenir
//   Y6 premigrate_ kur.ps1'in argv'siyle şifrelenir; -GeriAl'in çözme yolu (aynı araç,
//      `--anahtar-dizini`) döner. PowerShell TTY/Read-Host kısmı thinkpad-1 provasında.
// Çıkış: 0 hepsi yeşil · 1 kırmızı · 2 hedef reddi.
// =============================================================================

import "dotenv/config";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { fixtureHedefEngeli } from "./lib/hedef-db-kapisi";

const engel = fixtureHedefEngeli();
if (engel) {
  console.error(`⛔ ${engel}`);
  process.exit(2);
}

const TEKS = path.join(__dirname, "..");
const ARAC = path.join(TEKS, "dist", "tools", "yedek-sifrele.cjs");
const PAROLA = `yedek-${crypto.randomBytes(6).toString("hex")}`;
const kok = fs.mkdtempSync(path.join(os.tmpdir(), "tekserp-senaryo-y-"));
const D = {
  backups: path.join(kok, "backups"),
  offsite: path.join(kok, "offsite"),
  ikinci: path.join(kok, "E-ikinci"),
  anahtar: path.join(kok, "yedek-anahtar"),
  yerelsiz: path.join(kok, "yerelsiz-anahtar"),
  cikis: path.join(kok, "cikis"),
};
for (const d of Object.values(D)) fs.mkdirSync(d, { recursive: true });
process.env.BACKUP_DIR = D.backups;
process.env.BACKUP_OFFSITE_DIR = D.offsite;
process.env.BACKUP_KEY_DIR = D.anahtar;
// Docker'daki PG'nin veri dizini bu makinede yok; kopya disk kapısı geçici kökün birimini ölçsün.
process.env.PGDATA_DIR ??= kok;

let pass = 0;
let fail = 0;
function adim(label: string, ok: boolean, kanit = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${kanit ? `  ⟶ ${kanit}` : ""}`);
}

function arac(args: string[], stdin?: string): { kod: number; out: string; err: string } {
  const r = spawnSync(process.execPath, [ARAC, ...args], { input: stdin ?? "", encoding: "utf8", timeout: 120_000 });
  return { kod: r.status ?? -1, out: r.stdout ?? "", err: r.stderr ?? "" };
}

function pgBin(exe: string): string {
  return process.env.PG_BIN_DIR ? path.join(process.env.PG_BIN_DIR, exe) : exe;
}

/** `pg_restore --list` çıktısının TOC satırları (başlıktaki zaman/ad yorumları hariç). */
function toc(file: string): string[] | null {
  const r = spawnSync(pgBin("pg_restore"), ["--list", file], { encoding: "utf8" });
  if (r.status !== 0) return null;
  return r.stdout.split("\n").filter((l) => l && !l.startsWith(";"));
}

const sha = (f: string): string => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex").slice(0, 16);

async function hazirla(): Promise<void> {
  const b = spawnSync(process.execPath, [path.join(TEKS, "scripts", "build-araclar.mjs")], { encoding: "utf8" });
  if (b.status !== 0 || !fs.existsSync(ARAC)) throw new Error(`araç derlenemedi: ${b.stderr}`);
  const y = arac(["anahtar-uret", "--ad", "yerel", "--dizin", D.anahtar, "--parolali", "--parola-stdin"], `${PAROLA}\n`);
  const m = arac(["anahtar-uret", "--ad", "musteri", "--dizin", D.anahtar, "--ozel-cikti", path.join(kok, "musteri.tksec")]);
  const e = arac(["anahtar-uret", "--ad", "etkili", "--dizin", D.anahtar, "--ozel-cikti", path.join(kok, "etkili.tksec")]);
  if (y.kod || m.kod || e.kod) throw new Error(`anahtar üretilemedi: ${y.err} ${m.err} ${e.err}`);
  fs.copyFileSync(path.join(D.anahtar, "musteri.tkpub"), path.join(D.yerelsiz, "musteri.tkpub"));
}

async function main(): Promise<void> {
  let server: Server | null = null;
  const kopyalar: string[] = [];
  let base = "";
  let token = "";
  const http = async (method: string, p: string, headers: Record<string, string> = {}, body?: unknown) => {
    const r = await fetch(`${base}${p}`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const j = (await r.json().catch(() => ({}))) as {
      data?: Record<string, unknown>;
      details?: { code?: string };
      message?: string;
      copyName?: string;
    };
    return { status: r.status, body: j };
  };
  const kopyaBekle = async (ad: string): Promise<Record<string, unknown> | null> => {
    for (let i = 0; i < 240; i++) {
      const r = await http("GET", "/api/admin/db-copies");
      const d = r.body.data as { job: unknown; lastResult: { copyName: string } | null } | undefined;
      if (d && !d.job && d.lastResult?.copyName === ad) return d.lastResult as unknown as Record<string, unknown>;
      await new Promise((res) => setTimeout(res, 500));
    }
    return null;
  };

  try {
    await hazirla();
    const svc = await import("../src/services/backup.service");
    const { default: app } = await import("../src/app");
    const { ensureTestAdmin, kosumaOzguParola } = await import("./fixture-test-user");
    // Sunucu boot'unun ölçtüğü "sistem hesabı var mı" defteri — ölçülmemişse kopya uçları kilitli kalır.
    await (await import("../src/services/helpers/system-account.registry")).refreshSystemAccountRegistry();
    server = await new Promise<Server>((res) => {
      const s = app.listen(0, "127.0.0.1", () => res(s));
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const admin = await ensureTestAdmin({ password: kosumaOzguParola() });
    const login = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: admin.username, password: admin.password, clientType: "electron" }),
    });
    token = (((await login.json()) as { data?: { token?: string } }).data?.token ?? "") as string;
    if (!token) throw new Error("test yöneticisi giriş yapamadı");

    // ── Y1 ──────────────────────────────────────────────────────────────────
    console.log("\nY1 — döküm → doğrula → şifrele → üç alıcıyla ayrı ayrı çöz");
    const r = await svc.runBackupJob("manual");
    const enc = r.file ?? "";
    adim("Y1a yedek alındı, doğrulandı ve ŞİFRELİ yayınlandı", r.ok && enc.endsWith(".dump.tkenc"), `${path.basename(enc)} · ${r.message.slice(0, 80)}`);
    const cozulen: Record<string, string> = {};
    const coz = (ad: string, args: string[], stdin?: string) => {
      const hedef = path.join(D.cikis, `${ad}.dump`);
      const c = arac(["coz", "--girdi", enc, "--cikti", hedef, ...args], stdin);
      if (c.kod === 0) cozulen[ad] = hedef;
      return c;
    };
    const cy = coz("yerel", ["--anahtar-dizini", D.anahtar, "--parola-stdin"], `${PAROLA}\n`);
    const cm = coz("musteri", ["--anahtar", path.join(kok, "musteri.tksec")]);
    const ce = coz("etkili", ["--anahtar", path.join(kok, "etkili.tksec")]);
    adim("Y1b yerel (yedek parolasıyla) · müşteri · Etkili anahtarlarının HER BİRİ ayrı çözer",
      cy.kod === 0 && cm.kod === 0 && ce.kod === 0, `çıkış ${cy.kod}/${cm.kod}/${ce.kod}`);
    const izler = Object.values(cozulen).map(sha);
    const tocs = Object.values(cozulen).map((f) => toc(f));
    adim("Y1c üç çözüm bayt bayt aynı ve pg_restore --list birebir",
      izler.length === 3 && new Set(izler).size === 1 && tocs.every((t) => t && t.length > 50 && t.join("\n") === tocs[0]!.join("\n")),
      `sha ${izler.join("/")} · TOC ${tocs[0]?.length ?? 0} satır`);
    const off = fs.readdirSync(D.offsite);
    adim("Y1d offsite klasöründe yalnız şifreli dosya (düz yok)", off.length > 0 && off.every((f) => f.endsWith(".tkenc")), off.join(","));
    adim("Y1e yedek klasöründe düz döküm yok", !fs.readdirSync(D.backups).some((f) => f.endsWith(".dump")), fs.readdirSync(D.backups).join(","));
    yedekleps1();

    // ── Y2 ──────────────────────────────────────────────────────────────────
    console.log("\nY2 — panel yolu: yedek parolası");
    const ad = path.basename(enc);
    const imp = `/api/admin/backups/${encodeURIComponent(ad)}/restore-impact`;
    const p0 = await http("GET", imp);
    adim("Y2a parolasız önizleme → 403 BACKUP_PASSWORD_REQUIRED", p0.status === 403 && p0.body.details?.code === "BACKUP_PASSWORD_REQUIRED", `${p0.status} ${p0.body.details?.code}`);
    const p1 = await http("GET", imp, { "X-Backup-Password": `${PAROLA}-yanlis` });
    adim("Y2b yanlış parola → 403 BACKUP_PASSWORD_INVALID (açık hata)", p1.status === 403 && p1.body.details?.code === "BACKUP_PASSWORD_INVALID" && /hatalı/.test(p1.body.message ?? ""), `${p1.status} ${p1.body.message}`);
    const p2 = await http("GET", imp, { "X-Backup-Password": PAROLA });
    const d2 = p2.body.data as { verify?: string; canRestore?: boolean; encryption?: { unlocked?: boolean; decryptedPath?: string; keyDir?: string } } | undefined;
    adim("Y2c doğru parola → 200, içerik tam doğrulandı, geri yüklenebilir",
      p2.status === 200 && d2?.verify === "ok" && d2.canRestore === true && d2.encryption?.unlocked === true, `${p2.status} verify=${d2?.verify}`);
    // Panelin komut bloğundaki çözme satırı: aynı araç, aynı yollar (parola pencerede — burada stdin).
    const komutCoz = arac(["coz", "--girdi", path.join(D.backups, ad), "--cikti", d2?.encryption?.decryptedPath ?? "", "--anahtar-dizini", d2?.encryption?.keyDir ?? "", "--parola-stdin"], `${PAROLA}\n`);
    const komutToc = komutCoz.kod === 0 ? toc(d2!.encryption!.decryptedPath!) : null;
    adim("Y2d komut bloğunun çözme adımı (önizlemenin verdiği yollarla) pg_restore'un okuyacağı dökümü üretir",
      komutCoz.kod === 0 && !!komutToc && komutToc.join("\n") === tocs[0]?.join("\n"), komutCoz.err.trim() || komutCoz.out.trim());
    if (d2?.encryption?.decryptedPath) fs.rmSync(d2.encryption.decryptedPath, { force: true });
    const k0 = await http("POST", "/api/admin/db-copies", { "X-Backup-Password": `${PAROLA}-yanlis` }, { backupName: ad });
    adim("Y2e kopyaya geri yükleme: yanlış parola → 403 BACKUP_PASSWORD_INVALID", k0.status === 403 && k0.body.details?.code === "BACKUP_PASSWORD_INVALID", `${k0.status}`);
    const k1 = await http("POST", "/api/admin/db-copies", { "X-Backup-Password": PAROLA }, { backupName: ad });
    const kopya = k1.body.copyName ?? "";
    if (kopya) kopyalar.push(kopya);
    const son = kopya ? await kopyaBekle(kopya) : null;
    adim("Y2f kopyaya geri yükleme parolayla çözer, kopya DOĞRULANMIŞ hazır",
      k1.status === 202 && son?.phase === "ready", `${k1.status} ${kopya} · ${String(son?.message ?? k1.body.message).slice(0, 100)}`);
    // İş "hazır"ı `withDecryptedCopy`nin finally'sindeki silmeden ÖNCE yayımlar: geçici dosya birkaç ms
    // daha durabilir. Ölçülen "kalmadı"dır, "hazır anında yoktu" değil — sınırlı bekleme.
    let cozKaldi = true;
    for (let i = 0; i < 20 && cozKaldi; i++) {
      cozKaldi = fs.readdirSync(D.backups).some((f) => f.includes(".coz-"));
      if (cozKaldi) await new Promise((res) => setTimeout(res, 100));
    }
    adim("Y2g geçici çözülmüş kopya klasörde KALMADI", !cozKaldi);

    // ── Y3 ──────────────────────────────────────────────────────────────────
    console.log("\nY3 — offsite dosyası: sarılı yerel anahtar parolasız açamaz, müşteri anahtarı açar");
    const offDosya = path.join(D.offsite, off[0] ?? "");
    const y3a = arac(["coz", "--girdi", offDosya, "--cikti", path.join(D.cikis, "y3a.dump"), "--anahtar", path.join(D.anahtar, "yerel.tkkey")]);
    const y3b = arac(["coz", "--girdi", offDosya, "--cikti", path.join(D.cikis, "y3b.dump"), "--anahtar", path.join(D.anahtar, "yerel.tkkey"), "--parola-stdin"], "tahmin-parola-123\n");
    const y3c = arac(["coz", "--girdi", offDosya, "--cikti", path.join(D.cikis, "y3c.dump"), "--anahtar", path.join(kok, "musteri.tksec")]);
    adim("Y3a yerel.tkkey parolasız AÇAMAZ (parola ister, dosya üretilmez)", y3a.kod !== 0 && !fs.existsSync(path.join(D.cikis, "y3a.dump")), y3a.err.trim());
    adim("Y3b yerel.tkkey yanlış parolayla AÇAMAZ (çıkış 2)", y3b.kod === 2 && !fs.existsSync(path.join(D.cikis, "y3b.dump")), y3b.err.trim());
    adim("Y3c müşteri anahtarı açar (sunucudan bağımsız)", y3c.kod === 0 && sha(path.join(D.cikis, "y3c.dump")) === izler[0], y3c.out.trim());

    // ── Y4 ──────────────────────────────────────────────────────────────────
    console.log("\nY4 — yerel anahtarsız sunucuda teşhis");
    process.env.BACKUP_KEY_DIR = D.yerelsiz;
    const v4 = await svc.verifyBackupFile(enc);
    const p4 = await http("GET", imp);
    const d4 = p4.body.data as { verify?: string; canRestore?: boolean; blockReasons?: string[] } | undefined;
    adim("Y4a pg_restore --list okuyamaz ama teşhis 'encrypted' (bozuk DEĞİL)", v4 === "encrypted" && toc(enc) === null, `verify=${v4}`);
    adim("Y4b önizleme 'şifreli — çöz' der ve geri yüklemeyi engeller (sebep: yerel anahtar yok)",
      p4.status === 200 && d4?.verify === "encrypted" && d4.canRestore === false && (d4.blockReasons ?? []).some((b) => /ŞİFRELİ/.test(b) && /çözüp/.test(b)),
      (d4?.blockReasons ?? []).join(" | ").slice(0, 140));
    process.env.BACKUP_KEY_DIR = D.anahtar;

    // ── Y5 ──────────────────────────────────────────────────────────────────
    console.log("\nY5 — eski düz yedek");
    const duzAd = "tekserp_20260101_030001.dump";
    fs.copyFileSync(cozulen.musteri!, path.join(D.backups, duzAd));
    const p5 = await http("GET", `/api/admin/backups/${duzAd}/restore-impact`);
    const d5 = p5.body.data as { verify?: string; canRestore?: boolean } | undefined;
    adim("Y5a düz yedek parolasız önizlenir: verify ok, geri yüklenebilir", p5.status === 200 && d5?.verify === "ok" && d5.canRestore === true, `${p5.status} ${d5?.verify}`);
    await new Promise((res) => setTimeout(res, 1100));
    const k5 = await http("POST", "/api/admin/db-copies", {}, { backupName: duzAd });
    const kopya5 = k5.body.copyName ?? "";
    if (kopya5) kopyalar.push(kopya5);
    const son5 = kopya5 ? await kopyaBekle(kopya5) : null;
    adim("Y5b düz yedek kopyaya geri yüklenir (parolasız, bugünkü yol)", k5.status === 202 && son5?.phase === "ready", `${k5.status} ${String(son5?.message ?? k5.body.message).slice(0, 100)}`);

    // ── Y6 ──────────────────────────────────────────────────────────────────
    console.log("\nY6 — premigrate_ (kur.ps1 [3/9] ve -GeriAl çözme yolu)");
    const pre = path.join(D.backups, "premigrate_20260929_020000.dump");
    fs.copyFileSync(cozulen.musteri!, pre);
    const s6 = arac(["sifrele", "--girdi", pre, "--anahtar-dizini", D.anahtar, "--duzu-sil"]);
    adim("Y6a premigrate kur.ps1'in argv'siyle şifrelendi, düzü silindi", s6.kod === 0 && fs.existsSync(`${pre}.tkenc`) && !fs.existsSync(pre), s6.out.trim());
    const geri = pre + ".coz-geri.part";
    const c6 = arac(["coz", "--girdi", `${pre}.tkenc`, "--cikti", geri, "--anahtar-dizini", D.anahtar, "--parola-stdin"], `${PAROLA}\n`);
    adim("Y6b -GeriAl'in çözme çağrısı (aynı argv, parola stdin'den) pg_restore'a hazır döküm verir",
      c6.kod === 0 && toc(geri)?.join("\n") === tocs[0]?.join("\n"), c6.out.trim());
    const c6y = arac(["coz", "--girdi", `${pre}.tkenc`, "--cikti", geri + "2", "--anahtar-dizini", D.anahtar, "--parola-stdin"], "yanlis-parola-00\n");
    adim("Y6c yanlış yedek parolası → çıkış 2, düz kopya yok", c6y.kod === 2 && !fs.existsSync(geri + "2"), c6y.err.trim());
    console.log("⏭️  Y6d kur.ps1 -GeriAl'in PowerShell kısmı (Read-Host + TTY'de gizli parola) — thinkpad-1 provasına BORÇ");
  } catch (e) {
    fail++;
    console.log(`❌ senaryo kesildi: ${e instanceof Error ? e.stack : String(e)}`);
  } finally {
    for (const k of kopyalar) {
      const d = await http("DELETE", `/api/admin/db-copies/${encodeURIComponent(k)}?force=1`).catch(() => null);
      console.log(`   temizlik: kopya ${k} silindi → ${d?.status}`);
    }
    await new Promise<void>((res) => (server ? server.close(() => res()) : res()));
    fs.rmSync(kok, { recursive: true, force: true });
    const { default: prisma } = await import("../src/lib/prisma");
    await prisma.$disconnect().catch(() => {});
  }
  console.log(`\n=== Senaryo Y: ${pass} geçti, ${fail} başarısız, 1 atlandı (Y6d thinkpad-1) ===`);
  process.exit(fail > 0 ? 1 : 0);
}

/** Y1f — gece görevi betiği (pwsh varsa, Mac'te): ikinci hedefe (E:) giden kopya şifreli. */
function yedekleps1(): void {
  const pwsh = spawnSync("pwsh", ["-v"], { encoding: "utf8" });
  if (pwsh.status !== 0 || !process.env.PG_BIN_DIR) {
    console.log("⏭️  Y1f yedekle.ps1 (pwsh ya da PG_BIN_DIR yok) — thinkpad-1 provasına BORÇ");
    return;
  }
  const url = new URL(process.env.DATABASE_URL!);
  const psKok = path.join(kok, "ps-kok");
  const bin = path.join(psKok, "pgsql", "bin");
  const araclar = path.join(psKok, "app", "dist", "tools");
  const nodeDir = path.join(kok, "node-bin");
  for (const d of [bin, araclar, path.join(psKok, "pg-setup"), nodeDir]) fs.mkdirSync(d, { recursive: true });
  for (const f of fs.readdirSync(process.env.PG_BIN_DIR)) {
    const hedef = path.join(bin, f === "pg_dump" || f === "pg_restore" ? `${f}.exe` : f);
    fs.copyFileSync(path.join(process.env.PG_BIN_DIR, f), hedef);
    fs.chmodSync(hedef, 0o755);
  }
  fs.copyFileSync(ARAC, path.join(araclar, "yedek-sifrele.cjs"));
  fs.symlinkSync(process.execPath, path.join(nodeDir, "node.exe"));
  fs.writeFileSync(path.join(psKok, "pg-setup", "db-credentials.json"),
    JSON.stringify({ db: url.pathname.slice(1), port: Number(url.port), user: decodeURIComponent(url.username), pass: decodeURIComponent(url.password) }));
  const betik = path.join(TEKS, "..", "deploy", "yedekle.ps1");
  const r = spawnSync("pwsh", ["-NoProfile", "-File", betik, "-Kok", psKok, "-IkinciHedef", D.ikinci, "-AnahtarDizini", D.anahtar], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${nodeDir}${path.delimiter}${process.env.PATH}` },
    timeout: 300_000,
  });
  const yed = fs.existsSync(path.join(psKok, "backups")) ? fs.readdirSync(path.join(psKok, "backups")) : [];
  const ikinci = fs.readdirSync(D.ikinci);
  adim("Y1f yedekle.ps1 (pwsh/Mac): çıkış 0, yedek şifreli, ikinci hedefte (E:) yalnız şifreli dosya",
    r.status === 0 && yed.some((f) => f.endsWith(".dump.tkenc")) && !yed.some((f) => f.endsWith(".dump") || f.endsWith(".part")) &&
      ikinci.length === 1 && ikinci[0]!.endsWith(".tkenc"),
    `çıkış ${r.status} · yedek: ${yed.filter((f) => f !== "backup.log").join(",")} · E: ${ikinci.join(",")}${r.status ? ` · ${r.stdout.slice(-300)}` : ""}`);
}

void main();
