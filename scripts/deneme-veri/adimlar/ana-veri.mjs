// Ana veri: depolar · kalemler (iplik/kumaş/sarf) · tedarikçiler · istasyonlar (eksik her tür) · makineler
// (32 tezgah + devere + paketleme) · tezgah künyesi (ağızlık türü karışık) · vardiya · çözgü kartları.
// Kod backend-authoritative (numara serisi) ⇒ ad ile bulunur; ad değişmez (idempotentliğin çapası).
import { katlaAd } from "../lib/baglam.mjs";

export const DEPOLAR = [
  ["İplik Deposu", "Hammadde (iplik) deposu — çözgü/atkı ipliği"],
  ["Mamul Deposu B", "Sevke hazır mamul — ikinci bina"],
  ["Fason Ara Depo", "Fasondan dönen ve fasona gidecek mal"],
];
export const IPLIKLER = [
  ["PES 150/48 ÇÖZGÜ İPLİĞİ", 150], ["PES 300/96 ATKI İPLİĞİ", 300], ["PAMUK NE 30/1 İPLİK", 177], ["VİSKON 150 DENYE İPLİK", 150],
];
export const KUMASLAR = [
  ["HAM PERDELİK 280", "MT"], ["HAM DÖŞEMELİK 140", "MT"], ["HAM TÜL 300", "MT"], ["JAKARLI DÖŞEMELİK 140", "MT"],
  ["KETEN GÖRÜNÜMLÜ PERDE 280", "MT"], ["SATEN DÖŞEMELİK 140", "MT"],
];
export const SARFLAR = [["KARTON MASURA 280 CM", "ADET"], ["AMBALAJ NAYLONU", "KG"]];
/** Deneme müşterileri — kartla CARİ HESAP doğar (anonim eski kartların hesabı yok ⇒ finans bunlarla). Havuz kelimesi taşımaz. */
export const MUSTERILER = [
  ["Trakya Ev Tekstili", "Tekirdağ"], ["Akdeniz Perde Dekorasyon", "Antalya"], ["Marmara Döşemelik", "Bursa"],
  ["Ege Konfeksiyon", "İzmir"], ["Anadolu Mobilya Kumaş", "Kayseri"],
];
export const TEDARIKCILER = ["Doruk İplik Sanayi", "Pınar Elyaf Ticaret", "Atlas Çözgü Hazırlama"];
export const ISTASYONLAR = [
  { anahtar: "WEAVING", body: { name: "Dokuma Salonu A", type: "INTERNAL", kind: "WEAVING", department: "DOKUMA", allowAsWorkOrderStep: false, consumesWarpBeam: true } },
  { anahtar: "WARPING", body: { name: "Devere Hazırlık", type: "INTERNAL", kind: "WARPING", department: "DEVERE", allowAsWorkOrderStep: false, producesWarpBeam: true } },
  { anahtar: "OTHER", body: { name: "Katlama ve Paketleme", type: "INTERNAL", kind: "OTHER", department: "PAKETLEME", allowAsWorkOrderStep: true } },
];
export const TEZGAH_SAYISI = 32;
const SHED = (i) => (i <= 12 ? "ARMUR" : i <= 24 ? "KAM" : "JAKAR");
const MARKA = (i) => (i <= 12 ? "Picanol OMNIplus 280" : i <= 24 ? "Dornier A1 280" : "Stäubli Jakarlı 140");
export const tezgahAdi = (i) => `Tezgah ${String(i).padStart(2, "0")} — ${MARKA(i)}`;
export const VARDIYALAR = [
  { code: "SABAH", name: "Sabah", startMinute: 420, durationMinutes: 480, plannedBreakMinutes: 30, sortOrder: 1 },
  { code: "AKSAM", name: "Akşam", startMinute: 900, durationMinutes: 480, plannedBreakMinutes: 30, sortOrder: 2 },
  { code: "GECE", name: "Gece", startMinute: 1380, durationMinutes: 480, plannedBreakMinutes: 30, sortOrder: 3 },
];
export const COZGU_KARTLARI = [
  ["CZG-D01", "PES 150 — 6400 tel / 280 cm", "PES 150/48 ÇÖZGÜ İPLİĞİ", 6400, 285],
  ["CZG-D02", "PES 150 — 3600 tel / 140 cm", "PES 150/48 ÇÖZGÜ İPLİĞİ", 3600, 145],
  ["CZG-D03", "Pamuk 30/1 — 7200 tel / 300 cm", "PAMUK NE 30/1 İPLİK", 7200, 305],
];

