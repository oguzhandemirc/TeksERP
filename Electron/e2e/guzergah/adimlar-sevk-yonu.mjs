// =============================================================================
// GÜZERGÂH · SY — sevk yönü kilidi + Yurtiçi/Yurtdışı Satış raporu (2026-09-23)
// =============================================================================
// Kullanıcı kararı: sevkiyatta yurtiçi/yurtdışı SEÇİLMEZ, cariden/şubeden kilitli gelir;
// yönü boş carinin ilk sevkinde bir kez sorulur ve karta yazılır. Adımlar gerçek panelde:
//   SY1 hazırlık (API: dört cari, çuvallar)  · SY2 ilk sevk: seçici + "karta yazılır" → kart dolar
//   SY3 ikinci sevk: rozet "Cariden", seçici yok · SY4 şubeli: rozet "Şubeden" + ihracat kodu
//   SY5 Hızlı Sevk: kilitli ihracat carisinde düğme pasif + gerekçe · SY6 cari formu: yurtiçinde
//   ihracat kodu alanı gizli, kaydet → DB'de değer korunur · SY7 rapor: kartlar, sekmeler, Excel
//   SY8 belge: SY4'te ekranda görülen ihracat kodu = sevk belgesindeki kod
// =============================================================================
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ONEK = process.env.E2E_ONEK ?? "TEST";
const buyukTr = (s) => s.replace(/i/g, "İ").replace(/ı/g, "I").toUpperCase();
// Koşuma özgü ek: aynı E2E DB'sinde tur tekrar koşulabilsin (cari adı/şube kodu çakışmasın).
const K = Date.now().toString(36).slice(-4).toUpperCase();
const SY = {
  onek: `${ONEK}-SY${K}`,
  bos: `${ONEK}-SY${K} Boş Cari`,
  ihracat: `${ONEK}-SY${K} İhracat Cari`,
  subeli: `${ONEK}-SY${K} Şubeli Cari`,
  gizli: `${ONEK}-SY${K} Yurtiçi Kodlu`,
  hizli: `${ONEK}-SY${K} Hızlı Boş`,
  sube: `${ONEK}-SY${K} İhracat Şubesi`,
  subeKodu: `BR-SY-${K}`,
  gizliKod: `EXP-GIZLI-${K}`,
};
const olc = { ids: {}, sacks: {}, rozet: null, excel: null };

/** Depodan serbest top (fabrika verisi kopyası) — çuvala okutulacak. */
async function serbestToplar(sql, n) {
  return sql(`SELECT barcode FROM rolls WHERE status='WAREHOUSE' AND "sackId" IS NULL AND "shipmentId" IS NULL AND "ownerCustomerId" IS NULL AND barcode IS NOT NULL ORDER BY "updatedAt" DESC LIMIT $1`, [n]);
}

/** Paketleme / Çuvallar → çuval satırı sağ tık → Sevk Et → sevkiyat diyaloğu. */
async function cuvaldanSevkAc({ git, gor, page }, sackNo) {
  await git("Paketleme / Çuvallar");
  // Sayfa önce hub açar ("Tüm Çuvallar" · "Tüm Cariler") — çuval listesi kartın arkasında.
  const hub = page().getByText("Tüm Çuvallar", { exact: true }).filter({ visible: true }).first();
  if (await hub.count()) { await hub.click({ timeout: 10_000 }); await page().waitForTimeout(1200); }
  const satir = page().getByRole("row").filter({ hasText: sackNo }).filter({ visible: true }).first();
  await gor(satir, { sure: 20_000 });
  await satir.click({ button: "right" });
  await page().getByRole("menuitem", { name: "Sevk Et" }).first().click({ timeout: 10_000 });
  const d = page().getByRole("dialog").filter({ hasText: "Sevkiyat Kur" }).last();
  await gor(d);
  return d;
}

