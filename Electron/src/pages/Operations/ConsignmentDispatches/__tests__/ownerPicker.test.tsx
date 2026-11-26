// Emanet çıkışı sahip seçicisi `/owners` ucundan okur: doğrudan modal · arama sunucuya gider · seçilen ad kutuda ·
// tavan söylenir · hata "kayıt yok" sanılmaz.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { OwnerPickerField } from "../OwnerPickerField";
import { listConsignmentOwners } from "../service";

const get = vi.fn();
vi.mock("@/services/apiClient", () => ({ default: { get: (...a: unknown[]) => get(...a) } }));

const DATA = { owners: [{ id: "cA", code: "M-001", name: "Gül Perde" }], truncated: true };

beforeEach(() => {
  get.mockReset();
  get.mockResolvedValue({ data: { data: DATA } });
});

describe("listConsignmentOwners", () => {
  it("/owners ucunu çağırır; boş arama gönderilmez", async () => {
    await listConsignmentOwners("  ");
    expect(get).toHaveBeenCalledWith("/api/consignment-dispatches/owners", { params: { limit: "100" } });
    await listConsignmentOwners(" gül ");
    expect(get).toHaveBeenLastCalledWith("/api/consignment-dispatches/owners", { params: { limit: "100", search: "gül" } });
  });
});

describe("OwnerPickerField", () => {
  it("kutu modal açar; yalnız emaneti olanlar listelenir; seçim id'yi verir ve adı gösterir", async () => {
    const onChange = vi.fn();
    const { rerender } = renderWithProviders(<OwnerPickerField value={null} onChange={onChange} />);
    expect(get).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Malın sahibini seç" }));
    expect(await screen.findByText("Gül Perde")).toBeInTheDocument();
    expect(get.mock.calls[0]![0]).toBe("/api/consignment-dispatches/owners");
    expect(screen.getByTestId("owners-truncated")).toHaveTextContent("aramayı daraltın");
    fireEvent.click(screen.getByText("Gül Perde"));
    expect(onChange).toHaveBeenCalledWith("cA");
    rerender(<OwnerPickerField value="cA" onChange={onChange} />);
    expect(screen.getByRole("button", { name: "Malın sahibini seç" })).toHaveTextContent("Gül Perde — M-001");
  });

  it("hata 'yüklenemedi' der, boş liste ayrı cümle", async () => {
    get.mockRejectedValueOnce(new Error("x"));
    const { unmount } = renderWithProviders(<OwnerPickerField value={null} onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Malın sahibini seç" }));
    expect(await screen.findByText(/Liste yüklenemedi/)).toBeInTheDocument();
    unmount();
    get.mockResolvedValueOnce({ data: { data: { owners: [], truncated: false } } });
    renderWithProviders(<OwnerPickerField value={null} onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Malın sahibini seç" }));
    await waitFor(() => expect(screen.getByText("Fabrikada emaneti olan müşteri yok.")).toBeInTheDocument());
  });
});
