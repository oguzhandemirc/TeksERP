// =============================================================================
// GÜZERGÂH · BT — Belge Tasarımcısı iskeleti (T2)
// =============================================================================
//   BT1 Bayrak kapalı (varsayılan, fail-closed): "Belge tasarımcısı kapalı" + "Ayarlardan aç" (Sistem → Baskı & Cihazlar → Belgeler)
//   BT2 Bayrak açık (yanıt yakalanır): boş editör, A4 dikey; kanvas iframe'i sandbox'lı; örnek belge yüklenir
//   BT3 Kâğıt A5 + Yatay: kanvas genişliği/yüksekliği oranı
//   BT4 Kanvasta seçim → Stil paneli Türkçe sektörler; sandbox ölçümü (seçim çalışır, enjekte script çalışmaz)
// Bayrak alanı backend'e T1C'de gelir; o güne dek açık hâl `GET /api/feature-flags` yanıtına
// `documentDesignerEnabled:true` eklenerek ölçülür (build'e ve DB'ye dokunulmaz).
// Kanıt PNG'leri (açık + koyu tema) yalnız E2E_KANIT_DIZINI verilirse yazılır.
// =============================================================================
import fs from "node:fs";
import path from "node:path";

const KANIT = process.env.E2E_KANIT_DIZINI ?? null;
const KAPALI_METNI = "Belge tasarımcısı kapalı";
const olc = { kapali: null, sandbox: null, bos: null, a4: null, a5: null, secim: null, pwned: null, sektorler: null, ingilizce: null };

/** Açık ve koyu temada kanıt görüntüsü (tema sınıfı yalnız ekran için değiştirilir, kaydedilmez). */
async function kanit(page, ad) {
  if (!KANIT) return;
  fs.mkdirSync(KANIT, { recursive: true });
  for (const tema of ["acik", "koyu"]) {
    await page().evaluate((koyu) => document.documentElement.classList.toggle("dark", koyu), tema === "koyu");
    await page().waitForTimeout(300);
    await page().screenshot({ path: path.join(KANIT, `${ad}-${tema}.png`) }).catch(() => undefined);
  }
  await page().evaluate(() => document.documentElement.classList.remove("dark"));
}

/** Bayrak yanıtına alanı ekle, uygulamayı tazele (oturum düşerse aynı kullanıcıyla yeniden gir). */
async function bayragiAc({ page, kullanici }) {
  await page().route("**/api/feature-flags", async (route) => {
    const res = await route.fetch();
    const json = await res.json();
    if (json?.data) json.data.documentDesignerEnabled = true;
    await route.fulfill({ response: res, json });
  });
  await page().reload();
  const giris = page().getByPlaceholder("ör. admin");
  if (await giris.waitFor({ timeout: 8_000 }).then(() => true, () => false)) {
    await giris.fill(kullanici.username);
    await page().locator('input[type="password"]').first().fill(kullanici.password);
    await page().keyboard.press("Enter");
    await giris.waitFor({ state: "detached", timeout: 30_000 });
  }
  await page().waitForTimeout(1500);
}

const cerceve = (page) => page().locator("iframe.gjs-frame").first();
const cerceveOlcusu = (page) => cerceve(page).evaluate((f) => ({ w: f.clientWidth, h: f.clientHeight, sandbox: f.getAttribute("sandbox") }));

