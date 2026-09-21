// =============================================================================
// SEVK PARTİSİ panel kuralları (2026-09-21) — saf yüklemler + kaynak metni kapıları
//   §1 `isLotMode`: grup bayrağı kapalıyken mod ne olursa olsun FALSE (fail-closed)
//   §2 `packageNoField`: otomatik → alan yok; elle → zorunlu; ezilebilir → opsiyonel
//   §3 `lotDeletable`: yalnız hiç çuvalı olmamış parti
//   §4 `newSackLotTarget`: seçili parti hedef; `lotRequired` + parti yok → engel metni
//   §5 `parsePackageNoInput`: boş → null; kesirli/negatif → hata; tam sayı → sayı
//   §6 kaynak metni: `SacksListView` parti modunda PARTİ BAŞLIĞI, grup modunda çip şeridi
//      çizer; `NewSackDialog` numarayı `packageNoField`ten okur (elle karar yok); `openSack`
//      gövdesi `packingGroupId`yi yalnız doluyken gönderir (grup modunda bayt bayt eski istek)
//   §7 kaynak metni: parti menüsünde KAPAT/YENİDEN AÇ YOK (durum sevkten türer), sil `lotDeletable`
//      kapısından geçer; sayfa parti modunda cariye girince PARTİ LİSTESİ çizer, geri oku
//      önce parti listesine döner (2026-09-22 kullanıcı kararı: çip değil liste); liste
//      "Sevkiyatlar" bağlantısı taşır (sevk edilenler burada izlenmez)
//   §8 sütun kümesi bağlama göre: "Ambalaj No" yalnız parti modunda, "Eşleşen" yalnız içerik
//      süzgeci (kumaş/renk/kalite/en) varken (süzgeçsiz "—" gürültüsü kalktı, saha 2026-09-21)
// ⭐ NEGATİF SONDA (ölçüldü 2026-09-21): `isLotMode` `groupsEnabled` kapısı silinince §1 ❌;
//    `lotDeletable` `shippedSackCount` şartı silinince §3 ❌; `service.ts`te packingGroupId
//    koşulsuz gönderilince §6c ❌.
// =============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isLotMode, lotDeletable, lotSackLabel, lotStatusLabel, newSackLotTarget, packageNoField, parsePackageNoInput } from "./packingLotUi";
import { hasContentFilter, sacksKolonlari } from "./sacksColumns";

const src = (f: string) => readFileSync(join(__dirname, f), "utf-8");

describe("sevk partisi — saf yüklemler", () => {
  it("§1 isLotMode: grup bayrağı kapalıyken hep false", () => {
    expect(isLotMode(false, "sevk-partisi")).toBe(false);
    expect(isLotMode(true, "grup")).toBe(false);
    expect(isLotMode(true, "sevk-partisi")).toBe(true);
  });

  it("§2 packageNoField moda göre", () => {
    expect(packageNoField("otomatik").shown).toBe(false);
    expect(packageNoField("elle")).toMatchObject({ shown: true, required: true });
    expect(packageNoField("otomatik-ezilebilir")).toMatchObject({ shown: true, required: false });
  });

  it("§3 lotDeletable yalnız hiç çuvalı olmamış partide", () => {
    expect(lotDeletable({ sackCount: 0, shippedSackCount: 0 })).toBe(true);
    expect(lotDeletable({ sackCount: 1, shippedSackCount: 0 })).toBe(false);
    expect(lotDeletable({ sackCount: 0, shippedSackCount: 3 })).toBe(false);
    // Sevk edilenler bu ekranda izlenmez: açık partide yalnız açık sayı; "sevk edildi" partide giden sayı.
    expect(lotSackLabel({ status: "OPEN", sackCount: 2, shippedSackCount: 3 })).toBe("2 çuval");
    expect(lotSackLabel({ status: "CLOSED", sackCount: 0, shippedSackCount: 12 })).toBe("12 çuval sevk edildi");
    expect(lotStatusLabel("CLOSED")).toBe("SEVK EDİLDİ");
  });

  it("§4 newSackLotTarget", () => {
    expect(newSackLotTarget({ lotMode: false, selectedLotId: "x", lotRequired: true })).toEqual({ packingGroupId: null, blocked: null });
    expect(newSackLotTarget({ lotMode: true, selectedLotId: "x", lotRequired: true }).packingGroupId).toBe("x");
    expect(newSackLotTarget({ lotMode: true, selectedLotId: null, lotRequired: true }).blocked).toMatch(/parti/);
    expect(newSackLotTarget({ lotMode: true, selectedLotId: null, lotRequired: false }).blocked).toBeNull();
  });

  it("§5 parsePackageNoInput", () => {
    expect(parsePackageNoInput("")).toEqual({ value: null, error: null });
    expect(parsePackageNoInput(" 12 ")).toEqual({ value: 12, error: null });
    expect(parsePackageNoInput("0")).toEqual({ value: 0, error: null });
    expect(parsePackageNoInput("-1").error).toBeTruthy();
    expect(parsePackageNoInput("1.5").error).toBeTruthy();
  });
});

