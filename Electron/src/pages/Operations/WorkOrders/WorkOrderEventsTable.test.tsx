import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { WorkOrderEventsTable } from "./WorkOrderEventsTable";
import { EVENT_COLUMNS, type TimelineItem } from "./events";

const row: TimelineItem = {
  id: "woe:1", at: "2026-09-25T10:00:00.000Z", group: "DURUM", title: "Durum değişti",
  detail: "Devam Ediyor → Tamamlandı", reason: "kalan dağıtıldı", actor: "Ayşe", channel: "Tablet",
  trigger: "Elle kapatma", derived: true,
};

describe("WorkOrderEventsTable — ekrandaki sütunlar = Excel sütunları", () => {
  it("başlıklar EVENT_COLUMNS sırasıyla birebir", () => {
    renderWithProviders(<WorkOrderEventsTable rows={[row]} />);
    const headers = within(screen.getByTestId("is-emri-hareketleri")).getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(EVENT_COLUMNS.map((c) => c.label));
  });

  it("hücre metni Excel'e giden değerle aynı (sebep, kanal, türetilmiş işaret dahil)", () => {
    renderWithProviders(<WorkOrderEventsTable rows={[row]} />);
    const cells = within(screen.getByTestId("is-emri-hareketleri")).getAllByRole("cell").map((c) => c.textContent);
    expect(cells).toEqual(EVENT_COLUMNS.map((c) => String(c.value(row))));
    expect(cells[1]).toContain("sonradan türetildi");
    expect(cells[2]).toContain("Sebep: kalan dağıtıldı");
    expect(cells[3]).toContain("Tablet · Elle kapatma");
  });
});
