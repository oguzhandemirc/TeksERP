// =============================================================================
// BEKÇİ — Panel cari kilidi (D4-I3): §1 form kapsam ön seçimi `financeCariHoldDefaultScope`tan · §2 koy gövdesi
//   strict + token deneme başına (4xx'te yeni, belirsizde aynı) · §3 ⭐ `releaseBySamePerson=DENY`de aynı kişinin
//   409 metni diyalogda olduğu gibi · §4 izinsizde Koy/Aç düğmesi YOK · §5 süzgeç/derin bağlantı yardımcıları
// =============================================================================
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { AxiosError, AxiosHeaders } from "axios";
import { renderWithProviders } from "@/test/render";

const get = vi.fn();
const post = vi.fn();
vi.mock("@/services/apiClient", () => ({ default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) } }));
let scopeSetting = "INTAKE,SHIPMENT";
vi.mock("@/hooks/usePricingEnabled", () => ({ useFeatureFlags: () => ({ data: { data: { financeEnabled: true, financeCariHoldDefaultScope: scopeSetting } } }) }));
let perms: string[] = [];
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({
    hasPermission: (p: string) => perms.includes(p),
    hasAnyPermission: (ps: string[]) => ps.some((p) => perms.includes(p)),
    hasAllPermissions: (ps: string[]) => ps.every((p) => perms.includes(p)),
  }),
}));
import { CariHoldPanel } from "./CariHoldPanel";
import { scopesFromSetting, toPlaceBody } from "./cariHoldService";
import { holdFilterFromSearch, holdFilters } from "../cariListFilters";

const ACTIVE = {
  id: "h1", cariId: "c1", scopes: ["INTAKE", "SHIPMENT"], reasonCode: "BORC", reasonLabel: "Borç", reasonText: null,
  placedById: "u1", placedByName: "Ayşe", createdAt: "2026-10-31T08:00:00Z", releasedAt: null, releasedByName: null, releaseReason: null,
};
const DENY_MSG = "Bu kilidi siz koydunuz; fabrika ayarı gereği kilidi açma yetkisi olan BAŞKA bir kişi açmalı.";
const axiosErr = (status: number, message?: string) =>
  new AxiosError("x", String(status), undefined, undefined, status === 0 ? undefined : { status, statusText: "", headers: {}, config: { headers: new AxiosHeaders() }, data: { message, details: { code: "CARI_HOLD_SAME_PERSON" } } });

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  perms = ["finance:read", "finance:hold", "finance:hold-release"];
  scopeSetting = "INTAKE,SHIPMENT";
});

describe("CariHoldPanel", () => {
  it("§1 ⭐ Koy formu kapsamı defaultScope ayarından ön seçer", async () => {
    scopeSetting = "SHIPMENT,INVOICE";
    get.mockResolvedValue({ data: { data: { cariId: "c1", active: null, history: [] } } });
    renderWithProviders(<CariHoldPanel target={{ customerId: "k1" }} cariName="ARZU" />);
    fireEvent.click(await screen.findByRole("button", { name: /Kilit koy/ }));
    expect(screen.getByRole("checkbox", { name: "Yeni iş kabulü" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Sevk" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Fatura onayı" })).toBeChecked();
    expect(get).toHaveBeenCalledWith("/api/finance/cari/by-customer/k1/holds");
  });

  it("§2 koy: strict gövde; token belirsiz hatada yapışır, kesin 4xx'te yenilenir", async () => {
    get.mockResolvedValue({ data: { data: { cariId: "c1", active: null, history: [] } } });
    post.mockRejectedValueOnce(axiosErr(0)).mockRejectedValueOnce(axiosErr(409, "Bu carinin zaten aktif bir kilidi var")).mockResolvedValueOnce({ data: { message: "Cari kilitlendi." } });
    renderWithProviders(<CariHoldPanel target={{ cariId: "c1" }} cariName="ARZU" />);
    fireEvent.click(await screen.findByRole("button", { name: /Kilit koy/ }));
    const go = () => fireEvent.click(screen.getByRole("button", { name: "Kilitle" }));
    go();
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    await screen.findByRole("alert");
    go();
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    await screen.findByText(/zaten aktif bir kilidi var/);
    go();
    await waitFor(() => expect(post).toHaveBeenCalledTimes(3));
    const bodies = post.mock.calls.map((c) => c[1] as { clientToken: string });
    expect(post.mock.calls[0]?.[0]).toBe("/api/finance/cari/c1/holds");
    expect(Object.keys(bodies[0] ?? {}).sort()).toEqual(["blocksIntake", "blocksInvoice", "blocksShipment", "clientToken", "reasonCode", "reasonText"]);
    expect(bodies[1]?.clientToken).toBe(bodies[0]?.clientToken); // ağ hatası: aynı deneme
    expect(bodies[2]?.clientToken).not.toBe(bodies[1]?.clientToken); // kesin 409: yeni deneme
  });

  it("§3 ⭐ releaseBySamePerson=DENY: aynı kişinin 409 metni diyalogda gösterilir", async () => {
    get.mockResolvedValue({ data: { data: { cariId: "c1", active: ACTIVE, history: [ACTIVE] } } });
    post.mockRejectedValue(axiosErr(409, DENY_MSG));
    renderWithProviders(<CariHoldPanel target={{ cariId: "c1" }} cariName="ARZU" />);
    fireEvent.click(await screen.findByRole("button", { name: /Kilidi aç/ }));
    const btn = screen.getAllByRole("button", { name: "Kilidi aç" }).at(-1) as HTMLElement;
    expect(btn).toBeDisabled(); // sebep zorunlu
    fireEvent.change(screen.getByLabelText("Açma sebebi"), { target: { value: "Borç ödendi" } });
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(DENY_MSG));
    expect(post).toHaveBeenCalledWith("/api/finance/cari/holds/h1/release", { reason: "Borç ödendi" });
  });

  it("§4 izinsiz kullanıcıda Koy/Aç düğmeleri çizilmez, tarihçe görünür", async () => {
    perms = ["finance:read"];
    get.mockResolvedValue({ data: { data: { cariId: "c1", active: ACTIVE, history: [ACTIVE] } } });
    renderWithProviders(<CariHoldPanel target={{ cariId: "c1" }} cariName="ARZU" />);
    await screen.findByText(/Cari kilitli/);
    expect(screen.queryByRole("button", { name: /Kilidi aç/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Kilit koy/ })).toBeNull();
    expect(screen.getByText("Aktif")).toBeInTheDocument();
  });

  it("§5 yardımcılar: ayar → kapsam, form → gövde, süzgeç sunucuya gider", () => {
    expect(scopesFromSetting("INTAKE,SHIPMENT,INVOICE")).toEqual(["INTAKE", "SHIPMENT", "INVOICE"]);
    expect(scopesFromSetting(undefined)).toEqual(["INTAKE", "SHIPMENT"]);
    expect(scopesFromSetting("INVOICE,BILINMEZ")).toEqual(["INVOICE"]);
    expect(toPlaceBody({ scopes: ["INVOICE"], reasonCode: "RISK", reasonText: "  " }, "t")).toEqual({ blocksIntake: false, blocksShipment: false, blocksInvoice: true, reasonCode: "RISK", reasonText: null, clientToken: "t" });
    expect(holdFilters("held")).toEqual({ held: "true" });
    expect(holdFilters("all")).toEqual({});
    expect(holdFilterFromSearch("?kilit=1")).toBe("held");
    expect(holdFilterFromSearch("")).toBe("all");
  });
});
