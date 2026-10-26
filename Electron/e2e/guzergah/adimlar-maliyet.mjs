// =============================================================================
// GÜZERGÂH · MAL — maliyet panel ekranları (MAL-3)
// =============================================================================
// MAL1 boş durumlar (hub, parametreler, iplik fiyatları, tarifeler, kartlar, hesaplayıcı).
// MAL2 API ile tohum (parametre seti yürürlükte, iplik fiyatı, tarife) → dolu sayfalar.
// MAL3 maliyet kartı listesi + detay sekmeleri (Yapı · Döküm · Sürümler).
// MAL4 Hızlı Hesaplayıcı elle yapı: döviz fiyatlı iplik, kur yok → "kur yok" eksikliği (1 varsayılmaz);
//      kur girilince döküm; sonunda muhasebe hesabından cost:* izinleri alınır (MAL5 için).
// MAL5 cost:read OLMAYAN kullanıcı: menüde ve palette maliyet yüzeyi yok.
// MAL6 Teklifler (MAL-5): boş liste + yeni teklif formu; API tohumu (ürünlü + yeni desen kalem) → dolu liste + taslak detay.
// MAL7 Gönder → Kabul et → Siparişe dönüştür (yeni desen kalemine ürün bağla) → sipariş bağlantısı.
// MAL8 Gönderilmiş teklif → Revizyon oluştur → R2 taslağı + zaman çizelgesi revizyon zinciri.
// MAL9 Fiyat listeleri: boş → arayüzden yeni liste → satırlar (API) → Yayınla onayı → yayında.
// MAL10 Maliyet izni olmayan kullanıcı (muhasebe, MAL5'te cost:* alındı; quote/price-list okuma verilir): maliyet kolonu yok.
// MAL11 Teklif belgesi (MAL-6): taslak önizleme → gönderilmiş teklif belgesi (İndir ▾ Excel) → iptal → İPTAL filigranı.
// MAL12 Fiyat listesi belgesi (MAL-6): yayındaki liste → Yazdır / PDF / Excel önizlemesi.
// MAL13 İplik İhtiyaç Planı (MAL-7): hub karosu → sayfa (dolu/boş), "Depo ve üretimi düş: Hayır" süzgeci sunucuda,
//       Excel = ekran tablosu (başlıklar aynı sırada, "bilinmiyor" hücresi aynı metin).
// MAL14 report:yarn-need OLMAYAN kullanıcı: palette "İplik İhtiyaç Planı" yok.
// Kanıt PNG'leri `E2E_KANIT_DIZINI` verilirse açık + koyu, geniş + dar olarak oraya da yazılır.
// =============================================================================
import fs from "node:fs";
import os from "node:os";
import { createRequire } from "node:module";
import path from "node:path";

const KANIT = process.env.E2E_KANIT_DIZINI;
const olc = {};
const GENISLIKLER = [["genis", 1440, 900], ["dar", 820, 1000]];

async function kanit(page, ad, odak = null) {
  if (!KANIT) return;
  fs.mkdirSync(KANIT, { recursive: true });
  const ilk = page.viewportSize();
  for (const [g, w, h] of GENISLIKLER) {
    await page.setViewportSize({ width: w, height: h }).catch(() => undefined);
    if (odak) await odak.scrollIntoViewIfNeeded().catch(() => undefined);
    for (const tema of ["acik", "koyu"]) {
      await page.evaluate((koyu) => document.documentElement.classList.toggle("dark", koyu), tema === "koyu");
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(KANIT, `${ad}-${g}-${tema}.png`) });
    }
  }
  await page.evaluate(() => document.documentElement.classList.remove("dark"));
  if (ilk) await page.setViewportSize(ilk).catch(() => undefined);
}

const SAYFALAR = [
  ["Maliyet Parametreleri", "parametreler"],
  ["İplik Maliyet Fiyatları", "iplik-fiyatlari"],
  ["Fason Tarifeleri", "tarifeler"],
  ["Maliyet Kartları", "kartlar"],
  ["Hızlı Hesaplayıcı", "hesaplayici"],
];

const PARAMETRE_SETI = {
  note: "TEST-MAL Parametre", loomHourRateTry: "120", laborHourRateTry: "250", loomsPerOperator: "8", energyKwhPerLoomHour: "4.5",
  energyPriceTryPerKwh: "3.2", overheadPct: "6", defaultTakeUpPct: "8", defaultWarpWastePct: "1.5", defaultWeftWastePct: "2",
  defaultFabricWastePct: "3", defaultLoomRpm: "600", defaultEfficiencyPct: "85", beamPrepCostTry: "1500", defaultBeamLengthM: "3000",
  weftSelvedgeAllowanceCm: "4", defaultMarkupPct: "15",
};

