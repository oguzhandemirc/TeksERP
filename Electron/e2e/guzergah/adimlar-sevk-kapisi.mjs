// =============================================================================
// GÜZERGÂH · SK — Sevk Kapısı (sevk onayı adımı açık rejim)
// =============================================================================
//   SK1 hazırlık (API: cari + çuval) + Özellik Anahtarları → Sevkiyat & İade → "Sevk onayı adımı" AÇ
//   SK2 Paketleme / Çuvallar → çuval → Sevk Et → sevkiyat PLANLI doğar (stok düşmez)
//   SK3 Sevk Kapısı → çuval kodunu okut → kart en üstte → Sevk Et → çuval dökümü → onay → DISPATCHED
//   SK4 bayrak eski hâline (KAPALI) → Sevk Kapısı karosu gizlenir
// Ayar şifresi tanımlı kurulumda şifre `AYAR_SIFRESI_DOSYASI`ndan okunur (yalnız bellek).
// =============================================================================
import fs from "node:fs";

const ONEK = process.env.E2E_ONEK ?? "TEST";
const K = Date.now().toString(36).slice(-4).toUpperCase();
const SK = { cari: `${ONEK}-SK${K} Kapı Cari` };
const olc = { cariId: null, sack: null, sevkId: null, bayrakOnce: null };
const AYAR_SIFRESI = process.env.AYAR_SIFRESI_DOSYASI && fs.existsSync(process.env.AYAR_SIFRESI_DOSYASI)
  ? fs.readFileSync(process.env.AYAR_SIFRESI_DOSYASI, "utf-8").trim() : null;

/** Kaydet sonrası ayar şifresi sorulursa gir (kurulumda şifre yoksa soru gelmez). */
async function sifreVarsaGir(page) {
  const sd = page().getByRole("dialog").filter({ hasText: "Ayar şifresi" }).first();
  if (!(await sd.waitFor({ timeout: 4_000 }).then(() => true, () => false))) return;
  if (!AYAR_SIFRESI) throw new Error("ayar şifresi soruldu ama AYAR_SIFRESI_DOSYASI yok");
  await sd.locator("#settings-password").fill(AYAR_SIFRESI);
  await sd.getByRole("button", { name: "Onayla" }).click({ timeout: 10_000 });
  await sd.waitFor({ state: "detached", timeout: 10_000 });
}

async function sevkOnayiBayragi({ git, page }, acik) {
  await git("Özellik Anahtarları");
  await page().getByText("Sevkiyat & İade", { exact: true }).filter({ visible: true }).first().click({ timeout: 15_000 });
  // Ayar satırı Radix Switch'tir (role=switch, aria-label = başlık) — checkbox değil.
  const k = page().getByRole("switch", { name: "Sevk onayı adımı", exact: true }).filter({ visible: true }).first();
  await k.waitFor({ timeout: 15_000 });
  if ((await k.isChecked()) !== acik) await k.click();
  const kaydet = page().getByRole("button", { name: "Kaydet", exact: true }).filter({ visible: true }).first();
  if (await kaydet.isEnabled()) {
    await kaydet.click({ timeout: 15_000 });
    await sifreVarsaGir(page);
    await page().waitForTimeout(1500);
  }
}

