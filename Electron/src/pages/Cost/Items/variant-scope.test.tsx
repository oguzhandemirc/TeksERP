// SY-N4: standart maliyet sürümünün varyant kapsamı. Varyantsız ürün / station:read yok → seçici çizilmez ve
// istekler bugünkü gibi (recipeId YOK); varyant seçilince kayıt gövdesi ve geçmiş sorgusu recipeId taşır.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError, type AxiosResponse } from "axios";
import { renderWithProviders } from "@/test/render";

const svc = vi.hoisted(() => ({ versions: vi.fn(), version: vi.fn(), saveVersion: vi.fn(), restore: vi.fn() }));
vi.mock("./service", async (orig) => ({ ...(await orig<typeof import("./service")>()), costItemService: svc }));
const loadRecipes = vi.fn();
vi.mock("@/lib/picker-loader", () => ({ loadAllForPicker: (...a: unknown[]) => loadRecipes(...a) }));
let perms: string[] = [];
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({
    hasPermission: (p: string) => perms.includes(p),
    hasAnyPermission: (l: string[]) => l.some((p) => perms.includes(p)),
    hasAllPermissions: (l: string[]) => l.every((p) => perms.includes(p)),
  }),
}));

import { SaveVersionDialog } from "./SaveVersionDialog";
import { VersionsTab } from "./VersionsTab";
import { useCostVariants, type CostVariant } from "./variant-scope";

const variants: CostVariant[] = [
  { id: "r1", code: "RC-1", name: "Beyaz", isActive: true, variantCode: "V1" },
  { id: "r2", code: "RC-2", name: "Krem", isActive: false, variantCode: "V2" },
];
const ver = (id: string, durum: "ACTIVE" | "SUPERSEDED", n: number) => ({
  id, surumNo: n, durum, hamTlM: "10", mamulTlM: null, standartTlM: "12", cozguKgM: "0.1", atkiKgM: "0.1", tezgahMSaat: null,
  kurlar: {}, uyarilar: [], gerekce: null, hesaplananAt: "2026-10-30T09:00:00Z", gecersizAt: null, geriAlinanSurumId: null,
});

beforeEach(() => {
  Object.values(svc).forEach((f) => f.mockReset());
  loadRecipes.mockReset();
  svc.versions.mockResolvedValue([ver("v1", "ACTIVE", 1)]);
  svc.saveVersion.mockResolvedValue({ success: true, data: ver("v9", "ACTIVE", 9) });
  perms = ["cost:read", "cost:write", "station:read"];
});

describe("SaveVersionDialog — varyant kapsamı", () => {
  it("varyantsız üründe seçici yok, gövde recipeId taşımaz (bugünkü)", async () => {
    renderWithProviders(<SaveVersionDialog itemId="i1" fxRates={{}} onClose={() => {}} onMissing={() => {}} />);
    expect(screen.queryByTestId("cost-variant-scope")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(svc.saveVersion).toHaveBeenCalledWith("i1", { reason: undefined, fxRates: {}, recipeId: null }));
  });
  it("varyant seçilince recipeId gider; pasif varyant seçilemez", async () => {
    renderWithProviders(<SaveVersionDialog itemId="i1" fxRates={{}} variants={variants} onClose={() => {}} onMissing={() => {}} />);
    expect(screen.getByRole("button", { name: "Desen geneli" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "V2 · Krem (pasif)" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "V1 · Beyaz" }));
    await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(svc.saveVersion).toHaveBeenCalledWith("i1", { reason: undefined, fxRates: {}, recipeId: "r1" }));
  });
});

