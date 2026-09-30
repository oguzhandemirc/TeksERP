import { act, fireEvent, render, screen } from "@testing-library/react-native";

const OTPAUTH = "otpauth://totp/TeksERP%20Patron:a%40ornek.invalid?secret=JBSWY3DPEHPK3PXP&issuer=TeksERP%20Patron&algorithm=SHA1&digits=6&period=30";
const mockApi = {
  inviteInspect: jest.fn(async () => ({ ad: "Ayşe", eposta: "a@ornek.invalid", tesisAd: "Tesis", bitis: "2026-10-01T00:00:00.000Z" })),
  inviteAccept: jest.fn(async () => ({ eposta: "a@ornek.invalid", totpSirri: "JBSWY3DPEHPK3PXP", otpauth: OTPAUTH })),
  inviteConfirm: jest.fn(),
};
jest.mock("../src/state/session", () => ({ useSession: () => ({ api: mockApi }) }));
jest.mock("expo-router", () => ({ useRouter: () => ({ replace: jest.fn() }), useLocalSearchParams: () => ({ davet: "davet-kodu" }) }));

// mock'lar kurulduktan SONRA yüklenir.
const Invite = (require("../app/davet") as { default: () => React.JSX.Element }).default;
const { TotpQr } = require("../src/ui/TotpQr") as typeof import("../src/ui/TotpQr");
const { TextInput } = require("react-native") as typeof import("react-native");

describe("TOTP kurulumu", () => {
  it("⭐ davet onayında karekod VE elle girilecek anahtar birlikte görünür", async () => {
    render(<Invite />);
    await act(async () => fireEvent.press(screen.getByText("Devam")));
    const alanlar = screen.UNSAFE_getAllByType(TextInput).filter((x) => x.props.secureTextEntry);
    fireEvent.changeText(alanlar[0]!, "cok-guclu-parola-1");
    fireEvent.changeText(alanlar[1]!, "cok-guclu-parola-1");
    await act(async () => fireEvent.press(screen.getByText("Devam")));
    expect(screen.getByTestId("totp-karekod")).toBeTruthy();
    expect(screen.getByTestId("totp-sirri").props.children).toBe("JBSW Y3DP EHPK 3PXP");
  });

  it("karekod otpauth bağlantısını taşır; otpauth olmayan değer çizilmez", () => {
    const { UNSAFE_getByProps, unmount } = render(<TotpQr value={OTPAUTH} />);
    expect(UNSAFE_getByProps({ value: OTPAUTH, ecl: "M" })).toBeTruthy();
    unmount();
    render(<TotpQr value="https://kotu.invalid" />);
    expect(screen.queryByTestId("totp-karekod")).toBeNull();
  });
});
