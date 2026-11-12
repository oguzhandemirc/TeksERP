// Editör bileşeni: yıldız/↑↓/kaldır eylemleri tam set PUT'unu (onApply) doğru sırayla üretir;
// varsayılanı kaldırmak onay penceresinden geçer. Saf kurallar `labelOptionSet.test.ts`te.
import { describe, it, expect, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { OptionSetPair } from "./OptionSetPair";
import { toPutBody, type OptionSetDraft } from "./labelOptionSet";
import type { OptionSetChange } from "./useOptionSets";

vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({ hasPermission: () => true, hasAnyPermission: () => true, hasAllPermissions: () => true, isAdmin: false }),
}));

const d = (ids: string[], def: string | null): OptionSetDraft => ({
  entries: ids.map((id) => ({ templateId: id, name: id, active: true })),
  defaultTemplateId: def,
});

function setup(raw = d(["Türkçe", "English", "Italiano"], "Türkçe")) {
  const onApply = vi.fn<(c: OptionSetChange[]) => void>();
  renderWithProviders(
    <OptionSetPair
      drafts={{ ROLL_RAW: raw, ROLL_FINISHED: d([], null) }}
      pending={false}
      onApply={onApply}
      noDefaultHint={() => "yıldız yok"}
      removeDefaultText="Varsayılan kalkar."
    />,
  );
  const body = () => {
    const c = onApply.mock.calls.at(-1)?.[0]?.[0];
    return c ? toPutBody(c.kind, c.draft) : null;
  };
  return { onApply, body, raw: within(screen.getByTestId("option-set-ROLL_RAW")) };
}

describe("LabelOptionSetEditor", () => {
  it("yıldız varsayılanı taşır → gövde aynı sıra + yeni varsayılan", async () => {
    const { raw, body } = setup();
    await userEvent.click(raw.getByRole("button", { name: "English varsayılan yap" }));
    expect(body()).toEqual({ kind: "ROLL_RAW", templateIds: ["Türkçe", "English", "Italiano"], defaultTemplateId: "English" });
  });

  it("↑ sırayı değiştirir, uçtaki düğme pasif", async () => {
    const { raw, body } = setup();
    expect(raw.getByRole("button", { name: "Türkçe yukarı taşı" })).toBeDisabled();
    await userEvent.click(raw.getByRole("button", { name: "Italiano yukarı taşı" }));
    expect(body()?.templateIds).toEqual(["Türkçe", "Italiano", "English"]);
  });

  it("varsayılan olmayanı kaldırmak doğrudan yazar", async () => {
    const { raw, body } = setup();
    await userEvent.click(raw.getByRole("button", { name: "English kaldır" }));
    expect(body()).toEqual({ kind: "ROLL_RAW", templateIds: ["Türkçe", "Italiano"], defaultTemplateId: "Türkçe" });
  });

  it("varsayılanı kaldırmak onay ister; onayda yıldız boşalır", async () => {
    const { raw, onApply, body } = setup();
    await userEvent.click(raw.getByRole("button", { name: "Türkçe kaldır" }));
    expect(onApply).not.toHaveBeenCalled();
    const dlg = await screen.findByRole("dialog");
    expect(dlg).toHaveTextContent("Sette kalanlar: English, Italiano");
    await userEvent.click(within(dlg).getByRole("button", { name: "Kaldır" }));
    expect(body()).toEqual({ kind: "ROLL_RAW", templateIds: ["English", "Italiano"], defaultTemplateId: null });
  });

  it("yıldız yoksa ipucu görünür; boş set yazısı", () => {
    setup(d(["A"], null));
    expect(screen.getAllByText("yıldız yok")).toHaveLength(2);
    expect(within(screen.getByTestId("option-set-ROLL_FINISHED")).getByText("Bu sette şablon yok.")).toBeInTheDocument();
  });
});
