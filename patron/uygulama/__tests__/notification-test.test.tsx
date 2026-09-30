import { act, fireEvent, render, screen } from "@testing-library/react-native";

const mockTest = jest.fn();
const mockDevices = { data: [{ id: "d1", platform: "android", ad: "Telefon", aktif: true, sonGorulme: "2026-10-01T09:00:00.000Z", olusturulma: "2026-10-01T09:00:00.000Z" }] as unknown[], reload: jest.fn() };
jest.mock("../src/state/session", () => ({ useSession: () => ({ api: { notificationTest: mockTest, deviceList: jest.fn(), deviceRemove: jest.fn() }, offline: false }) }));
jest.mock("../src/state/useRemote", () => ({ useRemote: () => mockDevices }));
jest.mock("../src/push/register", () => ({ registerThisDevice: jest.fn() }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));

// mock'lar kurulduktan SONRA yüklenir.
const { NotificationDevices, testOutcome } = require("../src/ui/NotificationDevices") as typeof import("../src/ui/NotificationDevices");
const { ApiError } = require("../src/api/client") as typeof import("../src/api/client");

describe("deneme bildirimi", () => {
  it("⭐ düğme kendi cihazlarına deneme ister; sonuç cihaz başına özetlenir", async () => {
    mockTest.mockResolvedValue({ gonderilen: 1, cihazlar: [{ id: "d1", ad: null, platform: "android", sonuc: "OK" }, { id: "d2", ad: null, platform: "ios", sonuc: "GECERSIZ_CIHAZ" }] });
    render(<NotificationDevices vapidKey={null} />);
    await act(async () => fireEvent.press(screen.getByTestId("bildirim-deneme")));
    expect(mockTest).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/1 cihaza gönderildi · 1 cihaz artık kayıtlı değil/)).toBeTruthy();
    expect(mockDevices.reload).toHaveBeenCalled();
  });

  it("hız sınırı iletisi (429) kullanıcıya olduğu gibi gösterilir", async () => {
    mockTest.mockRejectedValue(new ApiError(429, "HIZ_SINIRI", "Deneme bildirimi dakikada bir gönderilebilir; 42 sn sonra tekrar deneyin"));
    render(<NotificationDevices vapidKey={null} />);
    await act(async () => fireEvent.press(screen.getByTestId("bildirim-deneme")));
    expect(screen.getByText(/42 sn sonra/)).toBeTruthy();
  });

  it("cihaz yoksa düğme çizilmez", () => {
    const eski = mockDevices.data;
    mockDevices.data = [];
    render(<NotificationDevices vapidKey={null} />);
    expect(screen.queryByTestId("bildirim-deneme")).toBeNull();
    mockDevices.data = eski;
  });

  it("sonuç tonu: hepsi gittiyse sakin, eksik varsa uyarı", () => {
    expect(testOutcome({ gonderilen: 2, cihazlar: [{ id: "a", ad: null, platform: "ios", sonuc: "OK" }, { id: "b", ad: null, platform: "web", sonuc: "OK" }] }).tone).toBe("off");
    expect(testOutcome({ gonderilen: 0, cihazlar: [{ id: "a", ad: null, platform: "ios", sonuc: "GECICI" }] })).toEqual({ tone: "warn", text: "Deneme bildirimi hiçbir cihaza gönderilemedi · 1 cihaza şu an ulaşılamadı" });
  });
});
