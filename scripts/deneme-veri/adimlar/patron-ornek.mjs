// Patron örnek verisi (dv3: ad alanı) — ana-veri'den BAĞIMSIZ: kurulumun KENDİ ana verisi (kumaş kalemleri, rota istasyonları,
// fason firmaları, tezgahlar) okunur; yalnız eksik olan (renk, müşteri/tedarikçi carisi, kasa/banka) eklenir. Amaç patron
// uygulamasının her ekranı (pano · siparişler · üretim · stok · sevkiyat · finans · cariler · renkler · raporlar) dolu görünsün.
// İş emirleri FARKLI aşamada bırakılır: bitti+sevk · bitti+depoda · tamburda · KK2'de · fasonda · ilk adımı bekliyor;
// termini geçmiş siparişlere bağlı açık işler "geciken" olur. Tarihler çapadan (−30…0 gün) türer; saat okunmaz.
// Tokensız geçişler (fason sevk, KK2, tambur, çuval okutma/tartı, duruş kapama) CANLI durumdan karar verir.
import { katlaAd } from "../lib/baglam.mjs";

export const RENKLER = [
  ["KREM", "Krem", "#f3ead7"], ["EKRU", "Ekru", "#efe6cf"], ["BEYAZ", "Beyaz", "#fbfbf8"], ["BEJ", "Bej", "#d8c3a0"],
  ["GRI", "Gri", "#9a9ea3"], ["ANTRASIT", "Antrasit", "#3d4248"], ["PUDRA", "Pudra", "#e8c4c0"], ["VIZON", "Vizon", "#a08c7a"],
];
/** Kurgu müşteriler (gerçek firma adı değil) — kartla cari hesap doğar. */
export const MUSTERILER = [
  ["Nilüfer Perde Dekorasyon", "Bursa"], ["Yıldız Ev Tekstili", "İstanbul"], ["Ege Tül ve Perde", "İzmir"],
  ["Başkent Döşemelik", "Ankara"], ["Akdeniz Home Collection", "Antalya"], ["Dicle Perde Ticaret", "Diyarbakır"],
];
export const TEDARIKCILER = [["Gemlik Polyester İplik", "Bursa"], ["Uludağ Ambalaj", "Bursa"]];
/** [kod, liste fiyatı TL/m] — kurulumun mevcut kumaş kalemleri. */
export const KUMASLAR = [["D2000", 118], ["D2001", 124], ["D2002", 112], ["D2003", 135], ["D2004", 129], ["D2005", 142],
  ["D2006", 108], ["D2007", 151], ["A5000", 96], ["BY-503", 164], ["BY-504", 158]];

// [anahtar, müşteri sırası (0–5 yeni · 6+ kurulumun mevcut müşterileri), sipariş günü, termin günü, satırlar [kumaş, metre, renk]]
export const SIPARISLER = [
  ["S01", 0, -29, -18, [["D2000", 900, "KREM"], ["D2003", 450, "BEYAZ"]]],
  ["S02", 1, -28, -16, [["D2001", 700, "EKRU"]]],
  ["S03", 2, -26, -14, [["D2002", 1100, "BEYAZ"], ["D2006", 400, "KREM"]]],
  ["S04", 3, -24, -12, [["BY-503", 600, "GRI"]]],
  ["S05", 4, -22, -9, [["D2004", 800, "PUDRA"]]],
  ["S06", 5, -20, -8, [["D2005", 650, "VIZON"], ["D2007", 300, "BEJ"]]],
  ["S07", 6, -18, -4, [["A5000", 750, "BEYAZ"]]],
  ["S08", 0, -16, -3, [["D2003", 520, "ANTRASIT"]]],
  ["S09", 1, -15, -2, [["BY-504", 480, "BEJ"]]],
  ["S10", 2, -13, -1, [["D2000", 600, "EKRU"]]],
  ["S11", 3, -11, 3, [["D2001", 840, "GRI"]]],
  ["S12", 4, -9, 5, [["BY-503", 560, "KREM"]]],
  ["S13", 7, -7, 6, [["D2002", 700, "PUDRA"]]],
  ["S14", 5, -5, 12, [["D2006", 500, "BEYAZ"], ["D2004", 350, "KREM"]]],
  ["S15", 8 % 9, -3, 14, [["D2007", 420, "VIZON"]]],
  ["S16", 0, -1, 18, [["D2005", 900, "BEYAZ"]]],
];

