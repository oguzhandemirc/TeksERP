// Bitmiş Depo "Kartelalık" süzgeci: filter[markedForKartela]=true URL'e yazılır (liste + özet aynı URL'i okur);
// filtre çubuğuna satır eklemez; sekmeden çıkınca URL'den silinir.
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { buildRollFilterDefs, dropFinishedOnlyFilters, KARTELA_MARKED_PARAM } from "./RollsTableBody";
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

  it("sekmeden çıkarken Bitmiş Depo süzgeçleri silinir, ötekiler kalır", () => {
    const sp = new URLSearchParams("filter[markedForKartela]=true&filter[shipmentScope]=free&filter[itemId]=a");
    expect(dropFinishedOnlyFilters(sp)).toBe(true);
    expect(sp.toString()).toBe("filter%5BitemId%5D=a");
    expect(dropFinishedOnlyFilters(sp)).toBe(false);
  });
});
