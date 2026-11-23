// =============================================================================
// BEKÇİ — Ekran = Excel = PDF (kullanıcı kuralı 2026-11-23: üç yüzey aynı veriyi verir)
// =============================================================================
// ⭐ Aynı "API yanıtı" üç yüzeye basılır: ekran (TanStack hücreleri), Excel (`buildListSheet`), PDF
//    (`buildListHtml`). Satır sayısı = yanıt; her hücre Excel metni = PDF metni; TOPLAM = Σyanıt.
// ⭐ Toplanabilir alan ekranda da dosyanın hassasiyetiyle (`upTo3Text`) yazılır — ekranı yuvarlayıp
//    dosyada tam değer basmak "iki farklı rakam" demektir (Sevk Edilenler Metraj/Kg bulgusu).
// ⭐ Ekranda gizli sütun seçilince iki dosyada da çıkar; tanınmayan sütun id'si fırlatır.
// Fikstür ondalıklıdır: tam sayı fikstürü yuvarlama farkını gizler.
// =============================================================================
import { describe, expect, it, vi } from "vitest";
import { render, renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef, type Table } from "@tanstack/react-table";
import { tableExportCatalog, toExportColumns } from "./table-export";
import { buildListHtml, buildListSheet, cellNumber, cellText, type ExportColumn } from "./list-export";
import { upTo3Text } from "./number-format";
import { UnknownExportColumnError } from "./export-columns";
import { makeRollColumns } from "@/pages/Operations/Rolls/columns";
import type { Roll } from "@/pages/Operations/Rolls/types";
import { buildDispatchColumns } from "@/pages/Operations/AccountingDispatch/columns";
import type { DispatchRowHandlers } from "@/pages/Operations/AccountingDispatch/DispatchRowCells";
import { dispatchRowView } from "@/pages/Operations/AccountingDispatch/dispatchRowActions";
import type { DispatchListItem } from "@/pages/Operations/AccountingDispatch/types";
import { shipmentColumns } from "@/pages/Operations/Shipments/columns";
import type { ShipmentListItem } from "@/pages/Operations/Shipments/types";

function makeTable<T>(data: T[], columns: ColumnDef<T>[], hidden: Record<string, boolean> = {}): Table<T> {
  return renderHook(() =>
    useReactTable({ data, columns, getCoreRowModel: getCoreRowModel(), state: { columnVisibility: hidden } }),
  ).result.current;
}

