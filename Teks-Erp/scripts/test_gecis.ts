// =============================================================================
// BEKÇİ — pm2 → WINDOWS HİZMETİ GEÇİŞİ (Dağıtım v2 D6, DB'siz)
// Çalıştır: npx tsx scripts/run-all-tests.ts test_gecis
// =============================================================================
// `deploy/gecis/gecis.ps1` mevcut kurulumu (pm2 + harici PostgreSQL) güncelleyici + Windows hizmeti
// düzenine BİR KEZ taşır; `deploy/gecis/gecis-yardimci.cjs` saf hesapları yapar. Ölçülen sözleşmeler:
//   §1 yardımcı: ikiz kaynaklar (hizmet varsayılanları/yol ayarları = hizmet-duzeni.ts · dotenv okuyucusu =
//      gerçek dotenv · TEK okuyucu = ortak .env vektörleri native/test-vektorleri/env-dosyasi.json — D2b'den
//      beri güncelleyici = backend) · yapilandirma\.env birleştirmesi (pm2 ecosystem env'i .env'i EZER → yeni
//      dosyada etkin; değişmeyen satır bayt bayt korunur; yazılan değer okuyucuda aynen; etkin ayar değişmez;
//      sır çıktıya girmez; BOM/CRLF korunur) · pm2 sınıflaması (yalnız bu kökün backend'i) · kira gösterimi
//   §2 gecis.ps1 statik: yalnız TeksERP-Backend-Boot görevi ve bu kökün pm2 uygulaması değişir · PostgreSQL
//      hizmetine dokunulmaz · silme yalnız izinli biçimlerde (kök dışı silme yok) · veritabanı salt OKUNUR ·
//      onay ilk değişiklikten ÖNCE · plan sırası (iskelet → hizmet kaydı/ACL) · kritik kalemler = backend
//      sağlıklı olana dek · her kalemin telafisi var · sır çıktıya girmez · paket = app\ derlemesi
//   §3 sahte-Windows harness (pwsh varsa): kuru → yanlış onay → uygula → durum → geri al · doğrulama/başlatma
//      hatasında OTOMATİK geri alma · engeller (göç · derleme · yabancı pm2 · yabancı görev) · güvenlik
//      duvarı kuralı ekle/geri al · tamamla (pm2 kalıntıları arşive, sonra geri alma reddi) · sır taraması
// NEGATİF SONDA: §1/§2 yüklemleri dosya içinde bozulmuş kopyalara her koşumda koşar ("sonda:" satırları).
// ÖLÇÜLMEYEN (Windows'ta W3/D8): gerçek SCM, icacls/ACL, junction, pm2, PostgreSQL, güvenlik duvarı.
// =============================================================================
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import path, { join } from "node:path";
import Module, { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { PATH_SETTINGS, serviceDefaults } from "../src/lib/hizmet-duzeni";
import { psTara } from "./lib/ps-tarama";
import { atlamaDefteri } from "./lib/atlama";

const TEKS = join(__dirname, "..");
const KOK = join(TEKS, "..");
const YARDIMCI = join(KOK, "deploy", "gecis", "gecis-yardimci.cjs");
const GECIS = join(KOK, "deploy", "gecis", "gecis.ps1");
const HARNESS = join(KOK, "deploy", "test", "gecis.harness.ps1");
const req = createRequire(__filename);
let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detay ? ` — ${detay}` : ""}`);
}
const defter = atlamaDefteri(() => fail++);

type Esleme = Record<string, string>;
interface Yardimci {
  dotenvCozumle(s: string): Esleme;
  hizmetVarsayilanlari(kok: string): Esleme;
  YOL_AYARLARI: readonly string[];
  ortam(g: Record<string, unknown>): OrtamSonuc;
  pm2(g: Record<string, unknown>): { karar: string; neden?: string | null; bizim?: { ad: string } | null; pm2Anahtarlar?: string[] };
  kira(g: Record<string, unknown>): Record<string, unknown>;
}
interface OrtamSonuc {
  karar: string;
  anahtarlar: Array<{ ad: string; islem: string }>;
  engeller: string[];
  uyarilar: string[];
  yazildi: boolean;
  port: number | null;
  rclone: { eskiYol: string; yeniYol: string } | null;
}
/** Yardımcıyı METİNDEN yükler: sondalar bozulmuş kopyayı aynı yolla ölçer. */
function yukle(kaynak: string): Yardimci {
  const m = new Module(YARDIMCI, undefined);
  m.filename = YARDIMCI;
  (m as unknown as { paths: string[] }).paths = [];
  (m as unknown as { _compile(k: string, f: string): void })._compile(kaynak, YARDIMCI);
  return m.exports as Yardimci;
}
const KAYNAK = readFileSync(YARDIMCI, "utf8");
const Y = yukle(KAYNAK);
const dotenv = req("dotenv") as { parse(s: string): Esleme };

// --- §1a ikiz: hizmet varsayılanları + yol ayarları -----------------------------------------
function ikizIhlalleri(y: Yardimci): string[] {
  const ih: string[] = [];
  for (const kok of ["C:/TeksERP", "D:/Kurulum/TeksERP", "/k"]) {
    const a = JSON.stringify(Object.entries(y.hizmetVarsayilanlari(kok)).sort());
    const b = JSON.stringify(Object.entries(serviceDefaults(kok)).sort());
    if (a !== b) ih.push(`hizmet varsayılanları ayrıştı (${kok})`);
  }
  if (JSON.stringify([...y.YOL_AYARLARI].sort()) !== JSON.stringify([...PATH_SETTINGS].sort())) ih.push("yol ayarları ayrıştı");
  return ih;
}

// --- §1b ikiz: dotenv okuyucusu ------------------------------------------------------------------
const DOTENV_VEKTORLERI = [
  "A=1\nB=iki kelime\nC='tek tirnak # yorum degil'\nD=\"cift \\n satir\"\nE=`ters`\n",
  "\uFEFFDATABASE_URL=\"postgresql://u:p%40@h:5432/db?schema=public\"\r\nJWT_SECRET=x\r\n",
  "export X = 5 \n# yorum\nY=deger # satir sonu yorumu\nZ=abc#123\n",
  "K: iki nokta\nL.M=noktali\nN-O=tireli\nBOS=\nTEKRAR=1\nTEKRAR=2\n",
  'COK="satir1\nsatir2"\nSON=1\n',
  "Q=\"C:\\TeksERP\\pgsql\\bin\"\nR='C:\\x\\y'\nS=\"a\\\\b\"\nT=\"tirnak\\\"ic\"\n",
  "U= bosluklu  \nV=\"  ic bosluk  \"\nW=a=b=c\nX=üğiş\n",
  "CR=\"a\\rb\"\nLF=\"a\\nb\"\nTEK='a\\rb'\n",
];
function dotenvIhlalleri(y: Yardimci): string[] {
  const ih: string[] = [];
  DOTENV_VEKTORLERI.forEach((v, i) => {
    const a = JSON.stringify(y.dotenvCozumle(v));
    const b = JSON.stringify(dotenv.parse(v));
    if (a !== b) ih.push(`vektör ${i}: yardımcı ${a} ≠ dotenv ${b}`);
  });
  return ih;
}

// --- §1c ortak .env vektörleri (D2b): backend (dotenv) ve güncelleyici (envfile.rs) AYNI okuyucu ------
// Yardımcının tek okuyucusu bu vektörlerin beklenenini vermeli; eski KATI Rust ikizi geri konursa kırmızı.
interface EnvVektor { vektor: { ad: string; metin?: string; baytHex?: string }; beklenen: Esleme }
const ENV_VEKTOR = JSON.parse(readFileSync(join(TEKS, "native", "test-vektorleri", "env-dosyasi.json"), "utf8")) as { okuyucu: string; kayitlar: EnvVektor[] };
function ortakVektorIhlalleri(y: Yardimci): string[] {
  const ih: string[] = [];
  const kurulu = `dotenv@${(req("dotenv/package.json") as { version: string }).version}`;
  if (ENV_VEKTOR.okuyucu !== kurulu) ih.push(`vektör okuyucusu ${ENV_VEKTOR.okuyucu} ≠ kurulu ${kurulu}`);
  if (ENV_VEKTOR.kayitlar.length < 60) ih.push(`körlük: ${ENV_VEKTOR.kayitlar.length} vektör`);
  const sirali = (o: Esleme): string => JSON.stringify(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  for (const k of ENV_VEKTOR.kayitlar) {
    const metin = k.vektor.metin ?? Buffer.from(k.vektor.baytHex ?? "", "hex").toString("utf8");
    let gorulen: Esleme;
    try { gorulen = y.dotenvCozumle(metin); } catch { ih.push(`${k.vektor.ad}: okuyucu hata attı (gerçek okuyucu atmaz)`); continue; }
    if (sirali(gorulen) !== sirali(k.beklenen)) ih.push(k.vektor.ad);
  }
  return ih;
}
/** "Eski ikiz geri kondu" sondası: D2b öncesi KATI envfile.rs ikizi — yardımcının D6 sürümünde taşıdığı kod AYNEN. */
const ESKI_KATI_IKIZ = String.raw`
function rustAnahtarMi(k) {
  return /^[_A-Za-z][_A-Za-z0-9]*$/.test(k);
}
function rustCiftTirnak(ic, no) {
  let out = "";
  for (let i = 0; i < ic.length; i++) {
    const c = ic[i];
    if (c !== "\\") { out += c; continue; }
    const s = ic[++i];
    if (s === "n") out += "\n";
    else if (s === "r") out += "\r";
    else if (s === "t") out += "\t";
    else if (s === '"') out += '"';
    else if (s === "\\") out += "\\";
    else throw new Error("satir " + no + ": taninmayan kacis dizisi");
  }
  return out;
}
// Rust str::trim Unicode White_Space'i atar; JS trim BOM'u da atar - BOM satir basinda zaten soyuldu.
function rustTrim(s) { return s.replace(/^[\s]+|[\s]+$/g, ""); }
function rustDeger(ham, no) {
  const d = rustTrim(ham);
  for (const q of ['"', "'"]) {
    if (d.startsWith(q)) {
      const ic = d.slice(1);
      if (!ic.endsWith(q) || ic.length === 0) throw new Error("satir " + no + ": kapanmayan tirnak");
      const govde = ic.slice(0, -1);
      return q === '"' ? rustCiftTirnak(govde, no) : govde;
    }
  }
  const i = d.indexOf(" #");
  const v = i >= 0 ? d.slice(0, i) : d;
  return v.replace(/[\s]+$/, "");
}
function rustEnvCozumle(metin) {
  let t = String(metin);
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
  const ciftler = [];
  const tekrar = [];
  t.split("\n").forEach((ham, i) => {
    const no = i + 1;
    let s = rustTrim(ham.endsWith("\r") ? ham.slice(0, -1) : ham);
    if (s === "" || s.startsWith("#")) return;
    if (s.startsWith("export ")) s = s.slice(7).replace(/^[\s]+/, "");
    const e = s.indexOf("=");
    if (e < 0) throw new Error("satir " + no + ": ANAHTAR=DEGER biciminde degil");
    const k = rustTrim(s.slice(0, e));
    if (!rustAnahtarMi(k)) throw new Error("satir " + no + ": gecersiz anahtar adi");
    const v = rustDeger(s.slice(e + 1), no);
    const j = ciftler.findIndex((p) => p[0] === k);
    if (j >= 0) { ciftler.splice(j, 1); if (!tekrar.includes(k)) tekrar.push(k); }
    ciftler.push([k, v]);
  });
  return { ciftler, tekrar };
}
dotenvCozumle = (m) => Object.fromEntries(rustEnvCozumle(m).ciftler);
`;

// --- §1d yapilandirma birleştirmesi ----------------------------------------------------------------
const SIRLAR = ["gizli-parola", "jwt-gizli", "gizli-belirtec"];
interface OrtamKosum { sonuc: OrtamSonuc; cikti: string | null; dizin: string; kok: string }
function ortamKos(y: Yardimci, env: string | ((kok: string) => string), ek: Record<string, unknown> = {}, eko: string | null = readFileSync(join(TEKS, "ecosystem.config.js"), "utf8")): OrtamKosum {
  const dizin = mkdtempSync(join(tmpdir(), "gecis-ortam-"));
  const kok = join(dizin, "kok");
  const app = join(kok, "app");
  mkdirSync(app, { recursive: true });
  writeFileSync(join(app, ".env"), typeof env === "function" ? env(kok) : env);
  if (eko !== null) writeFileSync(join(app, "ecosystem.config.js"), eko);
  const cikti = join(dizin, "yeni.env");
  const sonuc = y.ortam({ kok, eskiApp: app, eskiEnv: join(app, ".env"), eko: eko !== null ? join(app, "ecosystem.config.js") : null, cikti, damga: "20261001_030000", makineAnahtarlari: ["PATH"], ...ek });
  return { sonuc, cikti: existsSync(cikti) ? readFileSync(cikti, "utf8") : null, dizin, kok };
}
function karar(s: OrtamSonuc, ad: string): string | undefined { return s.anahtarlar.find((a) => a.ad === ad)?.islem; }
const GERCEKCI = 'DATABASE_URL="postgresql://tekserp:gizli-parola@localhost:5432/tekserp_yeni?schema=public"\r\nJWT_SECRET="jwt-gizli"\r\nPORT=4000\r\n';
function ortamIhlalleri(y: Yardimci): string[] {
  const ih: string[] = [];
  const temizle: string[] = [];
  try {
    // (1) gerçekçi: repo ecosystem'i + üç satırlık .env
    const g = ortamKos(y, GERCEKCI);
    temizle.push(g.dizin);
    if (g.sonuc.karar !== "TAMAM" || !g.sonuc.yazildi || !g.cikti) ih.push(`gerçekçi: ${g.sonuc.karar} ${g.sonuc.engeller.join("; ")}`);
    else {
      const d = y.dotenvCozumle(g.cikti);
      if (!g.cikti.startsWith(GERCEKCI)) ih.push("gerçekçi: değişmeyen .env satırları bayt bayt korunmadı");
      for (const [k, v] of Object.entries({ HOST: "0.0.0.0", BACKUP_RETENTION_DAYS: "30", BACKUP_HOUR: "3", BACKUP_OFFSITE_DIR: "", BACKUP_RCLONE_REMOTE: "", PORT: "4000" })) if (d[k] !== v) ih.push(`gerçekçi: ${k} yeni dosyada etkin değil`);
      for (const k of ["NODE_ENV", "NODE_USE_SYSTEM_CA", "LICENSE_DIR", "PG_BIN_DIR", "BACKUP_DIR", "BACKUP_SCHEDULE_ENABLED"]) if (k in d) ih.push(`gerçekçi: ${k} yazıldı (konak/varsayılan sağlar)`);
      if (karar(g.sonuc, "BACKUP_RCLONE_CONFIG") !== "VARSAYILAN_VERI" || !g.sonuc.rclone || !/\/rclone\.conf$/.test(g.sonuc.rclone.eskiYol) || !/\/veri\/rclone\.conf$/.test(g.sonuc.rclone.yeniYol)) ih.push("gerçekçi: rclone.conf veri\\'ye taşınmıyor");
      if (!/\r\n/.test(g.cikti) || /[^\r]\n/.test(g.cikti)) ih.push("gerçekçi: CRLF korunmadı");
      if (g.sonuc.port !== 4000) ih.push("gerçekçi: port");
    }
    const json = JSON.stringify(g.sonuc);
    for (const s of SIRLAR) if (json.includes(s)) ih.push(`gerçekçi: çıktı sır taşıyor (${s})`);
    // (2) ecosystem .env'i EZER (pm2 env'i dotenv'den önce) → yeni dosyada ecosystem'in değeri
    const e = ortamKos(y, 'PG_BIN_DIR="C:\\TeksERP\\pgsql\\bin"\nHOST=127.0.0.1\nBACKUP_KEY_DIR=../yedek-anahtar\n');
    temizle.push(e.dizin);
    const ed = e.cikti ? y.dotenvCozumle(e.cikti) : {};
    if (karar(e.sonuc, "HOST") !== "ECO_DEGER" || ed.HOST !== "0.0.0.0") ih.push(`ecosystem'in ezdiği HOST yeni dosyada etkin değil (${karar(e.sonuc, "HOST")})`);
    if (karar(e.sonuc, "PG_BIN_DIR") !== "ECO_DEGER" || !/\/pgsql\/bin$/.test(ed.PG_BIN_DIR ?? "")) ih.push("ecosystem'in ezdiği PG_BIN_DIR yeni dosyada etkin değil");
    if (karar(e.sonuc, "BACKUP_KEY_DIR") !== "MUTLAK" || ed.BACKUP_KEY_DIR !== `${e.kok}/yedek-anahtar`) ih.push(`göreli BACKUP_KEY_DIR mutlaklaşmadı (${ed.BACKUP_KEY_DIR})`);
    // (3) ecosystem'siz: tek okuyucu (D2b) ⇒ ters bölü çift tırnak · '#' · `K: v` · bozuk satır · BOM DOKUNULMADAN kalır
    const ham3 = '\uFEFFQ="C:\\x\\y"\nZ=abc#123\nK: iki nokta\nbozuk satir\n1ABC=3\n';
    const b = ortamKos(y, ham3, {}, null);
    temizle.push(b.dizin);
    if (b.sonuc.karar !== "TAMAM" || b.cikti !== ham3) ih.push(`değişmeyen satırlar bayt bayt korunmadı (${b.sonuc.karar})`);
    // (6) ecosystem'den YAZILAN değer okuyucuda aynen: ters bölü + `\n` dizisi + '#' + boşluk
    const w = ortamKos(y, "X=1\n", {}, 'module.exports = { apps: [{ name: "x", env: { WIN_YOL: "C:\\\\veri\\\\nobet", KARE: "abc#1", BOSLUK: "a b" } }] };');
    temizle.push(w.dizin);
    const wd = w.cikti ? y.dotenvCozumle(w.cikti) : {};
    if (w.sonuc.karar !== "TAMAM" || wd.WIN_YOL !== "C:\\veri\\nobet" || wd.KARE !== "abc#1" || wd.BOSLUK !== "a b") ih.push(`yazılan değer okuyucuda farklı (${JSON.stringify(wd)})`);
    // (4) engeller: çok satırlı değer · app\ içini gösteren yol · nesne değerli ecosystem anahtarı
    const c = ortamKos(y, 'COK="a\nb"\n', {}, null);
    temizle.push(c.dizin);
    if (c.sonuc.karar !== "ENGEL" || c.cikti !== null) ih.push("çok satırlı değer engellenmedi ya da dosya yazıldı");
    const a2 = ortamKos(y, (kok) => `BACKUP_KEY_DIR=${kok}/app/anahtar\n`, {}, null);
    temizle.push(a2.dizin);
    if (a2.sonuc.karar !== "ENGEL" || !a2.sonuc.engeller.some((x) => /app\\/.test(x))) ih.push("app\\ içini gösteren yol engellenmedi");
    const n = ortamKos(y, "X=1\n", {}, 'module.exports = { apps: [{ name: "x", env: { NESNE: { a: 1 }, NODE_OPTIONS: "--max-old-space-size=2048" } }] };');
    temizle.push(n.dizin);
    if (n.sonuc.karar !== "ENGEL" || !n.sonuc.engeller.some((x) => /NESNE/.test(x))) ih.push("nesne değerli ecosystem anahtarı engellenmedi");
    if (!n.sonuc.uyarilar.some((x) => /NODE_OPTIONS/.test(x))) ih.push("NODE_OPTIONS (konak siler) söylenmedi");
    // (5) pm2 başlatma ortamından gelen ilgili anahtar söylenir (değer yok)
    const p = ortamKos(y, GERCEKCI, { pm2Anahtarlar: ["HTTPS_PROXY", "PATH", "PORT", "USERNAME"] });
    temizle.push(p.dizin);
    if (!p.sonuc.uyarilar.some((x) => /HTTPS_PROXY/.test(x)) || p.sonuc.uyarilar.some((x) => /USERNAME|PATH,/.test(x))) ih.push("pm2 başlatma ortamı farkı yanlış ölçüldü");
  } catch (err) {
    ih.push(`yardımcı patladı: ${String((err as Error).message).slice(0, 200)}`);
  } finally {
    for (const d of temizle) rmSync(d, { recursive: true, force: true });
  }
  return ih;
}