export const MALIYET_ADIMLARI = [
  {
    id: "MAL1", rol: "P",
    yol: "Maliyet & Teklif → her sayfa (boş durum)", rota: "cost",
    async yap({ git, page, sql }) {
      olc.mal1Bos = Number((await sql("SELECT (SELECT count(*) FROM cost_parameter_sets) + (SELECT count(*) FROM finishing_rates) AS n"))[0].n);
      await git("Maliyet & Teklif");
      await page().getByText("Maliyet Parametreleri").first().waitFor({ timeout: 15_000 });
      await kanit(page(), "MAL1-hub");
      olc.mal1 = [];
      for (const [baslik, ad] of SAYFALAR) {
        await git(baslik);
        await page().getByRole("heading", { name: baslik }).first().waitFor({ timeout: 15_000 });
        await page().waitForTimeout(800);
        olc.mal1.push(baslik);
        await kanit(page(), `MAL1-bos-${ad}`);
      }
    },
    dogrula: [{ ad: "beş maliyet sayfası paletle açıldı", sql: "SELECT 1", oku: () => olc.mal1?.length, beklenen: (n) => n === 5 }],
  },
  {
    id: "MAL2", rol: "P",
    yol: "API tohumu → Parametreler · İplik fiyatları · Fason tarifeleri (dolu)", rota: "cost/parameters",
    async yap({ git, page, api, sql }) {
      const aktif = (await api("/api/cost/parameter-sets/active")).govde.data;
      if (!aktif) {
        const taslak = (await api("/api/cost/parameter-sets", { method: "POST", body: JSON.stringify(PARAMETRE_SETI) })).govde.data;
        await api(`/api/cost/parameter-sets/${taslak.id}/activate`, { method: "POST", body: "{}" });
      }
      // Karşılaştırma görünsün diye ikinci bir taslak (farklı alanlar vurgulu).
      await api("/api/cost/parameter-sets", { method: "POST", body: JSON.stringify({ note: "TEST-MAL Taslak", laborHourRateTry: "275", overheadPct: "7" }) });
      let iplik = (await sql(`SELECT id FROM items WHERE "itemType" = 'YARN' AND "isActive" ORDER BY code LIMIT 1`))[0];
      // E2E dump'ında aktif iplik kartı yok → TEST iplik kartı açılır (fiyat satırı boş kalmasın).
      if (!iplik) iplik = (await api("/api/items", { method: "POST", body: JSON.stringify({ name: "TEST-MAL İplik", itemType: "YARN", unit: "KG" }) })).govde.data;
      if (iplik?.id) await api("/api/cost/yarn-prices", { method: "POST", body: JSON.stringify({ yarnItemId: iplik.id, currency: "USD", pricePerKg: "2.45", note: "TEST-MAL" }) });
      await api("/api/cost/finishing-rates", { method: "POST", body: JSON.stringify({ code: "TEST-BOYA", name: "TEST Boya-apre", basis: "RAW_M", currency: "TRY", pricePerM: "18.5", typicalShrinkPct: "4" }) });
      // Tohum API'den yazıldı (UI geçersizlemesi yok): MAL1'de açık kalan sekmelerin önbelleği tazelensin.
      await page().reload();
      await page().waitForTimeout(2000);
      olc.mal2 = [];
      for (const [baslik, ad] of SAYFALAR.slice(0, 3)) {
        await git(baslik);
        await page().getByRole("heading", { name: baslik }).first().waitFor({ timeout: 15_000 });
        await page().waitForTimeout(1000);
        olc.mal2.push(await page().locator("body").innerText().catch(() => ""));
        await kanit(page(), `MAL2-dolu-${ad}`);
      }
    },
    dogrula: [
      { ad: "yürürlükte parametre seti var", sql: "SELECT count(*)::int AS n FROM cost_parameter_sets WHERE status = 'ACTIVE'", beklenen: (r) => r[0]?.n === 1 },
      { ad: "iplik fiyatı satırı yazıldı", sql: `SELECT count(*)::int AS n FROM yarn_cost_prices WHERE "revokedAt" IS NULL`, beklenen: (r) => r[0]?.n >= 1 },
      { ad: "tarife sayfası TEST-BOYA'yı gösterir", sql: "SELECT 1", oku: () => olc.mal2?.[2], beklenen: (t) => /TEST-BOYA/.test(t ?? "") },
    ],
  },
  {
    id: "MAL3", rol: "P",
    yol: "Maliyet Kartları → bir kumaş → Yapı · Döküm · Sürümler", rota: "cost/items",
    async yap({ git, page }) {
      await git("Maliyet Kartları");
      await page().getByRole("heading", { name: "Maliyet Kartları" }).first().waitFor({ timeout: 15_000 });
      await page().locator("tbody tr:visible").first().waitFor({ timeout: 20_000 });
      await kanit(page(), "MAL3-liste");
      await page().locator("tbody tr:visible").first().click();
      await page().getByRole("tab", { name: "Döküm" }).waitFor({ timeout: 15_000 });
      await page().waitForTimeout(1500);
      olc.mal3 = await page().locator("body").innerText().catch(() => "");
      await kanit(page(), "MAL3-dokum");
      await page().getByRole("tab", { name: "Yapı" }).click();
      await page().waitForTimeout(800);
      await kanit(page(), "MAL3-yapi");
      await page().getByRole("tab", { name: "Sürümler" }).click();
      await page().waitForTimeout(800);
      await kanit(page(), "MAL3-surumler");
    },
    dogrula: [{ ad: "detay başlığı 'Maliyet kartı' der", sql: "SELECT 1", oku: () => olc.mal3, beklenen: (t) => /Maliyet kartı/.test(t ?? "") }],
  },
  {
    id: "MAL4", rol: "P",
    yol: "Hızlı Hesaplayıcı → Elle yapı (USD iplik, kur yok → eksik; kur girilince döküm)", rota: "cost/calculator",
    async yap({ git, page, sql, ortam }) {
      // Dump'ta her dövizin Muhasebe kuru var; "kur yok → 1 varsayılmaz" ekranı için yalnız bu E2E DB'sinde USD kuru kalkar.
      await sql(`DELETE FROM exchange_rates WHERE currency = 'USD'`);
      await git("Hızlı Hesaplayıcı");
      await page().getByRole("button", { name: "Elle yapı" }).click({ timeout: 15_000 });
      const yaz = async (etiket, deger) => page().getByLabel(etiket, { exact: true }).fill(deger);
      await yaz("Tel sayısı", "5200");
      await yaz("Çözgü çekmesi (%)", "8");
      await yaz("Çözgü denye", "75");
      await yaz("Çözgü kg fiyatı", "2,4");
      await page().getByLabel("Çözgü para birimi", { exact: true }).selectOption("USD");
      await yaz("Atkı sıklığı (atkı/cm)", "32");
      await yaz("Ham en (cm)", "160");
      await yaz("Atkı 1 denye", "150");
      await yaz("Atkı 1 kg fiyatı", "60");
      await yaz("Atkı 1 pay", "1");
      await page().getByLabel("USD kuru").waitFor({ timeout: 15_000 });
      await page().waitForTimeout(1500);
      olc.mal4Eksik = await page().locator("body").innerText().catch(() => "");
      await kanit(page(), "MAL4-elle-kur-yok", page().getByLabel("USD kuru"));
      await page().getByLabel("USD kuru").fill("34,25");
      await page().getByTestId("cost-total").waitFor({ timeout: 15_000 });
      await page().waitForTimeout(800);
      olc.mal4Toplam = await page().getByTestId("cost-total").innerText();
      await kanit(page(), "MAL4-elle-dokum", page().getByTestId("cost-total"));
      // MAL5 için: muhasebe hesabı cost:* + teklif/fiyat listesi izinlerini kaybeder (hub bunlardan BİRİYLE açılır; yalnız bu E2E DB'si).
      await sql(`DELETE FROM user_permissions WHERE "userId" = (SELECT id FROM users WHERE username = $1) AND "permissionId" IN (SELECT id FROM permissions WHERE code LIKE 'cost:%' OR code LIKE 'quote:%' OR code LIKE 'price-list:%')`, [ortam.kullanicilar.muhasebe.username]);
    },
    dogrula: [
      { ad: "kur yokken 'Kur 1 varsayılmaz' eksikliği görünür", sql: "SELECT 1", oku: () => olc.mal4Eksik, beklenen: (t) => /Kur 1 varsayılmaz/.test(t ?? "") },
      { ad: "kur girilince toplam TL/m sunucudan", sql: "SELECT 1", oku: () => olc.mal4Toplam, beklenen: (t) => /TL\/m/.test(t ?? "") },
    ],
  },
  {
    id: "MAL5", rol: "M",
    yol: "cost:read olmayan kullanıcı → menüde ve palette maliyet yok", rota: "",
    async yap({ page }) {
      await page().waitForTimeout(1500);
      olc.mal5Menu = await page().getByText("Maliyet & Teklif", { exact: true }).count();
      await kanit(page(), "MAL5-izinsiz-menu");
      const acici = page().getByText("Ara veya komut", { exact: false }).first();
      if (await acici.count()) await acici.click(); else await page().keyboard.press("Meta+k");
      const kutu = page().getByPlaceholder("Sayfa, rapor, ayar ara...");
      await kutu.fill("Maliyet");
      await page().waitForTimeout(600);
      olc.mal5Palet = await page().getByRole("option", { name: /Maliyet Parametreleri|Maliyet Kartları|Hızlı Hesaplayıcı/ }).count();
      await kanit(page(), "MAL5-izinsiz-palet");
      await page().keyboard.press("Escape");
    },
    dogrula: [
      { ad: "menüde 'Maliyet & Teklif' yok", sql: "SELECT 1", oku: () => olc.mal5Menu, beklenen: (n) => n === 0 },
      { ad: "palette maliyet sayfası yok", sql: "SELECT 1", oku: () => olc.mal5Palet, beklenen: (n) => n === 0 },
    ],
  },
];

