// =============================================================================
// GÜZERGÂH · MK — sunucuda üretilen master veri kodu panelden KODSUZ açılır (K20)
// =============================================================================
//   MK1 Tanımlar → Fason Kategorileri → Yeni → ad → Kaydet → kod sunucudan (KAT…)
//   MK2 finans KAPALI rejim: Tanımlar → Fason Firmalar → Yeni → ad → Kaydet → kod sunucudan (FSN…)
// Panel kod GÖNDERMEZ (buildPayload); sunucu üretir. 2026-09-23 ölçümü: controller zod'u `code`u
// zorunlu tuttuğu için ikisi de 400 alıyordu. Ayar şifresi tanımlıysa `AYAR_SIFRESI_DOSYASI`ndan.
// =============================================================================
import fs from "node:fs";

const K = Date.now().toString(36).slice(-4).toUpperCase();
const MK = { kategori: `TEST-MK${K} Kategori`, firma: `TEST-MK${K} Fason Firma` };
const olc = { kategoriDurum: null, firmaDurum: null, financeOnce: null };
const AYAR_SIFRESI = process.env.AYAR_SIFRESI_DOSYASI && fs.existsSync(process.env.AYAR_SIFRESI_DOSYASI)
  ? fs.readFileSync(process.env.AYAR_SIFRESI_DOSYASI, "utf-8").trim() : null;
const sifre = AYAR_SIFRESI ? { "x-settings-password": AYAR_SIFRESI } : {};

/** CrudPage: sayfa → "Yeni" → ad → Kaydet; POST yanıtının durumunu döndürür. */
async function crudYeni({ git, page }, sayfa, uc, ad, formuDoldur = async () => {}) {
  await git(sayfa);
  // CrudPage düğmesi TAM "Yeni" (sekme çubuğundaki "+" de "Yeni…" adını taşır — tam eşleşme şart).
  await page().getByRole("button", { name: "Yeni", exact: true }).filter({ visible: true }).first().click({ timeout: 15_000 });
  const d = page().getByRole("dialog").last();
  await d.waitFor({ timeout: 10_000 });
  await d.locator("#name").fill(ad);
  await formuDoldur(d);
  const yanit = page().waitForResponse((r) => r.request().method() === "POST" && new RegExp(`${uc}(\\?|$)`).test(r.url()), { timeout: 20_000 });
  await d.getByRole("button", { name: /Kaydet|Oluştur/ }).last().click({ timeout: 10_000 });
  const r = await yanit;
  await page().waitForTimeout(800);
  return r.status();
}

export const MASTER_KOD_ADIMLARI = [
  {
    id: "MK1", rol: "P",
    yol: "Tanımlar → Fason Kategorileri → Yeni → ad → Kaydet — kod sunucudan (KAT…), panel kod göndermez", rota: "definitions/subcontractor-categories",
    async yap(ctx) { olc.kategoriDurum = await crudYeni(ctx, "Fason Kategorileri", "/api/subcontractor-categories", MK.kategori); },
    dogrula: [
      { ad: "POST 2xx (kodsuz gövde kabul)", sql: `SELECT 1`, oku: () => olc.kategoriDurum, beklenen: (v) => v >= 200 && v < 300 },
      { ad: "kategori doğdu ve kodu sunucu üretti (KAT…)", sql: `SELECT code FROM subcontractor_categories WHERE name ILIKE '%' || $1 || '%'`, params: () => [`MK${K} `], oku: (r) => r[0]?.code ?? r.length, beklenen: (v) => /^KAT/.test(String(v)) },
    ],
  },
  {
    // Modül anahtarını yalnız SİSTEM HESABI değiştirir (API); panel yönetici oturumuyla açılır — bayrak girişte
    // okunduğu için MK2 taze oturumda koşar (oturumuYenile).
    id: "MK2a", rol: "P", sistemApi: true,
    yol: "HAZIRLIK (sistem hesabı, API) — finans modülünü KAPAT (fason firma kartı yalnız finans kapalıyken ayrı ekranda)", rota: "system/feature-flags",
    async yap(ctx) {
      olc.financeOnce = (await ctx.apiRol("S", "/api/feature-flags")).govde?.data?.financeEnabled ?? null;
      const r = await ctx.apiRol("S", "/api/feature-flags", { method: "PATCH", headers: sifre, body: JSON.stringify({ financeEnabled: false }) });
      if (r.status >= 300) throw new Error(`finans kapatılamadı: ${r.status} ${JSON.stringify(r.govde).slice(0, 160)}`);
      ctx.oturumuYenile();
    },
    dogrula: [{ ad: "finans kapalı", uc: "/api/feature-flags", oku: (g) => String(g?.data?.financeEnabled), beklenen: "false" }],
  },
  {
    id: "MK2", rol: "P", sistemApi: true, gerektirir: ["MK2a"],
    yol: "finans KAPALI → Tanımlar → Fason Firmalar → Yeni → ad → Kaydet — kod sunucudan (FSN…); finans eski hâline", rota: "definitions/subcontractors",
    async yap(ctx) {
      try {
        // Form: en az bir hizmet kategorisi + bağlı cari ("Cari kart oluştur ve bağla" — rol modeli).
        olc.firmaDurum = await crudYeni(ctx, "Fason Firmalar", "/api/subcontractors", MK.firma, async (d) => {
          await d.getByRole("checkbox").filter({ hasNot: ctx.page().locator("#isActive") }).first().click({ timeout: 10_000 });
          await d.getByRole("button", { name: /Cari kart oluştur ve bağla/ }).click({ timeout: 10_000 });
          await ctx.page().waitForTimeout(1500);
        });
      } finally {
        if (olc.financeOnce !== null) await ctx.apiRol("S", "/api/feature-flags", { method: "PATCH", headers: sifre, body: JSON.stringify({ financeEnabled: olc.financeOnce }) });
        ctx.oturumuYenile();
      }
    },
    dogrula: [
      { ad: "POST 2xx (kodsuz gövde kabul)", sql: `SELECT 1`, oku: () => olc.firmaDurum, beklenen: (v) => v >= 200 && v < 300 },
      { ad: "firma doğdu ve kodu sunucu üretti (FSN…)", sql: `SELECT code FROM subcontractors WHERE name ILIKE '%' || $1 || '%'`, params: () => [`MK${K} `], oku: (r) => r[0]?.code ?? r.length, beklenen: (v) => /^FSN/.test(String(v)) },
      { ad: "finans bayrağı eski hâlinde", uc: "/api/feature-flags", oku: (g) => String(g?.data?.financeEnabled), beklenen: (v) => olc.financeOnce === null || v === String(olc.financeOnce) },
    ],
  },
];
