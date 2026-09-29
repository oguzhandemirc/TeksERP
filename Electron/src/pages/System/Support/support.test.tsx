import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { SCREENSHOT_MAX_BYTES, pickScreenshotEncoding } from "@shared/screenshot";
import { systemTiles } from "../tile-config";
import type { SupportTicket } from "./types";

const create = vi.fn();
vi.mock("@/services/supportService", () => ({ supportService: { create: (b: unknown) => create(b), list: async () => [], detail: async () => null } }));
const { SupportForm, canCaptureScreenshot } = await import("./SupportForm");
const { ticketMeta } = await import("./SupportTickets");

const ticket = (p: Partial<SupportTicket> = {}): SupportTicket => ({
  id: "t1", subject: "Tartı", description: "donuyor", status: "ACIK", ticketNo: "DST-000001", screenshotType: null, panelVersion: "1.3.3",
  sentAt: null, lastSyncedAt: null, sendAttempts: 1, lastErrorCode: null, createdAt: "2026-09-29T21:30:00.000Z", updatedAt: "2026-09-29T21:30:00.000Z",
  createdBy: { id: "u1", fullName: "Depo Sorumlusu" }, ...p,
});

describe("ekran görüntüsü kodlama seçimi (saf)", () => {
  it("sınırın altındaki EN geniş + EN kaliteli kodlamayı seçer", () => {
    const calls: string[] = [];
    const out = pickScreenshotEncoding((w, q) => {
      calls.push(`${w}/${q}`);
      return new Uint8Array(w === 1600 && q >= 65 ? SCREENSHOT_MAX_BYTES + 1 : 100);
    }, 1920);
    expect(out?.length).toBe(100);
    expect(calls).toEqual(["1600/80", "1600/65", "1600/50"]);
  });

  it("genişlik kaynak genişliğini aşmaz; hiçbiri sığmazsa null", () => {
    const widths = new Set<number>();
    const out = pickScreenshotEncoding((w) => {
      widths.add(w);
      return new Uint8Array(SCREENSHOT_MAX_BYTES + 1);
    }, 1024);
    expect(out).toBeNull();
    expect([...widths]).toEqual([1024, 960]);
  });
});

describe("Destek formu", () => {
  beforeEach(() => {
    create.mockReset();
    delete (window as { api?: unknown }).api;
  });

  it("karo ↔ route izni tek kod; tarayıcı panelinde yakalama düğmesi yok", () => {
    expect(systemTiles.find((t) => t.key === "support")?.permission).toBe("support:create");
    expect(canCaptureScreenshot()).toBe(false);
    renderWithProviders(<SupportForm onCreated={() => undefined} />);
    expect(screen.queryByText("Ekran görüntüsü ekle")).toBeNull();
  });

  it("belirsiz hatada AYNI clientToken yapışır, başarıdan sonra YENİ deneme", async () => {
    create.mockRejectedValueOnce({ response: { status: 503 } }).mockResolvedValue(ticket());
    const done = vi.fn();
    renderWithProviders(<SupportForm onCreated={done} />);
    fireEvent.change(screen.getByLabelText("Konu"), { target: { value: "  Tartı donuyor " } });
    fireEvent.change(screen.getByLabelText("Açıklama"), { target: { value: "2 dk donuyor" } });
    fireEvent.click(screen.getByText("Talebi gönder"));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByText("Talebi gönder"));
    await waitFor(() => expect(done).toHaveBeenCalledTimes(1));
    const [first, second] = create.mock.calls.map((c) => c[0] as { clientToken: string; konu: string; ekranGoruntusu: unknown });
    expect(first!.clientToken).toBe(second!.clientToken);
    expect(first!.konu).toBe("Tartı donuyor");
    expect(first!.ekranGoruntusu).toBeNull();
  });

  it("talep satırı: gönderim hatası yalnız GONDERILMEDI'de ve yalnız KOD olarak", () => {
    expect(ticketMeta(ticket({ status: "GONDERILMEDI", ticketNo: null, lastErrorCode: "EGRESS_NETWORK" }))).toContain("son deneme: EGRESS_NETWORK");
    expect(ticketMeta(ticket({ lastErrorCode: "EGRESS_NETWORK" }))).not.toContain("son deneme");
    expect(ticketMeta(ticket({ ticketNo: null }))).toContain("Numara bekleniyor");
  });
});
