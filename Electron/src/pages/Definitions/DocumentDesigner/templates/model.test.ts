import { AxiosError, AxiosHeaders } from "axios";
import { describe, expect, it } from "vitest";
import type { DocumentTemplateRow, TemplateAssignments } from "@/services/documentTemplateService";
import {
  PUBLISH_PERMISSION_REASON,
  READ_ONLY_REASON,
  SOD_REASON,
  designerAccess,
  publishBlockReason,
  readTemplateError,
  templateBadges,
  templateErrorText,
  unsafeContentLines,
} from "./model";

const row = (over: Partial<DocumentTemplateRow> = {}): DocumentTemplateRow => ({
  id: "t1",
  docType: "SHIPMENT_DISPATCH",
  name: "A",
  status: "ACTIVE",
  editMode: "VISUAL",
  publishedVersionId: null,
  latestVersionNo: 1,
  publishedVersion: null,
  ...over,
});

const brief = { id: "t1", name: "A", docType: "SHIPMENT_DISPATCH", status: "ACTIVE" as const, publishedVersionId: "v" };
const assigns: TemplateAssignments = {
  defaults: [{ docType: "SHIPMENT_DISPATCH", template: brief }],
  profiles: [
    { docType: "SHIPMENT_DISPATCH", template: brief, profile: { id: "p1", name: "P1", isActive: true }, affected: { customers: [], subcontractors: [] } },
    { docType: "SHIPMENT_DISPATCH", template: brief, profile: { id: "p2", name: "P2", isActive: true }, affected: { customers: [], subcontractors: [] } },
  ],
};

const httpError = (status: number, details: Record<string, unknown>, message = "sunucu") =>
  new AxiosError("x", "ERR", undefined, undefined, {
    status,
    statusText: "",
    headers: {},
    config: { headers: new AxiosHeaders() },
    data: { success: false, message, details },
  });

describe("rozetler", () => {
  it("yeni şablon: yalnız Taslak v1", () => {
    expect(templateBadges(row(), undefined).map((b) => b.label)).toEqual(["Taslak v1"]);
  });
  it("yayında = son sürüm → taslak rozeti yok; varsayılan + profil sayısı", () => {
    const t = row({ publishedVersionId: "v", latestVersionNo: 3, publishedVersion: { versionNo: 3, publishedAt: null } });
    expect(templateBadges(t, assigns).map((b) => b.label)).toEqual(["Varsayılan", "Yayında v3", "2 profile atalı"]);
  });
  it("yayındakinden yeni taslak + kod kipi + arşiv", () => {
    const t = row({ status: "ARCHIVED", editMode: "CODE", latestVersionNo: 5, publishedVersion: { versionNo: 2, publishedAt: null } });
    expect(templateBadges(t, undefined).map((b) => b.key)).toEqual(["published", "draft", "archived", "code"]);
    expect(templateBadges(t, undefined)[1]?.label).toBe("Taslak v5");
  });
  it("başka türün varsayılanı rozet vermez", () => {
    const other = { ...assigns, defaults: [{ docType: "INVOICE", template: brief }], profiles: [] };
    expect(templateBadges(row(), other).some((b) => b.key === "default")).toBe(false);
  });
});

describe("izin yüzeyi", () => {
  it("yalnız :read → salt-okunur gerekçe; denetim gizlenmez, pasif", () => {
    expect(designerAccess(false, false)).toEqual({ canDesign: false, canPublish: false, designBlock: READ_ONLY_REASON });
    expect(designerAccess(true, false).designBlock).toBeNull();
  });
  it("yayın: izin yoksa izin gerekçesi önce gelir", () => {
    expect(publishBlockReason({ canPublish: false, archived: false, sodEnabled: true, me: "u", versionAuthor: "u" })).toBe(PUBLISH_PERMISSION_REASON);
  });
});

describe("SoD pasifliği", () => {
  const base = { canPublish: true, archived: false, me: "u1" };
  it("açık + yazar kendisi → pasif + gerekçe", () => {
    expect(publishBlockReason({ ...base, sodEnabled: true, versionAuthor: "u1" })).toBe(SOD_REASON);
  });
  it("açık + başka yazar → serbest", () => {
    expect(publishBlockReason({ ...base, sodEnabled: true, versionAuthor: "u2" })).toBeNull();
  });
  it("kapalı + yazar kendisi → serbest (bugünkü davranış)", () => {
    expect(publishBlockReason({ ...base, sodEnabled: false, versionAuthor: "u1" })).toBeNull();
  });
  it("kaydedilmemiş değişiklik → önce kaydet", () => {
    expect(publishBlockReason({ ...base, sodEnabled: false, versionAuthor: "u2", dirty: true })).toMatch(/kaydedin/);
  });
});

describe("sunucu hatası", () => {
  it("409 yayın çakışması → başkası yayınladı, yenileyin", () => {
    const e = readTemplateError(httpError(409, { code: "TEMPLATE_PUBLISH_CONFLICT" }));
    expect(e.code).toBe("TEMPLATE_PUBLISH_CONFLICT");
    expect(templateErrorText(e, "x")).toMatch(/Başkası .* yayınladı.*yenileyip/);
  });
  it("TEMPLATE_UNSAFE_CONTENT kesilen içerik listesi", () => {
    const e = readTemplateError(httpError(400, { code: "TEMPLATE_UNSAFE_CONTENT", kesilenler: { tek_kalem: ["script", "img[src=http]"] } }));
    expect(unsafeContentLines(e.details)).toEqual(["tek_kalem: script", "tek_kalem: img[src=http]"]);
  });
  it("tanınmayan kod → sunucu cümlesi; body.code okunmaz", () => {
    const e = readTemplateError(httpError(400, { code: "BILINMEYEN" }, "Sunucunun cümlesi"));
    expect(templateErrorText(e, "yedek")).toBe("Sunucunun cümlesi");
  });
});
