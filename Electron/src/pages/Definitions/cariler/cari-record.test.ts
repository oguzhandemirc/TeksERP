import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CARI_TARGETS, type CariSourceKey } from "./cari-sources";
import { cariTabGates, visibleCariTabs } from "./cari-record-tabs";
import { balanceLines, overdueLines, riskUsage } from "./cari-finance";
import { ledgerCurrencies } from "./CariLedgerTab";
import { cariRecordPath, parseRowKey, rowKey } from "./cari-row";
import { historyText } from "./CariOtherTabs";
import { SEARCH_TARGETS } from "@/lib/search/search-targets";
import type { CariRow } from "@/pages/Finance/service";

const allOpen = () => Object.fromEntries(Object.keys(CARI_TARGETS).map((k) => [k, true])) as Record<CariSourceKey, boolean>;
const customer = { isCustomerRole: true, isSupplierRole: false, isSubcontractorRole: false };
const supplier = { isCustomerRole: false, isSupplierRole: true, isSubcontractorRole: false };

describe("cari kayıt sayfası — sekme kapıları", () => {
  it("izin/modül kapalı kaynak sekmesi kapalı: finans yoksa Hesap, fiyat modülü kapalıysa Fiyatlar yok", () => {
    const access = { ...allOpen(), finance: false, prices: false };
    const g = cariTabGates({ roles: customer, access, hasAccount: true, subcontractorId: null });
    expect(g.hesap).toBe(false);
    expect(g.fiyatlar).toBe(false);
    expect(g.siparisler).toBe(true);
  });

  it("rol kapısı: yalnız tedarikçide Siparişler/Sevkiyatlar yok, Alışlar var; fason profili yoksa Fason yok", () => {
    const g = cariTabGates({ roles: supplier, access: allOpen(), hasAccount: true, subcontractorId: null });
    expect(g.siparisler).toBe(false);
    expect(g.sevkiyatlar).toBe(false);
    expect(g.alislar).toBe(true);
    expect(g.fason).toBe(false);
    expect(cariTabGates({ roles: supplier, access: allOpen(), hasAccount: true, subcontractorId: "s1" }).fason).toBe(true);
  });

  it("hesabı olmayan kartta Hesap sekmesi yok", () => {
    expect(cariTabGates({ roles: customer, access: allOpen(), hasAccount: false, subcontractorId: null }).hesap).toBe(false);
  });

  it("BOŞ sekme gizli: kapı açık ama satır yok (ya da henüz yoklanmadı) → çizilmez; Genel hep var", () => {
    const gates = cariTabGates({ roles: customer, access: allOpen(), hasAccount: true, subcontractorId: null });
    const keys = visibleCariTabs(gates, { siparisler: 3, sevkiyatlar: 0, fiyatlar: undefined }).map((t) => t.key);
    expect(keys).toEqual(["genel", "siparisler", "hesap", "gecmis"]);
  });

  it("Geçmiş (audit) yalnız izin kapısıyla görünür; sayı rozeti audit'ten türetilmez", () => {
    const closed = cariTabGates({ roles: customer, access: { ...allOpen(), history: false }, hasAccount: false, subcontractorId: null });
    expect(visibleCariTabs(closed, {}).map((t) => t.key)).toEqual(["genel"]);
    const open = cariTabGates({ roles: customer, access: allOpen(), hasAccount: false, subcontractorId: null });
    expect(visibleCariTabs(open, { gecmis: 3 }).find((t) => t.key === "gecmis")?.count).toBeNull();
  });

  it("rozet yalnız sınırın altında: 50 satır kesin sayı değildir", () => {
    const gates = cariTabGates({ roles: customer, access: allOpen(), hasAccount: false, subcontractorId: null });
    const tabs = visibleCariTabs(gates, { siparisler: 50, sevkiyatlar: 7 });
    expect(tabs.find((t) => t.key === "siparisler")?.count).toBeNull();
    expect(tabs.find((t) => t.key === "sevkiyatlar")?.count).toBe(7);
  });
});

describe("cari finans — para birimleri toplanmaz", () => {
  const acc = { defaultCurrency: "TRY", balances: [{ currency: "TRY", balance: 1500 }, { currency: "USD", balance: -200 }, { currency: "EUR", balance: 0 }], riskLimit: 1000, overdue: [{ currency: "TRY", amount: "300" }, { currency: "USD", amount: "0" }] } as unknown as CariRow;

  it("TRY ve USD iki ayrı satır; sıfır birim atılır; toplam satırı yok", () => {
    const lines = balanceLines(acc);
    expect(lines.map((l) => l.currency)).toEqual(["TRY", "USD"]);
    expect(lines.map((l) => l.side)).toEqual(["receivable", "payable"]);
    expect(lines.some((l) => l.text.includes("1.300") || l.text.includes("1.700"))).toBe(false);
  });

  it("vadesi geçmiş yalnız dolu birimler; risk yalnız limit biriminde ölçülür", () => {
    expect(overdueLines(acc).map((o) => o.currency)).toEqual(["TRY"]);
    expect(riskUsage(acc)?.pct).toBe(150);
  });

  it("ekstre birimleri: varsayılan önde, tekrarsız", () => {
    expect(ledgerCurrencies(acc)).toEqual(["TRY", "USD", "EUR"]);
  });
});

describe("cari hedefleri", () => {
  it("'Tam sayfa aç' ve komut paleti müşteri sonucu kayıt sayfasına gider", () => {
    expect(cariRecordPath("c1")).toBe("/definitions/cariler/c1");
    expect(SEARCH_TARGETS.customer!.to({ id: "c1", title: "A", subtitle: null, code: "MUS-1" }).to).toBe(cariRecordPath("c1"));
  });

  it("kayıt sayfası route'u liste ile AYNI izin listesini taşır", () => {
    const src = readFileSync(resolve(__dirname, "../../../routes/content-routes.tsx"), "utf8");
    expect(src).toMatch(/path: "definitions\/cariler\/:id",\s*element: \(\s*<ProtectedRoute requireAnyPermission=\{\["customer:read", "subcontractor:read"\]\}>\s*<CariRecordPage \/>/);
  });

  it("seçili kayıt anahtarı: iki kaynak ayrı uzay, bozuk değer reddedilir", () => {
    const id = "0b9c1e2a-1111-4222-8333-444455556666";
    expect(parseRowKey(rowKey({ kind: "CUSTOMER", id }))).toEqual({ kind: "CUSTOMER", id });
    expect(parseRowKey(`S:${id}`)?.kind).toBe("SUBCONTRACTOR");
    expect(parseRowKey("X:1")).toBeNull();
    expect(parseRowKey(null)).toBeNull();
  });

  it("geçmiş satırı sunucu cümlesini birleştirir; yoksa işlem · tablo", () => {
    expect(historyText({ action: "UPDATE", tableName: "CUSTOMER", anlati: { metin: "x", parcalar: [{ t: "kisi", text: "Ali " }, { t: "metin", text: "kartı güncelledi" }] } })).toBe("Ali kartı güncelledi");
    expect(historyText({ action: "UPDATE", tableName: "CUSTOMER" })).toBe("UPDATE · CUSTOMER");
  });
});
