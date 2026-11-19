import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FormField } from "@/components/forms/FormField";

describe("FormField info — (i) ikonu açıklama balonu", () => {
  it("uzun açıklama satırda görünmez; tıklayınca balon açılır ve tetik ona aria-describedby ile bağlanır", async () => {
    const user = userEvent.setup();
    render(
      <FormField label="Çekme (take-up) %" htmlFor="t" info="Çözgü ÷ kumaş oranı">
        <input id="t" />
      </FormField>,
    );
    expect(screen.queryByText("Çözgü ÷ kumaş oranı")).toBeNull();
    const btn = screen.getByRole("button", { name: "Açıklama" });
    await user.click(btn);
    const tip = await screen.findByRole("tooltip");
    expect(tip.textContent).toBe("Çözgü ÷ kumaş oranı");
    expect(btn.getAttribute("aria-describedby")).toBe(tip.id);
    // Etiket input'a bağlı kalır (ikon etiketin DIŞINDA).
    expect(screen.getByLabelText("Çekme (take-up) %")).toBeTruthy();
  });

  it("klavye odağında açılır", async () => {
    const user = userEvent.setup();
    render(
      <FormField label="Fire (%)" htmlFor="f" info="Fireli kg'yı etkiler">
        <input id="f" />
      </FormField>,
    );
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Açıklama" }));
    await waitFor(() => expect(screen.getByRole("tooltip").textContent).toBe("Fireli kg'yı etkiler"));
  });

  it("info verilmezse ikon çizilmez (varsayılan davranış)", () => {
    render(
      <FormField label="Kod" htmlFor="k">
        <input id="k" />
      </FormField>,
    );
    expect(screen.queryByRole("button", { name: "Açıklama" })).toBeNull();
  });
});