// ── MAL-5: teklif + fiyat listesi ────────────────────────────────────────────
const tok = () => crypto.randomUUID();
/** Tohum çağrısı 2xx dönmezse adım sebebiyle düşer (sessiz eksik tohum ekranı yanıltmasın). */
async function zorunlu(api, yol, init) {
  const r = await api(yol, init);
  if (r.status >= 300) throw new Error(`tohum ${init?.method ?? "GET"} ${yol} → ${r.status} ${r.govde?.message ?? ""} ${JSON.stringify(r.govde?.details ?? {})}`);
  return r;
}
async function tohumKumas(sql) {
  const musteri = (await sql(`SELECT id, name FROM customers WHERE "isCustomerRole" AND "isActive" ORDER BY code LIMIT 1`))[0];
  const kumas = (await sql(`SELECT id, code, name FROM items WHERE "itemType" = 'FABRIC' AND "isActive" ORDER BY code LIMIT 2`));
  return { musteri, kumas };
}
async function tohumTeklif(api, sql) {
  const { musteri, kumas } = await tohumKumas(sql);
  const q = (await zorunlu(api, "/api/quotes", { method: "POST", body: JSON.stringify({ customerId: musteri.id, currency: "TRY", clientToken: tok(), customerReference: "TEST-MAL5" }) })).govde.data;
  // Dump kumaşlarında maliyet yapısı (çözgü/atkı tanımı) yok → ürünlü kalem fiyatlanamaz; iki YENİ DESEN kalemi
  // (elle yapı) açılır — dönüştürmede ikisine de ürün bağlanır (bağ yalnız siparişe).
  for (const [ad, miktar, fiyat] of [["TEST Yeni desen", "800", "92"], ["TEST Desen B", "1200", "84.5"]]) {
    await zorunlu(api, `/api/quotes/${q.id}/lines`, {
      method: "POST",
      body: JSON.stringify({
        description: ad, quantity: miktar, unitPrice: fiyat, markupPct: "15", unit: "MT",
        adHoc: { warp: { endsCount: "5200", takeUpPct: "8", yarn: { denier: "75", pricePerKg: "95", currency: "TRY" } }, weft: { picksPerCm: "32", rawWidthCm: "160", yarns: [{ denier: "150", pricePerKg: "60", currency: "TRY", picksInRepeat: "1" }] }, finishingRateCode: null },
      }),
    });
  }
  return { q, musteri, kumas };
}
const satirAc = async (page, metin) => {
  await page().locator("tbody tr:visible").filter({ hasText: metin }).first().click({ timeout: 20_000 });
  await page().waitForTimeout(1200);
};

