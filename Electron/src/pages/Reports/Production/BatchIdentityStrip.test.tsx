import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasAnyPermission: () => true }) }));

import { BatchIdentityStrip } from "./BatchIdentityStrip";

const batch = { batchId: "b1", batchNumber: "P07", workOrderNumber: "TIE-0042", createdAt: "2026-10-20T08:00:00Z", merged: false };

describe("Parti kartı — İz sür", () => {
  it("iz partinin terbiye iş emri numarasıyla sürülür (parti no benzersiz değil)", () => {
    render(<BatchIdentityStrip batch={batch} />);
    expect(screen.getByTestId("trace-link").getAttribute("title")).toContain("TIE-0042");
  });
  it("iş emri bağı yoksa bağlantı yok", () => {
    render(<BatchIdentityStrip batch={{ ...batch, workOrderNumber: null }} />);
    expect(screen.queryByTestId("trace-link")).toBeNull();
  });
});
