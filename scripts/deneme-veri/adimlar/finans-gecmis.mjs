// Finans geçmişi (dolgu-2): son 60 günün SEVK EDİLMİŞ sevkiyatlarından satış faturası (tarih = sevk günü, vade 60 gün) ·
// eski faturalara havale tahsilatı + fatura kapama · yeni çekler (farklı vade/durum) · mal kabule bağlı alış faturaları
// (n irsaliye → 1 fatura) · kasa giderleri · iade belgesine satış iade faturası · mutabakat mektupları.
// Seçim ÇAPAYA bağlıdır (pencere çapa−60 … çapa−2, sevk no sırası, fatura durumundan BAĞIMSIZ) ⇒ ikinci koşum aynı
// sevkiyatları seçer, token replay'e düşer. Sevk taslağında fiyat yoksa (siparişsiz eski sevk) kalem başına belirlenimli
// liste fiyatı kullanılır. Defter yalnız servis yolundan doğar; onay/kapama/mektup canlı durumdan karar verir.
import { createHash } from "node:crypto";
import { katlaAd } from "../lib/baglam.mjs";
import { iadeListesi } from "./kalite.mjs";

export const FATURA_SAYISI = 24;
const USD_KUR = "49.30";
/** Kalem başına belirlenimli m fiyatı (TL): 95–185, 5'lik. */
export const listeFiyati = (itemId) => 95 + (createHash("sha1").update(String(itemId)).digest()[0] % 19) * 5;
const gunEkle = (ymd, g) => new Date(Date.parse(ymd + "T12:00:00+03:00") + g * 86_400_000).toISOString().slice(0, 10);
/** Fabrika günü (İstanbul, +03:00 sabit — dilim kuralı backend'de; burada gövde belirlenimi için). */
const fabrikaGunu = (iso) => new Date(Date.parse(iso) + 3 * 3_600_000).toISOString().slice(0, 10);