const TEKLIF_ADIMLARI = [
  {
    id: "MAL6", rol: "P",
    yol: "Maliyet & Teklif → Teklifler (boş) → Yeni teklif formu → (API tohumu) → dolu liste → taslak detay", rota: "cost/quotes",
    async yap({ git, page, api, sql }) {
      await git("Teklifler");
      await page().getByRole("heading", { name: "Teklifler" }).first().waitFor({ timeout: 15_000 });
      await page().waitForTimeout(1000);
      olc.mal6Bos = await page().locator('[data-testid="quotes-empty"]:visible').count();
      await kanit(page(), "MAL6-teklif-liste-bos");
      await git("Yeni teklif");
      await page().getByRole("heading", { name: /Yeni teklif/ }).first().waitFor({ timeout: 15_000 });
      await kanit(page(), "MAL6-teklif-yeni-form");
      olc.t1 = await tohumTeklif(api, sql);
      await git("Teklifler");
      await page().reload();
      await page().waitForTimeout(2000);
      await git("Teklifler");
      await page().locator('[data-testid="quote-row"]:visible').first().waitFor({ timeout: 20_000 });
      await kanit(page(), "MAL6-teklif-liste-dolu");
      await satirAc(page, olc.t1.musteri.name);
      await page().locator('text=TEST Yeni desen >> visible=true').first().waitFor({ timeout: 15_000 });
      olc.mal6Detay = await page().locator("body").innerText().catch(() => "");
      await kanit(page(), "MAL6-teklif-taslak-detay");
    },
    dogrula: [
      { ad: "boş listede boş durum metni", sql: "SELECT 1", oku: () => olc.mal6Bos, beklenen: (n) => n === 1 },
      { ad: "taslak iki kalemli", sql: `SELECT count(*)::int AS n FROM sales_quote_lines l JOIN sales_quotes q ON q.id = l."quoteId" WHERE q."customerReference" = 'TEST-MAL5'`, beklenen: (r) => r[0]?.n === 2 },
      { ad: "detayda Gönder eylemi", sql: "SELECT 1", oku: () => olc.mal6Detay, beklenen: (t) => /Gönder/.test(t ?? "") },
    ],
  },
  {
    id: "MAL7", rol: "P",
    yol: "Teklif detayı → Gönder → Kabul et → Siparişe dönüştür (ürün bağla) → sipariş", rota: "cost/quotes/:id",
    async yap({ page, tikla, diyalog }) {
      await tikla("Gönder", { exact: true });
      await page().getByRole("button", { name: "Kabul et", exact: true }).waitFor({ timeout: 15_000 });
      await tikla("Kabul et", { exact: true });
      await page().getByRole("button", { name: "Siparişe dönüştür", exact: true }).waitFor({ timeout: 15_000 });
      await tikla("Siparişe dönüştür", { exact: true });
      const d = diyalog("Siparişe dönüştür");
      await d.getByTestId("unlinked-lines").waitFor({ timeout: 15_000 });
      await kanit(page(), "MAL7-donustur-urunsuz");
      for (let i = 0; i < 2; i++) {
        await d.getByRole("button", { name: /Ürün bağla/ }).first().click();
        await page().waitForTimeout(1200);
        const secici = page().getByRole("dialog").last();
        await secici.locator("tbody tr:visible, [role=option]").nth(i).click({ timeout: 15_000 });
        await page().waitForTimeout(600);
      }
      await kanit(page(), "MAL7-donustur-bagli");
      await d.getByTestId("convert-confirm").click({ timeout: 15_000 });
      await d.getByTestId("convert-order-link").waitFor({ timeout: 20_000 });
      olc.mal7Siparis = await d.getByTestId("convert-order-link").innerText();
      await kanit(page(), "MAL7-donustur-tamam");
      await tikla("Kapat", { exact: true });
      await page().locator('[data-testid="order-link"]:visible').first().waitFor({ timeout: 15_000 });
      await kanit(page(), "MAL7-teklif-donustu-zaman");
    },
    dogrula: [
      { ad: "teklif CONVERTED + siparişe bağlı", sql: `SELECT status, "convertedOrderId" FROM sales_quotes WHERE "customerReference" = 'TEST-MAL5'`, beklenen: (r) => r[0]?.status === "CONVERTED" && Boolean(r[0]?.convertedOrderId) },
      { ad: "siparişte iki satır, hepsi ürünlü", sql: `SELECT count(*)::int AS n, count(ol."itemId")::int AS urunlu FROM order_lines ol JOIN sales_quotes q ON q."convertedOrderId" = ol."orderId" WHERE q."customerReference" = 'TEST-MAL5'`, beklenen: (r) => r[0]?.n === 2 && r[0]?.urunlu === 2 },
      { ad: "teklifin yeni desen kalemleri ürünsüz kaldı (defter)", sql: `SELECT count(*)::int AS n FROM sales_quote_lines l JOIN sales_quotes q ON q.id = l."quoteId" WHERE q."customerReference" = 'TEST-MAL5' AND l."itemId" IS NULL`, beklenen: (r) => r[0]?.n === 2 },
    ],
  },
  {
    id: "MAL8", rol: "P",
    yol: "Gönderilmiş teklif → Revizyon oluştur → R2 taslağı + zaman çizelgesi", rota: "cost/quotes/:id",
    async yap({ git, page, api, sql, tikla }) {
      const { q } = await tohumTeklif(api, sql);
      await zorunlu(api, `/api/quotes/${q.id}/send`, { method: "POST", body: "{}" });
      olc.t2 = q;
      await git("Teklifler");
      await page().reload();
      await page().waitForTimeout(2000);
      await git("Teklifler");
      await page().locator('[data-testid="quote-row"]:visible').filter({ hasText: "Gönderildi" }).first().click({ timeout: 20_000 });
      await page().getByRole("button", { name: "Revizyon oluştur", exact: true }).waitFor({ timeout: 15_000 });
      await kanit(page(), "MAL8-teklif-gonderildi");
      await tikla("Revizyon oluştur", { exact: true });
      await page().locator('text=/Önceki sürüm R1/ >> visible=true').first().waitFor({ timeout: 20_000 });
      olc.mal8 = await page().locator("body").innerText().catch(() => "");
      await kanit(page(), "MAL8-revizyon-r2", page().locator('text=/Önceki sürüm R1/ >> visible=true').first());
    },
    dogrula: [
      { ad: "R2 taslak, R1 yerine geçildi", sql: `SELECT status::text AS status, "revisionNo" FROM sales_quotes WHERE "revisionOfId" IS NOT NULL ORDER BY "createdAt" DESC LIMIT 1`, beklenen: (r) => r[0]?.status === "DRAFT" && r[0]?.revisionNo === 2 },
      { ad: "ekranda R2 başlığı", sql: "SELECT 1", oku: () => olc.mal8, beklenen: (t) => /R2/.test(t ?? "") },
    ],
  },
  {
    id: "MAL9", rol: "P",
    yol: "Maliyet & Teklif → Fiyat Listeleri (boş) → Yeni liste → satırlar → Yayınla", rota: "cost/price-lists",
    async yap({ git, page, api, sql, tikla, yaz, diyalog, ortam }) {
      await git("Fiyat Listeleri");
      await page().getByRole("heading", { name: "Fiyat Listeleri" }).first().waitFor({ timeout: 15_000 });
      await page().waitForTimeout(1000);
      olc.mal9Bos = await page().locator('[data-testid="pl-empty"]:visible').count();
      await kanit(page(), "MAL9-fiyat-liste-bos");
      await page().locator('[data-testid="pl-new"]:visible').first().click();
      const d = diyalog("Yeni fiyat listesi");
      await yaz("Liste adı", "TEST-MAL5 Genel 2026", { icinde: d });
      await kanit(page(), "MAL9-fiyat-yeni-form");
      await d.getByTestId("pl-create-submit").click();
      await page().getByRole("heading", { name: /Fiyat listesi / }).first().waitFor({ timeout: 20_000 });
      const pl = (await sql(`SELECT id FROM price_lists WHERE name = 'TEST-MAL5 Genel 2026'`))[0];
      const { kumas } = await tohumKumas(sql);
      await zorunlu(api, `/api/price-lists/${pl.id}/lines`, { method: "PUT", body: JSON.stringify({ lines: kumas.map((k, i) => ({ itemId: k.id, colorId: null, unitPrice: i ? "88.40" : "79.90", minQty: "500" })) }) });
      olc.pl = pl;
      await page().reload();
      await page().waitForTimeout(2000);
      await git("Fiyat Listeleri");
      await page().locator('[data-testid="pl-row"]:visible').first().click({ timeout: 20_000 });
      await page().locator('[data-testid="pl-line"]:visible').first().waitFor({ timeout: 15_000 });
      await kanit(page(), "MAL9-fiyat-taslak-editor");
      await tikla("Yayınla", { exact: true });
      const y = diyalog("Listeyi yayınla");
      await y.getByTestId("pl-publish-nopeer").or(y.getByTestId("pl-publish-peer")).first().waitFor({ timeout: 15_000 });
      await kanit(page(), "MAL9-fiyat-yayinla-onay");
      await y.getByTestId("pl-confirm").click();
      await page().getByRole("button", { name: "Arşivle", exact: true }).waitFor({ timeout: 20_000 });
      await kanit(page(), "MAL9-fiyat-yayinda");
      await git("Fiyat Listeleri");
      await page().locator('[data-testid="pl-row"]:visible').first().waitFor({ timeout: 15_000 });
      await kanit(page(), "MAL9-fiyat-liste-dolu");
      // MAL10 için: muhasebe (cost:* MAL5'te alındı) teklif/fiyat listesi OKUMA alır — rol değişince yeniden giriş yapar.
      await sql(
        `INSERT INTO user_permissions (id, "userId", "permissionId", "createdAt", "updatedAt")
         SELECT gen_random_uuid(), u.id, p.id, now(), now() FROM users u, permissions p
         WHERE u.username = $1 AND p.code IN ('quote:read', 'price-list:read') ON CONFLICT DO NOTHING`,
        [ortam.kullanicilar.muhasebe.username],
      );
    },
    dogrula: [
      { ad: "boş listede boş durum", sql: "SELECT 1", oku: () => olc.mal9Bos, beklenen: (n) => n === 1 },
      { ad: "liste PUBLISHED, iki satır", sql: `SELECT p.status::text AS s, count(l.id)::int AS n FROM price_lists p LEFT JOIN price_list_lines l ON l."priceListId" = p.id WHERE p.name = 'TEST-MAL5 Genel 2026' GROUP BY p.status`, beklenen: (r) => r[0]?.s === "PUBLISHED" && r[0]?.n === 2 },
    ],
  },
  {
    id: "MAL10", rol: "M",
    yol: "cost:read olmayan, quote/price-list okuyan kullanıcı → fiyat listesi detayında maliyet kolonu yok", rota: "cost/price-lists/:id",
    async yap({ git, page }) {
      await page().waitForTimeout(1500);
      await git("Fiyat Listeleri");
      await page().locator('[data-testid="pl-row"]:visible').first().click({ timeout: 20_000 });
      await page().locator('[data-testid="pl-line"]:visible').first().waitFor({ timeout: 15_000 });
      olc.mal10 = await page().locator('[data-testid="pl-col-cost"]:visible').count();
      await kanit(page(), "MAL10-satis-maliyet-kolonu-yok");
    },
    dogrula: [{ ad: "maliyet kolonu yok", sql: "SELECT 1", oku: () => olc.mal10, beklenen: (n) => n === 0 }],
  },
];
// ── MAL-6: teklif + fiyat listesi belgesi ────────────────────────────────────
const belgeAc = async (page) => {
  await page().locator('[data-testid="commercial-doc-open"]:visible').first().click({ timeout: 15_000 });
  const fr = page().frameLocator("iframe[title$='Önizleme']");
  await fr.locator("body").waitFor({ timeout: 20_000 });
  await page().waitForTimeout(1500);
  return (await fr.locator("body").innerText().catch(() => "")) ?? "";
};
const belgeKapat = async (page) => {
  await page().keyboard.press("Escape");
  await page().waitForTimeout(600);
};
const BELGE_ADIMLARI = [
  {
    id: "MAL11", rol: "P",
    yol: "Teklif detayı → Yazdır / PDF / Excel (taslak önizleme) → Gönder → belge + İndir ▾ Excel → İptal → İPTAL filigranı", rota: "cost/quotes/:id",
    async yap({ git, page, api, sql }) {
      const { q } = await tohumTeklif(api, sql);
      await sql(`UPDATE sales_quotes SET "internalNote" = 'TEST-IC-NOT-SIZINTI', "customerReference" = 'TEST-MAL6' WHERE id = $1`, [q.id]);
      olc.t3 = q;
      await git("Teklifler");
      await page().reload();
      await page().waitForTimeout(2000);
      await git("Teklifler");
      await page().locator('[data-testid="quote-row"]:visible').filter({ hasText: "Taslak" }).first().click({ timeout: 20_000 });
      await page().locator('[data-testid="commercial-doc-open"]:visible').first().waitFor({ timeout: 15_000 });
      await kanit(page(), "MAL11-teklif-detay-belge-dugmesi", page().locator('[data-testid="commercial-doc-open"]:visible').first());
      olc.mal11Taslak = await belgeAc(page);
      await kanit(page(), "MAL11-teklif-belge-taslak");
      await belgeKapat(page);
      await zorunlu(api, `/api/quotes/${q.id}/send`, { method: "POST", body: "{}" });
      await page().reload();
      await page().waitForTimeout(2000);
      olc.mal11Gonderildi = await belgeAc(page);
      await kanit(page(), "MAL11-teklif-belge-gonderildi");
      await page().getByRole("button", { name: /İndir/ }).first().click();
      await page().getByRole("menuitem", { name: "Excel" }).waitFor({ timeout: 10_000 });
      olc.mal11Excel = await page().getByRole("menuitem", { name: "Excel" }).count();
      await kanit(page(), "MAL11-teklif-belge-indir-menu");
      await page().keyboard.press("Escape");
      await belgeKapat(page);
      await zorunlu(api, `/api/quotes/${q.id}/cancel`, { method: "POST", body: JSON.stringify({ reason: "TEST iptal" }) });
      await page().reload();
      await page().waitForTimeout(2000);
      olc.mal11Iptal = await belgeAc(page);
      await kanit(page(), "MAL11-teklif-belge-iptal");
      await belgeKapat(page);
    },
    dogrula: [
      { ad: "taslak önizleme TASLAK filigranlı", sql: "SELECT 1", oku: () => olc.mal11Taslak, beklenen: (t) => /TASLAK/i.test(t ?? "") },
      { ad: "gönderilmiş teklif belgesi: kalemler var, iç not ve maliyet yok", sql: "SELECT 1", oku: () => olc.mal11Gonderildi, beklenen: (t) => /TEST Yeni desen/.test(t ?? "") && !/TEST-IC-NOT-SIZINTI|Maliyet/.test(t ?? "") },
      { ad: "İndir ▾ menüsünde Excel", sql: "SELECT 1", oku: () => olc.mal11Excel, beklenen: (n) => n === 1 },
      { ad: "iptal sonrası belge VOIDED", sql: `SELECT status::text AS s FROM printed_documents WHERE "docType" = 'SALES_QUOTE' AND "sourceId" = (SELECT id FROM sales_quotes WHERE "customerReference" = 'TEST-MAL6') ORDER BY version DESC LIMIT 1`, beklenen: (r) => r[0]?.s === "VOIDED" },
      { ad: "iptal belgesinde İPTAL filigranı", sql: "SELECT 1", oku: () => olc.mal11Iptal, beklenen: (t) => /İPTAL/i.test(t ?? "") },
    ],
  },
  {
    id: "MAL12", rol: "P",
    yol: "Fiyat listesi detayı → Yazdır / PDF / Excel → yayındaki listenin belgesi", rota: "cost/price-lists/:id",
    async yap({ git, page }) {
      await git("Fiyat Listeleri");
      await page().locator('[data-testid="pl-row"]:visible').first().click({ timeout: 20_000 });
      await page().locator('[data-testid="commercial-doc-open"]:visible').first().waitFor({ timeout: 15_000 });
      olc.mal12 = await belgeAc(page);
      await kanit(page(), "MAL12-fiyat-listesi-belge");
      await belgeKapat(page);
    },
    dogrula: [
      { ad: "fiyat listesi belgesi basıldı (PUBLISHED → ACTIVE)", sql: `SELECT count(*)::int AS n FROM printed_documents WHERE "docType" = 'PRICE_LIST' AND status = 'ACTIVE'`, beklenen: (r) => r[0]?.n >= 1 },
      { ad: "belgede maliyet sütunu yok", sql: "SELECT 1", oku: () => olc.mal12, beklenen: (t) => (t ?? "").length > 0 && !/Maliyet|Kâr/.test(t ?? "") },
    ],
  },
];
MALIYET_ADIMLARI.push(...TEKLIF_ADIMLARI, ...BELGE_ADIMLARI);

