// BEKÇİ — şube formu → istek gövdesi (S3, 2026-09-23): gövdeyi elle kuran katman sessiz bir
// allowlist'tir; `defaultDestination` gövdeye girer, "seçilmedi" null olarak gider (temizler).
import { describe, expect, it } from "vitest";
import { branchFormDefaults, branchFormSchema, branchFormToPayload } from "./branch-schema";

describe("branchFormToPayload", () => {
  it("⭐ sevk yönü gövdeye girer", () => {
    expect(branchFormToPayload({ ...branchFormDefaults, name: "Merkez", defaultDestination: "EXPORT" }).defaultDestination).toBe("EXPORT");
  });
  it("seçilmedi → null (şubenin yönü temizlenir, cariye düşülür)", () => {
    const body = branchFormToPayload({ ...branchFormDefaults, name: "Merkez" });
    expect("defaultDestination" in body).toBe(true);
    expect(body.defaultDestination).toBeNull();
  });
  it("şema enum dışını reddeder", () => {
    expect(branchFormSchema.safeParse({ ...branchFormDefaults, name: "Merkez", defaultDestination: "OVERSEAS" }).success).toBe(false);
  });
});
