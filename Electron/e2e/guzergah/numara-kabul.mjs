// =============================================================================
// NUMARALANDIRMA KABUL TURU (E5) — açık her seride: panelden biçimi değiştir →
// o seriden GERÇEK bir kayıt aç → yeni numara ekranda · belgede · (okutulansa)
// okutmada aynı mı → eski kayıt hâlâ bulunuyor mu → geri al → eski numaralar
// DB'de bayt bayt aynı mı. Kapsam KATALOGDAN keşfedilir (`editable`); kaydı
// açma yolu aşağıdaki ACICILAR tablosunda yoksa seri "ÖLÇÜLMEDİ" raporlanır —
// ca'nın dilimleri indikçe yeni seri tabloya eklenir, sürücü kendiliğinden kapsar.
//   AYAR_SIFRESI_DOSYASI=… BACKEND_LOG=… node e2e/guzergah/numara-kabul.mjs [seriKey …]
// Tablet: adb yok → ÖLÇÜLMEDİ; tablet adımları rapora liste olarak yazılır.
// =============================================================================
import { _electron as electron } from "@playwright/test";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { hataAgiKur } from "./hata-agi.mjs";
import { acicilarKur } from "./numara-acicilar.mjs";

const BURASI = path.dirname(fileURLToPath(import.meta.url));
const ELECTRON_KOK = path.resolve(BURASI, "../..");
const BACKEND_KOK = path.resolve(ELECTRON_KOK, "../Teks-Erp");
const requireBackend = createRequire(path.join(BACKEND_KOK, "package.json"));
const { Client: PgClient } = requireBackend("pg");

const ortam = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), "tekserp-e2e-env.json"), "utf-8"));
const AYAR_SIFRESI = fs.readFileSync(process.env.AYAR_SIFRESI_DOSYASI, "utf-8").trim();
const MAIN_JS = path.join(ELECTRON_KOK, "out/main/main.js");
const ELECTRON_DIST = path.join(ELECTRON_KOK, "node_modules/electron");
const ELECTRON_BIN = path.join(ELECTRON_DIST, "dist", fs.readFileSync(path.join(ELECTRON_DIST, "path.txt"), "utf-8").trim());

const zaman = new Date().toISOString().replace(/[:.]/g, "-");
const CIKTI = path.join(BURASI, "out", `kabul-${zaman}`);
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
  // İki kutu (K19): "Biçim örneği" (şekil, hep sıra 1) · "Sıradaki numara" (gerçek sonraki kayıt).
  const kutu = async (etiket) => (await d.locator("div.rounded-md", { has: page.getByText(etiket, { exact: true }) }).locator(".font-mono").first().textContent().catch(() => null))?.trim() ?? null;
  const onizleme = await kutu("Biçim örneği");
  const siradaki = await kutu("Sıradaki numara");
  const hataL = d.locator("p.text-destructive");
  const hata = (await hataL.count()) ? (await hataL.first().textContent())?.trim() : null;
  const kaydetAcik = await d.getByRole("button", { name: "Kaydet" }).isEnabled().catch(() => null);
  return { onizleme, siradaki, hata, kaydetAcik };
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
const yaz = () => fs.writeFileSync(path.join(CIKTI, "sonuc.json"), JSON.stringify({ zaman, db: ortam.dbName, pencere, seriler: sonuc }, null, 2));
const agKayitlari = (ad) => ({
  toast: ag.kayitlar.toast.filter((x) => x.adim.startsWith(ad) && x.tur === "error").map((x) => `${x.metin.slice(0, 140)} (${x.gorsel})`),
  ag: ag.kayitlar.ag.filter((x) => x.adim.startsWith(ad) && !x.beklenen).map((x) => `${x.status} ${x.yontem} ${x.url} — ${x.mesaj ?? ""}`),
  konsol: ag.kayitlar.konsol.filter((x) => x.adim.startsWith(ad) && !x.agYansimasi && x.tur !== "warning").map((x) => x.metin.slice(0, 160)),
});
const sifreBasligi = { "x-settings-password": AYAR_SIFRESI };
const seri = async (key) => (await seriListesi()).find((x) => x.key === key);

