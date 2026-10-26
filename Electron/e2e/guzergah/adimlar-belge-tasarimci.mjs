// =============================================================================
// GÜZERGÂH · BT — Belge Tasarımcısı iskeleti (T2)
// =============================================================================
//   BT1 Bayrak kapalı (varsayılan, fail-closed): "Belge tasarımcısı kapalı" + "Ayarlardan aç" (Sistem → Baskı & Cihazlar → Belgeler)
//   BT2 Bayrak açık (yanıt yakalanır): boş editör, A4 dikey; kanvas iframe'i sandbox'lı; örnek belge yüklenir
//   BT3 Kâğıt A5 + Yatay: kanvas genişliği/yüksekliği oranı
//   BT4 Kanvasta seçim → Stil paneli Türkçe sektörler; sandbox ölçümü (seçim çalışır, enjekte script çalışmaz)
//   BT5 Blok paleti: Veri + Sayfa kategorileri (T3)
//   BT6 Veri ağacından kalem tablosu → seçili + Özellikler (kaynak, kolonlar); getHtml'de tr[data-each] korunur
//   BT7 Veri ağacı: gruplar, etiket · tür · örnek
//   BT8 data-if kurucusu: boşken Uygula kapalı; alan + op + sabit → öznitelik dilbilgisine uyar
//   BT9 Sayfa ayarı: A4 dikey, sol kenar 30 mm → kanvas kılavuzu canlı; Taslak rozeti
//   BT10 Belge ayarları: dil Türkçe kilitli + "EN yalnız Sistem şablonunda"; stil/gelişmiş salt-okunur
//   BT11 İç alan uyarısı: Çuval listesinde iç kolonu aç → onay diyaloğu + müşteri belgesi uyarısı
//   BT12 Gidiş-dönüş ölçümü: paylaşılan fikstür örnekleri editöre yüklenir, getHtml'de yönerge sayıları korunur
//        (TASARIMCI_GRAPES_YAZ=1 → ölçülen HTML fikstürün `grapesHtml`ına yazılır; backend bekçisi §7 derler)
// Bayrak (`documents.designerEnabled`) E2E DB'sine yazılır: BT1 kapatır, BT2 açar.
// Kanıt PNG'leri (açık + koyu tema) yalnız E2E_KANIT_DIZINI verilirse yazılır.
// =============================================================================
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const KANIT = process.env.E2E_KANIT_DIZINI ?? null;
const KAPALI_METNI = "Belge tasarımcısı kapalı";
const olc = { t3: {}, yerlesim: null, kapali: null, sandbox: null, bos: null, a4: null, a5: null, secim: null, pwned: null, sektorler: null, ingilizce: null };

/** Açık ve koyu temada kanıt görüntüsü (tema sınıfı yalnız ekran için değiştirilir, kaydedilmez). */
export async function kanit(page, ad) {
  if (!KANIT) return;
  fs.mkdirSync(KANIT, { recursive: true });
  for (const tema of ["acik", "koyu"]) {
    await page().evaluate((koyu) => document.documentElement.classList.toggle("dark", koyu), tema === "koyu");
    await page().waitForTimeout(300);
    await page().screenshot({ path: path.join(KANIT, `${ad}-${tema}.png`) }).catch(() => undefined);
  }
  await page().evaluate(() => document.documentElement.classList.remove("dark"));
}

/**
 * Bayrağı E2E DB'sine yaz (T1C'den beri backend kapısı gerçek: kapalıyken `/system`, `/preview` 403)
 * ve uygulamayı tazele (oturum düşerse aynı kullanıcıyla yeniden gir).
 */
const BAYRAK_ANAHTARI = "documents.designerEnabled";
const bayragiYaz = (sql, acik) => sql(
  `INSERT INTO system_settings (key, value, description, "createdAt", "updatedAt") VALUES ($1, $2::jsonb, 'E2E fixture', now(), now())
   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "updatedAt" = now()`,
  [BAYRAK_ANAHTARI, JSON.stringify(acik)],
);

/** `GET /feature-flags` yanıtı süreç içi önbellekte (DB'ye doğrudan yazım onu geçersiz kılmaz) → panelin
 *  gördüğü değer yanıta da yazılır; tasarımcı uçlarının kapısı DB'den okur. */
