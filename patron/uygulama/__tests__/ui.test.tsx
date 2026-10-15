import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { ConfirmButton } from "../src/ui/kit";

const mockSession = {
  permissions: [] as string[], facility: null as unknown, offline: false, offlineSince: null as string | null,
  facilities: [] as { id: string; ad: string; hizmet: string }[], facilityId: null as string | null, switchError: null as string | null,
  switchFacility: jest.fn(async (_id: string) => true),
};
const mockRouter = { navigate: jest.fn(), push: jest.fn(), back: jest.fn(), canGoBack: () => false, replace: jest.fn() };
jest.mock("../src/state/session", () => ({ useSession: () => mockSession }));
jest.mock("expo-router", () => ({ useRouter: () => mockRouter, usePathname: () => "/pano" }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

// mock'lar kurulduktan SONRA yüklenir.
const { FacilityName, SideNav, Screen } = require("../src/ui/Frame") as typeof import("../src/ui/Frame");
const { FacilitySwitchButton } = require("../src/ui/FacilitySwitcher") as typeof import("../src/ui/FacilitySwitcher");
const { Text } = require("react-native") as typeof import("react-native");

describe("izinli menü", () => {
  it("izni olmayan bölüm menüde görünmez", () => {
    mockSession.permissions = ["bulut:oturum", "bulut:siparis:oku"];
    render(<SideNav />);
    expect(screen.getByTestId("menu-siparisler")).toBeTruthy();
    expect(screen.queryByTestId("menu-finans")).toBeNull();
    expect(screen.queryByTestId("menu-hesaplar")).toBeNull();
    expect(screen.getByText("TeksERP Patron")).toBeTruthy(); // tesis adı yoksa nötr ad
  });
  it("tesis adı hesaptan gelir", () => {
    mockSession.facility = { tesis: { id: "t", ad: "Örnek Tekstil", saklamaAy: 13 }, hesap: { ad: "A" }, esitleme: null };
    mockSession.permissions = ["bulut:hesap:yonet"];
    render(<SideNav />);
    expect(screen.getByText("Örnek Tekstil")).toBeTruthy();
    expect(screen.getByTestId("menu-hesaplar")).toBeTruthy();
    mockSession.facility = null;
  });
  it("izinsiz ekran içerik yerine uyarı gösterir; çevrimdışı bandı çıkar", () => {
    mockSession.permissions = ["bulut:oturum"];
    mockSession.offline = true;
    mockSession.offlineSince = new Date().toISOString();
    render(<Screen title="Finans" module="finans"><Text>GIZLI</Text></Screen>);
    expect(screen.queryByText("GIZLI")).toBeNull();
    expect(screen.getByText("Bu bölümü görme yetkiniz yok")).toBeTruthy();
    expect(screen.getByTestId("bant-cevrimdisi")).toBeTruthy();
    mockSession.offline = false;
  });
});

describe("hizmet sonu bandı (Ek-6/A §4.2)", () => {
  it("SALT_OKUNUR: salt okuma bandı çıkar, eşitleme gecikme bandı susar", () => {
    mockSession.permissions = ["bulut:oturum"];
    mockSession.facility = {
      tesis: { id: "t", ad: "Örnek", saklamaAy: 13 },
      hesap: { ad: "A" },
      esitleme: { sonEsitleme: "2026-01-01T00:00:00Z", ufuk: "2026-01-01T00:00:00Z", ufukTakildi: false, sozlesmeUyarisi: null, fabrikaSurumu: null },
      hizmet: { asama: "SALT_OKUNUR", bitis: "2026-10-01T00:00:00Z", saltOkunurBitis: "2026-12-30T00:00:00Z" },
    };
    render(<Screen title="Pano"><Text>İÇERİK</Text></Screen>);
    expect(screen.getByTestId("bant-salt-okunur")).toBeTruthy();
    expect(screen.queryByTestId("bant-gecikme")).toBeNull();
    expect(screen.getByText("İÇERİK")).toBeTruthy();
    mockSession.facility = null;
  });
  it("ACIK (ya da eski sunucu, alan yok): bant YOK", () => {
    mockSession.facility = { tesis: { id: "t", ad: "Örnek", saklamaAy: 13 }, hesap: { ad: "A" }, esitleme: null, hizmet: { asama: "ACIK", bitis: null, saltOkunurBitis: null } };
    render(<Screen title="Pano"><Text>X</Text></Screen>);
    expect(screen.queryByTestId("bant-salt-okunur")).toBeNull();
    mockSession.facility = { tesis: { id: "t", ad: "Örnek", saklamaAy: 13 }, hesap: { ad: "A" }, esitleme: null };
    render(<Screen title="Pano"><Text>Y</Text></Screen>);
    expect(screen.queryByTestId("bant-salt-okunur")).toBeNull();
    mockSession.facility = null;
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

describe("fabrika değiştir (çok tesis)", () => {
  const facility = { tesis: { id: "t1", ad: "Bir Tekstil", saklamaAy: 13 }, hesap: { ad: "A" }, esitleme: null };
  afterEach(() => {
    mockSession.facility = null;
    mockSession.facilities = [];
    mockSession.facilityId = null;
    mockSession.switchError = null;
  });
  it("tek tesiste seçici yok: ad düz metin, profil satırı yok", () => {
    mockSession.facility = facility;
    mockSession.facilityId = "t1";
    mockSession.facilities = [{ id: "t1", ad: "Bir Tekstil", hizmet: "ACIK" }];
    render(<><FacilityName /><FacilitySwitchButton /></>);
    expect(screen.getByText("Bir Tekstil")).toBeTruthy();
    expect(screen.queryByTestId("tesis-secici")).toBeNull();
    expect(screen.queryByTestId("fabrika-degistir")).toBeNull();
  });
  it("çok tesiste dokunuş DOĞRUDAN modal açar: etkin işaretli, salt okunur rozetli; seçim geçer ve panoya döner", async () => {
    mockSession.facility = facility;
    mockSession.facilityId = "t1";
    mockSession.facilities = [{ id: "t1", ad: "Bir Tekstil", hizmet: "ACIK" }, { id: "t2", ad: "İki Dokuma", hizmet: "SALT_OKUNUR" }];
    render(<FacilityName />);
    expect(screen.queryByTestId("tesis-modal")).toBeNull();
    fireEvent.press(screen.getByTestId("tesis-secici"));
    expect(screen.getByTestId("tesis-modal")).toBeTruthy();
    expect(screen.getByText("✓ Etkin")).toBeTruthy();
    expect(screen.getByTestId("tesis-rozet-t2")).toBeTruthy();
    expect(screen.queryByTestId("tesis-rozet-t1")).toBeNull();
    fireEvent.press(screen.getByTestId("tesis-t2"));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith("/pano"));
    expect(mockSession.switchFacility).toHaveBeenCalledWith("t2");
  });
  it("profilde çok tesiste 'Fabrika değiştir' satırı modal açar; geçiş hatası gösterilir", () => {
    mockSession.facilities = [{ id: "t1", ad: "Bir", hizmet: "ACIK" }, { id: "t2", ad: "İki", hizmet: "ACIK" }];
    mockSession.facilityId = "t1";
    mockSession.switchError = "Bu fabrikaya geçiş yetkiniz yok; fabrika listesi yenilendi.";
    render(<FacilitySwitchButton />);
    fireEvent.press(screen.getByTestId("fabrika-degistir"));
    expect(screen.getByTestId("tesis-modal")).toBeTruthy();
    expect(screen.getByTestId("tesis-gecis-hatasi")).toBeTruthy();
  });
});
