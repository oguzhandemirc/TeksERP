// BEKÇİ — istasyon formu kurşun bölümü (oie-a): anahtar kapalıyken tablo yok; varsayılan radyosu tektir; kayıt tam liste yollar.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StationKursunSection } from "./StationKursunSection";

const get = vi.fn();
const put = vi.fn();
vi.mock("@/services/apiClient", () => ({ default: { get: (...a: unknown[]) => get(...a), put: (...a: unknown[]) => put(...a) } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const dto = (enabled: boolean) => ({
  stationId: "s1", enabled, flagPropertyId: "f1", gramPrice: null, gramCurrency: null,
  values: [
    { id: "v1", code: "40-GR", name: "40 gr", amount: "40", isDefault: true, isActive: true, sortOrder: 10 },
    { id: "v2", code: "60-GR", name: "60 gr", amount: "60", isDefault: false, isActive: true, sortOrder: 20 },
  ],
});
const mount = () => render(<QueryClientProvider client={new QueryClient()}><StationKursunSection stationId="s1" /></QueryClientProvider>);

describe("StationKursunSection", () => {
  beforeEach(() => { get.mockReset(); put.mockReset(); });

  it("kapalıyken gramaj tablosu çizilmez; açınca görünür", async () => {
    get.mockResolvedValue({ data: { data: dto(false) } });
    mount();
    await screen.findByTestId("station-kursun-section");
    expect(screen.queryByTestId("kursun-gramaj-table")).toBeNull();
    fireEvent.click(screen.getByTestId("kursun-enabled"));
    expect(screen.getByTestId("kursun-gramaj-table")).toBeTruthy();
  });

  it("varsayılanı değiştirip kaydedince tek varsayılanlı tam liste gider", async () => {
    get.mockResolvedValue({ data: { data: dto(true) } });
    put.mockResolvedValue({ data: { data: dto(true) } });
    mount();
    fireEvent.click(await screen.findByLabelText("60 gr varsayılan"));
    expect((screen.getByLabelText("40 gr varsayılan") as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByTestId("kursun-save"));
    await waitFor(() => expect(put).toHaveBeenCalled());
    const body = put.mock.calls[0]?.[1] as { values: Array<{ code: string; isDefault: boolean }> };
    expect(String(put.mock.calls[0]?.[0])).toBe("/api/station-capabilities/s1/kursun");
    expect(body.values.filter((v) => v.isDefault).map((v) => v.code)).toEqual(["60-GR"]);
  });
});
