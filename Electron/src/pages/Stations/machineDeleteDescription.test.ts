import { describe, expect, it } from "vitest";
import type { MachineDeletePreview } from "@/pages/Machines/service";
import { buildMachineDeleteDescription } from "./machineDeleteDescription";

const base: MachineDeletePreview = {
  machineId: "m1",
  machineName: "M1",
  deletable: true,
  workSessionCount: 0,
  recentWorkSessions: [],
  peripheralDetachCount: 0,
  peripheralsToDetach: [],
  blockers: [],
};

describe("buildMachineDeleteDescription", () => {
  it("oturum geçmişi ENGELDİR: temizlenecek denmez, her oturum ve kalan sayı yazılır", () => {
    const text = buildMachineDeleteDescription(
      "M1",
      {
        ...base,
        deletable: false,
        workSessionCount: 7,
        recentWorkSessions: [
          { id: "s1", userName: "Ayşe Operatör", startedAt: "2026-09-01T06:00:00Z", endedAt: null },
          { id: "s2", userName: "Mehmet Usta", startedAt: "2026-08-30T06:00:00Z", endedAt: "2026-08-30T14:00:00Z" },
        ],
        blockers: [{ key: "workSessionCount", count: 7, message: "Bu makinede 7 çalışma oturumu kaydı var" }],
      },
      false,
    );
    expect(text).toContain("kalıcı silinemez");
    expect(text).toContain("• Bu makinede 7 çalışma oturumu kaydı var");
    expect(text).toContain("Ayşe Operatör");
    expect(text).toContain("Mehmet Usta");
    expect(text).toContain("… ve 5 oturum daha");
    expect(text).toContain("pasife alın");
    expect(text).not.toMatch(/temizlen/i);
  });

  it("silinebilir makinede boşa çıkacak her donanım adıyla listelenir", () => {
    const text = buildMachineDeleteDescription(
      "M1",
      {
        ...base,
        peripheralDetachCount: 2,
        peripheralsToDetach: [
          { id: "p1", code: "TER-1", name: "Terazi" },
          { id: "p2", code: "YAZ-1", name: "Etiket yazıcı" },
        ],
      },
      false,
    );
    expect(text).toContain("kalıcı olarak silinecek");
    expect(text).toContain("• Terazi (TER-1)");
    expect(text).toContain("• Etiket yazıcı (YAZ-1)");
  });

  it("yükleniyor / önizleme yok durumları", () => {
    expect(buildMachineDeleteDescription("M1", undefined, true)).toBe("Kontrol ediliyor…");
    expect(buildMachineDeleteDescription("M1", undefined, false)).toContain("Önizleme alınamadı");
  });
});
