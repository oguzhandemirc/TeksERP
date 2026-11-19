import { fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { ConfirmButton } from "../src/ui/kit";

const mockSession = {
  permissions: [] as string[], facility: null as unknown, offline: false, offlineSince: null as string | null,
  facilities: [] as { id: string; ad: string; hizmet: string }[], facilityId: null as string | null, switchError: null as string | null,
  switchFacility: jest.fn(async (_id: string) => true),
};
const mockRouter = { navigate: jest.fn(), push: jest.fn(), back: jest.fn(), canGoBack: () => false, replace: jest.fn(), canDismiss: jest.fn(() => true), dismissAll: jest.fn() };
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
    expect(screen.getByText("TeksERP Yönetim")).toBeTruthy(); // tesis adı yoksa nötr ad
  });
  it("tesis adı hesaptan gelir", () => {
    mockSession.facility = { tesis: { id: "t", ad: "Örnek Tekstil", saklamaAy: 13 }, hesap: { ad: "A" }, esitleme: null };
    mockSession.permissions = ["bulut:hesap:yonet"];
    render(<SideNav />);
    expect(screen.getByText("Örnek Tekstil")).toBeTruthy();
    expect(screen.getByTestId("menu-hesaplar")).toBeTruthy();
    mockSession.facility = null;
  });
  it("ray sırası sekmelerle aynı; İş ve Hesap grupları ardından gelir", () => {
    mockSession.permissions = ["bulut:siparis:oku", "bulut:uretim:oku", "bulut:kasa:oku", "bulut:cari:oku", "bulut:stok:oku", "bulut:siparis:yaz", "bulut:hesap:yonet"];
    render(<SideNav />);
    const order = screen.getAllByTestId(/^menu-/).map((n) => String(n.props.testID).slice(5));
    expect(order).toEqual(["pano", "uretim", "siparisler", "finans", "is-emirleri", "cariler", "stok", "gelen-kutusu", "bildirimler", "hesaplar", "profil"]);
    expect(screen.getByText("İş")).toBeTruthy();
    expect(screen.getByText("Hesap")).toBeTruthy();
  });
  it("rol rozeti: hesap yönetimi izni Yönetici, diğerleri Çalışan", () => {
    mockSession.permissions = ["bulut:hesap:yonet"];
    const a = render(<SideNav />);
    expect(screen.getByTestId("rol-rozeti").props.accessibilityLabel).toBe("Rol: Yönetici");
    a.unmount();
    mockSession.permissions = ["bulut:siparis:oku"];
    render(<SideNav />);
    expect(screen.getByTestId("rol-rozeti").props.accessibilityLabel).toBe("Rol: Çalışan");
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

describe("ray: daralt/genişlet, yanal gezinme, ERP rolü", () => {
  it("düğme rayı daraltır (yalnız ikon, erişilebilir ad korunur) ve geri açar", () => {
    mockSession.permissions = ["bulut:siparis:oku"];
    render(<SideNav />);
    expect(screen.getByText("Siparişler")).toBeTruthy();
    fireEvent.press(screen.getByTestId("ray-dugme"));
    expect(screen.queryByText("Siparişler")).toBeNull();
    expect(screen.getByTestId("menu-siparisler").props.accessibilityLabel).toBe("Siparişler");
    expect(screen.queryByTestId("rol-rozeti")).toBeNull();
    fireEvent.press(screen.getByTestId("ray-dugme"));
    expect(screen.getByText("Siparişler")).toBeTruthy();
  });
  it("rol rozet değil sade metin; daralt düğmesi açıkken başlık satırının sağında, dar rayda 'genişlet'", () => {
    mockSession.permissions = ["bulut:hesap:yonet"];
    render(<SideNav />);
    const rol = screen.getByTestId("rol-rozeti");
    expect(rol.type).toBe("Text");
    expect(rol.props.children).toBe("Yönetici");
    expect(screen.getByTestId("ray-dugme").props.accessibilityLabel).toBe("Menüyü daralt");
    fireEvent.press(screen.getByTestId("ray-dugme"));
    expect(screen.getByTestId("ray-dugme").props.accessibilityLabel).toBe("Menüyü genişlet");
    fireEvent.press(screen.getByTestId("ray-dugme"));
  });
  it("ray genişliği açık/dar hedefe geçer (Reanimated; taşan içerik kırpılır)", () => {
    const { RAIL_WIDTH, RAIL_COLLAPSED } = require("../src/ui/tokens") as typeof import("../src/ui/tokens");
    mockSession.permissions = ["bulut:siparis:oku"];
    render(<SideNav />);
    const genislik = () => (require("react-native") as typeof import("react-native")).StyleSheet.flatten(screen.getByTestId("ray").props.style) as { width?: number; overflow?: string };
    expect(genislik()).toEqual(expect.objectContaining({ width: RAIL_WIDTH, overflow: "hidden" }));
    fireEvent.press(screen.getByTestId("ray-dugme"));
    expect(genislik().width).toBe(RAIL_COLLAPSED);
    fireEvent.press(screen.getByTestId("ray-dugme"));
  });
  it("içerik kayması hiçbir karede pozitif değil: genişlerken ray kenarına yapışık, daralırken yerinde", () => {
    const { railContentShift } = require("../src/ui/Frame") as typeof import("../src/ui/Frame");
    const { RAIL_WIDTH, RAIL_COLLAPSED } = require("../src/ui/tokens") as typeof import("../src/ui/tokens");
    // Genişletme: yuva hemen geniş; panel dar → geniş giderken içerik panel kenarıyla birlikte kayar.
    expect(railContentShift(RAIL_COLLAPSED, RAIL_WIDTH)).toBe(RAIL_COLLAPSED - RAIL_WIDTH);
    expect(railContentShift(150, RAIL_WIDTH)).toBe(150 - RAIL_WIDTH);
    expect(railContentShift(RAIL_WIDTH, RAIL_WIDTH)).toBe(0);
    // Daraltma: yuva hemen dar; panel içeriğin üstünden çekilir, içerik sağa itilmez (taşma yok).
    for (const panel of [RAIL_WIDTH, 150, RAIL_COLLAPSED]) expect(railContentShift(panel, RAIL_COLLAPSED)).toBe(0);
  });
  it("çerçevede ray yuvası hedef genişliğe tek seferde geçer; panel ve içerik aynı değerden okur", () => {
    const { RailFrame } = require("../src/ui/Frame") as typeof import("../src/ui/Frame");
    const { RAIL_WIDTH, RAIL_COLLAPSED } = require("../src/ui/tokens") as typeof import("../src/ui/tokens");
    const { StyleSheet } = require("react-native") as typeof import("react-native");
    mockSession.permissions = ["bulut:siparis:oku"];
    render(<RailFrame><Text>ICERIK</Text></RailFrame>);
    const stil = (id: string) => StyleSheet.flatten(screen.getByTestId(id).props.style) as { width?: number; position?: string; transform?: { translateX: number }[] };
    expect(stil("ray-yuvasi").width).toBe(RAIL_WIDTH);
    expect(stil("ray").position).toBe("absolute");
    expect(stil("ray-icerik").transform?.[0]?.translateX ?? 0).toBe(0);
    fireEvent.press(screen.getByTestId("ray-dugme"));
    expect(stil("ray-yuvasi").width).toBe(RAIL_COLLAPSED);
    expect(stil("ray-icerik").transform?.[0]?.translateX ?? 0).toBeLessThanOrEqual(0);
    fireEvent.press(screen.getByTestId("ray-dugme"));
    expect(stil("ray-yuvasi").width).toBe(RAIL_WIDTH);
    expect(screen.getByText("ICERIK")).toBeTruthy();
  });
  it("dar ekranda çerçeve ray çizmez, içerik yine aynı kapta", () => {
    const { RailFrame } = require("../src/ui/Frame") as typeof import("../src/ui/Frame");
    render(<RailFrame rail={false}><Text>ICERIK</Text></RailFrame>);
    expect(screen.queryByTestId("ray")).toBeNull();
    expect(screen.getByTestId("ray-icerik")).toBeTruthy();
  });
  it("raydan geçiş yığını köke indirir ve tek ekran açar; açık bölüme dokunmak bir şey yapmaz", () => {
    mockSession.permissions = ["bulut:siparis:oku"];
    mockRouter.navigate.mockClear();
    mockRouter.dismissAll.mockClear();
    render(<SideNav />);
    fireEvent.press(screen.getByTestId("menu-siparisler"));
    expect(mockRouter.dismissAll).toHaveBeenCalledTimes(1);
    expect(mockRouter.navigate).toHaveBeenCalledWith("/siparisler");
    fireEvent.press(screen.getByTestId("menu-pano")); // usePathname = /pano
    expect(mockRouter.navigate).toHaveBeenCalledTimes(1);
  });
  it("ERP kipinde rol fabrikanın kullanıcı yönetimi izninden okunur", () => {
    const { setYetenek, erpYetenek, BULUT_YETENEK } = require("../src/api/yetenek") as typeof import("../src/api/yetenek");
    const { roleOf } = require("../src/ui/RoleBadge") as typeof import("../src/ui/RoleBadge");
    setYetenek(erpYetenek([], ["*"]));
    expect(roleOf([])).toBe("yonetici");
    setYetenek(erpYetenek([], ["order:read"]));
    expect(roleOf([])).toBe("ekip");
    setYetenek(BULUT_YETENEK);
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
    expect(screen.getByText("Etkin")).toBeTruthy();
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

describe("form kartı (D5): geniş ekranda form tam sayfa değil, karartılmış listenin üstünde kart", () => {
  const RN = require("react-native") as typeof import("react-native");
  const size = (width: number) => jest.spyOn(RN, "useWindowDimensions").mockReturnValue({ width, height: 1280, scale: 2, fontScale: 1 });
  afterEach(() => jest.restoreAllMocks());
  it("geniş: kart + başlık + Kapat geri gider; büyük başlık yok", () => {
    size(800);
    mockRouter.back.mockClear();
    const goBack = jest.spyOn(mockRouter, "canGoBack").mockReturnValue(true);
    render(<Screen sheet title="Yeni cari"><Text>FORM</Text></Screen>);
    expect(screen.getByTestId("form-karti")).toBeTruthy();
    expect(screen.getByText("FORM")).toBeTruthy();
    expect(screen.getAllByText("Yeni cari")).toHaveLength(1);
    fireEvent.press(screen.getByTestId("form-kapat"));
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
    goBack.mockRestore();
  });
  it("geniş: eylem düğmesi büyük başlıkla AYNI satır kapsayıcısında; boş üst bar satırı yok", () => {
    size(1280);
    render(<Screen title="Cariler" titleRight={<Text testID="esitleme">E</Text>} headerRight={<Text testID="yeni-cari">Yeni cari</Text>}><Text>LISTE</Text></Screen>);
    const satir = screen.getByTestId("baslik-satiri");
    expect(within(satir).getByText("Cariler")).toBeTruthy();
    expect(within(satir).getByTestId("yeni-cari")).toBeTruthy();
    expect(within(satir).getByTestId("esitleme")).toBeTruthy();
    expect(screen.getAllByTestId("yeni-cari")).toHaveLength(1);
    expect(screen.getByTestId("ust-bar-satirsiz")).toBeTruthy();
  });
  it("dar: eylem üst barda kalır (kaydırınca görünür), başlık satırında değil", () => {
    size(400);
    render(<Screen title="Cariler" headerRight={<Text testID="yeni-cari">Yeni cari</Text>}><Text>LISTE</Text></Screen>);
    expect(within(screen.getByTestId("baslik-satiri")).queryByTestId("yeni-cari")).toBeNull();
    expect(screen.getAllByTestId("yeni-cari")).toHaveLength(1);
    expect(screen.queryByTestId("ust-bar-satirsiz")).toBeNull();
  });
  it("dar: bugünkü tam sayfa (kart yok)", () => {
    size(400);
    render(<Screen sheet title="Yeni cari"><Text>FORM</Text></Screen>);
    expect(screen.queryByTestId("form-karti")).toBeNull();
    expect(screen.getByText("FORM")).toBeTruthy();
  });
});
