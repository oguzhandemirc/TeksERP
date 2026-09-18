// =============================================================================
// GÜZERGÂH SÜRÜCÜSÜ — kullanıcı testi adımlarını GERÇEK Electron panelinde koşar
// =============================================================================
// Koşum (Electron/ içinden):
//   node e2e/guzergah/guzergah.mjs            # bütün adımlar
//   node e2e/guzergah/guzergah.mjs A1 B1 C1   # seçili adımlar (güzergâh id'leri)
//
// Ön koşul (Teks-Erp/ içinden): `npx tsx scripts/e2e-ortam.ts kur` bir kez,
// `npx tsx scripts/e2e-ortam.ts sunucu` ayrı bir terminalde. Sürücü ortam
// dosyasını `${os.tmpdir()}/tekserp-e2e-env.json`den okur; kullanıcının
// 4000/Electron'una DOKUNMAZ: ayrı `--user-data-dir`, panelin varsayılan
// `localhost:4000` istekleri `page.route` ile E2E backend'ine yeniden yazılır
// (build'e dokunulmaz, ayar yazılmaz).
//
// Adımlar TEK dosyada: `adimlar.mjs` (id · rol · yol · yap · bekle · dogrula).
// Rol değişince uygulama YENİDEN başlatılır (sade: oturum karışmaz, çıkış
// yolu aranmaz). Sistem hesabı (rol S) parolası `e2e-ortam.ts sistem-hesabi`
// alt komutundan stdout ile alınır ve YALNIZ bellekte tutulur — sonuç dosyasına,
// ekran görüntüsü adına, log'a yazılmaz.
//
// Çıktı: `e2e/guzergah/out/<zaman>/sonuc.json` + adım başına PNG. Her adımın
// sonucu ÜÇ değerlidir: yesil · kirmizi · atlandi (ön koşulu düşen adım
// "kırmızı" değil "atlandı"dır ve sebebi yazılır — "ölçemedim" ile "bozuk"
// aynı satıra düşmez).
// =============================================================================
import { _electron as electron } from "@playwright/test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ADIMLAR } from "./adimlar.mjs";

const BURASI = path.dirname(fileURLToPath(import.meta.url));
const ELECTRON_KOK = path.resolve(BURASI, "../..");
const BACKEND_KOK = path.resolve(ELECTRON_KOK, "../Teks-Erp");
// `pg` backend'in KENDİ bağımlılığıdır — Electron'a yeni paket eklenmez.
const requireBackend = createRequire(path.join(BACKEND_KOK, "package.json"));
const { Client: PgClient } = requireBackend("pg");

const ORTAM_DOSYASI = path.join(os.tmpdir(), "tekserp-e2e-env.json");
const PANEL_VARSAYILAN_API = "http://localhost:4000/";
const ADIM_ZAMAN_ASIMI_MS = 60_000;

function dur(mesaj) {
  console.error(`⛔ ${mesaj}`);
  process.exit(2);
}

// ── ortam ────────────────────────────────────────────────────────────────────
if (!fs.existsSync(ORTAM_DOSYASI)) dur(`ortam dosyası yok: ${ORTAM_DOSYASI} — önce \`npx tsx scripts/e2e-ortam.ts kur\``);
const ortam = JSON.parse(fs.readFileSync(ORTAM_DOSYASI, "utf-8"));
const MAIN_JS = path.join(ELECTRON_KOK, "out/main/main.js");
if (!fs.existsSync(MAIN_JS)) dur(`${MAIN_JS} yok — önce \`npx electron-vite build\``);
// Electron ikilisi AÇIKÇA bu ağacın node_modules'ünden — Playwright'ın kendi
// çözümlemesi cwd'ye göre başka bir ağaca (ya da indirmeye) kayabiliyor.
const ELECTRON_DIST = path.join(ELECTRON_KOK, "node_modules/electron");
const ELECTRON_BIN = fs.existsSync(path.join(ELECTRON_DIST, "path.txt"))
  ? path.join(ELECTRON_DIST, "dist", fs.readFileSync(path.join(ELECTRON_DIST, "path.txt"), "utf-8").trim())
  : null;
if (!ELECTRON_BIN || !fs.existsSync(ELECTRON_BIN)) dur(`Electron ikilisi yok: ${ELECTRON_DIST}/dist — \`node node_modules/electron/install.js\``);

const saglik = await fetch(`${ortam.apiUrl}/health`).then((r) => r.json()).catch(() => null);
if (!saglik || saglik.db !== "UP") dur(`E2E backend ayakta değil: ${ortam.apiUrl} — \`npx tsx scripts/e2e-ortam.ts sunucu\``);

