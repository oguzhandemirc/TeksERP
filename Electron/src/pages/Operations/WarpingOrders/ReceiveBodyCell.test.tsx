// D3 kabul gövde seçicisi: "farklı gövde" işareti (seçilen ∉ bu siparişle gönderilenler; yerinde tanım dahil; hiç gövde
// gönderilmediyse yok) · seçenek metni (bu siparişle / başka siparişle / kaç gündür) · başka satırda seçilen önerilmez ·
// liste varken "Listeden seç" düğmesi çizilir, yokken yalnız okutma.
import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { ReceiveBodyCell } from "./ReceiveBodyCell";
import { availableOptions, isDifferentBody, optionHint, type ReceiveBodyOption, type ReceiveBodyOptions } from "./receive-body-options";

const opt = (p: Partial<ReceiveBodyOption>): ReceiveBodyOption => ({
  id: "b1", bodyNo: "LG-1", owner: { kind: "OURS", label: "Bizim", customer: null }, sentWith: null,
  statusSince: "2026-11-20T08:00:00.000Z", statusAgeDays: 8, sentWithOrder: false, ...p,
});
const choices: ReceiveBodyOptions = {
  subcontractorId: "s1",
  sent: [{ id: "b1", bodyNo: "LG-1", status: "AT_SUBCONTRACTOR", statusLabel: "Deverecide", atThisWarper: true, dispatchNo: "SD-1" }],
  options: [
    opt({ id: "b1", bodyNo: "LG-1", sentWithOrder: true, sentWith: { dispatchId: "d1", dispatchNo: "SD-1", warpingOrderId: "o1", orderNo: "DV-1", at: "2026-11-20T08:00:00.000Z" } }),
    opt({ id: "b9", bodyNo: "LG-9" }),
  ],
};

describe("receive-body-options model", () => {
  it("farklı gövde: gönderilen dışında seçilen ve yeni tanım işaretlenir; gönderilen işaretlenmez", () => {
    expect(isDifferentBody({ kind: "existing", id: "b9", bodyNo: "LG-9", hint: "" }, choices)).toBe(true);
    expect(isDifferentBody({ kind: "new", bodyNo: "X", ownerKind: "OURS", subcontractorId: "s1" }, choices)).toBe(true);
    expect(isDifferentBody({ kind: "existing", id: "b1", bodyNo: "LG-1", hint: "" }, choices)).toBe(false);
  });
  it("hiç gövde gönderilmediyse kıyas yok; seçim yoksa işaret yok", () => {
    expect(isDifferentBody({ kind: "existing", id: "b9", bodyNo: "LG-9", hint: "" }, { ...choices, sent: [] })).toBe(false);
    expect(isDifferentBody(null, choices)).toBe(false);
    expect(isDifferentBody({ kind: "existing", id: "b9", bodyNo: "LG-9", hint: "" }, undefined)).toBe(false);
  });
  it("seçenek metni: bu siparişle · başka siparişle · kaç gündür · bizim değilse sahip", () => {
    expect(optionHint(choices.options[0]!)).toBe("bu siparişle gönderildi");
    expect(optionHint(opt({ sentWith: { dispatchId: "d2", dispatchNo: "SD-2", warpingOrderId: "o2", orderNo: "DV-2", at: "" } }))).toBe("DV-2 ile gönderildi");
    expect(optionHint(opt({ statusAgeDays: 3, owner: { kind: "CUSTOMER", label: "Müşteri", customer: { id: "c", code: "C", name: "Acme" } } }))).toBe("3 gündür deverecide · Acme");
  });
  it("başka satırda seçilen gövde önerilmez, sıra korunur", () => {
    expect(availableOptions(choices, new Set(["b1"])).map((o) => o.id)).toEqual(["b9"]);
    expect(availableOptions(undefined, new Set())).toEqual([]);
  });
});

describe("ReceiveBodyCell", () => {
  const noop = () => undefined;
  it("gönderilenden farklı gövde seçiliyse rozet görünür ve gönderilenleri söyler", () => {
    renderWithProviders(<ReceiveBodyCell row={1} value={{ kind: "existing", id: "b9", bodyNo: "LG-9", hint: "8 gündür deverecide" }} subcontractorId="s1" onChange={noop} choices={choices} />);
    expect(screen.getByText("farklı gövde").getAttribute("title")).toContain("LG-1");
  });
  it("gönderilen gövde seçiliyse rozet yok", () => {
    renderWithProviders(<ReceiveBodyCell row={1} value={{ kind: "existing", id: "b1", bodyNo: "LG-1", hint: "" }} subcontractorId="s1" onChange={noop} choices={choices} />);
    expect(screen.queryByText("farklı gövde")).toBeNull();
  });
  it("seçenek varsa okutmanın yanında 'Listeden seç'; yoksa yalnız okutma (bugünkü)", () => {
    const { unmount } = renderWithProviders(<ReceiveBodyCell row={2} value={null} subcontractorId="s1" onChange={noop} choices={choices} available={choices.options} />);
    expect(screen.getByLabelText("2. levent gövde listeden seç")).toBeTruthy();
    expect(screen.getByLabelText("2. levent gövde okut")).toBeTruthy();
    unmount();
    renderWithProviders(<ReceiveBodyCell row={3} value={null} subcontractorId="s1" onChange={noop} />);
    expect(screen.queryByLabelText("3. levent gövde listeden seç")).toBeNull();
  });
});
