// Durum rozeti metni (URUN-YASAM-DONGUSU §8): "Tükenene kadar · N top kaldı" / "Pasife hazır".
import { describe, expect, it } from "vitest";
import { itemLifecycleExportText, phaseOutBadgeText } from "./ItemLifecycleBadge";
import type { Item } from "./types";

describe("phaseOutBadgeText", () => {
  it("⭐ kalan top sayısı, kalan 0 → Pasife hazır, top yoksa kayıt sayısı", () => {
    expect(phaseOutBadgeText({ liveTotal: 53, rolls: 51 })).toBe("Tükenene kadar · 51 top kaldı");
    expect(phaseOutBadgeText({ liveTotal: 0, rolls: 0 })).toBe("Tükenene kadar · Pasife hazır");
    expect(phaseOutBadgeText({ liveTotal: 2, rolls: 0 })).toBe("Tükenene kadar · 2 kayıt kaldı");
    expect(phaseOutBadgeText(undefined)).toBe("Tükenene kadar");
  });
  it("dışa aktarım durum adını yazar", () => {
    const it0 = { isActive: true, lifecycleStatus: "PHASE_OUT" } as Item;
    expect(itemLifecycleExportText(it0)).toBe("Tükenene kadar");
    expect(itemLifecycleExportText({ isActive: false } as Item)).toBe("Pasif");
  });
});
