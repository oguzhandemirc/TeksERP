// =============================================================================
// GÜZERGÂH · BX — şablonlu belgede PDF = Excel (TX)
// =============================================================================
// BX1 Görsel kalem tablolu sevk irsaliyesi şablonu (API ile: kopya → görsel sürüm → yayın →
//     varsayılan) + sevk edilmiş bir sevkiyatın irsaliyesi yeniden düzenlenir (v+1 şablonla donar).
//     Operasyon → Sevkiyatlar → satır → "Sevk İrsaliyesi" → "İndir ▾" → "Excel": indirilen dosyanın
//     tablo başlıkları ve ilk satırı `/tables` ile aynı; ürün tablosu ters sıralı bağı izler
//     (`/html` `data-kolon` ↔ `/tables` hücre eşitliği backend bekçisinde: test_belge_sablon_excel_esit).
// Kanıt PNG'leri `E2E_KANIT_DIZINI` verilirse açık + koyu, geniş + dar pencerede yazılır.
// =============================================================================
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const ExcelJS = createRequire(import.meta.url)("exceljs");
const KANIT = process.env.E2E_KANIT_DIZINI;
const olc = {};
const TIP = "SHIPMENT_DISPATCH";

async function kanit(page, app, ad) {
  if (!KANIT) return;
  fs.mkdirSync(KANIT, { recursive: true });
  for (const [olcu, w, h] of [["genis", 1600, 1000], ["dar", 1024, 760]]) {
    await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0]?.setSize(w, h), [w, h]);
    await page.waitForTimeout(500);
    for (const tema of ["acik", "koyu"]) {
      await page.evaluate((koyu) => document.documentElement.classList.toggle("dark", koyu), tema === "koyu");
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(KANIT, `${ad}-${olcu}-${tema}.png`) });
    }
  }
  await page.evaluate(() => document.documentElement.classList.remove("dark"));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1600, 1000));
}

// Panel `DocumentDesigner/binding/itemTable.ts` kalıbı (müşteri kolonları; ürün tablosunda sıra ters).
const q = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const filtre = (k) =>
  k.tur === "sayi" ? (k.birim === "m" ? "metre" : k.birim === "kg" ? "kg" : `sayi: ${k.ondalik ?? 0}`) : k.tur === "tarih" ? "tarih" : "";
function kalemTablosu(t, kolonlar) {
  const cols = kolonlar.map((y) => t.kolonlar.find((k) => k.yol === y));
  const th = cols.map((k) => `<th data-kolon="${k.yol}">${q(k.etiket)}</th>`).join("");
  const td = cols.map((k) => `<td data-kolon="${k.yol}" data-alan="satir.${k.yol}"${filtre(k) ? ` data-filtre="${q(filtre(k))}"` : ""}>x</td>`).join("");
  return `<table class="kalem-tablosu" data-tablo="${t.anahtar}"><thead><tr>${th}</tr></thead><tbody><tr data-each="satir in tablolar.${t.anahtar}">${td}</tr></tbody></table>`;
}

async function sablonKur(api, sql) {
  await api("/api/feature-flags", { method: "PATCH", body: JSON.stringify({ documentDesignerEnabled: true }) });
  const sozlesme = (await api(`/api/document-templates/contracts/${TIP}`)).govde.data;
  const yerlesim = ["urun", "cuval", "ceki"].map((a) => {
    const t = sozlesme.tablolar.find((x) => x.anahtar === a);
    const musteri = t.kolonlar.filter((k) => k.sinif === "musteri").map((k) => k.yol);
    return [t, a === "urun" ? [...musteri].reverse() : musteri];
  });
  const yeni = await api("/api/document-templates", { method: "POST", body: JSON.stringify({ docType: TIP, name: `TEST-TX Excel ${Date.now()}`, copyFrom: { kind: "system" } }) });
  const id = yeni.govde.data.template.id;
  const [v1] = await sql(`SELECT id, css, "pageSettings", settings FROM document_template_versions WHERE "templateId" = $1 AND "versionNo" = 1`, [id]);
  const kayit = await api(`/api/document-templates/${id}/versions`, {
    method: "POST",
    body: JSON.stringify({
      baseVersionId: v1.id, editMode: "VISUAL", css: v1.css, pageSettings: v1.pageSettings, settings: v1.settings, internalFields: [],
      sourceHtml: yerlesim.map(([t, k]) => kalemTablosu(t, k)).join("\n"),
      tableBindings: Object.fromEntries(yerlesim.map(([t, k]) => [t.anahtar, { kaynak: `tablolar.${t.anahtar}`, degisken: "satir", kolonlar: k }])),
    }),
  });
  const vid = kayit.govde.data.version.id;
  olc.kayitUyari = kayit.govde.data.warnings;
  await api(`/api/document-templates/${id}/publish`, { method: "POST", body: JSON.stringify({ versionId: vid, expectedPublishedVersionId: null }) });
  await api(`/api/document-templates/defaults/${TIP}`, { method: "PUT", body: JSON.stringify({ templateId: id }) });
  olc.sablon = id;
  olc.beklenenUrun = yerlesim[0][1].join(",");
}

/** Excel sayfalarındaki satırlar (hücre metinleri) — tablo başlık satırı payload başlıklarıyla aranır. */
async function excelOku(dosya) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(dosya);
  const satirlar = [];
  // Her kalem tablosu kendi sayfasında olabilir (`docTablesToSheets`) — bütün sayfalar okunur.
  for (const ws of wb.worksheets) {
    for (let i = 1; i <= ws.rowCount; i++) {
      const v = ws.getRow(i).values ?? [];
      satirlar.push(Array.from({ length: Math.max(0, v.length - 1) }, (_, j) => v[j + 1]).map((x) => (x && typeof x === "object" && "result" in x ? x.result : x)).map((x) => (x == null ? "" : String(x).trim())));
    }
  }
  return satirlar;
}

