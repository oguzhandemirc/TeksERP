// "Alarm kapalı" yol tarifi ayar kataloğundan türer (2026-10-11 vakası: metin olmayan "Genel Ayarlar"
// menüsünü gösteriyordu, kullanıcı Modüller'e gidip yanlış anahtarı açtı).
// NEGATİF SONDA (koşuldu, geri alındı): `alarmClosedText` eski sabit cümleye döndürüldü → §1 kırmızı;
// Modüller satırındaki yönlendirme cümlesi silindi → §3 kırmızı.
import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { SETTINGS_CATEGORIES, settingsCategoryPath, settingsCategoryTrail } from "@/pages/GeneralSettings/settings-config";
import { AlarmClosedNotice, alarmClosedText } from "./AlarmClosedNotice";

let allowed = true;
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({ hasPermission: () => allowed, hasAnyPermission: () => allowed }),
}));

const err = (code: string) => ({ response: { data: { details: { code } } } });
const tezgah = SETTINGS_CATEGORIES.find((c) => c.id === "tezgah")!;

describe("alarm kapalı bildirimi", () => {
  it("§1 ⭐ bayrak kapalı → 'Tezgah izleme' sekmesinin GERÇEK menü yolu; 'Genel Ayarlar' yok", () => {
    const t = alarmClosedText(err("LOOM_ALARM_DISABLED"));
    expect(t).toContain("Sistem → Özellik Anahtarları → Tezgah izleme");
    expect(t).toContain(settingsCategoryTrail(tezgah));
    expect(t).not.toMatch(/Genel Ayarlar/);
  });

  it("§2 modül kapalı → Modüller ekranı", () => {
    expect(alarmClosedText(err("MODULE_DISABLED"))).toContain("Sistem → Modüller");
  });

  it("§3 ⭐ Modüller'deki tezgah anahtarı alarmın AYRI ayar olduğunu ve yerini söyler", () => {
    const modules = SETTINGS_CATEGORIES.find((c) => c.id === "modules")!;
    const row = modules.flags!.find((f) => f.key === "tezgahEnabled")!;
    expect(row.desc).toContain(settingsCategoryTrail(tezgah));
  });

  it("§4 izni olana ayar sekmesine bağlantı verir, olmayana vermez", () => {
    allowed = true;
    const { unmount } = renderWithProviders(<AlarmClosedNotice error={err("LOOM_ALARM_DISABLED")} />);
    expect(screen.getByRole("link", { name: "Ayarı aç" })).toHaveAttribute("href", settingsCategoryPath(tezgah));
    unmount();
    allowed = false;
    renderWithProviders(<AlarmClosedNotice error={err("LOOM_ALARM_DISABLED")} />);
    expect(screen.queryByRole("link", { name: "Ayarı aç" })).toBeNull();
  });
});
