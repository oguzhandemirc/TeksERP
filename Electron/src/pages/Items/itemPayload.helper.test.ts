import { describe, expect, it } from "vitest";
import { buildItemPayload } from "./itemPayload.helper";
import { makeItemFormSchema, itemFormDefaults, type ItemFormValues } from "./schema";
import { ItemType } from "@/types/enums";

const values = (over: Partial<ItemFormValues> = {}): ItemFormValues => ({
  ...itemFormDefaults,
  name: "PATOS",
  ...over,
});

describe("buildItemPayload", () => {
  it("create: dolu kod aynen gider", () => {
    const p = buildItemPayload(values({ code: " KUM-01 " }), false);
    expect(p.code).toBe("KUM-01");
    expect(p.itemType).toBe(ItemType.FABRIC);
  });

  it("create: boş kod payload'a GİRMEZ — backend otomatik üretsin", () => {
    const p = buildItemPayload(values({ code: "" }), false);
    expect("code" in p).toBe(false);
    expect(p.itemType).toBe(ItemType.FABRIC);
  });

  it("create: salt boşluk kod da boş sayılır", () => {
    const p = buildItemPayload(values({ code: "   " }), false);
    expect("code" in p).toBe(false);
  });

  it("create: birim tipten türetilir", () => {
    const p = buildItemPayload(values({ itemType: ItemType.YARN, unit: "MT" }), false);
    expect(p.unit).toBe("KG");
  });

  it("edit: code ve itemType payload'a girmez (backend FORBIDDEN)", () => {
    const p = buildItemPayload(values({ code: "PATOS" }), true);
    expect("code" in p).toBe(false);
    expect("itemType" in p).toBe(false);
    expect(p.name).toBe("PATOS");
  });

  it("edit: pendingReview:false gönderilir (saha onay işareti temizlenir)", () => {
    const p = buildItemPayload(values(), true);
    expect(p.pendingReview).toBe(false);
  });

  it("create: pendingReview payload'a GİRMEZ (admin create'i işaretlemez)", () => {
    const p = buildItemPayload(values(), false);
    expect("pendingReview" in p).toBe(false);
  });
});

describe("makeItemFormSchema — kod validasyonu", () => {
  const create = makeItemFormSchema(false);
  const edit = makeItemFormSchema(true);

  it("create: boş kod geçerli (otomatik üretim yolu)", () => {
    expect(create.safeParse(values({ code: "" })).success).toBe(true);
  });

  it("create: geçerli manuel kod kabul", () => {
    expect(create.safeParse(values({ code: "KUM-01_A" })).success).toBe(true);
  });

  it("create: Türkçe karakter/boşluk reddedilir", () => {
    expect(create.safeParse(values({ code: "ÜRÜN 1" })).success).toBe(false);
  });

  it("create: 32 karakterden uzun kod reddedilir", () => {
    expect(create.safeParse(values({ code: "A".repeat(33) })).success).toBe(false);
    expect(create.safeParse(values({ code: "A".repeat(32) })).success).toBe(true);
  });

  it("create: STK- önekli manuel kod reddedilir (otomatik sayaca rezerve)", () => {
    expect(create.safeParse(values({ code: "STK-000001" })).success).toBe(false);
    expect(create.safeParse(values({ code: "stk-1" })).success).toBe(false);
    expect(create.safeParse(values({ code: "TST-STK-1" })).success).toBe(true);
  });

  it("create: ad DB sınırına hizalı (VarChar(100))", () => {
    expect(create.safeParse(values({ name: "A".repeat(101) })).success).toBe(false);
    expect(create.safeParse(values({ name: "A".repeat(100) })).success).toBe(true);
  });

  it("edit: legacy (formata uymayan) kod düzenlemeyi bloklamaz", () => {
    expect(edit.safeParse(values({ code: "PATOS 3MM" })).success).toBe(true);
    expect(edit.safeParse(values({ code: "STK-000001" })).success).toBe(true);
  });
});
