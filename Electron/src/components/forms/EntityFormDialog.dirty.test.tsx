import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { z } from "zod";
import { TabIdProvider } from "@/components/layout/tabs/tab-active";
import { getDirtyTabIds, installDirtyTabListener, resetDirtyTabsForTest } from "@/components/layout/tabs/dirty-tabs";
import { EntityFormDialog } from "./EntityFormDialog";

// Ortak form katmanı → kirli sekme: react-hook-form `isDirty` (eski değere dönünce temiz), DOM algısı karışmaz.

const schema = z.object({ name: z.string() });

function renderForm(open = true) {
  return render(
    <TabIdProvider value="t1">
      <EntityFormDialog
        open={open}
        onOpenChange={() => undefined}
        title="Renk"
        schema={schema}
        defaultValues={{ name: "Mavi" }}
        onSubmit={() => undefined}
      >
        {(form) => <input aria-label="Ad" {...form.register("name")} />}
      </EntityFormDialog>
    </TabIdProvider>,
  );
}

afterEach(() => resetDirtyTabsForTest());

describe("EntityFormDialog kirli sekme", () => {
  it("yazınca sekme kirli; eski değere dönünce ve diyalog kapanınca temiz", async () => {
    installDirtyTabListener();
    const view = renderForm();
    const input = screen.getByLabelText("Ad");
    expect(getDirtyTabIds().has("t1")).toBe(false);
    fireEvent.input(input, { target: { value: "Mavi 2" } });
    await waitFor(() => expect(getDirtyTabIds().has("t1")).toBe(true));
    fireEvent.input(input, { target: { value: "Mavi" } });
    await waitFor(() => expect(getDirtyTabIds().has("t1")).toBe(false));
    fireEvent.input(input, { target: { value: "Kırmızı" } });
    await waitFor(() => expect(getDirtyTabIds().has("t1")).toBe(true));
    view.unmount();
    expect(getDirtyTabIds().has("t1")).toBe(false);
  });
});