// [anahtar, sipariş, satır, top adedi, rota (STD: boya→KK2→tambur · BZ: boya→zımpara→KK2→tambur), hedef, top giriş günü]
// hedef: SEVK (bitti, sevk edildi) · DEPO (bitti, tartılmış çuvalda) · TAMBUR · KK2 · FASON (son fason adımında) · BEKLER
export const ISLER = [
  ["W01", "S01", 0, 4, "STD", "SEVK", -27], ["W02", "S02", 0, 3, "STD", "SEVK", -25], ["W03", "S03", 0, 4, "STD", "SEVK", -23],
  ["W04", "S04", 0, 3, "BZ", "SEVK", -21], ["W05", "S05", 0, 4, "STD", "SEVK", -19], ["W06", "S06", 0, 3, "STD", "SEVK", -16],
  ["W07", "S07", 0, 3, "STD", "DEPO", -13], ["W08", "S08", 0, 4, "STD", "TAMBUR", -11], ["W09", "S09", 0, 3, "BZ", "KK2", -9],
  ["W10", "S10", 0, 3, "STD", "KK2", -8], ["W11", "S11", 0, 4, "STD", "FASON", -6], ["W12", "S12", 0, 3, "BZ", "FASON", -5],
  ["W13", "S13", 0, 3, "STD", "FASON", -4], ["W14", "S14", 0, 3, "STD", "BEKLER", -2], ["W15", null, "D2003", 3, "STD", "DEPO", -10],
  ["W16", "S15", 0, 2, "STD", "BEKLER", -1],
];
/** Ham stok (iş emrine bağlanmamış KK1 topları) — [kumaş, metre, kalite]; A1 = 2. kalite. */
export const HAM_STOK = [["D2000", 112.4, "1.KALITE"], ["D2000", 108.9, "1.KALITE"], ["D2001", 118.2, "1.KALITE"], ["D2002", 121.6, "A1"],
  ["D2003", 104.3, "1.KALITE"], ["D2004", 115.8, "1.KALITE"], ["D2005", 98.7, "A1"], ["D2006", 119.4, "1.KALITE"],
  ["A5000", 125.0, "1.KALITE"], ["BY-503", 101.2, "1.KALITE"], ["BY-504", 96.5, "A1"], ["D2007", 110.0, "1.KALITE"]];

const SIRA = ["SEVK", "DEPO", "TAMBUR", "KK2", "FASON", "BEKLER"];
const gecti = (hedef, asama) => SIRA.indexOf(hedef) < SIRA.indexOf(asama); // hedef, aşamadan İLERİDE mi
/** Belirlenimli top metresi (92–128 m). */
const metre = (key, i) => +(92 + ((key.charCodeAt(1) * 7 + key.charCodeAt(2) * 13 + i * 17) % 36) + (i % 3) * 0.4).toFixed(1);
/** Tokensız geçiş: 409 = zaten yapılmış (yarış/yeniden koşum) ⇒ mevcut say. */
const yaz409 = async (c, modul, gerekli, fn) => {
  try { return await c.kosulluYaz(modul, gerekli, fn); } catch (e) { if (e.status === 409) { c.say(modul, "mevcut"); return null; } throw e; }
};
const uyari = (c, ne, e) => { console.log(`  ⚠ ${ne}: ${String(e.message).slice(0, 260)}`); c.say("atlandi", "yeni"); };

export async function patronOrnek(c) {
  const k = {};
  await anaVeri(c, k);
  await siparisler(c, k);
  await hamStok(c, k);
  for (const is of ISLER) {
    try { await isEmri(c, k, is); } catch (e) { if (/aynı token/.test(e.message)) throw e; uyari(c, `iş emri ${is[0]}`, e); }
  }
  await finans(c, k);
  await dokuma(c, k);
}

