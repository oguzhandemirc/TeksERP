import { afterEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { DocumentPrinterDeviceSettings } from "./DocumentPrinterDeviceSettings";

// Sessiz basım (izlenebilirlik A2, KARAR: varsayılan = bugünkü diyalog): yazıcı seçilmeden açılamaz;
// web'de (window.api yok) ayar yerine "yalnız masaüstü" mesajı.

type WinApi = { api?: unknown };
afterEach(() => {
  (window as unknown as WinApi).api = undefined;
});

describe("DocumentPrinterDeviceSettings", () => {
  it("web'de ayar çizilmez, masaüstü mesajı görünür", () => {
    renderWithProviders(<DocumentPrinterDeviceSettings />);
    expect(screen.getByText(/yalnız masaüstü uygulamasında/)).toBeInTheDocument();
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("varsayılan KAPALI ve yazıcı seçilmeden açılamaz", () => {
    (window as unknown as WinApi).api = { docPrint: { print: vi.fn(), printers: vi.fn().mockResolvedValue([]) } };
    renderWithProviders(<DocumentPrinterDeviceSettings />);
    const toggle = screen.getByRole("switch");
    expect(toggle).not.toBeChecked();
    expect(toggle).toBeDisabled();
  });
});
