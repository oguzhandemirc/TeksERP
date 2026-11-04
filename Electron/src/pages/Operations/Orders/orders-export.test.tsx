// =============================================================================
// Sipariş listesi dışa aktarımı — Kumaş/Renk BOŞ çıkmasın; kalem bazında Excel
// =============================================================================
// Saha (2026-11-04): liste Excel'inde Kumaş ve Renk boştu (kolon yalnız `cell`).
// Burada GERÇEK tablo adaptörü (`buildCsv`) ve gerçek kolonlar ölçülür.
// =============================================================================
import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { buildCsv } from "@/lib/table-export";
import { buildListSheet } from "@/lib/list-export";
import { buildOrderColumns } from "./columns";
import { lineLabelsText } from "./order-cell-text";
import { flattenOrderLines, orderLineExportColumns, lineOpenQty, lineStatusText } from "./order-lines-export";
import type { Order, OrderLine } from "./types";

const line = (p: Partial<OrderLine>): OrderLine =>
  ({
    id: p.id ?? "l1",
    itemId: "i1",
    colorId: "c1",
    quantity: 100,
    unit: "MT",
    width: null,
    unitPrice: null,
    customerItemName: null,
    customerColorName: null,
    cutNote: null,
    item: { id: "i1", code: "K-01", name: "Saten" },
    color: { id: "c1", code: "R-01", name: "Lacivert", hex: "#000080" },
    shippedQty: 0,
    workOrderLinks: [],
    ...p,
  }) as OrderLine;

const order = (p: Partial<Order> = {}): Order =>
  ({
    id: "o1",
    orderNumber: "SP-001",
    customerId: "m1",
    branchId: null,
    currency: "TRY",
    totalAmount: "1500",
    status: "APPROVED",
    shippedQty: 40,
    orderDate: "2026-11-01T09:00:00.000Z",
    deadline: null,
    completedAt: null,
    manualClosedById: null,
    manualCloseReason: null,
    customer: { id: "m1", code: "M1", name: "Acme Tekstil" },
    branch: { id: "b1", name: "Merkez", code: null, city: null, district: null },
    lines: [
      line({ id: "l1", shippedQty: 40, unitPrice: "10.5" }),
      line({ id: "l2", itemId: "i2", colorId: "c2", item: { id: "i2", code: "K-02", name: "Krep" }, color: { id: "c2", code: "R-02", name: "Ekru", hex: null } }),
      line({ id: "l3" }), // aynı kumaş+renk: tekrarsız listede bir kez
    ],
    createdAt: "2026-11-01T09:00:00.000Z",
    updatedAt: "2026-11-01T09:00:00.000Z",
    ...p,
  }) as Order;

function csvOf(rows: Order[]): string[][] {
  const { result } = renderHook(() =>
    useReactTable({ data: rows, columns: buildOrderColumns(true, true), getCoreRowModel: getCoreRowModel() }),
  );
  return buildCsv(result.current, rows)
    .replace(/^\uFEFF/, "")
    .trim()
    .split("\r\n")
    .map(splitCsvRow);
}