describe("sevk partisi — kaynak metni kapıları", () => {
  it("§6a SacksListView parti modunda başlık, grup modunda çip şeridi", () => {
    const s = src("SacksListView.tsx");
    expect(s).toMatch(/lotMode\s*\?\s*tekCariId && groupFilter && <PackingLotHeader/);
    expect(s).toMatch(/: <PackingGroupBar/);
  });
  it("§6b NewSackDialog numara alanını packageNoField'tan okur", () => {
    const s = src("NewSackDialog.tsx");
    expect(s).toContain("packageNoField(");
    expect(s).not.toMatch(/mode === "elle" \? true/);
  });
  it("§6c service.openSack packingGroupId'yi yalnız doluyken gönderir", () => {
    const s = src("service.ts");
    expect(s).toMatch(/\.\.\.\(body\.packingGroupId \? \{ packingGroupId: body\.packingGroupId \} : \{\}\)/);
    expect(s).not.toMatch(/packingGroupId: body\.packingGroupId,/);
  });
  it("§7 parti menüsü: elle kapat/aç YOK, sil kapısı var", () => {
    const s = src("PackingLotHeader.tsx");
    expect(s).not.toContain("closePackingGroup");
    expect(s).not.toContain("reopenPackingGroup");
    expect(s).toContain("deletePackingGroup");
    expect(s).toMatch(/lotDeletable\(/);
    expect(src("service.ts")).not.toMatch(/packing-groups\/\$\{groupId\}\/(close|reopen)/);
  });
  it("§7b sayfa: parti modunda cariye girince parti LİSTESİ; geri oku önce listeye", () => {
    const page = src("SackContentEditPage.tsx");
    expect(page).toMatch(/const lotList = !gateOpen && lotMode && !!singleCustomer && !groupFilter;/);
    expect(page).toMatch(/lotList \? \(\s*<PackingLotListView/);
    expect(page).toMatch(/lotMode && singleCustomer && groupFilter\s*\?\s*\(\) => setGroupFilter\(null\)/);
    expect(page).toMatch(/onBack=\{onBack\}/);
    const list = src("PackingLotListView.tsx");
    // Havuz satırı SABİT ve boşken kaybolmaz; parti satırı "N açık · M sevk".
    expect(list).toMatch(/<UngroupedRow /);
    expect(list).toMatch(/lotSackLabel\(lot\)/);
    expect(list).not.toMatch(/empty && null/);
    expect(list).toMatch(/operations\/shipments\?filter\[customerId\]=/);
  });
});

describe("sütun kümesi bağlama göre", () => {
  const ids = (cols: ReturnType<typeof sacksKolonlari>) => cols.map((c) => c.id ?? (c as { accessorKey?: string }).accessorKey);
  it("§8 Ambalaj No yalnız parti modunda, Eşleşen yalnız içerik süzgeciyle", () => {
    expect(ids(sacksKolonlari(true, false, false))).not.toContain("packageNo");
    expect(ids(sacksKolonlari(true, true, false))).toContain("packageNo");
    expect(ids(sacksKolonlari(true, true, false))).not.toContain("match");
    expect(ids(sacksKolonlari(true, true, true))).toContain("match");
  });
  it("§8 hasContentFilter: kumaş / renk / kalite / en; cari ya da kapsam SAYILMAZ", () => {
    expect(hasContentFilter(new URLSearchParams("filter[customerId]=x&filter[scope]=POOL"))).toBe(false);
    expect(hasContentFilter(new URLSearchParams("filter[itemId]=a"))).toBe(true);
    expect(hasContentFilter(new URLSearchParams("filter[widthMax]=150"))).toBe(true);
    expect(hasContentFilter(new URLSearchParams("filter[colorId]="))).toBe(false);
  });
});
