import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { pollIntervalFor, type DbCopyListing } from "./types";

// Hook'lar `hooks.ts`te (service.ts saf veri erişimi) — mock oraya kurulur.
vi.mock("./hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./hooks")>()),
  useDbCopies: vi.fn(),
  useStartCopy: vi.fn(),
  useVerifyCopy: vi.fn(),
  useDropCopy: vi.fn(),
  useSwapCommands: vi.fn(),
}));
vi.mock("../Backups/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../Backups/hooks")>()),
  useBackups: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/clipboard", () => ({ copyText: vi.fn().mockResolvedValue(undefined) }));
// PageHeader → useFavorites → PreferencesProvider zinciri test kapsamı dışında
// (SackStorePage.test.tsx ile aynı kalıp).
vi.mock("@/components/layout/PageHeader", () => ({
  PageHeader: ({ title, actions }: { title: string; actions?: ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {actions}
    </div>
  ),
}));

const svc = await import("./hooks");
const backupsSvc = await import("../Backups/hooks");
const { DbRestorePage } = await import("./DbRestorePage");

const LIVE = "TeksErpDb";

function listing(over: Partial<DbCopyListing> = {}): DbCopyListing {
  return {
    liveDatabase: LIVE,
    liveSizeBytes: 1024 * 1024 * 100,
    capabilities: {
      user: "postgres", isSuperuser: true, canCreateDb: true,
      enabled: true, reason: null, serverVersionNum: 180000,
    },
    capabilityError: null,
    copies: [],
    oldDatabases: [],
    disk: {
      ok: true, blockReason: null, warnings: [], measuredPath: "/pgdata",
      volumeKnown: true, freeBytes: 1e11, liveSizeBytes: 1024 * 1024 * 100, copiesTotalBytes: 0,
    },
    job: null,
    lastResult: null,
    error: null,
    ...over,
  };
}

function copy(over: Partial<DbCopyListing["copies"][number]> = {}) {
  return {
    name: `${LIVE}_restore_20260730_142312`,
    createdAt: "2026-07-30T11:23:12.000Z",
    sizeBytes: 1024 * 1024 * 90,
    state: "ready" as const,
    sourceBackup: "tekserp_20260729_030000.dump",
    openConnections: 0,
    message: null,
    ...over,
  };
}

const idleMutation = { mutate: vi.fn(), isPending: false } as never;

function stub(data: DbCopyListing | undefined, opts: { isLoading?: boolean; isError?: boolean } = {}) {
  vi.mocked(svc.useDbCopies).mockReturnValue({
    data, isLoading: opts.isLoading ?? false, isError: opts.isError ?? false,
    isFetching: false, refetch: vi.fn(),
  } as never);
  vi.mocked(svc.useStartCopy).mockReturnValue(idleMutation);
  vi.mocked(svc.useVerifyCopy).mockReturnValue(idleMutation);
  vi.mocked(svc.useDropCopy).mockReturnValue(idleMutation);
  vi.mocked(svc.useSwapCommands).mockReturnValue({
    data: undefined, isLoading: false, isError: false, isFetching: false, refetch: vi.fn(),
  } as never);
  vi.mocked(backupsSvc.useBackups).mockReturnValue({
    data: { success: true, files: [], backupDir: "/b", restoreTarget: null,
      pm2AppName: "x", running: false, lastResult: null },
    isLoading: false, isError: false, isFetching: false, refetch: vi.fn(),
  } as never);
}

beforeEach(() => vi.clearAllMocks());

describe("pollIntervalFor", () => {
  it("sekme pasifse ASLA poll etmez (K-A8)", () => {
    expect(pollIntervalFor("restoring", false)).toBe(false);
  });
  it("aktif faz + aktif sekme → 2sn", () => {
    for (const p of ["queued", "creating", "restoring", "verifying"] as const) {
      expect(pollIntervalFor(p, true)).toBe(2_000);
    }
  });
  it("iş bitince durur (boşta poll yok)", () => {
    expect(pollIntervalFor("ready", true)).toBe(false);
    expect(pollIntervalFor("failed", true)).toBe(false);
    expect(pollIntervalFor(null, true)).toBe(false);
    expect(pollIntervalFor(undefined, true)).toBe(false);
  });
});

describe("DbRestorePage", () => {
  it("canlıya dokunulmadığını en başta söyler", () => {
    stub(listing());
    renderWithProviders(<DbRestorePage />);
    expect(screen.getByText(/Canlı veriye dokunulmaz/i)).toBeInTheDocument();
  });

  it("CREATEDB yetkisi yoksa talimatlı uyarı gösterir ve başlatmayı kilitler", () => {
    stub(
      listing({
        capabilities: {
          user: "app", isSuperuser: false, canCreateDb: false, enabled: false,
          reason: 'ALTER ROLE "app" CREATEDB; çalıştırın.', serverVersionNum: 180000,
        },
      }),
    );
    renderWithProviders(<DbRestorePage />);
    expect(screen.getByText(/ALTER ROLE "app" CREATEDB/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Kopya oluştur/i })).toBeDisabled();
  });

  it("disk bloğunda başlatma kilitli ve sebep görünür", () => {
    stub(
      listing({
        disk: {
          ok: false, blockReason: "Yetersiz disk alanı: veritabanı 100 MB, boş alan 10 MB.",
          warnings: [], measuredPath: "/pgdata", volumeKnown: true,
          freeBytes: 1e7, liveSizeBytes: 1e8, copiesTotalBytes: 0,
        },
      }),
    );
    renderWithProviders(<DbRestorePage />);
    expect(screen.getByText(/Yetersiz disk alanı/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Kopya oluştur/i })).toBeDisabled();
  });

  it("hazır kopyada Geçiş açık", () => {
    stub(listing({ copies: [copy()] }));
    renderWithProviders(<DbRestorePage />);
    expect(screen.getByRole("button", { name: /Geçiş/i })).toBeEnabled();
  });

  it("YARIDA KALAN kopyada geçiş KAPALI (yarım kopyaya geçmek felaket)", () => {
    stub(listing({ copies: [copy({ state: "interrupted" })] }));
    renderWithProviders(<DbRestorePage />);
    expect(screen.getByText(/Yarıda kaldı/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Geçiş/i })).toBeDisabled();
  });

  it("DOĞRULANMAMIŞ kopyada geçiş KAPALI", () => {
    stub(listing({ copies: [copy({ state: "unverified" })] }));
    renderWithProviders(<DbRestorePage />);
    expect(screen.getByText(/Doğrulanmamış/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Geçiş/i })).toBeDisabled();
  });

  it("iş koşarken faz adımları görünür", () => {
    stub(
      listing({
        job: {
          copyName: `${LIVE}_restore_20260730_142312`,
          sourceBackup: "x.dump", phase: "restoring",
          startedAt: new Date().toISOString(), phaseStartedAt: new Date().toISOString(),
          finishedAt: null, durationMs: null, message: null, failedPhase: null,
        },
      }),
    );
    renderWithProviders(<DbRestorePage />);
    expect(screen.getByText(/Yedek geri yükleniyor/i)).toBeInTheDocument();
  });

  it("_old_ veritabanları 'silmeyin' uyarısıyla listelenir", () => {
    stub(listing({ oldDatabases: [copy({ name: `${LIVE}_old_20260730_151020` })] }));
    renderWithProviders(<DbRestorePage />);
    expect(screen.getByText(/GERİ DÖNÜŞ NOKTASI/i)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`${LIVE}_old_20260730_151020`))).toBeInTheDocument();
  });

  it("silme onay dialogu canlının etkilenmediğini söyler", async () => {
    stub(listing({ copies: [copy()] }));
    renderWithProviders(<DbRestorePage />);
    const buttons = screen.getAllByRole("button");
    await userEvent.click(buttons[buttons.length - 1]!); // satırdaki son buton = Sil
    expect(await screen.findByText(/canlı veritabanınız etkilenmez/i)).toBeInTheDocument();
  });
});