/** Eski numaralar bayt bayt aynı mı: tur başından ÖNCE doğmuş satırların numara kolonu özeti. */
async function eskiParmakIzi(t, sinir) {
  const [r] = await sql(`SELECT count(*)::int n, md5(coalesce(string_agg(coalesce("${t.kolon}"::text,''), ',' ORDER BY id), '')) h FROM "${t.tablo}" WHERE "createdAt" < $1`, [sinir]);
  return `${r.n}:${r.h}`;
}

/** Panel: Numaralandırma → seri → Düzenle → biçim alanları → Kaydet (+ayar şifresi). */
async function bicimYaz(key, alanlar, etiket) {
  await numaralandirmayaGit();
  const d = await ac(await seri(key));
  if (!d) throw new Error("Düzenle pasif");
  if (alanlar.prefix !== undefined) await d.locator("#ns-prefix").fill(alanlar.prefix);
  if (alanlar.dateSegment !== undefined) await d.locator("#ns-segment").selectOption(alanlar.dateSegment);
  if (alanlar.digits !== undefined) await d.locator("#ns-digits").fill(String(alanlar.digits));
  if (alanlar.separator !== undefined) await d.locator("#ns-sep").fill(alanlar.separator);
  if (alanlar.separator2 !== undefined && (await d.locator("#ns-sep2").count())) await d.locator("#ns-sep2").fill(alanlar.separator2 ?? "");
  if (alanlar.effectiveFrom) { await d.locator("#ns-effective").fill(alanlar.effectiveFrom); await d.locator("#ns-effective").press("Tab"); }
  const on = await durumOku(d);
  // Hedef biçim zaten kayıtlıysa Kaydet pasiftir (değişiklik yok) — tıklanmaz, "zaten yerinde" döner.
  if (on.kaydetAcik === false && !on.hata) { await diyaloguKapat(); return { onizleme: on.onizleme, siradaki: on.siradaki, kapandi: true, degisiklikYok: true }; }
  const k = await kaydet(key, d, etiket);
  return { onizleme: on.onizleme, siradaki: on.siradaki, hata: on.hata, ...k };
}