async function anaVeri(c, k) {
  const renkler = await c.hepsi("/api/colors");
  k.renk = {};
  for (const [code, name, hex] of RENKLER) {
    const v = renkler.find((x) => x.code === code || katlaAd(x.name) === katlaAd(name));
    if (v) { c.say("renk", "mevcut"); k.renk[code] = v.id; continue; }
    const r = await c.tokenli("renk", `dv3:renk:${code}`, "/api/colors", { code, name, hex });
    k.renk[code] = (r.data ?? r).id;
  }
  const cariBul = async (name) => (await c.hepsi(`/api/customers?search=${encodeURIComponent(name.split(" ")[0])}`)).find((x) => katlaAd(x.name) === katlaAd(name));
  const yeni = [];
  for (const [name, city] of MUSTERILER) {
    const m = await c.bulYaDaYarat("cari", () => cariBul(name),
      async () => (await c.api("POST", "/api/customers", { name, city, isCustomerRole: true, isSupplierRole: false }, { tekDeneme: true })).data);
    yeni.push(m.id);
  }
  k.tedarikci = [];
  for (const [name, city] of TEDARIKCILER) {
    const m = await c.bulYaDaYarat("cari", () => cariBul(name),
      async () => (await c.api("POST", "/api/customers", { name, city, isCustomerRole: false, isSupplierRole: true }, { tekDeneme: true })).data);
    k.tedarikci.push(m.id);
  }
  const eski = (await c.hepsi("/api/customers")).filter((x) => x.isActive && x.isCustomerRole && !yeni.includes(x.id)).sort((a, b) => a.code.localeCompare(b.code)).map((x) => x.id);
  k.musteriler = [...yeni, ...eski];
  const kalemler = await c.hepsi("/api/items?filter[itemType]=FABRIC");
  k.kalem = {};
  for (const [code] of KUMASLAR) {
    const it = kalemler.find((x) => x.code === code);
    if (!it) throw new Error(`kumaş ${code} kurulumda yok`);
    k.kalem[code] = { id: it.id, en: Number(it.widthCm ?? it.rawWidthCm ?? 315), warpSpecId: it.warpSpecId };
  }
  k.fiyat = Object.fromEntries(KUMASLAR);
  const ist = (await c.hepsi("/api/stations")).filter((s) => s.isActive);
  const byCode = (code) => ist.find((s) => s.code === code);
  const tur = (kind) => ist.filter((s) => s.kind === kind && s.allowAsWorkOrderStep !== false).sort((a, b) => a.code.localeCompare(b.code))[0];
  k.ist = {
    BOYA: byCode("BOYA_FASON") ?? ist.find((s) => s.kind === "SUBCONTRACTOR" && /BOYA/.test(s.code)),
    ZIMPARA: byCode("ZIMPARA_FASON") ?? ist.find((s) => s.kind === "SUBCONTRACTOR" && /ZIMPARA/.test(s.code)),
    KK2: tur("PROCESS_QC"), TAMBUR: byCode("TAMBUR_1") ?? tur("TAMBUR"),
  };
  for (const [a, s] of Object.entries(k.ist)) if (!s) throw new Error(`rota istasyonu yok: ${a}`);
  const fasonlar = (await c.hepsi("/api/subcontractors")).filter((x) => x.isActive !== false);
  const fasonOf = (kat) => fasonlar.find((f) => (f.categories ?? []).some((x) => (x.category?.code ?? x.code) === kat)) ?? fasonlar.find((f) => new RegExp(kat === "BOYA" ? "BOY" : "ZIMP", "i").test(f.name));
  k.fason = { BOYA: fasonOf("BOYA"), ZIMPARA: fasonOf("ZIMPARA") };
  if (!k.fason.BOYA || !k.fason.ZIMPARA) throw new Error("boya/zımpara fason firması yok");
}

async function siparisler(c, k) {
  k.siparis = {};
  for (const [key, mi, og, tg, satirlar] of SIPARISLER) {
    const musteri = k.musteriler[mi % k.musteriler.length];
    const o = await c.tokenli("siparis", `dv3:siparis:${key}`, "/api/orders", {
      customerId: musteri, orderDate: c.an(og, 10), deadline: c.an(tg, 17), currency: "TRY", destination: "DOMESTIC",
      lines: satirlar.map(([kod, q, renk]) => ({ itemId: k.kalem[kod].id, quantity: q, width: k.kalem[kod].en, unitPrice: k.fiyat[kod], colorId: k.renk[renk] })),
    });
    const tam = (await c.api("GET", `/api/orders/${o.id}`)).data ?? o;
    // Satır kimliği KUMAŞTAN eşlenir (yanıtın satır sırası belirlenimli değil; sıra kayarsa iş emri replay'i çakışır)
    const satirId = satirlar.map(([kod]) => (tam.lines ?? []).find((l) => l.itemId === k.kalem[kod].id)?.id);
    k.siparis[key] = { id: o.id, no: tam.orderNumber, musteri, satirlar, satirId };
  }
}

