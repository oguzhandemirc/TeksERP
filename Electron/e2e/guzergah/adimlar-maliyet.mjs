// =============================================================================
// GÜZERGÂH · MAL — maliyet panel ekranları (MAL-3)
// =============================================================================
// MAL1 boş durumlar (hub, parametreler, iplik fiyatları, tarifeler, kartlar, hesaplayıcı).
// MAL2 API ile tohum (parametre seti yürürlükte, iplik fiyatı, tarife) → dolu sayfalar.
// MAL3 maliyet kartı listesi + detay sekmeleri (Yapı · Döküm · Sürümler).
// MAL4 Hızlı Hesaplayıcı elle yapı: döviz fiyatlı iplik, kur yok → "kur yok" eksikliği (1 varsayılmaz);
//      kur girilince döküm; sonunda muhasebe hesabından cost:* izinleri alınır (MAL5 için).
// MAL5 cost:read OLMAYAN kullanıcı: menüde ve palette maliyet yüzeyi yok.
// Kanıt PNG'leri `E2E_KANIT_DIZINI` verilirse açık + koyu, geniş + dar olarak oraya da yazılır.
// =============================================================================
import fs from "node:fs";
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
      // MAL5 için: muhasebe hesabı cost:* izinlerini kaybeder (yalnız bu E2E DB'si).
      await sql(`DELETE FROM user_permissions WHERE "userId" = (SELECT id FROM users WHERE username = $1) AND "permissionId" IN (SELECT id FROM permissions WHERE code LIKE 'cost:%')`, [ortam.kullanicilar.muhasebe.username]);
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
