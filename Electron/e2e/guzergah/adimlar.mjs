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
  irsaliye: `IRS-${ONEK}-1`, lot: `${ONEK}-L1`,
  kasa: `${ONEK} Kasa`, dekont: `Dekont ${ONEK}-1`,
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

/** C8'in adım içi ölçümleri — `dogrula` kapanışlardan okur (uç GET'i yetmez, POST sonucu gerekir). */
const c8Olcum = { uiKapali: null, satirKirmizi: null, apiDurum: null, apiKod: null, fisArtti: null };

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

  {
    id: "C2", rol: "P", gerektirir: ["C1"],
    yol: "Operasyon → Depo & Paketleme → Mal Kabul → Yeni Mal Kabul", rota: "operations/goods-receipts",
    async yap({ git, tikla, diyalog, gor, page }) {
      await git("Mal Kabul");
      await tikla("Yeni Mal Kabul");
      const d = diyalog("Yeni Mal Kabul"); await gor(d);
      // Alış siparişi (native <select>): TEST siparişi seçilince tedarikçi kilitlenir, kalemler siparişten dolar.
      const poSecici = d.locator("select").filter({ has: page().locator("option", { hasText: /Siparişsiz/ }) }).first();
      await poSecici.selectOption({ label: await poSecici.locator("option").filter({ hasText: buyukTr(AD.tedarikci) }).first().textContent() });
      await page().waitForTimeout(800);
      await gor(d.getByText("Tedarikçi (siparişten)"));
      // Depo (çok depoluysa): ilk gerçek seçenek
      const depo = d.locator("select").filter({ has: page().locator("option", { hasText: /Depo seçin/ }) }).first();
      if (await depo.count()) {
        const secenekler = await depo.locator("option").allTextContents();
        if (secenekler.length > 1 && !(await depo.inputValue())) await depo.selectOption({ index: 1 });
      }
      await d.getByPlaceholder("IRS-...").fill(AD.irsaliye);
      // İplik satırı siparişten geldi (120 kg × 85). Lot ÖNCE boş → düğme KAPALI olmalı (lot zorunlu açıksa).
      const lot = d.getByLabel("Lot numarası").first();
      await gor(lot);
      const kgKutusu = d.getByLabel("Miktar (kg)").first();
      const kg = await kgKutusu.inputValue();
      if (kg !== "120") throw new Error(`siparişten dolan kg 120 değil: ${kg}`);
      const olustur = d.getByRole("button", { name: /Fişi Oluştur/ });
      const lotZorunluIkenKapali = await olustur.isDisabled();
      await lot.fill(AD.lot);
      await d.getByLabel("Bobin adedi").first().fill("24");
      await page().waitForTimeout(300);
      // Düğme "Fişi Oluştur (1 iplik)" — belge "(… + 120 kg iplik)" der; toplam satırı "120 kg iplik · 10.200,00 TRY" gösterir — belge notu.
      await gor(d.getByText(/120 kg iplik/).first());
      await olustur.click({ timeout: 15_000 });
      await d.waitFor({ state: "detached", timeout: 20_000 });
      await page().waitForTimeout(600);
      page().__lotZorunluIkenKapali = lotZorunluIkenKapali; // rapor notu (lot zorunlu ayarı fixture'da kapalı olabilir)
    },
    async bekle({ gor, page }) {
      // Fiş oluşunca detay paneli kendiliğinden açılır: irsaliye · 120 kg iplik · sipariş "Tamamlandı".
      await gor(page().getByText(AD.irsaliye, { exact: true }).first());
      await gor(page().getByText(/120 kg iplik/).first());
      await gor(page().getByText(/tamamlandı — tüm kalemler karşılandı/i).first());
      await page().keyboard.press("Escape");
      await page().waitForTimeout(400);
    },
    dogrula: [
      { ad: "fiş siparişe bağlı, irsaliye no doğru (goods_receipts)",
        sql: `SELECT gr."deliveryNoteNo" irs, gr.status, (gr."purchaseOrderId" IS NOT NULL) bagli FROM goods_receipts gr JOIN purchase_orders po ON po.id=gr."purchaseOrderId" WHERE po.notes=$1`,
        params: [AD.alisNotu], oku: (r) => r.map((x) => `${x.irs}:${x.status}:${x.bagli}`).join("|"), beklenen: `${AD.irsaliye}:ACTIVE:true` },
      { ad: "lot doğdu, tedarikçisi dolu (yarn_lots)",
        sql: `SELECT l."lotNo", (l."supplierId" IS NOT NULL) ted FROM yarn_lots l WHERE l."lotNo"=$1`, params: [AD.lot],
        oku: (r) => r.map((x) => `${x.lotNo}:${x.ted}`).join("|"), beklenen: `${AD.lot}:true` },
      { ad: "iplik defterine +120 kg IN (yarn_movements)",
        sql: `SELECT m.kind, m."qtyKg"::text kg, m."bobbinCount" b FROM yarn_movements m JOIN yarn_lots l ON l.id=m."lotId" WHERE l."lotNo"=$1`, params: [AD.lot],
        oku: (r) => r.map((x) => `${x.kind}:${x.kg}:${x.b}`).join("|"), beklenen: (v) => /^IN:120(\.0+)?:24$/.test(v) },
      { ad: "alış siparişi kapandı (kalan 0)", sql: `SELECT status FROM purchase_orders WHERE notes=$1`, params: [AD.alisNotu], oku: (r) => r[0]?.status, beklenen: "CLOSED" },
    ],
  },

  {
    id: "C3", rol: "P", gerektirir: ["C2"],
    yol: "Operasyon → Depo & Paketleme → Mal Kabul → ikinci kez Yeni Mal Kabul (kapanmış sipariş)", rota: "operations/goods-receipts",
    async yap({ git, tikla, diyalog, gor, page, api }) {
      await git("Mal Kabul");
      await tikla("Yeni Mal Kabul");
      const d = diyalog("Yeni Mal Kabul"); await gor(d);
      const poSecici = d.locator("select").filter({ has: page().locator("option", { hasText: /Siparişsiz/ }) }).first();
      const adaylar = await poSecici.locator("option").allTextContents();
      // Güzergâh: "Kalan 0 → satır gelmez". Ekran bunu bir adım ÖNCE çözüyor: kapanmış
      // sipariş listede HİÇ yok (`YALNIZ AÇIK SİPARİŞLER`, OPEN/PARTIAL) — 9b'nin C3
      // sadeleştirmesi zaten uygulanmış. Listede olsaydı seçip 0 satır beklerdik.
      const kapaliListede = adaylar.some((a) => a.includes(buyukTr(AD.tedarikci)));
      try {
        if (kapaliListede) {
          // ⚠️ ÖLÇÜLDÜ (2026-09-18): C2'den 30 sn içinde açılırsa KAPANMIŞ sipariş listede hâlâ var ve
          // "Bekleyen" tablosu GELEN 0 kg gösterir — seçici `staleTime: 30_000` önbelleği. Sunucu
          // (`filter[status]=OPEN,PARTIAL`) onu çoktan düşürmüştür; ekran bayat. İnsan aynı hızda
          // çalışırsa ikinci fişi kapanmış siparişten doldurabilir — fazla teslimi SUNUCU keser mi,
          // O-dalında ayrı ölçülür (O8). Burada yalnız BEYAN: satır dolduysa kırmızı + sebep.
          await poSecici.selectOption({ label: adaylar.find((a) => a.includes(buyukTr(AD.tedarikci))) });
          await page().waitForTimeout(800);
          const satir = await d.getByLabel("Miktar (kg)").count();
          const apiAcik = (await api("/api/purchase-orders?page=1&pageSize=200&filter%5Bstatus%5D=OPEN,PARTIAL")).govde?.data?.some((o) => o.notes === AD.alisNotu);
          if (satir > 0) throw new Error(`kapanmış siparişten kalem DOLDU (sunucu açık listesinde ${apiAcik ? "VAR — gerçek ihlal" : "YOK — ekran önbelleği bayat, staleTime 30 sn"})`);
        }
      } finally {
        await tikla("İptal", { icinde: d, exact: true }).catch(() => undefined);
        await d.waitFor({ state: "detached", timeout: 15_000 }).catch(() => undefined);
      }
    },
    dogrula: [
      { ad: "kapanmış sipariş ikinci fiş ALMADI (goods_receipts hâlâ 1)",
        sql: `SELECT count(*)::int n FROM goods_receipts gr JOIN purchase_orders po ON po.id=gr."purchaseOrderId" WHERE po.notes=$1`, params: [AD.alisNotu], oku: (r) => r[0].n, beklenen: 1 },
      { ad: "sipariş CLOSED ve açık sipariş ucunda YOK (GET /api/purchase-orders?status=OPEN,PARTIAL)",
        uc: "/api/purchase-orders?page=1&pageSize=200&filter%5Bstatus%5D=OPEN,PARTIAL", // `status=` çıplak parametre sunucuda YOK SAYILIR (filter[status] gerekir)
        oku: (g) => (g?.data ?? []).filter((o) => o.notes === AD.alisNotu).length, beklenen: 0 },
    ],
  },
  {
    id: "C4", rol: "P", gerektirir: ["C2"],
    yol: "Operasyon → Depo & Paketleme → İplik Stoğu → sekme Stok · Lotlar", rota: "operations/yarn",
    async yap({ git, gor, page }) {
      await git("İplik Stoğu");
      await page().getByPlaceholder("İplik adı / stok kodu ara").filter({ visible: true }).first().fill(AD.iplikKod);
      await page().waitForTimeout(700);
      const satir = page().getByRole("row").filter({ hasText: buyukTr(AD.iplik) }).first();
      await gor(satir);
      await gor(satir.getByText(/120/).first());
      // Hareket dökümü: kaynak mal kabul, lot
      await satir.getByTitle("Hareket dökümü").click({ timeout: 15_000 });
      await gor(page().getByText(AD.lot, { exact: false }).first());
      await page().keyboard.press("Escape");
      await page().waitForTimeout(300);
      // Lotlar sekmesi
      await page().getByRole("tab", { name: "Lotlar" }).click({ timeout: 15_000 });
      await page().getByLabel("Lot ara").fill(AD.lot);
      await page().waitForTimeout(700);
    },
    async bekle({ gor, page }) {
      const lotSatiri = page().getByRole("row").filter({ hasText: AD.lot }).first();
      await gor(lotSatiri);
      await gor(lotSatiri.getByText(buyukTr(AD.tedarikci), { exact: false }));
      await gor(lotSatiri.getByText(/120/).first());
    },
    dogrula: [
      { ad: "stok ucu bakiye 120 (GET /api/yarn/stocks?search)", uc: `/api/yarn/stocks?search=${encodeURIComponent(AD.iplikKod)}`,
        oku: (g) => { const s = (g?.data ?? []).find((x) => (x.item?.code ?? x.itemCode ?? x.code) === AD.iplikKod); const v = s?.balanceKg ?? s?.qtyKg ?? s?.balance; return v == null ? null : Number(v); }, beklenen: (v) => v === 120 },
      { ad: "lot ucu tedarikçili ve bakiyeli (GET /api/yarn/lots?search)", uc: `/api/yarn/lots?search=${encodeURIComponent(AD.lot)}`,
        oku: (g) => { const l = (g?.data ?? []).find((x) => x.lotNo === AD.lot); return l ? `${Boolean(l.supplierId || l.supplier)}:${Number(l.balanceKg ?? l.balance ?? l.qtyKg)}` : null; }, beklenen: "true:120" },
      { ad: "üç görünüm tek defterden: Σ yarn_movements = 120", sql: `SELECT COALESCE(SUM(CASE WHEN m.kind::text LIKE '%IN' OR m.kind::text LIKE '%RETURN' OR m.kind::text LIKE '%REVERSAL' THEN m."qtyKg" ELSE -m."qtyKg" END),0)::text t FROM yarn_movements m JOIN yarn_lots l ON l.id=m."lotId" WHERE l."lotNo"=$1`, params: [AD.lot], oku: (r) => Number(r[0].t), beklenen: (v) => v === 120 },
    ],
  },

  {
    id: "C5", rol: "P", gerektirir: ["C2"],
    yol: "Operasyon → Mal Kabul → fiş satırı → Fişi Görüntüle / Bas · Alış Faturası Oluştur", rota: "operations/goods-receipts",
    async yap({ git, gor, page }) {
      await git("Mal Kabul");
      await page().getByPlaceholder("Fiş no veya tedarikçi irsaliye no ara").filter({ visible: true }).first().fill(AD.irsaliye);
      await page().waitForTimeout(700);
      await page().getByRole("row").filter({ hasText: AD.irsaliye }).first().click({ timeout: 15_000 });
      await gor(page().getByText(AD.irsaliye, { exact: true }).first());
      // Belge önizlemesi (✋ insan gözü) — burada yalnız açılıp kapandığı ölçülür.
      await page().getByRole("button", { name: /Fişi Görüntüle \/ Bas/ }).click({ timeout: 15_000 });
      await page().waitForTimeout(1500);
      await page().keyboard.press("Escape");
      await page().waitForTimeout(400);
      await page().getByRole("button", { name: "Alış Faturası Oluştur", exact: true }).click({ timeout: 15_000 });
      // Doğan taslak fatura detayı AÇILIR (B2): "<docNo> — Alış Faturası"
      const fd = page().getByRole("dialog").filter({ hasText: /Alış Faturası/ }).last();
      await gor(fd);
      await gor(fd.getByText("Taslak", { exact: true }).first());
      await page().keyboard.press("Escape");
      await page().waitForTimeout(400);
    },
    async bekle({ git, gor, page }) {
      await git("Faturalar");
      await page().getByPlaceholder("Belge no / cari ara").filter({ visible: true }).first().fill(AD.tedarikci);
      await page().waitForTimeout(700);
      const satir = page().getByRole("row").filter({ hasText: buyukTr(AD.tedarikci) }).first();
      await gor(satir);
      await gor(satir.getByText("Alış Faturası", { exact: false }));
      await gor(satir.getByText("Taslak", { exact: true }));
      // Liste TUTAR kolonu KDV DAHİL toplamı gösterir (12.240,00 = 10.200 + %20) — belge "10.200 + KDV" der; belge notu.
      await gor(satir.getByText(/12\.240|10\.200/).first());
    },
    dogrula: [
      { ad: "alış faturası taslak, fişe bağlı, 10.200 + KDV (invoices/invoice_lines)",
        sql: `SELECT i.type, i.status, i.subtotal::text st, (i."vatTotal" > 0) kdv, (SELECT count(*) FROM invoice_lines il WHERE il."invoiceId"=i.id)::int n FROM invoices i JOIN goods_receipts gr ON gr.id=i."goodsReceiptId" WHERE gr."deliveryNoteNo"=$1`,
        params: [AD.irsaliye], oku: (r) => r.map((x) => `${x.type}:${x.status}:${x.st}:${x.kdv}:${x.n}`).join("|"), beklenen: (v) => /^PURCHASE:DRAFT:10200(\.0+)?:true:1$/.test(v) },
      { ad: "taslak cari deftere İŞLEMEDİ (cari_transactions 0)",
        sql: `SELECT count(*)::int n FROM cari_transactions t JOIN invoices i ON i.id=t."invoiceId" JOIN goods_receipts gr ON gr.id=i."goodsReceiptId" WHERE gr."deliveryNoteNo"=$1`, params: [AD.irsaliye], oku: (r) => r[0].n, beklenen: 0 },
    ],
  },
  {
    id: "C6", rol: "M", gerektirir: ["C5"],
    yol: "Muhasebe → Faturalar → taslak → Onayla · Cari Hesaplar → Düzenle (vade 30) → Ekstre", rota: "finance/invoices",
    async yap({ git, gor, page }) {
      await git("Faturalar");
      await page().getByPlaceholder("Belge no / cari ara").filter({ visible: true }).first().fill(AD.tedarikci);
      await page().waitForTimeout(700);
      const satir = page().getByRole("row").filter({ hasText: buyukTr(AD.tedarikci) }).filter({ hasText: "Taslak" }).first();
      await gor(satir);
      await satir.getByRole("button", { name: "Onayla", exact: true }).click({ timeout: 15_000 });
      const onay = page().getByRole("dialog").filter({ hasText: /deftere işle/ }).last(); await gor(onay);
      await onay.getByRole("button", { name: "Onayla ve deftere işle" }).click({ timeout: 15_000 });
      await onay.waitFor({ state: "detached", timeout: 15_000 });
      await page().waitForTimeout(600);
      // Cari Hesaplar: hesap faturayla KENDİLİĞİNDEN doğdu
      await git("Cari Hesaplar");
      await page().getByPlaceholder("Cari ara").filter({ visible: true }).first().fill(AD.tedarikci);
      await page().waitForTimeout(700);
      const hesap = page().getByRole("row").filter({ hasText: buyukTr(AD.tedarikci) }).first();
      await gor(hesap);
      await hesap.getByRole("button", { name: "Düzenle" }).click({ timeout: 15_000 });
      const d = page().getByRole("dialog").filter({ hasText: "Cari Kartı Düzenle" }).last(); await gor(d);
      await d.locator("#cari-term").fill("30");
      await d.locator("#cari-currency").selectOption("TRY");
      await d.getByRole("button", { name: "Kaydet", exact: true }).click({ timeout: 15_000 });
      await d.waitFor({ state: "detached", timeout: 15_000 });
      await page().waitForTimeout(500);
      await hesap.getByRole("button", { name: "Ekstre" }).click({ timeout: 15_000 });
    },
    async bekle({ gor, page }) {
      const e = page().getByRole("dialog").filter({ hasText: /Cari Ekstre/ }).last();
      await gor(e);
      await gor(e.getByText(/10\.200|12\.240|Alış|Fatura/).first());
      await page().keyboard.press("Escape");
    },
    dogrula: [
      { ad: "fatura ONAYLI (invoices.status=CONFIRMED)", sql: `SELECT i.status FROM invoices i JOIN goods_receipts gr ON gr.id=i."goodsReceiptId" WHERE gr."deliveryNoteNo"=$1`, params: [AD.irsaliye], oku: (r) => r[0]?.status, beklenen: "CONFIRMED" },
      { ad: "cari hesap faturayla doğdu, vade 30, TRY (cari_accounts)",
        sql: `SELECT a."paymentTermDays" v, a."defaultCurrency" pb, a.kind FROM cari_accounts a JOIN customers c ON c.id=a."customerId" WHERE c.name=$1`, params: [buyukTr(AD.tedarikci)],
        oku: (r) => r.map((x) => `${x.v}:${x.pb}:${x.kind}`).join("|"), beklenen: (v) => /^30:TRY:/.test(v) },
      { ad: "ekstrede 1 fatura satırı, bakiye NEGATİF (biz borçluyuz) (cari_transactions)",
        sql: `SELECT count(*)::int n, COALESCE(SUM(t.debit - t.credit),0)::text bakiye FROM cari_transactions t JOIN cari_accounts a ON a.id=t."cariId" JOIN customers c ON c.id=a."customerId" WHERE c.name=$1`, params: [buyukTr(AD.tedarikci)],
        oku: (r) => `${r[0].n}:${Number(r[0].bakiye) < 0 ? "NEG" : "POS"}`, beklenen: "1:NEG" },
    ],
  },

  {
    id: "C7", rol: "M", gerektirir: ["C6"],
    yol: "Muhasebe → Tahsilat / Ödeme → Ödeme (kasa yoksa Kasa & Banka → Kasa ekle) → Fatura Kapama", rota: "finance/payments",
    async yap({ git, gor, page }) {
      // Kasa yoksa aç (fabrika kopyasında kasa/banka tanımı yok — güzergâhın "yoksa TEST Kasa aç" dalı).
      await git("Kasa & Banka");
      if (!(await page().getByText(buyukTr(AD.kasa), { exact: false }).count()) && !(await page().getByText(AD.kasa, { exact: false }).count())) {
        await page().getByRole("button", { name: "Kasa ekle" }).click({ timeout: 15_000 });
        const kd = page().getByRole("dialog").filter({ hasText: "Yeni Kasa" }).last(); await gor(kd);
        await kd.locator("input").first().fill(AD.kasa);
        await kd.getByRole("button", { name: "Kaydet", exact: true }).click({ timeout: 15_000 });
        await kd.waitFor({ state: "detached", timeout: 15_000 });
        await page().waitForTimeout(500);
      }
      // Ödeme
      await git("Tahsilat / Ödeme");
      await page().getByRole("button", { name: "Ödeme", exact: true }).click({ timeout: 15_000 });
      const d = page().getByRole("dialog").filter({ hasText: "Yeni Ödeme" }).last(); await gor(d);
      // "Cari türü" seçimi YOK — tek "Cari" seçici (9b'nin C7 ③ sadeleştirmesi ekranda uygulanmış) — belge notu.
      await d.getByRole("button", { name: "Cari seç (liste)", exact: true }).click({ timeout: 15_000 });
      const cm = page().getByRole("dialog").filter({ hasText: /Cari seç/ }).last(); await gor(cm);
      await cm.getByRole("textbox").first().fill(AD.tedarikci);
      await page().waitForTimeout(700);
      await cm.getByRole("row").filter({ hasText: buyukTr(AD.tedarikci) }).first().click({ timeout: 15_000 });
      await cm.waitFor({ state: "detached", timeout: 15_000 }).catch(() => undefined);
      const kasaSec = d.locator("select").filter({ has: page().locator("option", { hasText: /Seçin/ }) }).first();
      const kasaAdayi = kasaSec.locator("option").filter({ hasText: buyukTr(AD.kasa) }).first();
      await kasaSec.selectOption({ label: (await ((await kasaAdayi.count()) ? kasaAdayi : kasaSec.locator("option").filter({ hasText: /Kasa ·/ }).first()).textContent()) });
      await d.locator("select").filter({ has: page().locator("option", { hasText: /Havale/ }) }).first().selectOption("BANK_TRANSFER");
      await d.locator('input[type="number"]').first().fill("6120"); // 12.240 / 2
      await d.getByPlaceholder("Dekont no, çek no").fill(AD.dekont);
      await d.getByRole("button", { name: /Ödeme Kaydet/ }).click({ timeout: 15_000 });
      await d.waitFor({ state: "detached", timeout: 20_000 });
      await page().waitForTimeout(600);
      // Fatura Kapama: Yön Ödeme → cari → ödemeyi seç → faturaya sığan tutarı yaz → Faturaları kapat
      await git("Fatura Kapama");
      await page().locator("select").filter({ has: page().locator("option", { hasText: /Ödeme → Alış/ }) }).first().selectOption("OUT");
      await page().getByRole("combobox").filter({ hasText: /Müşteri \/ fason ara/ }).first().click({ timeout: 15_000 });
      await page().getByPlaceholder("Ara (kod, isim, vergi no)").fill(AD.tedarikci);
      await page().waitForTimeout(800);
      await page().getByRole("option").filter({ hasText: buyukTr(AD.tedarikci) }).first().click({ timeout: 15_000 });
      await page().waitForTimeout(800);
      await page().getByRole("button").filter({ hasText: /6\.120/ }).first().click({ timeout: 15_000 });
      await page().getByTitle("Bu faturaya sığabilecek en büyük tutarı yaz").first().click({ timeout: 15_000 });
      await page().getByRole("button", { name: /Faturaları kapat \(1/ }).click({ timeout: 15_000 });
      await page().waitForTimeout(1000);
    },
    async bekle({ git, gor, page }) {
      await git("Tahsilat / Ödeme");
      // Liste referansı (dekont) GÖSTERMEZ: belge no · yön · cari · yöntem · kasa · tutar — belge notu.
      const satir = page().getByRole("row").filter({ hasText: buyukTr(AD.tedarikci) }).filter({ hasText: /6\.120/ }).first();
      await gor(satir);
      await gor(satir.getByText("Ödeme", { exact: true }));
      await gor(satir.getByText(buyukTr(AD.kasa), { exact: false }));
    },
    dogrula: [
      { ad: "ödeme kaydı OUT 6.120 havale (payments)",
        sql: `SELECT p.direction, p.method, p.amount::text a, (p."cashBoxId" IS NOT NULL) kasa FROM payments p WHERE p.reference=$1 OR p.notes=$1`, params: [AD.dekont],
        oku: (r) => r.map((x) => `${x.direction}:${x.method}:${x.a}:${x.kasa}`).join("|"), beklenen: (v) => /^OUT:BANK_TRANSFER:6120(\.0+)?:true$/.test(v) },
      // Carili ödeme `cash_transactions`a satır YAZMAZ — `CashBox.balance` iki yazarlıdır (Payment + CashTransaction);
      // kasa defteri ekranı ikisini birden toplar (`test_consistency §23`). Ölçülen şey kasa BAKİYESİ.
      { ad: "kasa bakiyesi 6.120 düştü (cash_boxes.balance, iki yazarlı denormalize)", sql: `SELECT balance::text b FROM cash_boxes WHERE name=$1`, params: [buyukTr(AD.kasa)], oku: (r) => Number(r[0]?.b), beklenen: (v) => Math.abs(v + 6120) < 0.01 },
      { ad: "ekstre bakiyesi yarıya indi (cari_transactions Σ = −6.120)",
        sql: `SELECT COALESCE(SUM(t.debit - t.credit),0)::text b FROM cari_transactions t JOIN cari_accounts a ON a.id=t."cariId" JOIN customers c ON c.id=a."customerId" WHERE c.name=$1`, params: [buyukTr(AD.tedarikci)],
        oku: (r) => Number(r[0].b), beklenen: (v) => Math.abs(Math.abs(v) - 6120) < 0.01 },
      { ad: "kapama: faturanın açık tutarı yarıya (payment_allocations 6.120)",
        sql: `SELECT COALESCE(SUM(pa.amount),0)::text a FROM payment_allocations pa JOIN invoices i ON i.id=pa."invoiceId" JOIN goods_receipts gr ON gr.id=i."goodsReceiptId" WHERE gr."deliveryNoteNo"=$1`, params: [AD.irsaliye],
        oku: (r) => Number(r[0].a), beklenen: (v) => Math.abs(v - 6120) < 0.01 },
    ],
  },

  {
    id: "C8", rol: "S", gerektirir: ["B2", "C2"],
    yol: "Sistem → Özellik Anahtarları → Devere / Levent → \"İplik lotu zorunlu olsun\" AÇ → Mal Kabul lot boş → Fişi Oluştur → anahtarı KAPAT", rota: "settings/flags",
    async yap({ git, tikla, gor, page, api, sql }) {
      const anahtar = async (acik) => {
        await git("Özellik Anahtarları");
        await tikla("Devere / Levent");
        // Satır: <label> (başlık + özet + rozet) içinde native checkbox — sekmeler kalıcı olduğundan yalnız görünür olan.
        const sw = page().locator("label", { hasText: "İplik lotu zorunlu olsun" }).locator('input[type="checkbox"]').filter({ visible: true }).first();
        await gor(sw);
        if ((await sw.isChecked()) !== acik) await sw.click();
        const kaydet = page().getByRole("button", { name: "Kaydet", exact: true }).filter({ visible: true }).first();
        if (await kaydet.isEnabled()) { await kaydet.click({ timeout: 15_000 }); await page().waitForTimeout(1200); }
      };
      await anahtar(true);
      const bayrak = (await api("/api/feature-flags")).govde?.data?.devereLotRequired;
      if (bayrak !== true) throw new Error(`anahtar AÇILMADI (API devereLotRequired=${bayrak})`);
      // Mal Kabul: siparişsiz, iplik satırı, lot BOŞ
      await git("Mal Kabul");
      await tikla("Yeni Mal Kabul");
      const d = page().getByRole("dialog").filter({ hasText: "Yeni Mal Kabul" }).last(); await gor(d);
      const depo = d.locator("select").filter({ has: page().locator("option", { hasText: /Depo seçin/ }) }).first();
      if (await depo.count() && !(await depo.inputValue())) await depo.selectOption({ index: 1 });
      // Form boş bir KUMAŞ satırıyla açılır (iplik satırı bazen taslaktan kalır) — yoksa "İplik satırı ekle".
      if (!(await d.getByText("İplik ara", { exact: false }).count())) await d.getByRole("button", { name: "İplik satırı ekle" }).click({ timeout: 15_000 });
      await d.getByText("İplik ara", { exact: false }).first().click({ timeout: 15_000 });
      const um = page().getByRole("dialog").filter({ hasText: /seç/ }).last(); await gor(um);
      await um.getByPlaceholder("Kod, ad").fill(AD.iplik);
      await page().waitForTimeout(700);
      await um.getByRole("row").filter({ hasText: buyukTr(AD.iplik) }).first().click({ timeout: 15_000 });
      await um.waitFor({ state: "detached", timeout: 15_000 }).catch(() => undefined);
      await d.getByLabel("Miktar (kg)").first().fill("5");
      await page().waitForTimeout(400);
      const olustur = d.getByRole("button", { name: /Fişi Oluştur/ });
      c8Olcum.uiKapali = await olustur.isDisabled();               // ekran: lot boşken düğme kapalı mı
      const lotKutusu = d.getByLabel("Lot numarası").first();
      c8Olcum.satirKirmizi = (await lotKutusu.getAttribute("aria-invalid")) === "true";
      await page().keyboard.press("Escape"); await page().waitForTimeout(300);
      // Sunucu tarafı: aynı gövdeyi UI'yi ATLAYARAK gönder — satır düşer mi, 400 mü?
      const depoId = (await sql(`SELECT id FROM warehouses WHERE "isActive" ORDER BY "createdAt" LIMIT 1`))[0]?.id;
      const itemId = (await sql(`SELECT id FROM items WHERE code=$1`, [AD.iplikKod]))[0]?.id;
      const oncekiFis = (await sql(`SELECT count(*)::int n FROM goods_receipts`))[0].n;
      const r = await api("/api/goods-receipts", { method: "POST", body: JSON.stringify({ warehouseId: depoId, lines: [{ itemId, initialQty: 5, lotNo: null }] }) });
      c8Olcum.apiDurum = r.status; c8Olcum.apiKod = r.govde?.details?.code ?? r.govde?.error?.code ?? null;
      c8Olcum.fisArtti = (await sql(`SELECT count(*)::int n FROM goods_receipts`))[0].n - oncekiFis;
      await anahtar(false);
    },
    dogrula: [
      { ad: "ekran: lot boşken satır kırmızı ve Fişi Oluştur KAPALI", sql: `SELECT 1`, oku: () => `${c8Olcum.satirKirmizi}:${c8Olcum.uiKapali}`, beklenen: "true:true" },
      { ad: "sunucu FAIL-CLOSED: lotsuz iplik satırı 400 + kod, fiş DOĞMADI (satır sessizce düşmez)", sql: `SELECT 1`,
        oku: () => `${c8Olcum.apiDurum}:${c8Olcum.apiKod}:${c8Olcum.fisArtti}`, beklenen: (v) => /^400:(YARN_LOT_REQUIRED|RECEIPT_LINES_INVALID):0$/.test(v) },
      { ad: "anahtar geri KAPALI (GET /api/feature-flags)", uc: "/api/feature-flags", oku: (g) => g?.data?.devereLotRequired, beklenen: false },
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