/** Ekran: görünen hücreler bir tabloya basılır → satır başına { sütun id → metin }. */
function screenCells<T>(table: Table<T>): Array<Record<string, string>> {
  const qc = new QueryClient();
  const { container } = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <table>
          <tbody>
            {table.getRowModel().rows.map((r) => (
              <tr key={r.id}>
                {r.getVisibleCells().map((c) => (
                  <td key={c.id} data-col={c.column.id}>
                    {flexRender(c.column.columnDef.cell, c.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return [...container.querySelectorAll("tbody tr")].map((tr) =>
    Object.fromEntries([...tr.querySelectorAll("td")].map((td) => [td.dataset.col!, (td.textContent ?? "").trim()])),
  );
}

interface Surfaces {
  excel: string[][];
  excelTotal: Array<string | undefined>;
  pdf: string[][];
  pdfTotal: string[];
}

/** Excel hücresi kullanıcıya nasıl görünür: sayı hücresi biçimiyle (≤3 hane, `upTo3ExcelNumFmt`) → `upTo3Text`. */
const excelShown = (v: unknown, summable: boolean): string => (summable ? upTo3Text(cellNumber(v)) : cellText(v));

function surfaces<T>(cols: ExportColumn<T>[], rows: T[]): Surfaces {
  const sheet = buildListSheet(cols, rows, "Bekçi");
  const excel = sheet.rows.map((r) => cols.map((c, i) => excelShown(r[`c${i}`], Boolean(c.summable))));
  const excelTotal = cols.map((c, i) => {
    const v = sheet.totalRow?.[`c${i}`];
    return v === undefined ? undefined : typeof v === "number" ? upTo3Text(v) : String(v);
  });
  const doc = new DOMParser().parseFromString(buildListHtml(cols, rows, "Bekçi"), "text/html");
  const texts = (sel: string) =>
    [...doc.querySelectorAll(sel)].map((tr) => [...tr.querySelectorAll("td")].map((td) => (td.textContent ?? "").trim()));
  return { excel, excelTotal, pdf: texts("tbody tr"), pdfTotal: texts("tfoot tr")[0] ?? [] };
}

/** Ortak iddialar: satır sayısı, hücre hücre Excel = PDF, TOPLAM = Σyanıt. */
function assertFilesAgree<T>(cols: ExportColumn<T>[], rows: T[], screenRows: number): Surfaces {
  const s = surfaces(cols, rows);
  expect(screenRows).toBe(rows.length);
  expect(s.excel).toHaveLength(rows.length);
  expect(s.pdf).toHaveLength(rows.length);
  expect(s.excel).toEqual(s.pdf);
  cols.forEach((c, i) => {
    if (!c.summable) return;
    const sum = rows.reduce((a, r) => a + cellNumber(c.value(r)), 0);
    expect(s.excelTotal[i]).toBe(upTo3Text(sum));
    expect(s.pdfTotal[i]).toBe(upTo3Text(sum));
  });
  return s;
}

const allIds = <T,>(t: Table<T>) => tableExportCatalog(t).map((c) => c.id);

// --- Kumaş Stoğu -------------------------------------------------------------

function roll(p: Partial<Roll>): Roll {
  return {
    id: "r1",
    barcode: "TOP-1",
    itemId: "i1",
    colorId: null,
    initialQty: 100,
    currentQty: 100,
    weightKg: null,
    width: 280,
    status: "STOCK",
    qualityGrade: null,
    form: "TOP",
    entrySource: "KK1",
    createdAt: "2026-11-20T08:00:00.000Z",
    updatedAt: "2026-11-20T08:00:00.000Z",
    item: { id: "i1", code: "K-1", name: "Tül A" },
    color: null,
    ...p,
  } as unknown as Roll;
}

describe("Kumaş Stoğu — ekran = Excel = PDF", () => {
  const rolls = [roll({ id: "r1", currentQty: 1234.567 }), roll({ id: "r2", barcode: "TOP-2", currentQty: 10.5 }), roll({ id: "r3", barcode: "TOP-3", currentQty: 0.125 })];
  const columns = makeRollColumns([]);

  it("satır, hücre ve TOPLAM üç yüzeyde aynı; Metre ekranda dosyanın hassasiyetiyle", () => {
    const table = makeTable(rolls, columns);
    const screen = screenCells(table);
    const cols = toExportColumns(table, allIds(table));
    assertFilesAgree(cols, rolls, screen.length);
    rolls.forEach((r, i) => expect(screen[i]!.currentQty).toBe(upTo3Text(r.currentQty)));
  });

  it("ekranda gizli sütun seçilince iki dosyada da var; tanınmayan id fırlatır", () => {
    const table = makeTable(rolls, columns, { barcode: false });
    expect(tableExportCatalog(table).find((c) => c.id === "barcode")?.visible).toBe(false);
    const cols = toExportColumns(table, ["barcode", "currentQty"]);
    const s = assertFilesAgree(cols, rolls, rolls.length);
    expect(s.excel.map((r) => r[0])).toEqual(["TOP-1", "TOP-2", "TOP-3"]);
    expect(() => toExportColumns(table, ["barcode", "yok-boyle"])).toThrow(UnknownExportColumnError);
  });
});

// --- Sevk Edilenler ----------------------------------------------------------

function dispatch(p: Partial<DispatchListItem>): DispatchListItem {
  return {
    id: "s1",
    kind: "SHIPMENT",
    shipmentNo: "SVK-1",
    status: "DISPATCHED",
    dispatchedAt: "2026-11-14T08:00:00.000Z",
    createdAt: "2026-11-14T07:00:00.000Z",
    customer: { id: "c1", name: "Müşteri A" },
    branch: null,
    _count: { sacks: 2, rolls: 10, orders: 1, returns: 0 },
    totalMeters: 1000,
    totalKg: 200,
    invoiceNo: null,
    invoicedAt: null,
    manualSackCount: null,
    dispatchNote: null,
    invoices: [],
    ...p,
  };
}

const handlers: DispatchRowHandlers = {
  onBelge: vi.fn(),
  onTrace: vi.fn(),
  onDraft: vi.fn(),
  onOpenInvoice: vi.fn(),
  onPrintInvoice: vi.fn(),
  view: (r) => dispatchRowView(r, { financeEnabled: false, invoiceMode: "dis", can: () => false }),
};

describe("Sevk Edilenler — ekran = Excel = PDF", () => {
  const rows = [
    dispatch({ id: "s1", totalMeters: 1234.567, totalKg: 200.125 }),
    dispatch({ id: "s2", shipmentNo: "SVK-2", totalMeters: 99.5, totalKg: 0 }),
  ];

  it("Metraj ve Kg ekranda dosyadaki hassasiyetle; TOPLAM = Σyanıt", () => {
    const table = makeTable(rows, buildDispatchColumns(handlers));
    const screen = screenCells(table);
    const cols = toExportColumns(table, allIds(table));
    const s = assertFilesAgree(cols, rows, screen.length);
    const mi = cols.findIndex((c) => c.label === "Metraj (m)");
    const ki = cols.findIndex((c) => c.label === "Kg");
    rows.forEach((r, i) => {
      expect(s.excel[i]![mi]).toBe(upTo3Text(r.totalMeters));
      expect(s.excel[i]![ki]).toBe(upTo3Text(r.totalKg));
      expect(screen[i]!.totals).toContain(`${upTo3Text(r.totalMeters)} m`);
      if (r.totalKg > 0) expect(screen[i]!.totals).toContain(`${upTo3Text(r.totalKg)} kg`);
    });
  });
});

// --- Sevkiyatlar -------------------------------------------------------------

function shipment(p: Partial<ShipmentListItem>): ShipmentListItem {
  return {
    id: "h1",
    kind: "SHIPMENT",
    shipmentNo: "SVK-10",
    status: "DISPATCHED",
    plateNumber: "34 AB 123",
    driverName: "Sürücü",
    carrier: null,
    dispatchedAt: "2026-11-14T08:00:00.000Z",
    createdAt: "2026-11-14T07:00:00.000Z",
    customer: { id: "c1", code: "M1", name: "Müşteri A" },
    branch: null,
    _count: { sacks: 3, rolls: 12, orders: 1, returns: 0 },
    totalMeters: 1000,
    totalKg: 100,
    invoiceNo: null,
    invoicedAt: null,
    ...p,
  };
}

describe("Sevkiyatlar — ekran = Excel = PDF", () => {
  const rows = [
    shipment({ id: "h1", totalMeters: 1234.5, totalKg: 300.25 }),
    shipment({ id: "h2", shipmentNo: "SVK-11", kind: "DIRECT", totalMeters: 77.25, totalKg: 0, _count: { sacks: 0, rolls: 4, orders: 0, returns: 0 } }),
  ];

  it("Metraj / Kg metni ekranda ve iki dosyada birebir", () => {
    const table = makeTable(rows, shipmentColumns);
    const screen = screenCells(table);
    const cols = toExportColumns(table, allIds(table));
    const s = assertFilesAgree(cols, rows, screen.length);
    const ti = cols.findIndex((c) => c.label === "Metraj / Kg");
    expect(ti).toBeGreaterThanOrEqual(0);
    rows.forEach((_, i) => expect(screen[i]!.totals).toBe(s.excel[i]![ti]));
  });
});
