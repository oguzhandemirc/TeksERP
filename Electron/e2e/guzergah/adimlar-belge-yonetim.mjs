// =============================================================================
// Belge Tasarımcısı T5 güzergâhı — şablon listesi, sürümler, karşılaştırma, geri alma, yayın, atamalar
//   BY1 Liste: belge türü grupları, "Sistem" satırı (salt-okunur), rozetler; dar ekran
//   BY2 Sistem → "Kopyala ve düzenle" → ad → editör (şablon şeridi + rozet)
//   BY3 İkinci sürüm (API, fikstür) → Sürümler paneli: no · yazan · zaman · not · yayın rozeti
//   BY4 İki sürüm seç → Karşılaştır: yan yana sandbox önizleme + HTML farkı
//   BY5 v1 → "Bu sürümden taslak" onayı → YENİ sürüm (v3 = v1 içeriği; v2 durur)
//   BY6 v3 → Yayınla onayı: senaryo özeti + etkilenenler → yayında
//   BY7 Atamalar: tür varsayılanı + profil satırı → Ata (etkilenen cari + ezme uyarısı) → kaydet
//   BY8 SoD açık + kendi sürümü → Yayınla pasif + gerekçe
//   BY9 (M) Yalnız `document-template:read` → salt-okunur yüzey (pasif + gerekçe); BY9a/BY9z izin fikstürü (M oturumu kapalıyken → 401 gürültüsü yok)
// BT2 sonrası koşar (bayrak açık).
// =============================================================================
import { bayragiKur, kanit } from "./adimlar-belge-tasarimci.mjs";

const AD = `E2E T5 ${Date.now().toString(36)}`;
const PROFIL = `E2E T5 profil ${Date.now().toString(36)}`;
const olc = { gruplar: null, sistem: null, sablon: null, surumler: null, fark: null, geriAlma: null, yayin: null, atama: null, sod: null, salt: null };
const ctxIds = { templateId: null, profileId: null, customerId: null };
const DOC = "SHIPMENT_DISPATCH";
const DIZ = { genis: { width: 1440, height: 900 }, dar: { width: 820, height: 1000 } };

async function listeyeGit({ git, page }) {
  await git("Belge Tasarımcısı");
  await page().getByTestId("sablon-grubu-" + DOC).waitFor({ timeout: 30_000 });
}
const grup = (page) => page().getByTestId("sablon-grubu-" + DOC);
const sablonSatiri = (page) => grup(page).getByTestId("sablon-satiri").filter({ hasText: AD }).first();
async function surumleriAc(ctx) {
  await listeyeGit(ctx);
  await sablonSatiri(ctx.page).getByRole("button", { name: "Sürümler" }).click();
  await ctx.page().getByTestId("surum-satiri").first().waitFor({ timeout: 15_000 });
}
// Panel sekmeleri sayfayı canlı tutar: gizli sekmedeki editörün şeridi de DOM'dadır → yalnız görünen.
const seridi = (page) => page().getByTestId("sablon-seridi").filter({ visible: true });
const kapat = async (page) => { for (let i = 0; i < 3 && (await page().getByRole("dialog").count()); i++) { await page().keyboard.press("Escape"); await page().waitForTimeout(300); } };

/** Salt-okunur sonda: M'nin tasarım/yayın yazma izinleri geçici düşer (tokenVersion artar → yeniden giriş). */
const YAZMA_IZINLERI = ["admin:settings", "admin:*", "document-template:write", "document-template:design", "document-template:publish"];
async function mIzinleri(sql, userName, geriVer) {
  if (geriVer) {
    await sql(`INSERT INTO user_permissions (id, "userId", "permissionId", "createdAt", "updatedAt") SELECT gen_random_uuid(), u.id, p.id, now(), now() FROM users u, permissions p
      WHERE u.username = $1 AND p.code = ANY($2) ON CONFLICT DO NOTHING`, [userName, YAZMA_IZINLERI]);
  } else {
    await sql(`DELETE FROM user_permissions up USING users u, permissions p WHERE up."userId" = u.id AND up."permissionId" = p.id AND u.username = $1 AND p.code = ANY($2)`, [userName, YAZMA_IZINLERI]);
  }
  await sql(`UPDATE users SET "tokenVersion" = "tokenVersion" + 1 WHERE username = $1`, [userName]);
}

