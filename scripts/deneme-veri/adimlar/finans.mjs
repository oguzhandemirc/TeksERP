// Finans: kasalar · bankalar · açılışlar · cari devir · satış faturası (sevkiyattan) · alış faturası · tahsilat · tedarikçi
// ödemesi · kasa gideri · çek/senet portföyü (portföyde · bankada · ciro · tahsil). Defter yalnız servis yolundan doğar.
// Tokenlı uçlar (fatura, ödeme, kasa hareketi, çek) replay'e düşer; geçişler (onay, banka, ciro, tahsil) canlı durumdan.
import { katlaAd } from "../lib/baglam.mjs";

export const KASALAR = [["Merkez Kasa", "TRY", 25000], ["Döviz Kasa", "USD", 1500]];
/** Döviz açılışında sabit kur (gövde belirlenimli kalsın — o günün kuru kurulumda olmayabilir). */
const USD_KUR = "49.30";
export const BANKALAR = [["Vadesiz TL Hesap", "Ziraat Bankası", "TRY", 250000], ["Vadesiz USD Hesap", "Türkiye İş Bankası", "USD", 12000]];

export async function finans(c) {
  const k = c.kayit;
  const kasa = {}, banka = {};
  for (const [name, currency, acilis] of KASALAR) {
    kasa[name] = (await c.bulYaDaYarat("kasa", async () => (await c.hepsi("/api/finance/cash-boxes")).find((x) => katlaAd(x.name) === katlaAd(name)),
      async () => (await c.api("POST", "/api/finance/cash-boxes", { name, currency, notes: "Deneme kurulumu" }, { tekDeneme: true })).data)).id;
    await c.tokenli("kasa-hareketi", `dv:fin:acilis:kasa:${name}`, "/api/finance/cash-transactions", {
      kind: "OPENING", cashBoxId: kasa[name], amount: String(acilis), txnDate: c.gunStr(-10), description: "Açılış bakiyesi", exchangeRate: currency === "TRY" ? null : USD_KUR,
    });
  }
  for (const [name, bankName, currency, acilis] of BANKALAR) {
    banka[name] = (await c.bulYaDaYarat("banka", async () => (await c.hepsi("/api/finance/bank-accounts")).find((x) => katlaAd(x.name) === katlaAd(name)),
      async () => (await c.api("POST", "/api/finance/bank-accounts", { name, bankName, currency }, { tekDeneme: true })).data)).id;
    await c.tokenli("kasa-hareketi", `dv:fin:acilis:banka:${name}`, "/api/finance/cash-transactions", {
      kind: "OPENING", bankAccountId: banka[name], amount: String(acilis), txnDate: c.gunStr(-10), description: "Açılış bakiyesi", exchangeRate: currency === "TRY" ? null : USD_KUR,
    });
  }
  const TL_KASA = kasa["Merkez Kasa"], TL_BANKA = banka["Vadesiz TL Hesap"];
  const m = k.musteriler;

  // Cari devir bakiyesi (ikinci devir 409 ⇒ mevcut)
  for (const [mi, bakiye, gun] of [[2, "18500.00", -45], [3, "9200.00", -20]]) {
    const cari = (await c.api("GET", `/api/finance/cari/by-customer/${m[mi].id}`)).data;
    try {
      await c.api("POST", `/api/finance/cari/${cari.id}/opening-balance`, { currency: "TRY", balance: bakiye, description: "Devir bakiyesi", txnDate: c.gunStr(gun) });
      c.say("cari-devir", "yeni");
    } catch (e) { if (e.status === 409) c.say("cari-devir", "mevcut"); else throw e; }
  }

  // Satış faturası: sevkiyattan taslak satırlar → taslak (tokenlı) → onay
  const onayla = async (id) => c.kosulluYaz("fatura-onay", async () => (await c.api("GET", `/api/finance/invoices/${id}`)).data?.status === "DRAFT",
    () => c.api("POST", `/api/finance/invoices/${id}/confirm`, {}));
  if (k.sevkiyat?.SH1) {
    const p = (await c.api("GET", `/api/finance/shipments/${k.sevkiyat.SH1}/invoice-draft-lines`)).data;
    const inv = await c.tokenli("fatura", "dv:fin:fatura:SH1", "/api/finance/invoices", {
      type: "SALES", customerId: k.siparis.S1.musteri, currency: p.currency, shipmentId: k.sevkiyat.SH1, issueDate: c.gunStr(0), dueDate: c.gunStr(30),
      lines: p.lines.map((l) => ({ itemId: l.itemId, description: l.description, qty: String(l.qty), unit: l.unit, unitPrice: String(l.unitPrice), vatRate: String(l.vatRate) })),
    });
    await onayla(inv.id);
  }
  // Serbest satış faturası (sevkiyatsız hizmet) + alış faturası (iplik)
  const serbest = await c.tokenli("fatura", "dv:fin:fatura:hizmet", "/api/finance/invoices", {
    type: "SALES", customerId: m[1].id, currency: "TRY", issueDate: c.gunStr(-4), dueDate: c.gunStr(26),
    lines: [{ description: "Numune dokuma hizmeti", qty: "1", unit: "ADET", unitPrice: "4500", vatRate: "20" }],
  });
  await onayla(serbest.id);
  const alis = await c.tokenli("fatura", "dv:fin:fatura:alis-iplik", "/api/finance/invoices", {
    type: "PURCHASE", customerId: k.tedarikci["Doruk İplik Sanayi"], currency: "TRY", issueDate: c.gunStr(-6), dueDate: c.gunStr(54), externalNo: "DRK-2026-0917",
    lines: [{ itemId: k.kalem["PES 150/48 ÇÖZGÜ İPLİĞİ"], description: "PES 150/48 çözgü ipliği", qty: "1200", unit: "KG", unitPrice: "78.50", vatRate: "20" }],
  });
  await onayla(alis.id);

  // Tahsilat / ödeme / kasa gideri
  const ODEMELER = [
    ["T1", "IN", "BANK_TRANSFER", k.siparis.S1.musteri, "TRY", "20000.00", null, TL_BANKA, "Havale — kısmi tahsilat", -1],
    ["T2", "IN", "CASH", m[1].id, "TRY", "7500.00", TL_KASA, null, "Nakit tahsilat", -2],
    ["T3", "IN", "BANK_TRANSFER", m[3].id, "TRY", "9200.00", null, TL_BANKA, "Devir bakiyesi kapanışı", -3],
    ["O1", "OUT", "BANK_TRANSFER", k.tedarikci["Doruk İplik Sanayi"], "TRY", "45000.00", null, TL_BANKA, "İplik faturası kısmi ödeme", -1],
  ];
  for (const [key, direction, method, customerId, currency, amount, cashBoxId, bankAccountId, notes, gun] of ODEMELER) {
    await c.tokenli("tahsilat-odeme", `dv:fin:odeme:${key}`, "/api/finance/payments", {
      direction, method, customerId, currency, amount, cashBoxId, bankAccountId, notes, paymentDate: c.gunStr(gun),
    });
  }
  for (const [key, amount, category, description, gun] of [["G1", "1250.00", "Kargo", "Numune kargo gönderimi", -2], ["G2", "860.00", "Mutfak", "Çay-kahve alımı", -1]]) {
    await c.tokenli("kasa-hareketi", `dv:fin:gider:${key}`, "/api/finance/cash-transactions", { kind: "EXPENSE", cashBoxId: TL_KASA, amount, category, description, txnDate: c.gunStr(gun) });
  }

  // Çekler: portföyde · bankaya verilmiş · tedarikçiye ciro · tahsil edilmiş
  const CEKLER = [
    ["C1", m[2].id, "45000.00", 45, "Akbank", "PORTFOLIO"],
    ["C2", m[0].id, "30000.00", 20, "Garanti BBVA", "AT_BANK"],
    ["C3", m[2].id, "12000.00", 35, "Yapı Kredi", "ENDORSED"],
    ["C4", m[1].id, "8500.00", -1, "Halkbank", "COLLECTED"],
  ];
  for (const [key, customerId, amount, vade, bankName, hedef] of CEKLER) {
    const ch = await c.tokenli("cek", `dv:fin:cek:${key}`, "/api/finance/cheques", {
      kind: "RECEIVED", docType: "CHEQUE", customerId, currency: "TRY", amount, issueDate: c.gunStr(-5), dueDate: c.gunStr(vade),
      serialNo: `DV${key}-${amount.split(".")[0]}`, bankName, notes: "Müşteri çeki",
    });
    const durum = async () => (await c.api("GET", `/api/finance/cheques/${ch.id}`)).data?.status;
    if (hedef === "AT_BANK") await c.kosulluYaz("cek-gecis", async () => (await durum()) === "PORTFOLIO", () => c.api("POST", `/api/finance/cheques/${ch.id}/deposit`, { bankAccountId: TL_BANKA, eventDate: c.gunStr(-1) }));
    if (hedef === "ENDORSED") await c.kosulluYaz("cek-gecis", async () => (await durum()) === "PORTFOLIO", () => c.api("POST", `/api/finance/cheques/${ch.id}/endorse`, { toCustomerId: k.tedarikci["Atlas Çözgü Hazırlama"], eventDate: c.gunStr(-1), notes: "Çözgü hazırlama ödemesi" }));
    if (hedef === "COLLECTED") await c.kosulluYaz("cek-gecis", async () => (await durum()) === "PORTFOLIO", () => c.api("POST", `/api/finance/cheques/${ch.id}/collect`, { bankAccountId: TL_BANKA, eventDate: c.gunStr(0) }));
  }
  k.kasa = kasa; k.banka = banka;
}