export async function finansGecmis(c) {
  const k = c.kayit;
  const bul = async (yol, ad) => (await c.hepsi(yol)).find((x) => katlaAd(x.name) === katlaAd(ad));
  const TL_KASA = (await bul("/api/finance/cash-boxes", "Merkez Kasa"))?.id;
  const TL_BANKA = (await bul("/api/finance/bank-accounts", "Vadesiz TL Hesap"))?.id;
  if (!TL_KASA || !TL_BANKA) throw new Error("finans-gecmis: önce 'finans' adımı (Merkez Kasa / Vadesiz TL Hesap)");
  const onayla = async (id) => c.kosulluYaz("fatura-onay", async () => (await c.api("GET", `/api/finance/invoices/${id}`)).data?.status === "DRAFT",
    () => c.api("POST", `/api/finance/invoices/${id}/confirm`, {}));

  // 1) Sevkiyattan satış faturaları
  const bas = Date.parse(c.an(-60, 0)), son = Date.parse(c.an(-1, 0));
  const sevkler = (await c.hepsi("/api/shipping/shipments?status=DISPATCHED"))
    .filter((s) => s.kind !== "DIRECT" && s.status === "DISPATCHED" && s.dispatchedAt && Date.parse(s.dispatchedAt) >= bas && Date.parse(s.dispatchedAt) < son && Number(s.totalMeters ?? 0) > 0 && s.customer?.id)
    // Dış muhasebe izi (invoiceNo) taşıyan ama iç faturası olmayan sevk atlanır: onay o izle çakışır (409, çift faturalama).
    // Kendi faturamız onayda izi kendisi basar ve `invoices`ta görünür ⇒ seçim ikinci koşumda da aynı kalır.
    .filter((s) => !s.invoiceNo || (s.invoices ?? []).some((x) => x.status !== "CANCELLED"))
    .sort((a, b) => String(b.shipmentNo).localeCompare(String(a.shipmentNo)))
    .slice(0, FATURA_SAYISI);
  const faturalar = [];
  for (const s of sevkler) {
    const anahtar = `dv2:fin:fatura:sevk:${s.id}`;
    const kendi = (s.invoices ?? []).length > 0;
    let inv;
    if (kendi) {
      // Zaten faturalı (bu adım ya da elle) — yalnız kendi faturamızı izlemek için listeden okunur
      inv = (s.invoices ?? []).find((x) => x.status !== "CANCELLED");
      c.say("fatura", "mevcut");
      if (!inv) continue;
      inv = (await c.api("GET", `/api/finance/invoices/${inv.id}`)).data;
    } else {
      const p = (await c.api("GET", `/api/finance/shipments/${s.id}/invoice-draft-lines`)).data;
      if (!p?.lines?.length) continue;
      // Döviz carisinde kur uydurulmaz (kur tablosu kurulumdan kuruluma değişir) — yalnız TL sevkler faturalanır
      if ((p.currency ?? "TRY") !== "TRY") { console.log(`  · ${s.shipmentNo} ${p.currency} — atlandı (yalnız TL)`); c.say("fatura-atlandi", "mevcut"); continue; }
      const issueDate = fabrikaGunu(s.dispatchedAt);
      try {
      inv = await c.tokenli("fatura", anahtar, "/api/finance/invoices", {
        type: "SALES", customerId: s.customer.id, currency: p.currency ?? "TRY", shipmentId: s.id, issueDate, dueDate: gunEkle(issueDate, 60),
        lines: p.lines.map((l) => ({
          itemId: l.itemId ?? null, description: l.description, qty: String(l.qty), unit: l.unit,
          unitPrice: String(Number(l.unitPrice) > 0 ? l.unitPrice : l.itemId ? listeFiyati(l.itemId) : 120), vatRate: String(l.vatRate ?? 20),
        })),
      });
      await onayla(inv.id);
      } catch (e) {
        // Tek sevkin kesin 4xx'i (ör. emanet/fiyat kapısı) bütün adımı durdurmaz; görünür bırakılır. Token çakışması yine durur.
        if (!e.status || e.status >= 500 || /aynı token/.test(e.message)) throw e;
        console.log(`  ⚠ ${s.shipmentNo} faturalanamadı: ${e.message.slice(0, 200)}`); c.say("fatura-atlandi", "yeni"); continue;
      }
      inv = (await c.api("GET", `/api/finance/invoices/${inv.id}`)).data;
    }
    faturalar.push({ ...inv, sevkGunu: fabrikaGunu(s.dispatchedAt) });
  }
  k.faturalar2 = faturalar;

  // 2) Tahsilat + kapama: sevk günü çapadan ≥ 20 gün önce olan faturaların 3'te 2'si; çift sırada tam, tek sırada kısmi
  const capGun = c.gunStr(0);
  const eski = faturalar.filter((f) => f.type === "SALES" && f.status === "CONFIRMED" && f.sevkGunu <= gunEkle(capGun, -20) && f.currency === "TRY")
    .sort((a, b) => String(a.docNo).localeCompare(String(b.docNo)));
  for (const [i, f] of eski.entries()) {
    if (i % 3 === 2) continue; // vadesi gelmemiş/ödenmemiş kalsın (yaşlandırma dolsun)
    const toplam = Number(f.grandTotal);
    const tutar = i % 2 === 0 ? toplam : Math.round(toplam * 0.5);
    // Başkasının (elle) tahsil ettiği fatura atlanır; kendi tahsilatımız tam `tutar` kadardır ⇒ ikinci koşum replay'e düşer.
    const odenen = Number(f.paidTotal ?? 0);
    if (odenen > 0 && Math.abs(odenen - tutar) > 0.005) continue;
    const odemeGunu = [gunEkle(f.sevkGunu, 21 + (i % 3) * 7), gunEkle(capGun, -1)].sort()[0];
    const customerId = f.cari?.customer?.id ?? f.customerId ?? f.cari?.customerId;
    if (!customerId) continue;
    const pay = await c.tokenli("tahsilat-odeme", `dv2:fin:tahsilat:${f.id}`, "/api/finance/payments", {
      direction: "IN", method: "BANK_TRANSFER", customerId, currency: "TRY", amount: tutar.toFixed(2), cashBoxId: null, bankAccountId: TL_BANKA,
      notes: `${f.docNo} fatura tahsilatı`, paymentDate: odemeGunu,
    });
    await c.kosulluYaz("fatura-kapama", async () => {
      const a = await c.api("GET", `/api/finance/allocations?paymentId=${pay.id}`);
      const satir = a.data ?? a.items ?? [];
      return !(Array.isArray(satir) ? satir : []).some((x) => !x.revokedAt);
    }, () => c.api("POST", "/api/finance/allocations", { invoiceId: f.id, paymentId: pay.id, amount: tutar.toFixed(2), notes: "Havale ile kapama" }));
  }

  // 3) Çekler — fatura müşterilerinden (yoksa deneme müşterileri), vade yayılımı
  const musteriler = [...new Set(faturalar.map((f) => f.cari?.customer?.id ?? f.customerId).filter(Boolean)), ...k.musteriler.map((m) => m.id)];
  const CEKLER = [
    ["C5", 0, "62000.00", 15, "Akbank", "PORTFOLIO"], ["C6", 1, "38500.00", 38, "Garanti BBVA", "PORTFOLIO"],
    ["C7", 2, "91000.00", 62, "İş Bankası", "PORTFOLIO"], ["C8", 3, "27750.00", 9, "Vakıfbank", "AT_BANK"],
    ["C9", 4, "15400.00", -3, "Yapı Kredi", "COLLECTED"],
  ];
  for (const [key, mi, amount, vade, bankName, hedef] of CEKLER) {
    const customerId = musteriler[mi % musteriler.length];
    const ch = await c.tokenli("cek", `dv2:fin:cek:${key}`, "/api/finance/cheques", {
      kind: "RECEIVED", docType: "CHEQUE", customerId, currency: "TRY", amount, issueDate: c.gunStr(-12 - mi * 3), dueDate: c.gunStr(vade),
      serialNo: `DV2${key}-${amount.split(".")[0]}`, bankName, notes: "Müşteri çeki — fatura karşılığı",
    });
    const durum = async () => (await c.api("GET", `/api/finance/cheques/${ch.id}`)).data?.status;
    if (hedef === "AT_BANK") await c.kosulluYaz("cek-gecis", async () => (await durum()) === "PORTFOLIO", () => c.api("POST", `/api/finance/cheques/${ch.id}/deposit`, { bankAccountId: TL_BANKA, eventDate: c.gunStr(-2) }));
    if (hedef === "COLLECTED") await c.kosulluYaz("cek-gecis", async () => (await durum()) === "PORTFOLIO", () => c.api("POST", `/api/finance/cheques/${ch.id}/collect`, { bankAccountId: TL_BANKA, eventDate: c.gunStr(-1) }));
  }

  // 4) Alış faturaları — dolgu-2 mal kabullerine bağlı (USD, sabit kur)
  const kabuller = await c.hepsi("/api/goods-receipts");
  for (const [key, irsaliye, supplier, externalNo, ad, kg, fiyat] of [
    ["AF4", "IRS-DRK-1107", "Doruk İplik Sanayi", "DRK-2026-1107", "PES 300/96 ATKI İPLİĞİ", 1600, "2.05"],
    ["AF5", "IRS-PNR-0431", "Pınar Elyaf Ticaret", "PNR-2026-0431", "VİSKON 150 DENYE İPLİK", 520, "3.10"],
  ]) {
    const gr = kabuller.find((x) => x.deliveryNoteNo === irsaliye && !x.cancelledAt);
    if (!gr?.id) { console.log(`  ⚠ ${irsaliye} mal kabulü yok — ${key} alış faturası atlandı ('depo' adımı önce)`); continue; }
    const inv = await c.tokenli("fatura", `dv2:fin:alis:${key}`, "/api/finance/invoices", {
      type: "PURCHASE", customerId: k.tedarikci[supplier], currency: "USD", exchangeRate: USD_KUR, issueDate: c.gunStr(0), dueDate: c.gunStr(45), externalNo,
      goodsReceiptIds: [gr.id], lines: [{ itemId: k.kalem[ad], description: ad, qty: String(kg), unit: "KG", unitPrice: fiyat, vatRate: "20" }],
    });
    await onayla(inv.id);
  }

  // 5) Kasa giderleri (açılıştan sonra, son 9 gün)
  for (const [key, amount, category, description, gun] of [
    ["G3", "2450.00", "Kargo", "Numune ve kartela kargoları", -9], ["G4", "1870.00", "Akaryakıt", "Servis aracı yakıt", -7],
    ["G5", "3200.00", "Yemek", "Vardiya yemek avansı", -6], ["G6", "640.00", "Kırtasiye", "Etiket rulosu ve toner", -4],
    ["G7", "1150.00", "Bakım", "Tezgah yedek parça (acil alım)", -3],
  ]) {
    await c.tokenli("kasa-hareketi", `dv2:fin:gider:${key}`, "/api/finance/cash-transactions", { kind: "EXPENSE", cashBoxId: TL_KASA, amount, category, description, txnDate: c.gunStr(gun) });
  }

  // 6) Satış iade faturası — dolgu-2 iadeleri (iade ayrı belgeyle kapanır; sevk faturası değişmez)
  // İade listesi satırı tek top taşır (qty · roll{barcode} · item{id} · customer{id}); belge kaynağı returnGroupId ?? id
  // ⇒ fatura iadeye bağlanır (iade listesinde fatura no görünür, ikinci fatura backend'de 409).
  for (const r of await iadeListesi(c)) {
    if (r.invoiceDocNo) { c.say("fatura", "mevcut"); continue; }
    const customerId = r.customer?.id ?? r.customerId;
    if (!r.item?.id || !customerId) { console.log(`  ⚠ iade ${r.id} kalem/müşteri çözülemedi — iade faturası atlandı`); continue; }
    const inv = await c.tokenli("fatura", `dv2:fin:iade:${r.id}`, "/api/finance/invoices", {
      type: "SALES_RETURN", customerId, currency: "TRY", issueDate: c.gunStr(0), dueDate: c.gunStr(30), notes: "Müşteri iadesi",
      returnGroupId: r.documentSourceId ?? r.returnGroupId ?? r.id,
      lines: [{ itemId: r.item.id, description: `İade — ${r.roll?.barcode ?? ""}`.trim(), qty: String(r.qty), unit: "m", unitPrice: String(listeFiyati(r.item.id)), vatRate: "20" }],
    });
    await onayla(inv.id);
  }

  // 7) Mutabakat mektupları (iki büyük cari; tokensız → not işaretiyle)
  const mektuplar = await c.hepsi("/api/finance/reconciliation-letters");
  for (const [n, mi] of [[1, 2], [2, 0]]) {
    const isaret = `[DV2-MUTABAKAT-${n}]`;
    if (mektuplar.some((x) => (x.notes ?? "").includes(isaret) && x.status !== "CANCELLED")) { c.say("mutabakat", "mevcut"); continue; }
    const cari = (await c.api("GET", `/api/finance/cari/by-customer/${k.musteriler[mi].id}`)).data;
    await c.api("POST", "/api/finance/reconciliation-letters", { cariId: cari.id, asOf: c.gunStr(-1), notes: `Eylül-Ekim dönemi bakiye mutabakatı ${isaret}` }, { tekDeneme: true });
    c.say("mutabakat", "yeni");
  }
}