/** KK1 girişi (ham top, tokenlı). Giriş saati çapadan; aynı anahtar ⇒ aynı top. */
async function kk1(c, anahtar, kod, m, grade, colorId, gun, saat) {
  const r = await c.tokenli("kk1-top", anahtar, "/api/rolls/initial-entry", {
    itemId: c.k.kalem[kod].id, colorId, initialQty: m, width: c.k.kalem[kod].en, qualityGrade: grade, clientEnteredAt: c.an(gun, saat),
  });
  return { id: r.id, bc: r.barcode, m };
}

async function hamStok(c, k) {
  c.k = k;
  for (const [i, [kod, m, grade]] of HAM_STOK.entries()) await kk1(c, `dv3:top:STK:${i}`, kod, m, grade, null, -14 + i, 9 + (i % 4));
}

async function isEmri(c, k, [key, sk, satir, adet, rota, hedef, gun]) {
  const sip = sk ? k.siparis[sk] : null;
  const [kod, , renk] = sip ? sip.satirlar[satir] : [satir, 0, "BEYAZ"];
  const toplar = [];
  for (let i = 0; i < adet; i++) toplar.push(await kk1(c, `dv3:top:${key}:${i}`, kod, metre(key, i), "1.KALITE", null, gun, 8 + i * 0.5));
  const adimlar = rota === "BZ" ? [k.ist.BOYA, k.ist.ZIMPARA, k.ist.KK2, k.ist.TAMBUR] : [k.ist.BOYA, k.ist.KK2, k.ist.TAMBUR];
  const d = await c.tokenli("is-emri", `dv3:ie:${key}`, "/api/work-orders/quick-start", {
    rollBarcodes: toplar.map((t) => t.bc), orderLineIds: sip ? [sip.satirId[satir]] : undefined, targetItemId: k.kalem[kod].id, targetColorId: k.renk[renk],
    steps: adimlar.map((s) => ({ stationId: s.id, plannedSubcontractorId: s === k.ist.BOYA ? k.fason.BOYA.id : s === k.ist.ZIMPARA ? k.fason.ZIMPARA.id : null })),
  });
  const woId = (d.workOrder ?? d).id;
  const wo = async () => (await c.api("GET", `/api/work-orders/${woId}`)).data;
  const adimOf = async (istasyon) => (await wo()).steps.find((a) => a.stationId === istasyon.id);
  /** İş emrinin canlı topları — liste adım/çuval taşımaz ⇒ tüketilmemiş her top detaydan (currentStepId · sackId · operations). */
  const woToplar = async () => {
    const j = await c.api("GET", `/api/work-orders/${woId}/rolls`);
    const out = [];
    for (const t of (j.data?.rolls ?? j.data ?? []).filter((x) => !/CONSUMED|SCRAP|CANCEL/.test(x.status))) out.push((await c.api("GET", `/api/rolls/${t.id}`)).data ?? t);
    return out;
  };
  const adimdakiler = async (a) => (await woToplar()).filter((t) => t.currentStepId === a.id && ["IN_PRODUCTION", "AT_SUBCONTRACTOR"].includes(t.status));
  if (hedef === "BEKLER") return;

  // Fason adımları (sırayla): sevk → (hedef FASON ve son fason adımıysa dur) → tam kabul (boyada %3 çekme)
  const fasonAdim = rota === "BZ" ? [["BOYA", k.ist.BOYA], ["ZIMPARA", k.ist.ZIMPARA]] : [["BOYA", k.ist.BOYA]];
  for (const [n, [kat, istasyon]] of fasonAdim.entries()) {
    const a = await adimOf(istasyon);
    if (a.status === "COMPLETED") { c.say("fason-kabul", "mevcut"); continue; }
    const bekleyen = (await adimdakiler(a)).filter((t) => t.status === "IN_PRODUCTION").map((t) => t.id).sort();
    await yaz409(c, "fason-sevk", async () => bekleyen.length > 0, () => c.api("POST", "/api/subcontractor/dispatch", {
      workOrderId: woId, stepId: a.id, subcontractorId: k.fason[kat].id, rollIds: bekleyen, plateNumber: "16 SYT 41" + n,
      instruction: kat === "BOYA" ? "Numune tonunda boya, haslık kontrolü" : "Tek yüz zımpara, orta sertlik",
    }));
    if (hedef === "FASON" && n === fasonAdim.length - 1) return;
    const fasonda = (await adimdakiler(a)).filter((t) => t.status === "AT_SUBCONTRACTOR").sort((x, y) => String(x.id).localeCompare(String(y.id)));
    if (!fasonda.length) continue;
    await c.tokenli("fason-kabul", `dv3:fason-kabul:${key}:${kat}`, "/api/subcontractor/receive", {
      workOrderId: woId, stepId: a.id, subcontractorId: k.fason[kat].id, manifestNo: `${kat === "BOYA" ? "BYR" : "KST"}-${key}`,
      returns: fasonda.map((t) => ({ rollId: t.id })),
      newRolls: fasonda.map((t) => ({ qty: +(Number(t.currentQty ?? t.initialQty) * (kat === "BOYA" ? 0.97 : 0.99)).toFixed(1) })),
    });
  }

  // Boyahane dönüşü açık kumaş renksiz doğarsa (kabul renk taşımadı) iş emri rengi toplara işlenir — yoksa tambur PLAN_MISMATCH verir
  const renksiz = (await woToplar()).filter((t) => t.status === "IN_PRODUCTION" && !t.colorId).map((t) => t.id).sort();
  await yaz409(c, "renk-isle", async () => renksiz.length > 0,
    () => c.api("POST", `/api/work-orders/${woId}/apply-attribute-to-rolls`, { rollIds: renksiz, colorId: k.renk[renk], reason: "Boyahane dönüşü — iş emri rengi toplara işlendi" }));

  // KK2 (Kurşun): hedef KK2 ise yalnız ilk top (adım yarım); ileri hedefte tümü + adım bitir
  const kk2 = await adimOf(k.ist.KK2);
  const kk2Toplar = (await adimdakiler(kk2)).sort((x, y) => String(x.barcode).localeCompare(String(y.barcode)));
  for (const t of hedef === "KK2" ? kk2Toplar.slice(0, 1) : kk2Toplar) {
    await yaz409(c, "kk2", async () => !(t.operations ?? []).some((o) => o.operationType === "QC2_COMPLETED" && !o.revokedAt),
      () => c.api("POST", "/api/kursun-qc/complete-qc2", { rollId: t.id, stepId: kk2.id }));
  }
  if (hedef === "KK2") return;
  await yaz409(c, "kk2-adim-bitir", async () => (await adimOf(k.ist.KK2)).status === "ACTIVE", () => c.api("POST", "/api/kursun-qc/finish-step", { stepId: kk2.id }));

  // Tambur: her 3. topta 4–8 m A1 (2. kalite) parça; hedef TAMBUR ise yalnız ilk top kesilir
  const tb = await adimOf(k.ist.TAMBUR);
  const tbToplar = (await adimdakiler(tb)).filter((t) => t.status === "IN_PRODUCTION").sort((x, y) => String(x.barcode).localeCompare(String(y.barcode)));
  for (const [i, t] of (hedef === "TAMBUR" ? tbToplar.slice(0, 1) : tbToplar).entries()) {
    const m = Number(t.currentQty ?? t.initialQty);
    const a1 = i % 3 === 1 ? 4 + (i % 5) : 0;
    const cuts = a1 ? [{ length: +(m - a1).toFixed(1), qualityGrade: "1.KALITE", relatedErrorIds: [] }, { length: a1, qualityGrade: "A1", relatedErrorIds: [] }]
      : [{ length: m, qualityGrade: "1.KALITE", relatedErrorIds: [] }];
    await yaz409(c, "tambur", async () => true, () => c.api("POST", "/api/tambur/finalize", { rollId: t.id, cuts, decisions: [], foldType: "2-KAT" }));
  }
  if (hedef === "TAMBUR") return;
  await yaz409(c, "is-emri-bitir", async () => !["COMPLETED", "CANCELLED", "SUPERSEDED"].includes((await wo()).status),
    () => c.api("POST", `/api/work-orders/${woId}/complete`, {}));

  // Çuval + tartı (+ sevkiyat): mamuller depoda (WAREHOUSE)
  const musteri = sip?.musteri ?? null;
  if (!musteri) return; // stok üretimi depoda kalır
  const sack = await c.tokenli("cuval", `dv3:cuval:${key}`, "/api/shipping/sacks", { customerId: musteri });
  const mamuller = (await woToplar()).filter((t) => t.status === "WAREHOUSE" && t.sackId !== sack.id);
  for (const r of mamuller) await yaz409(c, "cuval-okutma", async () => !r.sackId, () => c.api("POST", `/api/shipping/sacks/${sack.id}/scan`, { barcode: r.barcode }));
  const toplamM = toplar.reduce((t, x) => t + x.m, 0);
  await c.kosulluYaz("cuval-tarti", async () => !(await c.api("GET", `/api/shipping/sacks/${sack.id}/contents`)).data?.weightKg,
    () => c.api("POST", `/api/shipping/sacks/${sack.id}/weigh`, { weightKg: +(toplamM * 0.105).toFixed(1), source: "MANUAL" }));
  if (hedef !== "SEVK") return;
  const sh = await c.tokenli("sevkiyat", `dv3:sevk:${key}`, "/api/shipping/shipments", {
    sackIds: [sack.id], customerId: musteri, orderIds: [sip.id], plateNumber: `16 SYT ${300 + Number(key.slice(1))}`, driverName: "Sevk şoförü", destination: "DOMESTIC",
  });
  (k.sevkler ??= []).push({ key, id: sh.id, musteri });
}