// --- §1e pm2 sınıflaması · §1f kira -----------------------------------------------------------------
function jlist(uyg: Array<Record<string, unknown>>): string {
  return `[PM2] log\n${JSON.stringify(uyg.map((u) => ({ name: u.ad, pid: 1, pm2_env: { status: "online", pm_cwd: u.cwd, pm_exec_path: u.betik, pmx_module: u.modul === true, env: { PORT: "4000", GIZLI: "gizli-parola" } } })))}`;
}
function pm2Ihlalleri(y: Yardimci): string[] {
  const ih: string[] = [];
  const app = "C:\\TeksERP\\app";
  const biz = { ad: "tekserp-backend-yeni", cwd: app, betik: `${app}\\dist\\server.js` };
  const mod = { ad: "pm2-logrotate", cwd: "C:\\x", betik: "C:\\x\\app.js", modul: true };
  const k = (u: Array<Record<string, unknown>>) => y.pm2({ jlist: jlist(u), app, ad: "tekserp-backend-yeni" });
  const u1 = k([biz, mod]);
  if (u1.karar !== "UYUMLU" || u1.bizim?.ad !== "tekserp-backend-yeni") ih.push(`yalnız bizim + modül UYUMLU değil (${u1.karar})`);
  if (JSON.stringify(u1).includes("gizli-parola")) ih.push("pm2 sınıflaması ortam DEĞERİ taşıyor");
  const baska = { ad: "tekserp-backend", cwd: "D:\\Baska\\app", betik: "D:\\Baska\\app\\dist\\server.js" };
  if (k([biz, baska]).karar !== "ENGEL") ih.push("başka kökün TeksERP backend'i engellenmedi");
  if (k([baska]).karar !== "ENGEL") ih.push("yalnız başka kökün backend'i varken 'bizim' sayıldı ya da geçti");
  if (k([biz, { ad: "baska", cwd: "C:\\y", betik: "C:\\y\\index.js" }]).karar !== "ENGEL") ih.push("TeksERP dışı pm2 uygulaması engellenmedi");
  if (k([biz, { ...biz, ad: "tekserp-backend-2" }]).karar !== "ENGEL") ih.push("aynı kökte iki kayıt engellenmedi");
  if (k([mod]).karar !== "YOK") ih.push("backend'siz liste YOK değil");
  if (y.pm2({ jlist: "bozuk", app }).karar !== "OLCULEMEDI") ih.push("bozuk liste OLCULEMEDI değil");
  return ih;
}
function kiraIhlalleri(y: Yardimci): string[] {
  const ih: string[] = [];
  const dizin = mkdtempSync(join(tmpdir(), "gecis-kira-"));
  try {
    const yuk = Buffer.from(JSON.stringify({ kanal: { kod: "adnansahin", guncelSurumler: { backend: "2.14.0" } }, bitis: "2026-12-01T00:00:00Z", guncelleme: { kip: "OTOMATIK", hedefSurum: null }, parmakIzi: "gizli-parola", yaptirim: { guncellemeDonuk: true } })).toString("base64url");
    writeFileSync(join(dizin, "kira.jws"), `e30.${yuk}.imza`);
    const r = y.kira({ yol: join(dizin, "kira.jws") });
    if (r.kanal !== "adnansahin" || r.politika !== "OTOMATIK" || r.guncellemeDonuk !== true || r.kanalBackend !== "2.14.0") ih.push(`kira alanları (${JSON.stringify(r)})`);
    if (JSON.stringify(r).includes("gizli-parola")) ih.push("kira gösterimi izinli alan dışı taşıyor");
    writeFileSync(join(dizin, "bozuk.jws"), "x");
    if (y.kira({ yol: join(dizin, "bozuk.jws") }).bicimli !== false) ih.push("bozuk kira biçimli sayıldı");
    if (y.kira({ yol: join(dizin, "yok.jws") }).var !== false) ih.push("olmayan kira var sayıldı");
  } finally {
    rmSync(dizin, { recursive: true, force: true });
  }
  return ih;
}

