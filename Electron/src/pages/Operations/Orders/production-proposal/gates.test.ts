import { describe, expect, it } from "vitest";
import { loomSuggestionVisible, opensProposalOnApprove, proposalButtonVisible, proposalModeOf } from "./gates";

const on = { orderProductionProposal: "ONIZLEME", productionEnabled: true, dokumaEnabled: true } as const;

describe("SY-M3 kapıları — KAPALI'da bugünkü ekran", () => {
  it("varsayılan/yüklenmemiş/bilinmeyen kip KAPALI", () => {
    expect(proposalModeOf(undefined)).toBe("KAPALI");
    expect(proposalModeOf({ orderProductionProposal: "KAPALI" })).toBe("KAPALI");
    expect(proposalModeOf({ orderProductionProposal: "BILINMEYEN" as never })).toBe("KAPALI");
  });

  it("KAPALI'da düğme ve tezgâh önerisi YOK (izin + modül tam olsa bile)", () => {
    const off = { ...on, orderProductionProposal: "KAPALI" } as const;
    expect(proposalButtonVisible(off, true)).toBe(false);
    expect(loomSuggestionVisible(off, true)).toBe(false);
    expect(proposalButtonVisible(undefined, true)).toBe(false);
    expect(loomSuggestionVisible(undefined, true)).toBe(false);
  });

  it("ONIZLEME'de düğme yazma izniyle, öneri dokuma + okuma izniyle", () => {
    expect(proposalButtonVisible(on, true)).toBe(true);
    expect(proposalButtonVisible(on, false)).toBe(false);
    expect(proposalButtonVisible({ ...on, productionEnabled: false }, true)).toBe(false);
    expect(loomSuggestionVisible(on, true)).toBe(true);
    expect(loomSuggestionVisible(on, false)).toBe(false);
    expect(loomSuggestionVisible({ ...on, dokumaEnabled: false }, true)).toBe(false);
  });

  it("onayda önizleme yalnız ONAYDA_TASLAK + onaylı yeni siparişte açılır", () => {
    const order = { id: "o1", status: "APPROVED" };
    expect(opensProposalOnApprove("ONAYDA_TASLAK", true, order)).toBe(true);
    expect(opensProposalOnApprove("ONIZLEME", true, order)).toBe(false);
    expect(opensProposalOnApprove("KAPALI", true, order)).toBe(false);
    expect(opensProposalOnApprove("ONAYDA_TASLAK", false, order)).toBe(false);
    expect(opensProposalOnApprove("ONAYDA_TASLAK", true, { id: "o1", status: "PENDING" })).toBe(false);
  });
});