async function bayrakYaniti(page, acik) {
  await page().unroute("**/api/feature-flags").catch(() => undefined);
  await page().route("**/api/feature-flags", async (route) => {
    const res = await route.fetch();
    const json = await res.json();
    if (json?.data) json.data.documentDesignerEnabled = acik;
    await route.fulfill({ response: res, json });
  });
}

export async function bayragiKur({ page, kullanici, sql }, acik = true) {
  await bayragiYaz(sql, acik);
  await bayrakYaniti(page, acik);
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
const sekme = (page, ad) => page().getByRole("tab", { name: ad, exact: true }).click({ timeout: 15_000 });

const FIKSTUR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../Teks-Erp/scripts/lib/belge-tasarimci-gidis-donus.json");
const YONERGELER = ["data-each", "data-if", "data-alan", "data-filtre", "data-tablo", "data-kolon", "data-bag-src"];

/**
 * Kanvastaki GrapesJS modeline sürücüden erişim: bileşen görünümü DOM öğesine `__gjsv` olarak
 * bağlıdır (paket iç adı) — uygulamaya e2e kancası eklemeden `em.getHtml()` ölçülür.
 */
async function gjs(page, islem, arg = null) {
  return cerceve(page).evaluate((f, [ad, a]) => {
    const d = f.contentDocument;
    const el = [d.body, ...d.body.querySelectorAll("*")].find((x) => x.__gjsv?.model?.em);
    const em = el?.__gjsv.model.em;
    if (!em) return { hata: "editör modeli bulunamadı" };
    const ed = em.getEditor();
    if (ad === "html") return { html: ed.getHtml() };
    if (ad === "secimiBirak") { ed.select(); return { ok: true }; }
    if (ad === "secimTipi") return { tip: ed.getSelected()?.get("type") ?? null, tag: ed.getSelected()?.get("tagName") ?? null };
    if (ad === "yukleVeOku") { ed.setComponents(a); return { html: ed.getHtml() }; }
    if (ad === "kilavuz") return { css: [...d.querySelectorAll("style")].map((x) => x.textContent).join("\n") };
    return { hata: `bilinmeyen işlem ${ad}` };
  }, [islem, arg]);
}
const yonergeSay = (html) => Object.fromEntries(YONERGELER.map((y) => [y, (html.match(new RegExp(`\\s${y}=`, "g")) ?? []).length]));

const cerceveOlcusu = (page) => cerceve(page).evaluate((f) => ({ w: f.clientWidth, h: f.clientHeight, sandbox: f.getAttribute("sandbox") }));

export const BELGE_TASARIMCI_ADIMLARI = [
  {
    id: "BT1", rol: "P",
    // Tazelemede cihaz duyurusu aynı oturumda ikinci kez 400 alır (koşum kalıntısı; BT2 ile aynı).
    beklenenHatalar: [{ status: 400, url: /\/api\/devices\/announce/ }],
    yol: "Tanımlar → Belge Tasarımcısı (bayrak kapalı) → boş durum + Ayarlardan aç bağlantısı", rota: "definitions/document-designer",
    async yap(ctx) {
      const { git, gor, page } = ctx;
      // Önceki koşum bayrağı açık bırakmış olabilir; açılışta okunan bayrak tazelemeyle düşer.
      await bayragiKur(ctx, false);
      await git("Belge Tasarımcısı");
      await gor(KAPALI_METNI);
      olc.kapali = await page().getByRole("button", { name: "Ayarlardan aç" }).count();
      await kanit(page, "BT1-kapali");
    },
    dogrula: [{ ad: "kapalı metni + Ayarlardan aç düğmesi görünüyor", sql: "SELECT 1", oku: () => olc.kapali, beklenen: (v) => v === 1 }],
  },
  {
    id: "BT2", rol: "P", gerektirir: ["BT1"],
    // bayragiKur() sayfayı tazeler; tazelemede cihaz duyurusu aynı oturumda ikinci kez 400 alır (koşum kalıntısı).
    beklenenHatalar: [{ status: 400, url: /\/api\/devices\/announce/ }],
    yol: "Bayrak açık → Belge Tasarımcısı → boş A4 dikey kanvas (sandbox'lı) → Örnek belge yükle", rota: "definitions/document-designer/new",
    async yap(ctx) {
      const { git, page, tikla } = ctx;
      await bayragiKur(ctx);
      await git("Belge Tasarımcısı");
      // T5: kök yol şablon listesi; kayıtsız editör "Kaydetmeden dene" ile açılır.
      await tikla("Kaydetmeden dene");
      await cerceve(page).waitFor({ timeout: 30_000 });
      await page().waitForTimeout(1500);
      olc.bos = await cerceveOlcusu(page);
      olc.sandbox = olc.bos.sandbox;
      await kanit(page, "BT2-bos-a4-dikey");
      await tikla("Örnek belge yükle");
      await page().waitForTimeout(1200);
      olc.a4 = await cerceveOlcusu(page);
      olc.yerlesim = await page().evaluate(() => {
        const f = document.querySelector("iframe.gjs-frame")?.getBoundingClientRect();
        const c = document.querySelector(".gjs-cv-canvas")?.getBoundingClientRect();
        return {
          editor: document.querySelectorAll(".gjs-editor").length,
          secici: document.querySelectorAll(".gjs-clm-tags").length,
          sigar: !!f && !!c && f.left >= c.left - 1 && f.right <= c.right + 1,
          f: f && [Math.round(f.left), Math.round(f.right)], c: c && [Math.round(c.left), Math.round(c.right)],
        };
      });
      await kanit(page, "BT2-dolu-a4-dikey");
    },
    dogrula: [
      { ad: "kanvas iframe'i sandbox=allow-same-origin", sql: "SELECT 1", oku: () => olc.sandbox, beklenen: "allow-same-origin" },
      { ad: "tek editör, tek sınıf seçici; sayfa kanvas alanına sığar", sql: "SELECT 1", oku: () => JSON.stringify(olc.yerlesim), beklenen: () => olc.yerlesim?.editor === 1 && olc.yerlesim?.secici === 1 && olc.yerlesim?.sigar },
      { ad: "A4 dikey: yükseklik/genişlik ≈ 297/210", sql: "SELECT 1", oku: () => JSON.stringify(olc.a4), beklenen: () => Math.abs(olc.a4.h / olc.a4.w - 297 / 210) < 0.02 },
    ],
  },
  {
    id: "BT3", rol: "P", gerektirir: ["BT2"],
    yol: "Kâğıt A5 + Yatay → kanvas oranı 148/210", rota: "definitions/document-designer/new",
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
    // Sandbox sondası kasıtlı: engellenen script ve `src="x"` görseli konsola düşer — beyanlı.
    beklenenHatalar: [{ konsol: /Blocked script execution .* frame is sandboxed/ }, { konsol: /ERR_FILE_NOT_FOUND/ }],
    yol: "Kanvasta başlığa tıkla → Stil paneli (Türkçe sektörler); enjekte script kanvasta çalışmaz", rota: "definitions/document-designer/new",
    async yap({ page, tikla }) {
      const baslik = page().frameLocator("iframe.gjs-frame").getByText("SEVK İRSALİYESİ").first();
      await baslik.click({ timeout: 15_000 });
      await page().waitForTimeout(600);
      olc.secim = await page().locator(".gjs-sm-sector").count();
      await tikla("Tipografi", { rol: "button" }).catch(() => page().getByText("Tipografi").first().click());
      await page().waitForTimeout(500);
      const panel = await page().locator("[aria-label='Tasarım paneli']").innerText();
      const basliklar = (await page().locator(".gjs-sm-sector .gjs-sm-sector-title").allInnerTexts()).map((t) => t.trim());
      olc.basliklar = basliklar;
      olc.sektorler = ["Yerleşim", "Tipografi", "Kenarlık", "Arka plan", "Tablo", "Baskı"].filter((s) => basliklar.some((b) => b.toLocaleLowerCase("tr") === s.toLocaleLowerCase("tr"))).length;
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
      { ad: "altı Türkçe sektör, İngilizce kalıntı yok", sql: "SELECT 1", oku: () => JSON.stringify({ s: olc.sektorler, b: olc.basliklar, en: olc.ingilizce }), beklenen: () => olc.sektorler === 6 && olc.ingilizce.length === 0 },
      { ad: "sandbox: kanvasa enjekte script/onerror ÇALIŞMAZ", sql: "SELECT 1", oku: () => JSON.stringify(olc.pwned), beklenen: () => olc.pwned?.[0] === 0 && olc.pwned?.[1] === 0 },
    ],
  },
  // ── T3: bloklar, bağlama panelleri, veri ağacı, sayfa ve belge ayarları ─────────
  {
    id: "BT5", rol: "P", gerektirir: ["BT2"],
    yol: "Belge Tasarımcısı → sol Bloklar: Veri (Veri alanı, Kalem tablosu, Toplam kutusu, Logo, Barkod, QR, İmza alanı) + Sayfa (Üst bilgi, Alt bilgi, Sayfa no, Sayfa kesmesi)", rota: "definitions/document-designer/new",
    async yap({ page }) {
      await gjs(page, "secimiBirak");
      await page().waitForTimeout(400);
      olc.t3.bloklar = await page().evaluate(() => ({
        kategoriler: [...document.querySelectorAll(".gjs-block-category .gjs-title")].map((x) => x.textContent.trim()),
        etiketler: [...document.querySelectorAll(".gjs-block-label")].map((x) => x.textContent.trim()),
      }));
      await kanit(page, "BT5-blok-paleti");
    },
    dogrula: [
      { ad: "Veri ve Sayfa kategorileri var", sql: "SELECT 1", oku: () => JSON.stringify(olc.t3.bloklar?.kategoriler), beklenen: () => ["Veri", "Sayfa"].every((k) => olc.t3.bloklar.kategoriler.includes(k)) },
      { ad: "11 belge bloğu Türkçe etiketle", sql: "SELECT 1", oku: () => JSON.stringify(olc.t3.bloklar?.etiketler), beklenen: () => ["Veri alanı", "Kalem tablosu", "Toplam kutusu", "Logo", "Barkod", "QR", "İmza alanı", "Üst bilgi", "Alt bilgi", "Sayfa no", "Sayfa kesmesi"].every((e) => olc.t3.bloklar.etiketler.includes(e)) },
    ],
  },
  {
    id: "BT7", rol: "P", gerektirir: ["BT2"],
    yol: "Sağ panel → Veri sekmesi → sözleşme ağacı (Belge açık; etiket · tür · örnek); Tablolar grubu açılır", rota: "definitions/document-designer/new",
    async yap({ page }) {
      await sekme(page, "Veri");
      const agac = page().getByTestId("veri-agaci");
      await agac.waitFor({ timeout: 15_000 });
      await agac.getByRole("button", { name: "Tablolar" }).click();
      await page().waitForTimeout(400);
      olc.t3.agac = await agac.evaluate((el) => ({
        gruplar: [...el.querySelectorAll("button[aria-expanded]")].map((b) => b.textContent.trim()),
        alan: el.querySelector('[data-yol="belge.no"]')?.textContent ?? null,
        ekle: el.querySelectorAll('button[aria-label$=" ekle"]').length,
        tasma: el.scrollWidth > el.clientWidth + 1,
      }));
      await kanit(page, "BT7-veri-agaci");
    },
    dogrula: [
      { ad: "kök grupları Türkçe (Belge · Firma · Tablolar · Toplamlar)", sql: "SELECT 1", oku: () => JSON.stringify(olc.t3.agac?.gruplar), beklenen: () => ["Belge", "Firma", "Tablolar", "Toplamlar"].every((g) => olc.t3.agac.gruplar.some((x) => x.startsWith(g))) },
      { ad: "düğümde tür + örnek değer, ekle düğmeleri, yatay taşma yok", sql: "SELECT 1", oku: () => JSON.stringify(olc.t3.agac), beklenen: () => /örn\./.test(olc.t3.agac.alan ?? "") && olc.t3.agac.ekle > 5 && !olc.t3.agac.tasma },
    ],
  },
  {
    id: "BT6", rol: "P", gerektirir: ["BT7"],
    yol: "Veri → Tablolar → Ürün listesi “+” → kalem tablosu seçili → Özellikler: kaynak + kolonlar; getHtml'de tr[data-each]", rota: "definitions/document-designer/new",
    async yap({ page }) {
      await gjs(page, "secimiBirak");
      await page().getByRole("button", { name: "Ürün listesi tablosunu ekle" }).click({ timeout: 15_000 });
      await page().waitForTimeout(800);
      olc.t3.tabloSecim = await gjs(page, "secimTipi");
      await sekme(page, "Özellikler");
      await page().waitForTimeout(500);
      const panel = page().getByTestId("baglama-paneli");
      olc.t3.tabloPanel = { metin: await panel.innerText(), kolon: await panel.locator('[aria-label="Kolonlar"] li').count() };
      const { html } = await gjs(page, "html");
      olc.t3.tabloHtml = html;
      await kanit(page, "BT6-kalem-tablosu-ozellikler");
    },
    dogrula: [
      { ad: "eklenen kalem tablosu seçili", sql: "SELECT 1", oku: () => JSON.stringify(olc.t3.tabloSecim), beklenen: () => olc.t3.tabloSecim?.tip === "item-table" },
      { ad: "Özellikler: Kalem tablosu bölümü + kolon listesi", sql: "SELECT 1", oku: () => JSON.stringify(olc.t3.tabloPanel), beklenen: () => olc.t3.tabloPanel.kolon > 0 && /Kaynak seç/.test(olc.t3.tabloPanel.metin) },
      { ad: "editör getHtml: tr[data-each=satir in tablolar.urun] korunur", sql: "SELECT 1", oku: () => (olc.t3.tabloHtml ?? "").match(/<tr[^>]*data-each="[^"]*"/)?.[0] ?? "(yok)", beklenen: () => /<tr[^>]*data-each="satir in tablolar\.urun"/.test(olc.t3.tabloHtml ?? "") },
    ],
  },
  {
    id: "BT8", rol: "P", gerektirir: ["BT7"],
    yol: "Veri → İrsaliye no “+” → Özellikler → Koşul kur… → boşken Uygula kapalı → Plaka · eşit değil · blank → Uygula", rota: "definitions/document-designer/new",
    async yap({ page, diyalog }) {
      await sekme(page, "Veri");
      await gjs(page, "secimiBirak");
      await page().getByRole("button", { name: "İrsaliye no ekle" }).click({ timeout: 15_000 });
      await page().waitForTimeout(600);
      await sekme(page, "Özellikler");
      await page().getByRole("button", { name: "Koşul kur…" }).click({ timeout: 15_000 });
      const d = diyalog("Koşul kur");
      await d.waitFor({ timeout: 10_000 });
      olc.t3.kosulBos = await d.getByRole("button", { name: "Uygula" }).isDisabled();
      await d.getByRole("button", { name: "Alan seç…" }).click();
      const secici = page().getByRole("dialog").filter({ has: page().getByLabel("Alan ara") }).first();
      await secici.getByLabel("Alan ara").fill("plaka");
      await secici.locator('[data-yol="belge.plaka"]').click({ timeout: 10_000 });
      await page().waitForTimeout(300);
      await d.getByLabel("Karşılaştırma").selectOption("!=");
      await d.getByLabel("Değer türü").selectOption("sabit");
      await d.getByLabel("Sabit değer").selectOption("blank");
      await page().waitForTimeout(300);
      olc.t3.kosulOnizleme = await d.locator("code").first().innerText().catch(() => null);
      await kanit(page, "BT8-kosul-kurucu");
      await d.getByRole("button", { name: "Uygula" }).click();
      await page().waitForTimeout(500);
      olc.t3.kosulHtml = (await gjs(page, "html")).html;
    },
    dogrula: [
      { ad: "boş satırla Uygula kapalı (geçersiz girdi engellenir)", sql: "SELECT 1", oku: () => olc.t3.kosulBos, beklenen: true },
      { ad: "kurucu önizlemesi dilbilgisine uyar", sql: "SELECT 1", oku: () => olc.t3.kosulOnizleme, beklenen: "belge.plaka != blank" },
      { ad: "editör getHtml'de data-if korunur", sql: "SELECT 1", oku: () => (olc.t3.kosulHtml ?? "").match(/data-if="[^"]*"/)?.[0] ?? "(yok)", beklenen: () => (olc.t3.kosulHtml ?? "").includes('data-if="belge.plaka != blank"') },
    ],
  },
  {
    id: "BT9", rol: "P", gerektirir: ["BT2"],
    yol: "Sağ panel → Sayfa → A4 + Dikey, Sol kenar 30 mm → kanvas kılavuzu canlı; araç çubuğunda Taslak rozeti", rota: "definitions/document-designer/new",
    async yap({ page }) {
      await sekme(page, "Sayfa");
      await page().getByRole("group", { name: "Kâğıt", exact: true }).getByRole("button", { name: "A4" }).click({ timeout: 15_000 });
      await page().getByRole("group", { name: "Yön", exact: true }).getByRole("button", { name: "Dikey" }).click();
      await page().getByLabel("Sol kenar").fill("30");
      await page().waitForTimeout(1200);
      olc.t3.kilavuz = /30mm/.test((await gjs(page, "kilavuz")).css ?? "");
      olc.t3.taslak = await page().getByText(/Taslak · kaydedilince yeni sürüm/).count();
      olc.t3.a4 = await cerceveOlcusu(page);
      await kanit(page, "BT9-sayfa-ayari");
    },
    dogrula: [
      { ad: "sol kenar 30 mm kanvas kılavuzuna yansır", sql: "SELECT 1", oku: () => olc.t3.kilavuz, beklenen: true },
      { ad: "A4 dikey geri geldi", sql: "SELECT 1", oku: () => JSON.stringify(olc.t3.a4), beklenen: () => Math.abs(olc.t3.a4.h / olc.t3.a4.w - 297 / 210) < 0.02 },
      { ad: "Taslak rozeti görünür", sql: "SELECT 1", oku: () => olc.t3.taslak, beklenen: (v) => v >= 1 },
    ],
  },
  {
    id: "BT10", rol: "P", gerektirir: ["BT2"],
    yol: "Sağ panel → Belge ayarları → dil Türkçe kilitli (EN yalnız Sistem şablonunda), imza alanı düzenlenir, stil/gelişmiş salt-okunur", rota: "definitions/document-designer/new",
    async yap({ page }) {
      await sekme(page, "Belge ayarları");
      await page().waitForTimeout(800);
      const panel = page().getByRole("complementary", { name: "Tasarım paneli" });
      // Bu kurulumda imza kutuları kapalı gelir; açılınca etiketler düzenlenebilir olur (taslağa düşer).
      const imzaAnahtari = panel.getByRole("switch", { name: "İmza kutularını bas" });
      if ((await imzaAnahtari.getAttribute("aria-checked")) !== "true") await imzaAnahtari.click();
      await page().waitForTimeout(400);
      olc.t3.ayar = {
        metin: await panel.innerText(),
        imza: await panel.getByLabel(/^İmza etiketi \d$/).count(),
        tasma: await panel.evaluate((el) => [...el.querySelectorAll("*")].some((x) => x.scrollWidth > x.clientWidth + 2 && getComputedStyle(x).overflowX === "visible" && x.clientWidth > 0)),
      };
      await kanit(page, "BT10-belge-ayarlari");
      await panel.locator(".overflow-y-auto").first().evaluate((el) => el.scrollTo(0, el.scrollHeight));
      await page().waitForTimeout(300);
      await kanit(page, "BT10-belge-ayarlari-alt");
    },
    dogrula: [
      { ad: "dil Türkçe + EN notu", sql: "SELECT 1", oku: () => olc.t3.ayar?.metin.slice(0, 200), beklenen: () => /Türkçe/.test(olc.t3.ayar.metin) && /EN yalnız Sistem şablonunda/.test(olc.t3.ayar.metin) },
      { ad: "imza etiketleri düzenlenebilir, stil/gelişmiş salt-okunur başlığı", sql: "SELECT 1", oku: () => JSON.stringify({ imza: olc.t3.ayar?.imza }), beklenen: () => olc.t3.ayar.imza >= 1 && /salt-okunur/i.test(olc.t3.ayar.metin) },
    ],
  },
  {
    id: "BT11", rol: "P", gerektirir: ["BT7"],
    yol: "Veri → Çuval listesi “+” → Özellikler → kilitli iç kolon (Sevk partisi kodu) → İç alanı aç onayı + müşteri belgesi uyarısı", rota: "definitions/document-designer/new",
    async yap({ page, diyalog }) {
      await sekme(page, "Veri");
      await gjs(page, "secimiBirak");
      // Sekme değişimi ağacı yeniden çizer (açık gruplar sıfırlanır) → Tablolar yeniden açılır.
      const tablolar = page().getByTestId("veri-agaci").getByRole("button", { name: "Tablolar" });
      if ((await tablolar.getAttribute("aria-expanded")) !== "true") await tablolar.click();
      await page().getByRole("button", { name: "Çuval listesi tablosunu ekle" }).click({ timeout: 15_000 });
      await page().waitForTimeout(800);
      await sekme(page, "Özellikler");
      await page().getByTestId("baglama-paneli").getByRole("checkbox", { name: "Sevk partisi kodu" }).click({ timeout: 15_000 });
      const d = diyalog("İç alanı aç");
      await d.waitFor({ timeout: 10_000 });
      olc.t3.ic = { metin: await d.innerText() };
      await kanit(page, "BT11-ic-alan-uyarisi");
      await d.getByRole("button", { name: "Vazgeç" }).click();
      await page().waitForTimeout(300);
      olc.t3.ic.html = (await gjs(page, "html")).html;
    },
    dogrula: [
      { ad: "onay diyaloğu müşteri belgesi uyarısıyla", sql: "SELECT 1", oku: () => olc.t3.ic?.metin.slice(0, 160), beklenen: () => /Müşteri belgesi/.test(olc.t3.ic.metin) },
      { ad: "vazgeçince iç kolon tabloya eklenmez", sql: "SELECT 1", oku: () => /data-kolon="parti_kodu"/.test(olc.t3.ic?.html ?? ""), beklenen: false },
    ],
  },
  {
    id: "BT12", rol: "P", gerektirir: ["BT2"],
    yol: "Gidiş-dönüş: paylaşılan fikstürün yönergeli örnekleri editöre yüklenir → getHtml → yönerge sayıları değişmez", rota: "definitions/document-designer/new",
    async yap({ page }) {
      const fx = JSON.parse(fs.readFileSync(FIKSTUR, "utf8"));
      const olcum = [];
      for (const ornek of fx.samples) {
        const { html } = await gjs(page, "yukleVeOku", `${ornek.html}<style>${ornek.css ?? ""}</style>`);
        olcum.push({ ad: ornek.ad, html, once: yonergeSay(ornek.html), sonra: yonergeSay(html ?? "") });
      }
      olc.t3.gidis = olcum;
      olc.t3.kayip = olcum.filter((o) => JSON.stringify(o.once) !== JSON.stringify(o.sonra)).map((o) => ({ ad: o.ad, once: o.once, sonra: o.sonra }));
      if (process.env.TASARIMCI_GRAPES_YAZ === "1") {
        fx.grapesHtml = olcum.filter((o) => o.once["data-each"] > 0).map((o) => ({ ad: o.ad, html: o.html }));
        fs.writeFileSync(FIKSTUR, JSON.stringify(fx, null, 2) + "\n");
      }
      await page().waitForTimeout(600);
      await kanit(page, "BT12-pilot-gidis-donus");
    },
    dogrula: [
      { ad: "her örnekte yönerge sayıları getHtml sonrası aynı", sql: "SELECT 1", oku: () => JSON.stringify(olc.t3.kayip), beklenen: () => Array.isArray(olc.t3.kayip) && olc.t3.kayip.length === 0 && olc.t3.gidis.length > 10 },
      { ad: "pilot sevk irsaliyesinde tr[data-each] korunur", sql: "SELECT 1", oku: () => (olc.t3.gidis?.find((o) => o.ad === "pilot-sevk-irsaliyesi")?.html ?? "").match(/<tr[^>]*data-each="[^"]*"/)?.[0] ?? "(yok)", beklenen: (v) => v !== "(yok)" },
    ],
  },
];
