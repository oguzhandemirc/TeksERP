// =============================================================================
// NUMARALANDIRMA DOĞRULAMA TURU — ca'nın E1 düzeltmelerini (K1 · K2 · K3 · K5 · K10 ·
// K11) GERÇEK panelde, dört ağla (toast · ağ · konsol · backend logu) ölçer.
// Her madde ✓/✗ + görüntü + ağ kayıtları. Keşif sürücüsüyle aynı ortam/önkoşul.
//   AYAR_SIFRESI_DOSYASI=… BACKEND_LOG=… node e2e/guzergah/numara-dogrula.mjs
// =============================================================================
import { _electron as electron } from "@playwright/test";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { derlemeKapisi } from "./derleme-tazeligi.mjs";
import { hataAgiKur } from "./hata-agi.mjs";

const BURASI = path.dirname(fileURLToPath(import.meta.url));
const ELECTRON_KOK = path.resolve(BURASI, "../..");
const BACKEND_KOK = path.resolve(ELECTRON_KOK, "../Teks-Erp");
const requireBackend = createRequire(path.join(BACKEND_KOK, "package.json"));
const { Client: PgClient } = requireBackend("pg");

const ortam = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), "tekserp-e2e-env.json"), "utf-8"));
const AYAR_SIFRESI = fs.readFileSync(process.env.AYAR_SIFRESI_DOSYASI, "utf-8").trim();
const MAIN_JS = path.join(ELECTRON_KOK, "out/main/main.js");
derlemeKapisi(ELECTRON_KOK); // bayat `out/` eski paneli ölçer — tur başlamaz
const ELECTRON_DIST = path.join(ELECTRON_KOK, "node_modules/electron");
const ELECTRON_BIN = path.join(ELECTRON_DIST, "dist", fs.readFileSync(path.join(ELECTRON_DIST, "path.txt"), "utf-8").trim());

const zaman = new Date().toISOString().replace(/[:.]/g, "-");
const CIKTI = path.join(BURASI, "out", `dogrula-${zaman}`);
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

// ── HATA AĞI: toast · ağ · konsol · backend logu (ortak modül) ──
const ag = await hataAgiKur({ app, page, cikti: CIKTI, backendLog: process.env.BACKEND_LOG, apiUrl: ortam.apiUrl });
ag.adim("giriş + Numaralandırma sayfası");

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


