// Tahar dizisi girişi: düğme ↔ kısaltmalı metin senkronu + form şemasının sunucu ikizi sınırları.
import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm } from "react-hook-form";
import { renderWithProviders } from "@/test/render";
import { DrawingInSequenceEditor, appendFrame, removeLastFrame } from "./DrawingInSequenceEditor";
import { drawingInPlanSchema, formDefaults, type DrawingInPlanFormValues } from "./schema";

vi.mock("@/services/apiClient", () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));

let notation = "";
function Harness({ initial = "", frames = 4 }: { initial?: string; frames?: number }) {
  const form = useForm<DrawingInPlanFormValues>({ defaultValues: { ...formDefaults(null), frameCount: frames, notation: initial } });
  notation = form.watch("notation");
  return <DrawingInSequenceEditor form={form} />;
}

describe("appendFrame / removeLastFrame", () => {
  it("düğme sona tel ekler ve tekrarı kısaltır", () => {
    expect(appendFrame("", 1)).toBe("1");
    expect(appendFrame("1-2-3-4-1-2-3", 4)).toBe("2x(1-2-3-4)");
    expect(appendFrame("2x(1-2-3-4)", 5)).toBe("2x(1-2-3-4) 5");
  });
  it("bozuk yazımda kullanıcının metni silinmez", () => {
    expect(appendFrame("(1-2", 3)).toBe("(1-2 3");
    expect(removeLastFrame("(1-2")).toBe("(1-2");
  });
  it("son teli sil: 2x(1-2) 3 → 2x(1-2)", () => {
    expect(removeLastFrame("2x(1-2) 3")).toBe("2x(1-2)");
  });
});

describe("DrawingInSequenceEditor", () => {
  it("çerçeve sayısı kadar düğme; düğme metni günceller", async () => {
    renderWithProviders(<Harness initial="1-2-3" frames={4} />);
    expect(screen.getAllByRole("button", { name: /^\d+$/ })).toHaveLength(4);
    await userEvent.click(screen.getByRole("button", { name: "4" }));
    expect(notation).toBe("1-2-3-4");
    expect(screen.getByText(/4 tel · tekrar birimi 4 tel/)).toBeTruthy();
  });
});

describe("drawingInPlanSchema", () => {
  const base = { name: "Düz", frameCount: 4, notation: "1-2-3-4", selvedgeThreading: "", notes: "" };
  it("geçerli plan geçer", () => {
    expect(drawingInPlanSchema(12).safeParse(base).success).toBe(true);
  });
  it("çerçeve sayısını aşan numara notation alanında hata", () => {
    const r = drawingInPlanSchema(12).safeParse({ ...base, notation: "1-5" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(["notation"]);
  });
  it("firma tavanını aşan çerçeve sayısı reddedilir", () => {
    expect(drawingInPlanSchema(12).safeParse({ ...base, frameCount: 13 }).success).toBe(false);
    expect(drawingInPlanSchema(16).safeParse({ ...base, frameCount: 13 }).success).toBe(true);
  });
  it("kenar taharı aşımı kendi alanında", () => {
    const r = drawingInPlanSchema(12).safeParse({ ...base, selvedgeThreading: "1-7" });
    expect(r.error?.issues[0]?.path).toEqual(["selvedgeThreading"]);
  });
});
