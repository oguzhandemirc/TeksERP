// "Kime bildirildi": donmuş alıcılar kaynağıyla; BY_PERMISSION (sorumlu tanımsız / A4 öncesi) cümlesi; boşsa blok yok.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AlarmNotifications, notificationText } from "./AlarmNotifications";
import type { LoomAlarmDetail, LoomAlarmNotification } from "./types";

const listed: LoomAlarmNotification = {
  tier: 1, at: "2026-10-11T05:13:00Z", mode: "LISTED",
  recipients: [{ id: "u1", name: "Ayşe Nöbetçi", source: "DUTY_OVERRIDE" }, { id: "u2", name: "Mehmet Usta", source: "PERMISSION" }],
};
const byPerm2: LoomAlarmNotification = { tier: 2, at: "2026-10-11T05:23:00Z", mode: "BY_PERMISSION", recipients: [] };

const detail = (notifications: LoomAlarmNotification[] | undefined) => ({ notifications }) as unknown as LoomAlarmDetail;

describe("AlarmNotifications", () => {
  it("LISTED: alıcı adları kaynağıyla", () => {
    expect(notificationText(listed)).toBe("Ayşe Nöbetçi (nöbet değişikliği), Mehmet Usta (kural: yetki)");
  });

  it("BY_PERMISSION: K1 görme yetkisi, K2 üst kademe yetkisi cümlesi", () => {
    expect(notificationText({ ...byPerm2, tier: 1 })).toBe("Sorumlu tanımlı değil — alarm görme yetkisi olan herkese");
    expect(notificationText(byPerm2)).toBe("Sorumlu tanımlı değil — üst kademe yetkisi olan herkese");
  });

  it("kademe başına satır, saat fabrika diliminden", () => {
    render(<AlarmNotifications detail={detail([listed, byPerm2])} />);
    expect(screen.getByText("Kime bildirildi")).toBeTruthy();
    expect(screen.getByText("Kademe 1")).toBeTruthy();
    expect(screen.getByText("Kademe 2")).toBeTruthy();
    expect(screen.getByText("11.10.2026 08:13")).toBeTruthy();
    expect(screen.getByText(/Ayşe Nöbetçi \(nöbet değişikliği\)/)).toBeTruthy();
  });

  it("bildirim yoksa (alanı tanımayan sunucu dahil) blok çizilmez", () => {
    const { container } = render(<AlarmNotifications detail={detail(undefined)} />);
    expect(container.innerHTML).toBe("");
  });
});
