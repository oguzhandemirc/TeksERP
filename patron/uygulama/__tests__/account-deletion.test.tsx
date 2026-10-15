// Hesabımı sil ekranı: açıklama (ne olur) · parola + 6 haneli kod olmadan düğme kapalı · iki adımlı onay · başarıda
// silinme günü ve "Tamam" → yerel çıkış · ret (409 SON_YONETICI) iletisi gösterilir, çıkış yapılmaz · profil bağlantısı.
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { ApiError } from "../src/api/client";
import type { AccountDeletion } from "../src/api/wire";
import { DELETION_EFFECTS, DELETION_SUPPORT_EMAIL, deletionDoneText } from "../src/lib/account-deletion";

const deleteOwnAccount = jest.fn<Promise<AccountDeletion>, [{ parola: string; totp: string }]>();
const mockSession = {
  permissions: ["bulut:oturum"] as string[], facility: null as unknown, offline: false, offlineSince: null as string | null,
  facilities: [] as { id: string; ad: string; hizmet: string }[], facilityId: null as string | null, switchError: null as string | null,
  switchFacility: jest.fn(async (_id: string) => true),
  logout: jest.fn(async () => undefined),
  api: { deleteOwnAccount, changePassword: jest.fn() },
};
const mockRouter = { navigate: jest.fn(), push: jest.fn(), back: jest.fn(), canGoBack: () => false, replace: jest.fn() };
jest.mock("../src/state/session", () => ({ useSession: () => mockSession }));
jest.mock("expo-router", () => ({ useRouter: () => mockRouter, usePathname: () => "/profil" }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

const DeleteAccount = (require("../app/(app)/hesap-sil") as typeof import("../app/(app)/hesap-sil")).default;
const Profile = (require("../app/(app)/profil") as typeof import("../app/(app)/profil")).default;

const SONUC: AccountDeletion = { kapanis: "2026-10-15T09:00:00.000Z", silinme: "2026-11-14T09:00:00.000Z", tesisSayisi: 2 };

function doldurVeOnayla(): void {
  fireEvent.changeText(screen.getByTestId("hesap-sil-parola"), "gizli-parola-123");
  fireEvent.changeText(screen.getByTestId("hesap-sil-totp"), "12 34 56");
  fireEvent.press(screen.getByTestId("hesap-sil"));
  fireEvent.press(screen.getByTestId("hesap-sil-evet"));
}

beforeEach(() => {
  deleteOwnAccount.mockReset();
  mockSession.logout.mockClear();
  mockRouter.push.mockClear();
});

describe("hesabımı sil", () => {
  it("açıklama ne olacağını söyler: hemen kapanış, bütün fabrikalar, 30. gün, güvenlik kaydı, geri alma yolu", () => {
    render(<DeleteAccount />);
    for (const t of DELETION_EFFECTS) expect(screen.getByText(`• ${t}`)).toBeTruthy();
    const metin = DELETION_EFFECTS.join(" ");
    expect(metin).toContain("hemen kapanır");
    expect(metin).toContain("BÜTÜN fabrikalardaki");
    expect(metin).toContain("30. günde");
    expect(metin).toContain("Güvenlik kayıtları");
    expect(metin).toContain(DELETION_SUPPORT_EMAIL);
  });

  it("parola + 6 haneli kod girilmeden silme düğmesi çalışmaz", () => {
    render(<DeleteAccount />);
    fireEvent.press(screen.getByTestId("hesap-sil"));
    expect(screen.queryByTestId("hesap-sil-evet")).toBeNull();
    expect(deleteOwnAccount).not.toHaveBeenCalled();
  });

  it("onayda parola + kod gider; başarıda silinme günü gösterilir, Tamam yerel çıkış yapar", async () => {
    deleteOwnAccount.mockResolvedValue(SONUC);
    render(<DeleteAccount />);
    doldurVeOnayla();
    await waitFor(() => expect(screen.getByTestId("hesap-silindi")).toBeTruthy());
    expect(deleteOwnAccount).toHaveBeenCalledWith({ parola: "gizli-parola-123", totp: "123456" });
    expect(screen.getByText(deletionDoneText(SONUC))).toBeTruthy();
    expect(mockSession.logout).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId("hesap-silindi-tamam"));
    expect(mockSession.logout).toHaveBeenCalledTimes(1);
  });

  it("son yönetici reddi (409 SON_YONETICI): sunucu iletisi gösterilir, çıkış yapılmaz", async () => {
    const ileti = "Şu tesisin son aktif hesap yöneticisisiniz: Örnek. Hesabınızı silmeden önce o tesiste başka bir kişiyi hesap yöneticisi yapın.";
    deleteOwnAccount.mockRejectedValue(new ApiError(409, "SON_YONETICI", ileti, { code: "SON_YONETICI", tesisler: [{ id: "t", ad: "Örnek" }] }));
    render(<DeleteAccount />);
    doldurVeOnayla();
    await waitFor(() => expect(screen.getByTestId("hesap-sil-hata")).toBeTruthy());
    expect(screen.getByText(ileti)).toBeTruthy();
    expect(screen.queryByTestId("hesap-silindi")).toBeNull();
    expect(mockSession.logout).not.toHaveBeenCalled();
  });

  it("başarı iletisi: tek fabrikada 'Hesabınız', çok fabrikada sayı + tarih (gg.aa.yyyy)", () => {
    expect(deletionDoneText({ ...SONUC, tesisSayisi: 1 })).toMatch(/^Hesabınız kapatıldı\. Kişisel verileriniz \d{2}\.\d{2}\.\d{4} tarihinde silinecek\.$/);
    expect(deletionDoneText(SONUC)).toMatch(/^2 fabrikadaki hesabınız kapatıldı\./);
  });

  it("profilde 'Hesabımı sil' satırı silme ekranına gider", () => {
    render(<Profile />);
    fireEvent.press(screen.getByTestId("hesap-sil-git"));
    expect(mockRouter.push).toHaveBeenCalledWith("/hesap-sil");
  });
});
