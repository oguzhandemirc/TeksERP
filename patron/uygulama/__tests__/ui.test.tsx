import { fireEvent, render, screen } from "@testing-library/react-native";
import { ConfirmButton } from "../src/ui/kit";

const session = { permissions: [] as string[], facility: null as unknown, offline: false, offlineSince: null as string | null };
jest.mock("../src/state/session", () => ({ useSession: () => session }));
jest.mock("expo-router", () => ({ useRouter: () => ({ navigate: jest.fn(), push: jest.fn(), back: jest.fn(), canGoBack: () => false, replace: jest.fn() }), usePathname: () => "/pano" }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

// mock'lar kurulduktan SONRA yüklenir.
const { SideNav, Screen } = require("../src/ui/Frame") as typeof import("../src/ui/Frame");
const { Text } = require("react-native") as typeof import("react-native");

describe("izinli menü", () => {
  it("izni olmayan bölüm menüde görünmez", () => {
    session.permissions = ["bulut:oturum", "bulut:siparis:oku"];
    render(<SideNav />);
    expect(screen.getByTestId("menu-siparisler")).toBeTruthy();
    expect(screen.queryByTestId("menu-finans")).toBeNull();
    expect(screen.queryByTestId("menu-hesaplar")).toBeNull();
    expect(screen.getByText("TeksERP Patron")).toBeTruthy(); // tesis adı yoksa nötr ad
  });
  it("tesis adı hesaptan gelir", () => {
    session.facility = { tesis: { id: "t", ad: "Örnek Tekstil", saklamaAy: 13 }, hesap: { ad: "A" }, esitleme: null };
    session.permissions = ["bulut:hesap:yonet"];
    render(<SideNav />);
    expect(screen.getByText("Örnek Tekstil")).toBeTruthy();
    expect(screen.getByTestId("menu-hesaplar")).toBeTruthy();
    session.facility = null;
  });
  it("izinsiz ekran içerik yerine uyarı gösterir; çevrimdışı bandı çıkar", () => {
    session.permissions = ["bulut:oturum"];
    session.offline = true;
    session.offlineSince = new Date().toISOString();
    render(<Screen title="Finans" module="finans"><Text>GIZLI</Text></Screen>);
    expect(screen.queryByText("GIZLI")).toBeNull();
    expect(screen.getByText("Bu bölümü görme yetkiniz yok")).toBeTruthy();
    expect(screen.getByTestId("bant-cevrimdisi")).toBeTruthy();
    session.offline = false;
  });
});

describe("hizmet sonu bandı (Ek-6/A §4.2)", () => {
  it("SALT_OKUNUR: salt okuma bandı çıkar, eşitleme gecikme bandı susar", () => {
    session.permissions = ["bulut:oturum"];
    session.facility = {
      tesis: { id: "t", ad: "Örnek", saklamaAy: 13 },
      hesap: { ad: "A" },
      esitleme: { sonEsitleme: "2026-01-01T00:00:00Z", ufuk: "2026-01-01T00:00:00Z", ufukTakildi: false, sozlesmeUyarisi: null, fabrikaSurumu: null },
      hizmet: { asama: "SALT_OKUNUR", bitis: "2026-10-01T00:00:00Z", saltOkunurBitis: "2026-12-30T00:00:00Z" },
    };
    render(<Screen title="Pano"><Text>İÇERİK</Text></Screen>);
    expect(screen.getByTestId("bant-salt-okunur")).toBeTruthy();
    expect(screen.queryByTestId("bant-gecikme")).toBeNull();
    expect(screen.getByText("İÇERİK")).toBeTruthy();
    session.facility = null;
  });
  it("ACIK (ya da eski sunucu, alan yok): bant YOK", () => {
    session.facility = { tesis: { id: "t", ad: "Örnek", saklamaAy: 13 }, hesap: { ad: "A" }, esitleme: null, hizmet: { asama: "ACIK", bitis: null, saltOkunurBitis: null } };
    render(<Screen title="Pano"><Text>X</Text></Screen>);
    expect(screen.queryByTestId("bant-salt-okunur")).toBeNull();
    session.facility = { tesis: { id: "t", ad: "Örnek", saklamaAy: 13 }, hesap: { ad: "A" }, esitleme: null };
    render(<Screen title="Pano"><Text>Y</Text></Screen>);
    expect(screen.queryByTestId("bant-salt-okunur")).toBeNull();
    session.facility = null;
  });
});

describe("yıkıcı işlem onayı", () => {
  it("ilk dokunuş sorar, ikinci uygular; vazgeç uygulamaz", () => {
    const fn = jest.fn();
    render(<ConfirmButton label="İptal et" question="Emin misiniz?" onConfirm={fn} testID="x" />);
    fireEvent.press(screen.getByTestId("x"));
    expect(fn).not.toHaveBeenCalled();
    fireEvent.press(screen.getByText("Vazgeç"));
    fireEvent.press(screen.getByTestId("x"));
    fireEvent.press(screen.getByTestId("x-evet"));
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
