// =============================================================================
// Belge Tasarımcısı T4 güzergâhı — kod sekmeleri, canlı önizleme, örnek veri, PDF önizleme
//   BK1 Kod sekmesi (görsel kip): HTML+Liquid salt-okunur; yanında canlı önizleme (sandbox="")
//   BK2 "Koda geç" onayı → kod kipi + kanvas örtüsü; `{{ belge.` → sözleşmeden tamamlama listesi
//   BK3 Yasak filtre yazılır → sunucu hatası şeritte (satır/sütun) + kodda altı çizili; satır silinince temizlenir
//   BK4 Örnek veri modalı (senaryolar + "Gerçek kayıttan…") → tek_kalem → Önizleme sekmesi
//   BK5 PDF önizleme: pdf:preview → görüntüleyici penceresi (file:…pdf) — yol ÖLÇÜLÜR
// BT2 sonrası koşar (bayrak açık, örnek belge yüklü).
// =============================================================================
import fs from "node:fs";
import path from "node:path";
import { kanit } from "./adimlar-belge-tasarimci.mjs";

const KANIT = process.env.E2E_KANIT_DIZINI ?? null;
const olc = { salt: null, sandbox: null, tamamlama: null, kip: null, hata: null, temiz: null, modal: null, onizleme: null, pdf: null };
const onizleme = (page) => page().getByTitle("Belge önizlemesi").first();
const merkezSekme = (page, ad) => page().getByRole("tablist", { name: "Görünüm" }).getByRole("tab", { name: ad, exact: true }).click({ timeout: 15_000 });
const htmlEditoru = (page) => page().locator('[data-language="html"] .cm-content').first();

async function onizlemeBekle(page) {
  await page().waitForFunction(() => {
    const f = document.querySelector('iframe[title="Belge önizlemesi"]');
    return !!f && (f.getAttribute("srcdoc") ?? "").length > 200;
  }, null, { timeout: 30_000 });
}

