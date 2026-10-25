import { describe, expect, it } from "vitest";
import { buildContractTree, isFieldLocked, openInternalField, resolveField } from "./contract";
import { loadFixture } from "./testContract";

const { contract } = loadFixture();

describe("veri ağacı", () => {
  it("kökler sırayla; tablolar kolonlarıyla; düğümde tür ve örnek", () => {
    const tree = buildContractTree(contract);
    expect(tree.map((n) => n.id).slice(0, 5)).toEqual(["belge", "firma", "karsi_taraf", "tablolar", "toplamlar"]);
    const urun = tree.find((n) => n.id === "tablolar")!.children!.find((n) => n.tableKey === "urun")!;
    expect(urun.kind).toBe("table");
    expect(urun.children!.map((c) => c.path)).toContain("tablolar.urun[].metre");
    const no = tree[0]!.children!.find((n) => n.path === "belge.no")!;
    expect(no.field).toMatchObject({ tur: "metin", sinif: "musteri" });
  });
});

describe("iç alan kilidi", () => {
  const parti = contract.tablolar.find((t) => t.anahtar === "cuval")!.kolonlar.find((k) => k.yol === "parti_kodu")!;
  it("opt-in yokken kilitli, açılınca serbest", () => {
    expect(parti.sinif).toBe("ic");
    expect(isFieldLocked(parti, [])).toBe(true);
    const opened = openInternalField([], parti.icKod!);
    expect(opened).toEqual(["cuval_parti_kodu"]);
    expect(isFieldLocked(parti, opened)).toBe(false);
    expect(openInternalField(opened, parti.icKod!)).toEqual(opened);
  });
  it("müşteri alanı hiçbir zaman kilitli değil", () => {
    expect(isFieldLocked(contract.kokler[0], [])).toBe(false);
  });
  it("satır değişkeni tablodan çözülür", () => {
    expect(resolveField(contract, "satir.parti_kodu", { variable: "satir", tableKey: "cuval" })?.sinif).toBe("ic");
    expect(resolveField(contract, "belge.tarih")?.tur).toBe("tarih");
  });
});
