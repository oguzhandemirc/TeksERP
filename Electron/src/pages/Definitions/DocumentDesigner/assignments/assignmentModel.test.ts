import { describe, expect, it } from "vitest";
import type { DocumentTemplateRow, ProfileCatalogRow, TemplateAssignments } from "@/services/documentTemplateService";
import { assignableTemplates, defaultOf, hasConfigOverride, isNoop, profileTemplateOf, profilesShieldedFromDefault } from "./assignmentModel";

const t = (id: string, over: Partial<DocumentTemplateRow> = {}): DocumentTemplateRow => ({
  id, docType: "SHIPMENT_DISPATCH", name: id, status: "ACTIVE", publishedVersionId: "v", publishedVersion: { versionNo: 1, publishedAt: null }, ...over,
});
const brief = (id: string) => ({ id, name: id, docType: "SHIPMENT_DISPATCH", status: "ACTIVE" as const, publishedVersionId: "v" });
const prof = (id: string, overrideKeys: string[] = []): ProfileCatalogRow => ({ id, name: id, isActive: true, overrideKeys, affected: { customers: [{ id: `${id}-c`, name: "C" }], subcontractors: [] } });
const a: TemplateAssignments = {
  defaults: [{ docType: "SHIPMENT_DISPATCH", template: brief("t1") }],
  profiles: [{ docType: "SHIPMENT_DISPATCH", template: brief("t2"), profile: { id: "p1", name: "p1", isActive: true }, affected: { customers: [], subcontractors: [] } }],
};

describe("atanabilirlik", () => {
  it("yalnız aynı tür + ACTIVE + yayında", () => {
    const rows = [t("ok"), t("taslak", { publishedVersionId: null }), t("arsiv", { status: "ARCHIVED" }), t("baska", { docType: "INVOICE" })];
    expect(assignableTemplates(rows, "SHIPMENT_DISPATCH").map((r) => r.id)).toEqual(["ok"]);
  });
});

describe("atama okuma", () => {
  it("varsayılan ve profil ataması", () => {
    expect(defaultOf(a, "SHIPMENT_DISPATCH")?.id).toBe("t1");
    expect(defaultOf(a, "INVOICE")).toBeNull();
    expect(profileTemplateOf(a, "p1", "SHIPMENT_DISPATCH")?.id).toBe("t2");
    expect(profileTemplateOf(a, "p2", "SHIPMENT_DISPATCH")).toBeNull();
  });
  it("varsayılan değişiminden korunan profiller = kendi ataması olanlar", () => {
    expect(profilesShieldedFromDefault([prof("p1"), prof("p2")], a, "SHIPMENT_DISPATCH").map((p) => p.id)).toEqual(["p1"]);
  });
  it("aynı şablona yeniden atama no-op", () => {
    expect(isNoop({ id: "t1" }, "t1")).toBe(true);
    expect(isNoop(null, null)).toBe(true);
    expect(isNoop({ id: "t1" }, null)).toBe(false);
  });
});

describe("profil ezmesi uyarısı (R4)", () => {
  it("profilin bu türün belge anahtarında ezmesi varsa uyarır", () => {
    expect(hasConfigOverride(prof("p", ["shipmentDispatch"]), "SHIPMENT_DISPATCH")).toBe(true);
    expect(hasConfigOverride(prof("p", ["invoice"]), "SHIPMENT_DISPATCH")).toBe(false);
    expect(hasConfigOverride(prof("p", ["shipmentDispatch"]), "BILINMEYEN")).toBe(false);
  });
});