function yardimci(): void {
  console.log("§1 gecis-yardimci.cjs");
  const bolumler: Array<[string, (y: Yardimci) => string[], Array<[string, string, string]>]> = [
    ["§1a ⭐ ikiz: hizmet varsayılanları + yol ayarları = src/lib/hizmet-duzeni.ts", ikizIhlalleri,
      [["rclone yolu ayrıştı", '"rclone.exe"', '"rclone2.exe"']]],
    ["§1b ⭐ ikiz: dotenv okuyucusu = gerçek dotenv (backend .env'i bununla okur)", dotenvIhlalleri,
      [["\\r genişletmesi silindi", 'deger = deger.replace(/\\\\r/g, "\\r");', ""]]],
    ["§1c ⭐ ortak .env vektörleri (env-dosyasi.json; backend dotenv = güncelleyici envfile.rs, D2b): yardımcının okuyucusu beklenenle birebir", ortakVektorIhlalleri,
      [["eski KATI Rust ikizi geri kondu", "module.exports = { dotenvCozumle,", `${ESKI_KATI_IKIZ}module.exports = { dotenvCozumle,`]]],
    ["§1d ⭐ yapilandirma\\.env: ecosystem ezer · değişmeyen satır bayt bayt korunur · yazılan değer okuyucuda aynen · etkin ayar aynı · sır yok · BOM/CRLF · engeller", ortamIhlalleri,
      [["ecosystem ezmez (sıra ters)", "const eskiEtkin = Object.assign({}, dot, eco.env);", "const eskiEtkin = Object.assign({}, eco.env, dot);"],
        ["kanonik satır hep çift tırnak", 'if (/^[^\\s#\'"`\\\\]*$/.test(v)) return k + "=" + v;', 'return k + \'="\' + v + \'"\';'],
        ["göreli yol mutlaklaşmaz", 'islem = islem === "ECO_DEGER" ? "ECO_DEGER+MUTLAK" : "MUTLAK";', "hedef = d.v;"]]],
    ["§1e ⭐ pm2: yalnız bu kökün backend'i UYUMLU; başka kök / TeksERP dışı / çift kayıt ENGEL; değer taşınmaz", pm2Ihlalleri,
      [["kök denetimi kalktı", "const bizim = uygulamalar.filter((x) => backendMi(x) && app !== \"\" && yolDuz(x.cwd) === app);", "const bizim = uygulamalar.filter((x) => backendMi(x));"]]],
    ["§1f kira: yalnız gösterim alanları (kanal · bitiş · politika · hedef · yaptırım)", kiraIhlalleri, []],
  ];
  for (const [baslik, fn, sondalar] of bolumler) {
    const ih = fn(Y);
    check(baslik, ih.length === 0, ih.join(" | ") || "temiz");
    for (const [ad, eski, yeni] of sondalar) {
      const m = KAYNAK.replace(eski, yeni);
      const uygulandi = m !== KAYNAK;
      let kirmizi = false;
      if (uygulandi) { try { kirmizi = fn(yukle(m)).length > 0; } catch { kirmizi = true; } }
      check(`§1 sonda: ${ad} → kırmızı`, uygulandi && kirmizi, uygulandi ? "" : "MUTASYON UYGULANMADI");
    }
  }
}

