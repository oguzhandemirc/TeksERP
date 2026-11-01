// =============================================================================
// İZİN SÜZMESİ BEKÇİSİ — "sipariş görür, tutar görmez" (sözleşme §3.1, §10; Senaryo P4/P24), gerçek HTTP:
//   §1 katalog: her projeksiyon ve alt satır tam bir izin kümesine eşli (eşlenmeyen yok) · kök satırında
//      FINANS/KİŞİSEL alanı yasak olan her kökün o alt satırı var · alt satır kök izinlerini de ister
//   §2 finans izni YOK (Satış şablonu): sipariş listesi/detayı `finans` taşımaz · fatura, kasa, cari
//      bakiye, finans özeti 403 · kişisel alt satır (yetkili) cari izniyle görünür
//   §3 yalnız sipariş okuma: cari kartın `kisisel`i görünmez · sevkiyat 403 · oturum şeridi
//      projeksiyon listesini bu kümeyle döner
//   §4 Patron (hepsi): finans alt satırı ve finans projeksiyonları görünür
//   §5 DB düzeyi: hesabın hesaplanan projeksiyon kümesiyle ham SQL `siparis.finans` 0 satır
//   §6 alt satırı projeksiyon diye doğrudan istemek 404; bilinmeyen projeksiyon 404; oturumsuz 401
//   §7f–§7j (2026-10-25): para birimli TÜM alanlar düşer — tablo kolonu + hücreleri, `paraIcerir` anlatı, para eksenli
//      grafik. NEGATİF SONDA: `tabloyuKirp` çağrısı söküldü → §7f + §7g ❌; anlatı süzgeci söküldü → §7h ❌; geri alındı → ✅.
//   §8 maliyet & teklif (MAL-8): `teklif`/`teklif-kalemi`/`standart-maliyet` `.finans`ı `bulut:maliyet:oku` ister —
//      Satış şablonu teklifi görür, tutar/marjı görmez; `bulut:fiyat:oku` tek başına maliyet alt satırını AÇMAZ
//   §7 rapor sunumu (K-BULUT): para birimli yan sayı finans DIŞI raporda `bulut:fiyat:oku` ister; finans ailesi
//      kendi izniyle açar; rapor servisi sonucu bu süzgeçten geçirir
// Koşum: npx tsx scripts/test_izin_suzmesi.ts
// =============================================================================
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { CLOUD_PERMISSIONS, ROLE_TEMPLATES, effectivePermissions } from "../src/catalog/permissions";
import { PROJECTION_CATALOG, ROOT_PROJECTIONS } from "../src/catalog/projections";
import { stripMoneySideFigures } from "../src/catalog/reports";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sessionProjections } from "../src/auth/session.service";
import { api, girdi, hesapKur, imzali, kontrol, ortamKur, paket, sonuc, temizleTesis, tesisKur, tesisUrl, type Ortam, type TestHesabi, type TestKurulumu } from "./lib/test-ortam";

type Liste = { kayitlar: { id: string; kayit: Record<string, unknown>; finans?: Record<string, unknown> | null; kisisel?: Record<string, unknown> | null }[] };

function katalogBolumu(): void {
  console.log("\n§1 katalog eşlemesi");
  const bilinen = new Set<string>(CLOUD_PERMISSIONS);
  const eksik = [...PROJECTION_CATALOG.values()].filter((d) => d.permissions.length === 0 || d.permissions.some((p) => !bilinen.has(p)));
  kontrol("§1a her projeksiyon/alt satır tanımlı izin kümesine eşli", eksik.length === 0, `${PROJECTION_CATALOG.size} ad`);
  const yasakliAltsiz = ROOT_PROJECTIONS.filter((r) => (r.forbiddenRootFields?.length ?? 0) > 0 && (r.subRows?.length ?? 0) === 0);
  kontrol("§1b kök alanı yasaklanan her kökün alt satırı var", yasakliAltsiz.length === 0, yasakliAltsiz.map((r) => r.name).join(","));
  const altKokIzni = [...PROJECTION_CATALOG.values()].filter((d) => d.subRow && !d.root.permissions.every((p) => d.permissions.includes(p)));
  kontrol("§1c alt satır kök izinlerinin HEPSİNİ de ister", altKokIzni.length === 0);
  const sipFinans = PROJECTION_CATALOG.get("siparis.finans")!.permissions;
  kontrol("§1d finans DIŞI kökün .finans'ı fiyat iznine bağlı", sipFinans.includes("bulut:fiyat:oku") && sipFinans.includes("bulut:siparis:oku"));
  const cariFinans = PROJECTION_CATALOG.get("cari-hareket.finans")!.permissions;
  kontrol("§1e finans kökünün .finans'ı KENDİ iznine bağlı (fiyat değil)", cariFinans.length === 1 && cariFinans[0] === "bulut:cari-bakiye:oku");
  const satis = new Set(sessionProjections(effectivePermissions(ROLE_TEMPLATES.SATIS)));
  kontrol("§1f Satış şablonu hiçbir finans projeksiyonu okumaz", !["siparis.finans", "fatura", "kasa", "cari-hesap", "ozet-finans", "ozet-masraf", "karlilik-ozet", "rapor.finance"].some((p) => satis.has(p)));
}

