// Etiket seti editörünün saf mantığı: ekle · sırala · kaldır · yıldız · ikisine birlikte ekle ·
// 404'te gizlenme. NEGATİF SONDA (koşuldu, 2026-11-11): `toPutBody` yıldızı yazmayınca 6 test,
// `addTargets` `both`u yok sayınca 1, `optionSetStatus` 404 dalı silinince 3 test KIRMIZI.
import { describe, it, expect } from "vitest";
import { AxiosError, AxiosHeaders } from "axios";
import { isEndpointMissing, type LabelOptionItem } from "@/services/labelTemplateOptionService";
import {
  MAX_SET_SIZE,
  addEntry,
  addTargets,
  draftFromResponse,
  moveEntry,
  optionSetStatus,
  previewNames,
  removalNeedsConfirm,
  removeEntry,
  toPutBody,
  toggleStar,
  type OptionSetDraft,
} from "./labelOptionSet";
import { filterPickerRows } from "./templatePickerService";

const item = (templateId: string, over: Partial<LabelOptionItem> = {}): LabelOptionItem => ({
  templateId, name: templateId.toUpperCase(), sortOrder: 0, isDefault: false, active: true, ...over,
});
const e = (id: string) => ({ templateId: id, name: id.toUpperCase(), active: true });
const draft = (ids: string[], def: string | null = null): OptionSetDraft => ({ entries: ids.map(e), defaultTemplateId: def });
const ids = (d: OptionSetDraft) => d.entries.map((x) => x.templateId);

function httpError(status: number) {
  const err = new AxiosError("x");
  err.response = { status, data: {}, statusText: "", headers: {}, config: { headers: new AxiosHeaders() } };
  return err;
}

describe("draftFromResponse", () => {
  it("sunucunun başa koyduğu varsayılan yıldızlı, sıra korunur, tekrar düşer", () => {
    const d = draftFromResponse({ defaultTemplateId: "tr", items: [item("tr", { isDefault: true }), item("en"), item("it"), item("en")] });
    expect(ids(d)).toEqual(["tr", "en", "it"]);
    expect(d.defaultTemplateId).toBe("tr");
  });
  it("listede olmayan varsayılan yıldız sayılmaz", () => {
    expect(draftFromResponse({ defaultTemplateId: "x", items: [item("a")] }).defaultTemplateId).toBeNull();
  });
});

describe("ekle", () => {
  it("sona ekler; olan şablon no-op (aynı nesne)", () => {
    const d = draft(["a"]);
    expect(ids(addEntry(d, e("b")))).toEqual(["a", "b"]);
    expect(addEntry(d, e("a"))).toBe(d);
  });
  it(`en çok ${MAX_SET_SIZE} şablon`, () => {
    const full = draft(Array.from({ length: MAX_SET_SIZE }, (_, i) => `t${i}`));
    expect(addEntry(full, e("yeni"))).toBe(full);
  });
});

describe("ikisine birlikte ekle (K1)", () => {
  const drafts = { ROLL_RAW: draft(["a"]), ROLL_FINISHED: draft([]) };
  it("kutu kapalı → yalnız tıklanan set", () => {
    const c = addTargets(drafts, "ROLL_FINISHED", false, e("b"));
    expect(c.map((x) => x.kind)).toEqual(["ROLL_FINISHED"]);
  });
  it("kutu açık → iki set, tıklanan önce", () => {
    const c = addTargets(drafts, "ROLL_FINISHED", true, e("b"));
    expect(c.map((x) => [x.kind, ids(x.draft)])).toEqual([
      ["ROLL_FINISHED", ["b"]],
      ["ROLL_RAW", ["a", "b"]],
    ]);
  });
  it("şablon bir sette zaten varsa o set PUT'a girmez", () => {
    const c = addTargets(drafts, "ROLL_FINISHED", true, e("a"));
    expect(c.map((x) => x.kind)).toEqual(["ROLL_FINISHED"]);
  });
});

