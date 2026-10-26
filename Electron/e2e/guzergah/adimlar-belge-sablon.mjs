// =============================================================================
// GÜZERGÂH · BS — belge tasarımcısı bayrakları + "Varsayılan şablon" seçicisi (T1C)
// =============================================================================
// BS1 Baskı & Cihazlar → Belgeler: iki bayrak satırı (tasarımcı kapalıyken).
// BS2 Belge Şablonları: bayrak kapalıyken satır "kapalı" der + ayarlara bağlantı.
// BS3 Bayrak açık + yayında bir şablon: "Değiştir" → modal seçici (Sistem + şablon).
// Kanıt PNG'leri `E2E_KANIT_DIZINI` verilirse açık + koyu temada oraya da yazılır.
// =============================================================================
import fs from "node:fs";
import path from "node:path";

const KANIT = process.env.E2E_KANIT_DIZINI;
const olc = {};

async function kanit(page, ad) {
  if (!KANIT) return;
  fs.mkdirSync(KANIT, { recursive: true });
  for (const tema of ["acik", "koyu"]) {
    await page.evaluate((koyu) => document.documentElement.classList.toggle("dark", koyu), tema === "koyu");
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(KANIT, `${ad}-${tema}.png`) });
  }
  await page.evaluate(() => document.documentElement.classList.remove("dark"));
}

const bayrak = (api, acik) =>
  api("/api/feature-flags", { method: "PATCH", body: JSON.stringify({ documentDesignerEnabled: acik }) });

export const BELGE_SABLON_ADIMLARI = [
  {
    id: "BS1", rol: "P",
    yol: "Sistem → Baskı & Cihazlar → Belgeler (iki bayrak)", rota: "system/printing?tab=belgeler",
    async yap({ git, page, api }) {
      await bayrak(api, false);
      await git("Baskı & Cihazlar");
      // UX-2: yan menüde de "Belgeler" kökü var — sekme rolüyle seçilir.
      await page().getByRole("tab", { name: "Belgeler", exact: true }).first().click();
      await page().getByText("Belge tasarımcısı", { exact: true }).first().waitFor({ timeout: 15_000 });
      olc.bs1 = await page().getByText("Şablonu tasarlayan yayınlayamaz", { exact: true }).count();
      await kanit(page(), "BS1-ayarlar-belgeler");
    },
    dogrula: [{ ad: "iki bayrak satırı görünür", sql: "SELECT 1", oku: () => olc.bs1, beklenen: (n) => n > 0 }],
  },
  {
    id: "BS2", rol: "P",
    yol: "Tanımlar → Belge Şablonları → Sevk İrsaliyesi: Varsayılan şablon (tasarımcı kapalı)", rota: "definitions/document-templates",
    async yap({ git, page, api }) {
      await bayrak(api, false);
      await git("Belge Şablonları");
      const satir = page().getByTestId("default-template-row");
      await satir.waitFor({ timeout: 15_000 });
      olc.bs2 = await satir.innerText();
      await kanit(page(), "BS2-varsayilan-kapali");
    },
    dogrula: [{ ad: "satır 'kapalı' der ve ayarlara bağlanır", sql: "SELECT 1", oku: () => olc.bs2, beklenen: (t) => /kapalı/.test(t ?? "") && /Ayarlardan aç/.test(t ?? "") }],
  },
  {
    id: "BS3", rol: "P",
    yol: "Belge Şablonları → Varsayılan şablon → Değiştir (modal seçici, tasarımcı açık)", rota: "definitions/document-templates",
    async yap({ git, page, api }) {
      await bayrak(api, true);
      const ad = `TEST-BS Şablon ${Date.now().toString(36).slice(-5)}`;
      const t = (await api("/api/document-templates", { method: "POST", body: JSON.stringify({ docType: "SHIPMENT_DISPATCH", name: ad, copyFrom: { kind: "blank" } }) })).govde.data.template;
      const v = (await api(`/api/document-templates/${t.id}/versions`)).govde.data[0];
      await api(`/api/document-templates/${t.id}/publish`, { method: "POST", body: JSON.stringify({ versionId: v.id, expectedPublishedVersionId: null }) });
      await git("Belge Şablonları");
      await page().reload();
      const satir = page().getByTestId("default-template-row");
      await satir.getByRole("button", { name: "Değiştir" }).click({ timeout: 15_000 });
      await page().getByRole("dialog").getByText(ad).waitFor({ timeout: 15_000 });
      olc.bs3 = await page().getByRole("dialog").innerText();
      await kanit(page(), "BS3-secici-modal");
      await page().getByRole("dialog").getByText(ad).click();
      await page().getByRole("dialog").getByRole("button", { name: "Kaydet" }).click();
      await page().getByRole("dialog").waitFor({ state: "hidden", timeout: 10_000 });
      await kanit(page(), "BS3-varsayilan-secili");
      olc.bs3ad = ad;
    },
    dogrula: [
      { ad: "modal Sistem + yayındaki şablonu listeler", sql: "SELECT 1", oku: () => olc.bs3, beklenen: (t) => /Sistem \(bugünkü tasarım\)/.test(t ?? "") && /Sürüm 1 yayında/.test(t ?? "") },
      { ad: "seçim tür varsayılanı olarak yazıldı", uc: "/api/document-templates/assignments",
        oku: (g) => g?.data?.defaults?.find((d) => d.docType === "SHIPMENT_DISPATCH")?.template?.name, beklenen: (n) => n === olc.bs3ad },
    ],
  },
];
