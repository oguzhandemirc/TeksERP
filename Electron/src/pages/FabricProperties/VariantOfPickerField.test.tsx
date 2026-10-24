// "Şunun çeşidi" seçicisi (KQ-D4): tetik doğrudan MODAL açar (combobox yok),
// yalnız BAYRAK'ları listeler, başka çeşidi olan bayrak pasif, "Çeşit değil" null döner.
import { describe, it, expect, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { VariantOfPickerField } from "./VariantOfPickerField";
import type { FabricProperty } from "./types";

const prop = (p: Partial<FabricProperty> & Pick<FabricProperty, "id" | "name" | "valueType">): FabricProperty => ({
  code: p.id.toUpperCase(),
  category: null,
  description: null,
  color: null,
  sortOrder: 0,
  isActive: true,
  createdAt: "",
  updatedAt: "",
  variantOfPropertyId: null,
  ...p,
});

const ALL: FabricProperty[] = [
  prop({ id: "kursun", name: "Kurşunlu", valueType: "FLAG" }),
  prop({ id: "zimpara", name: "Zımparalı", valueType: "FLAG" }),
  prop({ id: "kat", name: "Kat", valueType: "CHOICE" }),
  prop({ id: "renk-x", name: "Zımpara derecesi", valueType: "CHOICE", variantOfPropertyId: "zimpara" }),
  prop({ id: "self", name: "Kurşun gramajı", valueType: "CHOICE" }),
];

describe("VariantOfPickerField", () => {
  it("tetik modal açar; yalnız bayraklar listelenir, dolu bayrak pasif", async () => {
    const onChange = vi.fn();
    renderWithProviders(<VariantOfPickerField value={null} onChange={onChange} properties={ALL} selfId="self" />);
    await userEvent.click(screen.getByRole("button", { name: /Çeşit değil/ }));
    const dlg = await screen.findByRole("dialog");
    expect(within(dlg).queryByText("Kat")).toBeNull();
    expect(within(dlg).queryByText("Kurşun gramajı")).toBeNull();
    expect(within(dlg).getByRole("button", { name: /Zımparalı/ })).toBeDisabled();
    await userEvent.click(within(dlg).getByRole("button", { name: /Kurşunlu/ }));
    expect(onChange).toHaveBeenCalledWith("kursun");
  });

  it("seçili bağ tetikte adıyla görünür; 'Çeşit değil' null gönderir", async () => {
    const onChange = vi.fn();
    renderWithProviders(<VariantOfPickerField value="kursun" onChange={onChange} properties={ALL} selfId="self" />);
    await userEvent.click(screen.getByRole("button", { name: /Kurşunlu/ }));
    const dlg = await screen.findByRole("dialog");
    await userEvent.click(within(dlg).getByRole("button", { name: /Çeşit değil/ }));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