async function finans(c, k) {
  const bul = async (yol, ad) => (await c.hepsi(yol)).find((x) => katlaAd(x.name) === katlaAd(ad));
  const kasa = await c.bulYaDaYarat("kasa", () => bul("/api/finance/cash-boxes", "Merkez Kasa"),
    async () => (await c.api("POST", "/api/finance/cash-boxes", { name: "Merkez Kasa", currency: "TRY", notes: "Ana kasa" }, { tekDeneme: true })).data);
  const banka = await c.bulYaDaYarat("banka", () => bul("/api/finance/bank-accounts", "Vadesiz TL Hesap"),
    async () => (await c.api("POST", "/api/finance/bank-accounts", { name: "Vadesiz TL Hesap", bankName: "Ziraat Bankası", currency: "TRY" }, { tekDeneme: true })).data);
  await c.tokenli("kasa-hareketi", "dv3:fin:acilis:kasa", "/api/finance/cash-transactions", { kind: "OPENING", cashBoxId: kasa.id, amount: "35000", txnDate: c.gunStr(-30), description: "Açılış bakiyesi" });
  await c.tokenli("kasa-hareketi", "dv3:fin:acilis:banka", "/api/finance/cash-transactions", { kind: "OPENING", bankAccountId: banka.id, amount: "420000", txnDate: c.gunStr(-30), description: "Açılış bakiyesi" });

  // Devir bakiyeleri (önceki dönemden alacak) — tahsilatlar 30 güne yayılır
  const m = k.musteriler;
  for (const [mi, bakiye] of [[0, "86500.00"], [1, "42300.00"], [2, "128900.00"], [3, "37750.00"], [4, "64200.00"], [5, "21800.00"]]) {
    try {
      const cari = (await c.api("GET", `/api/finance/cari/by-customer/${m[mi]}`)).data;
      await c.api("POST", `/api/finance/cari/${cari.id}/opening-balance`, { currency: "TRY", balance: bakiye, description: "Önceki dönem devir bakiyesi", txnDate: c.gunStr(-30) });
      c.say("cari-devir", "yeni");
    } catch (e) { if (e.status === 409) c.say("cari-devir", "mevcut"); else uyari(c, `devir ${mi}`, e); }
  }
  const TAHSILAT = [[0, "25000.00", "BANK_TRANSFER", -26], [2, "40000.00", "BANK_TRANSFER", -24], [1, "12500.00", "CASH", -21], [4, "30000.00", "BANK_TRANSFER", -17],
    [3, "15000.00", "BANK_TRANSFER", -13], [2, "35000.00", "BANK_TRANSFER", -10], [5, "8000.00", "CASH", -7], [0, "20000.00", "BANK_TRANSFER", -5], [4, "18500.00", "BANK_TRANSFER", -2]];
  for (const [i, [mi, amount, method, gun]] of TAHSILAT.entries()) {
    await c.tokenli("tahsilat-odeme", `dv3:fin:tahsilat:${i}`, "/api/finance/payments", {
      direction: "IN", method, customerId: m[mi], currency: "TRY", amount, cashBoxId: method === "CASH" ? kasa.id : null, bankAccountId: method === "CASH" ? null : banka.id,
      notes: method === "CASH" ? "Nakit tahsilat" : "Havale ile tahsilat", paymentDate: c.gunStr(gun),
    });
  }
  const onayla = async (id) => c.kosulluYaz("fatura-onay", async () => (await c.api("GET", `/api/finance/invoices/${id}`)).data?.status === "DRAFT",
    () => c.api("POST", `/api/finance/invoices/${id}/confirm`, {}));
  // Sevkiyat faturaları (sevk günü = bugün; liste fiyatı sipariş satırından)
  for (const s of k.sevkler ?? []) {
    try {
      const p = (await c.api("GET", `/api/finance/shipments/${s.id}/invoice-draft-lines`)).data;
      if (!p?.lines?.length) continue;
      const inv = await c.tokenli("fatura", `dv3:fin:fatura:${s.key}`, "/api/finance/invoices", {
        type: "SALES", customerId: s.musteri, currency: p.currency ?? "TRY", shipmentId: s.id, issueDate: c.gunStr(0), dueDate: c.gunStr(60),
        lines: p.lines.map((l) => ({ itemId: l.itemId ?? null, description: l.description, qty: String(l.qty), unit: l.unit, unitPrice: String(Number(l.unitPrice) > 0 ? l.unitPrice : 120), vatRate: String(l.vatRate ?? 20) })),
      });
      await onayla(inv.id);
    } catch (e) { if (/aynı token/.test(e.message)) throw e; uyari(c, `fatura ${s.key}`, e); }
  }
  // Alış: iplik ve ambalaj faturaları + ödemeler
  const [iplikci, ambalajci] = k.tedarikci;
  for (const [key, sup, gun, ext, desc, qty, unit, fiyat] of [
    ["AF1", iplikci, -27, "GPI-2026-1021", "PES 70/800 çözgü ipliği", "1850", "KG", "92.40"], ["AF2", iplikci, -15, "GPI-2026-1102", "PES döner atkı ipliği", "1400", "KG", "88.75"],
    ["AF3", ambalajci, -12, "ULA-2026-0588", "Top ambalaj naylonu ve karton masura", "1", "ADET", "18600"], ["AF4", iplikci, -4, "GPI-2026-1110", "PES 70/800 çözgü ipliği", "1200", "KG", "93.10"],
  ]) {
    try {
      const inv = await c.tokenli("fatura", `dv3:fin:alis:${key}`, "/api/finance/invoices", {
        type: "PURCHASE", customerId: sup, currency: "TRY", issueDate: c.gunStr(gun), dueDate: c.gunStr(gun + 45), externalNo: ext,
        lines: [{ description: desc, qty, unit, unitPrice: fiyat, vatRate: "20" }],
      });
      await onayla(inv.id);
    } catch (e) { if (/aynı token/.test(e.message)) throw e; uyari(c, `alış faturası ${key}`, e); }
  }
  for (const [key, sup, amount, gun] of [["O1", iplikci, "120000.00", -20], ["O2", ambalajci, "22320.00", -8], ["O3", iplikci, "75000.00", -3]]) {
    await c.tokenli("tahsilat-odeme", `dv3:fin:odeme:${key}`, "/api/finance/payments", {
      direction: "OUT", method: "BANK_TRANSFER", customerId: sup, currency: "TRY", amount, cashBoxId: null, bankAccountId: banka.id, notes: "Tedarikçi ödemesi", paymentDate: c.gunStr(gun),
    });
  }
  // Kasa giderleri (30 güne yayılı)
  for (const [i, [amount, category, description, gun]] of [
    ["2850.00", "Kargo", "Numune ve kartela kargoları", -28], ["4200.00", "Akaryakıt", "Servis aracı yakıt", -25], ["6800.00", "Yemek", "Vardiya yemek gideri", -21],
    ["1450.00", "Kırtasiye", "Etiket rulosu ve toner", -18], ["9750.00", "Bakım", "Tezgah yedek parça", -14], ["3900.00", "Akaryakıt", "Servis aracı yakıt", -11],
    ["7100.00", "Yemek", "Vardiya yemek gideri", -7], ["2300.00", "Temizlik", "Salon temizlik malzemesi", -4], ["1980.00", "Kargo", "Müşteri numune gönderimi", -1],
  ].entries()) {
    await c.tokenli("kasa-hareketi", `dv3:fin:gider:${i}`, "/api/finance/cash-transactions", { kind: "EXPENSE", cashBoxId: kasa.id, amount, category, description, txnDate: c.gunStr(gun) });
  }
  // Çekler: portföy · bankada · tahsil
  for (const [key, mi, amount, vade, bankName, hedef, gun] of [
    ["C1", 2, "55000.00", 35, "Akbank", "PORTFOLIO", -20], ["C2", 0, "32500.00", 21, "Garanti BBVA", "AT_BANK", -16],
    ["C3", 4, "47800.00", 48, "İş Bankası", "PORTFOLIO", -9], ["C4", 1, "18200.00", -2, "Halkbank", "COLLECTED", -28],
  ]) {
    try {
      const ch = await c.tokenli("cek", `dv3:fin:cek:${key}`, "/api/finance/cheques", {
        kind: "RECEIVED", docType: "CHEQUE", customerId: m[mi], currency: "TRY", amount, issueDate: c.gunStr(gun), dueDate: c.gunStr(vade), serialNo: `SY${key}-${amount.split(".")[0]}`, bankName, notes: "Müşteri çeki",
      });
      const durum = async () => (await c.api("GET", `/api/finance/cheques/${ch.id}`)).data?.status;
      if (hedef === "AT_BANK") await c.kosulluYaz("cek-gecis", async () => (await durum()) === "PORTFOLIO", () => c.api("POST", `/api/finance/cheques/${ch.id}/deposit`, { bankAccountId: banka.id, eventDate: c.gunStr(-3) }));
      if (hedef === "COLLECTED") await c.kosulluYaz("cek-gecis", async () => (await durum()) === "PORTFOLIO", () => c.api("POST", `/api/finance/cheques/${ch.id}/collect`, { bankAccountId: banka.id, eventDate: c.gunStr(-1) }));
    } catch (e) { if (/aynı token/.test(e.message)) throw e; uyari(c, `çek ${key}`, e); }
  }
}

