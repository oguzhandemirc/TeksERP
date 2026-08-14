// =============================================================================
// BEKÇİ — Siparişler ekranının ticaret rejimi
// =============================================================================
// ⭐ ASIL İDDİA: FABRİKADA HİÇBİR ŞEY DEĞİŞMEZ. Üretim yüzeylerini süzen kural
// bir gün koşulsuz hale gelirse fabrikanın "İş Emri" kolonu, filtresi ve
// "İş Emri Aç" toplu aksiyonu sessizce kaybolur — üretim planlamacısının en
// çok kullandığı üç yüzey.
// =============================================================================
import { describe, it, expect } from "vitest";
import type { FilterDef } from "@/components/data-table/FilterBar";
import { resolveOrderFilters, canBulkCreateWorkOrder } from "./orders-regime";
import { buildOrderColumns } from "./columns";

const FILTERS = [
  { kind: "select", key: "status", label: "Durum", options: [] },
  { kind: "multi-select", key: "woState", label: "İş Emri", options: [] },
  { kind: "multi-lookup", key: "customerId", label: "Müşteri" },
] as unknown as FilterDef[];

const colIds = (financeEnabled: boolean) =>
  buildOrderColumns(false, financeEnabled).map((c) => c.id ?? (c as { accessorKey?: string }).accessorKey);

describe("Siparişler — rejim süzgeci", () => {
  it("⭐ FABRİKADA filtre şeridi BİREBİR aynı", () => {
    expect(resolveOrderFilters(FILTERS, false)).toEqual(FILTERS);
  });

  it("⭐ FABRİKADA 'İş Emri' kolonu DURUYOR", () => {
    expect(colIds(false)).toContain("workOrder");
  });

  it("⭐ FABRİKADA toplu 'İş Emri Aç' DURUYOR", () => {
    expect(canBulkCreateWorkOrder(false)).toBe(true);
  });

  it("ticarette 'İş Emri' filtresi şeritten düşer", () => {
    const keys = resolveOrderFilters(FILTERS, true).map((f) => (f as { key: string }).key);
    expect(keys).not.toContain("woState");
    // Diğerleri KALIR — süzgeç yalnız üretim anahtarına dokunur.
    expect(keys).toContain("status");
    expect(keys).toContain("customerId");
  });

  it("ticarette 'İş Emri' kolonu düşer, diğerleri kalır", () => {
    const ids = colIds(true);
    expect(ids).not.toContain("workOrder");
    expect(ids).toContain("orderNumber");
  });

  it("ticarette toplu 'İş Emri Aç' çizilmez", () => {
    expect(canBulkCreateWorkOrder(true)).toBe(false);
  });

  it("körlük zemini: kolon listesi gerçekten dolu", () => {
    // Boş dönen bir fabrika sürümü yukarıdaki "içeriyor/içermiyor"
    // kontrollerini vakumen yeşil bırakırdı.
    expect(colIds(false).length).toBeGreaterThanOrEqual(6);
    expect(colIds(true).length).toBe(colIds(false).length - 1);
  });
});