const istenen = process.argv.slice(2);
const secili = istenen.length ? ADIMLAR.filter((a) => istenen.includes(a.id)) : ADIMLAR;
const bilinmeyen = istenen.filter((id) => !ADIMLAR.some((a) => a.id === id));
if (bilinmeyen.length) dur(`bilinmeyen adım id: ${bilinmeyen.join(", ")}`);
if (secili.length === 0) dur("koşacak adım yok");

// Rol → kullanıcı. S (sistem hesabı) yalnız gerekiyorsa ve yalnız belleğe.
const KULLANICI = {
  P: ortam.kullanicilar.yonetici,
  M: ortam.kullanicilar.muhasebe,
  T: ortam.kullanicilar.operator,
  S: null,
};
if (secili.some((a) => a.rol === "S")) {
  const r = spawnSync("npx", ["tsx", "scripts/e2e-ortam.ts", "sistem-hesabi"], { cwd: BACKEND_KOK, encoding: "utf-8" });
  if (r.status !== 0) dur(`sistem hesabı kurulamadı: ${r.stderr?.slice(-400)}`);
  const satir = r.stdout.trim().split("\n").pop();
  KULLANICI.S = JSON.parse(satir);
}

// ── çıktı ────────────────────────────────────────────────────────────────────
const zaman = new Date().toISOString().replace(/[:.]/g, "-");
const CIKTI = path.join(BURASI, "out", zaman);
fs.mkdirSync(CIKTI, { recursive: true });
const sonuclar = [];

// ── DB / API yardımcıları ────────────────────────────────────────────────────
const pg = new PgClient({ connectionString: ortam.dbUrl.replace(/\?schema=public$/, "") });
await pg.connect();
const sql = async (q, params = []) => (await pg.query(q, params)).rows;

