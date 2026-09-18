// =============================================================================
// GÜZERGÂH ADIMLARI — kullanıcı testi güzergâhının (A…M) makine karşılığı
// =============================================================================
// TEK DSL DOSYASI. Her adım: { id, rol, yol, rota, gerektirir?, yap, bekle?, dogrula }
//   id         güzergâh id'si (A1, B1 …) — tablet sürücüsü (d5) AYNI id'leri kullanır
//   rol        P panel-yönetici · M muhasebe · S sistem hesabı · T tablet (burada koşmaz)
//   yol        insanın tıkladığı menü yolu (rapor satırı için); `git(sayfaAdı)` komut paletiyle gider
//   gerektirir ön koşul adımlar; biri kırmızı/atlandıysa bu adım ATLANIR (kırmızı değil)
//   yap(ctx)   eylemler — beş fiil: git · tikla · yaz · sec · gor (+ diyalog · bekle · page)
//   bekle(ctx) ekranda beklenen ("Bekle:" satırı) — gor ile
//   dogrula[]  BACKEND doğrulaması: {ad, uc|sql, oku?, beklenen} — uç/tablo + beklenen sayı
//
// Kayıt adları `${onek} …` biçimindedir; `E2E_ONEK` (varsayılan TEST) aynı DB'de
// yeniden koşabilmek içindir — güzergâh belgesinde adlar "TEST …" olarak yazılıdır.
// =============================================================================
const ONEK = process.env.E2E_ONEK ?? "TEST";
/** Sunucu master-data adını Türkçe BÜYÜTEREK saklar (`name_uppercase_storage`); beklentiler de öyle yazılır. */
export const buyukTr = (s) => s.replace(/i/g, "İ").replace(/ı/g, "I").toUpperCase();
export const AD = {
  musteri: `${ONEK} Müşteri`,
  tedarikci: `${ONEK} Tedarikçi`,
  iplik: `${ONEK} İplik`, iplikKod: `${ONEK}-IP`,
  kumas: `${ONEK} Kumaş`, kumasKod: `${ONEK}-KM`,
  alisNotu: `${ONEK}-AS1`,
};

const MODUL_ANAHTARLARI = ["productionEnabled", "financeEnabled", "ticaretEnabled", "iplikEnabled", "depoMultiEnabled", "kumasTeknikEnabled", "tezgahEnabled", "devereEnabled", "dokumaEnabled", "emanetEnabled"];

