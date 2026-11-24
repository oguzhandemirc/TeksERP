// Ürün penceresi atkı kaydı (B19): plan kararı + paylaşılan kart sorusu + çağrı sırası. Ağ yok — API sahte.
import { describe, expect, it, vi } from "vitest";
import { EMPTY_WEFT, buildWeftBody, type WeftContent } from "@/pages/WeaveDesigns/tabs/WeftContentFields";
import { needsShareQuestion, planWeftSave, toForkPlan, type WeftSavePlan } from "./useItemWeftDraft";
import { applyWeftPlan, type WeftSaveApi } from "./item-save";

const READY: WeftContent = { seq: "A2 B1", picksPerCm: "18", program: "77", rows: [{ yarnItemId: "y1", picks: "" }, { yarnItemId: "y2", picks: "" }] };
const build = (c: WeftContent) => buildWeftBody(c.seq, c.picksPerCm, c.program, c.rows);
const draft = (p: Partial<Parameters<typeof planWeftSave>[0]>) => ({ mode: "none" as const, cardId: null, savedCardId: null, content: EMPTY_WEFT, touched: false, ...p });

function fakeApi(): WeftSaveApi & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    attach: vi.fn(async () => { calls.push("attach"); return { weftSpec: { id: "w-new" }, itemId: "i1", replayed: false } as never; }),
    patch: vi.fn(async (id: string) => { calls.push(`patch:${id}`); return {} as never; }),
    fork: vi.fn(async () => { calls.push("fork"); return { weftSpec: { id: "w-fork" }, itemId: "i1", previousWeftSpecId: "w1", replayed: false } as never; }),
  };
}

describe("planWeftSave", () => {
  it("yeni üründe dolu taslak gövdeye gömülür; boş taslak gitmez", () => {
    expect(planWeftSave(draft({ mode: "new", content: READY, touched: true }), false, build).kind).toBe("create-with-item");
    expect(planWeftSave(draft({ mode: "new", content: { ...EMPTY_WEFT, rows: [{ yarnItemId: "", picks: "" }] }, touched: true }), false, build)).toEqual({ kind: "link", weftSpecId: null });
  });
  it("eksik taslak kaydı durdurur; düzenlemede yeni atkı attach olur", () => {
    expect(planWeftSave(draft({ mode: "new", content: { ...READY, seq: "" }, touched: true }), false, build).kind).toBe("invalid");
    expect(planWeftSave(draft({ mode: "new", content: READY, touched: true }), true, build).kind).toBe("attach");
  });
  it("kayıtlı kart değiştirilince patch-card; dokunulmadıysa yalnız bağ", () => {
    expect(planWeftSave(draft({ mode: "card", cardId: "w1", savedCardId: "w1", content: READY, touched: true }), true, build).kind).toBe("patch-card");
    expect(planWeftSave(draft({ mode: "card", cardId: "w1", savedCardId: "w1", content: READY, touched: false }), true, build)).toEqual({ kind: "link", weftSpecId: "w1" });
  });
});

describe("paylaşılan kart sorusu", () => {
  const patch: WeftSavePlan = { kind: "patch-card", weftSpecId: "w1", body: { sequenceCode: "A2 B1" } };
  it("soru yalnız patch-card + başka kumaş varken", () => {
    expect(needsShareQuestion(patch, 2)).toBe(true);
    expect(needsShareQuestion(patch, 0)).toBe(false);
    expect(needsShareQuestion({ kind: "link", weftSpecId: "w1" }, 3)).toBe(false);
  });
  it("'yalnız bu kumaş' kopya planı: önerilen kod/ad fork diyaloğuyla aynı", () => {
    const p = toForkPlan(patch as Extract<WeftSavePlan, { kind: "patch-card" }>, { code: "1205", name: "Ortak atkı" }, "K-77");
    expect(p).toEqual({ kind: "fork-patch", sourceId: "w1", code: "1205-K-77", name: "Ortak atkı (K-77)", body: { sequenceCode: "A2 B1" } });
  });
});

describe("applyWeftPlan — çağrı sırası ve gövde", () => {
  const ctx = { visible: true, itemId: "i1", savedWeftSpecId: "w1" };
  it("fork-patch: önce kopya, sonra değişiklik KOPYAYA; ortak kart PATCH edilmez, ürün gövdesi atkıya dokunmaz", async () => {
    const api = fakeApi();
    const out = await applyWeftPlan({ kind: "fork-patch", sourceId: "w1", code: "c", name: "n", body: { a: 1 } }, { name: "x" } as never, ctx, api);
    expect(api.calls).toEqual(["fork", "patch:w-fork"]);
    expect(out).not.toHaveProperty("weftSpecId");
  });
  it("hepsinde: ortak kart PATCH", async () => {
    const api = fakeApi();
    await applyWeftPlan({ kind: "patch-card", weftSpecId: "w1", body: {} }, { name: "x" } as never, ctx, api);
    expect(api.calls).toEqual(["patch:w1"]);
  });
  it("yeni üründe taslak gövdeye + clientToken; ayrı atkı çağrısı yok", async () => {
    const api = fakeApi();
    const out = await applyWeftPlan({ kind: "create-with-item", body: { yarns: [] } }, { name: "x" } as never, { visible: true, itemId: null, savedWeftSpecId: null, clientToken: "t1" }, api);
    expect(out).toMatchObject({ weftSpecDraft: { yarns: [] }, clientToken: "t1" });
    expect(api.calls).toEqual([]);
  });
  it("kart kaldırılınca weftSpecId null gider", async () => {
    const out = await applyWeftPlan({ kind: "link", weftSpecId: null }, { name: "x" } as never, ctx, fakeApi());
    expect(out.weftSpecId).toBeNull();
  });
});