// ── KAYIT AÇICILAR — seri → kaydı açma yolu · ekran · belge · okutma · eski kayıt ─────────
// Kaynak: panel/servis haritası (2026-09-23). `okutulur:false` → okutma adımı "uygulanmaz".
const bayrakYaz = async (govde) => api("/api/feature-flags", { method: "PATCH", headers: sifreBasligi, body: JSON.stringify(govde) });
async function sevkPartisiHazirla(dur) {
  const f = (await api("/api/feature-flags")).govde?.data ?? {};
  dur.bayrakOnce = { packingGroupsEnabled: f.packingGroupsEnabled, packingGroupMode: f.packingGroupMode, shippingDocPackingLot: f.shippingDocPackingLot };
  const r = await bayrakYaz({ packingGroupsEnabled: true, packingGroupMode: "sevk-partisi", shippingDocPackingLot: true });
  if (r.status >= 300) throw new Error(`bayrak: ${r.status} ${JSON.stringify(r.govde).slice(0, 200)}`);
  if (!dur.cariId) {
    const ad = `TEST-E5${Date.now().toString(36).slice(-4).toUpperCase()} Parti Cari`;
    const c = await api("/api/customers", { method: "POST", body: JSON.stringify({ name: ad, isCustomerRole: true, defaultDestination: "DOMESTIC" }) });
    if (c.status >= 300) throw new Error(`cari: ${c.status}`);
    dur.cariId = c.govde.data.id; dur.cariAd = c.govde.data.name;
  }
}
async function partiAc(dur) {
  const p = await api("/api/shipping/packing-groups", { method: "POST", body: JSON.stringify({ customerId: dur.cariId, sackIds: [], clientToken: crypto.randomUUID() }) });
  if (p.status >= 300) throw new Error(`parti: ${p.status} ${JSON.stringify(p.govde).slice(0, 200)}`);
  return { id: p.govde.data.id, kod: p.govde.data.code, ad: p.govde.data.name };
}
/** Partiye dolu çuval + sevk → irsaliye HTML (parti ADI "SEVK PARTİSİ" kolonunda basılır). */
async function partiSevkBelgesi(dur, parti) {
  const [top] = await sql(`SELECT barcode FROM rolls WHERE status='WAREHOUSE' AND "sackId" IS NULL AND "shipmentId" IS NULL AND "ownerCustomerId" IS NULL AND barcode IS NOT NULL ORDER BY "updatedAt" DESC LIMIT 1`);
  if (!top) throw new Error("depoda serbest top yok");
  const s = await api("/api/shipping/sacks", { method: "POST", body: JSON.stringify({ customerId: dur.cariId, packingGroupId: parti.id, clientToken: crypto.randomUUID() }) });
  if (!s.govde?.data?.id) throw new Error(`çuval: ${s.status}`);
  const o = await api(`/api/shipping/sacks/${s.govde.data.id}/scan`, { method: "POST", body: JSON.stringify({ barcode: top.barcode }) });
  if (o.status >= 300) throw new Error(`okutma: ${o.status}`);
  const sv = await api("/api/shipping/shipments", { method: "POST", body: JSON.stringify({ sackIds: [s.govde.data.id], customerId: dur.cariId, orderless: true, destination: "DOMESTIC" }) });
  if (sv.status >= 300) throw new Error(`sevk: ${sv.status} ${JSON.stringify(sv.govde).slice(0, 200)}`);
  const h = await fetch(`${ortam.apiUrl}/api/printed-documents/SHIPMENT_DISPATCH/${sv.govde.data.id}/html`, { headers: { authorization: `Bearer ${token}` } });
  return { sevkId: sv.govde.data.id, html: await h.text(), status: h.status };
}
const bayatlik = [];
/** Paketleme / Çuvallar → cari sayfası (başlıkta cari adı yoksa seçici). */
async function cariSayfasinaGit(dur) {
  await gitSayfa("Paketleme / Çuvallar");
  if ((await page.getByText(dur.cariAd, { exact: true }).filter({ visible: true }).count()) > 0) return;
  let ara = page.getByPlaceholder(/Cari ara/).filter({ visible: true }).first();
  if (!(await ara.count())) {
    const geri = page.getByRole("button", { name: "Geri", exact: true }).filter({ visible: true }).first();
    if (await geri.count()) { await geri.click().catch(() => undefined); await page.waitForTimeout(1000); }
    ara = page.getByPlaceholder(/Cari ara/).filter({ visible: true }).first();
    if (!(await ara.count())) { await page.getByText(/^(Tüm Cariler|Cari Seç)$/).filter({ visible: true }).first().click({ timeout: 10_000 }); await page.waitForTimeout(1000); ara = page.getByPlaceholder(/Cari ara/).filter({ visible: true }).first(); }
  }
  await ara.fill(dur.cariAd); await page.waitForTimeout(1200);
  await page.getByText(dur.cariAd, { exact: true }).filter({ visible: true }).first().click({ timeout: 10_000 });
  await page.waitForTimeout(1500);
}
/** Paketleme / Çuvallar → cari sayfası → Yenile → parti listesinde metin var mı. K16 ölçümü: cari sayfası
 *  AÇIKKEN Yenile'den sonra görünmeyen metin "bayatlık"tır (cari seçilmemişken aramak bayatlık sayılmaz). */
async function partiListesindeVarMi(dur, metinler) {
  const gorunen = async () => Object.fromEntries(await Promise.all(metinler.map(async (m) => [m, (await page.getByText(m, { exact: true }).filter({ visible: true }).count()) > 0])));
  await cariSayfasinaGit(dur);
  await page.getByRole("button", { name: "Yenile" }).filter({ visible: true }).first().click({ timeout: 5_000 }).catch(() => undefined);
  await page.waitForTimeout(1500);
  const sonra = await gorunen();
  if (Object.values(sonra).every(Boolean)) return sonra;
  bayatlik.push({ metinler, yenileSonrasi: sonra });
  // İnsanın yapacağı: carilere dön, cariyi yeniden seç.
  const geri = page.getByRole("button", { name: "Geri", exact: true }).filter({ visible: true }).first();
  if (await geri.count()) { await geri.click().catch(() => undefined); await page.waitForTimeout(1000); }
  await cariSayfasinaGit(dur);
  return gorunen();
}

