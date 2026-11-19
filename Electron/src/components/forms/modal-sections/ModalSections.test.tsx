import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { z } from "zod";
import { EntityFormDialog } from "../EntityFormDialog";
import { FormCard } from "../WideFormDialog";
import { readHiddenSections, withHidden, isSectionHidden } from "./section-visibility";

// Modal bölüm görünürlüğü: × yanındaki menü, zorunlu bölüm kilidi, hata ile kendiliğinden görünme, varsayılana dön.

const schema = z.object({ name: z.string().min(1, "Ad zorunlu"), note: z.string().max(3, "Not çok uzun") });

function renderForm(opts: { sectionsKey?: string; withSections?: boolean } = {}) {
  const { sectionsKey = "test.form", withSections = true } = opts;
  return render(
    <EntityFormDialog
      open
      onOpenChange={() => undefined}
      title="Deneme"
      size="wide"
      sectionsKey={sectionsKey}
      schema={schema}
      defaultValues={{ name: "Mavi", note: "" }}
      onSubmit={() => undefined}
    >
      {(form) =>
        withSections ? (
          <>
            <FormCard sectionId="identity" sectionRequired title="Kimlik">
              <input aria-label="Ad" {...form.register("name")} />
            </FormCard>
            <FormCard sectionId="note" errorFields={["note"]} title="Not">
              <input aria-label="Not alanı" {...form.register("note")} />
            </FormCard>
          </>
        ) : (
          <FormCard title="Düz kart">
            <input aria-label="Ad" {...form.register("name")} />
          </FormCard>
        )
      }
    </EntityFormDialog>,
  );
}

async function openMenu() {
  await userEvent.click(await screen.findByTestId("modal-sections-trigger"));
  return screen.findByTestId("modal-sections-list");
}

describe("section-visibility saf katman", () => {
  it("bozuk kayıt süzülür, tekrar düşer", () => {
    expect(readHiddenSections(null)).toEqual([]);
    expect(readHiddenSections({ a: 1 })).toEqual([]);
    expect(readHiddenSections(["a", 3, "", "a", "b"])).toEqual(["a", "b"]);
  });
  it("gizle/göster ve kilit", () => {
    expect(withHidden(["a"], "b", true)).toEqual(["a", "b"]);
    expect(withHidden(["a", "b"], "a", false)).toEqual(["b"]);
    expect(isSectionHidden(["a"], "a", false)).toBe(true);
    expect(isSectionHidden(["a"], "a", true)).toBe(false);
  });
});

describe("ModalSections", () => {
  it("bölüm beyanı yoksa tetik çizilmez", () => {
    renderForm({ withSections: false });
    expect(screen.queryByTestId("modal-sections-trigger")).toBeNull();
  });

  it("bölüm gizlenir, değer korunur; zorunlu bölüm kilitli; varsayılana dön", async () => {
    renderForm();
    await openMenu();
    expect(screen.getByTestId("modal-section-toggle-identity")).toBeDisabled();
    fireEvent.input(screen.getByLabelText("Not alanı"), { target: { value: "ab" } });
    await userEvent.click(screen.getByTestId("modal-section-toggle-note"));
    await waitFor(() => expect(screen.queryByLabelText("Not alanı")).toBeNull());
    expect(screen.getByTestId("modal-sections-trigger")).toHaveAccessibleName("Bölümleri göster/gizle (1 gizli)");
    await userEvent.click(screen.getByRole("button", { name: /Varsayılana dön/ }));
    await waitFor(() => expect(screen.getByLabelText("Not alanı")).toHaveValue("ab"));
  });

  it("gizli bölümde doğrulama hatası olunca bölüm kendiliğinden görünür", async () => {
    renderForm();
    await openMenu();
    fireEvent.input(screen.getByLabelText("Not alanı"), { target: { value: "çok uzun" } });
    await userEvent.click(screen.getByTestId("modal-section-toggle-note"));
    await waitFor(() => expect(screen.queryByLabelText("Not alanı")).toBeNull());
    await userEvent.keyboard("{Escape}");
    fireEvent.submit(screen.getByLabelText("Ad").closest("form")!);
    await waitFor(() => expect(screen.getByLabelText("Not alanı")).toBeInTheDocument());
    await openMenu();
    expect(screen.getByTestId("modal-section-toggle-note")).toBeDisabled();
  });
});