// ── MAL-7: iplik ihtiyaç planı ───────────────────────────────────────────────
const ExcelJS = createRequire(import.meta.url)("exceljs");
async function excelBasliklari(dosya, ilkBaslik) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(dosya);
  for (const ws of wb.worksheets) {
    for (let i = 1; i <= ws.rowCount; i++) {
      const v = (ws.getRow(i).values ?? []).slice(1).map((x) => (x == null ? "" : String(x).trim()));
      if (v[0] === ilkBaslik) return { basliklar: v, govde: ws.getRow(i + 1).values?.slice(1).map((x) => (x == null ? "" : String(x))) ?? [] };
    }
  }
  return null;
}


/** Dump kumaşlarında çözgü/atkı kartı yok → açık siparişli ilk kumaşa TEST kartları bağlanır (yalnız E2E DB'si). */
async function tohumIplikYapisi(api, sql) {
  const [kumas] = await sql(`SELECT i.id, i.code FROM items i JOIN order_lines l ON l."itemId" = i.id JOIN orders o ON o.id = l."orderId"
    WHERE i."itemType" = 'FABRIC' AND o.status NOT IN ('CANCELLED', 'COMPLETED') AND l."cancelledAt" IS NULL GROUP BY i.id, i.code ORDER BY i.code LIMIT 1`);
  if (!kumas) throw new Error("e2e kopyasında açık siparişli kumaş yok");
  // Fire/çekme varsayılanı yürürlükteki parametre setinden okunur (MAL2 tek başına koşulmadıysa set yok).
  if (!(await api("/api/cost/parameter-sets/active")).govde.data) {
    const taslak = (await zorunlu(api, "/api/cost/parameter-sets", { method: "POST", body: JSON.stringify(PARAMETRE_SETI) })).govde.data;
    await zorunlu(api, `/api/cost/parameter-sets/${taslak.id}/activate`, { method: "POST", body: "{}" });
  }
  const iplik = async (ad, den) => {
    const v = (await sql(`SELECT id FROM items WHERE "itemType" = 'YARN' AND name LIKE 'TEST-MAL7 %' AND name LIKE $1`, [`% ${den} DEN`]))[0]
      ?? (await zorunlu(api, "/api/items", { method: "POST", body: JSON.stringify({ name: ad, itemType: "YARN", unit: "KG" }) })).govde.data;
    await sql(`UPDATE items SET "linearDensityDen" = $2 WHERE id = $1`, [v.id, den]);
    return v.id;
  };
  const cozguIplik = await iplik("TEST-MAL7 Cozgu 75 den", 75);
  const atkiIplik = await iplik("TEST-MAL7 Atki 150 den", 150);
  const [w] = await sql(`INSERT INTO warp_specs (id, code, name, "yarnItemId", "endsCount", "takeUpPct", "reedWidthCm", "updatedAt")
    VALUES (gen_random_uuid(), 'TEST-MAL7-W', 'TEST-MAL7 çözgü', $1, 9600, 6, 310, now())
    ON CONFLICT (code) DO UPDATE SET "updatedAt" = now() RETURNING id`, [cozguIplik]);
  const [f] = await sql(`INSERT INTO weft_specs (id, code, name, "picksPerCm", "updatedAt") VALUES (gen_random_uuid(), 'TEST-MAL7-F', 'TEST-MAL7 atkı', 28, now())
    ON CONFLICT (code) DO UPDATE SET "updatedAt" = now() RETURNING id`);
  await sql(`INSERT INTO weft_spec_yarns (id, "weftSpecId", "yarnItemId", "picksInRepeat", "sortOrder", "updatedAt")
    SELECT gen_random_uuid(), $1, $2, 1, 1, now() WHERE NOT EXISTS (SELECT 1 FROM weft_spec_yarns WHERE "weftSpecId" = $1)`, [f.id, atkiIplik]);
  await sql(`UPDATE items SET "warpSpecId" = $2, "weftSpecId" = $3, "rawWidthCm" = COALESCE("rawWidthCm", 300) WHERE id = $1`, [kumas.id, w.id, f.id]);
  return kumas;
}

