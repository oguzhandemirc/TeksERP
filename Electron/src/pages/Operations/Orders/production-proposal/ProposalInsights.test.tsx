// SY-3: öneri ayrıntısındaki iplik tablosu — iplik firesi notu (I2) ve ayrılan/serbest sütunları (I1) yalnız alan yanıttaysa.
import { describe, expect, it, vi } from "vitest";
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

  it("I1: Ayrılan/Serbest sütunları yalnız yanıtta reservedKg varken; serbest null → 'bilinmiyor', eksi → uyarı rengi", () => {
    const detail = openDetail(group([row({ reservedKg: 120, freeKg: -20.5 }), row({ yarnItemId: "y2", code: "IP-75D", reservedKg: 0, freeKg: null })]));
    const heads = Array.from(detail.querySelectorAll("th")).map((t) => t.textContent);
    expect(heads).toEqual(["İplik", "Gereken", "Ayrılan", "Serbest", "Eksik"]);
    expect(detail).toHaveTextContent("120 kg");
    expect(detail).toHaveTextContent("bilinmiyor");
    expect(screen.getByText(/-20,5 kg/).className).toContain("text-warning");
  });

  it("I1 kapalı (anahtar yok): sütunlar çizilmez — bugünkü tablo", () => {
    const detail = openDetail(group([row()]));
    expect(Array.from(detail.querySelectorAll("th")).map((t) => t.textContent)).toEqual(["İplik", "Gereken", "Eksik"]);
  });
});

describe("Üretim önerisi ön izlemesi — sunucu uyarısı yolu (SY-3 I1)", () => {
  it("preview isteği serverWarnings bayrağı taşımaz: ayırma uyarısı genel tost yolundan basılır", async () => {
    vi.resetModules();
    const post = vi.fn().mockResolvedValue({ data: { success: true, data: {}, warnings: ["IP-150D ipliğinin 120 kg'ı açık dokuma işlerine ayrılmış"] } });
    vi.doMock("@/services/apiClient", () => ({ default: { post } }));
    const { productionProposalService } = await import("./service");
    await productionProposalService.preview("o1");
    const [url, , config] = post.mock.calls[0] ?? [];
    expect(config?.serverWarnings).toBeUndefined();
    const { shouldToastWarnings } = await import("@/lib/serverNotes");
    expect(shouldToastWarnings({ method: "post", url, ...config }, { success: true, warnings: ["x"] })).toBe(true);
    vi.doUnmock("@/services/apiClient");
  });
});
