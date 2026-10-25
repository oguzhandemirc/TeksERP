// Top/parti detay kartı: modül kapalıyken ya da izin yokken DOM'a hiçbir şey eklemez ve istek atmaz.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";

let flagOn = false;
let perms: string[] = [];
const list = vi.fn();
vi.mock("@/pages/Operations/useOperationsVisibility", () => ({ useOperationsVisibilityContext: () => ({ kaliteGuvenceEnabled: flagOn }) }));
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: (p: string) => perms.includes(p) }) }));
vi.mock("./service", () => ({ labTestService: { list: (...a: unknown[]) => list(...a) }, labTestTypeService: { list: vi.fn(async () => []) } }));

import { LabTestsCard } from "./LabTestsCard";

const page = { items: [{ id: "t1", testNo: "LAB000007", testedOn: "2026-10-20", status: "APPROVED", sampleCode: null, labName: null, createdAt: "", roll: null, batch: { id: "b1", batchNumber: "P1" }, item: null, resultCount: 2, hasFail: true }], nextCursor: null, summary: { total: 1, draft: 0, approved: 1, voided: 0, failing: 1 } };

describe("LabTestsCard", () => {
  beforeEach(() => { list.mockReset(); list.mockResolvedValue(page); });
  it("bayrak kapalı → DOM değişmez, istek yok", () => {
    flagOn = false; perms = ["labtest:read"];
    const r = renderWithProviders(<LabTestsCard rollId="r1" />);
    expect(r.container.innerHTML).toBe("");
    expect(list).not.toHaveBeenCalled();
  });
  it("izinsiz kullanıcı → görünmez, istek yok", () => {
    flagOn = true; perms = [];
    const r = renderWithProviders(<LabTestsCard rollId="r1" />);
    expect(r.container.innerHTML).toBe("");
    expect(list).not.toHaveBeenCalled();
  });
  it("açık + izinli → top kartı forRollId ile parti testini de listeler", async () => {
    flagOn = true; perms = ["labtest:read"];
    renderWithProviders(<LabTestsCard rollId="r1" />);
    await waitFor(() => expect(screen.getByText("LAB000007")).toBeTruthy());
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ forRollId: "r1" }));
    expect(screen.getByText(/parti testi/)).toBeTruthy();
    expect(screen.getByText("Kalan var")).toBeTruthy();
  });
  it("parti kartında yazma izni yoksa 'Parti testi aç' yok", async () => {
    flagOn = true; perms = ["labtest:read"];
    renderWithProviders(<LabTestsCard batchId="b1" batchLabel="P1" />);
    await waitFor(() => expect(list).toHaveBeenCalledWith(expect.objectContaining({ batchId: "b1" })));
    expect(screen.queryByText("Parti testi aç")).toBeNull();
  });
});
