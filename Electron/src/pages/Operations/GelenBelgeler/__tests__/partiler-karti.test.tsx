// Çok blok D7 (2026-11-06): gelen belge detayında "Partiler" kartı — blok başına künye (işlem, müşteri İE no), satır/beyan
// adet, Σ m/kg, uyarılar, bağlı İE bağlantısı; tek partili belgede ve eski sunucu alanları yokken kart/alan gizlenir.
// Negatif sonda: PartiesCard `multi` kapısı kaldırılınca "tek partili belge → kart yok" vakası kırmızı.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import type { NotePartiesView } from "../partiesTypes";
import { fmtMeters } from "../partiMetre";

const getNoteParties = vi.fn();
vi.mock("../service", () => ({ INCOMING_DOCUMENT_QUERY_KEY: "gelen-belge", getNoteParties: (id: string) => getNoteParties(id) }));
const { PartiesCard, partyFacts, partyFactItems } = await import("../PartiesCard");

const party = (blockNo: number, x: Record<string, unknown> = {}) => ({
  blockNo, batchNo: `P26187${32 + blockNo}`, orderNo: "56967", declaredTopCount: 16, declaredMeters: null, lineCount: 15, meters: 3935, weightKg: null, warnings: [], ...x,
});
const view = (x: Partial<NotePartiesView> = {}): NotePartiesView => ({
  parties: [
    party(1, { processText: "KDK APRE", senderWorkOrderNo: "24749", weightKg: 512.5, workOrders: [{ id: "w1", workOrderNumber: "IE-0001", status: "PLANNED" }] }),
    party(2, { lineCount: 14, warnings: ["Başlıkta 16 TOP yazıyor, 14 satır okundu"] }),
  ],
  warnings: [], multi: true, defaultMode: "PER_PARTY", ...x,
});

beforeEach(() => getNoteParties.mockReset());

describe("Partiler kartı", () => {
  it("⭐ blok başına künye + bağlı İE bağlantısı + parti uyarısı", async () => {
    getNoteParties.mockResolvedValue(view());
    renderWithProviders(<PartiesCard noteId="n1" />);
    await waitFor(() => expect(screen.getByTestId("partiler-karti")).toBeInTheDocument());
    expect(screen.getByText("Bu belgede 2 parti var")).toBeInTheDocument();
    // Künye parçaları ayrı kutu (dar ekranda kelime ortasından kırılmaz); parti no başlıkta.
    const p1 = within(screen.getByTestId("parti-1"));
    expect(p1.getByText("P2618733")).toBeInTheDocument();
    expect(p1.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Sipariş 56967", "İşlem: KDK APRE", "Müşteri İE 24749", "15 satır / 16 TOP", fmtMeters(3935), "512,5 kg"]);
    expect(screen.getByTestId("parti-ie-1")).toHaveTextContent(/^(Terbiye )?İş Emri:IE-0001$/);
    expect(screen.getByRole("link", { name: "IE-0001" })).toHaveAttribute("href", "/operations/work-orders/w1");
    expect(screen.getByTestId("parti-2")).toHaveTextContent("Başlıkta 16 TOP yazıyor, 14 satır okundu");
    expect(screen.queryByTestId("parti-ie-2")).toBeNull();
  });

  it("⭐ tek partili belge → kart yok", async () => {
    getNoteParties.mockResolvedValue(view({ multi: false, parties: [party(1)] }));
    renderWithProviders(<PartiesCard noteId="n1" />);
    await waitFor(() => expect(getNoteParties).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId("partiler-karti")).toBeNull();
  });

  it("eski sunucu: işlem / müşteri İE no / İE alanı yoksa yazılmaz; kg varsa yazılır", () => {
    expect(partyFacts(party(2))).toEqual(["Parti P2618734", "Sipariş 56967", "15 satır / 16 TOP", fmtMeters(3935)]);
    expect(partyFacts(party(1, { weightKg: 512.5, batchNo: null })).at(-1)).toMatch(/kg$/);
  });

  it("eksik bilgi uyarı tonunda: metre yok kutusu warn, parti no yok başlıkta", async () => {
    expect(partyFactItems(party(1, { meters: 0 })).find((f) => f.text === "metre yok")).toEqual({ text: "metre yok", warn: true });
    expect(partyFactItems(party(1)).some((f) => f.warn)).toBe(false);
    getNoteParties.mockResolvedValue(view({ parties: [party(1, { batchNo: null }), party(2)] }));
    renderWithProviders(<PartiesCard noteId="n1" />);
    expect(await screen.findByText("Parti no yok")).toHaveClass("bg-amber-100");
  });
});