export async function anaVeri(c) {
  const k = c.kayit;
  // Depolar
  const depolar = await c.hepsi("/api/warehouses");
  k.depo = { varsayilan: depolar.find((d) => d.isDefault)?.id };
  for (const [name, notes] of DEPOLAR) {
    const d = await c.bulYaDaYarat("depo", async () => (await c.hepsi("/api/warehouses")).find((x) => katlaAd(x.name) === katlaAd(name)),
      async () => (await c.api("POST", "/api/warehouses", { name, notes }, { tekDeneme: true })).data);
    k.depo[name] = d.id;
  }
  // Kalemler
  k.kalem = {};
  const kalemBul = async (name) => (await c.hepsi(`/api/items?search=${encodeURIComponent(name.slice(0, 20))}`)).find((x) => katlaAd(x.name) === katlaAd(name));
  for (const [name, den] of IPLIKLER) {
    k.kalem[name] = (await c.bulYaDaYarat("kalem", () => kalemBul(name),
      async () => (await c.api("POST", "/api/items", { name, unit: "KG", itemType: "YARN", linearDensityDen: den }, { tekDeneme: true })).data)).id;
  }
  for (const [name, unit] of KUMASLAR) {
    k.kalem[name] = (await c.bulYaDaYarat("kalem", () => kalemBul(name),
      async () => (await c.api("POST", "/api/items", { name, unit, itemType: "FABRIC" }, { tekDeneme: true })).data)).id;
  }
  for (const [name, unit] of SARFLAR) {
    k.kalem[name] = (await c.bulYaDaYarat("kalem", () => kalemBul(name),
      async () => (await c.api("POST", "/api/items", { name, unit, itemType: "CONSUMABLE" }, { tekDeneme: true })).data)).id;
  }
  // Tedarikçiler (cari kimlik, tedarikçi rolü)
  k.tedarikci = {};
  for (const name of TEDARIKCILER) {
    k.tedarikci[name] = (await c.bulYaDaYarat("cari", async () => (await c.hepsi(`/api/customers?search=${encodeURIComponent(name.split(" ")[0])}`)).find((x) => katlaAd(x.name) === katlaAd(name)),
      async () => (await c.api("POST", "/api/customers", { name, isSupplierRole: true, isCustomerRole: false, city: "Bursa" }, { tekDeneme: true })).data)).id;
  }
  // Müşteriler: önce deneme müşterileri (cari hesaplı), ardından mevcut (anonimleştirilmiş) aktif müşteriler koda göre ilk 3
  const yeniMusteri = [];
  for (const [name, city] of MUSTERILER) {
    const m = await c.bulYaDaYarat("cari", async () => (await c.hepsi(`/api/customers?search=${encodeURIComponent(name.split(" ")[0])}`)).find((x) => katlaAd(x.name) === katlaAd(name)),
      async () => (await c.api("POST", "/api/customers", { name, isCustomerRole: true, isSupplierRole: false, city }, { tekDeneme: true })).data);
    yeniMusteri.push({ id: m.id, code: m.code });
  }
  const cariler = await c.hepsi("/api/customers");
  const eski = cariler.filter((x) => x.isActive && x.isCustomerRole && !x.isSupplierRole && !yeniMusteri.some((y) => y.id === x.id))
    .sort((a, b) => a.code.localeCompare(b.code)).slice(0, 3).map((x) => ({ id: x.id, code: x.code }));
  k.musteriler = [...yeniMusteri, ...eski];
  // İstasyonlar
  k.istasyon = {};
  for (const { anahtar, body } of ISTASYONLAR) {
    const s = await c.bulYaDaYarat("istasyon", async () => (await c.hepsi("/api/stations")).find((x) => katlaAd(x.name) === katlaAd(body.name)),
      async () => (await c.api("POST", "/api/stations", body, { tekDeneme: true })).data);
    k.istasyon[anahtar] = s.id;
  }
  // Makineler
  const makineBul = async (stationId, name) => (await c.hepsi("/api/machines")).find((x) => x.stationId === stationId && katlaAd(x.name) === katlaAd(name));
  k.tezgahlar = [];
  for (let i = 1; i <= TEZGAH_SAYISI; i++) {
    const name = tezgahAdi(i);
    const m = await c.bulYaDaYarat("makine", () => makineBul(k.istasyon.WEAVING, name),
      async () => (await c.api("POST", "/api/machines", { stationId: k.istasyon.WEAVING, name, warpBeamSlots: 1 }, { tekDeneme: true })).data);
    k.tezgahlar.push({ i, id: m.id, code: m.code, shed: SHED(i) });
  }
  for (const [ist, name] of [["WARPING", "Devere Makinesi 1 — Karl Mayer"], ["OTHER", "Katlama Masası 1"]]) {
    const m = await c.bulYaDaYarat("makine", () => makineBul(k.istasyon[ist], name),
      async () => (await c.api("POST", "/api/machines", { stationId: k.istasyon[ist], name }, { tekDeneme: true })).data);
    k[`makine_${ist}`] = m.id;
  }
  // Tezgah künyesi: ağızlık türü (makine türü) + nominal devir; mevcut değer aynıysa yazılmaz
  for (const t of k.tezgahlar) {
    const nominal = t.shed === "JAKAR" ? 420 : t.shed === "KAM" ? 600 : 520;
    await c.kosulluYaz("tezgah-kunye", async () => {
      try { const s = (await c.api("GET", `/api/machine-specs/${t.id}`)).data ?? {}; return s.shedType !== t.shed || s.nominalUnitsPerMin !== nominal; }
      catch (e) { if (e.status === 404) return true; throw e; }
    }, () => c.api("PUT", `/api/machine-specs/${t.id}`, { shedType: t.shed, nominalUnitsPerMin: nominal }));
  }
  // Vardiya tanımları
  const vardiyalar = liste0(await c.api("GET", "/api/shift-definitions?includeInactive=1"));
  for (const d of VARDIYALAR) {
    const hit = vardiyalar.find((x) => x.code === d.code || katlaAd(x.name) === katlaAd(d.name));
    if (hit) { c.say("vardiya", "mevcut"); continue; }
    await c.api("POST", "/api/shift-definitions", { ...d, activeWeekdays: [] }, { tekDeneme: true });
    c.say("vardiya", "yeni");
  }
  // Çözgü kartları
  k.cozgu = {};
  for (const [code, name, iplik, ends, reed] of COZGU_KARTLARI) {
    const w = await c.bulYaDaYarat("cozgu-karti", async () => (await c.hepsi("/api/warp-specs")).find((x) => x.code === code),
      async () => (await c.api("POST", "/api/warp-specs", { code, name, yarnItemId: k.kalem[iplik], endsCount: ends, selvedgeEnds: 48, reedNo: 120, endsPerDent: 2, reedWidthCm: reed, takeUpPct: 8 }, { tekDeneme: true })).data);
    k.cozgu[code] = w.id;
  }
}
const liste0 = (j) => (Array.isArray(j?.data) ? j.data : j?.data?.items ?? []);