async function dokuma(c, k) {
  // Dokuma işleri: kurulumun kumaşları kendi çözgü kartıyla
  for (const [key, kod, m, s, e, notes] of [["DK1", "D2000", 3200, -12, 6, "Krem/beyaz siparişleri için"], ["DK2", "D2003", 2600, -6, 9, null], ["DK3", "BY-503", 1800, 2, 15, "Armür — planlı"]]) {
    const it = k.kalem[kod];
    if (!it.warpSpecId) { console.log(`  · ${kod} çözgü kartı yok — dokuma işi atlandı`); continue; }
    try {
      await c.tokenli("dokuma-isi", `dv3:dk:${key}`, "/api/weaving-orders", { itemId: it.id, warpSpecId: it.warpSpecId, plannedM: m, executionKind: "IN_HOUSE", plannedStartDate: c.an(s, 6), plannedEndDate: c.an(e, 18), notes });
    } catch (er) { if (/aynı token/.test(er.message)) throw er; uyari(c, `dokuma işi ${key}`, er); }
  }
  // Tezgah duruşları: son 7 gün, tezgah başına günde bir (kapalı) — "Makineler neden durdu?"
  const tezgahlar = (await c.hepsi("/api/machines")).filter((x) => x.isActive !== false && /TEZG/i.test(x.name)).sort((a, b) => a.code.localeCompare(b.code));
  const SEBEP = ["ATKI_KOPUSU", "COZGU_KOPUSU", "KENAR_KOPUSU", "IPLIK_BITTI", "MEKANIK_ARIZA", "TOP_ALMA", "LEVENT_BAGLAMA", "TARAK_DEGISIMI", "DONER_COZGU_KOPUSU", "OPERATOR_YOK", "ELEKTRIK_KESINTISI", "PLANLI_BAKIM"];
  for (const [i, t] of tezgahlar.entries()) {
    for (let g = -7; g <= -1; g++) {
      const sebep = SEBEP[(i * 5 + g * 7 + 120) % SEBEP.length];
      const sure = sebep === "MEKANIK_ARIZA" ? 70 : sebep === "PLANLI_BAKIM" ? 120 : sebep === "LEVENT_BAGLAMA" ? 95 : sebep === "ELEKTRIK_KESINTISI" ? 40 : 6 + ((i + g + 30) % 14);
      const bas = 7 + ((i * 3 + g + 40) % 14) + 0.25;
      try {
        const st = await c.tokenli("tezgah-durus", `dv3:durus:${t.code}:${g}`, "/api/machine-stops", { machineId: t.id, startedAt: c.an(g, bas), reasonCode: sebep });
        await c.kosulluYaz("tezgah-durus-kapa", async () => !st.endedAt,
          () => c.api("POST", `/api/machine-stops/${st.id}/close`, { endedAt: c.an(g, bas + sure / 60) }));
      } catch (e) { if (/aynı token/.test(e.message)) throw e; uyari(c, `duruş ${t.code} ${g}`, e); }
    }
  }
}
