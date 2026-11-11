// SY-3: öneri ayrıntısındaki iplik tablosu — iplik firesi notu (I2) ve ayrılan/serbest sütunları (I1) yalnız alan yanıttaysa.
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ProposalInsights } from "./ProposalInsights";
import type { WeavingProposal, YarnSummaryRow } from "./types";

const group = (yarns: YarnSummaryRow[]): WeavingProposal => ({
  key: "W|i1|-", itemId: "i1", itemName: "Tül A", recipeId: null, warpSpecId: null, weftSpecId: null, weaveDesignId: null, shrinkPct: null, plannedM: 1000,
  orderLines: [{ orderLineId: "l1", openM: 1000, allocatedM: 1000 }],
  yarnSummary: { rawM: 1000, yarns, totalShortKg: 0, sources: { stock: true, openPurchase: true, readyBeams: true } },
});
const row = (over: Partial<YarnSummaryRow> = {}): YarnSummaryRow => ({ yarnItemId: "y1", code: "IP-150D", name: "Polyester", needKg: 80, shortKg: 0, ...over });

const openDetail = (w: WeavingProposal) => {
  render(<ProposalInsights w={w} />);
  fireEvent.click(screen.getByRole("button", { name: "ayrıntı" }));
  return screen.getByTestId("proposal-insights-detail");
};

describe("ProposalInsights — SY-3", () => {
  it("I2: iplik kartı firesiyle hesaplanan satırda '(iplik firesi)' notu; KART ya da eski backend'de yok", () => {
    const detail = openDetail(group([row({ wasteSource: "IPLIK" }), row({ yarnItemId: "y2", code: "IP-75D", wasteSource: "KART" }), row({ yarnItemId: "y3", code: "IP-X" })]));
    expect(detail.textContent?.match(/\(iplik firesi\)/g)).toHaveLength(1);
  });
});
