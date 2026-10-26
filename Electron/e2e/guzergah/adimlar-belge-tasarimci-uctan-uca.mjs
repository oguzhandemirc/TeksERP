// =============================================================================
// Belge Tasarımcısı uçtan uca (TZ) — tek şablonun ömrü, kullanıcının yolundan
//   BZ1 Sistem → Kopyala ve düzenle → editör (v1)
//   BZ2 Kod sekmesinde alan ekle (`TZ-v2 {{ belge.no }}`) + Tasarım sekmesi örtüsü → Taslağı kaydet (v2)
//   BZ3 Önizleme sekmesi (sandbox="", yeni alan görünür) + PDF önizleme penceresi
//   BZ4 Sürümler → v2 Yayınla (senaryo özeti) → yayında
//   BZ5 Atamalar → Tür varsayılanı → Değiştir → bu şablon → kaydet
//   BZ6 Sevk edilmiş irsaliyeyi yeniden düzenle → v2 ile donar → belge diyaloğu + Excel indir
//   BZ7 v3 yayınla (farklı metin) → aynı belge hâlâ v2 tasarımı + Sürümler karşılaştır v2↔v3
//   BZ8 v1 → Bu sürümden taslak → v4 (= v1 içeriği; ileri sürümler durur)
//   BZ9 Atanmış şablonu arşivle → 409 TEMPLATE_ASSIGNED + atama listesi
// BY sonrası koşar (bayrak açık). Kalıplar: adimlar-belge-yonetim/kod/excel.
// =============================================================================
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bayragiKur, kanit } from "./adimlar-belge-tasarimci.mjs";

const DOC = "SHIPMENT_DISPATCH";
const AD = `E2E TZ ${Date.now().toString(36)}`;
const KANIT = process.env.E2E_KANIT_DIZINI;
const olc = { kip: null, serit: null, onizleme: null, pdf: null, yayin: null, atama: null, sevk: null, yeniden: null, excel: null, html: null, fark: null, geri: null, arsiv: null };
const ids = { template: null };

// Sayfa son sekmesini (Atamalar) hatırlar → listeye dönmek için Şablonlar seçilir.
const listeyeGit = async ({ git, page }) => { await git("Belge Tasarımcısı"); await page().getByRole("tab", { name: "Şablonlar", exact: true }).filter({ visible: true }).first().click({ timeout: 5_000 }).catch(() => undefined); await page().getByTestId("sablon-grubu-" + DOC).waitFor({ timeout: 30_000 }); };
const grup = (page) => page().getByTestId("sablon-grubu-" + DOC);
const satir = (page) => grup(page).getByTestId("sablon-satiri").filter({ hasText: AD }).first();
const seridi = (page) => page().getByTestId("sablon-seridi").filter({ visible: true });
const merkezSekme = (page, ad) => page().getByRole("tablist", { name: "Görünüm" }).filter({ visible: true }).getByRole("tab", { name: ad, exact: true }).click({ timeout: 15_000 });
const htmlEditoru = (page) => page().locator('[data-language="html"] .cm-content').filter({ visible: true }).first();
const kapat = async (page) => { for (let i = 0; i < 3 && (await page().getByRole("dialog").count()); i++) { await page().keyboard.press("Escape"); await page().waitForTimeout(300); } };
async function surumleriAc(ctx) {
  await listeyeGit(ctx);
  await satir(ctx.page).getByRole("button", { name: "Sürümler" }).click();
  await ctx.page().getByTestId("surum-satiri").first().waitFor({ timeout: 15_000 });
}
/** Son sürümün üstüne API ile yeni sürüm (fikstür; UI kaydı BZ2'de ölçülür). */
async function surumEkle(api, id, ek, not) {
  const list = (await api(`/api/document-templates/${id}/versions`)).govde.data;
  const v = (await api(`/api/document-templates/${id}/versions/${list[0].id}`)).govde.data;
  const r = await api(`/api/document-templates/${id}/versions`, { method: "POST", body: JSON.stringify({
    baseVersionId: v.id, editMode: v.editMode, sourceHtml: v.sourceHtml.replace("TZ-v2", ek), css: v.css, pageSettings: v.pageSettings, settings: v.settings,
    internalFields: v.internalFields, tableBindings: v.tableBindings, note: not }) });
  if (r.status !== 201) throw new Error(`sürüm kaydı ${r.status}`);
  return r.govde.data.version;
}

