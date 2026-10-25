// Kural seti formu: CUSTOMER'da derece sütunu yok, FACTORY'de var; 409 tek aktif set → Türkçe açıklama.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError, type AxiosResponse } from "axios";
import { renderWithProviders } from "@/test/render";

const create = vi.fn();
vi.mock("./service", async (orig) => ({ ...(await orig<typeof import("./service")>()), ruleSetService: { create: (...a: unknown[]) => create(...a), update: vi.fn(), list: vi.fn(), setActive: vi.fn() } }));
vi.mock("@/components/forms/entity-picker/EntityPickerModal", () => ({
  EntityPickerModal: ({ onChange, placeholder }: { onChange: (id: string) => void; placeholder: string }) => <button type="button" onClick={() => onChange("g1")}>{placeholder}</button>,
}));
vi.mock("@/components/forms/CustomerPickerField", () => ({ CustomerPickerField: () => <span>müşteri seçici</span> }));
vi.mock("@/components/forms/ItemPickerModal", () => ({ ItemPickerModal: () => null }));
vi.mock("@/components/PermissionGate", () => ({ PermissionGate: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

import { RuleSetFormDialog } from "./RuleSetFormDialog";

const conflict = () => new AxiosError("409", "ERR_BAD_REQUEST", undefined, undefined,
  { status: 409, data: { success: false, message: "x", details: { code: "FOUR_POINT_RULE_ACTIVE_EXISTS" } } } as AxiosResponse);

describe("RuleSetFormDialog", () => {
  beforeEach(() => { create.mockReset(); });
  it("CUSTOMER: bant tablosunda kalite derecesi sütunu ve seçici YOK", () => {
    renderWithProviders(<RuleSetFormDialog set={null} scope="CUSTOMER" onClose={() => {}} />);
    expect(screen.queryByText("Kalite derecesi")).toBeNull();
    expect(screen.queryByText("Derece seç…")).toBeNull();
    expect(screen.getByText("müşteri seçici")).toBeInTheDocument();
  });
  it("FACTORY: her bantta derece seçici (modal tetiği) var; son bandın üst sınırı 'Sınırsız'", () => {
    renderWithProviders(<RuleSetFormDialog set={null} scope="FACTORY" onClose={() => {}} />);
    expect(screen.getAllByText("Derece seç…")).toHaveLength(2);
    expect(screen.getByLabelText("2. bant üst sınırı")).toHaveAttribute("placeholder", "Sınırsız");
  });
  it("409 tek aktif FACTORY → Türkçe açıklama formda kalır", async () => {
    create.mockRejectedValue(conflict());
    const user = userEvent.setup();
    renderWithProviders(<RuleSetFormDialog set={null} scope="FACTORY" onClose={() => {}} />);
    await user.type(screen.getByLabelText("Ad"), "Fabrika");
    await user.type(screen.getByLabelText("1. bant üst sınırı"), "20");
    await user.type(screen.getByLabelText("1. bant etiketi"), "A");
    await user.type(screen.getByLabelText("2. bant etiketi"), "B");
    for (const b of screen.getAllByText("Derece seç…")) await user.click(b);
    await user.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0]![0]).toMatchObject({ scope: "FACTORY", bands: [{ maxScore: "20", qualityGradeId: "g1" }, { maxScore: null, qualityGradeId: "g1" }] });
    expect(await screen.findByTestId("rule-set-error")).toHaveTextContent("Aktif bir fabrika varsayılanı zaten var");
  });
  it("eksik alanla Kaydet sunucuya gitmez, eksikler listelenir", async () => {
    const user = userEvent.setup();
    renderWithProviders(<RuleSetFormDialog set={null} scope="FACTORY" onClose={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Kaydet" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Eksik: Ad");
    expect(create).not.toHaveBeenCalled();
  });
});
