// SÖZLEŞME KABULLERİ (Ek-7) paneli: kurulum kaydı defterinden yalnız `SOZLESME_KABUL_EDILDI` satırlarını, kabul
// belgesinin alanlarıyla gösterir (olay adı sunucu kaynağıyla `mirrors.test.ts`te ölçülür).
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ACCEPTANCE_EVENT, AcceptancePanel } from "../portal/installation/AcceptancePanel";
import { installationDetail } from "./fixtures";

const kayit = (olay: string, ayrinti: Record<string, unknown>) => ({
  id: `${olay}-1`,
  olay,
  anahtarKimligi: "kur-abc",
  eskiAnahtarKimligi: null,
  ayrinti,
  yapan: "kurulum",
  createdAt: "2026-09-30T10:00:01.000Z",
});

describe("kurulum ayrıntısı — sözleşme kabulleri", () => {
  it("kabul satırını kabul eden · metin · kutular · panel sürümüyle çizer; başka olayları almaz", () => {
    const detail = installationDetail({
      kurulumKaydi: [
        kayit("ETKINLESTI", { kodId: "k" }),
        kayit(ACCEPTANCE_EVENT, {
          metin: { kimlik: "KM-2026.1-taslak", ozet: "4fe1d14e24fafffafc203f7b" },
          kutular: ["1", "2", "3", "4"],
          kabulEden: { ad: "Ayşe Yılmaz", unvan: "Genel Müdür" },
          zaman: "2026-09-30T09:59:00.000Z",
          istemci: { surum: "1.5.0" },
        }),
      ],
    });
    render(<AcceptancePanel detail={detail} />);
    expect(screen.getByText("Ayşe Yılmaz · Genel Müdür")).toBeTruthy();
    expect(screen.getByText(/KM-2026\.1-taslak/)).toBeTruthy();
    expect(screen.getByText("1, 2, 3, 4")).toBeTruthy();
    expect(screen.getByText("1.5.0")).toBeTruthy();
    expect(screen.queryByText("Kabul kaydı yok (kabul adımından önce etkinleşmiş kurulum)")).toBeNull();
  });

  it("kabul satırı yoksa boş durumu söyler", () => {
    render(<AcceptancePanel detail={installationDetail({ kurulumKaydi: [kayit("ETKINLESTI", {})] })} />);
    expect(screen.getByText("Kabul kaydı yok (kabul adımından önce etkinleşmiş kurulum)")).toBeTruthy();
  });
});
