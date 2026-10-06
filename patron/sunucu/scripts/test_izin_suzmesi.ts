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
// Koşum: npx tsx scripts/test_izin_suzmesi.ts
// =============================================================================
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { CLOUD_PERMISSIONS, ROLE_TEMPLATES, effectivePermissions } from "../src/catalog/permissions";
import { PROJECTION_CATALOG, ROOT_PROJECTIONS } from "../src/catalog/projections";
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
  kontrol("§1f Satış şablonu hiçbir finans projeksiyonu okumaz", !["siparis.finans", "fatura", "kasa", "cari-hesap", "ozet-finans", "rapor.finance"].some((p) => satis.has(p)));
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
