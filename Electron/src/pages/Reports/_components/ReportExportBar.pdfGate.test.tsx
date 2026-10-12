// =============================================================================
// BEKÇİ — PDF SATIR KAPISI (Perf-2 B2): rapor ve liste PDF'i ana sürecin bayt
// kapısının erken aynasından geçer; tavan aşılınca HTML kurulmaz, kaydet diyaloğu
// açılmaz, kullanıcı Excel'e yönlendirilir. Ana süreçten dönen hata toast'a gider.
// Negatif sonda: ReportExportBar'daki satır kontrolü kaldırılınca ⭐① kırmızı.
// =============================================================================
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PDF_MAX_ROWS, pdfTooManyRowsMessage } from "@shared/pdf-limits";
import { ReportExportBar } from "./ReportExportBar";
import type { ReportExportSpec } from "./reportExport";

const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: toastError, success: vi.fn(), info: vi.fn() } }));

const save = vi.fn(async () => ({ saved: false }));

function spec(rows: number): ReportExportSpec {
  return {
    title: "Sevk Edilenler",
    tables: [
      {
        name: "Detay",
        columns: [{ key: "a", header: "A" }],
        rows: Array.from({ length: rows }, (_, i) => ({ a: i })),
      },
    ],
  } as ReportExportSpec;
}

beforeEach(() => {
  (window as unknown as { api: unknown }).api = { pdf: { save } };
});
afterEach(() => {
  delete (window as unknown as { api?: unknown }).api;
  save.mockClear();
  toastError.mockClear();
});

describe("Rapor PDF satır kapısı", () => {
  it("⭐① tavan üstü rapor: ana sürece GİDİLMEZ, Excel'e yönlendiren metin", async () => {
    render(<ReportExportBar buildSpec={() => spec(PDF_MAX_ROWS + 1)} />);
    await userEvent.click(screen.getByRole("button", { name: /PDF/ }));
    expect(save).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(pdfTooManyRowsMessage(PDF_MAX_ROWS + 1, "Rapor"));
  });

  it("tavanda rapor ana sürece gider; dönen sabit hata metni toast'a basılır", async () => {
    save.mockResolvedValueOnce({ saved: false, error: "Belge PDF için çok büyük (7.000 KB) — PDF yerine Excel indirin." } as never);
    render(<ReportExportBar buildSpec={() => spec(PDF_MAX_ROWS)} />);
    await userEvent.click(screen.getByRole("button", { name: /PDF/ }));
    expect(save).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith("Belge PDF için çok büyük (7.000 KB) — PDF yerine Excel indirin.");
  });
});

describe("Liste PDF satır kapısı", () => {
  it("⭐ tavan üstü liste: ana sürece gidilmez; ana süreç hatası artık sessiz yutulmaz", async () => {
    const { exportRowsToPdf } = await import("@/lib/list-export");
    const cols = [{ key: "a", label: "A", value: (r: { a: number }) => r.a }];
    const big = Array.from({ length: PDF_MAX_ROWS + 1 }, (_, i) => ({ a: i }));
    expect(await exportRowsToPdf(cols, big, "liste")).toBe(false);
    expect(save).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(pdfTooManyRowsMessage(PDF_MAX_ROWS + 1));
    toastError.mockClear();
    save.mockResolvedValueOnce({ saved: false, error: "PDF oluşturulamadı (ERR_FAILED)" } as never);
    expect(await exportRowsToPdf(cols, [{ a: 1 }], "liste")).toBe(false);
    expect(toastError).toHaveBeenCalledWith("PDF oluşturulamadı (ERR_FAILED)");
  });
});
