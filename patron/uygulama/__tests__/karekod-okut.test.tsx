// Fabrika sunucusu karekodu (ERP kipi): giriş → "Fabrika sunucusuna bağlan" → "Karekod okut". Geçerli karekod elle
// girişle AYNI `connectServer` yolundan geçer; yabancı/yerel/yeni sürüm karekodu ağa gitmez, açık ileti; izin reddi elle
// girişe döner; elle giriş aynen kalır. Kamera mock'lu (yerel modül yok).
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Platform } from "react-native";

type Izin = { granted: boolean; canAskAgain: boolean } | null;
let mockIzin: Izin = { granted: true, canAskAgain: true };
const mockIste = jest.fn(async () => ({ granted: false, canAskAgain: false }));
let mockOkut: ((r: { data: string }) => void) | undefined;
jest.mock("expo-camera", () => {
  const { View } = require("react-native");
  return {
    useCameraPermissions: () => [mockIzin, mockIste],
    CameraView: (p: { onBarcodeScanned?: (r: { data: string }) => void; testID?: string }) => {
      mockOkut = p.onBarcodeScanned;
      return <View testID={p.testID} />;
    },
  };
});

const mockConnect = jest.fn(async (_a: string): Promise<string | null> => null);
jest.mock("../src/state/session", () => ({
  useSession: () => ({ login: jest.fn(), phase: "giris", configured: true, server: null, forgetServer: jest.fn(), yetenek: { kodHerZaman: true }, connectServer: mockConnect }),
}));
jest.mock("expo-router", () => ({ useRouter: () => ({ replace: jest.fn(), push: jest.fn() }), Redirect: () => null }));

const Login = (require("../app/giris") as { default: () => React.JSX.Element }).default;
const { KAREKOD_ILETI, KAMERA_IZNI_YOK } = require("../src/ui/diger/KarekodOkut") as typeof import("../src/ui/diger/KarekodOkut");

function sunucuEkrani() {
  render(<Login />);
  fireEvent.press(screen.getByTestId("sunucu-ekle"));
}
async function okut(metin: string) {
  fireEvent.press(screen.getByTestId("sunucu-karekod"));
  expect(mockOkut).toBeDefined();
  await act(async () => mockOkut!({ data: metin }));
}

beforeEach(() => {
  mockIzin = { granted: true, canAskAgain: true };
  mockOkut = undefined;
  mockConnect.mockImplementation(async () => null);
});

describe("karekodla fabrika sunucusu", () => {
  it("⭐ geçerli karekod → adres elle girişle AYNI connectServer'a gider, başarıda giriş ekranına dönülür", async () => {
    sunucuEkrani();
    await okut("tekserp-patron:1:https://ERP.Fabrika.com:8443");
    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(mockConnect).toHaveBeenCalledWith("https://erp.fabrika.com:8443");
    expect(screen.getByTestId("eposta")).toBeTruthy();
  });

  it("⭐ yabancı karekod (tablet TLS kodu, düz adres) ağa gitmez; açık ileti, tekrar okutulabilir", async () => {
    sunucuEkrani();
    await okut("teks-erp-tls:2:-:ab12:4443:erp.fabrika.com");
    expect(mockConnect).not.toHaveBeenCalled();
    expect(screen.getByText(KAREKOD_ILETI.yabanci)).toBeTruthy();
    // Kilit: hata gösterilirken kamera okuma bildirmez; "Tekrar okut" açar.
    expect(mockOkut).toBeUndefined();
    fireEvent.press(screen.getByTestId("karekod-tekrar"));
    await act(async () => mockOkut!({ data: "https://erp.fabrika.com" }));
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it("yerel adresli ve yeni sürüm karekodu ayrı iletiyle reddedilir", async () => {
    sunucuEkrani();
    await okut("tekserp-patron:1:https://192.168.1.20:4443");
    expect(screen.getByText(KAREKOD_ILETI.yerel)).toBeTruthy();
    fireEvent.press(screen.getByTestId("karekod-tekrar"));
    await act(async () => mockOkut!({ data: "tekserp-patron:2:https://erp.fabrika.com" }));
    expect(screen.getByText(KAREKOD_ILETI["yeni-surum"])).toBeTruthy();
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it("sunucu yoklaması başarısız → connectServer iletisi tarayıcıda kalır", async () => {
    mockConnect.mockImplementation(async () => "Bu adreste TeksERP sunucusu bulunamadı");
    sunucuEkrani();
    await okut("tekserp-patron:1:https://erp.fabrika.com");
    expect(screen.getByText("Bu adreste TeksERP sunucusu bulunamadı")).toBeTruthy();
    expect(screen.getByTestId("karekod-tekrar")).toBeTruthy();
  });

  it("⭐ kamera izni reddi → elle giriş ekranı + ileti; elle giriş aynen çalışır", async () => {
    mockIzin = { granted: false, canAskAgain: true };
    sunucuEkrani();
    await act(async () => fireEvent.press(screen.getByTestId("sunucu-karekod")));
    expect(mockIste).toHaveBeenCalledTimes(1);
    expect(screen.getByText(KAMERA_IZNI_YOK)).toBeTruthy();
    fireEvent.changeText(screen.getByTestId("sunucu-adres"), "erp.fabrika.com");
    await act(async () => fireEvent.press(screen.getByTestId("sunucu-baglan")));
    expect(mockConnect).toHaveBeenCalledWith("erp.fabrika.com");
  });

  it("kalıcı ret (bir daha sorulamaz) → istem açılmadan elle girişe dönülür", async () => {
    mockIzin = { granted: false, canAskAgain: false };
    sunucuEkrani();
    await act(async () => fireEvent.press(screen.getByTestId("sunucu-karekod")));
    expect(mockIste).not.toHaveBeenCalled();
    expect(screen.getByText(KAMERA_IZNI_YOK)).toBeTruthy();
  });

  it("web'de karekod düğmesi yok", () => {
    const once = Platform.OS;
    Object.defineProperty(Platform, "OS", { value: "web", configurable: true });
    try {
      sunucuEkrani();
      expect(screen.queryByTestId("sunucu-karekod")).toBeNull();
      expect(screen.getByTestId("sunucu-adres")).toBeTruthy();
    } finally {
      Object.defineProperty(Platform, "OS", { value: once, configurable: true });
    }
  });
});
