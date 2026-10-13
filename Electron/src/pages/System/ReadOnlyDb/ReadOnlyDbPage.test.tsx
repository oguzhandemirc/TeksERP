import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import type { ReadOnlyDbStatus } from "./service";

vi.mock("./service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./service")>()),
  useReadOnlyDb: vi.fn(),
  useRotateReadOnlyDbPassword: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/clipboard", () => ({ copyText: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/components/layout/PageHeader", () => ({
  PageHeader: ({ title, actions }: { title: string; actions?: ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {actions}
    </div>
  ),
}));

const svc = await import("./service");
const { ReadOnlyDbPage } = await import("./ReadOnlyDbPage");

function status(over: Partial<ReadOnlyDbStatus> = {}): ReadOnlyDbStatus {
  return {
    state: "HAZIR", role: "tekserp_okuma", database: "tekserp", host: "postgres", port: 5432, container: true,
    passwordRotatedAt: null, activeConnections: 2, connectionLimit: 5,
    hiddenTables: ["system_settings"], hiddenColumns: { users: ["passwordHash"] }, ...over,
  };
}

const mutate = vi.fn();
function kur(data: ReadOnlyDbStatus | undefined, error: unknown = null) {
  vi.mocked(svc.useReadOnlyDb).mockReturnValue({
    data, isLoading: false, isError: !!error, error, refetch: vi.fn(), isFetching: false,
  } as unknown as ReturnType<typeof svc.useReadOnlyDb>);
  vi.mocked(svc.useRotateReadOnlyDbPassword).mockReturnValue({ mutate, isPending: false } as unknown as ReturnType<typeof svc.useRotateReadOnlyDbPassword>);
}

describe("ReadOnlyDbPage", () => {
  beforeEach(() => mutate.mockReset());

  it("kurulumda yoksa açıklar, parola düğmesi yok", () => {
    kur(status({ state: "KURULUMDA_YOK", role: null }));
    renderWithProviders(<ReadOnlyDbPage />);
    expect(screen.getByText("Bu kurulumda kullanılamaz")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Parolayı yenile/ })).toBeNull();
  });

  it("HAZIR: bağlantı bilgisi + Docker port uyarısı, parola gösterilmez", () => {
    kur(status());
    renderWithProviders(<ReadOnlyDbPage />);
    expect(screen.getByText("tekserp_okuma")).toBeInTheDocument();
    expect(screen.getByText(/port açmaz/)).toBeInTheDocument();
    expect(screen.getByText(/Gösterilmez/)).toBeInTheDocument();
  });

  it("yenile → onay → parola bir kez gösterilir, kapatınca atılır", async () => {
    kur(status());
    mutate.mockImplementation((_v: unknown, o?: { onSuccess: (r: unknown) => void }) =>
      o?.onSuccess({ status: status({ passwordRotatedAt: "2026-10-13T08:00:00.000Z" }), password: "Gizli-Parola-123" }));
    renderWithProviders(<ReadOnlyDbPage />);
    await userEvent.click(screen.getByRole("button", { name: /Parolayı yenile ve göster/ }));
    expect(mutate).not.toHaveBeenCalled(); // önce onay
    await userEvent.click(screen.getByRole("button", { name: "Yenile ve göster" }));
    expect(screen.getByTestId("okuma-parola")).toHaveTextContent("Gizli-Parola-123");
    const kapat = screen.getAllByRole("button", { name: "Kapat" }).find((b) => b.textContent === "Kapat")!;
    await userEvent.click(kapat);
    expect(screen.queryByText("Gizli-Parola-123")).toBeNull();
  });

  it("süperadmin olmayan (403) ekranı açamaz", () => {
    kur(undefined, Object.assign(new Error("x"), { isAxiosError: true, response: { status: 403, data: {} } }));
    renderWithProviders(<ReadOnlyDbPage />);
    expect(screen.getByText(/yalnız en yetkili hesaba/)).toBeInTheDocument();
    expect(screen.queryByTestId("okuma-baglanti")).toBeNull();
  });
});
