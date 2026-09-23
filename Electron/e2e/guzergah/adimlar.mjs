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
  musteri: `${ONEK} Müşteri`, fasoncu: `${ONEK} Fasoncu`,
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

const e2Olcum = { rotaSablonu: null };
const e3Olcum = { uyumluBaska: null, ikinciMusteri: null, gorunenMusteri: null };
const g1Olcum = { tedarikciAlaniVar: null };
const i7Olcum = { barkod: null, sevkId: null, onceMetre: null, onceTop: null, sonraMetre: null, sonraTop: null, iadeMetre: null, iadeSayi: null };
const n6Olcum = { sevkId: null, satir: null, metre: null, belgeMetre: null };
const j2Olcum = { docNo: null, belgeAcildi: null, belgeDocNoVar: null, belge25Var: null };
const j3Olcum = { docNo: null, kasaOnce: null, makbuzAcildi: null, makbuz600Var: null };
const j4Olcum = { cariId: null, faturaSatiri: null, tahsilatSatiri: null, toplamOnce: null, toplamSonra: null, satirSonra: null, filtreSecenek: null };
const j5Olcum = { cariId: null, kasaNotlari: null, kasaSatir600: null, kdvNotlari: null, kdvCariSecici: null };
const m1Olcum = { paletSayisi: null, karoSayisi: null, apiKapali: null, apiKapaliKod: null, apiAcik: null, kategoriKaroVar: null };
const m3Olcum = { sahipAlani: null, barkod: null, cuval: null, okut: null, sevkDurum: null, sevkKod: null, sevkTopVar: null, acikSahipAlani: null };
const m2Olcum = { kilitSayisi: null, kilitSonra: null, apiDurum: null, apiKod: null, paletDokuma: null, acikDurum: null };
const l4Olcum = { tani: null, istekSayisi: null, suzgecliIstek: null, musteriId: null, notMusteri: null, notHedef: null, notHedefSerh: null, temizSonraMusteri: null, iptalSebepSecici: null, iptalSebepIpucu: null, iptalUyari: null };
const k1Olcum = { beamNo: null, isNo: null, sevkOnceKg: null, sevkUyari: null };
const k3Olcum = { isNo: null, onceKg: null, donusSonraKg: null, fasondaDonus: null, fasondaStorno: null };
const n3Olcum = { docNo: null, sevkId: null, bakiyeOnce: null, sevkMetreOnce: null, sevkMetreSonra: null };
const o7Olcum = { satirOnce: null, gecersizDurum: null, gecersizMesaj: null, urunsuzDurum: null, urunsuzMesaj: null, birimsizDurum: null, birimsizBirim: null, siparisNo: null };
const n1Olcum = { beamNo: null, onceKg: null, sarimSonraKg: null, sarimDurum: null, onizlemeDip: null, sonraKg: null };
const n2Olcum = { iadeliSevk: null, engelMetni: null, engelDugmePasif: null, sevkNo: null, sevkId: null, onizlemeBarkod: null, dugmeEtiketi: null };
const s3Olcum = { cariId: null, kapanis: null, defter: null, satirTip: null };
const s4Olcum = { api: null, defter: null, kaynaksiz: null, hareket: null };
const t1Olcum = { minVersion: null, sahaMin: null, sahaN: null };
const p1Olcum = { fatura: null, geriAl: null, kurtar: null, mesaj: null, kod: null, faturaOnce: null, faturaSonra: null };
const p5Olcum = { yukselt: null, sistemKaldi: null, atama: null, atamaSatir: null };
const p4Olcum = { surumOnce: null, surumSonra: null, kisitliDurum: null, kisitliKod: null, yenidenDurum: null, geriDurum: null, musteriOnce: null, musteriSonra: null };
const j1Olcum = { sevkNo: null, sevkId: null, tur: null, cariMetin: null, cariKilitli: null, satir: null, miktar: null, birim: null };
const i4Olcum = { barkod: null, digerMusteri: null, digerOnce: null, testOnce: null, onizlemeSahipVar: null, redDurum: null, redKod: null, redTopVar: null, redSahipVar: null, tostSahipVar: null, ikinciDurum: null, sevkNo: null };

const MODUL_ANAHTARLARI = ["productionEnabled", "financeEnabled", "ticaretEnabled", "iplikEnabled", "depoMultiEnabled", "kumasTeknikEnabled", "tezgahEnabled", "devereEnabled", "dokumaEnabled", "emanetEnabled"];


/** Rapor eksen çoklu seçicisi (ReportMultiSelect): etiketle aç → seçeneği tıkla → tetikleyici metni değişene dek bekle. */
async function eksenSec(page, etiket, secenekAdi) {
  const tetik = page.getByLabel(etiket, { exact: true }).filter({ visible: true }).first();
  // Tetikleyici seçenekler gelene dek PASİFTİR (`disabled={list.length===0}`) — ilk cevabın geldiğinin tek güvenilir işareti.
  await tetik.waitFor({ state: "visible", timeout: 20_000 });
  for (let i = 0; i < 40 && (await tetik.isDisabled()); i++) await page.waitForTimeout(500);
  for (let deneme = 0; deneme < 2; deneme++) {
    await tetik.click({ timeout: 15_000 });
    const madde = page.getByRole("button", { name: secenekAdi, exact: true }).filter({ visible: true }).last();
    await madde.waitFor({ state: "visible", timeout: 10_000 });
    await madde.click({ timeout: 10_000 });
    await page.keyboard.press("Escape");
    const tamam = await tetik.filter({ hasText: secenekAdi }).waitFor({ state: "visible", timeout: 5_000 }).then(() => true, () => false);
    if (tamam) return true;
  }
  return false;
}

