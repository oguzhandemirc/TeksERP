// =============================================================================
// NUMARALANDIRMA KEŞİF TURU (E0) — 52 serinin her birinde Düzenle diyaloğunu
// GERÇEK panelde açar, her alanı dener, gerçekten kaydeder (ayar şifresiyle),
// eski kayıtların numarasının DB'de değişmediğini ölçer ve seriyi geri alır.
//
// Koşum (Electron/ içinden):
//   AYAR_SIFRESI_DOSYASI=<yol> node e2e/guzergah/numara-kesif.mjs [seriKey ...]
// Ön koşul: guzergah.mjs ile aynı (e2e-ortam kur + sunucu, electron-vite build).
// Ayar şifresi yalnız dosyadan okunur ve bellekte tutulur; çıktıya yazılmaz.
// Çıktı: e2e/guzergah/out/kesif-<zaman>/sonuc.json + görüntüler.
// =============================================================================
import { _electron as electron } from "@playwright/test";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BURASI = path.dirname(fileURLToPath(import.meta.url));
const ELECTRON_KOK = path.resolve(BURASI, "../..");
const BACKEND_KOK = path.resolve(ELECTRON_KOK, "../Teks-Erp");
const requireBackend = createRequire(path.join(BACKEND_KOK, "package.json"));
const { Client: PgClient } = requireBackend("pg");

const ortam = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), "tekserp-e2e-env.json"), "utf-8"));
const AYAR_SIFRESI = fs.readFileSync(process.env.AYAR_SIFRESI_DOSYASI, "utf-8").trim();
const SERI_TABLO = JSON.parse(fs.readFileSync(process.env.SERI_TABLO_DOSYASI, "utf-8"));
SERI_TABLO.roll = { table: "rolls", column: "barcode" };
const MAIN_JS = path.join(ELECTRON_KOK, "out/main/main.js");
const ELECTRON_DIST = path.join(ELECTRON_KOK, "node_modules/electron");
const ELECTRON_BIN = path.join(ELECTRON_DIST, "dist", fs.readFileSync(path.join(ELECTRON_DIST, "path.txt"), "utf-8").trim());

const zaman = new Date().toISOString().replace(/[:.]/g, "-");
const CIKTI = path.join(BURASI, "out", `kesif-${zaman}`);
fs.mkdirSync(CIKTI, { recursive: true });

const pg = new PgClient({ connectionString: ortam.dbUrl.replace(/\?schema=public$/, "") });
await pg.connect();
const sql = async (q, p = []) => (await pg.query(q, p)).rows;

