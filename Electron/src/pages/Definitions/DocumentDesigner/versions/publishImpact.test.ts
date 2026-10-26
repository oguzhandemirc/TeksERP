import { describe, expect, it } from "vitest";
import { createAttemptToken } from "@/lib/attemptToken";
import type { TemplateAssignments, TemplatePreviewResult } from "@/services/documentTemplateService";
import { publishImpact, scenarioRow, summarize } from "./publishImpact";
import { restoreExplanation } from "./RestoreDialog";

const brief = (id: string) => ({ id, name: id, docType: "SHIPMENT_DISPATCH", status: "ACTIVE" as const, publishedVersionId: "v" });
const a: TemplateAssignments = {
  defaults: [{ docType: "SHIPMENT_DISPATCH", template: brief("t1") }],
  profiles: [
    { docType: "SHIPMENT_DISPATCH", template: brief("t1"), profile: { id: "p1", name: "Müşteri A profili", isActive: true }, affected: { customers: [{ id: "c1", name: "A" }, { id: "c2", name: "B" }], subcontractors: [] } },
    { docType: "INVOICE", template: brief("t1"), profile: { id: "p1", name: "Müşteri A profili", isActive: true }, affected: { customers: [{ id: "c1", name: "A" }, { id: "c2", name: "B" }], subcontractors: [] } },
    { docType: "SHIPMENT_DISPATCH", template: brief("t2"), profile: { id: "p2", name: "Fason", isActive: true }, affected: { customers: [], subcontractors: [{ id: "s1", name: "F" }] } },
  ],
};
const res = (over: Partial<TemplatePreviewResult> = {}): TemplatePreviewResult => ({ html: "<p>x</p>", hatalar: [], uyarilar: [], kesilenler: [], olcum: { ms: 1, bayt: 1 }, ...over });

describe("yayın etkisi", () => {
  it("yalnız bu şablonun profilleri; profil ve müşteri tekilleşir", () => {
    const i = publishImpact("t1", a);
    expect(i).toMatchObject({ isDefault: true, customerCount: 2, subcontractorCount: 0 });
    expect(i.profiles.map((p) => p.name)).toEqual(["Müşteri A profili"]);
  });
  it("atanmamış şablon → etkisiz", () => {
    expect(publishImpact("t9", a)).toMatchObject({ isDefault: false, profiles: [], customerCount: 0 });
  });
});

describe("senaryo özeti", () => {
  it("hata > kesinti > uyarı > başarılı", () => {
    const rows = [
      scenarioRow("a", res()),
      scenarioRow("b", res({ uyarilar: ["u"] })),
      scenarioRow("c", res({ kesilenler: ["script"] })),
      scenarioRow("d", res({ hatalar: [{ satir: 1, sutun: 2, mesaj: "Tanımsız alan" }] })),
      scenarioRow("e", null, "zaman aşımı"),
    ];
    expect(rows.map((r) => r.outcome)).toEqual(["ok", "warning", "warning", "failed", "failed"]);
    expect(summarize(rows)).toEqual({ ok: 1, warning: 2, failed: 2 });
  });
});

describe("geri alma = yeni sürüm", () => {
  it("açıklama ileri kaydın silinmediğini ve yayının değişmediğini söyler", () => {
    const v = (n: number) => ({ id: `v${n}`, versionNo: n }) as never;
    const text = restoreExplanation({ template: {} as never, version: v(2), latest: v(5) });
    expect(text).toContain("yeni bir sürüm (v6)");
    expect(text).toContain("silinmez");
    expect(text).toContain("yayındaki sürüm değişmez");
  });
});

describe("token yapışma kuralı (kopya / kayıt / geri alma)", () => {
  const ids = () => {
    let n = 0;
    return () => `tok-${++n}`;
  };
  it("belirsiz hata (ağ / 5xx) → aynı token; kesin 4xx → yeni token", () => {
    const t = createAttemptToken(ids());
    const first = t.token();
    t.onFailure(new Error("Network Error"));
    expect(t.token()).toBe(first);
    t.onFailure({ response: { status: 502 } });
    expect(t.token()).toBe(first);
    t.onFailure({ response: { status: 409 } });
    expect(t.token()).not.toBe(first);
  });
  it("başarı → sonraki gönderim yeni deneme", () => {
    const t = createAttemptToken(ids());
    const first = t.token();
    t.onSuccess();
    expect(t.token()).not.toBe(first);
  });
});