const apiToken = new Map(); // rol → Bearer (doğrulama çağrıları için ayrı WEB oturumu)
async function apiGiris(rol) {
  if (apiToken.has(rol)) return apiToken.get(rol);
  const k = KULLANICI[rol];
  const r = await fetch(`${ortam.apiUrl}/api/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: k.username, password: k.password, clientType: "web" }),
  });
  const j = await r.json();
  if (!j?.data?.token) throw new Error(`API girişi başarısız (${rol}): ${r.status} ${j?.message ?? ""}`);
  apiToken.set(rol, j.data.token);
  return j.data.token;
}
async function api(rol, yol, init = {}) {
  const token = await apiGiris(rol);
  const r = await fetch(`${ortam.apiUrl}${yol}`, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) } });
  const govde = await r.json().catch(() => null);
  return { status: r.status, govde };
}

// ── Electron oturumu (rol başına bir uygulama) ───────────────────────────────
let app = null, page = null, acikRol = null;
async function uygulamayiKapat() {
  if (app) await app.close().catch(() => undefined);
  app = null; page = null; acikRol = null;
}
async function rolIleAc(rol) {
  if (acikRol === rol && page) return;
  await uygulamayiKapat();
  const udd = fs.mkdtempSync(path.join(os.tmpdir(), "tekserp-e2e-udd-"));
  app = await electron.launch({ executablePath: ELECTRON_BIN, args: [MAIN_JS, `--user-data-dir=${udd}`], env: { ...process.env, APP_ENV: "development" }, timeout: 60_000 });
  page = await app.firstWindow();
  page.on("pageerror", (e) => konsol.push(`[pageerror] ${String(e).slice(0, 300)}`));
  page.on("console", (m) => { if (m.type() === "error") konsol.push(`[console.error] ${m.text().slice(0, 300)}`); });
  // ⚠️ KULLANICININ 4000'İNE TEK İSTEK GİTMEZ: `page.route` yeniden yazımı
  // üretim build'inde (file:// renderer) TUTMADI (ölçüldü 2026-09-18: login
  // isteği 4000'e gitti, 401). Bu yüzden `localhost:4000`e giden HER istek
  // ENGELLENİR ve sunucu adresi, insanın yaptığı gibi, giriş ekranındaki
  // "Sunucu adresi ayarları" diyaloğundan E2E backend'ine ÇEVRİLİR.
  await page.route(`${PANEL_VARSAYILAN_API}**`, (route) => route.abort("blockedbyclient"));
  const k = KULLANICI[rol];
  await page.getByPlaceholder("ör. admin").waitFor({ timeout: 40_000 });
  await sunucuAdresiniAyarla();
  await page.getByPlaceholder("ör. admin").fill(k.username);
  await page.locator('input[type="password"]').first().fill(k.password);
  await page.keyboard.press("Enter");
  // Giriş bitti mi: login formu kaybolur.
  await page.getByPlaceholder("ör. admin").waitFor({ state: "detached", timeout: 30_000 });
  await page.waitForTimeout(800);
  // Taze profilde ilk açılış "Bu güncellemede neler değişti" diyaloğu — insan Tamam'a basar.
  const surumNotu = page.getByRole("dialog").filter({ hasText: "Bu güncellemede neler değişti" });
  if (await surumNotu.count()) {
    await surumNotu.getByRole("button", { name: "Tamam" }).click({ timeout: 10_000 }).catch(() => undefined);
    await surumNotu.waitFor({ state: "detached", timeout: 10_000 }).catch(() => undefined);
  }
  acikRol = rol;
}
const konsol = [];

/** Giriş ekranı ⚙ → "Sunucu Adresi" diyaloğu: host/port'u E2E backend'ine çevir, kaydet. */
async function sunucuAdresiniAyarla() {
  const u = new URL(ortam.apiUrl);
  await page.getByRole("button", { name: "Sunucu adresi ayarları" }).click({ timeout: 15_000 });
  const d = page.getByRole("dialog").filter({ hasText: "Sunucu Adresi" }).first();
  await d.waitFor({ timeout: 15_000 });
  await d.locator("#api-host").fill(u.hostname);
  await d.locator("#api-port").fill(u.port);
  await d.getByRole("button", { name: "Kaydet", exact: true }).click({ timeout: 15_000 });
  await d.waitFor({ state: "detached", timeout: 15_000 });
  await page.waitForTimeout(400);
}

// ── BEŞ FİİL — adım dosyasının kullandığı sade sözlük ────────────────────────
function fiiller() {
  return {
    /** Sayfaya git — komut paletiyle (⌘K), insanın "Ara veya komut…" kutusuna
     *  sayfa adını yazması gibi. Hash'e yazmak TUTMAZ: içerik rotaları sekme
     *  başına ayrı bir MemoryRouter'da yaşar (ölçüldü 2026-09-18). */
    git: async (sayfaAdi) => {
      const kutu = page.getByPlaceholder("Sayfa, rapor, ayar ara...");
      const acici = page.getByText("Ara veya komut", { exact: false }).first();
      if (await acici.count()) await acici.click({ timeout: 10_000 }); else await page.keyboard.press("Meta+k");
      await kutu.waitFor({ timeout: 10_000 });
      await kutu.fill(sayfaAdi);
      await page.waitForTimeout(500);
      const aday = page.getByRole("option", { name: sayfaAdi, exact: true }).first();
      if (await aday.count()) await aday.click({ timeout: 10_000 }); else await page.keyboard.press("Enter");
      await kutu.waitFor({ state: "detached", timeout: 10_000 }).catch(() => undefined);
      await page.waitForTimeout(800);
    },
    /** Düğme/menü/satır tıkla — önce erişilebilir ad, olmazsa görünen metin. */
    tikla: async (ad, secenek = {}) => {
      const rol = secenek.rol ?? "button";
      const kapsam = secenek.icinde ?? page;
      const hedef = kapsam.getByRole(rol, { name: ad, exact: secenek.exact ?? false });
      if (await hedef.count()) return hedef.first().click({ timeout: 15_000 });
      return kapsam.getByText(ad, { exact: secenek.exact ?? false }).first().click({ timeout: 15_000 });
    },
    /** Etiketli alana yaz (label → input); `icinde` ile diyalog daraltılır. */
    yaz: async (etiket, deger, secenek = {}) => {
      const kapsam = secenek.icinde ?? page;
      const alan = typeof etiket === "string" ? kapsam.getByLabel(etiket, { exact: secenek.exact ?? false }).first() : etiket;
      await alan.fill(String(deger), { timeout: 15_000 });
    },
    /** shadcn Select: tetikleyiciyi aç, seçeneği tıkla. */
    sec: async (tetikleyici, secenekMetni) => {
      await tetikleyici.click({ timeout: 15_000 });
      await page.getByRole("option", { name: secenekMetni }).first().click({ timeout: 15_000 });
    },
    /** Görünür mü — "Bekle" satırının makine karşılığı. */
    gor: async (metinVeyaLocator, secenek = {}) => {
      const l = typeof metinVeyaLocator === "string" ? page.getByText(metinVeyaLocator, { exact: secenek.exact ?? false }).first() : metinVeyaLocator;
      await l.waitFor({ state: "visible", timeout: secenek.sure ?? 15_000 });
      return l;
    },
    diyalog: (baslik) => page.getByRole("dialog").filter({ hasText: baslik }).first(),
    bekle: (ms) => page.waitForTimeout(ms),
    page: () => page,
  };
}

// ── koşum ────────────────────────────────────────────────────────────────────
const ATLANDI = new Set(); // ön koşulu düşen adımlar zinciri
for (const adim of secili) {
  const t0 = Date.now();
  const kayit = { id: adim.id, rol: adim.rol, yol: adim.yol, durum: "kirmizi", sure_ms: 0, dogrulama: [], hata: null, ekran: null };
  const onKosulEksik = (adim.gerektirir ?? []).filter((g) => ATLANDI.has(g) || sonuclar.find((s) => s.id === g)?.durum === "kirmizi");
  if (onKosulEksik.length) {
    kayit.durum = "atlandi"; kayit.hata = `ön koşul düştü: ${onKosulEksik.join(", ")}`;
    ATLANDI.add(adim.id); sonuclar.push(kayit);
    console.log(`⏭  ${adim.id} atlandı — ${kayit.hata}`);
    continue;
  }
  try {
    await rolIleAc(adim.rol);
    const f = fiiller();
    const ctx = { ...f, api: (yol, init) => api(adim.rol === "S" ? "P" : adim.rol, yol, init), sql, ortam, kullanici: KULLANICI[adim.rol] };
    await Promise.race([
      (async () => { await adim.yap(ctx); await adim.bekle?.(ctx); })(),
      new Promise((_, rej) => setTimeout(() => rej(new Error(`adım ${ADIM_ZAMAN_ASIMI_MS / 1000} sn'de bitmedi`)), ADIM_ZAMAN_ASIMI_MS)),
    ]);
    // Backend doğrulaması — her satır {ad, ok, beklenen, gorulen}.
    for (const d of adim.dogrula ?? []) {
      const satir = { ad: d.ad, ok: false, beklenen: String(d.beklenen), gorulen: null };
      try {
        const gorulen = d.sql ? await sql(d.sql, d.params ?? []) : (await api(adim.rol === "S" ? "P" : adim.rol, d.uc)).govde;
        const deger = d.oku ? d.oku(gorulen) : gorulen;
        satir.gorulen = typeof deger === "object" ? JSON.stringify(deger).slice(0, 200) : String(deger);
        satir.ok = typeof d.beklenen === "function" ? Boolean(d.beklenen(deger)) : deger === d.beklenen || String(deger) === String(d.beklenen);
      } catch (e) { satir.gorulen = `HATA: ${String(e).slice(0, 200)}`; }
      kayit.dogrulama.push(satir);
    }
    kayit.durum = kayit.dogrulama.every((d) => d.ok) ? "yesil" : "kirmizi";
    if (kayit.durum === "kirmizi") kayit.hata = "backend doğrulaması tutmadı";
  } catch (e) {
    kayit.hata = String(e?.message ?? e).split("\n")[0].slice(0, 400);
    ATLANDI.add(adim.id);
  } finally {
    kayit.sure_ms = Date.now() - t0;
    if (page) {
      kayit.ekran = `${adim.id}.png`;
      await page.screenshot({ path: path.join(CIKTI, kayit.ekran), fullPage: false }).catch(() => undefined);
    }
    sonuclar.push(kayit);
    const isaret = kayit.durum === "yesil" ? "✅" : kayit.durum === "atlandi" ? "⏭ " : "❌";
    console.log(`${isaret} ${adim.id} · ${adim.rol} · ${adim.yol}  (${(kayit.sure_ms / 1000).toFixed(1)} sn)${kayit.hata ? ` — ${kayit.hata}` : ""}`);
    for (const d of kayit.dogrulama) console.log(`     ${d.ok ? "✓" : "✗"} ${d.ad}: beklenen ${d.beklenen} · görülen ${d.gorulen}`);
  }
}

await uygulamayiKapat();
await pg.end().catch(() => undefined);

const ozet = {
  yesil: sonuclar.filter((s) => s.durum === "yesil").length,
  kirmizi: sonuclar.filter((s) => s.durum === "kirmizi").length,
  atlandi: sonuclar.filter((s) => s.durum === "atlandi").length,
};
fs.writeFileSync(path.join(CIKTI, "sonuc.json"), JSON.stringify({ zaman, api: ortam.apiUrl, db: ortam.dbName, ozet, adimlar: sonuclar, konsolHatalari: konsol.slice(0, 50) }, null, 2));
console.log(`\n=== Sonuç: ${ozet.yesil} yeşil · ${ozet.kirmizi} kırmızı · ${ozet.atlandi} atlandı → ${path.relative(ELECTRON_KOK, CIKTI)}/sonuc.json ===`);
process.exit(ozet.kirmizi > 0 ? 1 : 0);