/** Kumaş Stoğu → Depo → ilk top → Seçilenleri Sevk Et → Hızlı Sevk diyaloğu, cari seçili. */
async function hizliSevkAc({ git, gor, page }, cariAd, barkod = null) {
  await git("Kumaş Stoğu");
  // Sekme adı rejime bağlı ("Depo" / "Bitmiş Depo"); şerit `ReorderableTabBar` — düz <button>, role="tab" yok.
  await page().getByRole("button", { name: /^(Bitmiş Depo|Depo)$/ }).filter({ visible: true }).first().click({ timeout: 15_000 });
  await page().waitForTimeout(1200);
  // Barkod verilirse o satır (çuvaldaki top Hızlı Sevk'te reddedilir — sunucu kapısı); yoksa ilk satır.
  const satir = barkod ? page().getByRole("row").filter({ hasText: barkod }).first() : page().getByRole("row").filter({ visible: true }).nth(1);
  await satir.getByRole("checkbox").first().click({ timeout: 15_000 });
  await page().getByRole("button", { name: "Seçilenleri Sevk Et" }).first().click({ timeout: 15_000 });
  const d = page().getByRole("dialog").filter({ hasText: "Hızlı Sevk" }).last(); await gor(d);
  await d.getByRole("combobox").first().click({ timeout: 15_000 });
  const ara = page().getByPlaceholder("Ara (kod, isim, vergi no)"); await gor(ara);
  await ara.fill(buyukTr(cariAd)); await page().waitForTimeout(800);
  await page().locator("[cmdk-item]").filter({ hasText: buyukTr(cariAd) }).first().click({ timeout: 15_000 });
  return d;
}

async function sevkEtVeBekle(page, d) {
  const yanit = page().waitForResponse((r) => r.request().method() === "POST" && /\/api\/shipping\/shipments(\?|$)/.test(r.url()), { timeout: 30_000 });
  await d.getByRole("button", { name: "Sevk Et", exact: true }).click({ timeout: 15_000 });
  const r = await yanit;
  const g = await r.json().catch(() => ({}));
  if (r.status() >= 300) throw new Error(`sevk ${r.status()} ${JSON.stringify(g).slice(0, 200)}`);
  return g?.data?.id;
}