export const BELGE_UCTAN_UCA_ADIMLARI = [
  {
    id: "BZ1", rol: "P", gerektirir: ["BT2"],
    beklenenHatalar: [{ status: 400, url: /\/api\/devices\/announce/ }],
    yol: "Tanımlar → Belge Tasarımcısı → Sevk İrsaliyesi → Sistem → Kopyala ve düzenle → ad → editör", rota: "definitions/document-designer",
    async yap(ctx) {
      const { page, sql } = ctx;
      await bayragiKur(ctx);
      await listeyeGit(ctx);
      await grup(page).getByTestId("sistem-satiri").getByRole("button", { name: "Kopyala ve düzenle" }).click();
      const dlg = page().getByRole("dialog");
      await dlg.getByLabel("Şablon adı").fill(AD);
      await dlg.getByRole("button", { name: "Oluştur ve düzenle" }).click();
      const uyari = page().getByTestId("kopya-uyarilari");
      if (await uyari.waitFor({ timeout: 4_000 }).then(() => true, () => false)) {
        await kanit(page, "BZ1-kopya-uyarilari");
        await page().getByRole("button", { name: "Editöre geç" }).click();
      }
      await seridi(page).waitFor({ timeout: 30_000 });
      await page().waitForTimeout(1500);
      await kanit(page, "BZ1-editor");
      const r = await sql(`SELECT t.id, v."editMode" AS kip FROM document_templates t JOIN document_template_versions v ON v."templateId" = t.id AND v."versionNo" = 1 WHERE t.name = $1`, [AD]);
      ids.template = r[0]?.id ?? null;
      olc.kip = r[0]?.kip ?? null;
    },
    dogrula: [
      { ad: "kopya v1 ile doğdu", sql: `SELECT "latestVersionNo" AS n FROM document_templates WHERE name = $1`, params: [AD], oku: (r) => r[0]?.n, beklenen: 1 },
      { ad: "v1 düzenleme kipi kayıtlı", sql: "SELECT 1", oku: () => olc.kip, beklenen: (v) => v === "CODE" || v === "VISUAL" },
    ],
  },
  {
    id: "BZ2", rol: "P", gerektirir: ["BZ1"],
    yol: "Editör → Kod sekmesi → HTML sonuna alan → Tasarım sekmesi (kod kipi örtüsü) → Taslağı kaydet → Kaydet", rota: "definitions/document-designer",
    async yap(ctx) {
      const { page } = ctx;
      await merkezSekme(page, "Kod");
      const koda = page().getByRole("button", { name: "Koda geç" }).filter({ visible: true }).first();
      if (await koda.isVisible().catch(() => false)) {
        await koda.click();
        await page().getByRole("dialog").filter({ hasText: "Koda geç" }).getByRole("button", { name: "Koda geç" }).click();
      }
      await htmlEditoru(page).click();
      await page().keyboard.press("ControlOrMeta+End");
      await page().keyboard.press("Enter");
      // insertText: tamamlama/otomatik kapatma tetiklenmez → kaynak birebir.
      await page().keyboard.insertText('<p class="e2e-tz">TZ-v2 {{ belge.no }}</p>');
      await page().keyboard.press("Escape");
      await page().waitForTimeout(800);
      await kanit(page, "BZ2-kod");
      await merkezSekme(page, "Tasarım");
      await page().waitForTimeout(800);
      await kanit(page, "BZ2-tasarim-ortusu");
      await seridi(page).getByRole("button", { name: "Taslağı kaydet" }).click();
      const dlg = page().getByRole("dialog").filter({ hasText: "Taslağı kaydet" });
      await dlg.getByLabel(/Sürüm notu/).fill("TZ: belge no satırı");
      await kanit(page, "BZ2-kaydet-diyalogu");
      await dlg.getByRole("button", { name: "Kaydet", exact: true }).click();
      await seridi(page).getByText(/v2/).first().waitFor({ timeout: 15_000 });
      await kapat(page);
      olc.serit = await seridi(page).textContent();
      await kanit(page, "BZ2-kaydedildi");
    },
    dogrula: [
      { ad: "v2 yeni alanı taşıyor, kod kipinde, notlu", sql: `SELECT v."editMode" AS kip, v.note, position('TZ-v2 {{ belge.no }}' in v."sourceHtml") > 0 AS var FROM document_templates t JOIN document_template_versions v ON v."templateId" = t.id AND v."versionNo" = 2 WHERE t.name = $1`, params: [AD], oku: (r) => `${r[0]?.kip}|${r[0]?.var}|${r[0]?.note}`, beklenen: "CODE|true|TZ: belge no satırı" },
      { ad: "şeritte v2", sql: "SELECT 1", oku: () => /v2/.test(olc.serit ?? ""), beklenen: true },
    ],
  },
  {
    id: "BZ3", rol: "P", gerektirir: ["BZ2"],
    yol: "Editör → Önizleme sekmesi (canlı, sandbox) → PDF önizleme penceresi", rota: "definitions/document-designer",
    async yap(ctx) {
      const { page, app } = ctx;
      await merkezSekme(page, "Önizleme");
      await page().waitForFunction(() => [...document.querySelectorAll('iframe[title="Belge önizlemesi"]')].some((f) => /TZ-v2/.test(f.getAttribute("srcdoc") ?? "")), null, { timeout: 30_000 });
      const f = page().getByTitle("Belge önizlemesi").filter({ visible: true }).first();
      olc.onizleme = { sandbox: await f.getAttribute("sandbox"), cozuldu: !/\{\{\s*belge\.no/.test((await f.getAttribute("srcdoc")) ?? "") };
      await page().waitForTimeout(800);
      await kanit(page, "BZ3-onizleme");
      await page().getByRole("button", { name: /PDF önizleme/ }).filter({ visible: true }).first().click();
      let pencere = null;
      for (let i = 0; i < 60 && !pencere; i++) {
        await page().waitForTimeout(500);
        pencere = await app().evaluate(({ BrowserWindow }) => {
          const w = BrowserWindow.getAllWindows().find((x) => /tekserp-onizleme-.*\.pdf$/.test(x.webContents.getURL()));
          return w ? { id: w.id } : null;
        });
      }
      olc.pdf = { pencere: !!pencere, yedek: await page().getByRole("dialog").filter({ hasText: "PDF hazır" }).count() };
      if (pencere) {
        await page().waitForTimeout(2500);
        const png = await app().evaluate(async ({ BrowserWindow }, id) => (await BrowserWindow.fromId(id).webContents.capturePage()).toPNG().toString("base64"), pencere.id);
        if (KANIT) { fs.mkdirSync(KANIT, { recursive: true }); fs.writeFileSync(path.join(KANIT, "BZ3-pdf-goruntuleyici.png"), Buffer.from(png, "base64")); }
        await app().evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.close(), pencere.id);
      }
      await kapat(page);
    },
    dogrula: [
      { ad: "önizleme sandbox=\"\" ve alan çözüldü", sql: "SELECT 1", oku: () => JSON.stringify(olc.onizleme), beklenen: () => olc.onizleme?.sandbox === "" && olc.onizleme?.cozuldu === true },
      { ad: "PDF penceresi (ya da PDF hazır yedeği) açıldı", sql: "SELECT 1", oku: () => JSON.stringify(olc.pdf), beklenen: () => olc.pdf?.pencere || olc.pdf?.yedek > 0 },
    ],
  },
  {
    id: "BZ4", rol: "P", gerektirir: ["BZ2"],
    yol: "Şablonlar → satır → Sürümler → v2 → Yayınla → onay (senaryo özeti) → Yayınla", rota: "definitions/document-designer",
    async yap(ctx) {
      const { page } = ctx;
      await surumleriAc(ctx);
      await page().getByTestId("surum-satiri").first().getByRole("button", { name: "Yayınla" }).click();
      await page().getByText(/Senaryolar: \d+ başarılı/).waitFor({ timeout: 60_000 });
      olc.yayin = await page().getByTestId("senaryo-ozeti").textContent();
      await kanit(page, "BZ4-yayin-onayi");
      await page().getByRole("dialog").filter({ hasText: "yayınlansın mı" }).getByRole("button", { name: "Yayınla", exact: true }).click();
      await page().getByText("v2 yayında.").waitFor({ timeout: 30_000 });
      await kapat(page);
    },
    dogrula: [
      { ad: "senaryolarda hata yok", sql: "SELECT 1", oku: () => / 0 hatalı/.test(olc.yayin ?? ""), beklenen: true },
      { ad: "yayındaki sürüm v2", sql: `SELECT v."versionNo" AS n FROM document_templates t JOIN document_template_versions v ON v.id = t."publishedVersionId" WHERE t.name = $1`, params: [AD], oku: (r) => r[0]?.n, beklenen: 2 },
    ],
  },
  {
    id: "BZ5", rol: "P", gerektirir: ["BZ4"],
    yol: "Belge Tasarımcısı → Atamalar → Sevk İrsaliyesi → Tür varsayılanı: Değiştir → şablon → Atamayı kaydet", rota: "definitions/document-designer",
    async yap(ctx) {
      const { page } = ctx;
      await listeyeGit(ctx);
      await page().getByRole("tab", { name: "Atamalar" }).click();
      await page().getByTestId("atama-paneli").waitFor({ timeout: 15_000 });
      await page().getByRole("navigation", { name: "Belge türleri" }).getByRole("button", { name: /^Sevk İrsaliyesi/ }).click();
      await page().getByTestId("atama-paneli").getByRole("button", { name: "Değiştir" }).click();
      await page().getByRole("radio", { name: new RegExp(AD) }).click();
      await page().waitForTimeout(600);
      olc.atama = await page().getByRole("dialog").last().textContent();
      await kanit(page, "BZ5-atama-onayi");
      await page().getByRole("button", { name: "Atamayı kaydet" }).click();
      await page().getByTestId("atama-paneli").getByText(AD).first().waitFor({ timeout: 15_000 });
      await kanit(page, "BZ5-atamalar");
    },
    dogrula: [
      { ad: "tür varsayılanı bu şablon", sql: `SELECT t.name FROM document_template_defaults d JOIN document_templates t ON t.id = d."templateId" WHERE d."docType" = 'SHIPMENT_DISPATCH'`, oku: (r) => r[0]?.name, beklenen: AD },
    ],
  },
  {
    id: "BZ6", rol: "P", gerektirir: ["BZ5"],
    yol: "Operasyon → Sevkiyatlar → sevk edilmiş satır → Sevk İrsaliyesi (yeniden düzenlenmiş, v2 tasarımı) → İndir ▾ → Excel", rota: "operations/shipments",
    async yap({ git, gor, page, app, api, sql }) {
      // Profilsiz müşteri: tür varsayılanı geçerli (BY7 profil ezmesi bu sevkiyata değmez).
      const [s] = await sql(
        `SELECT s.id, s."shipmentNo" AS no FROM shipments s JOIN customers c ON c.id = s."customerId"
           WHERE s.status = 'DISPATCHED' AND c."documentProfileId" IS NULL
             AND EXISTS (SELECT 1 FROM printed_documents p WHERE p."docType" = 'SHIPMENT_DISPATCH' AND p."sourceId" = s.id AND p.status = 'ACTIVE')
           ORDER BY s."dispatchedAt" DESC NULLS LAST LIMIT 1`,
      );
      if (!s) throw new Error("e2e kopyasında profilsiz müşteriye sevk irsaliyesi yok");
      olc.sevk = s;
      const r = await api(`/api/printed-documents/${DOC}/${s.id}/reissue`, { method: "POST", body: JSON.stringify({ reason: "TZ e2e: şablonla yeniden düzenleme" }) });
      olc.yeniden = r.status;
      await git("Sevkiyatlar");
      const tarihKaldir = page().getByTitle("Tarih filtresini kaldır").first();
      if (await tarihKaldir.count()) await tarihKaldir.click();
      await page().getByPlaceholder("Sevkiyat no, firma, parti kodu / adı, çuval no ara…").fill(s.no);
      await page().getByText(s.no, { exact: true }).first().click({ timeout: 20_000 });
      await page().getByRole("button", { name: "Sevk İrsaliyesi" }).first().click({ timeout: 15_000 });
      const diyalog = page().getByRole("dialog").last();
      await gor(diyalog.getByRole("button", { name: /İndir/ }).first(), { sure: 30_000 });
      await page().waitForTimeout(2500);
      await kanit(page, "BZ6-belge");
      await diyalog.getByRole("button", { name: /İndir/ }).first().click();
      const excel = page().getByRole("menuitem", { name: "Excel", exact: true });
      await excel.waitFor({ timeout: 30_000 });
      const hedef = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tekserp-bz-")), "irsaliye.xlsx");
      await app().evaluate(({ dialog }, p) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: p }); }, hedef);
      await excel.click();
      for (let i = 0; i < 30 && !fs.existsSync(hedef); i++) await page().waitForTimeout(500);
      olc.excel = fs.existsSync(hedef) ? fs.statSync(hedef).size : 0;
      await kapat(page);
    },
    dogrula: [
      { ad: "yeniden düzenleme 200/201", sql: "SELECT 1", oku: () => olc.yeniden, beklenen: (n) => n === 200 || n === 201 },
      { ad: "etkin irsaliye v2 şablonuyla dondu", sql: `SELECT p.snapshot->'template'->>'versionNo' AS n, p.snapshot->'template'->>'name' AS ad FROM printed_documents p WHERE p."docType" = 'SHIPMENT_DISPATCH' AND p.status = 'ACTIVE' AND p."sourceId" = (SELECT id FROM shipments WHERE "shipmentNo" = $1)`, params: () => [olc.sevk?.no], oku: (r) => `${r[0]?.n}|${r[0]?.ad}`, beklenen: (v) => v === `2|${AD}` },
      { ad: "Excel dosyası yazıldı", sql: "SELECT 1", oku: () => olc.excel, beklenen: (n) => n > 1000 },
    ],
  },
  {
    id: "BZ7", rol: "P", gerektirir: ["BZ6"],
    yol: "v3 (farklı metin) yayınla → aynı irsaliye /html hâlâ v2 → Sürümler → v2 + v3 → Karşılaştır → HTML farkı", rota: "definitions/document-designer",
    async yap(ctx) {
      const { page, api } = ctx;
      const id = ids.template;
      const v3 = await surumEkle(api, id, "TZ-v3", "TZ: v3 metni");
      const t = (await api(`/api/document-templates/${id}`)).govde?.data;
      const pub = await api(`/api/document-templates/${id}/publish`, { method: "POST", body: JSON.stringify({ versionId: v3.id, expectedPublishedVersionId: t?.publishedVersionId ?? t?.template?.publishedVersionId ?? null }) });
      if (pub.status !== 200 && pub.status !== 201) throw new Error(`v3 yayını ${pub.status} ${JSON.stringify(pub.govde?.error ?? "")}`);
      const h = await api(`/api/printed-documents/${DOC}/${olc.sevk.id}/html`);
      olc.html = { surum: Number(h.basliklar?.["x-document-template-version"] ?? NaN), v2: /TZ-v2/.test(h.metin ?? ""), v3: /TZ-v3/.test(h.metin ?? "") };
      await surumleriAc(ctx);
      await page().getByRole("checkbox", { name: "v2 karşılaştırmaya ekle" }).click();
      await page().getByRole("checkbox", { name: "v3 karşılaştırmaya ekle" }).click();
      await page().getByRole("button", { name: "Karşılaştır" }).click();
      await page().getByTitle("v3 önizlemesi").waitFor({ timeout: 30_000 });
      await page().waitForTimeout(1200);
      await kanit(page, "BZ7-karsilastir-onizleme");
      await page().getByRole("tab", { name: "HTML farkı" }).click();
      await page().getByTestId("fark-HTML").waitFor();
      olc.fark = await page().getByTestId("fark-HTML").textContent();
      await kanit(page, "BZ7-karsilastir-fark");
      await kapat(page);
    },
    dogrula: [
      { ad: "yayın v3", sql: `SELECT v."versionNo" AS n FROM document_templates t JOIN document_template_versions v ON v.id = t."publishedVersionId" WHERE t.name = $1`, params: [AD], oku: (r) => r[0]?.n, beklenen: 3 },
      { ad: "basılmış belge donmuş: /html v2 tasarımı (v3 metni yok)", sql: "SELECT 1", oku: () => JSON.stringify(olc.html), beklenen: () => olc.html?.surum === 2 && olc.html.v2 && !olc.html.v3 },
      { ad: "farkta TZ-v2 → TZ-v3", sql: "SELECT 1", oku: () => /TZ-v2/.test(olc.fark ?? "") && /TZ-v3/.test(olc.fark ?? ""), beklenen: true },
    ],
  },
  {
    id: "BZ8", rol: "P", gerektirir: ["BZ7"],
    yol: "Sürümler → v1 → Bu sürümden taslak → onay → Yeni sürüm aç (v4)", rota: "definitions/document-designer",
    async yap(ctx) {
      const { page } = ctx;
      await surumleriAc(ctx);
      await page().getByTestId("surum-satiri").filter({ hasText: "v1" }).last().getByRole("button", { name: "Bu sürümden taslak" }).click();
      await page().getByTestId("geri-alma-aciklamasi").waitFor();
      olc.geri = await page().getByTestId("geri-alma-aciklamasi").textContent();
      await kanit(page, "BZ8-geri-alma-onayi");
      await page().getByRole("button", { name: "Yeni sürüm aç" }).click();
      await page().getByTestId("surum-satiri").nth(3).waitFor({ timeout: 15_000 });
      await kanit(page, "BZ8-geri-alma-sonrasi");
      await kapat(page);
    },
    dogrula: [
      { ad: "onay metni: v4 açılır, ileri sürümler silinmez", sql: "SELECT 1", oku: () => /v4/.test(olc.geri ?? "") && /silinmez/.test(olc.geri ?? ""), beklenen: true },
      { ad: "4 sürüm; v4 = v1 içeriği; yayın hâlâ v3", sql: `SELECT count(*)::int AS n, (SELECT a."contentHash" = b."contentHash" FROM document_template_versions a, document_template_versions b WHERE a."templateId" = t.id AND a."versionNo" = 1 AND b."templateId" = t.id AND b."versionNo" = 4) AS ayni, (SELECT "versionNo" FROM document_template_versions WHERE id = t."publishedVersionId") AS yayin FROM document_templates t JOIN document_template_versions v ON v."templateId" = t.id WHERE t.name = $1 GROUP BY t.id`, params: [AD], oku: (r) => `${r[0]?.n}:${r[0]?.ayni}:${r[0]?.yayin}`, beklenen: "4:true:3" },
    ],
  },
  {
    id: "BZ9", rol: "P", gerektirir: ["BZ5"],
    yol: "Atanmış şablonu arşivle (API) → 409 TEMPLATE_ASSIGNED + atama listesi; şablon etkin kalır", rota: "definitions/document-designer",
    async yap(ctx) {
      const { api, page } = ctx;
      const r = await api(`/api/document-templates/${ids.template}/archive`, { method: "POST", body: "{}" });
      olc.arsiv = { status: r.status, code: r.govde?.details?.code ?? r.govde?.error?.details?.code ?? null, liste: JSON.stringify(r.govde ?? {}) };
      await listeyeGit(ctx);
      await kanit(page, "BZ9-liste");
    },
    dogrula: [
      { ad: "409 TEMPLATE_ASSIGNED", sql: "SELECT 1", oku: () => `${olc.arsiv?.status}|${olc.arsiv?.code}`, beklenen: "409|TEMPLATE_ASSIGNED" },
      { ad: "ayrıntıda tür varsayılanı listeli", sql: "SELECT 1", oku: () => olc.arsiv?.liste, beklenen: (v) => /SHIPMENT_DISPATCH/.test(v ?? "") },
      { ad: "şablon arşivlenmedi", sql: `SELECT "archivedAt" IS NULL AS ok FROM document_templates WHERE name = $1`, params: [AD], oku: (r) => r[0]?.ok, beklenen: true },
    ],
  },
];