/**
 * K16 SONDASI — sıra kasıtlı: liste YÜKLENİR → "başka istemci" (API) parti açar → Yenile → yeni parti
 * görünmeli. Liste parti açıldıktan sonra ilk kez yüklenirse bayatlık hiç oluşmaz; sonda bunu ölçemezdi.
 */
async function k16Sondasi(dur) {
  await cariSayfasinaGit(dur);
  await page.waitForTimeout(1000);
  const p = await partiAc(dur);
  await page.getByRole("button", { name: "Yenile" }).filter({ visible: true }).first().click({ timeout: 5_000 });
  await page.waitForTimeout(2000);
  const gorundu = (await page.getByText(p.kod, { exact: true }).filter({ visible: true }).count()) > 0;
  return { kod: p.kod, yenileSonrasiGorundu: gorundu, gorsel: await gor("K16", "yenile-sonrasi") };
}

/** Panel: cari sayfası → "Sevk Partisi Oluştur" (kullanıcının gerçek yolu) → yanıttan kod + ad. */
async function partiAcPanel(dur) {
  await cariSayfasinaGit(dur);
  const yanit = page.waitForResponse((r) => r.request().method() === "POST" && /\/api\/shipping\/packing-groups(\?|$)/.test(r.url()), { timeout: 20_000 });
  await page.getByRole("button", { name: /Sevk Partisi Oluştur/ }).filter({ visible: true }).first().click({ timeout: 10_000 });
  const g = await (await yanit).json();
  await page.waitForTimeout(1200);
  return { id: g.data.id, kod: g.data.code, ad: g.data.name };
}