describe("sırala / kaldır / yıldız", () => {
  it("↑/↓ komşuyla yer değiştirir, uçta no-op", () => {
    const d = draft(["a", "b", "c"]);
    expect(ids(moveEntry(d, "c", -1))).toEqual(["a", "c", "b"]);
    expect(ids(moveEntry(d, "a", 1))).toEqual(["b", "a", "c"]);
    expect(moveEntry(d, "a", -1)).toBe(d);
    expect(moveEntry(d, "c", 1)).toBe(d);
  });
  it("varsayılanı kaldırmak onay ister ve yıldızı boşaltır; başkası kendiliğinden yıldız almaz", () => {
    const d = draft(["a", "b"], "a");
    expect(removalNeedsConfirm(d, "a")).toBe(true);
    expect(removalNeedsConfirm(d, "b")).toBe(false);
    expect(removeEntry(d, "a")).toEqual(draft(["b"], null));
    expect(removeEntry(d, "b")).toEqual(draft(["a"], "a"));
  });
  it("yıldız taşınır; yıldızlıya yeniden dokunmak kaldırır; set dışı id no-op", () => {
    const d = draft(["a", "b"], "a");
    expect(toggleStar(d, "b").defaultTemplateId).toBe("b");
    expect(toggleStar(d, "a").defaultTemplateId).toBeNull();
    expect(toggleStar(d, "z")).toBe(d);
  });
});

describe("PUT gövdesi", () => {
  it("sıralı templateIds + yıldız gövdeye yazılır", () => {
    const d = moveEntry(toggleStar(draft(["tr", "en", "it"]), "en"), "it", -1);
    expect(toPutBody("ROLL_RAW", d)).toEqual({ kind: "ROLL_RAW", templateIds: ["tr", "it", "en"], defaultTemplateId: "en" });
  });
  it("showGlobalTemplates yalnız verildiyse girer", () => {
    expect(toPutBody("ROLL_RAW", draft([]))).not.toHaveProperty("showGlobalTemplates");
    expect(toPutBody("ROLL_RAW", draft([]), false)).toMatchObject({ showGlobalTemplates: false });
  });
});

describe("404'te gizlenme", () => {
  it("404 = eski backend → missing; diğer hata → error; yükleniyor → loading", () => {
    expect(isEndpointMissing(httpError(404))).toBe(true);
    expect(isEndpointMissing(httpError(500))).toBe(false);
    expect(isEndpointMissing(new Error("x"))).toBe(false);
    const st = (rs: Array<{ isLoading: boolean; error: unknown }>) => optionSetStatus(rs, isEndpointMissing);
    expect(st([{ isLoading: false, error: null }, { isLoading: false, error: httpError(404) }])).toBe("missing");
    expect(st([{ isLoading: false, error: httpError(500) }, { isLoading: true, error: null }])).toBe("error");
    expect(st([{ isLoading: true, error: null }, { isLoading: false, error: null }])).toBe("loading");
    expect(st([{ isLoading: false, error: null }, { isLoading: false, error: null }])).toBe("ready");
  });
});

describe("yardımcılar", () => {
  it("seçici: pasif ve setteki şablon görünmez, arama Türkçe küçük harf", () => {
    const rows = [
      { id: "1", name: "İngilizce", isActive: true },
      { id: "2", name: "Türkçe", isActive: true },
      { id: "3", name: "Pasif", isActive: false },
    ] as never[];
    expect(filterPickerRows(rows, { exclude: "2" }).map((r: { id: string }) => r.id)).toEqual(["1"]);
    expect(filterPickerRows(rows, { search: "ingi" }).map((r: { id: string }) => r.id)).toEqual(["1"]);
  });
  it("global önizleme pasifi göstermez", () => {
    expect(previewNames([item("a", { isDefault: true }), item("b", { active: false })])).toEqual([{ name: "A", isDefault: true }]);
  });
});