describe("SaveVersionDialog — varyant eksik girdisi", () => {
  const missingErr = () => new AxiosError("x", "400", undefined, undefined,
    { status: 400, data: { details: { code: "COST_INPUT_MISSING", missing: ["WARP_YARN"] } } } as AxiosResponse);
  it("varyant kaydında eksik desen alanlarına İŞARETLENMEZ, varyant notu çıkar; desen genelinde işaretlenir", async () => {
    svc.saveVersion.mockRejectedValue(missingErr());
    const onMissing = vi.fn();
    renderWithProviders(<SaveVersionDialog itemId="i1" fxRates={{}} variants={variants} onClose={() => {}} onMissing={onMissing} />);
    await userEvent.click(screen.getByRole("button", { name: "V1 · Beyaz" }));
    await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    expect(await screen.findByText(/Varyant girdisi eksik/)).toBeInTheDocument();
    expect(onMissing).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Desen geneli" }));
    await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(onMissing).toHaveBeenCalledWith(["WARP_YARN"]));
  });
});

describe("VersionsTab — varyant süzgeci", () => {
  it("varsayılan desen geneli; seçici yoksa bugünkü yüzey", async () => {
    renderWithProviders(<VersionsTab itemId="i1" active={null} />);
    expect(await screen.findByText("v1")).toBeInTheDocument();
    expect(screen.queryByTestId("cost-variant-scope")).toBeNull();
    expect(svc.versions).toHaveBeenCalledWith("i1", null);
  });
  it("varyant seçilince ?recipeId= zinciri okunur, pasif varyantın geçmişi de seçilebilir", async () => {
    svc.versions.mockImplementation(async (_i: string, r: string | null) => (r === "r2" ? [ver("v7", "SUPERSEDED", 7)] : [ver("v1", "ACTIVE", 1)]));
    renderWithProviders(<VersionsTab itemId="i1" active={null} variants={variants} />);
    expect(await screen.findByText("v1")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "V2 · Krem (pasif)" }));
    expect(await screen.findByText("v7")).toBeInTheDocument();
    expect(svc.versions).toHaveBeenLastCalledWith("i1", "r2");
    expect(screen.queryByRole("button", { name: "Bu sürümden geri yükle" })).toBeNull();
    expect(screen.getByText("Varyant pasif — geri yüklenemez")).toBeInTheDocument();
  });
  it("varyant seçilince aktif döküm varyant sürümünden okunur (desen geneli değil)", async () => {
    svc.versions.mockImplementation(async (_i: string, r: string | null) =>
      (r === "r1" ? [ver("v5", "ACTIVE", 5), ver("v4", "SUPERSEDED", 4)] : [ver("v1", "ACTIVE", 1)]));
    svc.version.mockResolvedValue({ ...ver("v5", "ACTIVE", 5), satirlar: [] });
    renderWithProviders(<VersionsTab itemId="i1" active={{ ...ver("v1", "ACTIVE", 1), satirlar: [] } as never} variants={variants} />);
    expect(await screen.findByText(/Aktif sürüm v1/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "V1 · Beyaz" }));
    expect(await screen.findByText(/Aktif sürüm v5/)).toBeInTheDocument();
    expect(svc.version).toHaveBeenCalledWith("i1", "v5");
    expect(screen.getByRole("button", { name: "Bu sürümden geri yükle" })).toBeInTheDocument();
  });
});

function VariantProbe() {
  const v = useCostVariants("i1");
  return <span data-testid="n">{v.length}</span>;
}

describe("useCostVariants — izin kapısı", () => {
  it("station:read yoksa varyant sorgusu ATILMAZ", async () => {
    perms = ["cost:read"];
    renderWithProviders(<VariantProbe />);
    expect(screen.getByTestId("n")).toHaveTextContent("0");
    expect(loadRecipes).not.toHaveBeenCalled();
  });
  it("izin varsa ürünün varyantları (pasif dahil) okunur", async () => {
    loadRecipes.mockResolvedValue({ data: variants });
    renderWithProviders(<VariantProbe />);
    await waitFor(() => expect(screen.getByTestId("n")).toHaveTextContent("2"));
    expect(loadRecipes.mock.calls[0]?.[1]).toEqual({ filters: { itemId: "i1" }, sortBy: "code" });
  });
});
