// Etiketler → Atamalar: herkes için set kartı. Ham/bitmiş tek seçim satırı set kartına
// taşınır; eski backend 404'te kart SESSİZCE çizilmez ve tek seçim satırları geri gelir.
import { beforeEach, describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError, AxiosHeaders } from "axios";
import { renderWithProviders } from "@/test/render";
import type { OptionSetKind } from "@/services/labelTemplateOptionService";
import { LabelAssignmentsPage } from "./LabelAssignmentsPage";

const getGlobal = vi.fn();
const setGlobal = vi.fn();
const toastError = vi.fn();
const apiGet = vi.fn();

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: (...a: unknown[]) => toastError(...a) } }));
vi.mock("@/services/apiClient", () => ({ default: { get: (...a: unknown[]) => apiGet(...a) } }));
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({ hasPermission: () => true, hasAnyPermission: () => true, hasAllPermissions: () => true, isAdmin: false }),
}));
vi.mock("@/services/labelTemplateService", async (orig) => ({
  ...(await orig<typeof import("@/services/labelTemplateService")>()),
  labelTemplateService: {
    listContextDefaults: () => Promise.resolve([]),
    list: () => Promise.resolve({ success: true, data: [] }),
    setContextDefault: vi.fn(),
  },
}));

const notFound = () => {
  const err = new AxiosError("Not Found");
  err.response = { status: 404, data: {}, statusText: "", headers: {}, config: { headers: new AxiosHeaders() } };
  return err;
};

beforeEach(() => {
  getGlobal.mockReset();
  setGlobal.mockReset().mockResolvedValue(undefined);
  toastError.mockReset();
  apiGet.mockReset();
});

vi.mock("@/services/labelTemplateOptionService", async (orig) => ({
  ...(await orig<typeof import("@/services/labelTemplateOptionService")>()),
  labelTemplateOptionService: { getGlobal: (...a: unknown[]) => getGlobal(...a), setGlobal: (...a: unknown[]) => setGlobal(...a) },
}));

describe("LabelAssignmentsPage — herkes için set", () => {
  it("set kartı çizilir, ham/bitmiş tek seçim satırı listeden düşer; yıldız PUT'u", async () => {
    getGlobal.mockImplementation((kind: OptionSetKind) =>
      Promise.resolve({
        kind,
        defaultTemplateId: "TR",
        items: [
          { templateId: "TR", name: "Türkçe", sortOrder: 0, isDefault: true, active: true },
          { templateId: "EN", name: "English", sortOrder: 1, isDefault: false, active: true },
        ],
      }),
    );
    renderWithProviders(<LabelAssignmentsPage hideHeader />);
    await screen.findByTestId("global-label-sets");
    expect(await screen.findByText("Çuval Etiketi")).toBeInTheDocument();
    expect(screen.queryByText("Ham Kumaş Etiketi", { selector: "span.min-w-40" })).toBeNull();
    await userEvent.click(screen.getAllByRole("button", { name: "English varsayılan yap" })[1]!);
    await waitFor(() =>
      expect(setGlobal).toHaveBeenCalledWith({ kind: "ROLL_FINISHED", templateIds: ["TR", "EN"], defaultTemplateId: "EN" }),
    );
  });

  it("eski backend 404 → kart yok, ham/bitmiş eski tek seçim satırı geri gelir, toast yok", async () => {
    getGlobal.mockRejectedValue(notFound());
    renderWithProviders(<LabelAssignmentsPage hideHeader />);
    expect(await screen.findByText("Ham Kumaş Etiketi", { selector: "span.min-w-40" })).toBeInTheDocument();
    expect(screen.getByText("Bitmiş Kumaş Etiketi", { selector: "span.min-w-40" })).toBeInTheDocument();
    expect(screen.queryByTestId("global-label-sets")).toBeNull();
    expect(toastError).not.toHaveBeenCalled();
  });

  it("servis GET'leri genel hata toast'ını bastırır (404 sessiz kalsın)", async () => {
    const real = await vi.importActual<typeof import("@/services/labelTemplateOptionService")>(
      "@/services/labelTemplateOptionService",
    );
    apiGet.mockResolvedValue({ data: { data: {} } });
    await real.labelTemplateOptionService.getGlobal("ROLL_RAW");
    await real.labelTemplateOptionService.getCustomer("c1", "ROLL_FINISHED");
    expect(apiGet).toHaveBeenNthCalledWith(1, "/api/label-templates/global-options?kind=ROLL_RAW", { suppressErrorToast: true });
    expect(apiGet).toHaveBeenNthCalledWith(2, "/api/customers/c1/label-template-options?kind=ROLL_FINISHED", { suppressErrorToast: true });
  });
});
