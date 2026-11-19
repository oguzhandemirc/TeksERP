// =============================================================================
// BEKÇİ — Sevk Edilenler satırı: Fatura bilgisi · "Fatura kes" · Belgeler · ⋯
// =============================================================================
// ⭐ Faturasız satırda "Fatura kes" yalnız izinliye görünür; Fatura belge düğmesi
//    devre dışı ve nedenini söyler ("Henüz fatura kesilmedi").
// ⭐ İç akış (finance:write) dış izden önce gelir; dış iz menüye düşer.
// ⭐ Belge yalnız ONAYLI iç faturada açılır; taslakta / yalnız dış izde nedenli devre dışı.
// =============================================================================
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, renderHook, screen } from "@testing-library/react";
import { getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { buildCsv } from "@/lib/table-export";
import { buildDispatchColumns } from "./columns";
import { dispatchRowView, NO_INVOICE_REASON, type DispatchActionCtx } from "./dispatchRowActions";
import { DocumentsCell, InvoiceInfoCell, type DispatchRowHandlers } from "./DispatchRowCells";
import type { DispatchListItem } from "./types";

function row(p: Partial<DispatchListItem> = {}): DispatchListItem {
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

const ctx = (perms: string[], p: Partial<DispatchActionCtx> = {}): DispatchActionCtx => ({
  financeEnabled: false,
  invoiceMode: "dis",
  can: (x) => perms.includes(x),
  ...p,
});

const confirmed = { id: "i1", docNo: "F-0001", status: "CONFIRMED" as const };
const draft = { id: "i2", docNo: "F-0002", status: "DRAFT" as const };

describe("dispatchRowView — saf yüklem", () => {
  it("faturasız + shipping:invoice → Fatura kes = dış iz; belge devre dışı", () => {
    const v = dispatchRowView(row(), ctx(["shipping:invoice"]));
    expect(v.info).toBeNull();
    expect(v.create).toBe("trace");
    expect(v.doc).toBeNull();
    expect(v.docReason).toBe(NO_INVOICE_REASON);
    expect(v.menu.map((m) => m.key)).toEqual(["irsaliye"]);
  });

  it("faturasız + izinsiz → Fatura kes yok", () => {
    expect(dispatchRowView(row(), ctx([])).create).toBeNull();
  });

  it("ticaret rejimi + finance:write → Fatura kes = iç taslak; dış iz menüde", () => {
    const v = dispatchRowView(row(), ctx(["shipping:invoice", "finance:write"], { financeEnabled: true }));
    expect(v.create).toBe("draft");
    expect(v.menu.map((m) => m.key)).toEqual(["markTrace", "irsaliye"]);
  });

  it("ic rejiminde dış iz yazılamaz → izinli de olsa Fatura kes yok (finance kapalıyken)", () => {
    expect(dispatchRowView(row(), ctx(["shipping:invoice"], { invoiceMode: "ic" })).create).toBeNull();
  });

  it("yalnız dış iz → bilgi bağı izi düzenler; belge 'bu sistemde yok'; Düzenle menüde", () => {
    const v = dispatchRowView(row({ invoiceNo: "SF1411260006", invoicedAt: "2026-11-14T00:00:00.000Z" }), ctx(["shipping:invoice"]));
    expect(v.info?.no).toBe("SF1411260006");
    expect(v.infoOpen).toEqual({ kind: "trace" });
    expect(v.create).toBeNull();
    expect(v.doc).toBeNull();
    expect(v.docReason).toMatch(/dış muhasebe/);
    expect(v.menu.map((m) => m.key)).toEqual(["editTrace", "irsaliye"]);
  });

  it("onaylı iç fatura + finance:read → bağ detayı açar, belge etkin", () => {
    const v = dispatchRowView(
      row({ invoiceNo: "SF1", invoices: [confirmed] }),
      ctx(["finance:read", "shipping:invoice"], { financeEnabled: true }),
    );
    expect(v.infoOpen).toEqual({ kind: "detail", invoiceId: "i1" });
    expect(v.doc).toEqual({ invoiceId: "i1", docNo: "F-0001" });
    expect(v.menu.map((m) => m.key)).toEqual(["openInvoice", "editTrace", "irsaliye"]);
  });

  it("iç taslak → bilgi taslak işaretli, belge 'taslakta' nedeniyle devre dışı", () => {
    const v = dispatchRowView(row({ invoices: [draft] }), ctx(["finance:read"], { financeEnabled: true }));
    expect(v.info).toEqual({ no: "F-0002", date: null, draft: true });
    expect(v.doc).toBeNull();
    expect(v.docReason).toMatch(/taslakta/);
  });

  it("onaylı iç fatura, finance:read yok → belge yetki nedeniyle kapalı, bağ düz metin", () => {
    const v = dispatchRowView(row({ invoices: [confirmed] }), ctx([], { financeEnabled: true }));
    expect(v.infoOpen).toBeNull();
    expect(v.docReason).toMatch(/yetkiniz yok/);
  });
});

function handlers(perms: string[], p: Partial<DispatchActionCtx> = {}): DispatchRowHandlers {
  return {
    onBelge: vi.fn(),
    onTrace: vi.fn(),
    onDraft: vi.fn(),
    onOpenInvoice: vi.fn(),
    onPrintInvoice: vi.fn(),
    view: (r) => dispatchRowView(r, ctx(perms, p)),
  };
}

describe("Sevk Edilenler dışa aktarımı (PDF = Excel = CSV tek sütun tarifinden)", () => {
  it("bilgi sütunları değerli, Belgeler düğme sütunu dosyaya girmez; metraj BRÜT sayı", () => {
    const rows = [row({ invoiceNo: "SF1411260006", invoicedAt: "2026-11-14T00:00:00.000Z" })];
    const table = renderHook(() =>
      useReactTable({ data: rows, columns: buildDispatchColumns(handlers([])), getCoreRowModel: getCoreRowModel() }),
    ).result.current;
    const [head, body = []] = buildCsv(table, rows).trim().split("\r\n").map((r) => r.split(";"));
    expect(head).toEqual(["Sevkiyat No", "Müşteri", "Şube", "Sevk Tarihi", "İçerik", "Metraj (m)", "Kg", "Fatura", "Fatura Tarihi"]);
    expect(body[0]).toBe("SVK-1");
    expect(body[1]).toBe("Müşteri A");
    expect(body[4]).toBe("2 çuval · 10 top");
    expect(body[5]).toBe("1000");
    expect(body[7]).toBe("SF1411260006");
    expect(body[8]).toBe("14.11.2026");
  });
});

describe("Sevk Edilenler hücreleri", () => {
  it("faturasız satırda 'Fatura kes' görünür ve dış iz formunu açar", () => {
    const h = handlers(["shipping:invoice"]);
    render(<InvoiceInfoCell row={row()} h={h} />);
    fireEvent.click(screen.getByRole("button", { name: /Fatura kes/ }));
    expect(h.onTrace).toHaveBeenCalledTimes(1);
  });

  it("izinsiz kullanıcıda 'Fatura kes' çizilmez", () => {
    render(<InvoiceInfoCell row={row()} h={handlers([])} />);
    expect(screen.queryByRole("button", { name: /Fatura kes/ })).toBeNull();
    expect(screen.getByText("—")).toBeTruthy();
  });

  it("faturasız satırda Fatura düğmesi devre dışı + 'Henüz fatura kesilmedi' ipucu; İrsaliye etkin", () => {
    const h = handlers(["shipping:invoice"]);
    render(<DocumentsCell row={row()} h={h} />);
    const fatura = screen.getByRole("button", { name: /Fatura belgesi/ });
    expect((fatura as HTMLButtonElement).disabled).toBe(true);
    expect(fatura.parentElement?.getAttribute("title")).toBe(NO_INVOICE_REASON);
    fireEvent.click(screen.getByRole("button", { name: /İrsaliye/ }));
    expect(h.onBelge).toHaveBeenCalledTimes(1);
  });

  it("onaylı iç faturada Fatura düğmesi belgeyi açar; bilgi bağı detayı açar", () => {
    const h = handlers(["finance:read"], { financeEnabled: true });
    const r = row({ invoiceNo: "SF1411260006", invoicedAt: "2026-11-14T00:00:00.000Z", invoices: [confirmed] });
    render(
      <>
        <InvoiceInfoCell row={r} h={h} />
        <DocumentsCell row={r} h={h} />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Fatura belgesi" }));
    expect(h.onPrintInvoice).toHaveBeenCalledWith({ invoiceId: "i1", docNo: "F-0001" });
    fireEvent.click(screen.getByRole("button", { name: /SF1411260006/ }));
    expect(h.onOpenInvoice).toHaveBeenCalledWith("i1");
  });
});
