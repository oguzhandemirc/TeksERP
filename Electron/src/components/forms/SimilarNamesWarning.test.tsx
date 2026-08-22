import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { SimilarNamesWarning } from "./SimilarNamesWarning";

const get = vi.fn();
vi.mock("@/services/apiClient", () => ({ default: { get: (...a: unknown[]) => get(...a) } }));

const row = (over: Partial<Record<string, unknown>> = {}) => ({
  id: "1",
  name: "MODA TEKSTİL",
  code: "MUS001",
  isActive: true,
  score: 0.76,
  ...over,
});

describe("benzer kayıt uyarısı", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    get.mockReset();
    get.mockResolvedValue({ data: { data: [row()] } });
  });
  afterEach(() => vi.useRealTimers());

  it("3 harften kısa terimde SUNUCUYA HİÇ SORMAZ", () => {
    render(<SimilarNamesWarning entity="customers" name="ab" />);
    vi.advanceTimersByTime(2000);
    expect(get).not.toHaveBeenCalled();
  });

  it("yazma bitince tek istek atar (her tuşta değil)", async () => {
    const { rerender } = render(<SimilarNamesWarning entity="customers" name="mod" />);
    rerender(<SimilarNamesWarning entity="customers" name="moda" />);
    rerender(<SimilarNamesWarning entity="customers" name="moda t" />);
    vi.advanceTimersByTime(400);
    await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    // URLSearchParams boşluğu "+" ile kodlar (%20 değil) — sunucu ikisini de çözer.
    expect(String(get.mock.calls[0]?.[0])).toContain("name=moda+t");
  });

  it("benzer kayıtları listeler", async () => {
    render(<SimilarNamesWarning entity="customers" name="moda tekstil" />);
    vi.advanceTimersByTime(400);
    await vi.waitFor(() => expect(screen.getByText("MODA TEKSTİL")).toBeTruthy());
    expect(screen.getByText(/Benzer kayıtlar var/)).toBeTruthy();
  });

  it("BİREBİR aynı ad ayrı başlıkla vurgulanır", async () => {
    get.mockResolvedValue({ data: { data: [row({ score: 1 })] } });
    render(<SimilarNamesWarning entity="customers" name="moda tekstil" />);
    vi.advanceTimersByTime(400);
    await vi.waitFor(() => expect(screen.getByText(/Bu ad zaten kayıtlı/)).toBeTruthy());
  });

  it("SONUÇ YOKSA hiçbir şey çizmez (form kalabalıklaşmasın)", async () => {
    get.mockResolvedValue({ data: { data: [] } });
    const { container } = render(<SimilarNamesWarning entity="customers" name="zzqxw" />);
    vi.advanceTimersByTime(400);
    await vi.waitFor(() => expect(get).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });

  it("UÇ PATLASA BİLE form çalışmaya devam eder (sessiz yut)", async () => {
    // Uç 403/404 dönebilir (izin yok, eski backend). Kullanıcıyı yazamaz hâle
    // getirmek, önlemeye çalıştığımız sorundan büyük zarar olurdu.
    get.mockRejectedValue(new Error("403"));
    const { container } = render(<SimilarNamesWarning entity="customers" name="moda" />);
    vi.advanceTimersByTime(400);
    await vi.waitFor(() => expect(get).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });

  it("⭐ BİRLEŞTİRİLMİŞ ad 'şunun altına birleşti' diye işaretlenir", async () => {
    // En değerli satır bu: az önce temizlenen mükerreri yeniden yazmak onu
    // DİRİLTİR. Etiket olmadan satır canlı bir kayıt gibi okunur — canlı veride
    // "OSLO" araması hem canlı kaydı hem tombstone'u AYNI görünümde döndürüyordu.
    get.mockResolvedValue({
      data: { data: [row({ name: "OSLO", isActive: false, mergedIntoName: "OSLO ANA" })] },
    });
    render(<SimilarNamesWarning entity="items" name="oslo" />);
    vi.advanceTimersByTime(400);
    await vi.waitFor(() => expect(screen.getByText(/altına birleştirilmiş/)).toBeTruthy());
    expect(screen.getByText(/OSLO ANA/)).toBeTruthy();
    // Tombstone satırında "(pasif)" YAZILMAZ — iki ayrı şey söylemek gürültüdür.
    expect(screen.queryByText("(pasif)")).toBeNull();
  });

  it("başlık KAÇ benzer kayıt olduğunu söyler", async () => {
    get.mockResolvedValue({
      data: { data: [row(), row({ id: "2", name: "Moda Tekstil", score: 0.8 })] },
    });
    render(<SimilarNamesWarning entity="customers" name="moda" />);
    vi.advanceTimersByTime(400);
    await vi.waitFor(() => expect(screen.getByText(/Benzer kayıtlar var \(2\)/)).toBeTruthy());
  });

  it("⭐ birebir eşleşmede 'kaydedilemez' DENİR (sunucu 409 verecek)", async () => {
    // Sarı "dikkat et", kırmızı "bu hâliyle kaydedilemez" demek. Birebir adda
    // yumuşak dil kullanmak, kullanıcıyı boş yere forma devam ettirir.
    get.mockResolvedValue({ data: { data: [row({ score: 1 })] } });
    render(<SimilarNamesWarning entity="customers" name="moda tekstil" />);
    vi.advanceTimersByTime(400);
    await vi.waitFor(() => expect(screen.getByText(/kaydedilemez/)).toBeTruthy());
    expect(screen.getByText(/Farklı bir ad yazın/)).toBeTruthy();
  });

  it("düzenlemede kaydın kendisi elenir (excludeId gider)", async () => {
    render(<SimilarNamesWarning entity="customers" name="moda tekstil" excludeId="abc" />);
    vi.advanceTimersByTime(400);
    await vi.waitFor(() => expect(get).toHaveBeenCalled());
    expect(String(get.mock.calls[0]?.[0])).toContain("excludeId=abc");
  });
});