export const BELGE_KOD_ADIMLARI = [
  {
    id: "BK1", rol: "P", gerektirir: ["BT2"],
    yol: "Belge Tasarımcısı → Kod sekmesi (görsel kip, salt-okunur) + canlı önizleme", rota: "definitions/document-designer",
    async yap({ page }) {
      await merkezSekme(page, "Kod");
      await page().getByText("Görsel kipte kod salt-okunurdur").first().waitFor({ timeout: 15_000 });
      await onizlemeBekle(page);
      olc.salt = await htmlEditoru(page).getAttribute("contenteditable");
      olc.sandbox = await onizleme(page).getAttribute("sandbox");
      await kanit(page, "BK1-kod-salt-okunur");
    },
    dogrula: [
      { ad: "görsel kipte HTML editörü düzenlenemez", sql: "SELECT 1", oku: () => olc.salt, beklenen: "false" },
      { ad: "önizleme iframe'i sandbox=\"\"", sql: "SELECT 1", oku: () => olc.sandbox, beklenen: "" },
    ],
  },
  {
    id: "BK2", rol: "P", gerektirir: ["BK1"],
    yol: "Koda geç → onay → kod kipi; HTML sonuna `{{ belge.` → tamamlama listesi", rota: "definitions/document-designer",
    async yap({ page, tikla, diyalog }) {
      await tikla("Koda geç");
      await tikla("Koda geç", { icinde: diyalog("Koda geç") });
      await page().getByText("Kod kipi", { exact: true }).waitFor({ timeout: 10_000 });
      olc.kip = await htmlEditoru(page).getAttribute("contenteditable");
      await htmlEditoru(page).click();
      await page().keyboard.press("ControlOrMeta+End");
      await page().keyboard.press("Enter");
      await page().keyboard.type("{{ belge.", { delay: 40 });
      const liste = page().locator(".cm-tooltip-autocomplete").first();
      await liste.waitFor({ timeout: 10_000 });
      olc.tamamlama = await liste.locator("li").allInnerTexts();
      await kanit(page, "BK2-tamamlama");
      await page().keyboard.press("Escape");
    },
    dogrula: [
      { ad: "kod kipinde HTML editörü düzenlenebilir", sql: "SELECT 1", oku: () => olc.kip, beklenen: "true" },
      { ad: "tamamlama sözleşme alanlarını önerir (belge.no)", sql: "SELECT 1", oku: () => JSON.stringify(olc.tamamlama?.slice(0, 4)), beklenen: () => olc.tamamlama?.some((t) => t.startsWith("belge.no")) },
    ],
  },
  {
    id: "BK3", rol: "P", gerektirir: ["BK2"],
    yol: "Yasak filtre `| tarihx` → hata şeridi (satır/sütun) + altı çizili; satır silinir → temiz", rota: "definitions/document-designer",
    async yap({ page }) {
      await page().keyboard.type("no | tarihx }}", { delay: 30 });
      const serit = page().getByTestId("onizleme-seridi").first();
      await serit.getByText(/^Satır \d+/).first().waitFor({ timeout: 20_000 });
      await page().waitForTimeout(500);
      olc.hata = { serit: await serit.getByText(/^Satır \d+/).first().innerText(), alti: await page().locator(".cm-lintRange-error").count() };
      await kanit(page, "BK3-hata-alti-cizili");
      await htmlEditoru(page).click();
      await page().keyboard.press("ControlOrMeta+End");
      await page().keyboard.press("Shift+Home");
      await page().keyboard.press("Backspace");
      await page().keyboard.press("Backspace");
      await page().waitForTimeout(1500);
      olc.temiz = await page().getByTestId("onizleme-seridi").getByText(/^Satır \d+/).count();
    },
    dogrula: [
      { ad: "şeritte konumlu Türkçe hata + kodda altı çizili", sql: "SELECT 1", oku: () => JSON.stringify(olc.hata), beklenen: () => /^Satır \d+, sütun \d+ — /.test(olc.hata?.serit ?? "") && olc.hata.alti >= 1 },
      { ad: "hatalı satır silinince şerit temiz", sql: "SELECT 1", oku: () => olc.temiz, beklenen: 0 },
    ],
  },
  {
    id: "BK4", rol: "P", gerektirir: ["BK3"],
    yol: "Örnek: … → Örnek veri modalı (senaryolar + Gerçek kayıttan…) → tek_kalem → Önizleme sekmesi", rota: "definitions/document-designer",
    async yap({ page, tikla, diyalog }) {
      await merkezSekme(page, "Önizleme");
      await onizlemeBekle(page);
      await page().getByRole("button", { name: /^Örnek: / }).first().click();
      const d = diyalog("Örnek veri seç");
      await d.getByText("Gerçek kayıttan…").waitFor({ timeout: 10_000 });
      await page().waitForTimeout(800);
      olc.modal = { senaryo: await d.getByText("tek_kalem").count(), kayit: await d.getByRole("textbox", { name: "Belge no ile ara" }).count() + (await d.getByTestId("gercek-kayit-pasif").count()) };
      await kanit(page, "BK4-ornek-veri-modali");
      await tikla("Tek ürün", { icinde: d });
      await page().waitForTimeout(1500);
      await onizlemeBekle(page);
      olc.onizleme = { sandbox: await onizleme(page).getAttribute("sandbox"), olcum: await page().getByTestId("onizleme-olcum").first().innerText(), ornek: await page().getByRole("button", { name: /^Örnek: / }).first().innerText() };
      await kanit(page, "BK4-onizleme");
    },
    dogrula: [
      { ad: "modalda senaryo + gerçek kayıt bölümü (arama ya da pasif gerekçe)", sql: "SELECT 1", oku: () => JSON.stringify(olc.modal), beklenen: () => olc.modal?.senaryo === 1 && olc.modal?.kayit === 1 },
      { ad: "önizleme tek_kalem ile, sandbox boş, ölçüm görünür", sql: "SELECT 1", oku: () => JSON.stringify(olc.onizleme), beklenen: () => olc.onizleme?.sandbox === "" && /ms ·/.test(olc.onizleme?.olcum ?? "") && /Tek ürün/.test(olc.onizleme?.ornek ?? "") },
    ],
  },
  {
    id: "BK5", rol: "P", gerektirir: ["BK4"],
    yol: "PDF önizleme → pdf:preview → görüntüleyici penceresi (ölçülür)", rota: "definitions/document-designer",
    async yap({ page, app }) {
      const once = (await app().evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length));
      await page().getByRole("button", { name: /PDF önizleme/ }).first().click();
      let pencere = null;
      for (let i = 0; i < 60 && !pencere; i++) {
        await page().waitForTimeout(500);
        pencere = await app().evaluate(({ BrowserWindow }) => {
          const w = BrowserWindow.getAllWindows().find((x) => /tekserp-onizleme-.*\.pdf$/.test(x.webContents.getURL()));
          if (!w) return null;
          const prefs = w.webContents.getLastWebPreferences?.() ?? {};
          return { url: w.webContents.getURL(), yukleniyor: w.webContents.isLoading(), preload: prefs.preload ?? null, node: prefs.nodeIntegration ?? null, sandbox: prefs.sandbox ?? null, plugins: prefs.plugins ?? null, id: w.id };
        });
      }
      const yedek = await page().getByRole("dialog").filter({ hasText: "PDF hazır" }).count();
      olc.pdf = { once, pencere, yedek };
      if (pencere) {
        await page().waitForTimeout(2500);
        // Çizim ölçülür: bellek içi oturumda eklenti düz gri pencere bırakıyordu (beyaz sayfa pikseli 0).
        const { png, beyaz } = await app().evaluate(async ({ BrowserWindow }, id) => {
          const w = BrowserWindow.fromId(id);
          const img = await w.webContents.capturePage();
          const bmp = img.toBitmap();
          let n = 0;
          for (let i = 0; i < bmp.length; i += 4) if (bmp[i] > 240 && bmp[i + 1] > 240 && bmp[i + 2] > 240) n++;
          return { png: img.toPNG().toString("base64"), beyaz: n };
        }, pencere.id);
        olc.pdf.beyaz = beyaz;
        if (KANIT) {
          fs.mkdirSync(KANIT, { recursive: true });
          fs.writeFileSync(path.join(KANIT, "BK5-pdf-goruntuleyici.png"), Buffer.from(png, "base64"));
        }
        await app().evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.close(), pencere.id);
      }
      await kanit(page, "BK5-pdf-sonrasi-panel");
    },
    dogrula: [
      { ad: "PDF görüntüleyici penceresi açıldı (ya da yedek diyaloğu)", sql: "SELECT 1", oku: () => JSON.stringify(olc.pdf), beklenen: () => !!olc.pdf?.pencere || olc.pdf?.yedek === 1 },
      { ad: "görüntüleyici PDF sayfasını çizdi (beyaz sayfa pikseli > 10000)", sql: "SELECT 1", oku: () => String(olc.pdf?.beyaz), beklenen: () => !olc.pdf?.pencere || (olc.pdf.beyaz ?? 0) > 10_000 },
      { ad: "görüntüleyicide preload yok, Node yok, sandbox", sql: "SELECT 1", oku: () => JSON.stringify(olc.pdf?.pencere), beklenen: () => !olc.pdf?.pencere || (!olc.pdf.pencere.preload && olc.pdf.pencere.node === false && olc.pdf.pencere.sandbox === true) },
    ],
  },
];
