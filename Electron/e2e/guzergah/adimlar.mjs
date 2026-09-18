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
  cozgu: `${ONEK} Çözgü`, cozguKod: `${ONEK}-CK1`,
  dokumaIstasyon: `${ONEK} DOKUMA`, tezgah: `${ONEK}-TZ1`,
  devereIstasyon: `${ONEK} DEVERE`, devereMakine: `${ONEK}-DV1`,
  siparisNo: `${ONEK}-S1`,
};

/** "İstasyon" düğmesi → "Yeni İstasyon" diyaloğu: ad + görev türü → Kaydet. Aynı ad zaten listedeyse atlar. */
async function istasyonAc(page, tikla, yaz, sec, diyalog, gor, ad, gorevTuru) {
  if (await page().getByRole("row").filter({ hasText: buyukTr(ad) }).count()) return;
  await tikla("İstasyon", { exact: true });
  const d = diyalog("Yeni İstasyon"); await gor(d);
  await yaz(d.locator("#name"), ad);
  await sec(d.getByRole("combobox").nth(1), gorevTuru); // Görev Türü (ikinci combobox; ilki Tip)
  await tikla("Kaydet", { icinde: d, exact: true });
  await d.waitFor({ state: "detached", timeout: 15_000 });
  await page().waitForTimeout(800);
}

/** İstasyon satırı (liste) ya da kartı (kart görünümü) içindeki makine ekleme düğmesi. */
async function istasyonaMakineEkle(page, istasyonAdi) {
  const satir = page.getByRole("row").filter({ hasText: istasyonAdi }).first();
  if (await satir.count()) return satir.getByRole("button", { name: /Makine/ }).first().click({ timeout: 15_000 });
  return page.locator(kartIciDugme(istasyonAdi, "Makine ekle")).first().click({ timeout: 15_000 });
}