export const SEVK_YONU_ADIMLARI = [
  {
    id: "SY1", rol: "P",
    yol: "HAZIRLIK (API) — beş cari (boş · ihracat · şubeli · yurtiçi+kodlu · hızlı boş) + depo çuvalları", rota: "operations/sacks",
    async yap({ api, sql }) {
      const cari = async (ad, ek) => {
        const r = await api(`/api/customers`, { method: "POST", body: JSON.stringify({ name: ad, isCustomerRole: true, ...ek }) });
        if (r.status >= 300) throw new Error(`cari ${ad}: ${r.status} ${JSON.stringify(r.govde).slice(0, 200)}`);
        return r.govde.data.id;
      };
      olc.ids.bos = await cari(SY.bos, {});
      olc.ids.ihracat = await cari(SY.ihracat, { defaultDestination: "EXPORT", exportCode: "EXP-SY-C" });
      olc.ids.subeli = await cari(SY.subeli, { defaultDestination: "DOMESTIC", branches: [{ name: SY.sube, code: SY.subeKodu, defaultDestination: "EXPORT" }] });
      olc.ids.gizli = await cari(SY.gizli, { defaultDestination: "DOMESTIC", exportCode: SY.gizliKod });
      olc.ids.hizli = await cari(SY.hizli, {});
      olc.ids.sube = (await sql(`SELECT id FROM customer_branches WHERE "customerId"=$1`, [olc.ids.subeli]))[0]?.id;
      const toplar = await serbestToplar(sql, 3);
      if (toplar.length < 3) throw new Error("depoda serbest top yok");
      const cuval = async (anahtar, customerId, branchId, barkod, kg) => {
        const c = await api(`/api/shipping/sacks`, { method: "POST", body: JSON.stringify({ customerId, ...(branchId ? { branchId } : {}), clientToken: crypto.randomUUID() }) });
        const id = c.govde?.data?.id;
        if (!id) throw new Error(`çuval: ${c.status} ${JSON.stringify(c.govde).slice(0, 160)}`);
        const o = await api(`/api/shipping/sacks/${id}/scan`, { method: "POST", body: JSON.stringify({ barcode: barkod }) });
        if (o.status >= 300) throw new Error(`okutma: ${o.status} ${JSON.stringify(o.govde).slice(0, 160)}`);
        if (kg) await api(`/api/shipping/sacks/${id}/weigh`, { method: "POST", body: JSON.stringify({ weightKg: kg }) });
        olc.sacks[anahtar] = { id, sackNo: c.govde.data.sackNo };
      };
      await cuval("ilk", olc.ids.bos, null, toplar[0].barcode, null);
      await cuval("ikinci", olc.ids.bos, null, toplar[1].barcode, null);
      await cuval("subeli", olc.ids.subeli, olc.ids.sube, toplar[2].barcode, 12.5);
    },
    dogrula: [
      { ad: "beş cari doğdu; boş carinin yönü NULL, şubenin yönü EXPORT", sql: `SELECT (SELECT count(*)::int FROM customers WHERE name LIKE $1) n, (SELECT "defaultDestination" FROM customers WHERE name=$2) b, (SELECT "defaultDestination" FROM customer_branches WHERE code=$3) s`,
        params: () => [`${buyukTr(SY.onek)} %`, buyukTr(SY.bos), SY.subeKodu], oku: (r) => `${r[0].n}:${r[0].b}:${r[0].s}`, beklenen: "5:null:EXPORT" },
      { ad: "üç çuval dolu", sql: `SELECT count(*)::int n FROM rolls WHERE "sackId" = ANY($1::uuid[])`, params: () => [Object.values(olc.sacks).map((s) => s.id)], oku: (r) => r[0].n, beklenen: 3 },
    ],
  },
  {
    id: "SY2", rol: "P", gerektirir: ["SY1"],
    yol: "(a) Paketleme / Çuvallar → yönü BOŞ carinin çuvalı → Sevk Et → seçici + 'carinin kartına yazılır' notu → Yurtiçi → Sevk Et", rota: "operations/sacks",
    async yap(ctx) {
      const { page } = ctx;
      const d = await cuvaldanSevkAc(ctx, olc.sacks.ilk.sackNo);
      const secici = d.getByTestId("destination-first-pick");
      await secici.waitFor({ timeout: 15_000 });
      if (!(await secici.getByText(/carinin kartına yazılır/).count())) throw new Error("'carinin kartına yazılır' notu yok");
      if (await d.getByRole("button", { name: "Sevk Et", exact: true }).isEnabled()) throw new Error("yön seçilmeden 'Sevk Et' aktif");
      await secici.getByRole("button", { name: "Yurtiçi", exact: true }).click({ timeout: 10_000 });
      olc.ids.sevk1 = await sevkEtVeBekle(page, d);
    },
    dogrula: [
      { ad: "ilk açık seçim KARTA yazıldı (DOMESTIC)", sql: `SELECT "defaultDestination" d FROM customers WHERE id=$1`, params: () => [olc.ids.bos], oku: (r) => r[0].d, beklenen: "DOMESTIC" },
      { ad: "sevkiyat DOMESTIC", sql: `SELECT destination d FROM shipments WHERE id=$1`, params: () => [olc.ids.sevk1], oku: (r) => r[0]?.d, beklenen: "DOMESTIC" },
    ],
  },
  {
    id: "SY3", rol: "P", gerektirir: ["SY2"],
    yol: "(b) aynı cariye ikinci çuval → Sevk Et → rozet 'Yurtiçi · Cariden', seçici YOK → Sevk Et", rota: "operations/sacks",
    async yap(ctx) {
      const d = await cuvaldanSevkAc(ctx, olc.sacks.ikinci.sackNo);
      const rozet = d.getByTestId("destination-lock-badge");
      await rozet.waitFor({ timeout: 15_000 });
      const metin = await rozet.innerText();
      if (!/Yurtiçi/.test(metin) || !/Cariden/.test(metin)) throw new Error(`rozet: ${metin}`);
      if (await d.getByTestId("destination-first-pick").count()) throw new Error("kilitliyken seçici çizildi");
      olc.ids.sevk2 = await sevkEtVeBekle(ctx.page, d);
    },
    dogrula: [{ ad: "ikinci sevkiyat DOMESTIC (kilitten)", sql: `SELECT destination d FROM shipments WHERE id=$1`, params: () => [olc.ids.sevk2], oku: (r) => r[0]?.d, beklenen: "DOMESTIC" }],
  },
  {
    id: "SY4", rol: "P", gerektirir: ["SY1"],
    yol: "(d) şubeli carinin çuvalı (şube yönü Yurtdışı, cari Yurtiçi) → rozet 'Yurtdışı · Şubeden' + İhracat Kodu → Sevk Et", rota: "operations/sacks",
    async yap(ctx) {
      const d = await cuvaldanSevkAc(ctx, olc.sacks.subeli.sackNo);
      const rozet = d.getByTestId("destination-lock-badge");
      await rozet.waitFor({ timeout: 15_000 });
      const metin = await rozet.innerText();
      olc.rozet = (metin.match(/İhracat Kodu:\s*(\S+)/) ?? [])[1] ?? null;
      if (!/Yurtdışı/.test(metin) || !/Şubeden/.test(metin)) throw new Error(`rozet: ${metin}`);
      olc.ids.sevk3 = await sevkEtVeBekle(ctx.page, d);
    },
    dogrula: [
      { ad: "ekrandaki ihracat kodu = şube kodu", sql: `SELECT 1`, oku: () => olc.rozet, beklenen: SY.subeKodu },
      { ad: "sevkiyat EXPORT (şube, cari yurtiçi olsa da)", sql: `SELECT destination d FROM shipments WHERE id=$1`, params: () => [olc.ids.sevk3], oku: (r) => r[0]?.d, beklenen: "EXPORT" },
    ],
  },
  {
    id: "SY5", rol: "P", gerektirir: ["SY1"],
    yol: "(c) Kumaş Stoğu → Bitmiş Depo → top seç → Seçilenleri Sevk Et → cari: ihracat kilitli → gerekçe görünür, Sevk Et PASİF", rota: "operations/rolls",
    async yap(ctx) {
      const { gor, page } = ctx;
      const d = await hizliSevkAc(ctx, SY.ihracat);
      await gor(d.getByText(/ihracat olarak kilitli/), { sure: 15_000 });
      olc.hizliPasif = !(await d.getByRole("button", { name: /^Sevk Et/ }).isEnabled());
      olc.hizliMetin = (await d.getByText(/ihracat olarak kilitli/).first().innerText()).trim();
      await page().keyboard.press("Escape");
    },
    dogrula: [
      { ad: "Hızlı Sevk düğmesi PASİF", sql: `SELECT 1`, oku: () => olc.hizliPasif, beklenen: true },
      { ad: "ekrandaki gerekçe = sunucunun kilit ucunun metni", uc: () => `/api/shipping/destination-lock?customerId=${olc.ids.ihracat}`, oku: (g) => g?.data?.quickShipBlockedReason === olc.hizliMetin, beklenen: true },
    ],
  },
  {
    id: "SY5b", rol: "P", gerektirir: ["SY1"],
    yol: "(c') Hızlı Sevk → yönü BOŞ cari → seçici çıkar → Yurtdışı: gerekçe + PASİF → Yurtiçi → Sevk Et → karta yazıldı", rota: "operations/rolls",
    async yap(ctx) {
      const { gor, page, sql, api } = ctx;
      const [serbest] = await serbestToplar(sql, 1);
      if (!serbest) throw new Error("depoda serbest top yok");
      const d = await hizliSevkAc(ctx, SY.hizli, serbest.barcode);
      const secici = d.getByTestId("destination-first-pick");
      await gor(secici, { sure: 15_000 });
      const dugme = d.getByRole("button", { name: /^Sevk Et/ });
      olc.hizliSecimsizPasif = !(await dugme.isEnabled());
      await secici.getByRole("button", { name: "Yurtdışı", exact: true }).click({ timeout: 10_000 });
      await gor(d.getByText(/ızlı sevk ihracatta yapılamaz/), { sure: 10_000 });
      olc.hizliIhracatPasif = !(await dugme.isEnabled());
      olc.hizliSecimMetni = (await d.getByText(/ızlı sevk ihracatta yapılamaz/).first().innerText()).trim();
      // Kilit ucu SEVKTEN ÖNCE okunur — sevk karta yazınca seçim gerekçesi null olur.
      const kilit = await api(`/api/shipping/destination-lock?customerId=${olc.ids.hizli}`);
      olc.hizliUcMetni = kilit.govde?.data?.quickShipPickExportReason ?? null;
      await secici.getByRole("button", { name: "Yurtiçi", exact: true }).click({ timeout: 10_000 });
      const yanit = page().waitForResponse((r) => r.request().method() === "POST" && /\/api\/shipping\/shipments\/from-rolls/.test(r.url()), { timeout: 30_000 });
      await dugme.click({ timeout: 15_000 });
      const r = await yanit;
      const g = await r.json().catch(() => ({}));
      if (r.status() >= 300) throw new Error(`hızlı sevk ${r.status()} ${JSON.stringify(g).slice(0, 200)}`);
      olc.ids.hizliSevk = g?.data?.id;
    },
    dogrula: [
      { ad: "yön seçilmeden Sevk Et PASİF (örtük Yurtiçi yok)", sql: `SELECT 1`, oku: () => olc.hizliSecimsizPasif, beklenen: true },
      { ad: "Yurtdışı seçilince Sevk Et PASİF", sql: `SELECT 1`, oku: () => olc.hizliIhracatPasif, beklenen: true },
      { ad: "ekrandaki gerekçe = kilit ucunun seçim metni (sevkten önce okundu)", sql: `SELECT 1`, oku: () => olc.hizliUcMetni != null && olc.hizliSecimMetni.includes(olc.hizliUcMetni), beklenen: true },
      { ad: "Yurtiçi seçimi KARTA yazıldı", sql: `SELECT "defaultDestination" d FROM customers WHERE id=$1`, params: () => [olc.ids.hizli], oku: (r) => r[0].d, beklenen: "DOMESTIC" },
      { ad: "hızlı sevkiyat DOMESTIC", sql: `SELECT destination d FROM shipments WHERE id=$1`, params: () => [olc.ids.hizliSevk], oku: (r) => r[0]?.d, beklenen: "DOMESTIC" },
    ],
  },
  {
    id: "SY6", rol: "P", gerektirir: ["SY1"],
    yol: "(e) Tanımlar → Cariler → yurtiçi + ihracat kodu dolu cari → ✎ → İhracat Kodu alanı GİZLİ → Kaydet → kod DB'de yerinde", rota: "definitions/cariler",
    async yap({ git, gor, page }) {
      await git("Cariler");
      // /Ara/ üst şeritteki komut aramasını ("Ara veya komut…") yakalıyordu — sayfanın kendi kutusu.
      const ara = page().getByPlaceholder(/vergi no ara/i).filter({ visible: true }).first();
      await ara.fill(buyukTr(SY.gizli)); await page().waitForTimeout(1200);
      const satir = page().getByRole("row").filter({ hasText: buyukTr(SY.gizli) }).filter({ visible: true }).first();
      await gor(satir, { sure: 20_000 });
      await satir.getByRole("button").first().click({ timeout: 10_000 });
      const d = page().getByRole("dialog").filter({ hasText: /Cari/ }).last(); await gor(d);
      await page().waitForTimeout(600);
      olc.kodAlaniGorunur = await d.locator("#exportCode").count();
      // Doğru diyalog mu: cari formunun "Sevk yönü" alanı görünmeli (yoksa "alan yok" sahte yeşil olurdu).
      olc.sevkYonuAlani = await d.getByText("Sevk yönü", { exact: true }).count();
      await d.getByRole("button", { name: "Kaydet", exact: true }).click({ timeout: 15_000 });
      await d.waitFor({ state: "detached", timeout: 15_000 }).catch(() => undefined);
    },
    dogrula: [
      { ad: "doğru diyalog: cari formunun 'Sevk yönü' alanı görünür", sql: `SELECT 1`, oku: () => olc.sevkYonuAlani, beklenen: (n) => n >= 1 },
      { ad: "yurtiçi caride İhracat Kodu alanı çizilmedi", sql: `SELECT 1`, oku: () => olc.kodAlaniGorunur, beklenen: 0 },
      { ad: "gizlenen kod kayıttan sonra DB'de yerinde", sql: `SELECT "exportCode" k FROM customers WHERE id=$1`, params: () => [olc.ids.gizli], oku: (r) => r[0].k, beklenen: SY.gizliKod },
    ],
  },
  {
    id: "SY7", rol: "P",
    yol: "(f) Raporlar → Yurtiçi / Yurtdışı Satış → üç kart + kapsam + sekmeler (Ülke · Açık sipariş) → Excel", rota: "reports/sales/destination-mix",
    async yap({ git, gor, page, app }) {
      await git("Yurtiçi / Yurtdışı Satış");
      await gor(page().getByText("Yön kaydı yok (doğrudan sevk)").filter({ visible: true }).first(), { sure: 30_000 });
      olc.kapsam = (await page().getByTestId("destination-mix-kapsam").filter({ visible: true }).first().innerText()).replace(/\s+/g, " ");
      await page().getByRole("tab", { name: "Ülke" }).filter({ visible: true }).first().click({ timeout: 10_000 });
      await page().getByRole("tab", { name: "Açık sipariş ve termin" }).filter({ visible: true }).first().click({ timeout: 10_000 });
      await gor(page().getByText("Yurtdışı açık siparişler").filter({ visible: true }).first());
      const hedef = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tekserp-sy-")), "yon.xlsx");
      await app().evaluate(({ dialog }, p) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: p }); }, hedef);
      await page().getByRole("button", { name: "Excel" }).filter({ visible: true }).first().click({ timeout: 15_000 });
      for (let i = 0; i < 20 && !fs.existsSync(hedef); i++) await page().waitForTimeout(500);
      olc.excel = fs.existsSync(hedef) ? fs.statSync(hedef).size : 0;
    },
    dogrula: [
      { ad: "kapsam şeridi fiyat kapsamını ve kur kaynağını yazar", sql: `SELECT 1`, oku: () => /fiyatlı \d+ \/ \d+ tahsis satırı/.test(olc.kapsam ?? "") && /SEVK GÜNÜ/.test(olc.kapsam ?? ""), beklenen: true },
      { ad: "Excel dosyası diske yazıldı (bayt > 0)", sql: `SELECT 1`, oku: () => olc.excel, beklenen: (n) => n > 0 },
    ],
  },
  {
    id: "SY8", rol: "P", gerektirir: ["SY4"],
    yol: "(g) SY4 sevkiyatının irsaliyesi (HTML) → 'İhracat Kodu' = SY4'te ekranda görülen kod", rota: "operations/shipments",
    async yap({ ortam, kullanici }) {
      const giris = await fetch(`${ortam.apiUrl}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: kullanici.username, password: kullanici.password, clientType: "web" }) }).then((r) => r.json());
      const r = await fetch(`${ortam.apiUrl}/api/printed-documents/SHIPMENT_DISPATCH/${olc.ids.sevk3}/html`, { headers: { authorization: `Bearer ${giris.data.token}` } });
      const html = await r.text();
      olc.belgeDurum = r.status;
      // Belge satırı: "İhracat Kodu: <kod>" (etiket + değer arasında HTML olabilir).
      olc.belgeKod = (html.replace(/<[^>]+>/g, " ").match(/İhracat Kodu:\s*([A-Z0-9-]+)/) ?? [])[1] ?? null;
    },
    dogrula: [
      { ad: "irsaliye HTML'i geldi", sql: `SELECT 1`, oku: () => olc.belgeDurum, beklenen: 200 },
      { ad: "belgedeki İhracat Kodu = SY4'te ekrandaki rozet", sql: `SELECT 1`, oku: () => `${olc.belgeKod}=${olc.rozet}`, beklenen: `${SY.subeKodu}=${SY.subeKodu}` },
    ],
  },
];
export { olc as SY_OLCUM, SY };
