// SY-D4 BEKÇİ — atkı ücreti panel yüzeyleri: (1) `cost:write` yoksa yapıda yazma düğmesi yok, alan kilitli;
// (2) `cost:settings` yoksa parametre setinde atkı ücreti girişi yok; (3) TEZGAH_SAATI + kayıtsız değer →
// alan çizilmez ve gövdeye `loomPick*` GİRMEZ (Adnan Şahin/dokuma bayt-aynı); (4) ATKI_UCRETI → çift birlikte gider.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import type { CostItemDetail } from "./Items/service";
import type { CostParameterSet } from "./Parameters/service";

let method: "TEZGAH_SAATI" | "ATKI_UCRETI" = "TEZGAH_SAATI";
vi.mock("@/hooks/usePricingEnabled", async (orig) => ({
  ...(await orig<typeof import("@/hooks/usePricingEnabled")>()),
  useFeatureFlags: () => ({ data: { data: { costWeavingStandardMethod: method } } }),
}));
let perms: string[] = [];
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({ hasPermission: (p: string) => perms.includes(p), hasAnyPermission: (l: string[]) => l.some((p) => perms.includes(p)) }),
}));
vi.mock("./FinishingRates/service", () => ({ finishingRateService: { listActive: async () => [] } }));
const put = vi.fn();
vi.mock("@/services/apiClient", () => ({ default: { put: (...a: unknown[]) => put(...a), get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
const params = vi.hoisted(() => ({ active: vi.fn(), draft: vi.fn(), list: vi.fn(), createDraft: vi.fn(), updateDraft: vi.fn(), activate: vi.fn(), remove: vi.fn() }));
vi.mock("./Parameters/service", async (orig) => ({ ...(await orig<typeof import("./Parameters/service")>()), costParamService: params }));
vi.mock("@/components/layout/PageHeader", () => ({
  PageHeader: ({ title, actions }: { title: string; actions?: React.ReactNode }) => <header><h1>{title}</h1>{actions}</header>,
}));

import { StructureTab } from "./Items/StructureTab";
import { ParametersPage } from "./Parameters/ParametersPage";

const DETAIL = {
  urun: { id: "i1", kod: "TUL-1", ad: "Tül" },
  yapi: null,
  girdi: { weft: null, warp: null } as unknown as CostItemDetail["girdi"],
  yapiDurumu: "VARSAYILAN", eksikler: [], uyarilar: [], aktifSurum: null, girdiDegisti: false,
} as CostItemDetail;

function lastPutBody(): Record<string, unknown> {
  return put.mock.calls.at(-1)?.[1] as Record<string, unknown>;
}

beforeEach(() => {
  method = "TEZGAH_SAATI";
  perms = [];
  put.mockReset().mockResolvedValue({ data: { success: true, data: {} } });
  Object.values(params).forEach((f) => f.mockReset());
});

describe("Ürün yapısı — atkı ücreti alanı", () => {
  it("TEZGAH_SAATI + kayıtsız değer → alan yok, kayıt gövdesinde loomPick* yok (bayt-aynı)", async () => {
    perms = ["cost:write"];
    renderWithProviders(<StructureTab detail={DETAIL} measured={null} flagged={new Set()} />);
    expect(screen.queryByLabelText("Atkı ücreti")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Yapıyı kaydet" }));
    await waitFor(() => expect(put).toHaveBeenCalled());
    expect(Object.keys(lastPutBody()).filter((k) => k.startsWith("loomPick"))).toEqual([]);
  });

  it("ATKI_UCRETI + cost:write → ücret ve döviz birlikte gönderilir", async () => {
    method = "ATKI_UCRETI";
    perms = ["cost:write"];
    renderWithProviders(<StructureTab detail={DETAIL} measured={null} flagged={new Set()} />);
    fireEvent.change(screen.getByLabelText("Atkı ücreti"), { target: { value: "0,02" } });
    fireEvent.change(screen.getByLabelText("Atkı ücreti dövizi"), { target: { value: "USD" } });
    fireEvent.click(screen.getByRole("button", { name: "Yapıyı kaydet" }));
    await waitFor(() => expect(put).toHaveBeenCalled());
    expect(lastPutBody()).toMatchObject({ loomPickRate: "0.02", loomPickCurrency: "USD" });
  });

  it("⭐ cost:write YOK → yazma düğmesi yok, atkı ücreti alanı kilitli", () => {
    method = "ATKI_UCRETI";
    perms = ["cost:read"];
    renderWithProviders(<StructureTab detail={DETAIL} measured={null} flagged={new Set()} />);
    expect(screen.queryByRole("button", { name: "Yapıyı kaydet" })).toBeNull();
    expect(screen.getByLabelText("Atkı ücreti")).toBeDisabled();
    expect(screen.getByLabelText("Atkı ücreti dövizi")).toBeDisabled();
  });

  it("ayar TEZGAH_SAATI'na dönse de kayıtlı ücret görünür kalır (sessizce silinmez)", () => {
    perms = ["cost:write"];
    const d = { ...DETAIL, yapi: { loomPickRate: "0.0400", loomPickCurrency: "USD" } } as unknown as CostItemDetail;
    renderWithProviders(<StructureTab detail={d} measured={null} flagged={new Set()} />);
    expect(screen.getByLabelText("Atkı ücreti")).toHaveValue("0,04");
  });
});

const SET = { id: "p1", versionNo: 3, status: "ACTIVE", activatedAt: "2026-10-30T09:00:00Z", supersededAt: null, note: null,
  createdAt: "", updatedAt: "", defaultLoomPickRate: "0.0200", defaultLoomPickCurrency: "USD" } as unknown as CostParameterSet;

describe("Parametre seti — varsayılan atkı ücreti", () => {
  it("⭐ cost:settings YOK → yürürlükteki değer okunur, giriş ve yazma düğmesi yok", async () => {
    method = "ATKI_UCRETI";
    perms = ["cost:read"];
    params.active.mockResolvedValue(SET);
    params.draft.mockResolvedValue(null);
    renderWithProviders(<ParametersPage />);
    expect(await screen.findByTestId("pick-rate-row")).toHaveTextContent("0,02 USD");
    expect(screen.queryByLabelText("Varsayılan atkı ücreti")).toBeNull();
    expect(screen.queryByRole("button", { name: /Taslak oluştur/ })).toBeNull();
  });

  it("⭐ cost:settings YOK + açık taslak → taslak değeri salt okunur, giriş yok", async () => {
    method = "ATKI_UCRETI";
    perms = ["cost:read"];
    params.active.mockResolvedValue(SET);
    params.draft.mockResolvedValue({ ...SET, id: "p2", status: "DRAFT", versionNo: 4 });
    renderWithProviders(<ParametersPage />);
    expect(await screen.findByTestId("pick-rate-row")).toHaveTextContent("Taslak:");
    expect(screen.queryByLabelText("Varsayılan atkı ücreti")).toBeNull();
  });

  it("TEZGAH_SAATI + değersiz set → satır çizilmez; taslak kaydı gövdesinde atkı ücreti yok", async () => {
    perms = ["cost:settings"];
    const plain = { ...SET, defaultLoomPickRate: null, defaultLoomPickCurrency: null };
    params.active.mockResolvedValue(plain);
    params.draft.mockResolvedValue({ ...plain, id: "p2", status: "DRAFT", versionNo: 4 });
    params.updateDraft.mockResolvedValue({ success: true });
    renderWithProviders(<ParametersPage />);
    await screen.findByText(/Açık taslak: v4/);
    expect(screen.queryByTestId("pick-rate-row")).toBeNull();
    fireEvent.change(screen.getByLabelText("Genel gider (%)"), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: /Kaydet/ }));
    await waitFor(() => expect(params.updateDraft).toHaveBeenCalled());
    expect(Object.keys(params.updateDraft.mock.calls[0]?.[1] as object).filter((k) => k.includes("LoomPick"))).toEqual([]);
  });

  it("ATKI_UCRETI + cost:settings → taslakta ücret + döviz birlikte kaydedilir", async () => {
    method = "ATKI_UCRETI";
    perms = ["cost:settings"];
    params.active.mockResolvedValue(SET);
    params.draft.mockResolvedValue({ ...SET, id: "p2", status: "DRAFT", versionNo: 4 });
    params.updateDraft.mockResolvedValue({ success: true });
    renderWithProviders(<ParametersPage />);
    fireEvent.change(await screen.findByLabelText("Varsayılan atkı ücreti"), { target: { value: "0,04" } });
    fireEvent.click(screen.getByRole("button", { name: /Kaydet/ }));
    await waitFor(() => expect(params.updateDraft).toHaveBeenCalled());
    expect(params.updateDraft.mock.calls[0]?.[1]).toMatchObject({ defaultLoomPickRate: "0.04", defaultLoomPickCurrency: "USD" });
  });
});
