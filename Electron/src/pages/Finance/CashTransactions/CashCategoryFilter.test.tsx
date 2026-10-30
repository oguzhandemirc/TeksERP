// BEKÇİ — Kasa hareketleri kategori süzgeci (D4-KUC e): düğme doğrudan modal açar; seçim sunucu
// ANAHTARINI (Masraf Özeti kovası) iletir, etiketi değil; seçenek ucu okunamazsa (eski backend) süzgeç gizlenir.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";

const listMock = vi.fn();
vi.mock("./categorySuggestions", () => ({ listCashCategoryOptions: () => listMock() }));
import { CashCategoryFilter } from "./CashCategoryFilter";

beforeEach(() => listMock.mockReset());

describe("kasa hareketleri — kategori süzgeci", () => {
  it("seçim anahtarı iletir; seçili etiket düğmede görünür", async () => {
    listMock.mockResolvedValue([{ key: "CAT:", label: "Kategorisiz" }, { key: "CAT:Kira", label: "Kira" }]);
    const onChange = vi.fn();
    renderWithProviders(<CashCategoryFilter value="" onChange={onChange} />);
    fireEvent.click(await screen.findByRole("button", { name: /Tüm kategoriler/ }));
    fireEvent.click(await screen.findByText("Kira"));
    expect(onChange).toHaveBeenCalledWith("CAT:Kira");
  });

  it("seçiliyken etiket görünür; 'Tüm kategoriler' seçimi boş anahtar verir", async () => {
    listMock.mockResolvedValue([{ key: "CAT:Kira", label: "Kira" }]);
    const onChange = vi.fn();
    renderWithProviders(<CashCategoryFilter value="CAT:Kira" onChange={onChange} />);
    fireEvent.click(await screen.findByRole("button", { name: "Kategori: Kira" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent?.includes("Tüm kategoriler"))!);
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("seçenek ucu hata verirse (eski backend) süzgeç çizilmez", async () => {
    listMock.mockResolvedValue(null);
    renderWithProviders(<CashCategoryFilter value="" onChange={() => {}} />);
    await waitFor(() => expect(listMock).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("button")).toBeNull());
  });

  it("seçenek ucu okunamaz ama URL'den süzgeç etkinse görünür kalır ve kaldırılabilir", async () => {
    listMock.mockResolvedValue(null);
    const onChange = vi.fn();
    renderWithProviders(<CashCategoryFilter value="CAT:Kira" onChange={onChange} />);
    fireEvent.click(await screen.findByRole("button", { name: "Kategori süzgecini kaldır" }));
    expect(onChange).toHaveBeenCalledWith("");
  });
});