function raporSunumuBolumu(): void {
  console.log("\n§7 rapor sunumu para alanları (K-BULUT)");
  const sunum = { anahtar: "sales/sevkiyat", yanSayilar: [{ olcu: "sevk.top", birim: "top", deger: 3 }, { olcu: "sevk.tutar", birim: "TRY", deger: 1500 }, { olcu: "sevk.usd", birim: "USD", deger: 40 }] };
  const yan = (v: unknown) => ((v as { yanSayilar: { olcu: string }[] }).yanSayilar).map((y) => y.olcu).join(",");
  const satis = new Set<string>(["bulut:rapor:oku", "bulut:sevkiyat:oku"]);
  kontrol("§7a ⭐ fiyat izni YOK → para yan sayıları düşer, para dışı kalır", yan(stripMoneySideFigures(sunum, "bulut:sevkiyat:oku", satis)) === "sevk.top");
  kontrol("§7b fiyat izni VAR → sunum aynen döner", stripMoneySideFigures(sunum, "bulut:sevkiyat:oku", new Set([...satis, "bulut:fiyat:oku"])) === sunum);
  kontrol("§7c finans ailesi raporu (cari-bakiye) kendi izniyle açar", stripMoneySideFigures(sunum, "bulut:cari-bakiye:oku", new Set(["bulut:rapor:oku", "bulut:cari-bakiye:oku"])) === sunum);
  kontrol("§7d sunum olmayan (v1) sonuç dokunulmaz", JSON.stringify(stripMoneySideFigures({ satirlar: [1] }, "bulut:siparis:oku", satis)) === '{"satirlar":[1]}');
  // §7f–§7j (2026-10-25): para birimli TÜM alanlar — tablo kolonu (+ satır/toplam hücresi), işaretli anlatı, para eksenli grafik.
  const tam = {
    ...sunum,
    anlati: [{ kural: "enBuyukPay", onem: 0.9, metin: "En büyük pay 1.500 TL ile A'da.", kanit: {}, paraIcerir: true }, { kural: "egilim", onem: 0.5, metin: "Sevk metresi artıyor.", kanit: {} }],
    tablo: {
      kolonlar: [{ anahtar: "musteri", baslik: "Müşteri" }, { anahtar: "metre", baslik: "Metre", birim: "m" }, { anahtar: "tutar", baslik: "Tutar", birim: "TRY" }, { anahtar: "usd", baslik: "USD", birim: "USD" }],
      satirlar: [{ musteri: "A", metre: 120, tutar: 1500, usd: 40 }, { musteri: "B", metre: 80, tutar: 900, usd: 25 }],
      toplam: { musteri: "Toplam", metre: 200, tutar: 2400, usd: 65 },
    },
    grafik: { tur: "cubuk", baslik: "Tutar", eksen: { x: { ad: "Müşteri", tur: "kategori" }, y: { ad: "Tutar", birim: "TRY" } }, seriler: [], kategoriler: [] },
  };
  const kirpik = stripMoneySideFigures(tam, "bulut:sevkiyat:oku", satis) as typeof tam;
  const anahtarlar = (o: Record<string, unknown> | undefined) => Object.keys(o ?? {}).sort().join(",");
  kontrol("§7f ⭐ fiyat izni YOK → para birimli tablo kolonu düşer, para dışı kolon kalır",
    kirpik.tablo.kolonlar.map((k) => k.anahtar).join(",") === "musteri,metre", kirpik.tablo.kolonlar.map((k) => k.anahtar).join(","));
  kontrol("§7g ⭐ düşen kolonun hücresi satırlardan VE toplamdan da düşer (değer sızmaz)",
    kirpik.tablo.satirlar.every((r) => anahtarlar(r) === "metre,musteri") && anahtarlar(kirpik.tablo.toplam) === "metre,musteri" && !JSON.stringify(kirpik.tablo).includes("1500"),
    JSON.stringify(kirpik.tablo.satirlar[0]));
  kontrol("§7h ⭐ fabrikanın `paraIcerir` işaretlediği anlatı cümlesi düşer, diğeri kalır (bulut metin okumaz)",
    kirpik.anlati.map((c) => c.kural).join(",") === "egilim", kirpik.anlati.map((c) => c.kural).join(","));
  const metreGrafik = { ...tam, grafik: { ...tam.grafik, eksen: { ...tam.grafik.eksen, y: { ad: "Metre", birim: "m" } } } };
  kontrol("§7i para eksenli grafik düşer (null); para dışı grafik kalır",
    kirpik.grafik === null && (stripMoneySideFigures(metreGrafik, "bulut:sevkiyat:oku", satis) as typeof tam).grafik !== null);
  kontrol("§7j fiyat izni VAR / finans raporu → tablo, anlatı, grafik AYNEN (aynı nesne)",
    stripMoneySideFigures(tam, "bulut:sevkiyat:oku", new Set([...satis, "bulut:fiyat:oku"])) === tam && stripMoneySideFigures(tam, "bulut:cek:oku", new Set(["bulut:rapor:oku", "bulut:cek:oku"])) === tam);
  const servis = readFileSync(join(__dirname, "..", "src", "services", "report.service.ts"), "utf8").replace(/\/\/.*$/gm, "");
  kontrol("§7e ⭐ rapor servisi sonucu süzgeçten geçirir (veri: stripMoneySideFigures(...))", /veri:\s*stripMoneySideFigures\(out\.result\.data,/.test(servis));
}

function maliyetKatalogu(): void {
  console.log("\n§8 maliyet & teklif katalogu (MAL-8)");
  const fin = ["teklif.finans", "teklif-kalemi.finans", "standart-maliyet.finans"].map((n) => PROJECTION_CATALOG.get(n)?.permissions ?? []);
  kontrol("§8a ⭐ maliyet `.finans` = kök izni + `bulut:maliyet:oku`, fiyat izni YOK", fin.every((x) => x.length === 2 && x.includes("bulut:teklif:oku") && x.includes("bulut:maliyet:oku")), JSON.stringify(fin));
  kontrol("§8b Satış şablonu teklifi görür, maliyeti görmez; Muhasebe ikisini de almaz",
    ROLE_TEMPLATES.SATIS.includes("bulut:teklif:oku") && !ROLE_TEMPLATES.SATIS.includes("bulut:maliyet:oku") && !ROLE_TEMPLATES.MUHASEBE.some((p) => p === "bulut:teklif:oku" || p === "bulut:maliyet:oku"));
  kontrol("§8c Patron şablonu ikisini de taşır", ROLE_TEMPLATES.PATRON.includes("bulut:teklif:oku") && ROLE_TEMPLATES.PATRON.includes("bulut:maliyet:oku"));
}

async function teklifFikstur(o: Ortam, k: TestKurulumu): Promise<string> {
  const ufuk = new Date(o.saat.simdi() - 30_000);
  const w = { t: ufuk.toISOString(), k: "000000000002" };
  const teklif = randomUUID();
  const kayitlar = [
    girdi("teklif", { yaz: [{ id: teklif, no: "TKF-1", durum: "SENT", tarih: ufuk.toISOString(), suresiDoldu: false }], yeni: w }),
    girdi("teklif.finans", { yaz: [{ id: teklif, toplamTutar: "500.00", kur: "34", toplamMaliyetTl: "15408.00", brutMarjPct: "9.38" }], yeni: w }),
  ];
  const r = await imzali(o, k, "/v1/esitle", { govde: paket(k, { ufuk, kayitlar, anliklar: [] }) });
  if (r.status !== 200 || (r.json as unknown as { ret: unknown[] }).ret.length > 0) throw new Error(`teklif fikstürü: ${r.status} ${JSON.stringify(r.json)}`);
  return teklif;
}

async function maliyetCanli(o: Ortam, k: TestKurulumu, hesaplar: { satis: TestHesabi; patron: TestHesabi }): Promise<void> {
  const teklif = await teklifFikstur(o, k);
  const fiyatli = await hesapKur(o, k.tesisId, ["bulut:teklif:oku", "bulut:fiyat:oku"]);
  const maliyetli = await hesapKur(o, k.tesisId, ["bulut:teklif:oku", "bulut:maliyet:oku"]);
  const satir = async (h: TestHesabi) => (await api(o, "GET", `/api/veri/teklif/${teklif}`, { belirtec: h.belirtec })).json.data as { kayit?: Record<string, unknown>; finans?: Record<string, unknown> } | undefined;
  const s = await satir(hesaplar.satis);
  kontrol("§8d ⭐ Satış: teklif görünür (durum), tutar/marj alt satırı YOK", s?.kayit?.durum === "SENT" && !("finans" in (s ?? {})) && !("toplamTutar" in (s?.kayit ?? {})));
  const f = await satir(fiyatli);
  kontrol("§8e ⭐ `bulut:fiyat:oku` tek başına teklif `.finans`ını AÇMAZ", f !== undefined && !("finans" in f));
  const m = await satir(maliyetli);
  kontrol("§8f ⭐ `bulut:maliyet:oku` → `.finans` fabrikanın değerleriyle aynen (bulut hesap yapmaz)", m?.finans?.brutMarjPct === "9.38" && m.finans.toplamTutar === "500.00");
  const p = await satir(hesaplar.patron);
  kontrol("§8g Patron: tutar ve marj görünür", p?.finans?.toplamMaliyetTl === "15408.00");
}

async function fikstur(o: Ortam, k: TestKurulumu): Promise<{ siparis: string; cari: string }> {
  const ufuk = new Date(o.saat.simdi() - 60_000);
  const w = { t: ufuk.toISOString(), k: "000000000001" };
  const siparis = randomUUID();
  const cari = randomUUID();
  const fatura = randomUUID();
  const kayitlar = [
    girdi("siparis", { yaz: [{ id: siparis, siparisNo: "S-1", durum: "ACIK", cariKartId: cari, siparisTarihi: ufuk.toISOString() }], yeni: w }),
    girdi("siparis.finans", { yaz: [{ id: siparis, tutar: "15000.00" }], yeni: w }),
    girdi("cari-kart", { yaz: [{ id: cari, kod: "C-1", ad: "Örnek Tekstil" }], yeni: w }),
    girdi("cari-kart.kisisel", { yaz: [{ id: cari, yetkili: "Ayşe Yılmaz", telefon: "0212 000 00 00" }], yeni: w }),
    girdi("fatura", { yaz: [{ id: fatura, belgeNo: "F-1", tarih: ufuk.toISOString() }], yeni: w }),
    girdi("fatura.finans", { yaz: [{ id: fatura, genelToplam: "15000.00" }], yeni: w }),
  ];
  const anliklar = [
    { projeksiyon: "ozet.siparis", icerikOzeti: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", veri: { acik: 1 } },
    { projeksiyon: "ozet-finans", icerikOzeti: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", veri: { kasa: "100.00" } },
    { projeksiyon: "ozet-masraf", icerikOzeti: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", veri: { buAyToplam: "250.00", kategoriler: [] } },
    { projeksiyon: "karlilik-ozet", icerikOzeti: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", veri: { buAy: "2026-10", enKarli: [{ etiket: "Alfa", katki: "900.00" }] } },
  ];
  const r = await imzali(o, k, "/v1/esitle", { govde: paket(k, { ufuk, kayitlar, anliklar }) });
  if (r.status !== 200 || (r.json as unknown as { ret: unknown[] }).ret.length > 0) throw new Error(`fikstür: ${r.status} ${JSON.stringify(r.json)}`);
  return { siparis, cari };
}

async function liste(o: Ortam, h: TestHesabi, p: string) {
  return api(o, "GET", `/api/veri/${p}`, { belirtec: h.belirtec });
}

async function finanssiz(o: Ortam, h: TestHesabi, ids: { siparis: string; cari: string }): Promise<void> {
  console.log("\n§2 finans izni YOK (Satış şablonu)");
  const l = await liste(o, h, "siparis");
  const satir = (l.json.data as Liste).kayitlar[0];
  kontrol("§2a sipariş listesi 200, satır var", l.status === 200 && satir?.id === ids.siparis);
  kontrol("§2b liste satırı `finans` TAŞIMAZ (anahtar yok)", satir !== undefined && !("finans" in satir) && !("tutar" in satir.kayit));
  const d = await api(o, "GET", `/api/veri/siparis/${ids.siparis}`, { belirtec: h.belirtec });
  kontrol("§2c sipariş detayı `finans` TAŞIMAZ", d.status === 200 && !("finans" in (d.json.data as object)));
  for (const p of ["fatura", "kasa", "cari-hesap", "tahsilat-odeme"]) {
    const r = await liste(o, h, p);
    kontrol(`§2d ${p} → 403 YETKISIZ`, r.status === 403 && r.json.details?.code === "YETKISIZ");
  }
  const oz = await api(o, "GET", "/api/anlik/ozet-finans", { belirtec: h.belirtec });
  kontrol("§2e finans özeti (anlık) → 403", oz.status === 403);
  const om = await api(o, "GET", "/api/anlik/ozet-masraf", { belirtec: h.belirtec });
  kontrol("§2e2 masraf özeti (D4-H2, bulut:kasa:oku yok) → 403", om.status === 403);
  const ko = await api(o, "GET", "/api/anlik/karlilik-ozet", { belirtec: h.belirtec });
  kontrol("§2e3 kârlılık özeti (D4-G4, bulut:maliyet:oku yok) → 403", ko.status === 403);
  const ozs = await api(o, "GET", "/api/anlik/ozet.siparis", { belirtec: h.belirtec });
  kontrol("§2f sipariş özeti (ozet:oku + siparis:oku) → 200", ozs.status === 200);
  const c = await liste(o, h, "cari-kart");
  const cs = (c.json.data as Liste).kayitlar.find((x) => x.id === ids.cari);
  kontrol("§2g cari izni VAR → kişisel alt satır (yetkili) görünür", cs?.kisisel?.yetkili === "Ayşe Yılmaz");
}

async function yalnizSiparis(o: Ortam, h: TestHesabi, ids: { cari: string }): Promise<void> {
  console.log("\n§3 yalnız sipariş okuma");
  const c = await liste(o, h, "cari-kart");
  const cs = (c.json.data as Liste).kayitlar.find((x) => x.id === ids.cari);
  kontrol("§3a cari kart (oturum izni) görünür, `kisisel` YOK", c.status === 200 && cs !== undefined && !("kisisel" in cs) && !("yetkili" in cs.kayit));
  const sv = await liste(o, h, "sevkiyat");
  kontrol("§3b sevkiyat → 403", sv.status === 403);
  const oz = await api(o, "GET", "/api/anlik/ozet.siparis", { belirtec: h.belirtec });
  kontrol("§3c özet bölümü ozet:oku İSTER (yalnız siparis:oku → 403)", oz.status === 403);
  const st = await api(o, "GET", "/api/oturum", { belirtec: h.belirtec });
  const pr = (st.json.data as { projeksiyonlar: string[] }).projeksiyonlar;
  kontrol("§3d oturum şeridi: siparis var, siparis.finans/cari-kart.kisisel YOK", pr.includes("siparis") && !pr.includes("siparis.finans") && !pr.includes("cari-kart.kisisel"));
}

async function patron(o: Ortam, h: TestHesabi, ids: { siparis: string }): Promise<void> {
  console.log("\n§4 Patron (bütün okuma izinleri)");
  const d = await api(o, "GET", `/api/veri/siparis/${ids.siparis}`, { belirtec: h.belirtec });
  kontrol("§4a sipariş detayı finans alt satırıyla (tutar)", (d.json.data as { finans?: { tutar?: string } }).finans?.tutar === "15000.00");
  const f = await liste(o, h, "fatura");
  const fs = (f.json.data as Liste).kayitlar[0];
  kontrol("§4b fatura + finans görünür", f.status === 200 && fs?.finans?.genelToplam === "15000.00");
  const oz = await api(o, "GET", "/api/anlik/ozet-finans", { belirtec: h.belirtec });
  kontrol("§4c finans özeti 200", oz.status === 200);
  const om = await api(o, "GET", "/api/anlik/ozet-masraf", { belirtec: h.belirtec });
  kontrol("§4d masraf özeti (bulut:kasa:oku) 200, fabrikanın verisi aynen", om.status === 200 && (om.json.data as { veri?: { buAyToplam?: string } }).veri?.buAyToplam === "250.00");
  const ko = await api(o, "GET", "/api/anlik/karlilik-ozet", { belirtec: h.belirtec });
  const kv = (ko.json.data as { veri?: { enKarli?: Array<{ etiket?: string; katki?: string }> } }).veri;
  kontrol("§4e kârlılık özeti (bulut:maliyet:oku) 200, fabrikanın sırası ve rakamı aynen", ko.status === 200 && kv?.enKarli?.[0]?.etiket === "Alfa" && kv.enKarli[0].katki === "900.00");
}

async function dbDuzeyi(o: Ortam, k: TestKurulumu, ids: { siparis: string }): Promise<void> {
  console.log("\n§5 DB düzeyi (ham SQL, hesabın kümesiyle)");
  const liste = sessionProjections(effectivePermissions(ROLE_TEMPLATES.SATIS)).join(",");
  const c = new Client({ connectionString: tesisUrl(o, k.tesisId, "uygulama") });
  await c.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.tesis_id', $1, true), set_config('app.projeksiyonlar', $2, true)", [k.tesisId, liste]);
    const fin = await c.query("SELECT * FROM projection_rows WHERE projection = 'siparis.finans' AND record_id = $1", [ids.siparis]);
    const kok = await c.query("SELECT * FROM projection_rows WHERE projection = 'siparis' AND record_id = $1", [ids.siparis]);
    await c.query("ROLLBACK");
    kontrol("§5a Satış kümesiyle siparis.finans doğrudan SQL'le 0 satır", fin.rowCount === 0);
    kontrol("§5b aynı kümeyle siparis kökü 1 satır", kok.rowCount === 1);
  } finally {
    await c.end();
  }
}

async function main(): Promise<void> {
  katalogBolumu();
  maliyetKatalogu();
  raporSunumuBolumu();
  const o = await ortamKur();
  const k = await tesisKur(o);
  try {
    const ids = await fikstur(o, k);
    const satis = await hesapKur(o, k.tesisId, ROLE_TEMPLATES.SATIS);
    const dar = await hesapKur(o, k.tesisId, ["bulut:siparis:oku"]);
    const hepsi = await hesapKur(o, k.tesisId, ROLE_TEMPLATES.PATRON);
    await finanssiz(o, satis, ids);
    await yalnizSiparis(o, dar, ids);
    await patron(o, hepsi, ids);
    await dbDuzeyi(o, k, ids);
    await maliyetCanli(o, k, { satis, patron: hepsi });
    console.log("\n§6 ad kapıları");
    const alt = await liste(o, hepsi, "siparis.finans");
    kontrol("§6a alt satır projeksiyon diye doğrudan istenemez → 404", alt.status === 404);
    const yok = await liste(o, hepsi, "maas-bordrosu");
    kontrol("§6b bilinmeyen projeksiyon → 404", yok.status === 404);
    const anon = await api(o, "GET", "/api/veri/siparis");
    kontrol("§6c oturumsuz → 401 OTURUM_YOK", anon.status === 401 && anon.json.details?.code === "OTURUM_YOK");
    const kotuImlec = await api(o, "GET", "/api/veri/siparis?imlec=bozuk", { belirtec: hepsi.belirtec });
    kontrol("§6d biçimsiz imleç → 400", kotuImlec.status === 400);
  } finally {
    await temizleTesis(o, k.tesisId);
    await o.kapat();
  }
  sonuc();
}

main().catch((err: Error) => {
  console.error(`❌ bekçi çöktü: ${err.stack ?? err.message}`);
  process.exit(1);
});
