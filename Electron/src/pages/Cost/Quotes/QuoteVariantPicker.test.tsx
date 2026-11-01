// Varyant seçici yalnız izin + üretim modülü açık + etkin varyant varken çizilir; aksi halde sorgu ATILMAZ
// (koşulsuz 403 / MODULE_DISABLED üreten istek yok) ya da seçici gizlenir.
import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";

const access = { perm: true, production: true as boolean | undefined };
const load = vi.fn(async () => ({ data: [] as unknown[] }));
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: () => access.perm }) }));
vi.mock("@/hooks/usePricingEnabled", () => ({ useFeatureFlags: () => ({ data: { data: { productionEnabled: access.production } } }) }));
vi.mock("@/lib/picker-loader", () => ({ loadAllForPicker: (...a: unknown[]) => load(...(a as [])) }));
vi.mock("@/components/forms/entity-picker/EntityPickerModal", () => ({ EntityPickerModal: () => <span>secici-modal</span> }));
import { QuoteVariantPicker } from "./QuoteVariantPicker";

const render = () => renderWithProviders(<QuoteVariantPicker itemId="i-1" value={null} onChange={() => {}} />);

describe("QuoteVariantPicker — kapı", () => {
  beforeEach(() => {
    load.mockReset();
    access.perm = true;
    access.production = true;
  });
  it("izin yoksa sorgu atılmaz, seçici çizilmez", () => {
    access.perm = false;
    render();
    expect(load).not.toHaveBeenCalled();
    expect(screen.queryByTestId("quote-line-variant")).toBeNull();
  });
  it("üretim modülü kapalıysa sorgu atılmaz, seçici çizilmez", () => {
    access.production = false;
    render();
    expect(load).not.toHaveBeenCalled();
    expect(screen.queryByTestId("quote-line-variant")).toBeNull();
  });
  it("etkin varyant yoksa seçici çizilmez", async () => {
    load.mockResolvedValue({ data: [] });
    render();
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("quote-line-variant")).toBeNull();
  });
  it("etkin varyant varsa seçici çizilir", async () => {
    load.mockResolvedValue({ data: [{ id: "r-1", code: "R1", name: "Beyaz", variantCode: "V1" }] });
    render();
    expect(await screen.findByTestId("quote-line-variant")).toBeTruthy();
  });
});