const ACICILAR = {
  packingLotCode: {
    tablo: { tablo: "packing_groups", kolon: "code" }, okutulur: false, yeniOnEk: "PRZ",
    hazirla: sevkPartisiHazirla,
    ac: async (dur) => {
      const p = await partiAcPanel(dur);
      // Oluştur partiyi açar; kod parti LİSTESİNDE görünür → listeye dön.
      const geri = page.getByRole("button", { name: "Geri", exact: true }).filter({ visible: true }).first();
      if (await geri.count()) { await geri.click().catch(() => undefined); await page.waitForTimeout(1000); }
      return { id: p.id, numara: p.kod, ek: p, acilisYolu: "panel" };
    },
    ekran: async (dur, k, eski) => partiListesindeVarMi(dur, [k.numara, ...(eski ? [eski] : [])]),
    belge: async () => ({ uygulanmaz: "PRT kodu hiçbir belgeye basılmıyor (K17 ölçüldü; belgeye basılıp basılmayacağı K18 ürün kararı)" }),
    // Eski kayıt AYNI carinin partisi olmalı (liste cari başına) → biçim değişmeden önce açılır.
    eskiKayit: async (dur) => (await partiAc(dur)).kod,
  },
  packingLotName: {
    tablo: { tablo: "packing_groups", kolon: "name" }, okutulur: false, yeniOnEk: "PZ",
    hazirla: sevkPartisiHazirla,
    // Kullanıcının gerçek yolu: panelde "Sevk Partisi Oluştur" (kendi listesini tazeler; K16'dan etkilenmez).
    ac: async (dur) => { const p = await partiAcPanel(dur); return { id: p.id, numara: p.ad, ek: p, acilisYolu: "panel" }; },
    ekran: async (dur, k, eski) => {
      // Parti açıldı → başlıktaki "Parti" kutusu; sonra Geri → listede yeni + eski ad.
      const baslikta = (await page.getByText(k.numara, { exact: true }).filter({ visible: true }).count()) > 0;
      const geri = page.getByRole("button", { name: "Geri", exact: true }).filter({ visible: true }).first();
      if (await geri.count()) { await geri.click().catch(() => undefined); await page.waitForTimeout(1200); }
      const liste = {};
      for (const m of [k.numara, ...(eski ? [eski] : [])]) liste[`liste:${m}`] = (await page.getByText(m, { exact: true }).filter({ visible: true }).count()) > 0;
      return { [`baslik:${k.numara}`]: baslikta, ...liste };
    },
    belge: async (dur, k) => { const b = await partiSevkBelgesi(dur, k.ek); return { belgeDurum: b.status, belgedeVar: b.html.includes(k.numara), sevkId: b.sevkId }; },
    eskiKayit: async (dur) => (await partiAc(dur)).ad, // ad cariye özel; eski ad aynı carinin listesinde durmalı
  },
  returnDoc: {
    tablo: { tablo: "roll_returns", kolon: "returnNo" }, okutulur: false, yeniOnEk: "IADZ", separator2: "/",
    hazirla: async () => {},
    // Kullanıcının gerçek yolu: İade Takibi → "Yeni İade" → top barkodu → "Sorgula" → açıklama → "İade Al".
    ac: async () => {
      const [r] = await sql(`SELECT r.id, r.barcode FROM rolls r WHERE r.status='SHIPPED' AND r."shipmentId" IS NOT NULL AND r."warehouseId" IS NOT NULL AND r.barcode IS NOT NULL AND NOT EXISTS (SELECT 1 FROM roll_returns rr WHERE rr."rollId"=r.id) ORDER BY r."updatedAt" DESC LIMIT 1`);
      if (!r) throw new Error("iade edilebilir sevk edilmiş top yok");
      await gitSayfa("İade Takibi");
      await page.getByRole("button", { name: /Yeni İade/ }).filter({ visible: true }).first().click({ timeout: 10_000 });
      const d = page.getByRole("dialog").filter({ hasText: "İade Girişi" }).last();
      await d.waitFor({ timeout: 10_000 });
      await d.getByPlaceholder(/Top barkodu/).fill(r.barcode);
      await d.getByRole("button", { name: "Sorgula" }).click({ timeout: 10_000 });
      await page.waitForTimeout(1500);
      await d.getByPlaceholder(/Açıklama/).fill("E5 kabul turu");
      const yanit = page.waitForResponse((x) => x.request().method() === "POST" && /\/api\/returns(\/batch)?(\?|$)/.test(x.url()), { timeout: 20_000 });
      await d.getByRole("button", { name: /^İade Al/ }).click({ timeout: 10_000 });
      const y = await yanit;
      if (y.status() >= 300) throw new Error(`iade ${y.status()} ${(await y.text()).slice(0, 200)}`);
      await page.waitForTimeout(1200);
      const [rr] = await sql(`SELECT id, "returnNo", coalesce("returnGroupId", id) kaynak FROM roll_returns WHERE "rollId"=$1 ORDER BY "createdAt" DESC LIMIT 1`, [r.id]);
      return { id: rr.id, numara: rr.returnNo, kaynak: rr.kaynak, acilisYolu: "panel" };
    },
    ekran: async (dur, k, eski) => {
      await gitSayfa("İade Takibi");
      const out = {};
      for (const m of [k.numara, ...(eski ? [eski] : [])]) {
        const ara = page.getByPlaceholder(/Ara/).filter({ visible: true }).first();
        await ara.fill(m); await page.waitForTimeout(1500);
        out[m] = (await page.getByRole("row").filter({ hasText: m }).count()) > 0;
      }
      return out;
    },
    belge: async (dur, k) => {
      const h = await fetch(`${ortam.apiUrl}/api/printed-documents/RETURN_DISPATCH/${k.kaynak}/html`, { headers: { authorization: `Bearer ${token}` } });
      const html = await h.text();
      return { belgeDurum: h.status, belgedeVar: html.includes(k.numara) };
    },
    eskiKayit: async () => (await sql(`SELECT "returnNo" FROM roll_returns WHERE "returnNo" IS NOT NULL ORDER BY "createdAt" DESC LIMIT 1`))[0]?.returnNo ?? null,
  },
};
// Kilitli seriler (TEMEL kip) — ayrı modül; yerel üç açık seri önceliklidir.
for (const [k, v] of Object.entries(acicilarKur({ api, sql, page, gitSayfa, ortam, tokenAl: () => token, bayrakYaz }))) if (!ACICILAR[k]) ACICILAR[k] = v;
// TABLET — adb yok: ÖLÇÜLMEDİ. Kullanıcı adımları raporda.
const TABLET_ADIMLARI = [
  "Tartı/Paket → sevk partisi seçicisi: yeni biçimli parti adı listede görünüyor mu (packingLotName).",
  "Tartı/Paket → çuval aç: toast'taki parti adı yeni biçimde mi.",
  "İade (mobil:iade) → iade al: yeni iade belgesi numarası ekranda görünüyor mu (tablette gösterim bulunamadı — varsa ölç).",
];

