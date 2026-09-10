// =============================================================================
// Bekçi: "Otomatik yedek saati" ÖLÜ KUMANDA olmasın (O-1, 2026-09-05 sahada)
// =============================================================================
// ⭐ NEDEN VAR: sahada `BACKUP_SCHEDULE_ENABLED=false` — gece yedeğini harici bir
//    Windows Görev Zamanlayıcı görevi alıyor (bilinçli: backend çökmüşken de
//    yedek alınsın). Panel yine de saat alanını DÜZENLENEBİLİR gösteriyordu.
//    Kullanıcı saati değiştirdi, gerçek yedek başka saatte alınmaya devam etti:
//    **panel bir saat gösteriyor, sistem başka saatte yedek alıyor ve ikisinin
//    ilgisi yok.** Operatör bunu ancak dışarıdan ölçerek anlayabilirdi.
//
// NE ÖLÇER:
//   §1 Zamanlayıcı AÇIKKEN bugünkü davranış — tek bayt değişmedi.
//   §2 ⭐ KAPALIYKEN kumanda DEVRE DIŞI ve sebebi yazılı.
//   §3 ⭐ Alan HİÇ gelmeyen eski sunucuda kumanda AÇIK kalır (yeni alanın
//      varsayılanı = bugünkü davranış).
//   §4 Kumanda GİZLENMİYOR — "böyle bir ayar yok" demek yanlış olurdu; ayar var,
//      başka bir yerden yönetiliyor ve operatörün bunu bilmesi gerekiyor.
//
// ⭐ NEGATİF SONDA (ölçüldü 2026-09-10): `disabled`daki `!zamanlayiciAcik`
//    kaldırılınca §2 KIRMIZI; `!== false` yerine `=== true` yazılınca §3 KIRMIZI.
// =============================================================================
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import type { BackupListing } from "./service";

const useBackupsMock = vi.fn();
vi.mock("./hooks", () => ({ useBackups: () => useBackupsMock() }));
vi.mock("@/hooks/usePricingEnabled", () => ({
  useBackupHour: () => 3,
  FEATURE_FLAGS_QUERY_KEY: ["feature-flags"],
}));
vi.mock("@/components/PermissionGate", () => ({
  PermissionGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { BackupScheduleCard } from "./BackupScheduleCard";

/** Yalnız bu bekçinin okuduğu alanlar — gerisi kartı ilgilendirmiyor. */
function listing(scheduleEnabled?: boolean): Partial<BackupListing> {
  return { files: [], backupDir: null, running: false, lastResult: null, scheduleEnabled };
}

const HARICI = /harici bir zamanlanmış görev/i;

describe("BackupScheduleCard — ölü kumanda kapısı", () => {
  beforeEach(() => useBackupsMock.mockReset());

  it("§1 zamanlayıcı AÇIKKEN kumanda çalışır ve bugünkü açıklama basılır", () => {
    useBackupsMock.mockReturnValue({ data: listing(true) });
    renderWithProviders(<BackupScheduleCard />);
    expect(screen.getByRole("combobox")).not.toBeDisabled();
    expect(screen.getByText(/Her gün bu saatte tam yedek alınır/i)).toBeInTheDocument();
    expect(screen.queryByText(HARICI)).toBeNull();
  });

  it("⭐ §2 KAPALIYKEN kumanda DEVRE DIŞI ve sebebi yazılı", () => {
    useBackupsMock.mockReturnValue({ data: listing(false) });
    renderWithProviders(<BackupScheduleCard />);
    expect(screen.getByRole("combobox")).toBeDisabled();
    expect(screen.getByText(HARICI)).toBeInTheDocument();
    // "Saat buradan değişmez" cümlesi LOAD-BEARING: kullanıcının sorduğu tek
    // soru "peki nereden değişir" ve cevabı ekranda olmalı.
    expect(screen.getByText(/Saat buradan değişmez/i)).toBeInTheDocument();
  });

  it("⭐ §3 alan HİÇ gelmezse (eski sunucu) kumanda AÇIK kalır", () => {
    useBackupsMock.mockReturnValue({ data: listing(undefined) });
    renderWithProviders(<BackupScheduleCard />);
    expect(screen.getByRole("combobox")).not.toBeDisabled();
    expect(screen.queryByText(HARICI)).toBeNull();
  });

  it("§3b sorgu henüz dönmediyse de kumanda AÇIK (yükleme anında kilitlenmez)", () => {
    useBackupsMock.mockReturnValue({ data: undefined });
    renderWithProviders(<BackupScheduleCard />);
    expect(screen.getByRole("combobox")).not.toBeDisabled();
  });

  it("§4 kumanda GİZLENMİYOR — başlık ve saat her hâlde ekranda", () => {
    useBackupsMock.mockReturnValue({ data: listing(false) });
    renderWithProviders(<BackupScheduleCard />);
    expect(screen.getByText("Otomatik yedek saati")).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });
});