const sonuc = [];
const yaz = () => fs.writeFileSync(path.join(CIKTI, "sonuc.json"), JSON.stringify({ zaman, db: ortam.dbName, pencere, maddeler: sonuc }, null, 2));
/** Adımın ağ kayıtları: toast · beyansız 4xx/5xx · konsol hatası. */
const agKayitlari = (ad) => ({
  toast: ag.kayitlar.toast.filter((x) => x.adim === ad).map((x) => `[${x.tur}] ${x.metin.slice(0, 140)} (${x.gorsel})`),
  ag: ag.kayitlar.ag.filter((x) => x.adim === ad).map((x) => `${x.status} ${x.yontem} ${x.url} ${x.beklenen ? "(beyanlı)" : ""} — ${x.mesaj ?? ""}`),
  konsol: ag.kayitlar.konsol.filter((x) => x.adim === ad && !x.agYansimasi && x.tur !== "warning").map((x) => x.metin.slice(0, 160)),
});
async function madde(kod, ad, fn) {
  const adimAdi = `${kod} · ${ad}`;
  ag.adim(adimAdi);
  const k = { kod, ad, sonuc: "✗", olcum: {}, gorsel: [] };
  try {
    const r = await fn(k);
    k.sonuc = r === true ? "✓" : "✗";
  } catch (e) {
    k.hata = String(e?.message ?? e).split("\n")[0].slice(0, 300);
    k.gorsel.push(await gor(kod, "hata"));
  }
  await diyaloguKapat();
  await page.waitForTimeout(800);
  k.ag = agKayitlari(adimAdi);
  sonuc.push(k); yaz();
  console.log(`${k.sonuc} ${kod} · ${ad}${k.hata ? ` — ${k.hata}` : ""}`);
  console.log(`   ölçüm: ${JSON.stringify(k.olcum).slice(0, 600)}`);
  if (k.ag.toast.length || k.ag.ag.length || k.ag.konsol.length) console.log(`   ağ: ${JSON.stringify(k.ag).slice(0, 600)}`);
  return k;
}
const seri = async (key) => (await seriListesi()).find((x) => x.key === key);
const JARGON = /Faz [A-Z]|damga|sınıflandırma|`|Tx\b|kapsam|RollBarcodeCounter|readLast|format[A-Z]|INSERT|ON CONFLICT/;

// ── K11: aç/kapat zinciri — hiçbir toast ve beyansız 4xx olmamalı ─────────────
await madde("K11", "12 seri art arda aç/kapat (okutulan + okutulmayan karışık)", async (k) => {
  const zincir = ["kartelaReceipt", "sack", "manifest", "workOrder", "shipment", "packingLotCode", "subcontractorDispatch", "swatch", "subcontractorReceipt", "kartelaDispatch", "returnDoc", "order", "kartelaReceipt", "sack"];
  const liste = await seriListesi();
  k.olcum.acilan = [];
  for (const key of zincir) {
    const r = liste.find((x) => x.key === key);
    const d = await ac(r);
    if (!d) { k.olcum.acilan.push(`${key}: Düzenle pasif`); continue; }
    const on = await durumOku(d);
    k.olcum.acilan.push(`${key}: örnek=${on.onizleme} hata=${on.hata ?? "-"}`);
    if (on.hata) k.gorsel.push(await gor(key, "k11-hata"));
    await diyaloguKapat();
  }
  k.gorsel.push(await gor("K11", "son"));
  await page.waitForTimeout(1200);
  const a = agKayitlari("K11 · 12 seri art arda aç/kapat (okutulan + okutulmayan karışık)");
  const diyalogHatasi = k.olcum.acilan.filter((x) => !/hata=-$/.test(x) && !/pasif/.test(x));
  k.olcum.diyalogHatasi = diyalogHatasi;
  // Ölçüt: HATA toast'ı ve BEYANSIZ 4xx yok (başarı toast'ı ve şifre protokolü sayılmaz).
  return a.toast.filter((t) => /^\[error\]/.test(t)).length === 0 && a.ag.filter((x) => !/\(beyanlı\)/.test(x)).length === 0 && diyalogHatasi.length === 0;
});

// ── K1: iş emri — sayaç ve kaynak kaydedilir, toast yok ──────────────────────
await madde("K1", "iş emri: açılış + tuş vuruşu toast'sız · sayaç ve kaynak kaydedilir · geri alınır", async (k) => {
  const d = await ac(await seri("workOrder"));
  await page.waitForTimeout(800);
  k.gorsel.push(await gor("workOrder", "k1-acilis"));
  await d.locator("#ns-max").pressSequentially("99999999", { delay: 40 });
  const on = await durumOku(d);
  k.olcum.kaydetAcik = on.kaydetAcik; k.olcum.hata = on.hata;
  k.gorsel.push(await gor("workOrder", "k1-yazdi"));
  const s1 = on.kaydetAcik ? await kaydet("workOrder", d, "k1-sayac") : { kapandi: false };
  k.olcum.sayacKaydet = s1.kapandi;
  k.olcum.dbMax = (await sql(`SELECT "maxValue" FROM number_series WHERE key='workOrder'`))[0].maxValue;
  const d2 = await ac(await seri("workOrder"));
  await d2.locator("#ns-max").fill("");
  const s2 = (await durumOku(d2)).kaydetAcik ? await kaydet("workOrder", d2, "k1-sayac-geri") : { kapandi: false };
  k.olcum.sayacGeri = s2.kapandi;
  k.olcum.dbMaxGeri = (await sql(`SELECT "maxValue" FROM number_series WHERE key='workOrder'`))[0].maxValue;
  const orj = (await seri("workOrder")).source.value;
  const hedef = orj === "SYSTEM" ? "FREE" : "SYSTEM";
  const ad = { FREE: "Serbest (sistem üretir, elle yazılabilir)", SYSTEM: "Yalnız sistem", MANUAL: "Yalnız elle" };
  const d3 = await ac(await seri("workOrder"));
  await d3.locator("#ns-source").click(); await page.getByRole("option", { name: ad[hedef] }).click();
  const s3 = await kaydet("workOrder", d3, "k1-kaynak");
  k.olcum.kaynakDb = (await sql(`SELECT "numberSource"::text s FROM number_series WHERE key='workOrder'`))[0].s;
  const d4 = await ac(await seri("workOrder"));
  await d4.locator("#ns-source").click(); await page.getByRole("option", { name: ad[orj] }).click();
  await kaydet("workOrder", d4, "k1-kaynak-geri");
  k.olcum.kaynakGeriDb = (await sql(`SELECT "numberSource"::text s FROM number_series WHERE key='workOrder'`))[0].s;
  const a = agKayitlari("K1 · iş emri: açılış + tuş vuruşu toast'sız · sayaç ve kaynak kaydedilir · geri alınır");
  return s1.kapandi && Number(k.olcum.dbMax) === 99999999 && s2.kapandi && k.olcum.dbMaxGeri === null
    && s3.kapandi && k.olcum.kaynakDb === hedef && k.olcum.kaynakGeriDb === orj && a.toast.filter((t) => /\[error\]/.test(t)).length === 0 && a.ag.filter((x) => !/\(beyanlı\)/.test(x)).length === 0;
});

// ── K2: kilit rozeti · diyalog cümlesi · açılma koşulu aynı, jargon yok ───────
await madde("K2", "kilit metinleri: satır ↔ diyalog tutarlı, jargon yok (52 seri)", async (k) => {
  const liste = await seriListesi();
  k.olcum.celiski = []; k.olcum.jargon = []; k.olcum.ornekler = {};
  for (const r of liste) {
    if (!r.lockKind) continue;
    const tr = satir(r.label);
    await tr.scrollIntoViewIfNeeded();
    const satirMetni = (await tr.locator("td").first().textContent())?.replace(/\s+/g, " ").trim() ?? "";
    let diyalogMetni = null;
    const d = await ac(r);
    if (d) {
      diyalogMetni = (await d.textContent())?.replace(/\s+/g, " ").trim() ?? "";
      if (["workOrder", "manifest", "sack"].includes(r.key)) k.gorsel.push(await gor(r.key, "k2-diyalog"));
      await diyaloguKapat();
    }
    const sunucu = r.lockedReason ?? "";
    if (JARGON.test(satirMetni) || JARGON.test(sunucu) || (diyalogMetni && JARGON.test(diyalogMetni))) k.olcum.jargon.push(`${r.key}: ${(satirMetni + " || " + sunucu).match(JARGON)?.[0] ?? (diyalogMetni ?? "").match(JARGON)?.[0]}`);
    if (diyalogMetni && sunucu && !diyalogMetni.includes(sunucu.slice(0, 40))) k.olcum.celiski.push(`${r.key}: diyalog sunucu cümlesini taşımıyor`);
    if (["workOrder", "manifest", "sack", "roll"].includes(r.key)) k.olcum.ornekler[r.key] = { satir: satirMetni.slice(0, 200), sunucu: sunucu.slice(0, 200) };
  }
  return k.olcum.celiski.length === 0 && k.olcum.jargon.length === 0;
});

// ── K5: hane 9 / boş ön ek → alan altında Türkçe hata, global toast yok, örnek "—" ─
for (const [deneme, yap] of [["hane 9", async (d) => d.locator("#ns-digits").fill("9")], ["ön ek boş", async (d) => d.locator("#ns-prefix").fill("")]]) {
  await madde("K5", `sevk partisi kodu: ${deneme}`, async (k) => {
    ag.beklenen({ status: 400, url: /\/api\/number-series\/preview$/ });
    const d = await ac(await seri("packingLotCode"));
    await yap(d);
    const on = await durumOku(d);
    k.olcum = on;
    k.gorsel.push(await gor("packingLotCode", `k5-${deneme.replace(/\s/g, "")}`));
    const a = agKayitlari(`K5 · sevk partisi kodu: ${deneme}`);
    const turkce = on.hata && !/beklenen|number|string|Validasyon/i.test(on.hata);
    return Boolean(turkce) && on.onizleme === "—" && a.toast.length === 0 && on.kaydetAcik === false;
  });
}

// ── K10: sayaç değer kuralları ───────────────────────────────────────────────
for (const [deneme, alan, deger, ek] of [["adım 0", "#ns-step", "0", null], ["başlangıç 0", "#ns-start", "0", null], ["sınır < başlangıç", "#ns-start", "500", ["#ns-max", "100"]]]) {
  await madde("K10", `çeki listesi sayacı: ${deneme}`, async (k) => {
    const d = await ac(await seri("manifest"));
    await d.locator(alan).fill(deger);
    if (ek) await d.locator(ek[0]).fill(ek[1]);
    const on = await durumOku(d);
    const alanHatasi = await d.locator(`${alan} ~ p.text-destructive, ${alan} + p.text-destructive`).count().catch(() => 0);
    const tumHata = await d.locator("p.text-destructive").allTextContents();
    k.olcum = { ...on, alanHatasi, tumHata };
    k.gorsel.push(await gor("manifest", `k10-${deneme.replace(/[\s<]/g, "")}`));
    return on.kaydetAcik === false && tumHata.length > 0;
  });
}

// ── K3 (kısmi): kilitli seride biçim alanları görünür ama pasif ──────────────
await madde("K3", "kilitli seri (çeki listesi, çuval): biçim alanları görünür + pasif", async (k) => {
  const out = {};
  for (const key of ["manifest", "sack", "invoiceSales"]) {
    const d = await ac(await seri(key));
    const alanlar = {};
    for (const id of ["#ns-prefix", "#ns-segment", "#ns-digits", "#ns-sep"]) {
      const l = d.locator(id);
      alanlar[id] = (await l.count()) ? ((await l.isDisabled()) ? "pasif" : "AÇIK") : "YOK";
    }
    out[key] = alanlar;
    k.gorsel.push(await gor(key, "k3"));
    await diyaloguKapat();
  }
  k.olcum = out;
  return Object.values(out).every((a) => Object.values(a).every((v) => v === "pasif"));
});

const agOzet = ag.rapor();
console.log(`hata ağı: ${JSON.stringify(agOzet)}`);
await app.close().catch(() => undefined);
await pg.end().catch(() => undefined);
yaz();
console.log(`\n=== bitti → ${path.relative(ELECTRON_KOK, CIKTI)}/sonuc.json ===`);