export const BELGE_EXCEL_ADIMLARI = [
  {
    id: "BX1", rol: "P",
    yol: "Operasyon → Sevkiyatlar → sevk edilmiş satır → Sevk İrsaliyesi → İndir ▾ → Excel (şablonlu belge: Excel = PDF)", rota: "operations/shipments",
    async yap({ git, gor, page, app, api, sql }) {
      const [s] = await sql(
        `SELECT s.id, s."shipmentNo" AS no FROM shipments s
           WHERE s.status = 'DISPATCHED' AND EXISTS (SELECT 1 FROM printed_documents p WHERE p."docType" = 'SHIPMENT_DISPATCH' AND p."sourceId" = s.id AND p.status = 'ACTIVE')
           ORDER BY s."dispatchedAt" DESC NULLS LAST LIMIT 1`,
      );
      if (!s) throw new Error("e2e kopyasında sevk irsaliyesi olan sevkiyat yok");
      olc.sevk = s;
      await sablonKur(api, sql);
      const yeniden = await api(`/api/printed-documents/${TIP}/${s.id}/reissue`, { method: "POST", body: JSON.stringify({ reason: "TX e2e: şablonlu Excel kanıtı" }) });
      olc.yenidenDurum = yeniden.status;
      olc.tablolar = (await api(`/api/printed-documents/${TIP}/${s.id}/tables`)).govde?.data ?? null;

      await git("Sevkiyatlar");
      // Liste varsayılan son 30 gün süzer; e2e kopyasının sevkiyatı daha eski olabilir.
      const tarihKaldir = page().getByTitle("Tarih filtresini kaldır").first();
      if (await tarihKaldir.count()) await tarihKaldir.click();
      await page().getByPlaceholder("Sevkiyat no, firma, parti kodu / adı, çuval no ara…").fill(s.no);
      await page().getByText(s.no, { exact: true }).first().click({ timeout: 20_000 });
      await page().getByRole("button", { name: "Sevk İrsaliyesi" }).first().click({ timeout: 15_000 });
      const diyalog = page().getByRole("dialog").last();
      await gor(diyalog.getByRole("button", { name: /İndir/ }).first(), { sure: 30_000 });
      await page().waitForTimeout(2500);
      await kanit(page(), app(), "BX1-belge");
      await diyalog.getByRole("button", { name: /İndir/ }).first().click();
      const excel = page().getByRole("menuitem", { name: "Excel", exact: true });
      await excel.waitFor({ timeout: 30_000 });
      await kanit(page(), app(), "BX1-indir-menu");
      const hedef = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tekserp-bx-")), "irsaliye.xlsx");
      await app().evaluate(({ dialog }, p) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: p }); }, hedef);
      await excel.click();
      for (let i = 0; i < 30 && !fs.existsSync(hedef); i++) await page().waitForTimeout(500);
      if (!fs.existsSync(hedef)) throw new Error("Excel dosyası yazılmadı");
      olc.satirlar = await excelOku(hedef);
      if (KANIT) fs.writeFileSync(path.join(KANIT, "BX1-excel-ve-tables.json"), JSON.stringify({ excel: olc.satirlar, tables: olc.tablolar }, null, 1));
    },
    dogrula: [
      { ad: "irsaliye şablonla yeniden düzenlendi (201/200)", sql: "SELECT 1", oku: () => olc.yenidenDurum, beklenen: (n) => n === 200 || n === 201 },
      { ad: "görsel sürüm kaydı Excel uyarısı taşımaz", sql: "SELECT 1", oku: () => JSON.stringify(olc.kayitUyari ?? []), beklenen: (t) => !t.includes("Excel varsayılan") },
      {
        ad: "/tables: ürün tablosu ters sıralı bağı izler",
        sql: "SELECT 1",
        oku: () => `${(olc.tablolar?.tables ?? []).find((t) => t.key === "urun")?.columns.map((c) => c.key).join(",")} ≟ ${olc.beklenenUrun}`,
        beklenen: () => (olc.tablolar?.tables ?? []).find((t) => t.key === "urun")?.columns.map((c) => c.key).join(",") === olc.beklenenUrun,
      },
      {
        ad: "Excel dosyasında her tablonun başlık satırı = /tables başlıkları (aynı sıra)",
        sql: "SELECT 1",
        oku: () => (olc.tablolar?.tables ?? []).map((t) => olc.satirlar?.some((r) => JSON.stringify(r.filter(Boolean)) === JSON.stringify(t.columns.map((c) => c.label)))).join(","),
        beklenen: (t) => t.length > 0 && !t.includes("false"),
      },
      {
        ad: "Excel dosyasında her tablonun ilk satırı = /tables ilk satırı",
        sql: "SELECT 1",
        oku: () =>
          (olc.tablolar?.tables ?? [])
            .filter((t) => t.rows.length)
            .map((t) => olc.satirlar?.some((r) => JSON.stringify(r.slice(0, t.columns.length)) === JSON.stringify(t.rows[0].map((v) => (v == null ? "" : String(v))))))
            .join(","),
        beklenen: (t) => t.length > 0 && !t.includes("false"),
      },
    ],
  },
];
export { olc as BX_OLCUM };
