// Müşteri → Etiket Şablonları: ham/bitmiş çoklu set + "Herkes için seti de göster" (K7).
// Eski backend set uçlarına 404 dönerse bölüm SESSİZCE gizlenir, ham/bitmiş bugünkü tek seçime döner.
import { beforeEach, describe, it, expect, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError, AxiosHeaders } from "axios";
import { renderWithProviders } from "@/test/render";
import type { CustomerLabelOptionSetResponse, OptionSetKind } from "@/services/labelTemplateOptionService";
import { CustomerTemplateRoutesPanel } from "./CustomerTemplateRoutesPanel";

const getCustomer = vi.fn();
const setCustomer = vi.fn();
const toastError = vi.fn();

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: (...a: unknown[]) => toastError(...a) } }));
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({ hasPermission: () => true, hasAnyPermission: () => true, hasAllPermissions: () => true, isAdmin: false }),
}));
vi.mock("@/services/labelTemplateOptionService", async (orig) => ({
  ...(await orig<typeof import("@/services/labelTemplateOptionService")>()),
  labelTemplateOptionService: {
    getCustomer: (...a: unknown[]) => getCustomer(...a),
    setCustomer: (...a: unknown[]) => setCustomer(...a),
  },
}));
vi.mock("@/services/labelTemplateService", async (orig) => ({
  ...(await orig<typeof import("@/services/labelTemplateService")>()),
  customerTemplateRouteService: { list: () => Promise.resolve([]), set: vi.fn() },
  labelTemplateService: { list: () => Promise.resolve({ success: true, data: [] }) },
}));

const opt = (templateId: string, isDefault = false) => ({ templateId, name: templateId, sortOrder: 0, isDefault, active: true });
const resp = (kind: OptionSetKind, showGlobalTemplates = true): CustomerLabelOptionSetResponse => ({
  kind,
  defaultTemplateId: kind === "ROLL_RAW" ? "X İngilizce" : null,
  items: kind === "ROLL_RAW" ? [opt("X İngilizce", true), opt("X Türkçe")] : [],
  showGlobalTemplates,
  globalItems: [opt("Türkçe Etiket", true), opt("English Label")],
});

function notFound() {
  const err = new AxiosError("Not Found");
  err.response = { status: 404, data: {}, statusText: "", headers: {}, config: { headers: new AxiosHeaders() } };
  return err;
}

beforeEach(() => {
  getCustomer.mockReset();
  setCustomer.mockReset().mockResolvedValue(undefined);
  toastError.mockReset();
});

describe("CustomerTemplateRoutesPanel — çoklu set", () => {
  it("setler ve herkes için önizleme çizilir; ham/bitmiş tek seçim satırı yok", async () => {
    getCustomer.mockImplementation((_id: string, kind: OptionSetKind) => Promise.resolve(resp(kind)));
    renderWithProviders(<CustomerTemplateRoutesPanel customerId="c1" />);
    const sec = await screen.findByTestId("customer-label-sets");
    expect(within(sec).getAllByTestId("global-preview")).toHaveLength(2);
    expect(within(sec).getByText("Varsayılan: herkes için ★ (Türkçe Etiket).")).toBeInTheDocument();
    expect(screen.queryByText("Ham Kumaş Etiketi", { selector: "span.w-44" })).toBeNull();
    expect(screen.getByText("Kartela Etiketi")).toBeInTheDocument();
  });

  it("anahtar kapalıyken önizleme gizli; anahtar değişimi PUT gövdesine showGlobalTemplates yazar", async () => {
    getCustomer.mockImplementation((_id: string, kind: OptionSetKind) => Promise.resolve(resp(kind, false)));
    renderWithProviders(<CustomerTemplateRoutesPanel customerId="c1" />);
    const sec = await screen.findByTestId("customer-label-sets");
    expect(within(sec).queryByTestId("global-preview")).toBeNull();
    await userEvent.click(within(sec).getByRole("switch", { name: "Herkes için seti de göster" }));
    await waitFor(() =>
      expect(setCustomer).toHaveBeenCalledWith("c1", {
        kind: "ROLL_RAW",
        templateIds: ["X İngilizce", "X Türkçe"],
        defaultTemplateId: "X İngilizce",
        showGlobalTemplates: true,
      }),
    );
  });

  it("yıldız gövdesi: {kind, templateIds, defaultTemplateId}", async () => {
    getCustomer.mockImplementation((_id: string, kind: OptionSetKind) => Promise.resolve(resp(kind)));
    renderWithProviders(<CustomerTemplateRoutesPanel customerId="c1" />);
    await screen.findByTestId("customer-label-sets");
    await userEvent.click(screen.getByRole("button", { name: "X Türkçe varsayılan yap" }));
    await waitFor(() =>
      expect(setCustomer).toHaveBeenCalledWith("c1", {
        kind: "ROLL_RAW",
        templateIds: ["X İngilizce", "X Türkçe"],
        defaultTemplateId: "X Türkçe",
      }),
    );
  });

  it("eski backend 404 → bölüm sessizce gizlenir, ham/bitmiş eski tek seçime döner, toast yok", async () => {
    getCustomer.mockRejectedValue(notFound());
    renderWithProviders(<CustomerTemplateRoutesPanel customerId="c1" />);
    expect(await screen.findByText("Ham Kumaş Etiketi")).toBeInTheDocument();
    expect(screen.getByText("Bitmiş Kumaş Etiketi")).toBeInTheDocument();
    expect(screen.queryByTestId("customer-label-sets")).toBeNull();
    expect(toastError).not.toHaveBeenCalled();
  });
});