async function gitSayfa(ad) {
  const acici = page.getByText("Ara veya komut", { exact: false }).first();
  if (await acici.count()) await acici.click(); else await page.keyboard.press("Meta+k");
  const kutu = page.getByPlaceholder("Sayfa, rapor, ayar ara...");
  await kutu.fill(ad); await page.waitForTimeout(500);
  const aday = page.getByRole("option", { name: ad }).first();
  if (await aday.count()) await aday.click(); else await page.keyboard.press("Enter");
  await page.waitForTimeout(1200);
}

// ── KOŞUM ───────────────────────────────────────────────────────────────────
// İki kip: TAM (biçimi açık seri: değiştir → kayıt → ekran/belge → eski → geri al → md5) ·
// TEMEL (biçimi kilitli seri: bugünkü biçimle kayıt → numara katalog kalıbına uyuyor mu → ekran/belge →
// eski → md5). TEMEL, E2 dilimleri inmeden önceki ölçümdür; E2 sonrası farkı gösterir.
const istenen = process.argv.slice(2);
const hepsi = (await seriListesi()).filter((r) => !istenen.length || istenen.includes(r.key));
const dur = {};
/** Katalog önizlemesinden kalıp: sabit baş (ön ek + bugünkü tarih + ayraçlar) + en az `digits` haneli sayaç. */
const kalip = (r) => new RegExp(`^${esc(String(r.preview).slice(0, -r.digits))}\\d{${r.digits},}$`);
if (hepsi.some((r) => r.editable && r.key.startsWith("packingLot"))) {
  ag.adim("K16 · başka istemcinin partisi Yenile'de görünür mü");
  try { await sevkPartisiHazirla(dur); dur.k16 = await k16Sondasi(dur); } catch (e) { dur.k16 = { hata: String(e?.message ?? e).split("\n")[0] }; }
  console.log(`${dur.k16.yenileSonrasiGorundu ? "✓" : "✗"} K16 sondası — ${JSON.stringify(dur.k16)}`);
}
for (const r of hepsi) {
  const A = ACICILAR[r.key];
  const kip = r.editable ? "tam" : "temel";
  const kayit = { key: r.key, label: r.label, kip, sonuc: "ÖLÇÜLMEDİ", adimlar: {}, gorsel: [] };
  if (!A || A.olculmedi) {
    kayit.neden = A?.olcülmedi ?? "ACICILAR tablosunda kaydı açma yolu yok";
    sonuc.push(kayit); yaz(); console.log(`⏭ ${r.key} [${kip}] ÖLÇÜLMEDİ — ${kayit.neden}`); continue;
  }
  const on = r.key;
  const orj = { prefix: r.prefix, dateSegment: r.dateSegment, digits: r.digits, separator: r.separator ?? "", separator2: r.separator2 ?? "" };
  try {
    ag.adim(`${on} · hazırlık`);
    await A.hazirla(dur);
    const eski = await A.eskiKayit(dur);
    await new Promise((x) => setTimeout(x, 50));
    const sinir = new Date(); // bu andan ÖNCE doğmuş her satır "eski"dir
    const izOnce = await eskiParmakIzi(A.tablo, sinir);
    kayit.adimlar.eskiKayit = eski;

    let hedefKalip = kalip(r);
    if (kip === "tam") {
      ag.adim(`${on} · biçimi değiştir`);
      kayit.adimlar.bicim = await bicimYaz(r.key, { prefix: A.yeniOnEk, ...(A.separator2 !== undefined ? { separator2: A.separator2 } : {}) }, "e5-bicim");
      kayit.gorsel.push(await gor(r.key, "bicim-sonra"));
      hedefKalip = kalip({ ...r, preview: kayit.adimlar.bicim.onizleme });
    }

    ag.adim(`${on} · kayıt aç`);
    const k = await A.ac(dur);
    const siradakiEkranda = kip === "tam" ? kayit.adimlar.bicim.siradaki : null;
    kayit.adimlar.kayit = {
      numara: k.numara, acilisYolu: k.acilisYolu ?? "API", onizleme: kip === "tam" ? kayit.adimlar.bicim.onizleme : r.preview,
      kalibaUyar: hedefKalip.test(String(k.numara ?? "")),
      // Bilgi: diyalogdaki "Sıradaki numara" (kaydetmeden önce, taslak biçimle) açılan kayda eşit mi.
      siradaki: siradakiEkranda && siradakiEkranda !== "—" ? { ekranda: siradakiEkranda, tutar: siradakiEkranda === k.numara } : "ölçülmedi",
    };

    ag.adim(`${on} · ekran`);
    kayit.adimlar.ekran = await A.ekran(dur, k, eski).catch((e) => ({ hata: String(e.message ?? e).split("\n")[0] }));
    kayit.gorsel.push(await gor(r.key, "ekran"));

    ag.adim(`${on} · belge`);
    kayit.adimlar.belge = A.belge ? await A.belge(dur, k).catch((e) => ({ hata: String(e.message ?? e).split("\n")[0] })) : { uygulanmaz: "bu serinin belgesi yok" };
    kayit.adimlar.okutma = A.okutulur ? "ölçülmedi (panel okutma kolu E4 sonrası)" : "uygulanmaz (seri okutulmuyor)";

    // VARYANTLAR (TAM kip): tarih · ayraç · hane — her biri: biçim → kayıt → kalıp + ekran → geri.
    if (kip === "tam" && A.varyantlar?.length) {
      kayit.adimlar.varyantlar = [];
      for (const v of A.varyantlar) {
        ag.adim(`${on} · varyant ${JSON.stringify(v)}`);
        const b = await bicimYaz(r.key, v, "e5-varyant");
        const kv = await A.ac(dur);
        const kk = kalip({ ...r, digits: v.digits ?? r.digits, preview: b.onizleme });
        const ekr = await A.ekran(dur, kv, null).catch((e) => ({ hata: String(e.message ?? e).split("\n")[0] }));
        await bicimYaz(r.key, orj, "e5-varyant-geri");
        kayit.adimlar.varyantlar.push({ v, onizleme: b.onizleme, numara: kv.numara, kalibaUyar: kk.test(String(kv.numara ?? "")), ekran: ekr, kaydedildi: b.kapandi });
      }
    }
    // YÜRÜRLÜK (TAM kip): yarın tarihli değişiklik → bekleyen görünür · bugünkü kayıt ESKİ biçimle · "İptal et".
    if (kip === "tam" && A.yururluk) {
      ag.adim(`${on} · yürürlük`);
      const yarin = new Date(Date.now() + 86_400_000);
      const gun = `${String(yarin.getDate()).padStart(2, "0")}.${String(yarin.getMonth() + 1).padStart(2, "0")}.${yarin.getFullYear()}`;
      const b = await bicimYaz(r.key, { prefix: A.yururluk, effectiveFrom: gun }, "e5-yururluk");
      const d2 = await ac(await seri(r.key));
      const bekleyenDiyalogda = d2 ? (await d2.getByText("Bekleyen değişiklik:").count()) > 0 : false;
      const g = await gor(r.key, "yururluk-bekleyen");
      await diyaloguKapat();
      const ky = await A.ac(dur);
      const bugunkuKalip = kalip({ ...r, preview: (await seri(r.key)).preview });
      const d3 = await ac(await seri(r.key));
      let iptal = null;
      if (d3) {
        const btn = d3.getByRole("button", { name: "İptal et" });
        if (await btn.count()) {
          await btn.click();
          const sd = page.getByRole("dialog").filter({ hasText: "Ayar şifresi" }).first();
          if (await sd.waitFor({ timeout: 4_000 }).then(() => true, () => false)) { await sd.locator("#settings-password").fill(AYAR_SIFRESI); await sd.getByRole("button", { name: "Onayla" }).click(); }
          await page.waitForTimeout(1500);
          iptal = true;
        } else iptal = "İptal et düğmesi yok";
      }
      await diyaloguKapat();
      const ileriSatir = (await sql(`SELECT count(*)::int n FROM number_series_lines WHERE "seriesKey"=$1 AND "effectiveFrom" > now()`, [r.key]))[0].n;
      kayit.adimlar.yururluk = { kaydedildi: b.kapandi, bekleyenDiyalogda, gorsel: g, bugunkuKayit: ky.numara, eskiBicimle: bugunkuKalip.test(String(ky.numara ?? "")), iptal, iptalSonrasiIleriSatir: ileriSatir };
    }

    let geriTamam = true;
    if (kip === "tam") {
      ag.adim(`${on} · geri al`);
      kayit.adimlar.geriAl = await bicimYaz(r.key, orj, "e5-geri");
      const son = await seri(r.key);
      kayit.adimlar.geriAl.onEk = son.prefix;
      geriTamam = kayit.adimlar.geriAl.kapandi && son.prefix === orj.prefix;
    }
    kayit.adimlar.eskiNumaralarAyni = izOnce === (await eskiParmakIzi(A.tablo, sinir));

    const ekranTamam = kayit.adimlar.ekran && !kayit.adimlar.ekran.hata && (kayit.adimlar.ekran.uygulanmaz || Object.values(kayit.adimlar.ekran).every(Boolean));
    const varyantTamam = (kayit.adimlar.varyantlar ?? []).every((x) => x.kaydedildi && x.kalibaUyar && !x.ekran?.hata && (x.ekran?.uygulanmaz || Object.values(x.ekran ?? {}).every(Boolean)));
    const y = kayit.adimlar.yururluk;
    const yururlukTamam = !y || (y.kaydedildi && y.bekleyenDiyalogda && y.eskiBicimle && y.iptal === true && y.iptalSonrasiIleriSatir === 0);
    const belgeTamam = kayit.adimlar.belge.uygulanmaz || kayit.adimlar.belge.belgedeVar === true;
    const agTemiz = Object.values(agKayitlari(on)).every((l) => l.length === 0);
    const bicimTamam = kip === "tam" ? kayit.adimlar.bicim.kapandi : true;
    kayit.sonuc = bicimTamam && kayit.adimlar.kayit.kalibaUyar && ekranTamam && belgeTamam && geriTamam && kayit.adimlar.eskiNumaralarAyni && agTemiz && varyantTamam && yururlukTamam ? "✓" : "✗";
  } catch (e) {
    kayit.sonuc = "✗"; kayit.hata = String(e?.message ?? e).split("\n")[0].slice(0, 300);
    kayit.hataAyrinti = String(e?.message ?? e).slice(0, 1500); // Playwright çağrı günlüğü: hangi locator, neden
    kayit.gorsel.push(await gor(r.key, "hata"));
    if (kip === "tam") await bicimYaz(r.key, orj, "e5-acil-geri").catch(() => undefined);
  }
  kayit.ag = agKayitlari(on);
  sonuc.push(kayit); yaz();
  console.log(`${kayit.sonuc} ${r.key} [${kip}]${kayit.hata ? ` — ${kayit.hata}` : ""}\n   ${JSON.stringify(kayit.adimlar).slice(0, 700)}`);
  if (Object.values(kayit.ag).some((l) => l.length)) console.log(`   ağ: ${JSON.stringify(kayit.ag).slice(0, 500)}`);
}
if (dur.bayrakOnce) { ag.adim("bayraklar geri"); await bayrakYaz(Object.fromEntries(Object.entries(dur.bayrakOnce).filter(([, v]) => v !== undefined))); }
sonuc.push({ key: "TABLET", sonuc: "ÖLÇÜLMEDİ", neden: "adb bağlı değil", kullaniciAdimlari: TABLET_ADIMLARI });
sonuc.push({ key: "K16", sonuc: dur.k16?.yenileSonrasiGorundu ? "✓" : "✗", sonda: dur.k16 ?? null, akisBayatligi: bayatlik }); yaz();
if (bayatlik.length) console.log(`⚠ K16 Yenile sonrası bayat parti listesi: ${JSON.stringify(bayatlik)}`);

const agOzet = ag.rapor();
console.log(`hata ağı: ${JSON.stringify(agOzet)}`);
await app.close().catch(() => undefined);
await pg.end().catch(() => undefined);
console.log(`\n=== bitti → ${path.relative(ELECTRON_KOK, CIKTI)}/sonuc.json ===`);
