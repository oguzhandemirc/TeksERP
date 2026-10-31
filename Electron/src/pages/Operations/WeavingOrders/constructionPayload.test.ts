// =============================================================================
// BEKÇİ — SY-A4 panel: yapı seçimi gövdesi (saf)
// =============================================================================
//   §1 dokuma iş emri: yapısız formda gövde SY-A4 öncesi anahtar kümesiyle aynı (yeni anahtar YOK)
//   §2 dolu alan id gider; düzenlemede temizlenen bağ null gider; bağsız kayıtta boş alan anahtarsız
//   §3 ürün formu: seçici görünmüyorsa anahtar yok; görünürse aynı kural
// =============================================================================
import { describe, expect, it } from "vitest";
import { buildPayload, constructionPayload } from "./useWeavingOrderMutations";
import { weavingOrderFormDefaults } from "./schema";
import { constructionPayload as itemConstructionPayload } from "@/pages/Items/ItemConstructionPickers";

const BEFORE_KEYS = ["itemId", "colorId", "warpSpecId", "plannedM", "executionKind", "subcontractorId", "plannedStartDate", "plannedEndDate", "notes", "orderLines"];

describe("SY-A4 — dokuma iş emri yapı seçimi gövdesi", () => {
  it("§1 yapısız form: anahtar kümesi bugünküyle aynı", () => {
    expect(Object.keys(buildPayload({ ...weavingOrderFormDefaults, itemId: "i1" }))).toEqual(BEFORE_KEYS);
    expect(Object.keys(buildPayload({ ...weavingOrderFormDefaults, itemId: "i1" }, { weftSpecId: null, weaveDesignId: null, recipeId: null }))).toEqual(BEFORE_KEYS);
  });
  it("§2 dolu id gider; temizlenen bağ null; bağsız kayıtta boş alan anahtarsız", () => {
    const v = { ...weavingOrderFormDefaults, itemId: "i1", weftSpecId: "w1", weaveDesignId: "", recipeId: "" };
    expect(constructionPayload(v, null)).toEqual({ weftSpecId: "w1" });
    expect(constructionPayload(v, { weftSpecId: "w0", weaveDesignId: "d0", recipeId: null })).toEqual({ weftSpecId: "w1", weaveDesignId: null });
  });
});

describe("SY-A4 — ürün formu atkı/desen gövdesi", () => {
  it("§3 seçici görünmüyorsa anahtar yok; görünürse dolu/temizlenen kural", () => {
    expect(itemConstructionPayload({ weftSpecId: "w1", weaveDesignId: "d1" }, null, false)).toEqual({});
    expect(itemConstructionPayload({ weftSpecId: "", weaveDesignId: "" }, null, true)).toEqual({});
    expect(itemConstructionPayload({ weftSpecId: "w1", weaveDesignId: "" }, { weftSpecId: null, weaveDesignId: "d0" }, true)).toEqual({ weftSpecId: "w1", weaveDesignId: null });
  });
});