export const BELGE_YONETIM_ADIMLARI = [
  {
    id: "BY1", rol: "P", gerektirir: ["BT2"],
    yol: "Tanımlar → Belge Tasarımcısı → şablon listesi (Sistem satırı + rozetler); geniş + dar", rota: "definitions/document-designer",
    async yap(ctx) {
      const { page } = ctx;
      await page().setViewportSize(DIZ.genis).catch(() => undefined);
      await listeyeGit(ctx);
      olc.gruplar = await page().locator('[data-testid^="sablon-grubu-"]').count();
      olc.sistem = await page().getByTestId("sistem-satiri").count();
      await kanit(page, "BY1-liste");
      await page().setViewportSize(DIZ.dar).catch(() => undefined);
      await page().waitForTimeout(500);
      await kanit(page, "BY1-liste-dar");
      await page().setViewportSize(DIZ.genis).catch(() => undefined);
    },
    dogrula: [
      { ad: "en az 10 belge türü grubu", sql: "SELECT 1", oku: () => olc.gruplar, beklenen: (v) => v >= 10 },
      { ad: "her grupta Sistem satırı", sql: "SELECT 1", oku: () => olc.sistem === olc.gruplar, beklenen: true },
    ],
  },
  {
    id: "BY2", rol: "P", gerektirir: ["BY1"],
    yol: "Sevk İrsaliyesi → Sistem → Kopyala ve düzenle → ad → Oluştur → editör", rota: "definitions/document-designer",
    async yap(ctx) {
      const { page, sql } = ctx;
      await listeyeGit(ctx);
      await grup(page).getByTestId("sistem-satiri").getByRole("button", { name: "Kopyala ve düzenle" }).click();
      const dlg = page().getByRole("dialog");
      await dlg.getByLabel("Şablon adı").fill(AD);
      await kanit(page, "BY2-kopya-adi");
      await dlg.getByRole("button", { name: "Oluştur ve düzenle" }).click();
      // Dönüşüm uyarısı varsa pencere kalır → görüntü + Editöre geç.
      const uyari = page().getByTestId("kopya-uyarilari");
      if (await uyari.waitFor({ timeout: 4_000 }).then(() => true, () => false)) {
        await kanit(page, "BY2-kopya-uyarilari");
        await page().getByRole("button", { name: "Editöre geç" }).click();
      }
      await seridi(page).waitFor({ timeout: 30_000 });
      await page().waitForTimeout(1500);
      await kanit(page, "BY2-editor");
      const r = await sql(`SELECT id FROM document_templates WHERE name = $1`, [AD]);
      ctxIds.templateId = r[0]?.id ?? null;
      olc.sablon = await seridi(page).textContent();
    },
    dogrula: [
      { ad: "şablon v1 ile doğdu", sql: `SELECT t."latestVersionNo" AS n FROM document_templates t WHERE t.name = $1`, params: [AD], oku: (r) => r[0]?.n, beklenen: 1 },
      { ad: "şeritte ad + Taslak v1 rozeti", sql: "SELECT 1", oku: () => /Taslak v1/.test(olc.sablon ?? "") && (olc.sablon ?? "").includes(AD), beklenen: true },
    ],
  },
  {
    id: "BY3", rol: "P", gerektirir: ["BY2"],
    yol: "İkinci sürüm (fikstür, API) → Şablonlar → satır → Sürümler paneli", rota: "definitions/document-designer",
    async yap(ctx) {
      const { page, api } = ctx;
      const id = ctxIds.templateId;
      const list = (await api(`/api/document-templates/${id}/versions`)).govde.data;
      const v1 = (await api(`/api/document-templates/${id}/versions/${list[0].id}`)).govde.data;
      const body = {
        baseVersionId: v1.id, editMode: v1.editMode, sourceHtml: `${v1.sourceHtml}\n<p class="e2e-not">E2E: alt not eklendi</p>`, css: `${v1.css}\n.e2e-not{color:#555}`,
        pageSettings: v1.pageSettings, settings: v1.settings, internalFields: v1.internalFields, tableBindings: v1.tableBindings, note: "Alt not eklendi",
      };
      const r = await api(`/api/document-templates/${id}/versions`, { method: "POST", body: JSON.stringify(body) });
      if (r.status !== 201) throw new Error(`v2 kaydı ${r.status}`);
      await surumleriAc(ctx);
      await page().getByTestId("surum-satiri").nth(1).waitFor({ timeout: 10_000 }).catch(() => {});
      olc.surumler = await page().getByTestId("surum-satiri").count();
      await kanit(page, "BY3-surumler");
    },
    dogrula: [{ ad: "panelde iki sürüm", sql: "SELECT 1", oku: () => olc.surumler, beklenen: 2 }],
  },
  {
    id: "BY4", rol: "P", gerektirir: ["BY3"],
    yol: "Sürümler → v1 + v2 seç → Karşılaştır → yan yana önizleme + HTML farkı", rota: "definitions/document-designer",
    async yap(ctx) {
      const { page } = ctx;
      await surumleriAc(ctx);
      await page().getByRole("checkbox", { name: "v1 karşılaştırmaya ekle" }).click();
      await page().getByRole("checkbox", { name: "v2 karşılaştırmaya ekle" }).click();
      await page().getByRole("button", { name: "Karşılaştır" }).click();
      await page().getByTitle("v2 önizlemesi").waitFor({ timeout: 30_000 });
      await page().waitForTimeout(1200);
      await kanit(page, "BY4-karsilastir-onizleme");
      await page().getByRole("tab", { name: "HTML farkı" }).click();
      await page().getByTestId("fark-HTML").waitFor();
      olc.fark = await page().getByTestId("fark-HTML").textContent();
      await kanit(page, "BY4-karsilastir-fark");
      await kapat(page);
    },
    dogrula: [{ ad: "HTML farkında eklenen satır görünüyor", sql: "SELECT 1", oku: () => /\+1/.test(olc.fark ?? "") && (olc.fark ?? "").includes("E2E: alt not eklendi"), beklenen: true }],
  },
  {
    id: "BY5", rol: "P", gerektirir: ["BY3"],
    yol: "Sürümler → v1 → Bu sürümden taslak → onay (ileri kayıt silinmez) → Yeni sürüm aç", rota: "definitions/document-designer",
    async yap(ctx) {
      const { page } = ctx;
      await surumleriAc(ctx);
      const v1 = page().getByTestId("surum-satiri").filter({ hasText: "v1" }).last();
      await v1.getByRole("button", { name: "Bu sürümden taslak" }).click();
      await page().getByTestId("geri-alma-aciklamasi").waitFor();
      olc.geriAlma = await page().getByTestId("geri-alma-aciklamasi").textContent();
      await kanit(page, "BY5-geri-alma-onayi");
      await page().getByRole("button", { name: "Yeni sürüm aç" }).click();
      await page().getByTestId("surum-satiri").nth(2).waitFor({ timeout: 15_000 });
      await kanit(page, "BY5-geri-alma-sonrasi");
      await kapat(page);
    },
    dogrula: [
      { ad: "onay metni: v3 açılır, ileri sürümler silinmez", sql: "SELECT 1", oku: () => /v3/.test(olc.geriAlma ?? "") && /silinmez/.test(olc.geriAlma ?? ""), beklenen: true },
      { ad: "v3 = v1 içeriği, v2 durur", sql: `SELECT count(*)::int AS n, bool_and(true) AS x, (SELECT v3."contentHash" = v1."contentHash" FROM document_template_versions v1, document_template_versions v3 WHERE v1."templateId" = t.id AND v1."versionNo" = 1 AND v3."templateId" = t.id AND v3."versionNo" = 3) AS ayni FROM document_templates t JOIN document_template_versions v ON v."templateId" = t.id WHERE t.name = $1 GROUP BY t.id`, params: [AD], oku: (r) => `${r[0]?.n}:${r[0]?.ayni}`, beklenen: "3:true" },
    ],
  },
  {
    id: "BY6", rol: "P", gerektirir: ["BY5"],
    yol: "Sürümler → v3 → Yayınla → onay (senaryo özeti + etkilenenler) → Yayınla", rota: "definitions/document-designer",
    async yap(ctx) {
      const { page } = ctx;
      await surumleriAc(ctx);
      await page().getByTestId("surum-satiri").first().getByRole("button", { name: "Yayınla" }).click();
      await page().getByText(/Senaryolar: \d+ başarılı/).waitFor({ timeout: 60_000 });
      olc.yayin = await page().getByTestId("senaryo-ozeti").textContent();
      await kanit(page, "BY6-yayin-onayi");
      await page().getByRole("dialog").filter({ hasText: "yayınlansın mı" }).getByRole("button", { name: "Yayınla", exact: true }).click();
      await page().getByText("v3 yayında.").waitFor({ timeout: 30_000 });
      await kapat(page);
      await listeyeGit(ctx);
      await kanit(page, "BY6-liste-rozetler");
    },
    dogrula: [
      { ad: "senaryoların hepsi başarılı ya da uyarılı (hatalı 0)", sql: "SELECT 1", oku: () => / 0 hatalı/.test(olc.yayin ?? ""), beklenen: true },
      { ad: "yayındaki sürüm v3", sql: `SELECT v."versionNo" AS n FROM document_templates t JOIN document_template_versions v ON v.id = t."publishedVersionId" WHERE t.name = $1`, params: [AD], oku: (r) => r[0]?.n, beklenen: 3 },
    ],
  },
  {
    id: "BY7", rol: "P", gerektirir: ["BY6"],
    yol: "Şablonlar → Atamalar → Sevk İrsaliyesi → profil satırı → Ata (etkilenenler + ezme uyarısı) → kaydet", rota: "definitions/document-designer",
    async yap(ctx) {
      const { page, api, sql } = ctx;
      const p = await api(`/api/document-profiles`, { method: "POST", body: JSON.stringify({ name: PROFIL, config: { shipmentDispatch: { language: "tr" } } }) });
      ctxIds.profileId = p.govde?.data?.id ?? null;
      const c = await sql(`SELECT id FROM customers WHERE "documentProfileId" IS NULL AND "deletedAt" IS NULL ORDER BY "createdAt" LIMIT 1`).catch(() => sql(`SELECT id FROM customers WHERE "documentProfileId" IS NULL ORDER BY "createdAt" LIMIT 1`));
      ctxIds.customerId = c[0]?.id ?? null;
      if (ctxIds.customerId) await sql(`UPDATE customers SET "documentProfileId" = $1 WHERE id = $2`, [ctxIds.profileId, ctxIds.customerId]);
      await listeyeGit(ctx);
      await page().getByRole("tab", { name: "Atamalar" }).click();
      await page().getByTestId("atama-paneli").waitFor({ timeout: 15_000 });
      await page().getByRole("navigation", { name: "Belge türleri" }).getByRole("button", { name: /^Sevk İrsaliyesi/ }).click();
      const satir = page().getByTestId("atama-satiri").filter({ hasText: PROFIL });
      await satir.getByRole("button", { name: "Ata" }).click();
      await page().getByRole("radio", { name: new RegExp(AD) }).click();
      await page().getByTestId("etkilenenler").waitFor();
      olc.atama = `${await page().getByTestId("etkilenenler").textContent()}|${await page().getByTestId("ezme-uyarisi").count()}`;
      await kanit(page, "BY7-atama-onayi");
      await page().getByRole("button", { name: "Atamayı kaydet" }).click();
      await satir.filter({ hasText: AD }).waitFor({ timeout: 15_000 });
      await kanit(page, "BY7-atamalar");
    },
    dogrula: [
      { ad: "etkilenen müşteri listelendi + ezme uyarısı", sql: "SELECT 1", oku: () => /1 müşteri/.test(olc.atama ?? "") && /\|1$/.test(olc.atama ?? ""), beklenen: true },
      { ad: "profil ataması yazıldı", sql: `SELECT t.name FROM document_profile_templates a JOIN document_templates t ON t.id = a."templateId" JOIN document_profiles p ON p.id = a."profileId" WHERE p.name = $1`, params: [PROFIL], oku: (r) => r[0]?.name, beklenen: AD },
    ],
  },
  {
    id: "BY8", rol: "P", gerektirir: ["BY6"],
    // Bayrak tazelemesi sayfayı yeniden yükler; cihaz duyurusu aynı oturumda ikinci kez 400 alır (BT2 ile aynı kalıntı).
    beklenenHatalar: [{ status: 400, url: /\/api\/devices\/announce/ }],
    yol: "SoD açık → kendi kaydettiği v4 → editörde Yayınla pasif + gerekçe", rota: "definitions/document-designer",
    async yap(ctx) {
      const { page, api, sql } = ctx;
      const id = ctxIds.templateId;
      const list = (await api(`/api/document-templates/${id}/versions`)).govde.data;
      const v = (await api(`/api/document-templates/${id}/versions/${list[0].id}`)).govde.data;
      await api(`/api/document-templates/${id}/versions`, { method: "POST", body: JSON.stringify({
        baseVersionId: v.id, editMode: v.editMode, sourceHtml: `${v.sourceHtml}\n<!-- sod -->`, css: v.css, pageSettings: v.pageSettings, settings: v.settings,
        internalFields: v.internalFields, tableBindings: v.tableBindings, note: "SoD sondası" }) });
      await sql(`INSERT INTO system_settings (key, value, description, "createdAt", "updatedAt") VALUES ('documents.publishSodEnabled', 'true'::jsonb, 'E2E fixture', now(), now())
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "updatedAt" = now()`);
      await page().route("**/api/feature-flags", async (route) => {
        const res = await route.fetch();
        const json = await res.json();
        if (json?.data) { json.data.documentDesignerEnabled = true; json.data.documentPublishSodEnabled = true; }
        await route.fulfill({ response: res, json });
      });
      try {
        await page().reload();
        await page().waitForTimeout(1500);
        await listeyeGit(ctx);
        await sablonSatiri(page).getByRole("button", { name: /Düzenle|Aç/ }).click();
        await seridi(page).waitFor({ timeout: 30_000 });
        await seridi(page).getByText("açık sürüm v4").waitFor({ timeout: 30_000 });
        const btn = seridi(page).getByRole("button", { name: "Yayınla" });
        olc.sod = `${await btn.isDisabled()}|${await btn.getAttribute("title")}`;
        await btn.hover({ force: true }).catch(() => undefined);
        await kanit(page, "BY8-sod");
      } finally {
        // Kalıntı bırakma: düşen koşu SoD'yi açık bırakırsa sonraki BY6 Yayınla'yı pasif görür.
        await sql(`UPDATE system_settings SET value = 'false'::jsonb, "updatedAt" = now() WHERE key = 'documents.publishSodEnabled'`);
        await bayragiKur(ctx);
      }
    },
    dogrula: [{ ad: "Yayınla pasif + SoD gerekçesi", sql: "SELECT 1", oku: () => olc.sod, beklenen: (v) => /^true\|.*siz tasarladınız/.test(v ?? "") }],
  },
  {
    id: "BY9a", rol: "P", gerektirir: ["BY6"],
    yol: "Fikstür: M'nin tasarım/yayın yazma izinleri geçici düşer (M oturumu kapalıyken; rol değişimi taze giriş yapar)", rota: "definitions/document-designer",
    async yap(ctx) {
      const { sql, ortam } = ctx;
      await mIzinleri(sql, ortam.kullanicilar.muhasebe.username, false);
    },
    dogrula: [],
  },
  {
    id: "BY9", rol: "M", gerektirir: ["BY9a"],
    beklenenHatalar: [{ status: 400, url: /\/api\/devices\/announce/ }],
    yol: "Yalnız okuma izni → Belge Tasarımcısı → salt-okunur liste (pasif + gerekçe)", rota: "definitions/document-designer",
    async yap(ctx) {
      const { page } = ctx;
      await bayragiKur(ctx);
      await listeyeGit(ctx);
      const kopya = grup(page).getByTestId("sistem-satiri").getByRole("button", { name: "Kopyala ve düzenle" });
      olc.salt = `${await kopya.isDisabled()}|${await page().getByTestId("salt-okunur-notu").count()}`;
      await kanit(page, "BY9-salt-okunur");
      await page().getByRole("tab", { name: "Atamalar" }).click();
      await page().getByTestId("atama-paneli").waitFor({ timeout: 15_000 });
      await kanit(page, "BY9-salt-okunur-atamalar");
    },
    dogrula: [{ ad: "kopya pasif + salt-okunur notu", sql: "SELECT 1", oku: () => olc.salt, beklenen: "true|1" }],
  },
  {
    id: "BY9z", rol: "P", gerektirir: ["BY9a"],
    yol: "Fikstür geri: M'nin yazma izinleri geri verilir (M oturumu kapalıyken)", rota: "definitions/document-designer",
    async yap(ctx) {
      const { sql, ortam } = ctx;
      await mIzinleri(sql, ortam.kullanicilar.muhasebe.username, true);
    },
    dogrula: [],
  },
];