// ── API (doğrulama) ──────────────────────────────────────────────────────────
let token = null;
async function api(yol, init = {}) {
  if (!token) {
    const k = ortam.kullanicilar.yonetici;
    const r = await fetch(`${ortam.apiUrl}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: k.username, password: k.password, clientType: "web" }) });
    token = (await r.json()).data.token;
  }
  const r = await fetch(`${ortam.apiUrl}${yol}`, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) } });
  return { status: r.status, govde: await r.json().catch(() => null) };
}
const seriListesi = async () => (await api("/api/number-series")).govde.data;

// ── DB parmak izi: eski kayıtların numarası değişti mi ───────────────────────
async function parmakIzi(key) {
  const t = SERI_TABLO[key];
  if (!t) return null;
  const q = `SELECT count(*)::int AS n, md5(coalesce(string_agg(coalesce("${t.column}"::text,''), ',' ORDER BY id), '')) AS h FROM "${t.table}"`;
  const [r] = await sql(q);
  return `${r.n}:${r.h}`;
}
const seriSatiri = async (key) => (await sql(`SELECT prefix, "dateSegment"::text AS ds, digits, separator, separator2, "retiredPrefixes"::text AS retired FROM number_series WHERE key=$1`, [key]))[0];
const cizgiSayisi = async (key) => (await sql(`SELECT count(*)::int AS n FROM number_series_lines WHERE "seriesKey"=$1`, [key]))[0].n;

// ── panel ────────────────────────────────────────────────────────────────────
const konsol = [];
const udd = fs.mkdtempSync(path.join(os.tmpdir(), "tekserp-e2e-udd-"));
const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [MAIN_JS, `--user-data-dir=${udd}`], env: { ...process.env, APP_ENV: "development" }, timeout: 60_000 });
const page = await app.firstWindow();
// GÖRÜNÜRLÜK: `KESIF_GORUNUR=1` yoksa pencere kullanıcının ekranından çekilir (odak çalmaz).
// Ölçüm sonucu `pencere` alanında raporlanır — gizli pencerede görüntü alınabiliyor mu.
const GORUNUR = process.env.KESIF_GORUNUR === "1";
const pencere = await app.evaluate(({ BrowserWindow }, gorunur) => {
  const w = BrowserWindow.getAllWindows()[0];
  if (!w) return { yok: true };
  // Uygulama `ready-to-show`ta show() + maximize() çağırıyor (electron/main.ts) — örnek
  // metotları ekran dışı ve odak çalmayan sürümlerle değiştirilir; build'e dokunulmaz.
  if (!gorunur) {
    w.webContents.setBackgroundThrottling(false);
    w.setSkipTaskbar?.(true);
    w.maximize = () => undefined;
    w.focus = () => undefined;
    w.show = () => { w.setPosition(-10000, -10000); w.showInactive(); w.setPosition(-10000, -10000); };
    w.setPosition(-10000, -10000);
    // macOS pencereyi ekrana geri kıstırır (ölçüldü: x=-1240) → görünmez + tıklama geçirir.
    w.setOpacity(0);
    w.setIgnoreMouseEvents(true);
  }
  const [x, y] = w.getPosition();
  return { gorunur, x, y, visible: w.isVisible(), focused: w.isFocused() };
}, GORUNUR);
console.log(`pencere: ${JSON.stringify(pencere)}`);
page.on("console", (m) => { if (m.type() === "error") konsol.push(m.text().slice(0, 300)); });
await page.route("http://localhost:4000/**", (r) => r.abort("blockedbyclient"));
{
  const u = new URL(ortam.apiUrl);
  await page.getByRole("button", { name: "Sunucu adresi ayarları" }).waitFor({ timeout: 40_000 });
  await page.getByRole("button", { name: "Sunucu adresi ayarları" }).click();
  const d = page.getByRole("dialog").filter({ hasText: "Sunucu Adresi" }).first();
  await d.locator("#api-host").fill(u.hostname);
  await d.locator("#api-port").fill(u.port);
  await d.getByRole("button", { name: "Kaydet", exact: true }).click();
  await d.waitFor({ state: "detached" });
  for (let i = 0; i < 3; i++) {
    if (await page.getByPlaceholder("ör. admin").waitFor({ timeout: 6_000 }).then(() => true, () => false)) break;
    const ara = page.getByRole("button", { name: "Sunucuyu Ara" });
    if (await ara.count()) await ara.first().click().catch(() => undefined);
  }
  const k = ortam.kullanicilar.yonetici;
  await page.getByPlaceholder("ör. admin").fill(k.username);
  await page.locator('input[type="password"]').first().fill(k.password);
  await page.keyboard.press("Enter");
  await page.getByPlaceholder("ör. admin").waitFor({ state: "detached", timeout: 30_000 });
  await page.waitForTimeout(800);
  const sn = page.getByRole("dialog").filter({ hasText: "Bu güncellemede neler değişti" });
  if (await sn.count()) await sn.getByRole("button", { name: "Tamam" }).click().catch(() => undefined);
}
async function numaralandirmayaGit() {
  const acici = page.getByText("Ara veya komut", { exact: false }).first();
  if (await acici.count()) await acici.click(); else await page.keyboard.press("Meta+k");
  const kutu = page.getByPlaceholder("Sayfa, rapor, ayar ara...");
  await kutu.fill("Numaralandırma");
  await page.waitForTimeout(500);
  const aday = page.getByRole("option", { name: "Numaralandırma" }).first();
  if (await aday.count()) await aday.click(); else await page.keyboard.press("Enter");
  await page.getByRole("heading", { name: "Numaralandırma" }).waitFor({ timeout: 15_000 });
  await page.waitForTimeout(600);
}
await numaralandirmayaGit();
await page.screenshot({ path: path.join(CIKTI, "00-sayfa.png"), fullPage: true });

// ── TOAST KOLU: her toast adım adıyla kaydedilir, görüntü toast kaybolmadan alınır ──
let simdikiAdim = "giriş";
const toastlar = [];
let toastNo = 0;
await page.exposeFunction("__kesifToast", async (t) => {
  const dosya = `toast-${String(++toastNo).padStart(3, "0")}.png`;
  await page.screenshot({ path: path.join(CIKTI, dosya) }).catch(() => undefined);
  const k = { adim: simdikiAdim, tur: t.tur, metin: t.metin, zaman: new Date().toISOString(), gorsel: dosya };
  toastlar.push(k);
  console.log(`  🔔 toast [${k.tur}] ${k.adim} → ${k.metin.slice(0, 160)}`);
});
await page.evaluate(() => {
  const gorulen = new WeakSet();
  const tara = () => document.querySelectorAll("[data-sonner-toast]").forEach((el) => {
    if (gorulen.has(el)) return;
    gorulen.add(el);
    // metin bir sonraki karede dolar
    requestAnimationFrame(() => window.__kesifToast({ tur: el.getAttribute("data-type") ?? "?", metin: (el.textContent ?? "").trim() }));
  });
  new MutationObserver(tara).observe(document.body, { childList: true, subtree: true });
  tara();
});

// ── yardımcılar ──────────────────────────────────────────────────────────────
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const satir = (label) => page.locator("tbody tr").filter({ has: page.locator("td div.font-medium", { hasText: new RegExp(`^${esc(label)}$`) }) }).first();
const diyalog = (label) => page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: label, exact: true }) }).first();
let gorNo = 0;
async function gor(key, ad) {
  const dosya = `${key}-${String(++gorNo).padStart(3, "0")}-${ad}.png`;
  await page.screenshot({ path: path.join(CIKTI, dosya) }).catch(() => undefined);
  return path.relative(ELECTRON_KOK, path.join(CIKTI, dosya));
}
async function durumOku(d) {
  await page.waitForTimeout(900); // önizleme sunucudan
  const onizleme = (await d.locator(".font-mono.text-2xl").textContent().catch(() => null))?.trim() ?? null;
  const hataL = d.locator("p.text-destructive");
  const hata = (await hataL.count()) ? (await hataL.first().textContent())?.trim() : null;
  const kaydetAcik = await d.getByRole("button", { name: "Kaydet" }).isEnabled().catch(() => null);
  return { onizleme, hata, kaydetAcik };
}
async function diyaloguKapat() {
  for (let i = 0; i < 3 && (await page.getByRole("dialog").count()); i++) { await page.keyboard.press("Escape"); await page.waitForTimeout(250); }
}
async function ac(r) {
  await diyaloguKapat();
  await page.waitForTimeout(1500); // kaydetme sonrası liste yeniden çekilsin (satır bayat kalmasın)
  const tr = satir(r.label);
  await tr.scrollIntoViewIfNeeded();
  const btn = tr.getByRole("button", { name: "Düzenle" });
  if (!(await btn.isEnabled())) return null;
  await btn.click();
  const d = diyalog(r.label);
  await d.waitFor({ timeout: 10_000 });
  await page.waitForTimeout(500);
  return d;
}
/** Kaydet → ayar şifresi → sonuç. */
async function kaydet(key, d, ad) {
  const t0 = Date.now();
  await d.getByRole("button", { name: "Kaydet" }).click();
  const sd = page.getByRole("dialog").filter({ hasText: "Ayar şifresi" }).first();
  let sifreSoruldu = false, sifreGor = null;
  if (await sd.waitFor({ timeout: 5_000 }).then(() => true, () => false)) {
    sifreSoruldu = true;
    sifreGor = await gor(key, `${ad}-sifre`);
    await sd.locator("#settings-password").fill(AYAR_SIFRESI);
    await sd.getByRole("button", { name: "Onayla" }).click();
  }
  const kapandi = await d.waitFor({ state: "detached", timeout: 10_000 }).then(() => true, () => false);
  let hata = null, gorsel = null;
  if (!kapandi) {
    const hataL = d.locator("p.text-destructive");
    hata = (await hataL.count()) ? (await hataL.first().textContent())?.trim() : "(diyalog kapanmadı, hata metni yok)";
    gorsel = await gor(key, `${ad}-kaydet-hata`);
  }
  await page.waitForTimeout(400);
  const toastL = page.locator("[data-sonner-toast]");
  const toast = (await toastL.count()) ? (await toastL.last().textContent())?.trim()?.slice(0, 200) : null;
  return { kapandi, hata, toast, sifreSoruldu, sifreGor, gorsel, ms: Date.now() - t0 };
}
function catismaAdaylari(r) {
  const liste = ["KK", "KS", "T", "CV", "SVK", "IE"];
  return liste.filter((p) => p !== r.prefix).slice(0, 4);
}
const yarin = () => { const d = new Date(Date.now() + 86_400_000); return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`; };

// ── sıra: en çok kullanılan 15 önce ──────────────────────────────────────────
const ONCELIK = ["roll", "workOrder", "sack", "shipment", "manifest", "packingLotCode", "packingLotName", "returnDoc", "order", "goodsReceipt", "subcontractorDispatch", "subcontractorReceipt", "kartelaDispatch", "kartelaReceipt", "invoiceSales"];
let seriler = await seriListesi();
const istenen = process.argv.slice(2);
if (istenen.length) seriler = seriler.filter((r) => istenen.includes(r.key));
seriler.sort((a, b) => (ONCELIK.indexOf(a.key) + 1 || 99) - (ONCELIK.indexOf(b.key) + 1 || 99));

const sonuc = [];
const yaz = () => fs.writeFileSync(path.join(CIKTI, "sonuc.json"), JSON.stringify({ zaman, db: ortam.dbName, pencere, seriler: sonuc, toastlar, konsol: konsol.slice(0, 80) }, null, 2));
const adim = (key, alan, deneme) => { simdikiAdim = `${key} · ${alan} · ${deneme}`; };
const kayit = (key, alan, deneme, veri) => { const s = { key, alan, deneme, ...veri }; sonuc.push(s); console.log(`${key} · ${alan} · ${deneme} → ${JSON.stringify(veri).slice(0, 260)}`); yaz(); };

for (const r0 of seriler) {
  const key = r0.key;
  try {
    adim(key, "diyalog", "aç");
    const izOnce = await parmakIzi(key);
    const tr = satir(r0.label);
    await tr.scrollIntoViewIfNeeded();
    const satirMetni = (await tr.textContent())?.replace(/\s+/g, " ").trim();
    const satirGor = await gor(key, "satir");
    const d = await ac(r0);
    if (!d) { kayit(key, "Düzenle", "düğme", { sonuc: "Düzenle PASİF", mesaj: satirMetni, gorsel: satirGor }); continue; }
    const acikGor = await gor(key, "diyalog");
    const bicimAcik = (await d.locator("#ns-prefix").count()) > 0;
    const kilitMetni = bicimAcik ? null : (await d.locator("p.rounded-md.border").first().textContent().catch(() => null))?.trim();
    const sayacAcik = (await d.locator("#ns-start").count()) > 0;
    const sayacMetni = (await d.getByText("Sayaç", { exact: true }).locator("..").textContent().catch(() => null))?.replace(/\s+/g, " ").trim().slice(0, 400);
    const kaynakVar = (await d.locator("#ns-source").count()) > 0;
    const yururlukVar = (await d.locator("#ns-effective").count()) > 0;
    kayit(key, "diyalog", "aç", { label: r0.label, satirMetni, bicimAcik, kilitMetni, sayacAcik, sayacMetni, kaynakVar, yururlukVar, gorsel: acikGor });

    if (bicimAcik) {
      const orj = { prefix: r0.prefix, ds: r0.dateSegment, digits: String(r0.digits), sep: r0.separator };
      const sifirla = async () => {
        await d.locator("#ns-prefix").fill(orj.prefix);
        await d.locator("#ns-segment").selectOption(orj.ds);
        await d.locator("#ns-digits").fill(orj.digits);
        await d.locator("#ns-sep").fill(orj.sep);
        if (await d.locator("#ns-sep2").count()) await d.locator("#ns-sep2").fill(r0.separator2 ?? "");
        await page.waitForTimeout(300);
      };
      for (const p of catismaAdaylari(r0)) {
        adim(key, "ön ek", `→ ${p}`);
        await d.locator("#ns-prefix").fill(p);
        kayit(key, "ön ek", `→ ${p} (okutulan/başka seri ön eki)`, { ...(await durumOku(d)), gorsel: await gor(key, `onek-${p}`) });
      }
      adim(key, "ön ek", "→ ZQ");
      await d.locator("#ns-prefix").fill("ZQ");
      kayit(key, "ön ek", "→ ZQ (benzersiz)", { ...(await durumOku(d)), gorsel: await gor(key, "onek-ZQ") });
      adim(key, "ön ek", "→ boş [KASITLI HATA]");
      await d.locator("#ns-prefix").fill("");
      kayit(key, "ön ek", "→ boş", { ...(await durumOku(d)), gorsel: await gor(key, "onek-bos") });
      await sifirla();
      adim(key, "tarih", "tarihsiz/YYMM");
      await d.locator("#ns-segment").selectOption(orj.ds === "NONE" ? "YYMM" : "NONE");
      kayit(key, "tarih", orj.ds === "NONE" ? "→ YYMM" : "→ Tarihsiz", { ...(await durumOku(d)), gorsel: await gor(key, "tarih") });
      adim(key, "tarih", "→ YYYYMMDD [kolon sığmayabilir]");
      await d.locator("#ns-segment").selectOption("YYYYMMDD");
      kayit(key, "tarih", "→ YYYYMMDD", { ...(await durumOku(d)), gorsel: await gor(key, "tarih2") });
      await sifirla();
      adim(key, "hane", "+1");
      await d.locator("#ns-digits").fill(String(Math.min(8, r0.digits + 1)));
      kayit(key, "hane", `→ ${Math.min(8, r0.digits + 1)}`, { ...(await durumOku(d)), gorsel: await gor(key, "hane") });
      adim(key, "hane", "→ 9 [KASITLI HATA]");
      await d.locator("#ns-digits").fill("9");
      kayit(key, "hane", "→ 9 (sınır dışı)", { ...(await durumOku(d)), gorsel: await gor(key, "hane9") });
      await sifirla();
      adim(key, "ayraç", "- ve /");
      await d.locator("#ns-sep").fill("-");
      const sep2Var = (await d.locator("#ns-sep2").count()) > 0;
      if (sep2Var) await d.locator("#ns-sep2").fill("/");
      kayit(key, "ayraç", sep2Var ? "ayraç1 '-' + ayraç2 '/'" : "ayraç1 '-' (ayraç2 alanı yok: tarihsiz)", { ...(await durumOku(d)), gorsel: await gor(key, "ayrac") });
      await sifirla();

      // GERÇEK KAYIT: ön ek ZQ + ayraç '-' → doğrula → geri al
      adim(key, "kaydet", "ZQ + -");
      await d.locator("#ns-prefix").fill("ZQ");
      await d.locator("#ns-sep").fill("-");
      const on = await durumOku(d);
      const k1 = await kaydet(key, d, "kaydet");
      const sonra = await seriSatiri(key);
      const izSonra = await parmakIzi(key);
      kayit(key, "kaydet", "ön ek ZQ + ayraç '-'", { onizleme: on.onizleme, ...k1, dbSonra: sonra, eskiNumaralarAyni: izOnce === izSonra, cizgi: await cizgiSayisi(key) });
      // geri al
      await page.waitForTimeout(800);
      adim(key, "geri al", "biçim");
      const r1 = (await seriListesi()).find((x) => x.key === key);
      const d2 = await ac(r1);
      if (d2) {
        await d2.locator("#ns-prefix").fill(orj.prefix);
        await d2.locator("#ns-sep").fill(orj.sep);
        const on2 = await durumOku(d2);
        const g2 = await gor(key, "geri-al-once");
        const k2 = on2.kaydetAcik ? await kaydet(key, d2, "geri-al") : { kapandi: false, hata: on2.hata, gorsel: g2 };
        const dbGeri = await seriSatiri(key);
        kayit(key, "geri al", `ön ek ${orj.prefix} + ayraç '${orj.sep}'`, { onizleme: on2.onizleme, ...k2, dbGeri, eskiNumaralarAyni: izOnce === (await parmakIzi(key)), cizgi: await cizgiSayisi(key) });
        await diyaloguKapat();
      }
    }

    // SAYAÇ: üst sınır → kaydet → geri al (boş)
    if (sayacAcik) {
      adim(key, "sayaç", "üst sınır");
      const d3 = await ac((await seriListesi()).find((x) => x.key === key));
      await d3.locator("#ns-max").fill("99999999");
      const on = await durumOku(d3);
      const g = await gor(key, "sayac-max");
      const k = on.kaydetAcik ? await kaydet(key, d3, "sayac") : { kapandi: false, hata: on.hata, gorsel: g };
      const db = (await sql(`SELECT "startValue","step","maxValue" FROM number_series WHERE key=$1`, [key]))[0];
      kayit(key, "sayaç", "üst sınır 99999999", { ...on, ...k, db });
      await diyaloguKapat();
      adim(key, "sayaç", "geri al");
      const d4 = await ac((await seriListesi()).find((x) => x.key === key));
      await d4.locator("#ns-max").fill("");
      const on4 = await durumOku(d4);
      const k4 = on4.kaydetAcik ? await kaydet(key, d4, "sayac-geri") : { kapandi: false, hata: on4.hata, gorsel: await gor(key, "sayac-geri") };
      const db4 = (await sql(`SELECT "startValue","step","maxValue" FROM number_series WHERE key=$1`, [key]))[0];
      kayit(key, "sayaç", "geri al (boş)", { ...on4, ...k4, db: db4 });
      await diyaloguKapat();
      adim(key, "sayaç", "adım 0");
      const d5 = await ac((await seriListesi()).find((x) => x.key === key));
      await d5.locator("#ns-start").fill("1");
      await d5.locator("#ns-step").fill("0");
      kayit(key, "sayaç", "başlangıç 1 + adım 0 (kaydetmeden)", { ...(await durumOku(d5)), gorsel: await gor(key, "sayac-adim0") });
      await diyaloguKapat();
    }

    // KAYNAK: Yalnız sistem → kaydet → geri al
    if (kaynakVar) {
      adim(key, "numara kaynağı", "değiştir");
      const orjKaynak = (await seriListesi()).find((x) => x.key === key).source.value;
      const d6 = await ac((await seriListesi()).find((x) => x.key === key));
      await d6.locator("#ns-source").click();
      await page.getByRole("option", { exact: false, name: orjKaynak === "SYSTEM" ? "Serbest (sistem üretir, elle yazılabilir)" : "Yalnız sistem" }).click();
      const on = await durumOku(d6);
      if (!on.kaydetAcik) { kayit(key, "numara kaynağı", "değiştir", { ...on, sonuc: "Kaydet PASİF", gorsel: await gor(key, "kaynak-pasif") }); await diyaloguKapat(); throw new Error("SKIP"); }
      const k = await kaydet(key, d6, "kaynak");
      const db = (await sql(`SELECT "numberSource"::text AS s FROM number_series WHERE key=$1`, [key]).catch((e) => [{ s: `HATA ${e.message}` }]))[0];
      kayit(key, "numara kaynağı", `${orjKaynak} → ${orjKaynak === "SYSTEM" ? "FREE" : "SYSTEM"}`, { ...on, ...k, db });
      await diyaloguKapat();
      adim(key, "numara kaynağı", "geri al");
      const d7 = await ac((await seriListesi()).find((x) => x.key === key));
      await d7.locator("#ns-source").click();
      await page.getByRole("option", { exact: false, name: orjKaynak === "FREE" ? "Serbest (sistem üretir, elle yazılabilir)" : orjKaynak === "SYSTEM" ? "Yalnız sistem" : "Yalnız elle" }).click();
      const k7 = await kaydet(key, d7, "kaynak-geri");
      const db7 = (await sql(`SELECT "numberSource"::text AS s FROM number_series WHERE key=$1`, [key]).catch((e) => [{ s: `HATA ${e.message}` }]))[0];
      kayit(key, "numara kaynağı", `geri al → ${orjKaynak}`, { ...k7, db: db7 });
      await diyaloguKapat();
    }

    // YÜRÜRLÜK: yarın + ön ek ZQ → kaydet → satır ölç → "hemen" ile geri dön
    if (yururlukVar) {
      adim(key, "yürürlük", "yarın + ZQ");
      const d8 = await ac((await seriListesi()).find((x) => x.key === key));
      await d8.locator("#ns-prefix").fill("ZQ");
      await d8.locator("#ns-effective").fill(yarin());
      await d8.locator("#ns-effective").press("Tab");
      const on = await durumOku(d8);
      const g = await gor(key, "yururluk");
      const k = on.kaydetAcik ? await kaydet(key, d8, "yururluk") : { kapandi: false, hata: on.hata, gorsel: g };
      const cizgiler = await sql(`SELECT prefix, "effectiveFrom" FROM number_series_lines WHERE "seriesKey"=$1 ORDER BY "effectiveFrom"`, [key]);
      const liste = (await seriListesi()).find((x) => x.key === key);
      kayit(key, "yürürlük", `yarın (${yarin()}) + ön ek ZQ`, { ...on, ...k, listeOnEk: liste.prefix, listeOnizleme: liste.preview, cizgiler });
      await diyaloguKapat();
      // geri: gelecekteki çizgi nasıl iptal edilir? Panelde yol var mı — ölç.
      adim(key, "yürürlük", "sonra diyalog");
      const d9 = await ac(liste);
      const on9 = await durumOku(d9);
      const g9 = await gor(key, "yururluk-sonra-diyalog");
      kayit(key, "yürürlük", "ileri tarihli çizgiyi geri alma yolu", { ...on9, gorsel: g9, not: "diyalogda bekleyen ileri tarihli değişiklik görünüyor mu / iptal düğmesi var mı — görüntüden okunur" });
      await diyaloguKapat();
    }
  } catch (e) {
    if (String(e?.message) === "SKIP") continue;
    kayit(key, "SÜRÜCÜ", "hata", { hata: String(e?.message ?? e).split("\n")[0].slice(0, 300), gorsel: await gor(key, "surucu-hata") });
    await diyaloguKapat();
  }
}

pencere.sonda = await app.evaluate(({ BrowserWindow, screen }) => {
  const w = BrowserWindow.getAllWindows()[0];
  const [x, y] = w.getPosition();
  const ekranda = screen.getAllDisplays().some((dp) => { const b = dp.bounds; return x < b.x + b.width && x + w.getSize()[0] > b.x && y < b.y + b.height && y + w.getSize()[1] > b.y; });
  return { x, y, visible: w.isVisible(), focused: w.isFocused(), opacity: w.getOpacity(), ekranda };
}).catch((e) => ({ hata: String(e) }));
console.log(`pencere sonda: ${JSON.stringify(pencere.sonda)}`);
await app.close().catch(() => undefined);
await pg.end().catch(() => undefined);
yaz();
console.log(`\n=== bitti → ${path.relative(ELECTRON_KOK, CIKTI)}/sonuc.json ===`);
