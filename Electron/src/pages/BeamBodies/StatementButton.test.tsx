// Devere S6: "Mutabakat bas" — önce sunucu sürümü hazırlar, sonra BEAM_BODY_STATEMENT diyaloğu (kaynak = devereci) açılır.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";

const perms = vi.hoisted(() => ({ list: [] as string[] }));
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({ hasPermission: (p: string) => perms.list.includes(p), hasAnyPermission: (ps: string[]) => ps.some((p) => perms.list.includes(p)), hasAllPermissions: () => true }),
}));
const seen = vi.hoisted(() => ({ props: null as Record<string, unknown> | null, printed: [] as string[] }));
vi.mock("@/components/print/PrintedDocDialog", () => ({
  PrintedDocDialog: (p: Record<string, unknown>) => {
    seen.props = p;
    return <div data-testid="doc-dialog" />;
  },
}));
vi.mock("./service", () => ({
  beamBodyService: { printStatement: async (id: string) => { seen.printed.push(id); return { version: 1, documentNo: "DEV", created: true }; } },
}));
import { StatementButton, singleSubcontractorId } from "./StatementButton";

describe("StatementButton", () => {
  it("tıklayınca önce sürüm hazırlanır, sonra devereci kaynaklı diyalog açılır", async () => {
    perms.list = ["beam-body:read"];
    renderWithProviders(<StatementButton subcontractorId="s1" />);
    fireEvent.click(screen.getByRole("button", { name: /Mutabakat bas/ }));
    await waitFor(() => expect(screen.getByTestId("doc-dialog")).toBeInTheDocument());
    expect(seen.printed).toEqual(["s1"]);
    expect(seen.props).toMatchObject({ docType: "BEAM_BODY_STATEMENT", sourceId: "s1", writePermission: "beam-body:write" });
  });
  it("beam-body:read yoksa çizilmez", () => {
    perms.list = ["warpbeam:read"];
    renderWithProviders(<StatementButton subcontractorId="s1" />);
    expect(screen.queryByRole("button", { name: /Mutabakat bas/ })).toBeNull();
  });
  it("yalnız TEK devereci filtresinde görünür", () => {
    expect(singleSubcontractorId("a")).toBe("a");
    expect(singleSubcontractorId("a,b")).toBeNull();
    expect(singleSubcontractorId(["a", "b"])).toBeNull();
    expect(singleSubcontractorId(["a"])).toBe("a");
    expect(singleSubcontractorId(undefined)).toBeNull();
  });
});