/** ";" ayraçlı CSV satırı — tırnaklı hücre (içinde "; " olan Kumaş/Renk) tek hücredir. */
function splitCsvRow(r: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < r.length; i++) {
    const ch = r[i];
    if (q && ch === '"' && r[i + 1] === '"') {
      cur += '"';
      i++;
    } else if (ch === '"') q = !q;
    else if (ch === ";" && !q) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

describe("sipariş listesi dışa aktarımı", () => {
  it("Kumaş ve Renk dolu, tekrarsız, '; ' ayraçlı (ekranla aynı yardımcı)", () => {
    const [head = [], row = []] = csvOf([order()]);
    const at = (label: string) => row[head.indexOf(label)];
    expect(at("Kumaş")).toBe("Saten; Krep");
    expect(at("Renk")).toBe("Lacivert; Ekru");
    expect(at("Kumaş")).toBe(lineLabelsText(order().lines, "item"));
  });

  it("iptal kalemin kumaş/rengi listelenmez", () => {
    const o = order({
      lines: [
        line({}),
        line({ id: "x", itemId: "i9", colorId: "c9", cancelledAt: "2026-11-02T00:00:00Z", item: { id: "i9", code: "K-9", name: "Tül" }, color: { id: "c9", code: "R-9", name: "Kırmızı", hex: null } }),
      ],
    });
    const [head = [], row = []] = csvOf([o]);
    expect(row[head.indexOf("Kumaş")]).toBe("Saten");
    expect(row[head.indexOf("Renk")]).toBe("Lacivert");
  });

  it("yalnız-cell kolonlar ekrandaki metni yazar", () => {
    const [head = [], row = []] = csvOf([order()]);
    const at = (label: string) => row[head.indexOf(label)];
    expect(at("Müşteri")).toBe("Acme Tekstil");
    expect(at("Şube")).toBe("Merkez");
    expect(at("Kalem")).toBe("3");
    // Eski "Sevk" + "Sevk durumu" tek sütunda birleşti; jargon ("Onaylandı") yazılmaz.
    expect(head).not.toContain("Sevk");
    expect(head.filter((h) => h === "Sevk durumu")).toHaveLength(1);
    expect(at("Sevk durumu")).toBe("Bir kısmı gönderildi (40 / 300 m)");
    expect(at("Sipariş Tarihi")).toMatch(/^\d{2}\.\d{2}\.2026$/);
    expect(at("Tutar")).toBe("1500,00 TRY");
  });
});

describe("Üretim / Sevk durumu / Nerede? sütunları", () => {
  const wol = (id: string, status: "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "SUPERSEDED") =>
    ({ workOrder: { id, workOrderNumber: id, status } }) as unknown as NonNullable<OrderLine["workOrderLinks"]>[number];

  it("Üretim etiketi sayısız, sayı ayrı 'İE sayısı' sütununda hemen ardından; Nerede? ekran metni", () => {
    const o = order({
      deadline: "2026-10-01T00:00:00.000Z",
      nerede: {
        durum: "YERLER",
        yerler: [
          { tur: "FASON", id: "f1", ad: "Akın Boya", topSayisi: 8, metre: 400, gun: 3 },
          { tur: "HAZIR", id: null, ad: null, topSayisi: 2, metre: 100, gun: null },
        ],
        terminGecti: true,
        sonHareket: null,
      },
      lines: [line({ id: "l1", workOrderLinks: [wol("w1", "COMPLETED"), wol("w2", "COMPLETED")] }), line({ id: "l2", workOrderLinks: [wol("w3", "SUPERSEDED")] })],
    });
    const [head = [], row = []] = csvOf([o]);
    const at = (label: string) => row[head.indexOf(label)];
    expect(head).not.toContain("Durum");
    expect(head.indexOf("İE sayısı")).toBe(head.indexOf("Üretim") + 1);
    expect(at("Üretim")).toBe("Üretildi");
    expect(at("İE sayısı")).toBe("2");
    expect(at("Sevk durumu")).toBe("Bir kısmı gönderildi (40 / 200 m)");
    expect(head).not.toContain("Genel durum");
    expect(at("Nerede?")).toBe("Fasonda – Akın Boya · 8 top · 3 gündür · +1 yerde daha · Termini geçti");
  });

  it("iş emirsiz sipariş: Üretim '—', İE sayısı 0", () => {
    const [head = [], row = []] = csvOf([order()]);
    expect(row[head.indexOf("Üretim")]).toBe("—");
    expect(row[head.indexOf("İE sayısı")]).toBe("0");
  });

  it("eski backend (nerede alanı yok): Nerede? '—'", () => {
    const [head = [], row = []] = csvOf([order()]);
    expect(row[head.indexOf("Nerede?")]).toBe("—");
  });

  it("üretim kapalıyken Üretim, İE sayısı ve Nerede? düşer", () => {
    const ids = buildOrderColumns(false, false).map((c) => c.id ?? (c as { accessorKey?: string }).accessorKey);
    expect(ids).not.toContain("workOrder");
    expect(ids).not.toContain("where");
    expect(ids).toContain("shipped");
    expect(ids).not.toContain("status");
  });
});

describe("kalem bazında Excel", () => {
  it("her kalem bir satır; sipariş başlığı her satırda", () => {
    const rows = flattenOrderLines([order(), order({ id: "o2", orderNumber: "SP-002", lines: [line({ id: "x" })] })]);
    expect(rows.map((r) => `${r.order.orderNumber}/${r.line.id}`)).toEqual(["SP-001/l1", "SP-001/l2", "SP-001/l3", "SP-002/x"]);
  });

  it("kalan/durum: iptal kalem 0, kısmi sevk, ölçülmeyen birim boş", () => {
    const o = order();
    expect(lineOpenQty({ order: o, line: line({ shippedQty: 40 }) })).toBe(60);
    expect(lineStatusText({ order: o, line: line({ shippedQty: 40 }) })).toBe("Kısmi sevk");
    expect(lineOpenQty({ order: o, line: line({ cancelledAt: "2026-11-02T00:00:00Z" }) })).toBe(0);
    expect(lineOpenQty({ order: o, line: line({ unit: "KG" }) })).toBe("");
    expect(lineOpenQty({ order: order({ status: "COMPLETED" }), line: line({}) })).toBe(0);
  });

  it("kalem satırındaki 'Sevk durumu' liste ekranının cümlesi (sipariş geneli)", () => {
    const rows = flattenOrderLines([order(), order({ id: "o3", orderNumber: "SP-003", status: "CANCELLED", shippedQty: 0 })]);
    const col = orderLineExportColumns(rows, { pricingEnabled: false, productionEnabled: true }).find((c) => c.label === "Sevk durumu");
    expect(col).toBeDefined();
    for (const r of rows) {
      expect(col!.value(r)).toBe(r.order.id === "o3" ? "Sipariş iptal edildi" : "Bir kısmı gönderildi (40 / 300 m)");
    }
    expect(orderLineExportColumns(rows, { pricingEnabled: false, productionEnabled: true }).map((c) => c.label)).not.toContain("Sipariş Durumu");
  });

  it("fiyat kolonları yalnız pricingEnabled ile; iş emri kolonu üretimle", () => {
    const rows = flattenOrderLines([order()]);
    const labels = (pricingEnabled: boolean, productionEnabled: boolean) =>
      orderLineExportColumns(rows, { pricingEnabled, productionEnabled }).map((c) => c.label);
    expect(labels(false, true)).not.toContain("Birim Fiyat");
    expect(labels(false, true)).not.toContain("Tutar");
    expect(labels(true, true)).toEqual(expect.arrayContaining(["Birim Fiyat", "Para Birimi", "Tutar"]));
    expect(labels(true, false).some((l) => l.startsWith("Bağlı"))).toBe(false);
  });

  it("sayfa: kumaş/renk/miktar/tutar dolu; tek birimde metraj toplanır, karışıkta toplanmaz", () => {
    const rows = flattenOrderLines([order()]);
    const sheet = buildListSheet(orderLineExportColumns(rows, { pricingEnabled: true, productionEnabled: true }), rows, "x");
    const idx = (h: string) => `c${sheet.columns.findIndex((c) => c.header === h)}`;
    const first = sheet.rows[0] ?? {};
    expect(first[idx("Kumaş")]).toBe("Saten");
    expect(first[idx("Renk")]).toBe("Lacivert");
    expect(first[idx("Miktar")]).toBe(100);
    expect(first[idx("Tutar")]).toBe(1050);
    expect(sheet.totalRow?.[idx("Miktar")]).toBe(300);

    const mixed = flattenOrderLines([order({ lines: [line({}), line({ id: "k", unit: "KG" })] })]);
    const cols = orderLineExportColumns(mixed, { pricingEnabled: false, productionEnabled: true });
    expect(cols.find((c) => c.label === "Miktar")?.summable).toBe(false);
  });
});
