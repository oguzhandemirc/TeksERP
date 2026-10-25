import { describe, expect, it } from "vitest";
import { eIrsaliyeAffectedLines, undoAffectedRows, undoRollDetail } from "./undo-affected";

const roll = (id: string, over: Partial<Parameters<typeof undoRollDetail>[0]> = {}) => ({ id, barcode: `T${id}`, meters: 12.5, ownerName: null, returnTo: "WAREHOUSE", ...over });

describe("Sevki Geri Al — etkilenen kayıt listesi (çekirdek: HER kayıt somut, soyut sayı yetmez)", () => {
  it("çuval satırı + altında her top: barkod · metre · döneceği raf", () => {
    const rows = undoAffectedRows({ sacks: [{ id: "s1", sackNo: "CV1", rollCount: 2, rolls: [roll("r1"), roll("r2", { returnTo: "A1_STOCK", meters: 50 })] }] });
    expect(rows.map((r) => [r.kind, r.label])).toEqual([["sack", "CV1"], ["roll", "Tr1"], ["roll", "Tr2"]]);
    expect(rows[0]!.detail).toBe("2 top");
    expect(rows[1]!.detail).toBe("12,5 m · → Depoda");
    expect(rows[2]!.detail).toMatch(/^50 m · → /);
  });

  it("emanet top sahibini söyler; barkodsuz top gizlenmez", () => {
    expect(undoRollDetail(roll("r1", { ownerName: "Müşteri A" }))).toBe("12,5 m · Emanet: Müşteri A · → Depoda");
    const rows = undoAffectedRows({ sacks: [{ id: "s1", sackNo: "CV1", rollCount: 1, rolls: [roll("r1", { barcode: null })] }] });
    expect(rows[1]!.label).toBe("(barkodsuz)");
  });

  it("eski sunucu (rolls alanı yok): çuval numarası YİNE basılır, top sayısı rollCount'tan", () => {
    const rows = undoAffectedRows({ sacks: [{ id: "s1", sackNo: "CV1", rollCount: 3 }] });
    expect(rows).toEqual([{ key: "sack:s1", kind: "sack", label: "CV1", detail: "3 top" }]);
  });

  it("çuvalsız toplar ayrı satırda 'Çuvalsız' etiketiyle; boş önizleme boş liste", () => {
    const rows = undoAffectedRows({ sacks: [], looseRolls: [roll("r9")] });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.detail).toMatch(/^Çuvalsız · /);
    expect(undoAffectedRows({ sacks: [] })).toEqual([]);
  });
});

describe("Etkilenen e-İrsaliye kaydı (E6) — iptal edilecekse somut söylenir", () => {
  const rec = (over: Record<string, unknown> = {}) => ({ id: "e1", documentNo: "EIR2026000000007", status: "OLUSTURULDU", simulasyon: false, numaraBosaDuser: true, yerelIptalEdilebilir: true, ...over });

  it("iptal: numara + GİB'e gönderilmemiş + boşta kalan numara uyarısı", () => {
    expect(eIrsaliyeAffectedLines(rec(), true)).toEqual([
      "e-İrsaliye EIR2026000000007 iptal edilecek (GİB'e gönderilmemiş).",
      "EIR2026000000007 numarası boşta kalacak; bu numara yeniden kullanılmaz.",
    ]);
  });

  it("yalnız storno: kayıt yerinde kalır; taslakta numara uyarısı yok; simülasyon işaretli", () => {
    expect(eIrsaliyeAffectedLines(rec(), false)[0]).toMatch(/yerinde kalır/);
    expect(eIrsaliyeAffectedLines(rec({ documentNo: null, status: "TASLAK", numaraBosaDuser: false, simulasyon: true }), true)).toEqual([
      "e-İrsaliye taslağı (simülasyon) iptal edilecek (GİB'e gönderilmemiş).",
    ]);
  });

  it("kayıt yok / eski sunucu / gönderilmiş kayıt → satır yok (engel cümlesi backend'den gelir)", () => {
    expect(eIrsaliyeAffectedLines(undefined, true)).toEqual([]);
    expect(eIrsaliyeAffectedLines(null, true)).toEqual([]);
    expect(eIrsaliyeAffectedLines(rec({ status: "GONDERILDI", yerelIptalEdilebilir: false }), true)).toEqual([]);
  });
});