/** XPath: `metin`i içeren EN İÇ kapsayıcının içindeki `dugme` — kart içi "Makine ekle" gibi. */
const kartIciDugme = (metin, dugme) =>
  `xpath=(//*[.//*[normalize-space()=${JSON.stringify(metin)}] and .//button[contains(normalize-space(.), ${JSON.stringify(dugme)})]])[last()]//button[contains(normalize-space(.), ${JSON.stringify(dugme)})]`;

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
      const ara = page().getByPlaceholder("Ad / kod / vergi no ara").filter({ visible: true }).first();
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

  {
    id: "B3", rol: "P", gerektirir: ["B2"],
    yol: "Tanımlar → Üretim & Kalite → Çözgü Kartları → Yeni", rota: "warp-specs",
    async yap({ git, tikla, yaz, diyalog, gor, page }) {
      await git("Çözgü Kartları");
      await tikla("Yeni", { exact: true });
      const d = diyalog("Yeni Çözgü Kartı"); await gor(d);
      await yaz(d.locator("#code"), AD.cozguKod);
      await yaz(d.locator("#name"), AD.cozgu);
      // Çözgü ipliği: "İplik seç" → modal → ara → satır
      await d.getByRole("button", { name: /İplik seç/ }).click({ timeout: 15_000 });
      const im = diyalog("Çözgü ipliği seç"); await gor(im);
      await im.getByPlaceholder("Ara (ad veya kod)").fill(AD.iplik);
      await page().waitForTimeout(700);
      await im.getByText(buyukTr(AD.iplik), { exact: true }).first().click({ timeout: 15_000 });
      await im.waitFor({ state: "detached", timeout: 15_000 }).catch(() => undefined);
      await yaz(d.locator("#endsCount"), "2000");
      await yaz(d.locator("#takeUpPct"), "8");
      await tikla("Kaydet", { icinde: d, exact: true });
      await d.waitFor({ state: "detached", timeout: 15_000 });
      await page().waitForTimeout(400);
    },
    async bekle({ gor, page }) {
      // Sekmeler kalıcı: önceki sayfaların arama kutuları DOM'da kalır → yalnız görünür olan.
      await page().getByPlaceholder("Kod veya ad ara").filter({ visible: true }).first().fill(AD.cozguKod);
      await page().waitForTimeout(600);
      await gor(page().getByRole("row").filter({ hasText: AD.cozguKod }).first());
    },
    dogrula: [
      { ad: "çözgü kartı: iplik TEST-IP, tel 2000, take-up 8 (warp_specs)",
        sql: `SELECT ws."endsCount" tel, ws."takeUpPct"::text tu, i.code iplik FROM warp_specs ws JOIN items i ON i.id=ws."yarnItemId" WHERE ws.code=$1`,
        params: [AD.cozguKod], oku: (r) => r.map((x) => `${x.iplik}:${x.tel}:${x.tu}`).join("|"),
        beklenen: (v) => new RegExp(`^${AD.iplikKod}:2000:8(\\.0+)?$`).test(v) },
    ],
  },
  {
    id: "B4", rol: "P", gerektirir: [],
    yol: "Tanımlar → Üretim & Kalite → Üretim İstasyonları → dokuma istasyonu → Makine ekle", rota: "stations",
    async yap({ git, tikla, yaz, sec, diyalog, gor, page }) {
      await git("Üretim İstasyonları");
      // Güzergâh: "dokuma istasyonu yoksa önce aç" — belirleyici olsun diye TEST dokuma istasyonu açılır.
      // ⚠️ Belge "Yeni İstasyon" der, düğme "İstasyon" (diyalog başlığı "Yeni İstasyon") — belge notu.
      await istasyonAc(page, tikla, yaz, sec, diyalog, gor, AD.dokumaIstasyon, "Dokuma Tezgahı");
      // Liste görünümünde satırdaki "+ Makine" (kart görünümünde "Makine ekle") — ikisi de denenir.
      await istasyonaMakineEkle(page(), buyukTr(AD.dokumaIstasyon));
      const d = diyalog("Yeni Makine"); await gor(d);
      await yaz(d.locator("#name"), AD.tezgah);
      const yuva = d.locator("#warpBeamSlots");
      if (await yuva.count()) await yuva.fill("1");
      await tikla("Kaydet", { icinde: d, exact: true });
      await d.waitFor({ state: "detached", timeout: 15_000 });
      await page().waitForTimeout(500);
    },
    async bekle({ gor, page }) { await gor(page().getByText(buyukTr(AD.tezgah), { exact: true }).first()); },
    dogrula: [
      { ad: "tezgah dokuma istasyonunda, 1 levent yuvası (machines/stations)",
        sql: `SELECT s.kind, s."consumesWarpBeam" c, m."warpBeamSlots" y FROM machines m JOIN stations s ON s.id=m."stationId" WHERE m.name=$1`,
        params: [buyukTr(AD.tezgah)], oku: (r) => r.map((x) => `${x.kind}:${x.c}:${x.y}`).join("|"), beklenen: "WEAVING:true:1" },
    ],
  },
  {
    id: "D0", rol: "P", gerektirir: [],
    yol: "Tanımlar → Üretim İstasyonları → İstasyon (DEVERE) → Makine ekle (DV1)", rota: "stations",
    async yap({ git, tikla, yaz, sec, diyalog, gor, page }) {
      await git("Üretim İstasyonları");
      // Devere artık bir görev TÜRÜ (WARPING): seçilince "levent sarar" yeteneği ön-dolar.
      await istasyonAc(page, tikla, yaz, sec, diyalog, gor, AD.devereIstasyon, "Devere (Levent Sarım)");
      await istasyonaMakineEkle(page(), buyukTr(AD.devereIstasyon));
      const d = diyalog("Yeni Makine"); await gor(d);
      await yaz(d.locator("#name"), AD.devereMakine);
      await tikla("Kaydet", { icinde: d, exact: true });
      await d.waitFor({ state: "detached", timeout: 15_000 });
      await page().waitForTimeout(500);
    },
    async bekle({ gor, page }) { await gor(page().getByText(buyukTr(AD.devereMakine), { exact: true }).first()); },
    dogrula: [
      { ad: "devere istasyonu levent SARAR, makinesi bağlı (stations/machines)",
        sql: `SELECT s.kind, s."producesWarpBeam" p, count(m.id)::int n FROM stations s LEFT JOIN machines m ON m."stationId"=s.id AND m.name=$2 WHERE s.name=$1 GROUP BY s.kind, s."producesWarpBeam"`,
        params: [buyukTr(AD.devereIstasyon), buyukTr(AD.devereMakine)], oku: (r) => r.map((x) => `${x.kind}:${x.p}:${x.n}`).join("|"), beklenen: "WARPING:true:1" },
      { ad: "tablet devere makinesini görür (GET /api/warp-beams/devere-machines)", uc: "/api/warp-beams/devere-machines",
        oku: (g) => (g?.data ?? []).filter((m) => m.name === buyukTr(AD.devereMakine)).length, beklenen: 1 },
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

  // ── E · SİPARİŞ → İŞ EMRİ ───────────────────────────────────────────────────
  {
    id: "E1", rol: "P", gerektirir: ["B1", "B2"],
    yol: "Operasyon → Satış & Planlama → Siparişler → Yeni Sipariş", rota: "operations/orders",
    async yap({ git, tikla, diyalog, gor, page }) {
      await git("Siparişler");
      await tikla("Yeni Sipariş");
      const d = diyalog("Yeni Sipariş"); await gor(d);
      await tikla("Müşteri seç (liste)", { icinde: d, exact: true });
      const mm = page().getByRole("dialog").filter({ hasText: /Müşteri seç|Cari seç/ }).last(); await gor(mm);
      await mm.getByRole("textbox").first().fill(AD.musteri);
      await page().waitForTimeout(700);
      await mm.getByRole("row").filter({ hasText: buyukTr(AD.musteri) }).first().click({ timeout: 15_000 });
      await mm.waitFor({ state: "detached", timeout: 15_000 }).catch(() => undefined);
      // Sipariş No: alan odaklanınca elle girişe döner.
      const no = d.locator("#orderNumber"); await no.click(); await no.fill(AD.siparisNo);
      // Kalem: Kumaş seç → modal → ara → satır; miktar 100; birim m (varsayılan)
      // Form bir boş kalem satırıyla açılır — "Sipariş Kalemi Ekle" ikinci satır olurdu.
      await d.getByRole("button", { name: "Kumaş seç", exact: true }).first().click({ timeout: 15_000 });
      const km = page().getByRole("dialog").filter({ hasText: /Kumaş seç|Ürün seç/ }).last(); await gor(km);
      await km.getByPlaceholder("Kod, ad").fill(AD.kumas);
      await page().waitForTimeout(700);
      await km.getByRole("row").filter({ hasText: buyukTr(AD.kumas) }).first().click({ timeout: 15_000 });
      await km.waitFor({ state: "detached", timeout: 15_000 }).catch(() => undefined);
      await d.getByLabel("Miktar").first().fill("100");
      await tikla("Sipariş Oluştur", { icinde: d, exact: true });
      await d.waitFor({ state: "detached", timeout: 20_000 });
      await page().waitForTimeout(600);
    },
    async bekle({ gor, page }) { await gor(page().getByText(AD.siparisNo, { exact: true }).first()); },
    dogrula: [
      { ad: "sipariş + 1 kalem 100 m, birim METER zorunlu (orders/order_lines)",
        sql: `SELECT o."orderNumber" no, l.quantity::text q, l.unit FROM orders o JOIN order_lines l ON l."orderId"=o.id JOIN customers c ON c.id=o."customerId" WHERE o."orderNumber"=$1 AND c.name=$2`,
        params: [AD.siparisNo, buyukTr(AD.musteri)], oku: (r) => r.map((x) => `${x.no}:${x.q}:${x.unit}`).join("|"),
        beklenen: (v) => new RegExp(`^${AD.siparisNo}:100(\\.0+)?:MT$`).test(v) },
    ],
  },
];
