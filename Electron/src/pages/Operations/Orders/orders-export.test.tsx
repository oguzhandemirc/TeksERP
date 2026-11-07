// =============================================================================
// Sipariş listesi dışa aktarımı — Kumaş/Renk BOŞ çıkmasın
// =============================================================================
// Saha (panel 1.3.7): liste Excel'inde Kumaş/Renk/Sevk boş, Kalem renk adı, tarih ham ISO çıkıyordu.
// Burada GERÇEK tablo adaptörü (`buildCsv`) ve gerçek kolonlar ölçülür.
// =============================================================================
import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { buildCsv } from "@/lib/table-export";
import { buildOrderColumns } from "./columns";
import { lineLabelsText } from "./order-cell-text";
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
    deadline: "2026-11-20T09:00:00.000Z",
    completedAt: null,
    manualClosedById: null,
    manualCloseReason: null,
    customer: { id: "m1", code: "M1", name: "Acme Tekstil" },
    branch: { id: "b1", name: "Merkez", code: null, city: null, district: null },
    lines: [
      line({ id: "l1", shippedQty: 40, unitPrice: "10.5", width: 280, cutNote: "2 parça", requiredProperties: [{ propertyId: "p1", property: { id: "p1", code: "YAN", name: "Yanmaz" } }], workOrderLinks: [{ workOrderId: "w1", workOrder: { id: "w1", workOrderNumber: "IE-7", status: "IN_PROGRESS" } }] }),
      line({ id: "l2", itemId: "i2", colorId: "c2", item: { id: "i2", code: "K-02", name: "Krep" }, color: { id: "c2", code: "R-02", name: "Ekru", hex: null } }),
      line({ id: "l3" }), // aynı kumaş+renk: tekrarsız listede bir kez
    ],
    nerede: { kind: "FASON", tone: "orange", text: "Fasonda – Akın Boya · 8 top · 3 gündür · +1 yerde daha", extraPlaces: 1, overdue: false, overdueText: null },
    sevk: { kind: "PARTIAL", text: "Bir kısmı gönderildi (40 / 300 m)", shipped: 40, requested: 300, unit: "MT" },
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

  it("yalnız-cell kolonlar ekrandaki metni yazar (Kalem sayı, tarih gün, Sevk durumu Türkçe, Tutar para birimli)", () => {
    const [head = [], row = []] = csvOf([order()]);
    const at = (label: string) => row[head.indexOf(label)];
    expect(at("Müşteri")).toBe("Acme Tekstil");
    expect(at("Şube")).toBe("Merkez");
    expect(at("Kalem")).toBe("3");
    // Tek sevk sütunu: günlük dil + miktar; "Onaylandı" gibi iş akışı sözcüğü yok.
    expect(at("Sevk durumu")).toBe("Bir kısmı gönderildi (40 / 300 m)");
    expect(row).not.toContain("Onaylandı");
    expect(at("Sipariş Tarihi")).toBe("01.11.2026");
    expect(at("Termin")).toBe("20.11.2026");
    expect(at("Tutar")).toBe("1500,00 TRY");
  });

  it("başlıklar: Sevk durumu / Üretim / Nerede?; eski 'Durum', 'Sevk', 'İş Emri', 'Genel durum' yok", () => {
    const [head = []] = csvOf([order()]);
    expect(head).toEqual(expect.arrayContaining(["Sevk durumu", "Üretim", "İE sayısı", "Nerede?"]));
    // Aynı soruyu cevaplayan iki sütun yan yana durmaz: "Sevk" ile "Sevk durumu" birleşti.
    expect(head).not.toContain("Sevk");
    expect(head.filter((h) => h === "Sevk durumu")).toHaveLength(1);
    // A4'ün "Genel durum" sütunu "Nerede?"ye evrildi — ikisi yan yana durmaz.
    expect(head).not.toContain("Genel durum");
    expect(head).not.toContain("Durum");
    expect(head).not.toContain("İş Emri");
    // İE sayısı, Üretim sütununun hemen ardında.
    expect(head.indexOf("İE sayısı")).toBe(head.indexOf("Üretim") + 1);
  });

  it("Üretim hücresine sayı gömülmez; sayı İE sayısı sütununda", () => {
    const wo = (id: string, status: "COMPLETED" | "IN_PROGRESS" | "SUPERSEDED") => ({
      workOrderId: id,
      workOrder: { id, workOrderNumber: id, status },
    });
    const o = order({
      lines: [line({ id: "a", workOrderLinks: [wo("w1", "COMPLETED")] }), line({ id: "b", workOrderLinks: [wo("w2", "COMPLETED"), wo("w0", "SUPERSEDED")] })],
    });
    const [head = [], row = []] = csvOf([o]);
    const at = (label: string) => row[head.indexOf(label)];
    expect(at("Üretim")).toBe("Üretildi");
    expect(at("İE sayısı")).toBe("2");
  });

  it("Nerede? Excel'de sunucunun cümlesi; termin geçtiyse ek rozet de yazılır", () => {
    const [head = [], row = []] = csvOf([order()]);
    expect(row[head.indexOf("Nerede?")]).toBe("Fasonda – Akın Boya · 8 top · 3 gündür · +1 yerde daha");
    const late = order({
      nerede: { kind: "STEP", tone: "blue", text: "Tambur aşamasında · 4 top", extraPlaces: 0, overdue: true, overdueText: "Termini geçti" },
    });
    const [h2 = [], r2 = []] = csvOf([late]);
    expect(r2[h2.indexOf("Nerede?")]).toBe("Tambur aşamasında · 4 top · Termini geçti");
  });

  it("eski sunucu (nerede/sevk alanı yok) → Nerede? '—', Sevk durumu günlük etiket; İE sayısı yine yazılır", () => {
    const [head = [], row = []] = csvOf([order({ nerede: undefined, sevk: undefined, lines: [line({})] })]);
    expect(row[head.indexOf("Nerede?")]).toBe("—");
    expect(row[head.indexOf("Sevk durumu")]).toBe("Henüz gönderilmedi");
    expect(row[head.indexOf("Üretim")]).toBe("—");
    expect(row[head.indexOf("İE sayısı")]).toBe("0");
  });

  it("hiçbir liste kolonu boş ya da ham ISO çıkmaz", () => {
    const [head = [], row = []] = csvOf([order()]);
    head.forEach((h, i) => {
      expect(row[i], h).not.toBe("");
      expect(row[i], h).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    });
  });
});
