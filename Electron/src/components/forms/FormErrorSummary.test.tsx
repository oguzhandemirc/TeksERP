// Sunum provası: hatalı alan varken Kaydet hiçbir şey demiyordu. Gönderim denemesinden sonra özet görünür olmalı.
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { renderWithProviders } from "@/test/render";
import { EntityFormDialog } from "./EntityFormDialog";
import { collectErrorMessages } from "./FormErrorSummary";

describe("FormErrorSummary", () => {
  it("iç içe hata mesajlarını tekilleştirerek toplar", () => {
    expect(collectErrorMessages({ a: { message: "A", type: "x" }, b: { c: { message: "A", type: "x" } }, d: { message: "D", type: "x" } } as never)).toEqual(["A", "D"]);
  });
  it("geçersiz gönderimde Kaydet'in yanında özet çıkar, onSubmit çağrılmaz", async () => {
    const onSubmit = vi.fn();
    const schema = z.object({ takeUpPct: z.string().refine((v) => v === "", "Take-up hatalı") });
    renderWithProviders(
      <EntityFormDialog open onOpenChange={() => {}} title="T" schema={schema} defaultValues={{ takeUpPct: "x" }} onSubmit={onSubmit}>
        {() => null}
      </EntityFormDialog>,
    );
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Take-up hatalı"));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