export const ADIMLAR = [
  // ── A · HAZIRLIK ────────────────────────────────────────────────────────────
  {
    id: "A1", rol: "S",
    yol: "Sistem → Yapılandırma → Modüller", rota: "system/module-profile",
    async yap({ git }) { await git("Modüller"); },
    async bekle({ gor, page }) {
      await gor(page().getByRole("heading", { name: "Modüller" }).first());
      await gor(page().getByRole("heading", { name: "Raporlar" }).first());
      // 30 rapor satırı, her birinde Basit/Gelişmiş rozeti.
      const rozet = page().getByText(/^(Basit|Gelişmiş)$/);
      await rozet.first().waitFor({ timeout: 15_000 });
      const n = await rozet.count();
      if (n < 30) throw new Error(`Raporlar bölümünde ${n} rozet görüldü, 30 bekleniyordu`);
    },
    dogrula: [
      { ad: "on modül anahtarı AÇIK (GET /api/feature-flags)", uc: "/api/feature-flags",
        oku: (g) => MODUL_ANAHTARLARI.filter((k) => g?.data?.[k] !== true), beklenen: (kapali) => kapali.length === 0 },
      { ad: "kapalı rapor anahtarı yok", uc: "/api/feature-flags",
        oku: (g) => (g?.data?.reportsClosedKeys ?? []).length, beklenen: 0 },
    ],
  },

  // ── B · TANIMLAR ────────────────────────────────────────────────────────────
  {
    id: "B1", rol: "P",
    yol: "Tanımlar → İş Ortakları → Cariler → Yeni Cari", rota: "definitions/cariler",
    async yap({ git, tikla, yaz, sec, diyalog, gor, page }) {
      await git("Cariler");
      // ① TEST Müşteri — yalnız Müşteri rolü, sevk varsayılanı Yurtiçi
      await tikla("Yeni Cari");
      let d = diyalog("Yeni Cari"); await gor(d);
      await yaz(d.locator("#name"), AD.musteri);
      const musteriKutu = d.getByLabel("Müşteri", { exact: true });
      if (!(await musteriKutu.isChecked())) await musteriKutu.check();
      const tedarikciKutu = d.getByLabel("Tedarikçi", { exact: true });
      if (await tedarikciKutu.isChecked()) await tedarikciKutu.uncheck();
      await sec(d.getByRole("combobox").filter({ hasText: /Yok|Yurtiçi|Yurtdışı/ }).first(), "Yurtiçi");
      await tikla("Kaydet", { icinde: d, exact: true });
      await d.waitFor({ state: "detached", timeout: 15_000 });
      // ② TEST Tedarikçi — yalnız Tedarikçi rolü
      await tikla("Yeni Cari");
      d = diyalog("Yeni Cari"); await gor(d);
      await yaz(d.locator("#name"), AD.tedarikci);
      const m2 = d.getByLabel("Müşteri", { exact: true });
      if (await m2.isChecked()) await m2.uncheck();
      await d.getByLabel("Tedarikçi", { exact: true }).check();
      await tikla("Kaydet", { icinde: d, exact: true });
      await d.waitFor({ state: "detached", timeout: 15_000 });
      await page().waitForTimeout(500);
    },
    async bekle({ gor, page }) {
      // Listede iki satır, Rol sütununda rozetler — arama kutusuyla daraltarak (insan da öyle bulur).
      const ara = page().getByPlaceholder("Ad / kod / vergi no ara");
      for (const [ad, rozet] of [[AD.musteri, "Müşteri"], [AD.tedarikci, "Tedarikçi"]]) {
        await ara.fill(ad);
        await page().waitForTimeout(700);
        const satir = page().getByRole("row").filter({ hasText: buyukTr(ad) }).first();
        await gor(satir);
        await gor(satir.getByText(rozet, { exact: true }));
      }
      await ara.fill("");
    },
    dogrula: [
      { ad: "iki kart doğdu, roller doğru (customers)",
        sql: `SELECT name, "isCustomerRole" c, "isSupplierRole" s, "isSubcontractorRole" f, "defaultDestination" d FROM customers WHERE name IN ($1,$2) ORDER BY name`,
        params: [buyukTr(AD.musteri), buyukTr(AD.tedarikci)],
        oku: (r) => r.map((x) => `${x.name}:${x.c ? "M" : ""}${x.s ? "T" : ""}${x.f ? "F" : ""}:${x.d ?? "-"}`).join(" | "),
        beklenen: `${buyukTr(AD.musteri)}:M:DOMESTIC | ${buyukTr(AD.tedarikci)}:T:-` },
      { ad: "fason profili DOĞMADI (subcontractors)", sql: `SELECT count(*)::int n FROM subcontractors WHERE name IN ($1,$2)`, params: [buyukTr(AD.musteri), buyukTr(AD.tedarikci)], oku: (r) => r[0].n, beklenen: 0 },
      { ad: "cari hesap HENÜZ yok (ilk belgeyle açılır)", sql: `SELECT count(*)::int n FROM cari_accounts a JOIN customers c ON c.id=a."customerId" WHERE c.name IN ($1,$2)`, params: [buyukTr(AD.musteri), buyukTr(AD.tedarikci)], oku: (r) => r[0].n, beklenen: 0 },
    ],
  },
  {
    id: "B2", rol: "P", gerektirir: [],
    yol: "Tanımlar → Ürün Kataloğu → Ürünler → Yeni Ürün", rota: "definitions/items",
    async yap({ git, tikla, yaz, sec, diyalog, gor, page }) {
      await git("Ürünler");
      const urunEkle = async (ad, kod, tip, denye) => {
        // ⚠️ Güzergâh "Yeni Ürün" der, ekrandaki düğme "Yeni"dir (diyalog başlığı "Yeni Ürün") — belge notu.
        await tikla("Yeni", { exact: true });
        const d = diyalog("Yeni Ürün"); await gor(d);
        await yaz(d.locator("#name"), ad);
        await sec(d.getByRole("combobox").filter({ hasText: /Kumaş|İplik|Sarf/ }).first(), tip);
        if (denye) await yaz(d.locator("#linearDensityDen"), denye);
        await tikla("Elle gir", { icinde: d });
        await yaz(d.locator("#code"), kod);
        await tikla("Oluştur", { icinde: d, exact: true });
        await d.waitFor({ state: "detached", timeout: 15_000 });
        await page().waitForTimeout(400);
      };
      await urunEkle(AD.iplik, AD.iplikKod, "İplik", "150");
      await urunEkle(AD.kumas, AD.kumasKod, "Kumaş", null);
    },
    async bekle({ gor }) { await gor(buyukTr(AD.iplik), { exact: true }); await gor(buyukTr(AD.kumas), { exact: true }); },
    dogrula: [
      { ad: "iki ürün, tip ve birim doğru (items)",
        sql: `SELECT code, "itemType" t, unit, "linearDensityDen" den FROM items WHERE code IN ($1,$2) ORDER BY code`, params: [AD.iplikKod, AD.kumasKod],
        oku: (r) => r.map((x) => `${x.code}:${x.t}:${x.unit}:${x.den ?? "-"}`).join(" | "),
        beklenen: `${AD.iplikKod}:YARN:KG:150.0000 | ${AD.kumasKod}:FABRIC:MT:-` },
    ],
  },

  // ── C · İPLİK GELDİ ─────────────────────────────────────────────────────────
  {
    id: "C1", rol: "P", gerektirir: ["B1", "B2"],
    yol: "Operasyon → Depo & Paketleme → Alış Siparişleri → Yeni Sipariş", rota: "operations/purchase-orders",
    async yap({ git, tikla, yaz, diyalog, gor, page }) {
      await git("Alış Siparişleri");
      await tikla(/yeni sipariş/i);
      const d = diyalog("Yeni Alış Siparişi"); await gor(d);
      // Tedarikçi: tam liste modalı → satıra tıkla
      await tikla("Tedarikçi seç (liste)", { icinde: d, exact: true });
      const tm = diyalog("Tedarikçi seç"); await gor(tm);
      // Liste 50'şer yüklenir — insan arama kutusuna yazar, biz de.
      await tm.getByRole("textbox").first().fill(AD.tedarikci);
      await page().waitForTimeout(700);
      await tm.getByRole("row").filter({ hasText: buyukTr(AD.tedarikci) }).first().click({ timeout: 15_000 });
      await tm.waitFor({ state: "detached", timeout: 15_000 }).catch(() => undefined);
      await yaz(d.locator("textarea").first(), AD.alisNotu); // "Not (opsiyonel)" etiketi input'a BAĞLI DEĞİL (htmlFor yok) — belge notu
      // Kalem: ürün modalı → TEST İplik; miktar 120; birim fiyat 85; not
      await tikla("Ürün seç (liste)", { icinde: d, exact: true });
      const um = diyalog("Ürün seç"); await gor(um);
      await um.getByPlaceholder("Kod, ad").fill(AD.iplik);
      await page().waitForTimeout(700);
      await um.getByRole("row").filter({ hasText: buyukTr(AD.iplik) }).first().click({ timeout: 15_000 });
      await um.waitFor({ state: "detached", timeout: 15_000 }).catch(() => undefined);
      await d.getByLabel("Miktar").first().fill("120");
      await d.getByPlaceholder("—").first().fill("85"); // birim fiyat kutusunun erişilebilir adı YOK (yalnız "—" yer tutucu) — belge notu
      await d.getByLabel("Not").first().fill("1. parti");
      await tikla(/Siparişi aç \(1 kalem\)/, { icinde: d });
      await d.waitFor({ state: "detached", timeout: 20_000 });
      await page().waitForTimeout(600);
    },
    async bekle({ gor, page }) {
      await gor(page().getByRole("row").filter({ hasText: buyukTr(AD.tedarikci) }).filter({ hasText: /Bekliyor/ }).first());
    },
    dogrula: [
      { ad: "sipariş açık, 1 kalem 120 × 85 (purchase_orders/lines)",
        sql: `SELECT po.status, po.currency, l.qty::text q, l."unitPrice"::text p FROM purchase_orders po JOIN purchase_order_lines l ON l."purchaseOrderId"=po.id JOIN customers c ON c.id=po."supplierId" WHERE c.name=$1 AND po.notes=$2`,
        params: [buyukTr(AD.tedarikci), AD.alisNotu],
        oku: (r) => r.map((x) => `${x.status}:${x.currency}:${x.q}:${x.p}`).join(" | "), beklenen: (v) => /^OPEN:TRY:120(\.0+)?:85(\.0+)?$/.test(v) },
      { ad: "henüz mal kabul YOK (kalan 120)", sql: `SELECT count(*)::int n FROM goods_receipts gr JOIN purchase_orders po ON po.id=gr."purchaseOrderId" WHERE po.notes=$1`, params: [AD.alisNotu], oku: (r) => r[0].n, beklenen: 0 },
    ],
  },
];