export const SEVK_KAPISI_ADIMLARI = [
  {
    id: "SK1", rol: "P",
    yol: "HAZIRLIK (API: cari + dolu çuval) · Sistem → Özellik Anahtarları → Sevkiyat & İade → 'Sevk onayı adımı' AÇ → Kaydet", rota: "system/feature-flags",
    async yap(ctx) {
      const { api, sql } = ctx;
      olc.bayrakOnce = (await sql(`SELECT value::text v FROM system_settings WHERE key='shipping.confirmationEnabled'`))[0]?.v ?? null;
      const c = await api(`/api/customers`, { method: "POST", body: JSON.stringify({ name: SK.cari, isCustomerRole: true, defaultDestination: "DOMESTIC" }) });
      if (c.status >= 300) throw new Error(`cari: ${c.status} ${JSON.stringify(c.govde).slice(0, 200)}`);
      olc.cariId = c.govde.data.id;
      const [top] = await sql(`SELECT barcode FROM rolls WHERE status='WAREHOUSE' AND "sackId" IS NULL AND "shipmentId" IS NULL AND "ownerCustomerId" IS NULL AND barcode IS NOT NULL ORDER BY "updatedAt" DESC LIMIT 1`);
      if (!top) throw new Error("depoda serbest top yok");
      const s = await api(`/api/shipping/sacks`, { method: "POST", body: JSON.stringify({ customerId: olc.cariId, clientToken: crypto.randomUUID() }) });
      if (!s.govde?.data?.id) throw new Error(`çuval: ${s.status} ${JSON.stringify(s.govde).slice(0, 160)}`);
      olc.sack = { id: s.govde.data.id, sackNo: s.govde.data.sackNo, barkod: top.barcode };
      const o = await api(`/api/shipping/sacks/${olc.sack.id}/scan`, { method: "POST", body: JSON.stringify({ barcode: top.barcode }) });
      if (o.status >= 300) throw new Error(`okutma: ${o.status} ${JSON.stringify(o.govde).slice(0, 160)}`);
      await sevkOnayiBayragi(ctx, true);
    },
    dogrula: [
      { ad: "shipping.confirmationEnabled = true", sql: `SELECT value::text v FROM system_settings WHERE key='shipping.confirmationEnabled'`, oku: (r) => r[0]?.v, beklenen: "true" },
      { ad: "çuval dolu (1 top)", sql: `SELECT count(*)::int n FROM rolls WHERE "sackId"=$1`, params: () => [olc.sack?.id], oku: (r) => r[0].n, beklenen: 1 },
    ],
  },
  {
    id: "SK2", rol: "P", gerektirir: ["SK1"],
    yol: "Paketleme / Çuvallar → SK çuvalı → sağ tık → Sevk Et → Sevkiyat Kur → kaydet → sevkiyat PLANLI (stok düşmez)", rota: "operations/sacks",
    async yap({ git, gor, page }) {
      await git("Paketleme / Çuvallar");
      const hub = page().getByText("Tüm Çuvallar", { exact: true }).filter({ visible: true }).first();
      if (await hub.count()) { await hub.click({ timeout: 10_000 }); await page().waitForTimeout(1200); }
      // Liste ilk 50 satırı yükler; yeni çuval o pencerede olmayabilir → insan gibi arama kutusuna yazılır.
      const ara = page().getByPlaceholder(/Ara ya da barkod okut/).filter({ visible: true }).first();
      await ara.fill(olc.sack.sackNo); await page().waitForTimeout(1200);
      const satir = page().getByRole("row").filter({ hasText: olc.sack.sackNo }).filter({ visible: true }).first();
      await gor(satir, { sure: 20_000 });
      await satir.click({ button: "right" });
      await page().getByRole("menuitem", { name: "Sevk Et" }).first().click({ timeout: 10_000 });
      const d = page().getByRole("dialog").filter({ hasText: "Sevkiyat Kur" }).last();
      await gor(d);
      const yanit = page().waitForResponse((r) => r.request().method() === "POST" && /\/api\/shipping\/shipments(\?|$)/.test(r.url()), { timeout: 30_000 });
      // Açık rejimde düğme adı rejime göre değişebilir — dipteki birincil eylem.
      await d.getByRole("button", { name: /^(Sevk Et|Planla|Sevkiyatı Kur|Kur|Kaydet)$/ }).last().click({ timeout: 15_000 });
      const r = await yanit;
      const g = await r.json().catch(() => ({}));
      if (r.status() >= 300) throw new Error(`sevkiyat ${r.status()} ${JSON.stringify(g).slice(0, 200)}`);
      olc.sevkId = g?.data?.id;
    },
    dogrula: [
      { ad: "sevkiyat PLANNED, dispatchedAt boş", sql: `SELECT status::text s, "dispatchedAt" IS NULL b FROM shipments WHERE id=$1`, params: () => [olc.sevkId], oku: (r) => `${r[0]?.s}:${r[0]?.b}`, beklenen: "PLANNED:true" },
    ],
  },
  {
    id: "SK3", rol: "P", gerektirir: ["SK2"],
    yol: "Operasyon → Sevk Kapısı → çuval kodunu okut (Enter) → kart en üstte → Sevk Et → çuval dökümü → onay → DISPATCHED", rota: "operations/sack-store",
    async yap({ git, gor, page }) {
      await git("Sevk Kapısı");
      const okut = page().getByPlaceholder(/Çuval kodu okut/);
      await gor(okut);
      await okut.fill(olc.sack.sackNo);
      await okut.press("Enter");
      await page().waitForTimeout(1500);
      // Okutulan sevkiyat en üste gelir ve "1/1 çuval okutuldu" yazar; kartın GÖVDESİ içerik panelini açar,
      // çıkış yalnız karttaki "Sevk Et" düğmesindedir.
      await gor(page().getByText(/1 \/ 1 çuval okutuldu/).first(), { sure: 20_000 });
      // K15: YURTİÇİ sevkiyatın içerik panelinde Gümrük/İhracat No satırı YOK (cari kodu uydurulmaz).
      await page().getByText(/1 \/ 1 çuval okutuldu/).first().click({ timeout: 10_000 });
      const panel = page().getByRole("dialog").filter({ hasText: "Çuvallar" }).last();
      await gor(panel, { sure: 15_000 });
      olc.gumrukSatiri = await panel.getByText("Gümrük/İhracat No").count();
      olc.varsayilanYazisi = await panel.getByText(/\(varsayılan\)/).count();
      await page().keyboard.press("Escape"); await page().waitForTimeout(600);
      await page().getByRole("button", { name: "Sevk Et", exact: true }).filter({ visible: true }).first().click({ timeout: 15_000 });
      const d = page().getByRole("dialog").filter({ hasText: "Sevk Et —" }).last();
      await gor(d);
      await gor(d.getByText(olc.sack.sackNo).first(), { sure: 15_000 });
      const yanit = page().waitForResponse((r) => r.request().method() !== "GET" && /\/api\/shipping\/shipments\/[^/]+\/dispatch/.test(r.url()), { timeout: 30_000 });
      await d.locator("button").filter({ hasText: /sevk/i }).last().click({ timeout: 15_000 });
      const r = await yanit;
      if (r.status() >= 300) throw new Error(`dispatch ${r.status()} ${(await r.text()).slice(0, 200)}`);
      await page().waitForTimeout(1200);
    },
    dogrula: [
      { ad: "sevkiyat DISPATCHED, dispatchedAt dolu", sql: `SELECT status::text s, "dispatchedAt" IS NOT NULL b FROM shipments WHERE id=$1`, params: () => [olc.sevkId], oku: (r) => `${r[0]?.s}:${r[0]?.b}`, beklenen: "DISPATCHED:true" },
      { ad: "K15: yurtiçi içerik panelinde Gümrük/İhracat No satırı ve '(varsayılan)' yok", sql: `SELECT 1`, oku: () => `${olc.gumrukSatiri}:${olc.varsayilanYazisi}`, beklenen: "0:0" },
      { ad: "top sevkiyata bağlı", sql: `SELECT count(*)::int n FROM rolls WHERE barcode=$1 AND "shipmentId"=$2`, params: () => [olc.sack.barkod, olc.sevkId], oku: (r) => r[0].n, beklenen: 1 },
    ],
  },
  {
    id: "SK4", rol: "P", gerektirir: ["SK1"],
    yol: "Özellik Anahtarları → Sevkiyat & İade → 'Sevk onayı adımı' eski hâline (KAPALI) → Kaydet", rota: "system/feature-flags",
    async yap(ctx) {
      await sevkOnayiBayragi(ctx, olc.bayrakOnce === "true");
    },
    dogrula: [
      { ad: "bayrak turdan önceki değerinde", sql: `SELECT value::text v FROM system_settings WHERE key='shipping.confirmationEnabled'`, oku: (r) => String(r[0]?.v ?? null), beklenen: (v) => v === String(olc.bayrakOnce ?? "false") || (olc.bayrakOnce === null && v === "false") },
    ],
  },
];
