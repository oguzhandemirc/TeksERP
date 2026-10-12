import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { AxiosError, AxiosHeaders } from "axios";
import { renderWithProviders } from "@/test/render";
import { licenseService } from "@/services/licenseService";
import { TempCodeCard } from "./TempCodeCard";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/services/licenseService", () => ({
  licenseService: { tempRequest: vi.fn(), renewTempRequest: vi.fn(), submitTempCode: vi.fn() },
}));

const ISTEK = "TI-ABCD-EFGH-JKMN-PQRS-TVWX-YZ01";
const BODY = "0123456789ABCDEFGHJKMNPQRSTVWXYZ".repeat(4).slice(0, 115);
const GROUPED = `TG-${BODY.match(/.{5}/g)!.join("-")}`;
const kutu = (n: number) => screen.getByLabelText(`Grup ${n}`) as HTMLInputElement;
const gonder = () => screen.getByRole("button", { name: "Kodu gir" });

function ret(message: string, details: Record<string, unknown>): AxiosError {
  const headers = new AxiosHeaders();
  return new AxiosError("400", "ERR_BAD_REQUEST", { headers }, null, {
    status: 400,
    statusText: "Bad Request",
    headers: {},
    config: { headers },
    data: { success: false, message, details: { code: "TEMP_CODE_INVALID", ...details } },
  });
}

describe("TempCodeCard — yazarak etkinleştirme", () => {
  beforeEach(() => {
    vi.mocked(licenseService.tempRequest).mockResolvedValue({ istekKodu: ISTEK, olusturuldu: "2026-10-12T10:00:00Z", gecici: null });
    vi.mocked(licenseService.submitTempCode).mockReset();
  });

  it("istek kodu büyük puntoyla çizilir; 23 kutu boş, gönder kapalı", async () => {
    renderWithProviders(<TempCodeCard />);
    expect(await screen.findByTestId("gecici-istek-kodu")).toHaveTextContent(ISTEK);
    expect(screen.getAllByLabelText(/^Grup \d+$/)).toHaveLength(23);
    expect(gonder()).toBeDisabled();
  });

  it("tam kodu yapıştırmak 23 kutuya bölüştürür (küçük harf, O/I karışıklığı düzelir) ve gönderilen kod gruplu biçimdir", async () => {
    vi.mocked(licenseService.submitTempCode).mockResolvedValue({ istekKodu: "TI-YENI", olusturuldu: "x", gecici: { bitis: "2026-11-11T23:59:59.999Z", kalanGun: 30, kodSonu: "WXYZ" } });
    renderWithProviders(<TempCodeCard />);
    await screen.findByTestId("gecici-istek-kodu");
    const yapistirilan = GROUPED.toLowerCase().replace(/0/g, "o").replace(/1/g, "l");
    fireEvent.paste(kutu(7), { clipboardData: { getData: () => yapistirilan } });
    expect(kutu(1).value).toBe(BODY.slice(0, 5));
    expect(kutu(23).value).toBe(BODY.slice(110, 115));
    expect(gonder()).toBeEnabled();
    fireEvent.click(gonder());
    await waitFor(() => expect(licenseService.submitTempCode).toHaveBeenCalledWith(GROUPED));
  });

  it("dolan kutu sonrakine taşar; geçersiz karakter kutusu kırmızı, gönder kapalı", async () => {
    renderWithProviders(<TempCodeCard />);
    await screen.findByTestId("gecici-istek-kodu");
    fireEvent.change(kutu(1), { target: { value: "abcdef" } });
    expect(kutu(1).value).toBe("ABCDE");
    expect(kutu(2).value).toBe("F");
    fireEvent.change(kutu(3), { target: { value: "AUB" } });
    expect(kutu(3)).toHaveAttribute("aria-invalid", "true");
    expect(kutu(2)).not.toHaveAttribute("aria-invalid");
    expect(screen.getByTestId("gecici-kod-hata")).toHaveTextContent("3. grupta geçersiz karakter: “U”");
    expect(gonder()).toBeDisabled();
  });

  it("backend reddi: cümlesi yazılır, `konum`un kutusu kırmızı", async () => {
    vi.mocked(licenseService.submitTempCode).mockRejectedValue(
      ret("Kod yanlış yazılmış (sağlama tutmuyor); grupları yeniden kontrol edin.", { neden: "SAGLAMA" }),
    );
    renderWithProviders(<TempCodeCard />);
    await screen.findByTestId("gecici-istek-kodu");
    fireEvent.paste(kutu(1), { clipboardData: { getData: () => GROUPED } });
    fireEvent.click(gonder());
    expect(await screen.findByText(/sağlama tutmuyor/)).toBeInTheDocument();

    vi.mocked(licenseService.submitTempCode).mockRejectedValue(ret("Kodda geçersiz bir karakter var. (12. grup, 3. karakter)", { neden: "KARAKTER", konum: 57 }));
    fireEvent.click(gonder());
    await waitFor(() => expect(kutu(12)).toHaveAttribute("aria-invalid", "true"));
    expect(screen.getByTestId("gecici-kod-hata")).toHaveTextContent("12. grup, 3. karakter");
  });

  it("geçici etkinken kalan gün ve bitiş özeti görünür", async () => {
    vi.mocked(licenseService.tempRequest).mockResolvedValue({ istekKodu: ISTEK, olusturuldu: "x", gecici: { bitis: "2026-11-11T12:00:00Z", kalanGun: 30, kodSonu: "WXYZ" } });
    renderWithProviders(<TempCodeCard />);
    expect(await screen.findByTestId("gecici-etkin-ozet")).toHaveTextContent("30 gün, kod …WXYZ");
  });
});
