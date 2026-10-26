// UX-4 bildirim izni akışı: Bildirim Ayarları ekranının üstünde bu cihazın izin durumu okunur (istenmez); reddedildiyse
// telefonda "ayarları aç", web'de yönerge; desteklenmeyen/yakında durumunda kayıt düğmesi çizilmez.
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Linking } from "react-native";

const mockDevices = { data: [] as unknown[], reload: jest.fn() };
jest.mock("../src/state/session", () => ({ useSession: () => ({ api: { notificationTest: jest.fn(), deviceList: jest.fn(), deviceRemove: jest.fn() }, offline: false }) }));
jest.mock("../src/state/useRemote", () => ({ useRemote: () => mockDevices }));
jest.mock("../src/push/register", () => ({ registerThisDevice: jest.fn() }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));

const { NotificationDevices } = require("../src/ui/NotificationDevices") as typeof import("../src/ui/NotificationDevices");
const { permissionView, readPermission, webPermission } = require("../src/push/permission") as typeof import("../src/push/permission");

describe("izin görünümü (saf)", () => {
  it("dört durum, dört rozet; yalnız reddedilen 'ayarlar' ister", () => {
    expect(permissionView("VERILDI", "android")).toMatchObject({ kind: "iyi", action: null });
    expect(permissionView("SORULMADI", "android")).toMatchObject({ kind: "bilgi", action: "iste" });
    expect(permissionView("REDDEDILDI", "android")).toMatchObject({ kind: "kritik", action: "ayarlar" });
    expect(permissionView("REDDEDILDI", "web").hint).toMatch(/Tarayıcının site ayarlarından/);
    expect(permissionView("DESTEKLENMIYOR", "web").kind).toBe("uyari");
  });
  it("native push kapalıyken telefonda izin OKUNMAZ (native modüle dokunulmaz)", async () => {
    await expect(readPermission("android", false)).resolves.toBe("DESTEKLENMIYOR");
  });
  it("web: Notification.permission eşlemesi", () => {
    const g = globalThis as Record<string, unknown>;
    expect(webPermission()).toBe("DESTEKLENMIYOR");
    g.PushManager = function PushManager() {};
    for (const [p, want] of [["granted", "VERILDI"], ["denied", "REDDEDILDI"], ["default", "SORULMADI"]] as const) {
      g.Notification = { permission: p };
      expect(webPermission()).toBe(want);
    }
    delete g.Notification;
    delete g.PushManager;
  });
});

describe("Cihazlar bölümü", () => {
  it("izin sorulmadı: rozet + açıklama + kayıt düğmesi", () => {
    render(<NotificationDevices vapidKey={null} pushHere permission="SORULMADI" os="android" />);
    expect(screen.getByText("İzin sorulmadı")).toBeTruthy();
    expect(screen.getByTestId("cihaz-kaydet")).toBeTruthy();
    expect(screen.queryByTestId("izin-ayarlar")).toBeNull();
  });
  it("reddedildi (telefon): kayıt düğmesi yerine 'Telefon ayarlarını aç'", async () => {
    const open = jest.spyOn(Linking, "openSettings").mockResolvedValue(undefined);
    render(<NotificationDevices vapidKey={null} pushHere permission="REDDEDILDI" os="android" />);
    expect(screen.queryByTestId("cihaz-kaydet")).toBeNull();
    await act(async () => fireEvent.press(screen.getByTestId("izin-ayarlar")));
    expect(open).toHaveBeenCalledTimes(1);
  });
  it("reddedildi (web): düğme yok, yönerge var", () => {
    render(<NotificationDevices vapidKey={null} pushHere permission="REDDEDILDI" os="web" />);
    expect(screen.queryByTestId("izin-ayarlar")).toBeNull();
    expect(screen.queryByTestId("cihaz-kaydet")).toBeNull();
    expect(screen.getByTestId("izin-aciklama").props.children).toMatch(/site ayarlarından/);
  });
  it("mağaza sürümü (native push kapalı): 'yakında' notu, izin rozeti ve kayıt düğmesi yok", () => {
    render(<NotificationDevices vapidKey={null} pushHere={false} />);
    expect(screen.getByTestId("cihaz-yakinda")).toBeTruthy();
    expect(screen.queryByTestId("izin-durumu")).toBeNull();
    expect(screen.queryByTestId("cihaz-kaydet")).toBeNull();
  });
});

describe("bulunabilirlik", () => {
  it("Bildirim Ayarları ekranında Cihazlar (izin) bölümü ayarlar formundan ÖNCE", () => {
    const src = require("node:fs").readFileSync(require("node:path").join(__dirname, "../app/(app)/bildirimler.tsx"), "utf8") as string;
    expect(src.indexOf("<NotificationDevices")).toBeGreaterThan(0);
    expect(src.indexOf("<NotificationDevices")).toBeLessThan(src.indexOf('<SectionHeader title="Ayarlar"'));
  });
});