const IPLIK_ADIMLARI = [
  {
    id: "MAL13", rol: "P",
    yol: "Maliyet & Teklif → İplik İhtiyaç Planı → süzgeç (Depo ve üretimi düş: Hayır) → Excel", rota: "cost/yarn-need",
    async yap({ git, page, app, api, sql, ortam }) {
      await git("Maliyet & Teklif");
      await page().getByText("İplik İhtiyaç Planı").first().waitFor({ timeout: 15_000 });
      await kanit(page(), "MAL13-hub-karo");
      await page().getByText("İplik İhtiyaç Planı").first().click();
      await page().getByRole("heading", { name: "İplik İhtiyaç Planı" }).first().waitFor({ timeout: 15_000 });
      await page().getByText("Bu rapor ne sayar?").first().waitFor({ timeout: 30_000 });
      await kanit(page(), "MAL13-once");
      const listeyiGor = page().getByRole("button", { name: /İhtiyaca girmeyen/ });
      if (await listeyiGor.count()) {
        await listeyiGor.first().click();
        await page().getByRole("dialog").first().waitFor({ timeout: 10_000 });
        await kanit(page(), "MAL13-dislanan-liste");
        await page().keyboard.press("Escape");
      }
      olc.mal13Kumas = await tohumIplikYapisi(api, sql);
      await page().reload();
      await page().waitForTimeout(2000);
      await git("Maliyet & Teklif");
      await page().getByText("İplik İhtiyaç Planı").first().click();
      await page().getByRole("heading", { name: "İplik İhtiyaç Planı" }).first().waitFor({ timeout: 15_000 });
      await page().getByText("Bu rapor ne sayar?").first().waitFor({ timeout: 30_000 });
      olc.mal13Ekran = await page().locator("thead th").allInnerTexts().catch(() => []);
      olc.mal13Satir = await page().locator("tbody tr").count();
      await kanit(page(), olc.mal13Satir > 0 ? "MAL13-dolu" : "MAL13-bos");
      await page().getByRole("button", { name: /Depo ve üretimi düş/ }).first().click();
      await page().getByRole("option", { name: "Hayır" }).first().click();
      await page().waitForTimeout(500);
      const uygula = page().getByRole("dialog").getByRole("button", { name: /Uygula/ });
      if (await uygula.count()) await uygula.first().click();
      await page().waitForTimeout(2500);
      olc.mal13Cip = await page().getByRole("button", { name: /Depo ve üretimi düş/ }).first().innerText();
      await kanit(page(), "MAL13-suzgec-brut");
      const hedef = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tekserp-mal13-")), "iplik.xlsx");
      await app().evaluate(({ dialog }, p) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: p }); }, hedef);
      await page().getByRole("button", { name: /Excel/ }).first().click();
      for (let i = 0; i < 30 && !fs.existsSync(hedef); i++) await page().waitForTimeout(500);
      await page().waitForTimeout(800);
      await kanit(page(), "MAL13-excel");
      olc.mal13Excel = fs.existsSync(hedef) ? await excelBasliklari(hedef, olc.mal13Ekran[0] ?? "İplik") : null;
      if (KANIT && olc.mal13Excel) fs.writeFileSync(path.join(KANIT, "MAL13-excel-ve-ekran.json"), JSON.stringify({ ekran: olc.mal13Ekran, excel: olc.mal13Excel }, null, 1));
      // MAL14 için: muhasebe hesabı report:yarn-need iznini kaybeder (yalnız bu E2E DB'si).
      await sql(`DELETE FROM user_permissions WHERE "userId" = (SELECT id FROM users WHERE username = $1) AND "permissionId" = (SELECT id FROM permissions WHERE code = 'report:yarn-need')`, [ortam.kullanicilar.muhasebe.username]);
    },
    dogrula: [
      { ad: "sayfa sunucu tablosunu çizdi (İplik · Eksik kolonları)", sql: "SELECT 1", oku: () => (olc.mal13Ekran ?? []).join("|"), beklenen: (t) => /İplik/.test(t) && /Eksik/.test(t) },
      { ad: "süzgeç çipi sunucu beyanından 'Hayır' okur", sql: "SELECT 1", oku: () => olc.mal13Cip, beklenen: (t) => /Hayır/.test(t ?? "") },
      { ad: "Excel başlıkları = ekran başlıkları", sql: "SELECT 1", oku: () => JSON.stringify([olc.mal13Ekran, olc.mal13Excel?.basliklar]),
        beklenen: () => (olc.mal13Excel?.basliklar ?? []).length > 0 && olc.mal13Excel.basliklar.join("|") === olc.mal13Ekran.join("|") },
    ],
  },
  {
    id: "MAL14", rol: "M",
    yol: "report:yarn-need olmayan kullanıcı → palette İplik İhtiyaç Planı yok", rota: "",
    async yap({ page }) {
      await page().waitForTimeout(1500);
      const acici = page().getByText("Ara veya komut", { exact: false }).first();
      if (await acici.count()) await acici.click(); else await page().keyboard.press("Meta+k");
      await page().getByPlaceholder("Sayfa, rapor, ayar ara...").fill("İplik ihtiyaç");
      await page().waitForTimeout(600);
      olc.mal14 = await page().getByRole("option", { name: /İplik İhtiyaç Planı/ }).count();
      await kanit(page(), "MAL14-izinsiz-palet");
      await page().keyboard.press("Escape");
    },
    dogrula: [{ ad: "palette İplik İhtiyaç Planı yok", sql: "SELECT 1", oku: () => olc.mal14, beklenen: (n) => n === 0 }],
  },
];
MALIYET_ADIMLARI.push(...IPLIK_ADIMLARI);
