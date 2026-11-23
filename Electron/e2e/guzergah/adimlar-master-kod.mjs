// =============================================================================
// GÜZERGÂH · MK — sunucuda üretilen master veri kodu panelden KODSUZ açılır (K20)
// =============================================================================
//   MK1 Tanımlar → Fason Kategorileri → Yeni → ad → Kaydet → kod sunucudan (KAT…)
//   MK2 finans KAPALI rejim: Tanımlar → Cariler → Yeni cari → ad → Fason iş yapar → Kaydet → kod sunucudan (MUS…)
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
async function crudYeni({ git, page }, sayfa, uc, ad, formuDoldur = async () => {}, yeniDugmesi = "Yeni") {
  await git(sayfa);
  // Düğme adı TAM eşleşir (sekme çubuğundaki "+" de "Yeni…" adını taşır); Cariler'de "Yeni cari".
  await page().getByRole("button", { name: yeniDugmesi, exact: true }).filter({ visible: true }).first().click({ timeout: 15_000 });
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
    yol: "HAZIRLIK (sistem hesabı, API) — finans modülünü KAPAT (fabrika rejiminde de tek Cariler ekranı çalışır mı)", rota: "system/feature-flags",
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
    // T1/T9 (2026-11-23): ayrı Fason Firmalar ekranı yok — fason firma bir cari kartıdır; "Fason iş yapar" kutusu
    // kart + fason profilini tek istekte doğurur (Tedarikçi rolü kendiliğinden işaretlenir).
    yol: "finans KAPALI → Tanımlar → Cariler → Yeni cari → ad → Fason iş yapar → Kaydet — kart kodu sunucudan (MUS…), profil aynı kodla bağlı; finans eski hâline", rota: "definitions/cariler",
    async yap(ctx) {
      try {
        olc.firmaDurum = await crudYeni(ctx, "Cariler", "/api/customers", MK.firma, async (d) => {
          await d.getByRole("checkbox", { name: "Fason iş yapar" }).check({ timeout: 10_000 });
        }, "Yeni cari");
      } finally {
        if (olc.financeOnce !== null) await ctx.apiRol("S", "/api/feature-flags", { method: "PATCH", headers: sifre, body: JSON.stringify({ financeEnabled: olc.financeOnce }) });
        ctx.oturumuYenile();
      }
    },
    dogrula: [
      { ad: "POST 2xx (kodsuz gövde kabul)", sql: `SELECT 1`, oku: () => olc.firmaDurum, beklenen: (v) => v >= 200 && v < 300 },
      { ad: "kart doğdu ve kodu sunucu üretti (MUS…)", sql: `SELECT code FROM customers WHERE name ILIKE '%' || $1 || '%'`, params: () => [`MK${K} `], oku: (r) => r[0]?.code ?? r.length, beklenen: (v) => /^MUS/.test(String(v)) },
      { ad: "fason profili karta bağlı ve aynı kodu taşıyor", sql: `SELECT s.code = c.code AS ayni FROM subcontractors s JOIN customers c ON c.id = s."customerId" WHERE c.name ILIKE '%' || $1 || '%'`, params: () => [`MK${K} `], oku: (r) => r[0]?.ayni ?? false, beklenen: (v) => v === true },
      { ad: "finans bayrağı eski hâlinde", uc: "/api/feature-flags", oku: (g) => String(g?.data?.financeEnabled), beklenen: (v) => olc.financeOnce === null || v === String(olc.financeOnce) },
    ],
  },
];