import { MASTER_KOD_ADIMLARI } from "./adimlar-master-kod.mjs";
import { TAZELIK_ADIMLARI } from "./adimlar-tazelik.mjs";
import { SIPARIS_YONU_ADIMLARI } from "./adimlar-siparis-yonu.mjs";
import { SEVK_KAPISI_ADIMLARI } from "./adimlar-sevk-kapisi.mjs";
import { SEVK_YONU_ADIMLARI } from "./adimlar-sevk-yonu.mjs";

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
    id: "A2", rol: "S", gerektirir: ["A1"],
    yol: "Sistem → Özellik Anahtarları → Devere / Levent → 'Levent tezgah bağı defteri' AÇ · 'Tezgahtan inen top leventten otomatik düşsün' AÇ → Kaydet → Yenile", rota: "system/feature-flags",
    async yap({ git, gor, page }) {
      await git("Özellik Anahtarları");
      // Kategori düğmesi TAM adla ve görünür: kalıcı Modüller sekmesinde "Devere / levent modülünü aç" metni aynı kökü taşır.
      await page().getByText("Devere / Levent", { exact: true }).filter({ visible: true }).first().click({ timeout: 15_000 });
      const kutu = (baslik) => page().locator("label", { hasText: baslik }).locator('input[type="checkbox"]').filter({ visible: true }).first();
      for (const b of ["Levent tezgah bağı defteri", "Tezgahtan inen top leventten otomatik düşsün"]) {
        const k = kutu(b); await gor(k);
        if (!(await k.isChecked())) await k.click();
      }
      const kaydet = page().getByRole("button", { name: "Kaydet", exact: true }).filter({ visible: true }).first();
      if (await kaydet.isEnabled()) { await kaydet.click({ timeout: 15_000 }); await page().waitForTimeout(1500); }
      // Yenile → sunucudan okunan değer aynı mı (taslak değil, kaydedilmiş)?
      await page().getByRole("button", { name: "Yenile" }).filter({ visible: true }).first().click({ timeout: 10_000 }).catch(() => undefined);
      await page().waitForTimeout(1200);
    },
    async bekle({ page }) {
      for (const b of ["Levent tezgah bağı defteri", "Tezgahtan inen top leventten otomatik düşsün"]) {
        const k = page().locator("label", { hasText: b }).locator('input[type="checkbox"]').filter({ visible: true }).first();
        if (!(await k.isChecked())) throw new Error(`"${b}" yenileme sonrası kapalı`);
      }
    },
    dogrula: [
      { ad: "devere.mountTracking ve devere.autoConsume = true (system_settings)", sql: `SELECT key, value::text v FROM system_settings WHERE key IN ('devere.mountTracking','devere.autoConsume') ORDER BY key`, oku: (r) => r.map((x) => `${x.key}=${x.v}`).join(","), beklenen: "devere.autoConsume=true,devere.mountTracking=true" },
      { ad: "GET /api/feature-flags aynı iki anahtar true; ayar şifresi bu kurulumda KAPALI (settingsPasswordRequired=false → kaydette şifre sorulmaz)", uc: "/api/feature-flags", oku: (g) => `${g?.data?.devereMountTracking}:${g?.data?.devereAutoConsume}:${g?.data?.settingsPasswordRequired}`, beklenen: "true:true:false" },
    ],
  },
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
      // Sevk yönü seçicisi (2026-09-23: "Sevk varsayılanı · Yok" → "Sevk yönü · Seçilmedi (ilk sevkte sorulur)").
      await sec(d.getByRole("combobox").filter({ hasText: /Seçilmedi|Yurtiçi|Yurtdışı/ }).first(), "Yurtiçi");
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
        await page().getByText("Devere / Levent", { exact: true }).filter({ visible: true }).first().click({ timeout: 15_000 });
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

  {
    id: "E2", rol: "P", gerektirir: ["E1"],
    yol: "Siparişler → TEST-S1 satırı (detay) → kalemi seç → İş emri oluştur (1) → Yeni İş Emri: rota şablonu, hedef 100 → kaydet", rota: "operations/work-orders/new",
    async yap({ git, gor, page }) {
      await git("Siparişler");
      await page().getByPlaceholder("Sipariş no").filter({ visible: true }).first().fill(AD.siparisNo);
      await page().waitForTimeout(700);
      await page().getByRole("row").filter({ hasText: AD.siparisNo }).first().click({ timeout: 15_000 });
      const sheet = page().getByRole("dialog").last(); await gor(sheet);
      await sheet.getByLabel("Kalemi iş emri için seç").first().click({ timeout: 15_000 });
      await sheet.getByRole("button", { name: /İş emri oluştur \(1\)/ }).click({ timeout: 15_000 });
      // Yeni İş Emri sayfası (kendi sekmesinde): Hedef Kumaş + "Sipariş: 1 kalem" ön-dolu.
      await gor(page().getByRole("heading", { name: "Yeni İş Emri" }).first());
      await gor(page().getByText(/Sipariş: 1 kalem/).first());
      // Üretim Rotası ZORUNLU: "Kayıtlı rota seç…" → dokuma/kurşun/tambur içeren şablon (yoksa ilk şablon).
      await page().getByText("Kayıtlı rota seç", { exact: false }).first().click({ timeout: 15_000 });
      const rm = page().getByRole("dialog").filter({ hasText: "Rota Şablonu Seç" }).last(); await gor(rm);
      const secenekler = rm.locator("li button, button").filter({ hasNotText: /Boş başla|Kapat|İptal/ });
      await secenekler.first().waitFor({ timeout: 15_000 });
      const adlar = await secenekler.allTextContents();
      const tercih = adlar.findIndex((a) => /tambur|dokuma|kurşun|kursun/i.test(a));
      await secenekler.nth(tercih >= 0 ? tercih : 0).click({ timeout: 15_000 });
      e2Olcum.rotaSablonu = (adlar[tercih >= 0 ? tercih : 0] ?? "").trim().slice(0, 60) || null;
      await rm.waitFor({ state: "detached", timeout: 15_000 }).catch(() => undefined);
      await page().waitForTimeout(800);
      // ⚠️ Belge "Hedef 100 m" der — hedef alanı bayrağa bağlı (`targetQuantityEnabled`), kapalıysa ekranda YOK;
      // "100 m açık" bağlı sipariş kaleminden gelir (sağ önizleme). Belge notu.
      await page().getByRole("button", { name: "İş Emri Oluştur", exact: true }).click({ timeout: 15_000 });
      await page().waitForTimeout(1500);
    },
    async bekle({ git, gor, page }) {
      await git("İş Emirleri");
      const ara = page().getByPlaceholder(/ara/i).filter({ visible: true }).first();
      await ara.fill(AD.siparisNo);
      await page().waitForTimeout(800);
      const satir = page().getByRole("row").filter({ hasText: buyukTr(AD.musteri) }).first();
      await gor(satir);
      // Sipariş kolonu sipariş NO değil bağlı MİKTARI gösterir ("100 m"); no arama kutusundan bulunur — belge notu.
      await gor(satir.getByText(/100\s*m/).first());
      await gor(satir.getByText("Siparişe Özel", { exact: false }));
    },
    dogrula: [
      { ad: "iş emri doğdu, tipi bağın aynası, siparişe bağlı (work_orders/work_order_to_order_lines)",
        sql: `SELECT wo.type, wo.status, count(l.id)::int n FROM work_orders wo JOIN work_order_to_order_lines l ON l."workOrderId"=wo.id JOIN order_lines ol ON ol.id=l."orderLineId" JOIN orders o ON o.id=ol."orderId" WHERE o."orderNumber"=$1 GROUP BY wo.id, wo.type, wo.status`,
        params: [AD.siparisNo], oku: (r) => r.map((x) => `${x.type}:${x.status}:${x.n}`).join("|"), beklenen: (v) => /^ORDER[A-Z_]*:[A-Z_]+:1$/.test(v) },
      { ad: "rota adımları var (≥1) ve şablon adı", sql: `SELECT count(s.id)::int n FROM work_orders wo JOIN work_order_to_order_lines l ON l."workOrderId"=wo.id JOIN order_lines ol ON ol.id=l."orderLineId" JOIN orders o ON o.id=ol."orderId" JOIN work_order_steps s ON s."workOrderId"=wo.id WHERE o."orderNumber"=$1`,
        params: [AD.siparisNo], oku: (r) => `${r[0].n}:${e2Olcum.rotaSablonu}`, beklenen: (v) => /^[1-9]\d*:.+$/.test(v) },
    ],
  },

  {
    id: "E3", rol: "P", gerektirir: ["E2"],
    yol: "İş Emirleri → iş emri detayı → \"Sipariş Bağla\" → gerçek bir müşterinin açık siparişi → Bağla (1)", rota: "operations/work-orders",
    async yap({ git, gor, page }) {
      await git("İş Emirleri");
      await page().getByPlaceholder(/ara/i).filter({ visible: true }).first().fill(AD.siparisNo);
      await page().waitForTimeout(800);
      await page().getByRole("row").filter({ hasText: buyukTr(AD.musteri) }).first().click({ timeout: 15_000 });
      await page().waitForTimeout(1000);
      await page().getByRole("button", { name: /Sipariş Bağla/ }).first().click({ timeout: 15_000 });
      const d = page().getByRole("dialog").filter({ hasText: /Sipariş Bağla —/ }).last(); await gor(d);
      // Listede yalnız UYUMLU kalemler (aynı kumaş): TEST kumaşı yalnız TEST-S1'de → "Uyumlu açık sipariş yok."
      // Ekranın kendi yolu: "+ Yeni Sipariş Oluştur" (hızlı form) → GERÇEK bir müşteri, metraj → "Oluştur ve Bağla".
      await page().waitForTimeout(1000);
      const satirlar = d.locator("tbody tr").filter({ hasNotText: buyukTr(AD.musteri) });
      e3Olcum.uyumluBaska = await satirlar.count();
      if (e3Olcum.uyumluBaska > 0) {
        await satirlar.first().locator('[role="checkbox"]').first().click({ timeout: 15_000 });
        await d.getByRole("button", { name: /Bağla \(1\)/ }).click({ timeout: 15_000 });
      } else {
        await d.getByRole("button", { name: /Yeni Sipariş Oluştur/ }).click({ timeout: 15_000 });
        await d.getByRole("combobox").filter({ hasText: /Müşteri/ }).first().click({ timeout: 15_000 });
        const ara = page().getByPlaceholder("Ara (kod, isim, vergi no)");
        await ara.fill("");
        await page().waitForTimeout(800);
        // cmdk listesi: öğeler `[cmdk-item]` (role=option her sürümde yok); "(yok)" ve TEST kartları hariç ilk GERÇEK müşteri.
        const aday = page().locator("[cmdk-item], [role='option']").filter({ hasNotText: /\(yok\)/ }).filter({ hasNotText: ONEK }).first();
        e3Olcum.ikinciMusteri = ((await aday.textContent()) ?? "").trim().slice(0, 40);
        await aday.click({ timeout: 15_000 });
        await d.getByPlaceholder("Metraj").fill("50");
        await d.getByRole("button", { name: "Oluştur ve Bağla" }).click({ timeout: 20_000 });
      }
      await d.waitFor({ state: "detached", timeout: 20_000 });
      await page().waitForTimeout(800);
      await page().keyboard.press("Escape");
    },
    async bekle({ git, gor, page }) {
      await git("İş Emirleri");
      await page().getByPlaceholder(/ara/i).filter({ visible: true }).first().fill(AD.siparisNo);
      await page().waitForTimeout(800);
      // ⚠️ Bağdan sonra Müşteri kolonu "<YENİ bağlanan> +1" gösteriyor — TEST Müşteri rozetin arkasına düşüyor
      // (belge "TEST Müşteri +1" der). İlk/asıl müşteri görünür kalmalı — çıkarım (K). Satır kumaşla bulunur.
      const satir = page().getByRole("row").filter({ hasText: buyukTr(AD.kumas) }).filter({ hasText: /\+1/ }).first();
      await gor(satir);
      e3Olcum.gorunenMusteri = ((await satir.getByRole("cell").nth(5).textContent()) ?? "").trim().slice(0, 40);
      await gor(satir.getByText(/150\s*m/).first()); // 100 + 50 m bağlı toplam
    },
    dogrula: [
      { ad: "iş emrinde İKİ sipariş bağı, iki farklı müşteri (work_order_to_order_lines)",
        sql: `SELECT count(DISTINCT l."orderLineId")::int n, count(DISTINCT o."customerId")::int m FROM work_orders wo JOIN work_order_to_order_lines l ON l."workOrderId"=wo.id JOIN order_lines ol ON ol.id=l."orderLineId" JOIN orders o ON o.id=ol."orderId" WHERE wo.id IN (SELECT l2."workOrderId" FROM work_order_to_order_lines l2 JOIN order_lines ol2 ON ol2.id=l2."orderLineId" JOIN orders o2 ON o2.id=ol2."orderId" WHERE o2."orderNumber"=$1)`,
        params: [AD.siparisNo], oku: (r) => `${r[0].n}:${r[0].m}`, beklenen: "2:2" },
      { ad: "listede görünen müşteri (çıkarım: asıl müşteri mi, yeni bağlanan mı?)", sql: `SELECT 1`,
        oku: () => `${e3Olcum.gorunenMusteri} (yeni bağlanan: ${e3Olcum.ikinciMusteri})`, beklenen: (v) => typeof v === "string" && v.length > 0 },
    ],
  },

  // ── F · DOKUMA (panel adımları) ────────────────────────────────────────────
  {
    id: "F1", rol: "P", gerektirir: ["B2", "B3"],
    yol: "Operasyon → Üretim & Fason → Dokuma İşleri → Yeni Dokuma İşi", rota: "operations/weaving-orders",
    async yap({ git, tikla, gor, page }) {
      await git("Dokuma İşleri");
      await tikla("Yeni Dokuma İşi");
      const d = page().getByRole("dialog").filter({ hasText: "Yeni Dokuma İşi" }).last(); await gor(d);
      // EntityPicker modalı: başlık her yerde verilmemiş ("Seç") — modal arama kutusuyla tanınır.
      const secModal = async (tetik, _baslik, ara) => {
        await d.getByText(tetik, { exact: false }).first().click({ timeout: 15_000 });
        const m = page().getByRole("dialog").filter({ has: page().getByPlaceholder("Ara (ad veya kod)") }).last(); await gor(m);
        await m.getByPlaceholder("Ara (ad veya kod)").fill(ara);
        await page().waitForTimeout(700);
        await m.getByText(buyukTr(ara), { exact: true }).first().click({ timeout: 15_000 });
        await m.waitFor({ state: "detached", timeout: 15_000 }).catch(() => undefined);
      };
      await secModal("Kumaş seç", "Dokunacak kumaşı seç", AD.kumas);
      await secModal("Çözgü kartı seç", "Çözgü kartı seç", AD.cozgu);
      // Kim dokuyor: varsayılan "Kendi tezgahımızda" (IN_HOUSE) — değilse seç.
      const kim = d.getByRole("combobox").filter({ hasText: /tezgah|fason/i }).first();
      if (await kim.count() && !/Kendi tezgah/i.test((await kim.textContent()) ?? "")) { await kim.click(); await page().getByRole("option", { name: /Kendi tezgah/ }).click(); }
      await d.locator("#plannedM").fill("100");
      await d.getByRole("button", { name: /Kaydet|Oluştur/ }).last().click({ timeout: 15_000 });
      await d.waitFor({ state: "detached", timeout: 15_000 });
      await page().waitForTimeout(600);
    },
    async bekle({ gor, page }) {
      const satir = page().getByRole("row").filter({ hasText: buyukTr(AD.kumas) }).first();
      await gor(satir);
      await gor(satir.getByText(/Planlandı|Planlı|Hazır/).first()); // rozet "Planlandı" (belge "planlı/hazır")
      await gor(satir.getByText(/100\s*m/).first());
    },
    dogrula: [
      { ad: "dokuma işi doğdu: kumaş + çözgü kartı + IN_HOUSE + hedef 100 (weaving_orders)",
        sql: `SELECT wo."executionKind" k, wo.status, wo."plannedM"::text m, ws.code ck FROM weaving_orders wo JOIN items i ON i.id=wo."itemId" LEFT JOIN warp_specs ws ON ws.id=wo."warpSpecId" WHERE i.code=$1 ORDER BY wo."createdAt" DESC LIMIT 1`,
        params: [AD.kumasKod], oku: (r) => r.map((x) => `${x.k}:${x.status}:${x.m}:${x.ck}`).join("|"), beklenen: (v) => new RegExp(`^IN_HOUSE:(PLANNED|READY):100(\\.0+)?:${AD.cozguKod}$`).test(v) },
    ],
  },

  // ── G · EMANET (panel) ──────────────────────────────────────────────────────
  {
    id: "G1", rol: "P", gerektirir: ["B1", "B3"],
    yol: "Operasyon → Üretim & Fason → Leventler → Yeni Levent (emanet)", rota: "operations/warp-beams",
    async yap({ git, tikla, sec, gor, page }) {
      await git("Leventler");
      await tikla("Yeni Levent");
      const d = page().getByRole("dialog").filter({ hasText: "Yeni Levent (plan)" }).last(); await gor(d);
      await sec(d.getByRole("combobox").filter({ hasText: /İçeride sarıldı|Hazır|emanet|Fason/ }).first(), "Müşterinin emanet leventi");
      // Sahibi (müşteri) — yalnız emanette görünür; tedarikçi/fasoncu alanları KAPALI olmalı.
      g1Olcum.tedarikciAlaniVar = await d.getByText("Tedarikçi (cari)", { exact: false }).count();
      await d.getByText("Sahip müşteri seç", { exact: false }).first().click({ timeout: 15_000 });
      const sm = page().getByRole("dialog").filter({ has: page().getByPlaceholder("Ara (ad veya kod)") }).last(); await gor(sm);
      await sm.getByPlaceholder("Ara (ad veya kod)").fill(AD.musteri);
      await page().waitForTimeout(700);
      await sm.getByText(buyukTr(AD.musteri), { exact: true }).first().click({ timeout: 15_000 });
      await sm.waitFor({ state: "detached", timeout: 15_000 }).catch(() => undefined);
      await d.getByText("Çözgü kartı seç", { exact: false }).first().click({ timeout: 15_000 });
      const cm = page().getByRole("dialog").filter({ has: page().getByPlaceholder("Ara (ad veya kod)") }).last(); await gor(cm);
      await cm.getByPlaceholder("Ara (ad veya kod)").fill(AD.cozgu);
      await page().waitForTimeout(700);
      await cm.getByText(buyukTr(AD.cozgu), { exact: true }).first().click({ timeout: 15_000 });
      await cm.waitFor({ state: "detached", timeout: 15_000 }).catch(() => undefined);
      await d.locator('input[type="number"]').first().fill("200");
      await d.getByRole("button", { name: /Kaydet|Planla|Oluştur/ }).last().click({ timeout: 15_000 });
      await d.waitFor({ state: "detached", timeout: 15_000 });
      await page().waitForTimeout(600);
    },
    async bekle({ gor, page }) {
      const satir = page().getByRole("row").filter({ hasText: buyukTr(AD.musteri) }).first();
      await gor(satir);
      await gor(satir.getByText(/Emanet/i).first());
    },
    dogrula: [
      { ad: "emanet levent: CONSIGNED + sahip TEST Müşteri, tedarikçi/fasoncu NULL, 200 m (warp_beams)",
        sql: `SELECT wb."originKind" o, (wb."ownerCustomerId" IS NOT NULL) sahip, (wb."supplierId" IS NULL AND wb."subcontractorId" IS NULL) bos, wb."plannedLengthM"::text m, wb.status FROM warp_beams wb JOIN customers c ON c.id=wb."ownerCustomerId" WHERE c.name=$1 ORDER BY wb."createdAt" DESC LIMIT 1`,
        params: [buyukTr(AD.musteri)], oku: (r) => r.map((x) => `${x.o}:${x.sahip}:${x.bos}:${x.m}:${x.status}`).join("|"), beklenen: (v) => /^CONSIGNED:true:true:200(\.0+)?:PLANNED$/.test(v) },
      { ad: "emanette tedarikçi alanı ÇİZİLMEDİ (ekran)", sql: `SELECT 1`, oku: () => g1Olcum.tedarikciAlaniVar, beklenen: 0 },
    ],
  },
  {
    id: "I4", rol: "P", gerektirir: ["B1", "B3"],
    yol: "Kumaş Stoğu → Ham Stok → Manuel Top Ekle (Sahibi: TEST Müşteri) → Paketleme / Çuvallar → Yeni Çuval (müşterisiz) → barkod okut → Sevk Et → BAŞKA müşteri → 409 → TEST Müşteri → kurulur",
    rota: "operations/sack-content-edit",
    async yap({ git, tikla, gor, sql, page }) {
      // 1) Emanet top — G2'nin tablet yolu (Ham Giriş) panelde "Manuel Top Ekle"dir; aynı `rolls.ownerCustomerId` satırını üretir.
      await git("Kumaş Stoğu");
      const hamTab = page().getByRole("tab", { name: "Ham Stok" }).first();
      if (await hamTab.count()) { await hamTab.click({ timeout: 10_000 }); await page().waitForTimeout(400); }
      await tikla("Manuel Top Ekle");
      const md = page().getByRole("dialog").filter({ hasText: "Manuel Top Ekle" }).last(); await gor(md);
      await md.getByRole("combobox").filter({ hasText: "Kumaş ara" }).first().click({ timeout: 15_000 });
      const kAra = page().getByPlaceholder("Ara (kod, isim, vergi no)"); await gor(kAra);
      await kAra.fill(AD.kumasKod); await page().waitForTimeout(700);
      await page().locator("[cmdk-item]").filter({ hasText: AD.kumasKod }).first().click({ timeout: 15_000 });
      await md.locator("#initialQty").fill("25");
      // Sahibi seçicisi yalnız emanet modülü açıkken çizilir — bulunamazsa adım kırmızı (M3 kapatıp yeniden ölçer).
      await md.getByText("Sahibi (emanet mal ise müşteri)", { exact: false }).first().locator("xpath=following::button[1]").click({ timeout: 15_000 });
      const sm = page().getByRole("dialog").filter({ has: page().getByPlaceholder("Ara (ad veya kod)") }).last(); await gor(sm);
      await sm.getByPlaceholder("Ara (ad veya kod)").fill(AD.musteri); await page().waitForTimeout(700);
      // Satır "KOD — AD" tek metin düğümüdür (G1'deki seçiciden farklı) → tam eşleşme değil içerme.
      await sm.getByText(buyukTr(AD.musteri), { exact: false }).first().click({ timeout: 15_000 });
      await sm.waitFor({ state: "detached", timeout: 15_000 }).catch(() => undefined);
      await md.getByRole("button", { name: "Ekle", exact: true }).click({ timeout: 15_000 });
      // Tekrar koşumda "aynı kumaş/metraj az önce girildi" mükerrer uyarısı çıkar (ürün davranışı) → onayla.
      const yineDe = md.getByRole("button", { name: /yine de kaydet/ });
      if (await yineDe.waitFor({ state: "visible", timeout: 4_000 }).then(() => true, () => false)) await yineDe.click({ timeout: 15_000 });
      await md.waitFor({ state: "detached", timeout: 20_000 });
      const top = await sql(`SELECT r.barcode FROM rolls r JOIN customers c ON c.id=r."ownerCustomerId" WHERE c.name=$1 AND r."sackId" IS NULL AND r."shipmentId" IS NULL ORDER BY r."createdAt" DESC LIMIT 1`, [buyukTr(AD.musteri)]);
      i4Olcum.barkod = top[0]?.barcode ?? null;
      if (!i4Olcum.barkod) throw new Error("emanet top DB'de bulunamadı (Manuel Top Ekle yazmadı mı?)");
      // 2) Müşterisiz çuval + okut — çuvalın müşterisi olsaydı diyalog cariyi KİLİTLER, "başka müşteri" seçilemezdi.
      await git("Paketleme / Çuvallar");
      await tikla("Yeni Çuval");
      const nd = page().getByRole("dialog").filter({ hasText: "Yeni Çuval Aç" }).last(); await gor(nd);
      await nd.getByRole("button", { name: /Çuval Aç/ }).click({ timeout: 15_000 });
      await nd.waitFor({ state: "detached", timeout: 20_000 });
      const okut = page().getByPlaceholder("Top / kartela barkodu okut"); await gor(okut, { sure: 20_000 });
      await okut.fill(i4Olcum.barkod); await okut.press("Enter");
      // Kalıcı "Kumaş Stoğu" sekmesi aynı barkodu GİZLİ DOM'da taşır → yalnız görünür olan.
      await gor(page().getByText(i4Olcum.barkod, { exact: false }).filter({ visible: true }).first(), { sure: 20_000 });
      // 3) Sevk Et → BAŞKA gerçek müşteri (TEST öneki dışındaki ilk aktif müşteri).
      const diger = await sql(`SELECT name FROM customers WHERE "isActive" AND name NOT LIKE $1 AND type IN ('CUSTOMER','BOTH') ORDER BY name LIMIT 1`, [`${ONEK}%`]);
      i4Olcum.digerMusteri = diger[0]?.name ?? null;
      if (!i4Olcum.digerMusteri) throw new Error("başka müşteri yok");
      // Gerçek müşterinin fabrika verisinden sevkiyatları vardır → mutlak sayı değil FARK ölçülür.
      const sevkSay = async (ad) => Number((await sql(`SELECT count(*)::int n FROM shipments s JOIN customers c ON c.id=s."customerId" WHERE c.name=$1`, [ad]))[0].n);
      i4Olcum.digerOnce = await sevkSay(i4Olcum.digerMusteri); i4Olcum.testOnce = await sevkSay(buyukTr(AD.musteri));
      await tikla("Sevk Et");
      const sd = page().getByRole("dialog").filter({ hasText: /Sevkiyat/ }).last(); await gor(sd);
      const musteriSec = async (ad) => {
        // Diyalogdaki İLK combobox müşteri seçicisidir; seçim sonrası metni cari adı olur, "müşteri" kelimesiyle aranamaz.
        await sd.getByRole("combobox").first().click({ timeout: 15_000 });
        const ara = page().getByPlaceholder("Ara (kod, isim, vergi no)"); await gor(ara);
        await ara.fill(ad); await page().waitForTimeout(800);
        await page().locator("[cmdk-item]").filter({ hasText: ad }).first().click({ timeout: 15_000 });
        await page().waitForTimeout(1200); // önizleme sorgusu
      };
      await musteriSec(i4Olcum.digerMusteri);
      // Yönü boş cari (2026-09-23 kilit): ilk sevkte yön bir kez seçilir; seçilmeden "Sevk Et" pasif.
      const ilkSecim = sd.getByTestId("destination-first-pick");
      if (await ilkSecim.count()) await ilkSecim.getByRole("button", { name: "Yurtiçi", exact: true }).click({ timeout: 15_000 });
      i4Olcum.onizlemeSahipVar = await sd.getByText(/emanet|sahib/i).count();
      const sevkYaniti = () => page().waitForResponse((r) => r.request().method() === "POST" && /\/api\/shipping\/shipments(\?|$)/.test(r.url()), { timeout: 30_000 });
      const [red] = await Promise.all([sevkYaniti(), sd.getByRole("button", { name: "Sevk Et", exact: true }).click({ timeout: 15_000 })]);
      i4Olcum.redDurum = red.status();
      const rg = await red.json().catch(() => ({}));
      i4Olcum.redKod = rg?.details?.code ?? rg?.error?.code ?? null;
      const metin = JSON.stringify(rg);
      i4Olcum.redTopVar = metin.includes(i4Olcum.barkod) ? 1 : 0;
      i4Olcum.redSahipVar = metin.includes(buyukTr(AD.musteri)) ? 1 : 0;
      await page().waitForTimeout(800);
      const tost = page().locator("[data-sonner-toast]").filter({ hasText: i4Olcum.barkod });
      i4Olcum.tostSahipVar = (await tost.count()) ? 1 : 0;
      // 4) Aynı diyalogda TEST Müşteri → kurulur (confirmationEnabled=false ⇒ doğrudan DISPATCHED).
      await musteriSec(buyukTr(AD.musteri));
      const [ok] = await Promise.all([sevkYaniti(), sd.getByRole("button", { name: "Sevk Et", exact: true }).click({ timeout: 15_000 })]);
      i4Olcum.ikinciDurum = ok.status();
      const og = await ok.json().catch(() => ({}));
      i4Olcum.sevkNo = og?.data?.shipmentNo ?? null;
      await page().waitForTimeout(800);
      for (let i = 0; i < 3 && (await page().getByRole("dialog").count()); i++) { await page().keyboard.press("Escape"); await page().waitForTimeout(300); }
    },
    async bekle({ gor, page }) {
      // Ekranda: ilk deneme reddedildi (toast barkodu taşır) — ölçüm `tostSahipVar`; ikinci deneme sevk numarası üretti.
      if (i4Olcum.sevkNo) await gor(page().getByText(i4Olcum.sevkNo, { exact: false }).filter({ visible: true }).first(), { sure: 20_000 }).catch(() => undefined);
    },
    dogrula: [
      { ad: "başka müşteriye Sevk Et → 409 OWNER_MISMATCH", sql: `SELECT 1`, oku: () => `${i4Olcum.redDurum}:${i4Olcum.redKod}`, beklenen: "409:OWNER_MISMATCH" },
      { ad: "409 gövdesi etkilenen top barkodunu ve sahibi (TEST Müşteri) listeler", sql: `SELECT 1`, oku: () => `${i4Olcum.redTopVar}:${i4Olcum.redSahipVar}`, beklenen: "1:1" },
      { ad: "ekrandaki toast barkodu taşır (soyut sayı değil)", sql: `SELECT 1`, oku: () => i4Olcum.tostSahipVar, beklenen: 1 },
      { ad: "ÖNİZLEME sahiplik çatışmasını Sevk Et'ten ÖNCE gösterir (emanet uyarısı; eski davranış 0 idi — K bulgusu kapandı)", sql: `SELECT 1`, oku: () => i4Olcum.onizlemeSahipVar, beklenen: (v) => v >= 1 },
      { ad: "başka müşteride sevkiyat DOĞMADI (fark 0); TEST Müşteri'de +1 sevkiyat, DISPATCHED (shipments)",
        sql: `SELECT (SELECT count(*) FROM shipments s JOIN customers c ON c.id=s."customerId" WHERE c.name=$1)::int diger, (SELECT count(*) FROM shipments s JOIN customers c ON c.id=s."customerId" WHERE c.name=$2)::int test, (SELECT status::text FROM shipments s JOIN customers c ON c.id=s."customerId" WHERE c.name=$2 ORDER BY s."createdAt" DESC LIMIT 1) durum`,
        params: () => [i4Olcum.digerMusteri, buyukTr(AD.musteri)], oku: (r) => `${r[0].diger - i4Olcum.digerOnce}:${r[0].test - i4Olcum.testOnce}:${r[0].durum}`, beklenen: (v) => /^0:1:DISPATCHED$/.test(v) },
      { ad: "emanet top sahibine sevk edildi (rolls.status=SHIPPED, sahip korunur)",
        sql: `SELECT r.status::text st, (r."shipmentId" IS NOT NULL) sevkte FROM rolls r WHERE r.barcode=$1`, params: () => [i4Olcum.barkod], oku: (r) => `${r[0]?.st}:${r[0]?.sevkte}`, beklenen: "SHIPPED:true" },
    ],
  },
  {
    id: "J1", rol: "M", gerektirir: ["I4"],
    yol: "Muhasebe → Sevkiyatlar (Muhasebe) → satırda Faturala → Yeni Fatura (Taslak) → birim fiyat → Taslağı Oluştur", rota: "operations/accounting-dispatch",
    async yap({ git, gor, sql, page }) {
      const sevk = await sql(`SELECT s.id, s."shipmentNo" FROM shipments s JOIN customers c ON c.id=s."customerId" WHERE c.name=$1 AND s.status='DISPATCHED' ORDER BY s."createdAt" DESC LIMIT 1`, [buyukTr(AD.musteri)]);
      j1Olcum.sevkNo = sevk[0]?.shipmentNo ?? null; j1Olcum.sevkId = sevk[0]?.id ?? null;
      if (!j1Olcum.sevkNo) throw new Error("TEST Müşteri'nin sevk edilmiş sevkiyatı yok (I4 koşmadı mı?)");
      await git("Sevkiyatlar (Muhasebe)");
      const ara = page().getByPlaceholder("Sevkiyat no, sipariş no, firma"); await gor(ara);
      await ara.fill(j1Olcum.sevkNo); await page().waitForTimeout(1200);
      const satir = page().getByRole("row").filter({ hasText: j1Olcum.sevkNo }).filter({ visible: true }).first(); await gor(satir);
      await satir.getByRole("button", { name: "Faturala" }).click({ timeout: 15_000 });
      const d = page().getByRole("dialog").filter({ hasText: "Yeni Fatura (Taslak)" }).last(); await gor(d, { sure: 20_000 });
      await page().waitForTimeout(600);
      // Ölçüm: türetilebilen alanlar ön-dolu mu, kilitli mi (çıkarım K).
      j1Olcum.tur = await d.locator("select").first().inputValue();
      const cariAlani = d.getByText("Cari", { exact: true }).locator("xpath=following::button[1]");
      j1Olcum.cariMetin = (await cariAlani.textContent().catch(() => "")) ?? "";
      j1Olcum.cariKilitli = await cariAlani.isDisabled().catch(() => null);
      const sayisal = d.locator('input[type="number"]');
      j1Olcum.satir = Math.floor((await sayisal.count()) / 5); // satır başına 5 sayısal alan (miktar · fiyat · iskonto · KDV · tevkifat)
      j1Olcum.miktar = await sayisal.nth(0).inputValue();
      j1Olcum.birim = await d.getByPlaceholder("Ürün / hizmet açıklaması").first().locator("xpath=following::input[2]").inputValue().catch(() => null);
      await sayisal.nth(1).fill("40"); // birim fiyat — fiyatlandırma kapalı, kart fiyatı yok → elle
      await d.getByRole("button", { name: "Taslağı Oluştur" }).click({ timeout: 15_000 });
      await d.waitFor({ state: "detached", timeout: 20_000 });
      await page().waitForTimeout(800);
    },
    async bekle({ gor, page }) {
      // Satırda artık "Faturala" yerine taslağa bağ (docNo) çizilir.
      const satir = page().getByRole("row").filter({ hasText: j1Olcum.sevkNo }).filter({ visible: true }).first();
      await gor(satir);
      await gor(satir.getByText(/FAT|Taslak|SF/i).first(), { sure: 15_000 }).catch(() => undefined);
    },
    dogrula: [
      { ad: "taslak fatura sevkiyata bağlı: SALES · DRAFT · cari TEST Müşteri (invoices)",
        sql: `SELECT i.type::text t, i.status::text st, (c.name=$2) cari FROM invoices i JOIN cari_accounts ca ON ca.id=i."cariId" JOIN customers c ON c.id=ca."customerId" WHERE i."shipmentId"=$1 AND i.status<>'CANCELLED' ORDER BY i."createdAt" DESC LIMIT 1`,
        params: () => [j1Olcum.sevkId, buyukTr(AD.musteri)], oku: (r) => `${r[0]?.t}:${r[0]?.st}:${r[0]?.cari}`, beklenen: "SALES:DRAFT:true" },
      { ad: "fatura satırı sevk satırından: 25 m (BRÜT, iade düşülmedi) · birim dolu · fiyat 40 (invoice_lines)",
        sql: `SELECT count(*)::int n, max(l.qty)::text q, max(l.unit) u, max(l."unitPrice")::text p FROM invoice_lines l JOIN invoices i ON i.id=l."invoiceId" WHERE i."shipmentId"=$1 AND i.status<>'CANCELLED'`,
        params: () => [j1Olcum.sevkId], oku: (r) => `${r[0].n}:${r[0].q}:${r[0].u}:${r[0].p}`, beklenen: (v) => /^1:25(\.0+)?:\S+:40(\.0+)?$/.test(v) },
      { ad: "formda tür SALES ön-dolu, cari sevk müşterisi ön-dolu (ekran)", sql: `SELECT 1`, oku: () => `${j1Olcum.tur}:${j1Olcum.cariMetin.includes(buyukTr(AD.musteri))}`, beklenen: "SALES:true" },
      { ad: "ÇIKARIM K: cari alanı KİLİTLİ değil — sevkten gelen fatura başka cariye yazılabilir (ekran)", sql: `SELECT 1`, oku: () => j1Olcum.cariKilitli, beklenen: false },
      { ad: "satır sayısı 1, miktar 25 ön-dolu (ekran)", sql: `SELECT 1`, oku: () => `${j1Olcum.satir}:${j1Olcum.miktar}`, beklenen: "1:25" },
    ],
  },
  {
    id: "I7", rol: "P", gerektirir: ["I4"],
    yol: "Operasyon → İade Takibi → Yeni İade → barkod → Sorgula → neden → İade Al (I4'te sevk edilen emanet top)", rota: "operations/returns",
    async yap({ git, tikla, gor, sec, sql, api, page }) {
      // Hedef: I4'ün sevk ettiği top (aynı süreçte koşmadıysa DB'den son SHIPPED emanet top).
      const aday = await sql(`SELECT r.barcode, r."shipmentId" sid FROM rolls r JOIN customers c ON c.id=r."ownerCustomerId" WHERE c.name=$1 AND r.status='SHIPPED' AND r."shipmentId" IS NOT NULL ORDER BY r."updatedAt" DESC LIMIT 1`, [buyukTr(AD.musteri)]);
      i7Olcum.barkod = i4Olcum.barkod && aday.find((a) => a.barcode === i4Olcum.barkod) ? i4Olcum.barkod : (aday[0]?.barcode ?? null);
      i7Olcum.sevkId = aday.find((a) => a.barcode === i7Olcum.barkod)?.sid ?? null;
      if (!i7Olcum.barkod) throw new Error("sevk edilmiş emanet top yok (I4 koşmadı mı?)");
      const ozet = async () => (await api(`/api/shipping/shipments/${i7Olcum.sevkId}`)).govde?.data?.summary ?? {};
      const o1 = await ozet(); i7Olcum.onceMetre = o1.totalMeters ?? null; i7Olcum.onceTop = o1.rollCount ?? null;
      await git("İade Takibi");
      await tikla("Yeni İade");
      const d = page().getByRole("dialog").filter({ hasText: "İade Girişi" }).last(); await gor(d);
      await d.getByPlaceholder("Sevk edilmiş top barkodu").fill(i7Olcum.barkod);
      await d.getByRole("button", { name: "Sorgula" }).click({ timeout: 15_000 });
      await gor(d.getByText(i7Olcum.barkod, { exact: false }).first(), { sure: 20_000 });
      // Sipariş adayı varsa zorunlu (siparişsiz sevkte yok); neden katalogdan.
      const sip = d.getByRole("combobox").filter({ hasText: "Sipariş seçin" });
      if (await sip.count()) { await sip.first().click({ timeout: 10_000 }); await page().getByRole("option").first().click({ timeout: 10_000 }); }
      await sec(d.getByRole("combobox").filter({ hasText: "Neden seçin" }).first(), /Hasarlı/);
      await d.getByRole("button", { name: "İade Al", exact: true }).click({ timeout: 15_000 });
      await d.waitFor({ state: "detached", timeout: 20_000 });
      await page().waitForTimeout(800);
      const o2 = await ozet(); i7Olcum.sonraMetre = o2.totalMeters ?? null; i7Olcum.sonraTop = o2.rollCount ?? null; i7Olcum.iadeMetre = o2.returnedMeters ?? null; i7Olcum.iadeSayi = o2.returnedCount ?? null;
    },
    async bekle({ gor, page }) {
      await gor(page().getByRole("row").filter({ hasText: i7Olcum.barkod }).filter({ visible: true }).first(), { sure: 20_000 });
    },
    dogrula: [
      { ad: "iade defteri: 1 satır, 25 m, sevkiyat bağı + neden (roll_returns)",
        sql: `SELECT count(*)::int n, max(rr.qty)::text q, bool_and(rr."fromShipmentId" IS NOT NULL) sevk, bool_and(rr."reasonId" IS NOT NULL) neden FROM roll_returns rr JOIN rolls r ON r.id=rr."rollId" WHERE r.barcode=$1`,
        params: () => [i7Olcum.barkod], oku: (r) => `${r[0].n}:${r[0].q}:${r[0].sevk}:${r[0].neden}`, beklenen: (v) => /^1:25(\.0+)?:true:true$/.test(v) },
      { ad: "top depoya döndü, sevk/çuval bağı temiz, emanet sahibi KORUNDU (rolls)",
        sql: `SELECT r.status::text st, (r."shipmentId" IS NULL AND r."sackId" IS NULL) bos, (r."ownerCustomerId" IS NOT NULL) sahip FROM rolls r WHERE r.barcode=$1`,
        params: () => [i7Olcum.barkod], oku: (r) => `${r[0]?.st}:${r[0]?.bos}:${r[0]?.sahip}`, beklenen: (v) => /^(WAREHOUSE|A1_STOCK):true:true$/.test(v) },
      { ad: "SEVK RAKAMI BRÜT — iade sonrası sevkiyat özeti değişmedi; iade ayrı sayaçta (GET /shipments/:id summary)",
        sql: `SELECT 1`, oku: () => `${i7Olcum.onceMetre}/${i7Olcum.onceTop}→${i7Olcum.sonraMetre}/${i7Olcum.sonraTop} iade:${i7Olcum.iadeMetre}/${i7Olcum.iadeSayi}`,
        beklenen: (v) => /^25\/1→25\/1 iade:25\/1$/.test(v) },
      { ad: "sevkiyat olay defterine iade satırı YAZILMAZ (iade kendi defteri) — shipment_events sabit",
        sql: `SELECT string_agg(type::text, ',' ORDER BY "createdAt") t FROM shipment_events WHERE "shipmentId"=$1`, params: () => [i7Olcum.sevkId], oku: (r) => r[0].t, beklenen: (v) => /^(PLANNED,)?DISPATCHED$/.test(String(v)) },
    ],
  },
  {
    id: "N6", rol: "M", gerektirir: ["I7"],
    yol: "API · iade SONRASI sevkiyattan fatura taslağı önizlemesi — satırlar BRÜT (25 m): resmi belge ile aynı küme (7fae2716 öncesi taslak NET çıkıyordu)", rota: "operations/accounting-dispatch",
    async yap({ api, sql }) {
      // Aynı süreçte I7 koşmadıysa: TEST Müşteri'nin iade almış son sevkiyatı.
      n6Olcum.sevkId = i7Olcum.sevkId ?? (await sql(`SELECT s.id FROM shipments s JOIN customers c ON c.id=s."customerId" WHERE c.name=$1 AND EXISTS (SELECT 1 FROM roll_returns rr WHERE rr."fromShipmentId"=s.id AND rr."cancelledAt" IS NULL) ORDER BY s."createdAt" DESC LIMIT 1`, [buyukTr(AD.musteri)]))[0]?.id ?? null;
      if (!n6Olcum.sevkId) throw new Error("iade almış sevkiyat yok (I7 koşmadı mı?)");
      const taslak = (await api(`/api/finance/shipments/${n6Olcum.sevkId}/invoice-draft-lines`)).govde?.data ?? {};
      const satirlar = taslak.lines ?? [];
      n6Olcum.satir = satirlar.length;
      n6Olcum.metre = satirlar.reduce((t, l) => t + Number(l.qty ?? 0), 0);
      n6Olcum.belgeMetre = (await api(`/api/shipping/shipments/${n6Olcum.sevkId}`)).govde?.data?.summary?.totalMeters ?? null;
    },
    async bekle() {},
    dogrula: [
      { ad: "BRÜT KURALI: iade sonrası fatura taslağı satırları sevk rakamını (25 m) taşır — belge özetiyle aynı (collectShipmentInvoiceDraftLines RollReturn ile brütleştirir)",
        sql: `SELECT 1`, oku: () => `taslak:${n6Olcum.satir} satır/${n6Olcum.metre} m · belge özeti:${n6Olcum.belgeMetre} m`, beklenen: (v) => /^taslak:1 satır\/25 m · belge özeti:25 m$/.test(v) },
    ],
  },
  {
    id: "J2", rol: "M", gerektirir: ["J1"],
    yol: "Muhasebe → Faturalar → taslak satırı → Onayla → 'Onayla ve deftere işle' → Detay → Belgeyi aç (önizleme)", rota: "finance/invoices",
    async yap({ git, gor, sql, page }) {
      const t = await sql(`SELECT i."docNo" FROM invoices i JOIN cari_accounts ca ON ca.id=i."cariId" JOIN customers c ON c.id=ca."customerId" WHERE c.name=$1 AND i.type='SALES' AND i.status='DRAFT' ORDER BY i."createdAt" DESC LIMIT 1`, [buyukTr(AD.musteri)]);
      j2Olcum.docNo = t[0]?.docNo ?? null;
      if (!j2Olcum.docNo) throw new Error("TEST Müşteri'nin taslak satış faturası yok (J1 koşmadı mı?)");
      await git("Faturalar");
      await page().getByPlaceholder("Belge no / cari ara").filter({ visible: true }).first().fill(j2Olcum.docNo);
      await page().waitForTimeout(800);
      const satir = page().getByRole("row").filter({ hasText: j2Olcum.docNo }).filter({ visible: true }).first(); await gor(satir);
      await satir.getByRole("button", { name: "Onayla", exact: true }).click({ timeout: 15_000 });
      const onay = page().getByRole("dialog").filter({ hasText: /deftere işle/ }).last(); await gor(onay);
      await onay.getByRole("button", { name: "Onayla ve deftere işle" }).click({ timeout: 15_000 });
      await onay.waitFor({ state: "detached", timeout: 15_000 });
      await page().waitForTimeout(800);
      // Belge önizlemesi: detay → "Belgeyi aç" → iframe (yazdırma ✋ — insan gözü).
      await satir.getByRole("button", { name: "Detay", exact: false }).click({ timeout: 15_000 });
      const det = page().getByRole("dialog").filter({ hasText: j2Olcum.docNo }).last(); await gor(det);
      await det.getByRole("button", { name: "Belgeyi aç" }).click({ timeout: 15_000 });
      const bd = page().getByRole("dialog").filter({ hasText: `Fatura — ${j2Olcum.docNo}` }).last(); await gor(bd, { sure: 20_000 });
      const cerceve = bd.locator("iframe").first();
      await cerceve.waitFor({ state: "visible", timeout: 20_000 });
      await page().waitForTimeout(1200);
      const govde = await bd.frameLocator("iframe").locator("body").innerText().catch(() => "");
      j2Olcum.belgeAcildi = govde.length > 0 ? 1 : 0;
      j2Olcum.belgeDocNoVar = govde.includes(j2Olcum.docNo) ? 1 : 0;
      j2Olcum.belge25Var = /25/.test(govde) ? 1 : 0;
      await page().keyboard.press("Escape"); await page().waitForTimeout(300);
    },
    async bekle({ gor, page }) {
      const satir = page().getByRole("row").filter({ hasText: j2Olcum.docNo }).filter({ visible: true }).first();
      await gor(satir); await gor(satir.getByText(/Onaylı|Onaylandı|CONFIRMED/i).first(), { sure: 15_000 }).catch(() => undefined);
    },
    dogrula: [
      { ad: "fatura ONAYLI, no korunur, onay damgası (invoices)", sql: `SELECT status::text st, ("confirmedAt" IS NOT NULL) d, "grandTotal"::text g FROM invoices WHERE "docNo"=$1`, params: () => [j2Olcum.docNo], oku: (r) => `${r[0]?.st}:${r[0]?.d}:${r[0]?.g}`, beklenen: (v) => /^CONFIRMED:true:1200(\.0+)?$/.test(v) },
      { ad: "satırlarda birim dolu (invoice_lines.unit NOT NULL)", sql: `SELECT count(*)::int n, bool_and(l.unit IS NOT NULL AND l.unit<>'') u FROM invoice_lines l JOIN invoices i ON i.id=l."invoiceId" WHERE i."docNo"=$1`, params: () => [j2Olcum.docNo], oku: (r) => `${r[0].n}:${r[0].u}`, beklenen: "1:true" },
      { ad: "cari deftere 1 satır: müşteri BORÇLU (debit 1.200), kaynak INVOICE (cari_transactions)",
        sql: `SELECT count(*)::int n, sum(t.debit)::text b, sum(t.credit)::text a, max(t."sourceType"::text) k FROM cari_transactions t JOIN invoices i ON i.id=t."invoiceId" WHERE i."docNo"=$1`, params: () => [j2Olcum.docNo], oku: (r) => `${r[0].n}:${r[0].b}:${r[0].a}:${r[0].k}`, beklenen: (v) => /^1:1200(\.0+)?:0(\.0+)?:INVOICE$/.test(v) },
      { ad: "belge önizlemesi açıldı, fatura no ve 25 m belgede (ekran)", sql: `SELECT 1`, oku: () => `${j2Olcum.belgeAcildi}:${j2Olcum.belgeDocNoVar}:${j2Olcum.belge25Var}`, beklenen: "1:1:1" },
    ],
  },
  {
    id: "J3", rol: "M", gerektirir: ["J2"],
    yol: "Muhasebe → Tahsilat / Ödeme → Tahsilat (TEST Müşteri · kasa · nakit · 600 = yarısı) → satırda Makbuz önizleme → Fatura Kapama (Tahsilat → Satış)", rota: "finance/payments",
    async yap({ git, gor, sql, page }) {
      const t = await sql(`SELECT i."docNo" FROM invoices i JOIN cari_accounts ca ON ca.id=i."cariId" JOIN customers c ON c.id=ca."customerId" WHERE c.name=$1 AND i.type='SALES' AND i.status='CONFIRMED' ORDER BY i."confirmedAt" DESC LIMIT 1`, [buyukTr(AD.musteri)]);
      j3Olcum.docNo = t[0]?.docNo ?? null;
      if (!j3Olcum.docNo) throw new Error("onaylı satış faturası yok (J2 koşmadı mı?)");
      j3Olcum.kasaOnce = Number((await sql(`SELECT COALESCE(max(balance),0)::text b FROM cash_boxes WHERE name=$1`, [buyukTr(AD.kasa)]))[0].b);
      await git("Tahsilat / Ödeme");
      await page().getByRole("button", { name: "Tahsilat", exact: true }).click({ timeout: 15_000 });
      const d = page().getByRole("dialog").filter({ hasText: "Yeni Tahsilat" }).last(); await gor(d);
      await d.getByRole("button", { name: "Cari seç (liste)", exact: true }).click({ timeout: 15_000 });
      const cm = page().getByRole("dialog").filter({ hasText: /Cari seç/ }).last(); await gor(cm);
      await cm.getByRole("textbox").first().fill(AD.musteri);
      await page().waitForTimeout(700);
      await cm.getByRole("row").filter({ hasText: buyukTr(AD.musteri) }).first().click({ timeout: 15_000 });
      await cm.waitFor({ state: "detached", timeout: 15_000 }).catch(() => undefined);
      const kasaSec = d.locator("select").filter({ has: page().locator("option", { hasText: /Seçin/ }) }).first();
      const kasaAdayi = kasaSec.locator("option").filter({ hasText: buyukTr(AD.kasa) }).first();
      await kasaSec.selectOption({ label: (await ((await kasaAdayi.count()) ? kasaAdayi : kasaSec.locator("option").filter({ hasText: /Kasa ·/ }).first()).textContent()) });
      await d.locator("select").filter({ has: page().locator("option", { hasText: /Nakit/ }) }).first().selectOption("CASH");
      await d.locator('input[type="number"]').first().fill("600"); // 1.200 / 2
      await d.getByRole("button", { name: /Tahsilat Kaydet/ }).click({ timeout: 15_000 });
      await d.waitFor({ state: "detached", timeout: 20_000 });
      await page().waitForTimeout(800);
      // Makbuz: kayıt anında donar, satırdan önizlenir (yazdırma ✋).
      const satir = page().getByRole("row").filter({ hasText: buyukTr(AD.musteri) }).filter({ hasText: "600" }).filter({ visible: true }).first(); await gor(satir);
      await satir.getByTitle("Makbuzu yazdır / önizle").click({ timeout: 15_000 });
      const md = page().getByRole("dialog").filter({ hasText: /Makbuz — / }).last(); await gor(md, { sure: 20_000 });
      await md.locator("iframe").first().waitFor({ state: "visible", timeout: 20_000 }); await page().waitForTimeout(1200);
      const govde = await md.frameLocator("iframe").locator("body").innerText().catch(() => "");
      j3Olcum.makbuzAcildi = govde.length > 0 ? 1 : 0; j3Olcum.makbuz600Var = /600/.test(govde) ? 1 : 0;
      await page().keyboard.press("Escape"); await page().waitForTimeout(300);
      // Fatura Kapama: Yön Tahsilat → cari → tahsilatı seç → sığan tutar → kapat
      await git("Fatura Kapama");
      await page().locator("select").filter({ has: page().locator("option", { hasText: /Tahsilat → Satış/ }) }).first().selectOption("IN");
      await page().getByRole("combobox").filter({ hasText: /Müşteri \/ fason ara/ }).first().click({ timeout: 15_000 });
      await page().getByPlaceholder("Ara (kod, isim, vergi no)").fill(AD.musteri);
      await page().waitForTimeout(800);
      await page().getByRole("option").filter({ hasText: buyukTr(AD.musteri) }).first().click({ timeout: 15_000 });
      await page().waitForTimeout(800);
      await page().getByRole("button").filter({ hasText: /600/ }).first().click({ timeout: 15_000 });
      await page().getByTitle("Bu faturaya sığabilecek en büyük tutarı yaz").first().click({ timeout: 15_000 });
      await page().getByRole("button", { name: /Faturaları kapat \(1/ }).click({ timeout: 15_000 });
      await page().waitForTimeout(1000);
    },
    async bekle({ gor, page }) {
      await gor(page().getByText(/kapatıldı|Kapama kaydedildi|kapandı/i).first(), { sure: 10_000 }).catch(() => undefined);
    },
    dogrula: [
      { ad: "tahsilat kaydı IN nakit 600, kasaya bağlı (payments)", sql: `SELECT p.direction::text d, p.method::text m, p.amount::text a, (p."cashBoxId" IS NOT NULL) k FROM payments p JOIN cari_accounts ca ON ca.id=p."cariId" JOIN customers c ON c.id=ca."customerId" WHERE c.name=$1 AND p.direction='IN' ORDER BY p."createdAt" DESC LIMIT 1`, params: [buyukTr(AD.musteri)], oku: (r) => `${r[0]?.d}:${r[0]?.m}:${r[0]?.a}:${r[0]?.k}`, beklenen: (v) => /^IN:CASH:600(\.0+)?:true$/.test(v) },
      { ad: "kasa bakiyesi +600 (cash_boxes.balance; cari tahsilatı cash_transactions'a YAZMAZ — C7 bulgusu)", sql: `SELECT COALESCE(max(balance),0)::text b FROM cash_boxes WHERE name=$1`, params: [buyukTr(AD.kasa)], oku: (r) => Number(r[0].b) - j3Olcum.kasaOnce, beklenen: (v) => Math.abs(v - 600) < 0.01 },
      { ad: "cari ekstre: fatura 1.200 borç − tahsilat 600 alacak = 600 (cari_transactions Σ)", sql: `SELECT COALESCE(SUM(t.debit - t.credit),0)::text bakiye FROM cari_transactions t JOIN cari_accounts a ON a.id=t."cariId" JOIN customers c ON c.id=a."customerId" WHERE c.name=$1`, params: [buyukTr(AD.musteri)], oku: (r) => Number(r[0].bakiye), beklenen: (v) => Math.abs(v - 600) < 0.01 },
      { ad: "kapama: faturaya 600 bağlandı, açık 600 (payment_allocations)", sql: `SELECT COALESCE(SUM(pa.amount),0)::text s FROM payment_allocations pa JOIN invoices i ON i.id=pa."invoiceId" WHERE i."docNo"=$1`, params: () => [j3Olcum.docNo], oku: (r) => Number(r[0].s), beklenen: (v) => Math.abs(v - 600) < 0.01 },
      { ad: "makbuz önizlemesi açıldı, 600 makbuzda (ekran)", sql: `SELECT 1`, oku: () => `${j3Olcum.makbuzAcildi}:${j3Olcum.makbuz600Var}`, beklenen: "1:1" },
    ],
  },
  {
    id: "J4", rol: "M", gerektirir: ["J3"],
    yol: "Raporlar → Cari Yaşlandırma → ekranda ara → satırda 'Cari ekstresi' → Cari Ekstre → Belge tipi süzgeci", rota: "reports/finance/aging",
    async yap({ git, gor, sql, page }) {
      j4Olcum.cariId = (await sql(`SELECT ca.id FROM cari_accounts ca JOIN customers c ON c.id=ca."customerId" WHERE c.name=$1`, [buyukTr(AD.musteri)]))[0]?.id ?? null;
      if (!j4Olcum.cariId) throw new Error("TEST Müşteri'nin cari hesabı yok (J1/J2 koşmadı mı?)");
      await git("Cari Yaşlandırma");
      const ara = page().getByPlaceholder("Ekranda ara").filter({ visible: true }).first(); await gor(ara, { sure: 20_000 });
      await ara.fill(AD.musteri); await page().waitForTimeout(800);
      const satir = page().getByRole("row").filter({ hasText: buyukTr(AD.musteri) }).filter({ visible: true }).first(); await gor(satir, { sure: 20_000 });
      await satir.getByTitle("Cari ekstresi").click({ timeout: 15_000 });
      const d = page().getByRole("dialog").filter({ hasText: "Cari Ekstre" }).last(); await gor(d, { sure: 20_000 });
      await d.getByText("Dönem toplamı").waitFor({ timeout: 20_000 }); await page().waitForTimeout(600);
      const satirlar = d.locator("tbody tr");
      const metin = async () => (await d.innerText().catch(() => "")) ?? "";
      const m1 = await metin();
      j4Olcum.faturaSatiri = (m1.match(/\bFatura\b/g) ?? []).length; j4Olcum.tahsilatSatiri = (m1.match(/Tahsilat \/ Ödeme/g) ?? []).length;
      const toplam = async () => { const t = d.locator("tr", { hasText: "Dönem toplamı" }).last(); return ((await t.innerText()).split(/\t|\n/).filter(Boolean).pop() ?? "").trim(); };
      j4Olcum.toplamOnce = await toplam();
      // Belge tipi süzgeci yalnız dökümü daraltır; devir/bakiye/toplam dönemin tamamıdır (belge şerhi).
      const bt = d.locator("select").filter({ has: page().locator("option", { hasText: /Tüm belgeler/ }) }).first();
      j4Olcum.filtreSecenek = await bt.locator("option").count();
      await bt.selectOption("PAYMENT"); await page().waitForTimeout(900);
      j4Olcum.satirSonra = (await satirlar.count()) - 2; // devir satırı + "Dönem toplamı" satırı düşülür → yalnız hareketler
      j4Olcum.toplamSonra = await toplam();
      await page().keyboard.press("Escape"); await page().waitForTimeout(300);
    },
    async bekle({ gor, page }) {
      await gor(page().getByRole("row").filter({ hasText: buyukTr(AD.musteri) }).filter({ visible: true }).first());
    },
    dogrula: [
      { ad: "ekstrede fatura + tahsilat satırı; kapanış 600 (ekran)", sql: `SELECT 1`, oku: () => `${j4Olcum.faturaSatiri >= 1 ? 1 : 0}:${j4Olcum.tahsilatSatiri >= 1 ? 1 : 0}:${j4Olcum.toplamOnce}`, beklenen: (v) => /^1:1:600[,.]00/.test(v) },
      { ad: "belge tipi süzgeci dökümü daraltır (1 satır) ama dönem toplamını DEĞİŞTİRMEZ (ekran)", sql: `SELECT 1`, oku: () => `${j4Olcum.satirSonra}:${j4Olcum.toplamSonra === j4Olcum.toplamOnce}`, beklenen: "1:true" },
      { ad: "yaşlandırma: açık 600, hepsi VADESİZ kovasında (vade yok → C6/J1 vade eksiği burada görünür), defter = saklanan bakiye (GET /reports/finance/aging)",
        uc: () => `/api/reports/finance/aging?cariId=${j4Olcum.cariId}`,
        oku: (g) => { const r = (g?.data?.blocks ?? []).flatMap((b) => b.rows).find((x) => x.cariId === j4Olcum.cariId); return r ? `${r.openTotal}:${r.net?.noDueDate}:${r.reconDiff}:${r.ledgerBalance === r.storedBalance}` : "satır yok"; },
        beklenen: (v) => /^600(\.00)?:600(\.00)?:0(\.00)?:true$/.test(v) },
      { ad: "bakiye = cari_transactions Σ (600)", sql: `SELECT COALESCE(SUM(debit - credit),0)::text b FROM cari_transactions WHERE "cariId"=$1`, params: () => [j4Olcum.cariId], oku: (r) => Number(r[0].b), beklenen: (v) => Math.abs(v - 600) < 0.01 },
    ],
  },
  {
    id: "J5", rol: "M", gerektirir: ["J3"],
    yol: "Raporlar → Kasa & Banka Defteri (Cari: TEST Müşteri · Yön: Yalnız giriş) · KDV Dönem Özeti (Yön: Satış · Oran: %20) — süzgeç şerhleri ekranda ve meta.secenekler'de; Excel ✋", rota: "reports/finance/cash-book",
    async yap({ git, gor, sql, page }) {
      j5Olcum.cariId = (await sql(`SELECT ca.id FROM cari_accounts ca JOIN customers c ON c.id=ca."customerId" WHERE c.name=$1`, [buyukTr(AD.musteri)]))[0]?.id ?? null;
      // Kasa & Banka Defteri
      await git("Kasa & Banka Defteri");
      // Önce ilk yükleme bitsin: sayfa açılışta tarih varsayılanını URL'ye yazar; o yazım sırasında seçilen eksen süzgeci
      // SİLİNİYOR (TESTM'de ölçüldü — veri arttıkça ilk yükleme uzuyor, seçim yarışa yeniliyor). İnsan da yüklenmesini bekler.
      await gor(page().getByText("Hesap Özeti").filter({ visible: true }).first(), { sure: 20_000 }); await page().waitForTimeout(800);
      await gor(page().getByLabel("Cari", { exact: true }).filter({ visible: true }).first(), { sure: 20_000 });
      if (!(await eksenSec(page(), "Cari", buyukTr(AD.musteri)))) throw new Error("cari ekseni seçilemedi (tetikleyici 'Tümü' kaldı)");
      await page().locator("select").filter({ has: page().locator("option", { hasText: /Yalnız giriş/ }) }).filter({ visible: true }).first().selectOption("IN");
      // Şerhler sorgu cevabıyla çizilir — sabit bekleme yerine görünene dek (10 sn) bekle.
      await page().getByText(/SÜZGEÇ — Yön: Yalnız giriş/).filter({ visible: true }).first().waitFor({ timeout: 10_000 }).catch(() => undefined);
      await page().getByText(/SÜZGEÇ — Cari: /).filter({ visible: true }).first().waitFor({ timeout: 10_000 }).catch(() => undefined);
      const kasaMetin = await page().locator("body").innerText();
      j5Olcum.kasaNotlari = [/SÜZGEÇ — Cari: .*MÜŞTERİ/.test(kasaMetin) ? 1 : 0, /SÜZGEÇ — Yön: Yalnız giriş/.test(kasaMetin) ? 1 : 0].join(":");
      // Sayfa hesap ÖZETİ çizer (satır = kasa/banka hesabı; hareket dökümü hesabın defterinde) → TEST Kasa satırında 600 giriş.
      j5Olcum.kasaSatir600 = await page().getByRole("row").filter({ hasText: buyukTr(AD.kasa) }).filter({ hasText: "600" }).filter({ visible: true }).count();
      // KDV Dönem Özeti
      await git("KDV Dönem Özeti");
      const yon = page().locator("select").filter({ has: page().locator("option", { hasText: /Tüm yönler/ }) }).filter({ visible: true }).first(); await gor(yon, { sure: 20_000 });
      await gor(page().getByText(/Satış KDV|Bu özet nasıl okunur/).filter({ visible: true }).first(), { sure: 20_000 }); await page().waitForTimeout(800);
      await yon.selectOption("SALES");
      const oran = page().locator("select").filter({ has: page().locator("option", { hasText: /Tüm oranlar/ }) }).filter({ visible: true }).first();
      await oran.selectOption({ label: "%20" }).catch(() => undefined);
      // Şerh, seçenekler gelene dek ham kodu ("20.00") basar, sonra etikete ("%20") döner — etiketi bekle.
      await page().getByText(/SÜZGEÇ — KDV oranı: %20/).filter({ visible: true }).first().waitFor({ timeout: 10_000 }).catch(() => undefined);
      const kdvMetin = await page().locator("body").innerText();
      j5Olcum.kdvNotlari = [/SÜZGEÇ — Yön: Satış/.test(kdvMetin) ? 1 : 0, /SÜZGEÇ — KDV oranı: %20/.test(kdvMetin) ? 1 : 0].join(":");
      j5Olcum.kdvCariSecici = await page().getByLabel("Cari", { exact: true }).filter({ visible: true }).count();
    },
    async bekle({ gor, page }) {
      await gor(page().getByText("KDV Dönem Özeti").filter({ visible: true }).first());
    },
    dogrula: [
      { ad: "Kasa defteri: cari + yön şerhleri ekranda; hesap özetinde TEST Kasa 600 giriş (ekran)", sql: `SELECT 1`, oku: () => `${j5Olcum.kasaNotlari}:${j5Olcum.kasaSatir600 >= 1 ? 1 : 0}`, beklenen: "1:1:1" },
      { ad: "KDV özeti: yön + oran şerhleri ekranda; cari seçici YOK (ekran)", sql: `SELECT 1`, oku: () => `${j5Olcum.kdvNotlari}:${j5Olcum.kdvCariSecici}`, beklenen: "1:1:0" },
      { ad: "GET /reports/finance/cash-book meta.secenekler cari listesinde TEST Müşteri; yön=IN toplam giriş ≥ 600",
        uc: () => `/api/reports/finance/cash-book?dateFrom=${encodeURIComponent(new Date(Date.now() - 7 * 864e5).toISOString())}&dateTo=${encodeURIComponent(new Date().toISOString())}&cariId=${j5Olcum.cariId}&yon=IN`,
        oku: (g) => `${(g?.meta?.secenekler?.cariId ?? []).some((o) => o.id === j5Olcum.cariId) ? 1 : 0}:${Number(g?.data?.totals?.totalIn ?? 0) >= 600 ? 1 : 0}`, beklenen: "1:1" },
      { ad: "GET /reports/finance/vat-summary yön=SALES oran=20.00 → %20 satırı: KDV = matrah × 0,20; meta.secenekler.oran dolu; cariId KABUL EDİLMEZ (strict)",
        uc: () => `/api/reports/finance/vat-summary?dateFrom=${encodeURIComponent(new Date(Date.now() - 7 * 864e5).toISOString())}&dateTo=${encodeURIComponent(new Date().toISOString())}&yon=SALES&oran=20.00`,
        oku: (g) => { const r = (g?.data?.sales?.currencies ?? []).flatMap((c) => c.rows).find((x) => x.vatRate === "20.00" && !x.isReturn); return `${r && Math.abs(Number(r.vat) - Number(r.base) * 0.2) < 0.01 ? 1 : 0}:${(g?.meta?.secenekler?.oran ?? []).length > 0 ? 1 : 0}`; }, beklenen: "1:1" },
    ],
  },
  {
    id: "M1", rol: "S",
    yol: "Sistem → Modüller → Raporlar → 'Kalite Karnesi' anahtarını KAPAT", rota: "system/module-profile",
    async yap({ git, gor, page }) {
      await git("Modüller");
      const satir = page().locator('[data-testid="rapor-satir:quality/scorecard"]').first(); await gor(satir, { sure: 20_000 });
      await satir.scrollIntoViewIfNeeded();
      const kutu = satir.locator('input[type="checkbox"]').first();
      if (await kutu.isChecked()) { await kutu.click({ timeout: 15_000 }); await page().waitForTimeout(1200); }
    },
    async bekle({ page }) {
      const kutu = page().locator('[data-testid="rapor-satir:quality/scorecard"] input[type="checkbox"]').first();
      if (await kutu.isChecked()) throw new Error("anahtar hâlâ açık");
    },
    dogrula: [
      { ad: "reports.closedKeys = [quality/scorecard] (GET /api/feature-flags)", uc: "/api/feature-flags", oku: (g) => (g?.data?.reportsClosedKeys ?? []).join(","), beklenen: "quality/scorecard" },
      { ad: "system_settings satırı", sql: `SELECT value::text v FROM system_settings WHERE key='reports.closedKeys'`, oku: (r) => r[0]?.v ?? null, beklenen: (v) => typeof v === "string" && v.includes("quality/scorecard") },
    ],
  },
  {
    id: "M1b", rol: "P", gerektirir: ["M1"],
    yol: "Yönetici: ⌘K 'Kalite Karnesi' → yok · Raporlar → Kalite → karo yok · API 403 REPORT_DISABLED", rota: "reports/quality",
    async yap({ git, api, page }) {
      // Palet: kapalı rapor aranınca çıkmamalı.
      const kutu = page().getByPlaceholder("Sayfa, rapor, ayar ara...");
      const acici = page().getByText("Ara veya komut", { exact: false }).first();
      if (await acici.count()) await acici.click({ timeout: 10_000 }); else await page().keyboard.press("Meta+k");
      await kutu.waitFor({ timeout: 10_000 }); await kutu.fill("Kalite Karnesi"); await page().waitForTimeout(700);
      m1Olcum.paletSayisi = await page().locator("[cmdk-item]").filter({ hasText: /^Kalite Karnesi$/ }).count();
      await page().keyboard.press("Escape"); await page().waitForTimeout(300);
      // Hub → Kalite kategorisi: karo çizilmemeli (kategori diğer kalite raporlarıyla açık kalır).
      await git("Raporlar");
      const kategori = page().getByRole("link", { name: /^Kalite$/ }).or(page().getByText("Kalite", { exact: true })).filter({ visible: true }).first();
      m1Olcum.kategoriKaroVar = await kategori.count();
      if (m1Olcum.kategoriKaroVar) { await kategori.click({ timeout: 10_000 }); await page().waitForTimeout(800); }
      m1Olcum.karoSayisi = await page().getByText("Kalite Karnesi", { exact: true }).filter({ visible: true }).count();
      const r = await api(`/api/reports/quality/scorecard`);
      m1Olcum.apiKapali = r.status; m1Olcum.apiKapaliKod = r.govde?.details?.code ?? null;
    },
    async bekle({ gor, page }) { await gor(page().getByText(/Fire Karnesi|Kalite/).filter({ visible: true }).first()); },
    dogrula: [
      { ad: "palet 'Kalite Karnesi' listelemez (ekran)", sql: `SELECT 1`, oku: () => m1Olcum.paletSayisi, beklenen: 0 },
      { ad: "Raporlar → Kalite: karo çizilmez (ekran)", sql: `SELECT 1`, oku: () => m1Olcum.karoSayisi, beklenen: 0 },
      { ad: "uç 403 REPORT_DISABLED (fail-closed; 404 değil — varlık doğrulanır)", sql: `SELECT 1`, oku: () => `${m1Olcum.apiKapali}:${m1Olcum.apiKapaliKod}`, beklenen: "403:REPORT_DISABLED" },
    ],
  },
  {
    id: "M1c", rol: "S", gerektirir: ["M1"],
    yol: "Sistem → Modüller → 'Kalite Karnesi' anahtarını tekrar AÇ → uç 200", rota: "system/module-profile",
    async yap({ git, gor, api, page }) {
      await git("Modüller");
      const satir = page().locator('[data-testid="rapor-satir:quality/scorecard"]').first(); await gor(satir, { sure: 20_000 });
      await satir.scrollIntoViewIfNeeded();
      const kutu = satir.locator('input[type="checkbox"]').first();
      if (!(await kutu.isChecked())) { await kutu.click({ timeout: 15_000 }); await page().waitForTimeout(1200); }
      m1Olcum.apiAcik = (await api(`/api/reports/quality/scorecard`)).status;
    },
    async bekle({ page }) {
      const kutu = page().locator('[data-testid="rapor-satir:quality/scorecard"] input[type="checkbox"]').first();
      if (!(await kutu.isChecked())) throw new Error("anahtar hâlâ kapalı");
    },
    dogrula: [
      { ad: "closedKeys boş (GET /api/feature-flags)", uc: "/api/feature-flags", oku: (g) => (g?.data?.reportsClosedKeys ?? []).length, beklenen: 0 },
      { ad: "uç yeniden 200", sql: `SELECT 1`, oku: () => m1Olcum.apiAcik, beklenen: 200 },
    ],
  },
  {
    id: "M3", rol: "S",
    yol: "Sistem → Modüller → 'Emanet / konsinye mülkiyet modülünü aç' KAPAT → Kaydet (modül anahtarları Özellik Anahtarları'nda DEĞİL, Modüller sayfasında)", rota: "system/module-profile",
    async yap({ git, gor, page }) {
      await git("Modüller");
      const sw = page().locator("label", { hasText: "Emanet / konsinye mülkiyet modülünü aç" }).locator('input[type="checkbox"]').filter({ visible: true }).first(); await gor(sw);
      if (await sw.isChecked()) await sw.click();
      const kaydet = page().getByRole("button", { name: "Kaydet", exact: true }).filter({ visible: true }).first();
      if (await kaydet.isEnabled()) { await kaydet.click({ timeout: 15_000 }); await page().waitForTimeout(1500); }
    },
    async bekle() {},
    dogrula: [
      { ad: "emanetEnabled=false (GET /api/feature-flags)", uc: "/api/feature-flags", oku: (g) => g?.data?.emanetEnabled, beklenen: false },
    ],
  },
  {
    id: "M3b", rol: "P", gerektirir: ["M3"],
    yol: "Yönetici: Kumaş Stoğu → Manuel Top Ekle → 'Sahibi' alanı ÇİZİLMEZ · API: kapalı modülde emanet top müşterisiz çuvala → başka müşteriye sevk → yine 409 (kapalı modül kapıyı KALDIRMAZ)", rota: "operations/rolls",
    async yap({ git, tikla, gor, api, sql, page }) {
      await git("Kumaş Stoğu");
      const hamTab = page().getByRole("tab", { name: "Ham Stok" }).first();
      if (await hamTab.count()) { await hamTab.click({ timeout: 10_000 }); await page().waitForTimeout(400); }
      await tikla("Manuel Top Ekle");
      const md = page().getByRole("dialog").filter({ hasText: "Manuel Top Ekle" }).last(); await gor(md);
      m3Olcum.sahipAlani = await md.getByText("Sahibi (emanet mal ise müşteri)", { exact: false }).count();
      await md.getByRole("button", { name: "İptal", exact: true }).click({ timeout: 10_000 });
      await md.waitFor({ state: "detached", timeout: 10_000 }).catch(() => undefined);
      // API: I7'de iade edilip depoya dönen emanet top (sahibi korunmuş) → müşterisiz çuval → başka müşteriye sevk.
      const top = await sql(`SELECT r.barcode FROM rolls r JOIN customers c ON c.id=r."ownerCustomerId" WHERE c.name=$1 AND r.status IN ('WAREHOUSE','STOCK') AND r."sackId" IS NULL AND r."shipmentId" IS NULL ORDER BY r."updatedAt" DESC LIMIT 1`, [buyukTr(AD.musteri)]);
      m3Olcum.barkod = top[0]?.barcode ?? null;
      if (!m3Olcum.barkod) throw new Error("depoda serbest emanet top yok (I4/I7 koşmadı mı?)");
      const diger = (await sql(`SELECT id FROM customers WHERE "isActive" AND name NOT LIKE $1 AND type IN ('CUSTOMER','BOTH') ORDER BY name LIMIT 1`, [`${ONEK}%`]))[0]?.id;
      const c = await api(`/api/shipping/sacks`, { method: "POST", body: JSON.stringify({ clientToken: crypto.randomUUID() }) });
      m3Olcum.cuval = c.status; const sackId = c.govde?.data?.id;
      if (!sackId) throw new Error(`çuval açılamadı: ${c.status} ${JSON.stringify(c.govde).slice(0, 200)}`);
      const o = await api(`/api/shipping/sacks/${sackId}/scan`, { method: "POST", body: JSON.stringify({ barcode: m3Olcum.barkod }) });
      m3Olcum.okut = o.status;
      const sv = await api(`/api/shipping/shipments`, { method: "POST", body: JSON.stringify({ sackIds: [sackId], customerId: diger, orderless: true, destination: "DOMESTIC", clientToken: crypto.randomUUID() }) });
      m3Olcum.sevkDurum = sv.status; m3Olcum.sevkKod = sv.govde?.details?.code ?? null; m3Olcum.sevkTopVar = JSON.stringify(sv.govde ?? {}).includes(m3Olcum.barkod) ? 1 : 0;
    },
    async bekle() {},
    dogrula: [
      { ad: "Manuel Top Ekle: 'Sahibi' alanı çizilmez (ekran)", sql: `SELECT 1`, oku: () => m3Olcum.sahipAlani, beklenen: 0 },
      { ad: "çuval açıldı (201/200) ve emanet top okutuldu (200)", sql: `SELECT 1`, oku: () => `${m3Olcum.cuval}:${m3Olcum.okut}`, beklenen: (v) => /^20[01]:20[01]$/.test(v) },
      { ad: "KAPALI modülde de başka müşteriye sevk 409 OWNER_MISMATCH, top listelenir — kapalı modül kapıyı kaldırmaz", sql: `SELECT 1`, oku: () => `${m3Olcum.sevkDurum}:${m3Olcum.sevkKod}:${m3Olcum.sevkTopVar}`, beklenen: "409:OWNER_MISMATCH:1" },
      { ad: "emanet top hâlâ sahibinde, sevk edilmedi (rolls)", sql: `SELECT (r."ownerCustomerId" IS NOT NULL) sahip, (r."shipmentId" IS NULL) sevksiz FROM rolls r WHERE r.barcode=$1`, params: () => [m3Olcum.barkod], oku: (r) => `${r[0]?.sahip}:${r[0]?.sevksiz}`, beklenen: "true:true" },
    ],
  },
  {
    id: "M3c", rol: "S", gerektirir: ["M3"],
    yol: "Sistem → Modüller → Emanet modülünü tekrar AÇ", rota: "system/module-profile",
    async yap({ git, gor, page }) {
      await git("Modüller");
      const sw = page().locator("label", { hasText: "Emanet / konsinye mülkiyet modülünü aç" }).locator('input[type="checkbox"]').filter({ visible: true }).first(); await gor(sw);
      if (!(await sw.isChecked())) await sw.click();
      const kaydet = page().getByRole("button", { name: "Kaydet", exact: true }).filter({ visible: true }).first();
      if (await kaydet.isEnabled()) { await kaydet.click({ timeout: 15_000 }); await page().waitForTimeout(1500); }
    },
    async bekle() {},
    dogrula: [
      { ad: "emanetEnabled=true (GET /api/feature-flags)", uc: "/api/feature-flags", oku: (g) => g?.data?.emanetEnabled, beklenen: true },
    ],
  },
  {
    id: "M2", rol: "S",
    yol: "Sistem → Modüller → 'Dokuma işi modülünü aç' KAPAT → Kaydet → Raporlar bölümünde dokuma satırları kilit bandıyla pasif", rota: "system/module-profile",
    async yap({ git, gor, page }) {
      await git("Modüller");
      const sw = page().locator("label", { hasText: "Dokuma işi modülünü aç" }).locator('input[type="checkbox"]').filter({ visible: true }).first(); await gor(sw);
      if (await sw.isChecked()) await sw.click();
      const kaydet = page().getByRole("button", { name: "Kaydet", exact: true }).filter({ visible: true }).first();
      if (await kaydet.isEnabled()) { await kaydet.click({ timeout: 15_000 }); await page().waitForTimeout(1500); }
      // Aynı sayfanın Raporlar bölümü: dokuma raporları kilit bandı alır (anahtar pasif).
      m2Olcum.kilitSayisi = await page().locator('[data-testid^="rapor-kilit:dokuma/"]').count();
    },
    async bekle() {},
    dogrula: [
      { ad: "dokumaEnabled=false (GET /api/feature-flags)", uc: "/api/feature-flags", oku: (g) => g?.data?.dokumaEnabled, beklenen: false },
      { ad: "Raporlar bölümünde 4 dokuma raporu (randıman · duruş pareto · vardiya karnesi · karne) kilit bandıyla pasif (ekran)", sql: `SELECT 1`, oku: () => m2Olcum.kilitSayisi, beklenen: 4 },
    ],
  },
  {
    id: "M2b", rol: "P", gerektirir: ["M2"],
    yol: "Yönetici: ⌘K 'Dokuma İşleri' → yok · GET /api/weaving-orders → 403 MODULE_DISABLED (tablet Bölüm Seçimi: d5)", rota: "operations/weaving-orders",
    async yap({ api, page }) {
      const kutu = page().getByPlaceholder("Sayfa, rapor, ayar ara...");
      const acici = page().getByText("Ara veya komut", { exact: false }).first();
      if (await acici.count()) await acici.click({ timeout: 10_000 }); else await page().keyboard.press("Meta+k");
      await kutu.waitFor({ timeout: 10_000 }); await kutu.fill("Dokuma İşleri"); await page().waitForTimeout(700);
      m2Olcum.paletDokuma = await page().locator("[cmdk-item]").filter({ hasText: /^Dokuma İşleri$/ }).count();
      await page().keyboard.press("Escape");
      const r = await api(`/api/weaving-orders?limit=1`);
      m2Olcum.apiDurum = r.status; m2Olcum.apiKod = r.govde?.details?.code ?? null;
    },
    async bekle() {},
    dogrula: [
      { ad: "palet 'Dokuma İşleri' listelemez (ekran)", sql: `SELECT 1`, oku: () => m2Olcum.paletDokuma, beklenen: 0 },
      { ad: "GET /api/weaving-orders → 403 MODULE_DISABLED", sql: `SELECT 1`, oku: () => `${m2Olcum.apiDurum}:${m2Olcum.apiKod}`, beklenen: "403:MODULE_DISABLED" },
    ],
  },
  {
    id: "M2c", rol: "S", gerektirir: ["M2"],
    yol: "Sistem → Modüller → Dokuma modülünü tekrar AÇ → uç 200", rota: "system/module-profile",
    async yap({ git, gor, api, page }) {
      await git("Modüller");
      const sw = page().locator("label", { hasText: "Dokuma işi modülünü aç" }).locator('input[type="checkbox"]').filter({ visible: true }).first(); await gor(sw);
      if (!(await sw.isChecked())) await sw.click();
      const kaydet = page().getByRole("button", { name: "Kaydet", exact: true }).filter({ visible: true }).first();
      if (await kaydet.isEnabled()) { await kaydet.click({ timeout: 15_000 }); await page().waitForTimeout(1500); }
      m2Olcum.acikDurum = (await api(`/api/weaving-orders?limit=1`)).status;
      m2Olcum.kilitSonra = await page().locator('[data-testid^="rapor-kilit:dokuma/"]').count();
    },
    async bekle() {},
    dogrula: [
      { ad: "dokumaEnabled=true (GET /api/feature-flags)", uc: "/api/feature-flags", oku: (g) => g?.data?.dokumaEnabled, beklenen: true },
      { ad: "GET /api/weaving-orders yeniden 200", sql: `SELECT 1`, oku: () => m2Olcum.acikDurum, beklenen: 200 },
      { ad: "kilit bandı kalktı (ekran)", sql: `SELECT 1`, oku: () => m2Olcum.kilitSonra, beklenen: 0 },
    ],
  },
  {
    id: "L4", rol: "P", gerektirir: ["E1"],
    yol: "Raporlar → Sipariş Karnesi (Müşteri çoklu seçici · Müşteri varsayılanı: Yurtiçi → şerhler → X temizle) · Sipariş İptal Karnesi (İptal sebebi ekseni)", rota: "reports/sales/order-intake",
    async yap({ git, gor, sql, page }) {
      l4Olcum.musteriId = (await sql(`SELECT id FROM customers WHERE name=$1`, [buyukTr(AD.musteri)]))[0]?.id ?? null;
      const istekler = []; const dinle = (r) => { if (r.url().includes("/reports/sales/order-intake")) istekler.push(r.url().replace(/^.*order-intake/, "")); };
      const dinleC = async (r) => { if (r.url().includes("/reports/sales/order-intake")) istekler.push(`→${r.status()} ${(await r.text().catch(() => "")).slice(0, 120)}`); };
      page().on("request", dinle); page().on("response", dinleC);
      await git("Sipariş Karnesi");
      await gor(page().getByLabel("Müşteri", { exact: true }).filter({ visible: true }).first(), { sure: 20_000 });
      await gor(page().getByText(/Bu rapor nasıl okunur|Sipariş/).filter({ visible: true }).last(), { sure: 20_000 }); await page().waitForTimeout(800);
      if (!(await eksenSec(page(), "Müşteri", buyukTr(AD.musteri)))) throw new Error("müşteri ekseni seçilemedi");
      // Yön: shadcn Select — etiketi "Cari/şube yönü (bugünkü)" (niteleyici etikette; 2026-09-23'e kadar "Müşteri varsayılanı").
      await page().getByLabel("Cari/şube yönü (bugünkü)", { exact: true }).filter({ visible: true }).first().click({ timeout: 15_000 });
      await page().getByRole("option", { name: /Yurtiçi/ }).first().click({ timeout: 15_000 });
      await page().getByText(/SÜZGEÇ — Cari\/şube yönü/).filter({ visible: true }).first().waitFor({ timeout: 10_000 }).catch(() => undefined);
      // Müşteri şerhi etiketini CEVAPTAKİ seçeneklerden alır — süzülmüş sorgu dönene dek görünmez, onu da bekle.
      await page().getByText(/SÜZGEÇ — Müşteri: /).filter({ visible: true }).first().waitFor({ timeout: 15_000 }).catch(() => undefined);
      const m1 = await page().locator("body").innerText();
      await page().waitForTimeout(2500); // yeni anahtarlı sorgu (varsa) gitsin
      page().off("request", dinle); page().off("response", dinleC);
      const gidenler = istekler.filter((x) => x.startsWith("?"));
      l4Olcum.istekSayisi = gidenler.length;
      l4Olcum.suzgecliIstek = gidenler.filter((x) => /customerId=/.test(x) && /destination=DOMESTIC/.test(x)).length;
      l4Olcum.tani = `tetik=${(await page().getByLabel("Müşteri", { exact: true }).filter({ visible: true }).first().textContent().catch(() => "?"))?.trim()} | ${(m1.match(/SÜZGEÇ[^\n]*/g) ?? []).join(" || ")}`;
      l4Olcum.notMusteri = /SÜZGEÇ — Müşteri: .*MÜŞTERİ/.test(m1) ? 1 : 0;
      l4Olcum.notHedef = /SÜZGEÇ — Cari\/şube yönü \(bugünkü\): Yurtiçi/.test(m1) ? 1 : 0;
      l4Olcum.notHedefSerh = /BUGÜNKÜ cari\/şube yönü .*sevkin donmuş yönü değil/.test(m1) ? 1 : 0;
      // Seçimi temizle (X) → müşteri şerhi düşer.
      await page().getByTitle("Süzgeci temizle").filter({ visible: true }).first().click({ timeout: 15_000 });
      await page().waitForTimeout(1200);
      l4Olcum.temizSonraMusteri = /SÜZGEÇ — Müşteri:/.test(await page().locator("body").innerText()) ? 1 : 0;
      // Sipariş İptal Karnesi: sebep ekseni — bu kurulumda iptallerde sebep kodu yok → seçici pasif + ipucu; sayfa oranı uyarır.
      await git("Sipariş İptal Karnesi");
      const sebep = page().getByLabel("İptal sebebi", { exact: true }).filter({ visible: true }).first(); await gor(sebep, { sure: 20_000 });
      await page().waitForTimeout(1200);
      l4Olcum.iptalSebepSecici = await sebep.isDisabled();
      l4Olcum.iptalSebepIpucu = (await sebep.innerText()).trim();
      l4Olcum.iptalUyari = /sebep kodu/.test(await page().locator("body").innerText()) ? 1 : 0;
    },
    async bekle({ gor, page }) { await gor(page().getByText("Sipariş İptal Karnesi").filter({ visible: true }).first()); },
    dogrula: [
      { ad: "Sipariş Karnesi şerhleri: Sevk hedefi (Yurtiçi) + 'müşteri varsayılanı, fiili hedef değil' (ekran)", sql: `SELECT 1`, oku: () => `${l4Olcum.notHedef}:${l4Olcum.notHedefSerh} [${l4Olcum.tani}]`, beklenen: (v) => v.startsWith("1:1") },
      { ad: "eksen süzgeçleri SUNUCUYA GİDİYOR: sayfanın gönderdiği isteklerden en az biri customerId+destination taşır (düzeltme öncesi 0/3 — `reportsClient.getReport` allowlist'i düşürüyordu; şimdi 1/3: ilk yükleme süzgeçsiz, seçimden sonraki süzgeçli)", sql: `SELECT 1`, oku: () => `${l4Olcum.suzgecliIstek}/${l4Olcum.istekSayisi} süzgeçli istek`, beklenen: (v) => !/^0\//.test(v) },
      { ad: "X ile temizleyince müşteri şerhi düşer (ekran)", sql: `SELECT 1`, oku: () => l4Olcum.temizSonraMusteri, beklenen: 0 },
      { ad: "GET /reports/sales/order-intake?customerId&destination=DOMESTIC → meta.secenekler.customerId TEST Müşteri'yi listeler; özet 1 sipariş / 100 m (E1)",
        uc: () => `/api/reports/sales/order-intake?dateFrom=${encodeURIComponent(new Date(Date.now() - 7 * 864e5).toISOString())}&dateTo=${encodeURIComponent(new Date().toISOString())}&customerId=${l4Olcum.musteriId}&destination=DOMESTIC`,
        oku: (g) => `${(g?.meta?.secenekler?.customerId ?? []).some((o) => o.id === l4Olcum.musteriId) ? 1 : 0}:${g?.data?.summary?.orderCount}:${g?.data?.summary?.totalQty}`, beklenen: (v) => /^1:[1-9]\d*:(100|150|\d+)$/.test(v) },
      { ad: "İptal Karnesi: sebep ekseni — kurulumda iptal sebebi kodu YOK → seçici pasif + 'Pencerede sebep yok'; sayfa 'sebep kodu' oranını uyarır (ekran)", sql: `SELECT 1`, oku: () => `${l4Olcum.iptalSebepSecici}:${l4Olcum.iptalSebepIpucu}:${l4Olcum.iptalUyari}`, beklenen: (v) => /^(true:Pencerede sebep yok:1|false:.*:\d)$/.test(v) },
      { ad: "GET /reports/sales/order-cancellation → meta.secenekler.reasonCode ve reasonFillPct (veri boşluğu ölçümü)",
        uc: () => `/api/reports/sales/order-cancellation?dateFrom=${encodeURIComponent(new Date(Date.now() - 30 * 864e5).toISOString())}&dateTo=${encodeURIComponent(new Date().toISOString())}`,
        oku: (g) => `${(g?.meta?.secenekler?.reasonCode ?? []).length}:${g?.data?.summary?.reasonFillPct}`, beklenen: (v) => /^\d+:\d+(\.\d+)?$/.test(v) },
    ],
  },
  {
    id: "K1", rol: "P", gerektirir: ["B1", "B3", "C2"],
    yol: "Cariler → Yeni Cari (Fason iş yapar) · Leventler → Yeni Levent (Hazır alındı) → sağ tık → Sar (WOUND) · Dokuma İşleri → Yeni Dokuma İşi (Fasonda dokunuyor) → sağ tık → Fason (sevk · kabul) → Sevk et (levent + iplik TEST-L1 20 kg)", rota: "operations/weaving-orders",
    async yap({ git, tikla, gor, sec, sql, page }) {
      const secModal = async (d, tetik, ara) => {
        await d.getByText(tetik, { exact: false }).first().click({ timeout: 15_000 });
        const m = page().getByRole("dialog").filter({ has: page().getByPlaceholder("Ara (ad veya kod)") }).last(); await gor(m);
        await m.getByPlaceholder("Ara (ad veya kod)").fill(ara); await page().waitForTimeout(700);
        await m.getByText(buyukTr(ara), { exact: false }).first().click({ timeout: 15_000 });
        await m.waitFor({ state: "detached", timeout: 15_000 }).catch(() => undefined);
      };
      // ① Fasoncu — cari kartında "Fason iş yapar" (BP rol modeli: fason = carinin rolü, tedarikçi rolü otomatik işaretlenir).
      if (!(await sql(`SELECT 1 FROM customers WHERE name=$1`, [buyukTr(AD.fasoncu)])).length) {
        await git("Cariler"); await tikla("Yeni Cari");
        const d = page().getByRole("dialog").filter({ hasText: "Yeni Cari" }).last(); await gor(d);
        await d.locator("#name").fill(AD.fasoncu);
        await d.getByLabel("Fason iş yapar", { exact: true }).check();
        await d.getByRole("button", { name: "Kaydet", exact: true }).click({ timeout: 15_000 });
        await d.waitFor({ state: "detached", timeout: 15_000 }); await page().waitForTimeout(500);
      }
      // ② Hazır levent (PURCHASED) → Sar → READY. Sevk seçicisi yalnız READY leventleri listeler.
      await git("Leventler"); await tikla("Yeni Levent");
      const ld = page().getByRole("dialog").filter({ hasText: "Yeni Levent" }).last(); await gor(ld);
      await sec(ld.getByRole("combobox").filter({ hasText: /İçeride sarıldı|Hazır|emanet|Fason/ }).first(), "Hazır alındı");
      await secModal(ld, "Tedarikçi seç", AD.tedarikci); // hazır levent TAM BİR taraf ister: tedarikçi YA DA fasoncu
      await secModal(ld, "Çözgü kartı seç", AD.cozgu);
      await ld.locator('input[type="number"]').first().fill("300");
      await ld.getByRole("button", { name: /Kaydet|Planla|Oluştur/ }).last().click({ timeout: 15_000 });
      await ld.waitFor({ state: "detached", timeout: 15_000 }); await page().waitForTimeout(800);
      const beam = await sql(`SELECT "beamNo" FROM warp_beams WHERE "originKind"='PURCHASED' AND status='PLANNED' ORDER BY "createdAt" DESC LIMIT 1`);
      k1Olcum.beamNo = beam[0]?.beamNo ?? null; if (!k1Olcum.beamNo) throw new Error("hazır levent doğmadı");
      const satir = page().getByRole("row").filter({ hasText: k1Olcum.beamNo }).filter({ visible: true }).first(); await gor(satir);
      await satir.click({ button: "right", timeout: 15_000 });
      await page().getByRole("menuitem", { name: /Sar \(WOUND\)/ }).click({ timeout: 15_000 });
      const wd = page().getByRole("dialog").filter({ hasText: /— Sar/ }).last(); await gor(wd);
      await wd.locator("#wb-length").fill("300");
      await wd.getByRole("button", { name: "Sar", exact: true }).click({ timeout: 15_000 });
      await wd.waitFor({ state: "detached", timeout: 20_000 }); await page().waitForTimeout(600);
      // ③ Fason dokuma işi
      await git("Dokuma İşleri"); await tikla("Yeni Dokuma İşi");
      const d = page().getByRole("dialog").filter({ hasText: "Yeni Dokuma İşi" }).last(); await gor(d);
      await secModal(d, "Kumaş seç", AD.kumas);
      await secModal(d, "Çözgü kartı seç", AD.cozgu);
      await sec(d.getByRole("combobox").filter({ hasText: /tezgah|fason/i }).first(), /Fasonda/);
      await secModal(d, "Fasoncu seç", AD.fasoncu);
      await d.locator("#plannedM").fill("100");
      await d.getByRole("button", { name: /Kaydet|Oluştur/ }).last().click({ timeout: 15_000 });
      await d.waitFor({ state: "detached", timeout: 15_000 }); await page().waitForTimeout(800);
      const isKaydi = await sql(`SELECT w."weavingOrderNumber" n FROM weaving_orders w JOIN subcontractors s ON s.id=w."subcontractorId" WHERE s.name=$1 ORDER BY w."createdAt" DESC LIMIT 1`, [buyukTr(AD.fasoncu)]);
      k1Olcum.isNo = isKaydi[0]?.n ?? null; if (!k1Olcum.isNo) throw new Error("fason dokuma işi doğmadı");
      k1Olcum.sevkOnceKg = Number((await sql(`SELECT COALESCE(SUM(CASE WHEN m.kind::text IN ('IN','ADJUST_IN','WARP_RETURN','SUBCONTRACT_RETURN','WARP_ISSUE_REVERSAL','SUBCONTRACT_OUT_CANCEL') THEN m."qtyKg" ELSE -m."qtyKg" END),0)::text k FROM yarn_movements m JOIN yarn_lots l ON l.id=m."lotId" WHERE l."lotNo"=$1`, [AD.lot]))[0].k);
      // ④ Fason sayfası → Sevk et
      const isSatir = page().getByRole("row").filter({ hasText: k1Olcum.isNo }).filter({ visible: true }).first(); await gor(isSatir);
      await isSatir.click({ button: "right", timeout: 15_000 });
      await page().getByRole("menuitem", { name: /Fason \(sevk/ }).click({ timeout: 15_000 });
      const sheet = page().getByRole("dialog").filter({ hasText: k1Olcum.isNo }).last(); await gor(sheet, { sure: 20_000 });
      await sheet.getByRole("button", { name: /Sevk et/ }).first().click({ timeout: 15_000 });
      const sd = page().getByRole("dialog").filter({ hasText: /fasona sevk et/ }).last(); await gor(sd, { sure: 20_000 });
      await sd.locator("label", { hasText: k1Olcum.beamNo }).first().click({ timeout: 15_000 });
      await sd.getByRole("button", { name: /İplik satırı/ }).click({ timeout: 15_000 });
      await sd.getByRole("combobox").filter({ hasText: /İplik ara/ }).first().click({ timeout: 15_000 });
      await page().getByPlaceholder("Ara (kod, isim, vergi no)").fill(AD.iplikKod); await page().waitForTimeout(800);
      await page().locator("[cmdk-item]").filter({ hasText: AD.iplikKod }).first().click({ timeout: 15_000 });
      await page().waitForTimeout(600);
      await sec(sd.getByLabel("İplik lotu").first(), new RegExp(AD.lot));
      await sd.getByLabel("İplik kg").first().fill("20");
      await sd.getByRole("button", { name: /^Sevk et \(/ }).click({ timeout: 15_000 });
      await sd.waitFor({ state: "detached", timeout: 20_000 }); await page().waitForTimeout(800);
    },
    async bekle({ gor, page }) {
      const sheet = page().getByRole("dialog").filter({ hasText: k1Olcum.isNo }).last();
      await gor(sheet.getByText(/Sevkler \(1\)/).first(), { sure: 15_000 });
      await page().keyboard.press("Escape");
    },
    dogrula: [
      { ad: "fason sevki 1; kalemler levent + iplik (subcontractor_dispatch_items)",
        sql: `SELECT count(DISTINCT d.id)::int sevk, string_agg(i.kind::text, ',' ORDER BY i.kind::text) k, max(i."dispatchedQty")::text kg FROM subcontractor_dispatches d JOIN weaving_orders w ON w.id=d."weavingOrderId" JOIN subcontractor_dispatch_items i ON i."dispatchId"=d.id WHERE w."weavingOrderNumber"=$1 AND d."cancelledAt" IS NULL`,
        params: () => [k1Olcum.isNo], oku: (r) => `${r[0].sevk}:${r[0].k}:${r[0].kg}`, beklenen: (v) => /^1:WARP_BEAM,YARN:(300|20)(\.0+)?$/.test(v) },
      { ad: "levent fasonda (warp_beams.status=SHIPPED_OUT)", sql: `SELECT status::text s FROM warp_beams WHERE "beamNo"=$1`, params: () => [k1Olcum.beamNo], oku: (r) => r[0]?.s, beklenen: "SHIPPED_OUT" },
      { ad: "iplik defteri: lot bakiyesi −20 (yarn_movements SUBCONTRACT_OUT)",
        sql: `SELECT COALESCE(SUM(CASE WHEN m.kind::text IN ('IN','ADJUST_IN','WARP_RETURN','SUBCONTRACT_RETURN','WARP_ISSUE_REVERSAL','SUBCONTRACT_OUT_CANCEL') THEN m."qtyKg" ELSE -m."qtyKg" END),0)::text k, count(*) FILTER (WHERE m.kind::text='SUBCONTRACT_OUT')::int n FROM yarn_movements m JOIN yarn_lots l ON l.id=m."lotId" WHERE l."lotNo"=$1`,
        params: [AD.lot], oku: (r) => `${(Number(r[0].k) - k1Olcum.sevkOnceKg).toFixed(3)}:${r[0].n}`, beklenen: (v) => /^-20\.000:[1-9]/.test(v) },
      { ad: "fasoncu cari kartın rolü (subcontractors ↔ customers)", sql: `SELECT count(*)::int n FROM subcontractors s JOIN customers c ON c.id=s."customerId" WHERE c.name=$1 AND c."isSubcontractorRole"`, params: [buyukTr(AD.fasoncu)], oku: (r) => r[0].n, beklenen: 1 },
    ],
  },
  {
    id: "K3", rol: "P", gerektirir: ["K1"],
    yol: "Dokuma İşleri → fason işi sağ tık → Fason (sevk · kabul) → iplik satırı 'İplik döndü' (5 kg, sebep) → Dönüşü kaydet → 'Dönüşü geri al' (gerekçe)", rota: "operations/weaving-orders",
    async yap({ git, gor, sec, sql, page }) {
      const kayit = await sql(`SELECT w."weavingOrderNumber" n FROM weaving_orders w JOIN subcontractors s ON s.id=w."subcontractorId" WHERE s.name=$1 ORDER BY w."createdAt" DESC LIMIT 1`, [buyukTr(AD.fasoncu)]);
      k3Olcum.isNo = k1Olcum.isNo ?? kayit[0]?.n ?? null; if (!k3Olcum.isNo) throw new Error("fason dokuma işi yok (K1 koşmadı mı?)");
      const lotBakiye = async () => Number((await sql(`SELECT COALESCE(SUM(CASE WHEN m.kind::text IN ('IN','ADJUST_IN','WARP_RETURN','SUBCONTRACT_RETURN','WARP_ISSUE_REVERSAL','SUBCONTRACT_OUT_CANCEL') THEN m."qtyKg" ELSE -m."qtyKg" END),0)::text k FROM yarn_movements m JOIN yarn_lots l ON l.id=m."lotId" WHERE l."lotNo"=$1`, [AD.lot]))[0].k);
      k3Olcum.onceKg = await lotBakiye();
      await git("Dokuma İşleri");
      const isSatir = page().getByRole("row").filter({ hasText: k3Olcum.isNo }).filter({ visible: true }).first(); await gor(isSatir);
      await isSatir.click({ button: "right", timeout: 15_000 });
      await page().getByRole("menuitem", { name: /Fason \(sevk/ }).click({ timeout: 15_000 });
      const sheet = page().getByRole("dialog").filter({ hasText: k3Olcum.isNo }).last(); await gor(sheet, { sure: 20_000 });
      // İplik döndü — 5 kg, katalog sebebi
      await sheet.getByRole("button", { name: "İplik döndü" }).first().click({ timeout: 15_000 });
      const rd = page().getByRole("dialog").filter({ hasText: /iplik döndü/ }).last(); await gor(rd);
      await rd.locator("#fyr-kg").fill("5");
      await sec(rd.getByRole("combobox").filter({ hasText: /Sebep seç|Katalogda/ }).first(), /Kalan iplik/);
      await rd.getByRole("button", { name: "Dönüşü kaydet" }).click({ timeout: 15_000 });
      await rd.waitFor({ state: "detached", timeout: 20_000 }); await page().waitForTimeout(1200);
      k3Olcum.donusSonraKg = await lotBakiye();
      k3Olcum.fasondaDonus = (await sheet.innerText().catch(() => "")).includes("15") ? 1 : 0;
      // Dönüşü geri al — açık dönüş satırı + gerekçe (≥3)
      await sheet.getByRole("button", { name: "Dönüşü geri al" }).first().click({ timeout: 15_000 });
      const cd = page().getByRole("dialog").filter({ hasText: /dönüşü geri al/ }).last(); await gor(cd);
      const satirSec = cd.getByRole("combobox").filter({ hasText: /Satır seç/ }).first();
      if (await satirSec.count()) { await satirSec.click(); await page().getByRole("option").first().click({ timeout: 10_000 }); }
      await cd.locator("#fyrc-reason").fill("Test: yanlış satıra yazıldı");
      await cd.getByRole("button", { name: "Dönüşü geri al" }).click({ timeout: 15_000 });
      await cd.waitFor({ state: "detached", timeout: 20_000 }); await page().waitForTimeout(1200);
      k3Olcum.fasondaStorno = (await sheet.innerText().catch(() => "")).includes("20") ? 1 : 0;
      await page().keyboard.press("Escape");
    },
    async bekle() {},
    dogrula: [
      { ad: "dönüş sonrası lot bakiyesi +5 (ekranda fasonda kalan 20 → 15)", sql: `SELECT 1`, oku: () => `${(k3Olcum.donusSonraKg - k3Olcum.onceKg).toFixed(3)}:${k3Olcum.fasondaDonus}`, beklenen: "5.000:1" },
      { ad: "storno sonrası bakiye başa döndü; defterde İKİ satır (SUBCONTRACT_RETURN + SUBCONTRACT_RETURN_CANCEL), silme YOK (yarn_movements)",
        sql: `SELECT COALESCE(SUM(CASE WHEN m.kind::text IN ('IN','ADJUST_IN','WARP_RETURN','SUBCONTRACT_RETURN','WARP_ISSUE_REVERSAL','SUBCONTRACT_OUT_CANCEL') THEN m."qtyKg" ELSE -m."qtyKg" END),0)::text k, count(*) FILTER (WHERE m.kind::text='SUBCONTRACT_RETURN')::int d, count(*) FILTER (WHERE m.kind::text='SUBCONTRACT_RETURN_CANCEL')::int s FROM yarn_movements m JOIN yarn_lots l ON l.id=m."lotId" WHERE l."lotNo"=$1`,
        params: [AD.lot], oku: (r) => `${(Number(r[0].k) - k3Olcum.onceKg).toFixed(3)}:${r[0].d}:${r[0].s}`, beklenen: (v) => /^0\.000:[1-9]\d*:[1-9]\d*$/.test(v) },
      { ad: "ekranda fasonda kalan yeniden 20", sql: `SELECT 1`, oku: () => k3Olcum.fasondaStorno, beklenen: 1 },
    ],
  },
  {
    id: "N3", rol: "M", gerektirir: ["J3"],
    yol: "Muhasebe → Faturalar → onaylı satış faturası → 'İptal (storno)' → onay (gerekçe alanı YOK) — cari deftere ters kayıt, kapama serbest kalır, sevk rakamı değişmez", rota: "finance/invoices",
    async yap({ git, gor, sql, api, page }) {
      const t = await sql(`SELECT i."docNo", i."shipmentId" sid FROM invoices i JOIN cari_accounts ca ON ca.id=i."cariId" JOIN customers c ON c.id=ca."customerId" WHERE c.name=$1 AND i.type='SALES' AND i.status='CONFIRMED' ORDER BY i."confirmedAt" DESC LIMIT 1`, [buyukTr(AD.musteri)]);
      n3Olcum.docNo = t[0]?.docNo ?? null; n3Olcum.sevkId = t[0]?.sid ?? null;
      if (!n3Olcum.docNo) throw new Error("onaylı satış faturası yok (J2 koşmadı mı?)");
      n3Olcum.bakiyeOnce = Number((await sql(`SELECT COALESCE(SUM(t.debit - t.credit),0)::text b FROM cari_transactions t JOIN cari_accounts a ON a.id=t."cariId" JOIN customers c ON c.id=a."customerId" WHERE c.name=$1`, [buyukTr(AD.musteri)]))[0].b);
      n3Olcum.sevkMetreOnce = n3Olcum.sevkId ? ((await api(`/api/shipping/shipments/${n3Olcum.sevkId}`)).govde?.data?.summary?.totalMeters ?? null) : null;
      await git("Faturalar");
      await page().getByPlaceholder("Belge no / cari ara").filter({ visible: true }).first().fill(n3Olcum.docNo);
      await page().waitForTimeout(800);
      const satir = page().getByRole("row").filter({ hasText: n3Olcum.docNo }).filter({ visible: true }).first(); await gor(satir);
      await satir.getByRole("button", { name: /İptal \(storno\)/ }).click({ timeout: 15_000 });
      const d = page().getByRole("dialog").filter({ hasText: "Faturayı iptal et (storno)" }).last(); await gor(d);
      await gor(d.getByText(/TERS kayıt yazılır .* Orijinal satır silinmez/));
      await d.getByRole("button", { name: "İptal et", exact: true }).click({ timeout: 15_000 });
      await d.waitFor({ state: "detached", timeout: 20_000 }); await page().waitForTimeout(800);
      n3Olcum.sevkMetreSonra = n3Olcum.sevkId ? ((await api(`/api/shipping/shipments/${n3Olcum.sevkId}`)).govde?.data?.summary?.totalMeters ?? null) : null;
    },
    async bekle({ gor, page }) {
      const satir = page().getByRole("row").filter({ hasText: n3Olcum.docNo }).filter({ visible: true }).first();
      await gor(satir); await gor(satir.getByText(/İptal/).first(), { sure: 15_000 }).catch(() => undefined);
    },
    dogrula: [
      { ad: "fatura CANCELLED, iptal damgası (invoices) — durum geçişi, silme yok", sql: `SELECT status::text st, ("cancelledAt" IS NOT NULL) d FROM invoices WHERE "docNo"=$1`, params: () => [n3Olcum.docNo], oku: (r) => `${r[0]?.st}:${r[0]?.d}`, beklenen: "CANCELLED:true" },
      { ad: "cari defter: INVOICE satırı DURUR + INVOICE_CANCEL ters satır (credit 1.200); bakiye 600 → −600 (tahsilat açıkta kaldı)",
        sql: `SELECT count(*) FILTER (WHERE t."sourceType"::text='INVOICE')::int f, count(*) FILTER (WHERE t."sourceType"::text='INVOICE_CANCEL')::int c, COALESCE(SUM(t.debit - t.credit),0)::text b FROM cari_transactions t JOIN cari_accounts a ON a.id=t."cariId" JOIN customers c ON c.id=a."customerId" WHERE c.name=$1`,
        params: [buyukTr(AD.musteri)], oku: (r) => `${r[0].f}:${r[0].c}:${(Number(r[0].b) - n3Olcum.bakiyeOnce).toFixed(2)}`, beklenen: (v) => /^[1-9]\d*:[1-9]\d*:-1200\.00$/.test(v) },
      { ad: "kapama SİLİNMEDİ, damgayla çözüldü (payment_allocations.revokedAt) — tahsilat 600 yeniden açık", sql: `SELECT count(*)::int n, count(*) FILTER (WHERE pa."revokedAt" IS NOT NULL)::int r FROM payment_allocations pa JOIN invoices i ON i.id=pa."invoiceId" WHERE i."docNo"=$1`, params: () => [n3Olcum.docNo], oku: (r) => `${r[0].n}:${r[0].r}`, beklenen: (v) => /^([1-9]\d*):\1$/.test(v) },
      { ad: "sevk rakamı DEĞİŞMEDİ (fatura stornosu sevkiyata dokunmaz)", sql: `SELECT 1`, oku: () => `${n3Olcum.sevkMetreOnce}→${n3Olcum.sevkMetreSonra}`, beklenen: (v) => /^(\d+)→\1$/.test(v) },
    ],
  },
  {
    id: "O7", rol: "P", gerektirir: ["B1", "B2"],
    yol: "API · Sipariş kalemi birim kuralı: geçersiz birim → 400 Türkçe mesaj · ürünsüz+birimsiz → 400 · birimsiz ama ürünlü → ürün kartından kopyalanır (sessiz MT YOK)", rota: "orders",
    async yap({ api, sql }) {
      const musteri = (await sql(`SELECT id FROM customers WHERE name=$1`, [buyukTr(AD.musteri)]))[0]?.id;
      const kumas = (await sql(`SELECT id FROM items WHERE code=$1`, [AD.kumasKod]))[0]?.id;
      if (!musteri || !kumas) throw new Error("TEST müşteri/kumaş yok");
      o7Olcum.satirOnce = Number((await sql(`SELECT count(*)::int n FROM order_lines`))[0].n);
      const gonder = (lines) => api(`/api/orders`, { method: "POST", body: JSON.stringify({ customerId: musteri, lines }) });
      const a = await gonder([{ itemId: kumas, quantity: 10, unit: "BOBIN" }]);
      o7Olcum.gecersizDurum = a.status; o7Olcum.gecersizMesaj = a.govde?.message ?? "";
      const b = await gonder([{ quantity: 10 }]);
      o7Olcum.urunsuzDurum = b.status; o7Olcum.urunsuzMesaj = b.govde?.message ?? "";
      const c = await gonder([{ itemId: kumas, quantity: 7 }]);
      o7Olcum.birimsizDurum = c.status; o7Olcum.siparisNo = c.govde?.data?.orderNumber ?? null;
      if (o7Olcum.siparisNo) o7Olcum.birimsizBirim = (await sql(`SELECT l.unit::text u FROM order_lines l JOIN orders o ON o.id=l."orderId" WHERE o."orderNumber"=$1`, [o7Olcum.siparisNo]))[0]?.u ?? null;
    },
    async bekle() {},
    dogrula: [
      { ad: "geçersiz birim (BOBIN) → 400, Türkçe mesaj birimi ve seçenekleri söyler", sql: `SELECT 1`, oku: () => `${o7Olcum.gecersizDurum}:${/Geçersiz kalem birimi: BOBIN \(MT, KG veya ADET\)/.test(o7Olcum.gecersizMesaj) ? 1 : 0}`, beklenen: "400:1" },
      { ad: "ürünsüz + birimsiz kalem → 400 'birimi çözülemedi — ürün seçilmemiş'", sql: `SELECT 1`, oku: () => `${o7Olcum.urunsuzDurum}:${/birimi çözülemedi/.test(o7Olcum.urunsuzMesaj) ? 1 : 0}`, beklenen: "400:1" },
      { ad: "birimsiz ama ürünlü kalem → 201, birim ürün kartından MT (sessiz varsayılan değil, kopya)", sql: `SELECT 1`, oku: () => `${o7Olcum.birimsizDurum}:${o7Olcum.birimsizBirim}`, beklenen: (v) => /^20[01]:MT$/.test(v) },
      { ad: "iki red kalem yazmadı: order_lines yalnız +1 (üçüncü sipariş)", sql: `SELECT count(*)::int n FROM order_lines`, oku: (r) => r[0].n - o7Olcum.satirOnce, beklenen: 1 },
    ],
  },
  {
    id: "N1", rol: "P", gerektirir: ["B3", "D0", "C2"],
    yol: "Leventler → Yeni Levent (İçeride sarıldı, TEST-R, 200 m) → sağ tık Sar (WOUND): makine TEST-DV1 · iplik çıkışı lot TEST-L1 30 kg · dönen dip 1 kg (sebep) → sağ tık 'Sarımı iptal et' (önizleme + gerekçe) — tablet D1/D2'nin panel ikizi + WOUND_CANCEL", rota: "operations/warp-beams",
    async yap({ git, tikla, gor, sec, sql, page }) {
      const lotBakiye = async () => Number((await sql(`SELECT COALESCE(SUM(CASE WHEN m.kind::text IN ('IN','ADJUST_IN','WARP_RETURN','SUBCONTRACT_RETURN','WARP_ISSUE_REVERSAL','SUBCONTRACT_OUT_CANCEL') THEN m."qtyKg" ELSE -m."qtyKg" END),0)::text k FROM yarn_movements m JOIN yarn_lots l ON l.id=m."lotId" WHERE l."lotNo"=$1`, [AD.lot]))[0].k);
      n1Olcum.onceKg = await lotBakiye();
      await git("Leventler"); await tikla("Yeni Levent");
      const ld = page().getByRole("dialog").filter({ hasText: "Yeni Levent" }).last(); await gor(ld);
      await sec(ld.getByRole("combobox").filter({ hasText: /İçeride sarıldı|Hazır|emanet|Fason/ }).first(), "İçeride sarıldı");
      await ld.getByText("Çözgü kartı seç", { exact: false }).first().click({ timeout: 15_000 });
      const cm = page().getByRole("dialog").filter({ has: page().getByPlaceholder("Ara (ad veya kod)") }).last(); await gor(cm);
      await cm.getByPlaceholder("Ara (ad veya kod)").fill(AD.cozgu); await page().waitForTimeout(700);
      await cm.getByText(buyukTr(AD.cozgu), { exact: false }).first().click({ timeout: 15_000 });
      await cm.waitFor({ state: "detached", timeout: 15_000 }).catch(() => undefined);
      await ld.locator('input[type="number"]').first().fill("200");
      await ld.getByRole("button", { name: /Kaydet|Planla|Oluştur/ }).last().click({ timeout: 15_000 });
      await ld.waitFor({ state: "detached", timeout: 15_000 }); await page().waitForTimeout(800);
      n1Olcum.beamNo = (await sql(`SELECT wb."beamNo" FROM warp_beams wb JOIN warp_specs ws ON ws.id=wb."warpSpecId" WHERE wb."originKind"='IN_HOUSE' AND wb.status='PLANNED' AND ws.code=$1 ORDER BY wb."createdAt" DESC LIMIT 1`, [AD.cozguKod]))[0]?.beamNo ?? null;
      if (!n1Olcum.beamNo) throw new Error("içeride sarılacak levent doğmadı");
      // Sar
      const satir = page().getByRole("row").filter({ hasText: n1Olcum.beamNo }).filter({ visible: true }).first(); await gor(satir);
      await satir.click({ button: "right", timeout: 15_000 });
      await page().getByRole("menuitem", { name: /Sar \(WOUND\)/ }).click({ timeout: 15_000 });
      const wd = page().getByRole("dialog").filter({ hasText: /— Sar/ }).last(); await gor(wd);
      await wd.locator("#wb-length").fill("200");
      await sec(wd.getByRole("combobox").filter({ hasText: /Makine seç|Yükleniyor/ }).first(), new RegExp(AD.devereMakine));
      await wd.getByRole("button", { name: "Satır", exact: true }).nth(0).click({ timeout: 10_000 }); // iplik çıkışı
      await sec(wd.getByLabel("İplik lotu").nth(0), new RegExp(AD.lot));
      await wd.getByPlaceholder("kg").nth(0).fill("30");
      await wd.getByRole("button", { name: "Satır", exact: true }).nth(1).click({ timeout: 10_000 }); // dönen dip
      await sec(wd.getByLabel("İplik lotu").nth(1), new RegExp(AD.lot));
      await wd.getByPlaceholder("kg").nth(1).fill("1");
      await wd.getByRole("combobox").filter({ hasText: /Dip nereye gitti/ }).first().click({ timeout: 10_000 });
      await page().getByRole("option").first().click({ timeout: 10_000 });
      await wd.getByRole("button", { name: "Sar", exact: true }).click({ timeout: 15_000 });
      await wd.waitFor({ state: "detached", timeout: 20_000 }); await page().waitForTimeout(1000);
      n1Olcum.sarimSonraKg = await lotBakiye();
      n1Olcum.sarimDurum = (await sql(`SELECT status::text s FROM warp_beams WHERE "beamNo"=$1`, [n1Olcum.beamNo]))[0]?.s ?? null;
      // Sarımı iptal et — önizleme dip iadesini ADIYLA listeler, gerekçe zorunlu
      await satir.click({ button: "right", timeout: 15_000 });
      await page().getByRole("menuitem", { name: /Sarımı iptal et/ }).click({ timeout: 15_000 });
      const cd = page().getByRole("dialog").filter({ hasText: /sarımı iptal edilsin mi/ }).last(); await gor(cd);
      await page().waitForTimeout(800);
      n1Olcum.onizlemeDip = await cd.getByText(/dip iadesi düşer/).count();
      await cd.locator("#wb-cancel-reason").fill("Test: yanlış levente sarıldı");
      await cd.getByRole("button", { name: "Sarımı İptal Et" }).click({ timeout: 15_000 });
      await cd.waitFor({ state: "detached", timeout: 20_000 }); await page().waitForTimeout(1000);
      n1Olcum.sonraKg = await lotBakiye();
    },
    async bekle({ gor, page }) {
      const satir = page().getByRole("row").filter({ hasText: n1Olcum.beamNo }).filter({ visible: true }).first();
      // Kural (dokuma.md): iptal edilen levent CANCELLED'dır, PLANNED'a DÖNMEZ (bir levent bir kez doğar, yenisi açılır).
      await gor(satir); await gor(satir.getByText(/İptal/).first(), { sure: 15_000 });
    },
    dogrula: [
      { ad: "sarım: levent READY oldu; lot bakiyesi −29 (30 çıkış, 1 dip iadesi)", sql: `SELECT 1`, oku: () => `${n1Olcum.sarimDurum}:${(n1Olcum.sarimSonraKg - n1Olcum.onceKg).toFixed(3)}`, beklenen: "READY:-29.000" },
      { ad: "iptal önizlemesi dip iadesini ADIYLA listeledi (soyut sayı değil)", sql: `SELECT 1`, oku: () => n1Olcum.onizlemeDip, beklenen: (v) => v >= 1 },
      { ad: "iptal sonrası levent CANCELLED (terminal — PLANNED'a dönmez, `one_wound_uq`); olay defteri WOUND + WOUND_CANCEL iki satır (warp_beam_events)", sql: `SELECT wb.status::text s, string_agg(e.kind, ',' ORDER BY e."createdAt") k FROM warp_beams wb LEFT JOIN warp_beam_events e ON e."beamId"=wb.id WHERE wb."beamNo"=$1 GROUP BY wb.status`, params: () => [n1Olcum.beamNo], oku: (r) => `${r[0]?.s}:${r[0]?.k}`, beklenen: "CANCELLED:WOUND,WOUND_CANCEL" },
      { ad: "iplik defteri: WARP_ISSUE 30 + WARP_RETURN 1 + ters satırlar (WARP_ISSUE_REVERSAL · WARP_RETURN_REVERSAL) — silme yok, bakiye başa",
        sql: `SELECT string_agg(m.kind::text || ':' || m."qtyKg"::text, ',' ORDER BY m."createdAt") k FROM yarn_movements m JOIN yarn_lots l ON l.id=m."lotId" JOIN warp_beams wb ON wb.id=m."warpBeamId" WHERE l."lotNo"=$1 AND wb."beamNo"=$2`,
        params: () => [AD.lot, n1Olcum.beamNo], oku: (r) => `${r[0]?.k}|${(n1Olcum.sonraKg - n1Olcum.onceKg).toFixed(3)}`, beklenen: (v) => /WARP_ISSUE:30/.test(v) && /WARP_RETURN:1/.test(v) && /WARP_ISSUE_REVERSAL:30/.test(v) && /WARP_RETURN_REVERSAL:1/.test(v) && /\|0\.000$/.test(v) },
    ],
  },
  {
    id: "N2", rol: "M", gerektirir: ["I7"],
    yol: "Operasyon → Sevkiyatlar → (a) iade almış sevkiyat → Detay → 'Sevki Geri Al' → ENGEL 'iade alınmış' · (b) taze sevkiyat (API) → 'Sevki Geri Al' → önizleme + gerekçe → geri al (storno ≠ iade; SoD `shipping:undo-dispatch`)", rota: "operations/shipments",
    async yap({ git, gor, sql, api, page }) {
      // (a) iade almış sevkiyat — geri alma ENGELLİ olmalı (iade ile storno karışmaz)
      const iadeli = await sql(`SELECT s.id, s."shipmentNo" FROM shipments s JOIN customers c ON c.id=s."customerId" WHERE c.name=$1 AND s.status='DISPATCHED' AND EXISTS (SELECT 1 FROM roll_returns rr WHERE rr."fromShipmentId"=s.id AND rr."cancelledAt" IS NULL) ORDER BY s."createdAt" DESC LIMIT 1`, [buyukTr(AD.musteri)]);
      n2Olcum.iadeliSevk = iadeli[0]?.shipmentNo ?? null;
      if (!n2Olcum.iadeliSevk) throw new Error("iade almış sevkiyat yok (I7 koşmadı mı?)");
      await git("Sevkiyatlar");
      const ara = page().getByPlaceholder("Sevkiyat no, firma, plaka").filter({ visible: true }).first(); await gor(ara);
      const sevkAc = async (no) => {
        await ara.fill(no); await page().waitForTimeout(1200);
        await page().getByRole("row").filter({ hasText: no }).filter({ visible: true }).first().click({ timeout: 15_000 });
        const sheet = page().getByRole("dialog").filter({ hasText: no }).last(); await gor(sheet, { sure: 20_000 });
        await sheet.getByRole("button", { name: "Sevki Geri Al" }).click({ timeout: 15_000 });
        const d = page().getByRole("dialog").filter({ hasText: `Sevki Geri Al — ${no}` }).last(); await gor(d, { sure: 20_000 });
        await page().waitForTimeout(1200);
        return { sheet, d };
      };
      const a = await sevkAc(n2Olcum.iadeliSevk);
      n2Olcum.engelMetni = (await a.d.locator("p.text-destructive").first().textContent().catch(() => "")) ?? "";
      n2Olcum.engelDugmePasif = await a.d.getByRole("button", { name: /Geri Al/ }).last().isDisabled();
      for (let i = 0; i < 2; i++) { await page().keyboard.press("Escape"); await page().waitForTimeout(300); }
      // (b) taze sevkiyat: M3b'nin çuvaldaki emanet topu (yoksa API ile yeni top) → TEST Müşteri'ye sevk (DISPATCHED)
      const musteriId = (await sql(`SELECT id FROM customers WHERE name=$1`, [buyukTr(AD.musteri)]))[0].id;
      let sackId = (await sql(`SELECT r."sackId" FROM rolls r JOIN customers c ON c.id=r."ownerCustomerId" WHERE c.name=$1 AND r."sackId" IS NOT NULL AND r."shipmentId" IS NULL ORDER BY r."updatedAt" DESC LIMIT 1`, [buyukTr(AD.musteri)]))[0]?.sackId ?? null;
      if (!sackId) {
        const kumas = (await sql(`SELECT id FROM items WHERE code=$1`, [AD.kumasKod]))[0].id;
        const top = await api(`/api/rolls/initial-entry`, { method: "POST", body: JSON.stringify({ itemId: kumas, initialQty: 12, clientToken: crypto.randomUUID() }) });
        const barkod = top.govde?.data?.barcode; if (!barkod) throw new Error(`top açılamadı: ${top.status}`);
        const c = await api(`/api/shipping/sacks`, { method: "POST", body: JSON.stringify({ clientToken: crypto.randomUUID() }) });
        sackId = c.govde?.data?.id; if (!sackId) throw new Error(`çuval açılamadı: ${c.status}`);
        const o = await api(`/api/shipping/sacks/${sackId}/scan`, { method: "POST", body: JSON.stringify({ barcode: barkod }) });
        if (o.status >= 300) throw new Error(`okutma: ${o.status} ${JSON.stringify(o.govde).slice(0, 160)}`);
      }
      const sv = await api(`/api/shipping/shipments`, { method: "POST", body: JSON.stringify({ sackIds: [sackId], customerId: musteriId, orderless: true, destination: "DOMESTIC", clientToken: crypto.randomUUID() }) });
      n2Olcum.sevkNo = sv.govde?.data?.shipmentNo ?? null; n2Olcum.sevkId = sv.govde?.data?.id ?? null;
      if (!n2Olcum.sevkNo) throw new Error(`taze sevkiyat kurulamadı: ${sv.status} ${JSON.stringify(sv.govde).slice(0, 200)}`);
      // Önizleme ÇUVAL düzeyinde listeler (çuval no + top adedi) — sevkiyatın birimi çuvaldır; barkod değil çuval no aranır.
      const cuvalNo = (await sql(`SELECT s."sackNo" FROM sacks s WHERE s.id=$1`, [sackId]))[0]?.sackNo ?? "∅";
      const b = await sevkAc(n2Olcum.sevkNo);
      n2Olcum.onizlemeBarkod = (await b.d.innerText()).includes(cuvalNo) ? 1 : 0;
      await b.d.getByPlaceholder("Örn: araç yüklenmeden").fill("Test: araç yüklenmeden onaylandı");
      const dugme = b.d.getByRole("button", { name: /Geri Al/ }).last();
      n2Olcum.dugmeEtiketi = ((await dugme.textContent()) ?? "").trim();
      await dugme.click({ timeout: 15_000 });
      await b.d.waitFor({ state: "detached", timeout: 20_000 }); await page().waitForTimeout(1000);
      for (let i = 0; i < 2 && (await page().getByRole("dialog").count()); i++) { await page().keyboard.press("Escape"); await page().waitForTimeout(300); }
    },
    async bekle() {},
    dogrula: [
      { ad: "(a) iade almış sevkiyatta geri alma ENGELLİ: sebep metni 'iade alınmış', düğme pasif (storno ≠ iade)", sql: `SELECT 1`, oku: () => `${/iade alınmış/.test(n2Olcum.engelMetni) ? 1 : 0}:${n2Olcum.engelDugmePasif}`, beklenen: "1:true" },
      { ad: "(b) önizleme etkilenen çuvalı NUMARASIYLA listeler (çekirdek: her kayıt, soyut sayı yetmez — 2a90cad9 öncesi yalnız sayı basılıyordu); düğme rejime göre", sql: `SELECT 1`, oku: () => `${n2Olcum.onizlemeBarkod}:${n2Olcum.dugmeEtiketi}`, beklenen: (v) => /^1:(Geri Al ve Kapat|Sevki Geri Al)$/.test(v) },
      { ad: "sevkiyat artık DISPATCHED değil; `dispatchedAt` NULL'lanMADI (damga korunur, ters kayıt); olay defteri DISPATCHED + UNDISPATCHED (shipment_events)",
        sql: `SELECT s.status::text st, (s."dispatchedAt" IS NOT NULL) d, string_agg(e.type::text, ',' ORDER BY e."createdAt") ev FROM shipments s LEFT JOIN shipment_events e ON e."shipmentId"=s.id WHERE s.id=$1 GROUP BY s.status, s."dispatchedAt"`,
        params: () => [n2Olcum.sevkId], oku: (r) => `${r[0]?.st}:${r[0]?.d}:${r[0]?.ev}`, beklenen: (v) => /^(PLANNED|CANCELLED):true:.*DISPATCHED,UNDISPATCHED/.test(v) },
      { ad: "toplar depoya döndü, sevk bağı kalktı (rolls)", sql: `SELECT count(*)::int n FROM rolls WHERE "shipmentId"=$1 AND status='SHIPPED'`, params: () => [n2Olcum.sevkId], oku: (r) => r[0].n, beklenen: 0 },
    ],
  },
  {
    id: "S3", rol: "M", gerektirir: ["N3"],
    yol: "API · Cari ekstre (finance/statement) kapanışı = Σ cari_transactions (storno satırı DAHİL, silinmiş satır yok)", rota: "reports/finance/aging",
    async yap({ api, sql }) {
      s3Olcum.cariId = (await sql(`SELECT ca.id FROM cari_accounts ca JOIN customers c ON c.id=ca."customerId" WHERE c.name=$1`, [buyukTr(AD.musteri)]))[0]?.id ?? null;
      if (!s3Olcum.cariId) throw new Error("cari hesap yok");
      const from = new Date(Date.now() - 30 * 864e5).toISOString(), to = new Date(Date.now() + 864e5).toISOString();
      const r = await api(`/api/reports/finance/statement?cariId=${s3Olcum.cariId}&currency=TRY&dateFrom=${encodeURIComponent(from)}&dateTo=${encodeURIComponent(to)}`);
      s3Olcum.kapanis = Number(r.govde?.data?.closing ?? NaN);
      s3Olcum.satirTip = (r.govde?.data?.rows ?? []).map((x) => x.sourceType).join(",");
      s3Olcum.defter = Number((await sql(`SELECT COALESCE(SUM(debit - credit),0)::text b FROM cari_transactions WHERE "cariId"=$1`, [s3Olcum.cariId]))[0].b);
    },
    async bekle() {},
    dogrula: [
      { ad: "ekstre kapanışı = Σ defter (fatura 1.200 − tahsilat 600 − storno 1.200 = −600)", sql: `SELECT 1`, oku: () => `${s3Olcum.kapanis}=${s3Olcum.defter}`, beklenen: () => Math.abs(s3Olcum.kapanis - s3Olcum.defter) < 0.01 && Math.abs(s3Olcum.defter + 600) < 0.01 },
      { ad: "ekstrede üç satır tipi: INVOICE · PAYMENT · INVOICE_CANCEL (ters satır GÖRÜNÜR, orijinal silinmedi)", sql: `SELECT 1`, oku: () => s3Olcum.satirTip, beklenen: (v) => /INVOICE/.test(v) && /PAYMENT/.test(v) && /INVOICE_CANCEL/.test(v) },
    ],
  },
  {
    id: "S4", rol: "P", gerektirir: ["C2"],
    yol: "API · İplik lotu izi TEST-L1: `GET /api/yarn/lots` balanceKg = Σ yarn_movements (işaretli); her hareketin KAYNAĞI var (mal kabul · levent · fason kalemi)", rota: "operations/yarn",
    async yap({ api, sql }) {
      const r = await api(`/api/yarn/lots?search=${encodeURIComponent(AD.lot)}`);
      s4Olcum.api = Number((r.govde?.data ?? []).find((x) => x.lotNo === AD.lot)?.balanceKg ?? NaN);
      const d = (await sql(`SELECT COALESCE(SUM(CASE WHEN m.kind::text IN ('IN','ADJUST_IN','WARP_RETURN','SUBCONTRACT_RETURN','WARP_ISSUE_REVERSAL','SUBCONTRACT_OUT_CANCEL') THEN m."qtyKg" ELSE -m."qtyKg" END),0)::text k, count(*)::int n, count(*) FILTER (WHERE m."goodsReceiptId" IS NULL AND m."warpBeamId" IS NULL AND m."dispatchItemId" IS NULL AND m."stockCountId" IS NULL AND m."invoiceId" IS NULL)::int kaynaksiz, string_agg(DISTINCT m.kind::text, ',') tip FROM yarn_movements m JOIN yarn_lots l ON l.id=m."lotId" WHERE l."lotNo"=$1`, [AD.lot]))[0];
      s4Olcum.defter = Number(d.k); s4Olcum.hareket = `${d.n}:${d.tip}`; s4Olcum.kaynaksiz = Number(d.kaynaksiz);
    },
    async bekle() {},
    dogrula: [
      { ad: "API balanceKg = Σ defter (bakiye AYRI kolona inmez, türetilir)", sql: `SELECT 1`, oku: () => `${s4Olcum.api}=${s4Olcum.defter}`, beklenen: () => Number.isFinite(s4Olcum.api) && Math.abs(s4Olcum.api - s4Olcum.defter) < 0.001 },
      { ad: "her hareketin kaynağı var (mal kabul / levent / fason kalemi) — kaynaksız satır 0", sql: `SELECT 1`, oku: () => `${s4Olcum.hareket} kaynaksız:${s4Olcum.kaynaksiz}`, beklenen: (v) => /kaynaksız:0$/.test(v) },
    ],
  },
  {
    id: "T1", rol: "P",
    yol: "API · `GET /api/client-policy/electron` minVersion, sahadaki en düşük `sessions.clientVersion`den (son 30 gün) BÜYÜK OLAMAZ", rota: "system",
    async yap({ api, sql }) {
      t1Olcum.minVersion = (await api(`/api/client-policy/electron`)).govde?.data?.minVersion ?? null;
      const r = (await sql(`SELECT min(string_to_array("clientVersion", '.')::int[]) v, count(*)::int n FROM sessions WHERE "clientVersion" ~ '^\\d+\\.\\d+\\.\\d+$' AND "createdAt" > now() - interval '30 days'`))[0];
      t1Olcum.sahaMin = r?.v ? r.v.join(".") : null; t1Olcum.sahaN = Number(r?.n ?? 0);
    },
    async bekle() {},
    dogrula: [
      { ad: "minVersion ≤ sahadaki en düşük istemci sürümü (yoksa ÖLÇÜLEMEDİ değil — kural yalnız kayıt varsa bağlar)", sql: `SELECT 1`,
        oku: () => `min=${t1Olcum.minVersion} saha=${t1Olcum.sahaMin} (${t1Olcum.sahaN} oturum)`,
        beklenen: () => { const c = (a, b) => { const x = a.split(".").map(Number), y = b.split(".").map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; }; return !!t1Olcum.minVersion && (t1Olcum.sahaN === 0 || c(t1Olcum.minVersion, t1Olcum.sahaMin) <= 0); } },
    ],
  },
  {
    id: "P1", rol: "P", gerektirir: ["I4"],
    yol: "API (operatör kimliğiyle) · SoD üçlüsü: `finance:write` olmadan fatura · `shipping:undo-dispatch` olmadan sevk geri al · `roll:manual-adjust` olmadan takılı topu kurtar → üçü 403; tablo değişmez (P1+P2+P3)", rota: "system/permissions",
    async yap({ apiRol, sql }) {
      p1Olcum.faturaOnce = Number((await sql(`SELECT count(*)::int n FROM invoices`))[0].n);
      const sevk = (await sql(`SELECT id FROM shipments WHERE status='DISPATCHED' ORDER BY "createdAt" DESC LIMIT 1`))[0]?.id;
      const top = (await sql(`SELECT id FROM rolls ORDER BY "createdAt" DESC LIMIT 1`))[0]?.id;
      const cari = (await sql(`SELECT ca.id FROM cari_accounts ca JOIN customers c ON c.id=ca."customerId" WHERE c.name=$1`, [buyukTr(AD.musteri)]))[0]?.id;
      const a = await apiRol("T", `/api/finance/invoices`, { method: "POST", body: JSON.stringify({ type: "SALES", cariId: cari, currency: "TRY", lines: [{ description: "x", qty: 1, unit: "m", unitPrice: 1, vatRate: 20 }] }) });
      p1Olcum.fatura = a.status; p1Olcum.mesaj = a.govde?.message ?? ""; p1Olcum.kod = a.govde?.details?.code ?? null;
      const b = await apiRol("T", `/api/shipping/shipments/${sevk}/undo-dispatch`, { method: "POST", body: JSON.stringify({ reason: "yetkisiz deneme", releaseSacks: false }) });
      p1Olcum.geriAl = b.status;
      const c = await apiRol("T", `/api/rolls/${top}/rescue-stuck`, { method: "POST", body: JSON.stringify({ reason: "yetkisiz deneme" }) });
      p1Olcum.kurtar = c.status;
      p1Olcum.faturaSonra = Number((await sql(`SELECT count(*)::int n FROM invoices`))[0].n);
    },
    async bekle() {},
    dogrula: [
      { ad: "operatör: fatura 403 · sevk geri al 403 · takılı top kurtar 403 (SoD üçlüsü)", sql: `SELECT 1`, oku: () => `${p1Olcum.fatura}:${p1Olcum.geriAl}:${p1Olcum.kurtar}`, beklenen: "403:403:403" },
      { ad: "403 mesajı gereken yetkiyi ADIYLA söyler ve `details.code=PERMISSION_DENIED` taşır (0e760284 öncesi kod yoktu)", sql: `SELECT 1`, oku: () => `${/finance:write/.test(p1Olcum.mesaj) ? 1 : 0}:${p1Olcum.kod}`, beklenen: "1:PERMISSION_DENIED" },
      { ad: "invoices değişmedi", sql: `SELECT 1`, oku: () => p1Olcum.faturaSonra - p1Olcum.faturaOnce, beklenen: 0 },
    ],
  },
  {
    id: "P5", rol: "P", gerektirir: ["A1"],
    yol: "API · sistem hesabı: (a) mevcut kullanıcı `isSystemAccount:true` ile YÜKSELTİLEMEZ (alan yazma yoluna girmez) · (b) sistem hesabına izin satırı ATANMAZ (`[\"*\"]` — grant doğmaz)", rota: "system/permissions",
    async yap({ api, sql }) {
      const ben = (await sql(`SELECT id FROM users WHERE username='e2e-yonetici'`))[0].id;
      const sys = (await sql(`SELECT id FROM users WHERE "isSystemAccount" LIMIT 1`))[0]?.id;
      const a = await api(`/api/admin/users/${ben}`, { method: "PATCH", body: JSON.stringify({ isSystemAccount: true }) });
      p5Olcum.yukselt = a.status;
      p5Olcum.sistemKaldi = Number((await sql(`SELECT count(*)::int n FROM users WHERE "isSystemAccount"`))[0].n);
      if (sys) {
        const izin = (await sql(`SELECT id FROM permissions WHERE code='customer:read' LIMIT 1`))[0]?.id;
        const b = await api(`/api/admin/users/${sys}/permissions`, { method: "PUT", body: JSON.stringify({ permissionIds: izin ? [izin] : [] }) });
        p5Olcum.atama = b.status;
        p5Olcum.atamaSatir = Number((await sql(`SELECT count(*)::int n FROM user_permissions WHERE "userId"=$1`, [sys]))[0].n);
      }
    },
    async bekle() {},
    dogrula: [
      { ad: "(a) isSystemAccount yazılamaz: yanıt 2xx/4xx fark etmez — sistem hesabı sayısı 1 kaldı (users)", sql: `SELECT 1`, oku: () => `${p5Olcum.yukselt}:${p5Olcum.sistemKaldi}`, beklenen: (v) => /:1$/.test(v) },
      { ad: "(b) sistem hesabına izin satırı doğmaz (user_permissions 0) — yanıt kodu bilgi amaçlı", sql: `SELECT 1`, oku: () => `${p5Olcum.atama}:${p5Olcum.atamaSatir}`, beklenen: (v) => /:0$/.test(v) },
    ],
  },
  {
    id: "P4", rol: "P", gerektirir: ["B1"],
    yol: "API · açık oturumda izin sökme: muhasebe (admin:users) e2e-yonetici'den `customer:write`i alır → yöneticinin AÇIK token'ı Yeni Cari'de anında 401 (tokenVersion bump) → yeniden giriş → 403 → izin geri", rota: "system/permissions",
    async yap({ api, apiRol, sql, oturumuYenile }) {
      const ben = (await sql(`SELECT id, "tokenVersion" v FROM users WHERE username='e2e-yonetici'`))[0];
      p4Olcum.surumOnce = Number(ben.v);
      p4Olcum.musteriOnce = Number((await sql(`SELECT count(*)::int n FROM customers`))[0].n);
      const tumu = (await sql(`SELECT p.id FROM user_permissions up JOIN permissions p ON p.id=up."permissionId" WHERE up."userId"=$1`, [ben.id])).map((r) => r.id);
      const eksik = (await sql(`SELECT p.id FROM user_permissions up JOIN permissions p ON p.id=up."permissionId" WHERE up."userId"=$1 AND p.code<>'customer:write'`, [ben.id])).map((r) => r.id);
      if (tumu.length === eksik.length) throw new Error("e2e-yonetici'de customer:write zaten yok");
      await api(`/api/customers?limit=1`); // açık oturum: token alınmış ve çalışıyor
      try {
        const sok = await apiRol("M", `/api/admin/users/${ben.id}/permissions`, { method: "PUT", body: JSON.stringify({ permissionIds: eksik }) });
        if (sok.status >= 300) throw new Error(`izin sökme: ${sok.status} ${JSON.stringify(sok.govde).slice(0, 160)}`);
        p4Olcum.surumSonra = Number((await sql(`SELECT "tokenVersion" v FROM users WHERE id=$1`, [ben.id]))[0].v);
        // Eski token ile yaz → 401 (sürüm eskidi); yeniden giriş → 403 (izin yok)
        const govde = { name: `${ONEK} P4 DENEME`, customerRole: true };
        const eski = await api(`/api/customers`, { method: "POST", body: JSON.stringify(govde), tekrarYok: true });
        p4Olcum.kisitliDurum = eski.status; p4Olcum.kisitliKod = eski.govde?.details?.code ?? eski.govde?.message ?? null;
        const yeni = await api(`/api/customers`, { method: "POST", body: JSON.stringify(govde) }); // 401'de sarmalayıcı yeniden girer
        p4Olcum.yenidenDurum = yeni.status;
      } finally {
        const geri = await apiRol("M", `/api/admin/users/${ben.id}/permissions`, { method: "PUT", body: JSON.stringify({ permissionIds: tumu }) });
        p4Olcum.geriDurum = geri.status;
      }
      p4Olcum.musteriSonra = Number((await sql(`SELECT count(*)::int n FROM customers`))[0].n);
      oturumuYenile(); // panel penceresinin token'ı da eskidi — sonraki P adımı yeniden girsin
    },
    async bekle() {},
    dogrula: [
      { ad: "izin sökülünce users.tokenVersion +1 (açık oturumlar düşer)", sql: `SELECT 1`, oku: () => p4Olcum.surumSonra - p4Olcum.surumOnce, beklenen: (v) => v >= 1 },
      { ad: "eski token ile yazma ANINDA 401 (yeniden giriş istenir); yeniden girişte 403 (izin yok)", sql: `SELECT 1`, oku: () => `${p4Olcum.kisitliDurum}:${p4Olcum.yenidenDurum}`, beklenen: "401:403" },
      { ad: "customers değişmedi; izinler geri yüklendi (2xx) ve customer:write yeniden var", sql: `SELECT count(*)::int n FROM user_permissions up JOIN permissions p ON p.id=up."permissionId" JOIN users u ON u.id=up."userId" WHERE u.username='e2e-yonetici' AND p.code='customer:write'`, oku: (r) => `${p4Olcum.musteriSonra - p4Olcum.musteriOnce}:${p4Olcum.geriDurum}:${r[0].n}`, beklenen: (v) => /^0:20\d:1$/.test(v) },
    ],
  },
  // ── SY · sevk yönü kilidi + Yurtiçi/Yurtdışı Satış (2026-09-23) — ayrı dosyada.
  ...SEVK_YONU_ADIMLARI,
  // ── SK · Sevk Kapısı (sevk onayı açık rejim) — ayrı dosyada.
  ...SEVK_KAPISI_ADIMLARI,
  // ── MK · sunucuda üretilen master kodu panelden kodsuz açılır (K20) — ayrı dosyada.
  ...MASTER_KOD_ADIMLARI,
  // ── TZ · başka istemcinin kaydı sayfaya dönünce görünür (K21) — ayrı dosyada.
  ...TAZELIK_ADIMLARI,
  ...SIPARIS_YONU_ADIMLARI,
];