// --- §2 gecis.ps1 statik ----------------------------------------------------------------------------
const PLAN_SIRASI = ["PAKET_AC", "CURRENT", "ISKELET", "YAPILANDIRMA", "PM2_DURDUR", "YEDEK", "ACILIS_KAPAT", "DUVAR", "HIZMET_KAYIT", "DOGRULAMA", "BASLAT", "PM2_SOKUM", "YEDEKLE_BETIGI", "GUNCELLEYICI", "PG_KAYDI"];
const KRITIK_BEKLENEN = PLAN_SIRASI.slice(0, PLAN_SIRASI.indexOf("BASLAT") + 1);
function gecisIhlalleri(metin: string): string[] {
  const ih: string[] = [];
  const t = psTara(metin);
  const fn = (no: number) => t.fonksiyonlar.find((f) => no >= f.bas && no <= f.son)?.ad ?? "";
  const satir = (re: RegExp) => t.satirlar.filter((s) => re.test(s.ciplak));
  // (a) görev: yalnız TeksERP-Backend-Boot değişir.
  if (!/if \(\$teks -and \$g\.Ad -ceq "TeksERP-Backend-Boot"\) \{/.test(metin)) ih.push("açılış görevi tam adla seçilmiyor");
  for (const s of satir(/\bOsGorev(Kapat|Ac|Sil|Baslat)\s/)) {
    if (/^function /.test(s.ciplak.trim())) continue;
    if (!/(Boot|boot|\$bas\.ad\b|\$bas\.klasor\b)/.test(s.kod)) ih.push(`görev değişikliği Boot dışı argümanla (satır ${s.no})`);
  }
  if (!/\$boot = @\(OsGorevler \| Where-Object \{ \$_\.Ad -ceq "TeksERP-Backend-Boot" \}\)/.test(metin)) ih.push("tamamlama Boot'u tam adla seçmiyor");
  // (b) pm2: yalnız bu kökün uygulaması; kill yalnız başka uygulama yokken.
  // Dize içeriği `ciplak`ta silinir: komut adı `kod`dan okunur (yoksa denetim kör kalırdı).
  const pm2Hedefli = t.satirlar.filter((s) => /\bOsPm2 @\("(stop|start|delete)",/.test(s.kod));
  if (pm2Hedefli.length < 3) ih.push(`pm2 stop/start/delete çağrısı bulunamadı (${pm2Hedefli.length}) — denetim kör`);
  for (const s of pm2Hedefli) if (!/@\("(stop|start|delete)", \$ad\)/.test(s.kod)) ih.push(`pm2 ${s.no}: hedef $ad değil`);
  if (!/\$ad = \[string\]\$E\.Pm2\.bizim\.ad/.test(metin)) ih.push("pm2 hedefi sınıflanmış 'bizim'den gelmiyor");
  const kill = t.satirlar.findIndex((s) => /OsPm2 @\("kill"\)/.test(s.kod));
  if (kill < 0 || !t.satirlar.slice(Math.max(0, kill - 2), kill).some((s) => /if \(-not @\(\$E\.Pm2\.digerleri\)\.Count\)/.test(s.kod))) ih.push("pm2 kill başka uygulama koşulu olmadan");
  // (c) PostgreSQL hizmetine dokunulmaz; hizmet yönetimi yalnız sarmalayıcılardan.
  for (const s of satir(/\bOsHizmet(Baslat|Durdur|Kaldir)\b/)) if (/Pg/i.test(s.kod) && !/^function /.test(s.ciplak.trim())) ih.push(`PostgreSQL hizmetine işlem (satır ${s.no})`);
  for (const s of satir(/\b(Stop-Service|Restart-Service|Set-Service|Start-Service|Remove-Service|New-Service)\b/)) ih.push(`doğrudan hizmet cmdlet'i (satır ${s.no})`);
  for (const s of t.satirlar) if (/"config"|binPath=|"failure"/.test(s.kod) && /sc\.exe/.test(s.kod)) ih.push(`sc.exe yapılandırma (satır ${s.no})`);
  // (d) silme: yalnız izinli biçimler; kök dışı silme yok.
  for (const s of satir(/\bRemove-Item\b/)) {
    const ok = /Remove-Item -LiteralPath \$E\.Gecici -Recurse -Force/.test(s.kod) || (/Remove-Item -LiteralPath \$d\.FullName -Force/.test(s.kod) && fn(s.no) === "TamamlaKip");
    if (!ok) ih.push(`izinsiz Remove-Item (satır ${s.no})`);
  }
  for (const s of t.satirlar.filter((x) => /\[System\.IO\.(Directory|File)\]::Delete\(/.test(x.kod))) {
    const ok = (/\[System\.IO\.Directory\]::Delete\(\$baglanti, \$false\)/.test(s.kod) && fn(s.no) === "OsBaglantiSil") ||
      (/\[System\.IO\.Directory\]::Delete\(\$y, \$false\)/.test(s.kod) && fn(s.no) === "Telafi_ISKELET");
    if (!ok) ih.push(`izinsiz Delete (satır ${s.no})`);
  }
  const isk = t.fonksiyonlar.find((f) => f.ad === "Telafi_ISKELET");
  const iskMetin = isk ? t.satirlar.filter((x) => x.no >= isk.bas && x.no <= isk.son).map((x) => x.kod).join("\n") : "";
  if (!/if \(-not \(& \$kokIci \$y\)\) \{[\s\S]*?Move-Item[\s\S]*?continue/.test(iskMetin)) ih.push("kök dışı dizin silinmeden önce ayrılmıyor (yeniden adlandır)");
  // (e) veritabanı salt OKUNUR: yalnız SELECT/SHOW, göç yok, pg_restore yalnız --list.
  for (const m of metin.matchAll(/\bPsql "([^"]*)"/g)) if (!/^(SELECT|SHOW) /.test(m[1]!) || /\b(DROP|ALTER|INSERT|UPDATE|DELETE|TRUNCATE|CREATE)\b/i.test(m[1]!)) ih.push(`yazan SQL: ${m[1]!.slice(0, 40)}`);
  if (/migrate (deploy|reset|dev)/.test(metin.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n"))) ih.push("göç komutu var");
  if (!/function OsPgListe\(\$dosya\) \{ return NativeKos \(Join-Path \$script:db\.Bin "pg_restore\.exe"\) @\("--list", \$dosya\) \}/.test(metin)) ih.push("pg_restore yalnız --list değil");
  // (f) onay ilk değişiklikten ÖNCE.
  const ilk = (re: RegExp) => t.satirlar.find((s) => re.test(s.kod))?.no ?? -1;
  const onay = ilk(/if \(\$Onay -ne \$plan\.Count\) \{ PlanBas/), ozet = ilk(/if \(\$PlanOzeti -and \$PlanOzeti -cne \$oz\) \{ PlanBas/);
  const uygKip = t.fonksiyonlar.find((f) => f.ad === "UygulaKip");
  const acik = t.satirlar.find((x) => uygKip && x.no >= uygKip.bas && x.no <= uygKip.son && /^\s*GecisDiziniAc \$E\s*$/.test(x.kod))?.no ?? -1;
  if (onay < 0 || ozet < 0 || acik < 0 || !(onay < acik && ozet < acik)) ih.push(`onay ilk değişiklikten sonra (onay ${onay} · özet ${ozet} · ilk değişiklik ${acik})`);
  const gOnay = ilk(/if \(\$Onay -ne \$plan\.Count\) \{ Dur "-Onay \$Onay, geri alma/), gBas = ilk(/GunlukYaz "GERI_ALMA_BASLADI" \$null @\{ elle/);
  if (gOnay < 0 || gBas < 0 || gOnay > gBas) ih.push("geri almada onay değişiklikten sonra");
  const tOnay = ilk(/if \(\$Onay -ne \$plan\.Count\) \{ Dur "-Onay \$Onay, plan \$\(\$plan\.Count\) kalem - HICBIR SEYE DOKUNULMADI\." \}/), tBas = ilk(/GunlukYaz "TAMAMLA_BASLADI"/);
  if (tOnay < 0 || tBas < 0 || tOnay > tBas) ih.push("tamamlamada onay değişiklikten sonra");
  // (g) plan sırası: iskelet (iyi bilinen SID) → ... → hizmet kaydı + ACL (backend-hizmeti.ps1) → sağlık.
  const sira = [...metin.matchAll(/& \$ekle "([A-Z0-9_]+)"/g)].map((m) => m[1]!);
  if (JSON.stringify(sira) !== JSON.stringify(PLAN_SIRASI)) ih.push(`plan sırası ${sira.join(">")}`);
  if (!/function Is_ISKELET\(\$E\) \{\s*\n\s*\$kod = OsBetik \$E\.AclBetigi @\{ Kok = \$E\.Kok; HizmetAdi = \$E\.HizmetAdi; Uygula = \$true; YalnizIskelet = \$true \}/.test(metin)) ih.push("iskelet -YalnizIskelet ile çağrılmıyor");
  const kayit = /function Is_HIZMET_KAYIT\(\$E\) \{[\s\S]*?\n\}/.exec(metin)?.[0] ?? "";
  if (!/OsBetik \$E\.AclBetigi \$arg/.test(kayit) || /YalnizIskelet/.test(kayit)) ih.push("hizmet kaydı backend-hizmeti.ps1 -Uygula ile değil");
  for (const s of t.satirlar) if (/icacls/.test(s.kod) && /S-1-5-80|NT SERVICE/.test(s.kod)) ih.push(`gecis.ps1 sanal hesaba kendisi izin yazıyor (satır ${s.no})`);
  // (h) kritik kalemler = backend sağlıklı olana dek; her kalemin işi + telafisi + metni var.
  const kritik = /\$script:KRITIK = @\(([^)]*)\)/.exec(metin)?.[1]?.match(/"([A-Z0-9_]+)"/g)?.map((x) => x.slice(1, -1)) ?? [];
  if (JSON.stringify(kritik) !== JSON.stringify(KRITIK_BEKLENEN)) ih.push(`KRITIK ${kritik.join(",")}`);
  for (const a of PLAN_SIRASI) {
    if (!new RegExp(`^function Is_${a}\\(`, "m").test(metin)) ih.push(`Is_${a} yok`);
    if (!new RegExp(`^function Telafi_${a}\\(\\$bas, \\$bit\\)`, "m").test(metin)) ih.push(`Telafi_${a} yok`);
    if (!new RegExp(`\\b${a} = "`).test(metin)) ih.push(`TELAFI_METNI ${a} yok`);
  }
  // (i) sır: parola yalnız PGPASSWORD'e; çıktı/günlük satırında parola yok.
  const SIR_ATFI = /(Parola|\$par\b|\.pass\b|superpass)/;
  for (const s of t.satirlar) {
    for (const m of s.kod.matchAll(/\b(Write-Host|Ok|Uyar|Bilgi|Engel|Kayit|Dur)\s+"([^"]*)"/g)) if (SIR_ATFI.test(m[2]!)) ih.push(`çıktıda parola (satır ${s.no})`);
    if (/\bGunlukYaz\b/.test(s.ciplak) && SIR_ATFI.test(s.kod)) ih.push(`günlükte parola (satır ${s.no})`);
  }
  for (const s of t.satirlar.filter((x) => /\.Parola\b/.test(x.kod))) if (!/\$env:PGPASSWORD = \$db\.Parola|Parola = \$par/.test(s.kod)) ih.push(`parola PGPASSWORD dışında kullanılıyor (satır ${s.no})`);
  // (j) paket güvenliği + veritabanı nötrlüğü: kök dışı girdi · aynı derleme · bekleyen göç engeli.
  if (!metin.includes("$_ -cmatch '(^|/)\\.\\.(/|$)'")) ih.push("zip kök dışı girdi denetimi yok");
  if (!/\$ayni = \(\[string\]\$E\.Paket\.derlemeKimligi -ceq \[string\]\$E\.AppPaket\.derlemeKimligi\) -and \(\[string\]\$E\.Paket\.commit -ceq \[string\]\$E\.AppPaket\.commit\) -and \(\$E\.Surum -ceq \$E\.AppSurum\)\s*$/m.test(metin)) ih.push("paket = app\\ derlemesi denetimi yok");
  if (!/if \(\$bekleyen\.Count\) \{ Engel /.test(metin) || !/if \(\$fazla\.Count\) \{ Engel /.test(metin) || !/if \(\$yarim\.Count\) \{ Engel /.test(metin)) ih.push("bekleyen/fazla/yarım göç engeli yok");
  return ih;
}
function gecisStatik(): void {
  console.log("\n§2 deploy/gecis/gecis.ps1 (statik)");
  const metin = readFileSync(GECIS, "utf8").replace(/\r\n/g, "\n");
  const t = psTara(metin);
  check("§2 körlük zemini: betik tarandı (fonksiyonlar + Os sarmalayıcıları + plan)", t.fonksiyonlar.length > 60 && /& \$ekle "PAKET_AC"/.test(metin) && /^function OsHizmetler/m.test(metin));
  const ih = gecisIhlalleri(metin);
  check("§2a-j ⭐ yalnız TeksERP-Backend-Boot + bu kökün pm2'si · PostgreSQL'e dokunulmaz · kök dışı silme yok · DB salt okunur · onay ilk değişiklikten önce · iskelet → kayıt/ACL · kritik kalemler · telafiler · sır yok · aynı derleme",
    ih.length === 0, ih.join(" | ") || "temiz");
  const sondalar: Array<[string, string, string]> = [
    ["açılış görevi önekle seçildi", 'if ($teks -and $g.Ad -ceq "TeksERP-Backend-Boot") {', 'if ($teks -and $g.Ad.StartsWith("TeksERP-B", [System.StringComparison]::Ordinal)) {'],
    ["yedek görevi de kapatılıyor", "  OsGorevKapat ([string]$E.Boot.Ad) ([string]$E.Boot.Klasor)\n", "  OsGorevKapat ([string]$E.Boot.Ad) ([string]$E.Boot.Klasor)\n  foreach ($y in $E.YedekGorevleri) { OsGorevKapat $y.Ad $y.Klasor }\n"],
    ["pm2 hedefi sabit ad", '$r = OsPm2 @("stop", $ad)', '$r = OsPm2 @("stop", "tekserp-backend")'],
    ["kill koşulsuz", '  if (-not @($E.Pm2.digerleri).Count) {\n    $r = OsPm2 @("kill")', '  if ($true) {\n    $r = OsPm2 @("kill")'],
    ["PostgreSQL durduruluyor", "  OsHizmetBaslat $E.HizmetAdi @()\n  try { SaglikBekle $E \"normal baslatma\"", "  OsHizmetDurdur $E.PgHizmeti\n  OsHizmetBaslat $E.HizmetAdi @()\n  try { SaglikBekle $E \"normal baslatma\""],
    ["app\\ siliniyor", "function Is_PM2_SOKUM($E) {\n", "function Is_PM2_SOKUM($E) {\n  Remove-Item -LiteralPath $E.App -Recurse -Force\n"],
    ["kök dışı boş dizin siliniyor", "    if (-not (& $kokIci $y)) {", "    if ($false) {"],
    ["veritabanına yazılıyor", 'Psql "SELECT pg_database_size(current_database())"', 'Psql "DROP TABLE x"'],
    // Taşıma (silme değil): ilk değişiklik onay denetiminin ÖNÜNE geçer — "bulunamadı" değil SIRA kırmızısı.
    ["onay ilk değişiklikten sonra", "  $plan = PlanKur $E\n  $oz = PlanOzetiHesapla $plan\n  if ($Onay -ne $plan.Count) { PlanBas", "  GecisDiziniAc $E\n  $plan = PlanKur $E\n  $oz = PlanOzetiHesapla $plan\n  if ($Onay -ne $plan.Count) { PlanBas"],
    ["kayıt iskeletten önce", '  & $ekle "ISKELET"', '  & $ekle "HIZMET_KAYIT" "x"\n  & $ekle "ISKELET"'],
    ["sağlık sonrası kalem kritik değil", '"DOGRULAMA", "BASLAT")', '"DOGRULAMA")'],
    ["telafi eksik", "function Telafi_DUVAR($bas, $bit)", "function Telafi_DUVAR_YOK($bas, $bit)"],
    ["parola ekrana", "  $E.Db = [pscustomobject]@{", '  Bilgi "parola $par"\n  $E.Db = [pscustomobject]@{'],
    ["derleme denetimi yok", "$ayni = ([string]$E.Paket.derlemeKimligi", "$ayni = $true -or ([string]$E.Paket.derlemeKimligi"],
  ];
  for (const [ad, eski, yeni] of sondalar) {
    const m = metin.replace(eski, yeni);
    const uygulandi = m !== metin;
    const ih2 = uygulandi ? gecisIhlalleri(m) : [];
    check(`§2 sonda: ${ad} → kırmızı`, uygulandi && ih2.length > 0, uygulandi ? ih2.slice(0, 2).join(" | ") : "MUTASYON UYGULANMADI");
  }
}

// --- §3 harness ---------------------------------------------------------------------------------------
interface Kos { kod: number | null; cikti: string }
function harness(taban: string, kip: string, ek: string[] = []): Kos {
  const r = spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-File", HARNESS, "-Script", GECIS, "-Taban", taban, "-Kip", kip, ...ek], { encoding: "utf8", timeout: 180_000 });
  return { kod: r.status, cikti: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}
function sahte(taban: string): {
  pm2: { daemon: boolean; uygulamalar: Array<{ ad: string; durum: string }> };
  hizmetler: Array<{ Ad: string; Durum: string }>; gorevler: Array<{ Ad: string; Durum: string }>; duvar: boolean;
} {
  return JSON.parse(readFileSync(join(taban, "sahte.json"), "utf8").replace(/^\uFEFF/, ""));
}
function gunluk(taban: string): Array<{ olay: string; adim: string | null; veri: Record<string, unknown> | null }> {
  const ust = join(taban, "kok", "gecis");
  const d = readdirSync(ust).filter((x) => /^\d{8}_\d{6}$/.test(x)).sort().pop();
  return d ? readFileSync(join(ust, d, "gunluk.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
}
function planOku(cikti: string): { n: number; ozet: string } | null {
  const n = /PLAN \((\d+) kalem\)/.exec(cikti), o = /plan ozeti: ([0-9a-f]{12})/.exec(cikti);
  return n && o ? { n: Number(n[1]), ozet: o[1]! } : null;
}
function cagrilar(taban: string): string[] { return readFileSync(join(taban, "cagrilar.log"), "utf8").split("\n").filter(Boolean); }
function sirTaramasi(taban: string, metin: string): string[] {
  const bulunan: string[] = [];
  const tara = (d: string): void => {
    for (const e of readdirSync(d)) {
      const y = join(d, e);
      const st = lstatSync(y);
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) { tara(y); continue; }
      const icerik = readFileSync(y, "utf8");
      for (const s of SIRLAR) if (icerik.includes(s)) bulunan.push(`${path.relative(taban, y)}:${s}`);
    }
  };
  const g = join(taban, "kok", "gecis");
  if (existsSync(g)) {
    for (const e of readdirSync(g)) {
      const d = join(g, e);
      for (const f of ["gunluk.jsonl", "gecis.log"]) if (existsSync(join(d, f))) { const i = readFileSync(join(d, f), "utf8"); for (const s of SIRLAR) if (i.includes(s)) bulunan.push(`${e}/${f}:${s}`); }
      if (existsSync(join(d, "kopya"))) tara(join(d, "kopya"));
    }
  }
  for (const s of SIRLAR) if (metin.includes(s)) bulunan.push(`stdout:${s}`);
  return bulunan;
}
function pm2LayoutGeriMi(taban: string): string[] {
  const ih: string[] = [];
  const s = sahte(taban);
  const kok = join(taban, "kok");
  if (!s.pm2.daemon || !s.pm2.uygulamalar.some((u) => u.ad === "tekserp-backend-yeni" && u.durum === "online")) ih.push("pm2 backend'i online değil");
  if (s.hizmetler.some((h) => h.Ad.startsWith("TeksERP-"))) ih.push("TeksERP hizmeti kaldı");
  if (s.gorevler.find((g) => g.Ad === "TeksERP-Backend-Boot")?.Durum !== "Ready") ih.push("açılış görevi açık değil");
  for (const iz of ["surumler", "current", "yapilandirma", "guncelleyici", "veri"]) if (existsSync(join(kok, iz))) ih.push(`${iz} kaldı`);
  if (!readFileSync(join(kok, "yedekle.ps1"), "utf8").includes("ESKI yedekle.ps1")) ih.push("yedekle.ps1 eskiye dönmedi");
  if (!readFileSync(join(kok, "pm2-home", "dump.pm2"), "utf8").includes("tekserp-backend-yeni")) ih.push("dump.pm2 dönmedi");
  if (!existsSync(join(kok, "app", "dist", "server.js")) || !existsSync(join(kok, "rclone.conf"))) ih.push("app\\ ya da rclone.conf yerinde değil");
  return ih;
}
function senaryolar(): void {
  console.log("\n§3 sahte-Windows harness (gerçek akış, Os* sarmalayıcıları sahte)");
  const pw = spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-Command", "$PSVersionTable.PSVersion.Major"], { encoding: "utf8", timeout: 60_000 });
  if (pw.error || pw.status !== 0 || Number((pw.stdout ?? "").trim()) < 7) { defter.atla("§3 harness", "pwsh 7 yok", "?"); return; }
  const tabanlar: string[] = [];
  const yeni = (ad: string, degisiklik?: string): string => {
    const t = mkdtempSync(join(tmpdir(), `gecis-${ad}-`));
    tabanlar.push(t);
    const k = harness(t, "kur-ortam", degisiklik ? ["-Degisiklik", degisiklik] : []);
    if (k.kod !== 0) throw new Error(`ortam kurulamadı (${ad}): ${k.cikti.slice(-300)}`);
    return t;
  };
  try {
    // A — kuru → yanlış onay → uygula → durum → geri al (kuru + uygula) → yeniden kuru
    const a = yeni("ana");
    const k1 = harness(a, "kuru");
    const p1 = planOku(k1.cikti);
    check("§3a ⭐ kuru: plan hazır (çıkış 0), N kalem + plan özeti basıldı, HİÇBİR şey değişmedi", k1.kod === 0 && !!p1 && p1.n === 13 && !existsSync(join(a, "kok", "gecis")) && !existsSync(join(a, "kok", "surumler")) && cagrilar(a).every((c) => /^(pm2 jlist|psql )/.test(c)),
      `kod ${k1.kod} · ${p1 ? p1.n + " kalem" : "plan yok"}`);
    const k2 = harness(a, "uygula", ["-Onay", String((p1?.n ?? 0) + 1)]);
    check("§3b ⭐ yanlış -Onay: çıkış 1, gecis\\ dizini bile açılmadı", k2.kod === 1 && !existsSync(join(a, "kok", "gecis")) && /HICBIR SEYE DOKUNULMADI/.test(k2.cikti), `kod ${k2.kod}`);
    const k3 = harness(a, "uygula", ["-Onay", String(p1?.n ?? 0), "-PlanOzeti", p1?.ozet ?? ""]);
    const s3 = sahte(a);
    const c3 = cagrilar(a);
    const idx = (re: RegExp) => c3.findIndex((x) => re.test(x));
    const sira = [idx(/^betik backend-hizmeti\.ps1 .*-YalnizIskelet/), idx(/^pm2 stop tekserp-backend-yeni$/), idx(/^pg_dump$/), idx(/^gorev kapat TeksERP-Backend-Boot$/),
      idx(/^betik backend-hizmeti\.ps1 .*-PgHizmeti=postgresql-tekserp -Uygula$/), idx(/^hizmet baslat TeksERP-Backend --dogrulama$/), idx(/^hizmet baslat TeksERP-Backend $/), idx(/^pm2 kill$/), idx(/^betik guncelleyici-hizmeti\.ps1 .*-Uygula$/)];
    const g3 = gunluk(a);
    const sonuc3 = g3.find((x) => x.olay === "SONUC")?.veri?.sonuc;
    check("§3c ⭐ uygula: kalem sırası (iskelet → pm2 stop → yedek → açılış kapat → kayıt+ACL → doğrulama → başlat → pm2 kill → güncelleyici)",
      sira.every((x, i) => x >= 0 && (i === 0 || x > sira[i - 1]!)), sira.join(","));
    check("§3c ⭐ uygula: son durum — hizmetler çalışıyor, pm2 yok, açılış görevi kapalı, yedek görevi dokunulmadı, PostgreSQL hizmeti AYNI",
      (k3.kod === 0 || k3.kod === 3) && s3.hizmetler.find((h) => h.Ad === "TeksERP-Backend")?.Durum === "Running" && s3.hizmetler.find((h) => h.Ad === "TeksERP-Guncelleyici")?.Durum === "Running" &&
        !s3.pm2.daemon && s3.gorevler.find((g) => g.Ad === "TeksERP-Backend-Boot")?.Durum === "Disabled" && s3.gorevler.find((g) => g.Ad === "TeksERP-DB-Backup-Yeni")?.Durum === "Ready" &&
        s3.hizmetler.find((h) => h.Ad === "postgresql-tekserp")?.Durum === "Running" && !c3.some((x) => /postgresql-tekserp/.test(x) && /^hizmet /.test(x)),
      `kod ${k3.kod} · sonuç ${String(sonuc3)}`);
    const env3 = existsSync(join(a, "kok", "yapilandirma", ".env")) ? readFileSync(join(a, "kok", "yapilandirma", ".env"), "utf8") : "";
    check("§3c uygula: dosya düzeni — surumler\\2.14.0 + current bağlantısı + yapilandirma\\.env (HOST/PORT ecosystem'den) + veri\\rclone.conf + yeni yedekle.ps1 + app\\ ve pm2 dosyaları YERİNDE",
      existsSync(join(a, "kok", "surumler", "2.14.0", "dist", "server.js")) && lstatSync(join(a, "kok", "current")).isSymbolicLink() && /HOST=0\.0\.0\.0/.test(env3) && /JWT_SECRET/.test(env3) &&
        existsSync(join(a, "kok", "veri", "rclone.conf")) && !readFileSync(join(a, "kok", "yedekle.ps1"), "utf8").includes("ESKI yedekle.ps1") &&
        existsSync(join(a, "kok", "app", "dist", "server.js")) && existsSync(join(a, "kok", "pm2-home")));
    check("§3c uygula: günlük her kalemi BASLADI/BITTI ile tutar, SONUC BASARILI*", g3.filter((x) => x.olay === "BASLADI").length === 13 && g3.filter((x) => x.olay === "BITTI").length === 13 && /^BASARILI/.test(String(sonuc3)));
    const k4 = harness(a, "kuru");
    check("§3d gecis sonrası parametresiz koşum: DURUM ölçümü (hizmet · sağlık · kimlik · pm2 yok · açılış kapalı · lisans dizini yerinde · gece yedeği betiği = kurulu sürüm)",
      k4.kod === 0 && /DURUM \(olcum\)/.test(k4.cikti) && /kurulum kimligi ayni/.test(k4.cikti) && /acilis gorevi kapali/.test(k4.cikti) &&
        /lisans dizini yerinde \(1 dosya/.test(k4.cikti) && /gece yedegi betigi = kurulu surumunku/.test(k4.cikti), `kod ${k4.kod}`);
    const k5 = harness(a, "gerial-kuru");
    const p5 = /GERI ALMA PLANI \((\d+) kalem/.exec(k5.cikti);
    const k6 = harness(a, "gerial", ["-Onay", p5?.[1] ?? "0"]);
    const g6 = gunluk(a);
    const geri = pm2LayoutGeriMi(a);
    check("§3e ⭐ -GeriAl: pm2 düzeni AYNEN geri (pm2 online · TeksERP hizmeti yok · açılış görevi açık · yeni dizinler kalktı · yedekle.ps1 + dump.pm2 eskiye)",
      k6.kod === 0 && geri.length === 0 && g6.at(-1)?.olay === "SONUC" && g6.at(-1)?.veri?.sonuc === "GERI_ALINDI", `kod ${k6.kod} · ${geri.join(", ") || "temiz"}`);
    check("§3e geri alınan dosyalar silinmedi: gecis\\<damga>\\geri\\ karantinasında", existsSync(join(a, "kok", "gecis")) && readdirSync(join(a, "kok", "gecis")).some((d) => existsSync(join(a, "kok", "gecis", d, "geri", "surumler"))));
    const k7 = harness(a, "kuru");
    check("§3e geri alma sonrası kök yeniden geçirilebilir (kuru plan, engel yok)", k7.kod === 0 && planOku(k7.cikti)?.n === 13, `kod ${k7.kod}`);
    const sir = sirTaramasi(a, [k1, k2, k3, k4, k5, k6, k7].map((k) => k.cikti).join("\n"));
    check("§3k ⭐ sır taraması: .env/kimlik/rclone sırları stdout'a, günlüğe, gecis.log'a, kopyalara girmedi", sir.length === 0, sir.join(", ") || "temiz");
    // B — doğrulama ve normal başlatma hatasında OTOMATİK geri alma
    for (const hata of ["DOGRULAMA", "BASLAT"]) {
      const b = yeni(`hata-${hata.toLowerCase()}`);
      const p = planOku(harness(b, "kuru").cikti);
      const kb = harness(b, "uygula", ["-Onay", String(p?.n ?? 0), "-Hata", hata]);
      const gb = gunluk(b);
      const ihb = pm2LayoutGeriMi(b);
      check(`§3f ⭐ ${hata} sağlığı düşünce OTOMATİK geri alma: çıkış 1, pm2 düzeni aynen geri, SONUC GERI_ALINDI (otomatik)`,
        kb.kod === 1 && ihb.length === 0 && gb.some((x) => x.olay === "HATA" && x.adim === hata) && gb.at(-1)?.veri?.sonuc === "GERI_ALINDI" && gb.at(-1)?.veri?.otomatik === true,
        `kod ${kb.kod} · ${ihb.join(", ") || "temiz"}`);
    }
    // C — engeller: hiçbir şeye dokunmadan çıkış 1
    for (const [deg, re] of [["goc-eksik", /UYGULANMAMIS/], ["derleme-farkli", /app\\'teki derleme DEGIL/], ["pm2-yabanci", /TeksERP disi uygulama/], ["gorev-yabanci", /TeksERP adli OLMAYAN gorev/]] as const) {
      const c = yeni(deg, deg);
      const kc = harness(c, "kuru");
      check(`§3g ⭐ engel (${deg}): kuru çıkış 1, gerekçe basıldı, hiçbir şey değişmedi`, kc.kod === 1 && re.test(kc.cikti) && !existsSync(join(c, "kok", "gecis")), `kod ${kc.kod}`);
    }
    // D — güvenlik duvarında port kuralı yoksa eklenir, geri almada kalkar
    const d = yeni("duvar", "duvar-yok");
    const pd = planOku(harness(d, "kuru").cikti);
    const kd = harness(d, "uygula", ["-Onay", String(pd?.n ?? 0)]);
    const eklendi = sahte(d).duvar;
    const pdg = /GERI ALMA PLANI \((\d+) kalem/.exec(harness(d, "gerial-kuru").cikti);
    harness(d, "gerial", ["-Onay", pdg?.[1] ?? "0"]);
    check("§3h güvenlik duvarı: port kuralı yoksa plana girer (14 kalem), eklenir, geri almada kalkar", pd?.n === 14 && (kd.kod === 0 || kd.kod === 3) && eklendi && !sahte(d).duvar, `plan ${pd?.n} · kod ${kd.kod}`);
    // E — tamamla: pm2 kalıntıları arşive, açılış görevi silinir, sonra geri alma reddedilir
    const e = yeni("tamamla");
    const pe = planOku(harness(e, "kuru").cikti);
    harness(e, "uygula", ["-Onay", String(pe?.n ?? 0)]);
    const tk = harness(e, "tamamla-kuru");
    const pt = /TAMAMLAMA PLANI \((\d+) kalem/.exec(tk.cikti);
    const tu = harness(e, "tamamla", ["-Onay", pt?.[1] ?? "0"]);
    const arsiv = readdirSync(join(e, "kok", "gecis")).map((x) => join(e, "kok", "gecis", x, "pm2-duzeni")).find((x) => existsSync(x)) ?? "";
    const ge = harness(e, "gerial-kuru");
    check("§3i ⭐ -Tamamla: app\\ · pm2 · pm2-home · pm2-boot.cmd arşive taşındı (silinmedi), açılış görevi silindi, düz yedek silindi; sonra -GeriAl REDDEDİLİR",
      tu.kod === 0 && !!arsiv && ["app", "pm2", "pm2-home", "pm2-boot.cmd"].every((x) => existsSync(join(arsiv, x))) && !existsSync(join(e, "kok", "app")) &&
        !sahte(e).gorevler.some((g) => g.Ad === "TeksERP-Backend-Boot") && ge.kod === 1 && /TAMAMLANMIS/.test(ge.cikti),
      `kod ${tu.kod} · arşiv ${arsiv ? "var" : "yok"} · geri al ${ge.kod}`);
  } catch (err) {
    check("§3 harness koşturulabildi", false, String((err as Error).message).slice(0, 300));
  } finally {
    for (const t of tabanlar) rmSync(t, { recursive: true, force: true });
  }
}

function main(): void {
  console.log("=== pm2 → Windows hizmeti geçişi (D6) ===\n");
  yardimci();
  gecisStatik();
  senaryolar();
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız${defter.ozetEki()} ===`);
  process.exit(fail > 0 ? 1 : 0);
}
main();