export const BELGE_TASARIMCI_ADIMLARI = [
  {
    id: "BT1", rol: "P",
    yol: "Tanımlar → Belge Tasarımcısı (bayrak kapalı) → boş durum + Ayarlardan aç bağlantısı", rota: "definitions/document-designer",
    async yap({ git, gor, page }) {
      await git("Belge Tasarımcısı");
      await gor(KAPALI_METNI);
      olc.kapali = await page().getByRole("button", { name: "Ayarlardan aç" }).count();
      await kanit(page, "BT1-kapali");
    },
    dogrula: [{ ad: "kapalı metni + Ayarlardan aç düğmesi görünüyor", sql: "SELECT 1", oku: () => olc.kapali, beklenen: (v) => v === 1 }],
  },
  {
    id: "BT2", rol: "P", gerektirir: ["BT1"],
    yol: "Bayrak açık → Belge Tasarımcısı → boş A4 dikey kanvas (sandbox'lı) → Örnek belge yükle", rota: "definitions/document-designer",
    async yap(ctx) {
      const { git, page, tikla } = ctx;
      await bayragiAc(ctx);
      await git("Belge Tasarımcısı");
      await cerceve(page).waitFor({ timeout: 30_000 });
      await page().waitForTimeout(1500);
      olc.bos = await cerceveOlcusu(page);
      olc.sandbox = olc.bos.sandbox;
      await kanit(page, "BT2-bos-a4-dikey");
      await tikla("Örnek belge yükle");
      await page().waitForTimeout(1200);
      olc.a4 = await cerceveOlcusu(page);
      await kanit(page, "BT2-dolu-a4-dikey");
    },
    dogrula: [
      { ad: "kanvas iframe'i sandbox=allow-same-origin", sql: "SELECT 1", oku: () => olc.sandbox, beklenen: "allow-same-origin" },
      { ad: "A4 dikey: yükseklik/genişlik ≈ 297/210", sql: "SELECT 1", oku: () => JSON.stringify(olc.a4), beklenen: () => Math.abs(olc.a4.h / olc.a4.w - 297 / 210) < 0.02 },
    ],
  },
  {
    id: "BT3", rol: "P", gerektirir: ["BT2"],
    yol: "Kâğıt A5 + Yatay → kanvas oranı 148/210", rota: "definitions/document-designer",
    async yap({ page, sec, tikla }) {
      await sec(page().getByRole("combobox", { name: "Kâğıt boyu" }), "A5");
      await tikla("Yatay");
      await page().waitForTimeout(1500);
      olc.a5 = await cerceveOlcusu(page);
      await kanit(page, "BT3-a5-yatay");
    },
    dogrula: [{ ad: "A5 yatay: yükseklik/genişlik ≈ 148/210", sql: "SELECT 1", oku: () => JSON.stringify(olc.a5), beklenen: () => Math.abs(olc.a5.h / olc.a5.w - 148 / 210) < 0.02 }],
  },
  {
    id: "BT4", rol: "P", gerektirir: ["BT2"],
    yol: "Kanvasta başlığa tıkla → Stil paneli (Türkçe sektörler); enjekte script kanvasta çalışmaz", rota: "definitions/document-designer",
    async yap({ page, tikla }) {
      const baslik = page().frameLocator("iframe.gjs-frame").getByText("SEVK İRSALİYESİ").first();
      await baslik.click({ timeout: 15_000 });
      await page().waitForTimeout(600);
      olc.secim = await page().locator(".gjs-sm-sector").count();
      await tikla("Tipografi", { rol: "button" }).catch(() => page().getByText("Tipografi").first().click());
      await page().waitForTimeout(500);
      const panel = await page().locator("[aria-label='Tasarım paneli']").innerText();
      olc.sektorler = ["Yerleşim", "Tipografi", "Kenarlık", "Arka plan", "Tablo", "Baskı"].filter((s) => panel.includes(s)).length;
      olc.ingilizce = ["Typography", "Layout", "Decorations", "General", "Select an element", "Classes"].filter((s) => panel.includes(s));
      await kanit(page, "BT4-stil-paneli");
      olc.pwned = await cerceve(page).evaluate(async (f) => {
        const d = f.contentDocument;
        const s = d.createElement("script");
        s.textContent = "window.parent.__t2Pwned = 1";
        d.head.appendChild(s);
        d.body.insertAdjacentHTML("beforeend", '<img src="x" onerror="window.parent.__t2Pwned2 = 1">');
        await new Promise((r) => setTimeout(r, 400));
        return [window.__t2Pwned ?? 0, window.__t2Pwned2 ?? 0];
      });
    },
    dogrula: [
      { ad: "seçim çalışıyor: stil sektörleri çizildi", sql: "SELECT 1", oku: () => olc.secim, beklenen: (v) => v >= 6 },
      { ad: "altı Türkçe sektör, İngilizce kalıntı yok", sql: "SELECT 1", oku: () => JSON.stringify({ s: olc.sektorler, en: olc.ingilizce }), beklenen: () => olc.sektorler === 6 && olc.ingilizce.length === 0 },
      { ad: "sandbox: kanvasa enjekte script/onerror ÇALIŞMAZ", sql: "SELECT 1", oku: () => JSON.stringify(olc.pwned), beklenen: () => olc.pwned?.[0] === 0 && olc.pwned?.[1] === 0 },
    ],
  },
];
