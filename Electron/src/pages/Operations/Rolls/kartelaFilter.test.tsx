// Bitmiş Depo "Kartelalık" süzgeci: filter[markedForKartela]=true URL'e yazılır (liste + özet aynı URL'i okur);
// filtre çubuğuna satır eklemez; sekmeden çıkınca URL'den silinir (sekme başına filtre kaydı).
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { buildRollFilterDefs, KARTELA_MARKED_PARAM } from "./RollsTableBody";
import { rollPersistConfig } from "./RollsFilterRow";
import { switchTableUrl } from "@/components/data-table/filter-row/filter-persist";
import { UrlFlagToggle } from "./UrlFlagToggle";

function Where() {
  return <output data-testid="loc">{decodeURIComponent(useLocation().search)}</output>;
}

describe("Kartelalık süzgeci", () => {
  it("onay kutusu filter[markedForKartela]=true yazar, kaldırınca siler; öteki parametreler kalır", () => {
    expect(KARTELA_MARKED_PARAM).toBe("filter[markedForKartela]");
    render(
      <MemoryRouter initialEntries={["/r?filter[itemId]=a"]}>
        <UrlFlagToggle param={KARTELA_MARKED_PARAM} label="Kartelalık" />
        <Where />
      </MemoryRouter>,
    );
    const box = screen.getByRole("checkbox", { name: "Kartelalık" });
    fireEvent.click(box);
    expect(screen.getByTestId("loc").textContent).toBe("?filter[itemId]=a&filter[markedForKartela]=true");
    fireEvent.click(box);
    expect(screen.getByTestId("loc").textContent).toBe("?filter[itemId]=a");
  });

  it("filtre çubuğuna kontrol eklenmez (yeni satır yok)", () => {
    const keys = buildRollFilterDefs("FINISHED_STOCK").map((f) => (f.kind === "dateRange" ? "date" : f.key));
    expect(keys).not.toContain("markedForKartela");
  });

  it("⭐ sekmeden çıkarken Bitmiş Depo süzgeçleri silinir; yeni sekmenin kaydı gelir, arama kalır", () => {
    const sp = new URLSearchParams("filter[markedForKartela]=true&filter[shipmentScope]=free&filter[itemId]=a&search=x");
    const raw = { query: "filter%5BcolorId%5D=c1", savedAt: "2026-11-07T00:00:00Z" };
    const { next } = switchTableUrl(sp, rollPersistConfig("FINISHED_STOCK"), rollPersistConfig("RAW_STOCK"), raw);
    expect(next.toString()).toBe("search=x&filter%5BcolorId%5D=c1");
  });
});
