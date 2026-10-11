// "Koşumu geri al" (C.10, 1e kararı: salonda yalnız AÇIK koşum + tek tezgah): sebep boşken düğme pasif,
// çok hatlı tezgahta hangi koşum sorulur, gönderim seçilen koşum + kırpılmış sebeple.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import type { LiveLoom } from "../types";

const api = vi.hoisted(() => ({ context: vi.fn(), preview: vi.fn(), assign: vi.fn(), finish: vi.fn(), revoke: vi.fn() }));
vi.mock("./runService", () => ({ runService: api }));

import { RevokeRunDialog } from "./RevokeRunDialog";

const run = (id: string, line: number, jobNo: string | null) => ({ id, line, jobId: "w", jobNo, startedAt: Date.parse("2026-10-10T08:00:00.000Z") });
const one = { id: "a", code: "T-a", lines: 1, openRuns: [run("r1", 1, "DI-7")] } as unknown as LiveLoom;
const two = { id: "b", code: "T-b", lines: 2, openRuns: [run("r1", 1, "DI-7"), run("r2", 2, null)] } as unknown as LiveLoom;
const geriAl = () => screen.getByRole("button", { name: "Geri al" });

beforeEach(() => {
  vi.clearAllMocks();
  api.revoke.mockResolvedValue({});
});

describe("RevokeRunDialog", () => {
  it("⭐ sebep boşken (yalnız boşluk dahil) Geri al pasif; yazılınca açılır ve kırpılmış sebeple gider", async () => {
    renderWithProviders(<RevokeRunDialog open onOpenChange={() => undefined} loom={one} online />);
    expect(screen.getByText(/DI-7/)).toBeTruthy();
    expect(geriAl().hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByLabelText("Geri alma sebebi"), { target: { value: "   " } });
    expect(geriAl().hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByLabelText("Geri alma sebebi"), { target: { value: " yanlış tezgah " } });
    fireEvent.click(geriAl());
    await waitFor(() => expect(api.revoke).toHaveBeenCalledWith("r1", "yanlış tezgah"));
  });

  it("⭐ çok hatlı tezgahta koşum SEÇİLMEDEN gönderilmez; seçilen hattın koşumu gider", async () => {
    renderWithProviders(<RevokeRunDialog open onOpenChange={() => undefined} loom={two} online />);
    fireEvent.change(screen.getByLabelText("Geri alma sebebi"), { target: { value: "deneme" } });
    expect(geriAl().hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: /2\. hat — İşsiz koşum/ }));
    fireEvent.click(geriAl());
    await waitFor(() => expect(api.revoke).toHaveBeenCalledWith("r2", "deneme"));
  });

  it("⭐ C.15 bağlantı yokken pasif", () => {
    renderWithProviders(<RevokeRunDialog open onOpenChange={() => undefined} loom={one} online={false} />);
    fireEvent.change(screen.getByLabelText("Geri alma sebebi"), { target: { value: "x" } });
    expect(geriAl().hasAttribute("disabled")).toBe(true);
  });
});
