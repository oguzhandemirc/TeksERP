// Erteleme menüsü: süren vardiya yoksa "Vardiya sonu" pasif + açıklama; varsa / bilinmiyorsa seçilebilir.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";

const svc = vi.hoisted(() => ({ ozet: vi.fn() }));
vi.mock("@/services/bildirimService", () => ({
  bildirimService: svc,
  httpStatusOf: () => null,
  notificationErrorCode: () => undefined,
}));
vi.mock("@/lib/bildirim/headers", () => ({ openBellStream: () => new Promise(() => {}) }));

import { SnoozeMenu } from "./SnoozeMenu";

const ozet = (vardiyaBitis: string | null | undefined) =>
  ({ enabled: true, okunmamis: 0, alarmAcik: 0, epoch: 1, rev: 1, alarmRev: 0, ...(vardiyaBitis === undefined ? {} : { vardiyaBitis }) });

async function ac() {
  const onSec = vi.fn();
  renderWithProviders(<SnoozeMenu onSec={onSec} />);
  fireEvent.keyDown(screen.getByRole("button", { name: "Ertele" }), { key: "Enter" });
  await waitFor(() => expect(svc.ozet).toHaveBeenCalled());
  return onSec;
}
const vardiyaSecenegi = () => screen.getByText("Vardiya sonu").closest("[role='menuitem']")!;

describe("SnoozeMenu", () => {
  beforeEach(() => svc.ozet.mockReset());

  it("süren vardiya yoksa 'Vardiya sonu' pasif ve açıklamalı", async () => {
    svc.ozet.mockResolvedValue(ozet(null));
    await ac();
    await waitFor(() => expect(screen.getByText("Süren vardiya yok")).toBeTruthy());
    expect(vardiyaSecenegi().getAttribute("data-disabled")).not.toBeNull();
  });

  it("süren vardiya varsa seçilebilir", async () => {
    svc.ozet.mockResolvedValue(ozet("2026-10-25T14:00:00Z"));
    const onSec = await ac();
    await waitFor(() => expect(screen.getByText("Vardiya sonu")).toBeTruthy());
    expect(screen.queryByText("Süren vardiya yok")).toBeNull();
    fireEvent.click(vardiyaSecenegi());
    expect(onSec).toHaveBeenCalledWith("shift-sonu");
  });

  it("eski backend (alan yok) → seçenek açık kalır, sunucu korur", async () => {
    svc.ozet.mockResolvedValue(ozet(undefined));
    await ac();
    await waitFor(() => expect(screen.getByText("Vardiya sonu")).toBeTruthy());
    expect(vardiyaSecenegi().getAttribute("data-disabled")).toBeNull();
  });
});
