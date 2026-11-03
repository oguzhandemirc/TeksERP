// K22 — İstasyon yeteneği varsayılanları: "Varsayılan açık" yalnız OPTIONAL'da,
// "Varsayılan değer" doğrudan modal; yalnız DEĞİŞEN satır varsayılan alanlarını gönderir.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { useAuthStore } from "@/store/auth";
import type { JwtPayload } from "@/types/auth";
import { StationKind } from "@/types/enums";
import { TERIM } from "@/lib/terim";
import type { StationCapabilitySummary } from "./types";

const STATION: StationCapabilitySummary = {
  stationId: "st-t", stationCode: "TMB", stationName: "Tambur", stationKind: StationKind.PROCESS_QC,
  hasDefaultCategory: true, canApplyColor: false, canApplyProperty: true, canApplyQuality: false,
  inspectionEnabled: false, colorCount: 0, propertyCount: 2,
};

const setCapabilities = vi.fn((..._a: unknown[]) => Promise.resolve({ success: true, data: null }));

vi.mock("./service", () => ({
  stationCapabilityService: {
    getByStation: () =>
      Promise.resolve({
        success: true,
        data: {
          ...STATION, colors: [],
          properties: [
            { id: "p-kat", code: "KAT", name: "Kat", category: null, valueType: "CHOICE", mode: "OPTIONAL", values: [], defaultOn: false, defaultValueId: null },
            { id: "p-kur", code: "KURSUN", name: "Kurşun", category: null, valueType: "FLAG", mode: "AUTO", values: [], defaultOn: false, defaultValueId: null },
          ],
        },
      }),
    setCapabilities: (...a: unknown[]) => setCapabilities(...a),
  },
}));

const v = (id: string, name: string) => ({ id, code: name, name, sortOrder: 0, isActive: true });
vi.mock("@/lib/picker-loader", () => ({
  loadAllForPicker: () =>
    Promise.resolve({
      data: [
        { id: "p-kat", code: "KAT", name: "Kat", valueType: "CHOICE", values: [v("k2", "2 Kat"), v("k4", "4 Kat")] },
        { id: "p-kur", code: "KURSUN", name: "Kurşun", valueType: "FLAG", values: [] },
        { id: "p-gr", code: "GRAMAJ", name: "Gramaj", valueType: "CHOICE", variantOfPropertyId: "p-kur", values: [v("g25", "25 gr")] },
      ],
    }),
}));

import { CapabilitiesEditSheet } from "./CapabilitiesEditSheet";

beforeEach(() => {
  setCapabilities.mockClear();
  useAuthStore.setState({ user: { permissions: ["station:read", "station:write"] } as unknown as JwtPayload });
});

describe("İstasyon yeteneği varsayılanları (K22)", () => {
  it("OPTIONAL satırda anahtar var; AUTO satırda salt bilgi; bayrak satırı çeşidin değerlerini sunar", async () => {
    renderWithProviders(<CapabilitiesEditSheet station={STATION} open onOpenChange={() => {}} />);
    const kat = await screen.findByTestId("cap-row-p-kat");
    expect(within(kat).getByRole("switch", { name: /Kat varsayılan açık/ })).toBeInTheDocument();
    const kur = screen.getByTestId("cap-row-p-kur");
    expect(within(kur).queryByRole("switch")).toBeNull();
    expect(within(kur).getByText(`${TERIM.terbiyeIsEmri.cekim.bulunma} hep seçili`)).toBeInTheDocument();
    fireEvent.click(within(kur).getByRole("button", { name: /Kurşun varsayılan değer/ }));
    expect(await screen.findByRole("button", { name: /25 gr/ })).toBeInTheDocument();
  });

  it("Kat'ı varsayılan açık + 4 Kat yapınca yalnız o satır varsayılanları gönderir", async () => {
    renderWithProviders(<CapabilitiesEditSheet station={STATION} open onOpenChange={() => {}} />);
    const kat = await screen.findByTestId("cap-row-p-kat");
    expect(screen.getByRole("button", { name: /Kaydet/ })).toBeDisabled();
    fireEvent.click(within(kat).getByRole("switch"));
    fireEvent.click(within(kat).getByRole("button", { name: /Kat varsayılan değer/ }));
    fireEvent.click(await screen.findByRole("button", { name: /4 Kat/ }));
    fireEvent.click(screen.getByRole("button", { name: /Kaydet/ }));
    await waitFor(() => expect(setCapabilities).toHaveBeenCalledTimes(1));
    expect(setCapabilities.mock.calls[0]?.[1]).toEqual([
      { propertyId: "p-kat", mode: "OPTIONAL", defaultOn: true, defaultValueId: "k4" },
      { propertyId: "p-kur", mode: "AUTO" },
    ]);
  });
});

describe("Çeşit hiyerarşisi (QA 2026-11-03 #16/#17)", () => {
  it("seçici listesinde çeşit ebeveyninin altında 'Ebeveyn › Çeşit' etiketiyle durur", async () => {
    const { propertyPickerItems } = await import("./capabilityDefaults");
    const items = propertyPickerItems([
      { id: "p-gr", code: "GR", name: "Gramaj", category: null, variantOfPropertyId: "p-kur", values: [] },
      { id: "p-kat", code: "KAT", name: "Kat", category: "İşlem", values: [] },
      { id: "p-kur", code: "KURSUN", name: "Kurşun", category: "İşlem", values: [] },
    ] as never);
    expect(items.map((i) => [i.label, i.group])).toEqual([
      ["Kat", "İşlem"],
      ["Kurşun", "İşlem"],
      ["Kurşun › Gramaj", "İşlem"],
    ]);
  });

  it("çeşit istasyonda kendi satırıyla tanımlıysa ebeveyn satırı çeşidin değerlerini sunmaz", async () => {
    const { defaultValueOptions } = await import("./capabilityDefaults");
    const cat = [
      { id: "p-kur", name: "Kurşun", values: [] },
      { id: "p-gr", name: "Gramaj", variantOfPropertyId: "p-kur", values: [v("g25", "25 gr")] },
    ] as never;
    expect(defaultValueOptions("p-kur", cat, ["p-kur"]).map((o) => o.id)).toEqual(["g25"]);
    expect(defaultValueOptions("p-kur", cat, ["p-kur", "p-gr"])).toEqual([]);
    expect(defaultValueOptions("p-gr", cat, ["p-kur", "p-gr"]).map((o) => o.id)).toEqual(["g25"]);
  });
});
