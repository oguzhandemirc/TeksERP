import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { RestoreDialog } from "./RestoreDialog";
import type { BackupListing } from "./service";
import type { RestoreImpact } from "./restore-impact.types";

// `restoreCommand` GERÇEK kalır — 7. test kopyalanan metnin içeriğini doğruluyor.
vi.mock("./service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./service")>()),
  useRestoreImpact: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/clipboard", () => ({ copyText: vi.fn().mockResolvedValue(undefined) }));

const { useRestoreImpact } = await import("./service");
const { copyText } = await import("@/lib/clipboard");

const DB = "TeksErpDb";
const NAME = "tekserp_20260729_030000.dump";

const LISTING: BackupListing = {
  success: true,
  files: [{ name: NAME, sizeBytes: 2048, time: "2026-07-29T00:00:00.000Z", kind: "nightly" }],
  backupDir: "C:\\ProgramData\\TeksERP\\backups",
  restoreTarget: { host: "127.0.0.1", port: "5433", user: "postgres", database: DB },
  pm2AppName: "teks-erp-backend",
  running: false,
  lastResult: null,
};

function makeImpact(over: Partial<RestoreImpact> = {}): RestoreImpact {
  return {
    file: {
      name: NAME,
      sizeBytes: 2048,
      time: "2026-07-29T00:00:00.000Z",
      absPath: `C:\\ProgramData\\TeksERP\\backups\\${NAME}`,
    },
    cutoff: { at: "2026-07-29T00:00:00.000Z", source: "name" },
    isNewest: true,
    newerBackup: null,
    canRestore: true,
    blockReasons: [],
    warnings: [],
    restoreTarget: LISTING.restoreTarget,
    verify: "ok",
    safetyBackup: {
      fileName: "pre-restore_20260730_142312.dump",
      absPath: "C:\\ProgramData\\TeksERP\\backups\\pre-restore_20260730_142312.dump",
    },
    backendCwd: "C:\\TeksERP\\Teks-Erp",
    pm2AppName: "teks-erp-backend",
    audit: {
      available: true,
      oldestLogAt: "2026-01-01T00:00:00.000Z",
      created: 827,
      updated: 735,
      deleted: 45,
      byTable: [{ tableName: "rolls", created: 80, updated: 300, deleted: 2, total: 382 }],
    },
    groups: [
      {
        key: "production",
        label: "Üretim",
        rows: [
          { key: "roll", label: "Yeni top / kumaş kaydı", count: 80, timestampField: "createdAt" },
          { key: "rollError", label: "Tespit edilen hata", count: null, timestampField: "detectedAt" },
        ],
      },
      { key: "system", label: "Sistem kayıtları", rows: [] },
    ],
    totalCreated: 80,
    measuredAllRows: false,
    computedAt: "2026-07-30T11:23:12.000Z",
    durationMs: 81,
    ...over,
  } as RestoreImpact;
}

type QueryStub = Partial<ReturnType<typeof useRestoreImpact>>;
function stub(q: QueryStub) {
  vi.mocked(useRestoreImpact).mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
    ...q,
  } as ReturnType<typeof useRestoreImpact>);
}

const copyBtn = () => screen.getByRole("button", { name: /komutunu kopyala/i });

function render(name: string | null = NAME) {
  return renderWithProviders(
    <RestoreDialog name={name} listing={LISTING} onClose={vi.fn()} />,
  );
}

beforeEach(() => vi.clearAllMocks());

describe("RestoreDialog", () => {
  it("yüklenirken kopyala düğmesi kapalı", () => {
    stub({ isLoading: true });
    render();
    expect(screen.getByText(/Etki hesaplanıyor/i)).toBeInTheDocument();
    expect(copyBtn()).toBeDisabled();
  });

  it("önizleme hatasında Yeniden Dene çıkar, kopyalama engellenir", async () => {
    const refetch = vi.fn();
    stub({ isError: true, refetch });
    render();
    expect(screen.getByText(/Etki önizlemesi yüklenemedi/i)).toBeInTheDocument();
    expect(copyBtn()).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: /Yeniden Dene/i }));
    expect(refetch).toHaveBeenCalled();
    expect(copyText).not.toHaveBeenCalled();
  });

  it("canRestore=false → blok sebebi görünür, kopyalama kapalı", () => {
    stub({
      data: makeImpact({
        canRestore: false,
        blockReasons: ["Şu anda yedek alınıyor."],
      }),
    });
    render();
    expect(screen.getByText(/Şu anda yedek alınıyor/i)).toBeInTheDocument();
    expect(copyBtn()).toBeDisabled();
  });

  it("sayımları gösterir ve 'güncellemeler görünmez' uyarısını basar", () => {
    stub({ data: makeImpact() });
    render();
    expect(screen.getByText(/Yeni top \/ kumaş kaydı/i)).toBeInTheDocument();
    // Bu uyarı bir GEREKSİNİM: sayımlar yalnız INSERT yakalıyor. Uyarı iki yerde
    // birden geçiyor (sayım kutusu + audit paneli) — ikisi de kasıtlı.
    expect(screen.getByText(/yalnız YENİ EKLENEN kayıtlardır/i)).toBeInTheDocument();
    expect(screen.getAllByText(/görünmez/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/alt sınır olarak okuyun/i)).toBeInTheDocument();
  });

  it("ölçülemeyen satır 'ölçülemedi' gösterir (0 DEĞİL)", () => {
    stub({ data: makeImpact() });
    render();
    const row = screen.getByText(/Tespit edilen hata/i).closest("li")!;
    expect(row.textContent).toMatch(/ölçülemedi/i);
    expect(row.textContent).not.toMatch(/\b0\b/);
  });

  it("audit kapsamı yetmezse 'ölçülemedi' yazar, 0 GÖSTERMEZ", () => {
    stub({
      data: makeImpact({
        audit: {
          available: false,
          oldestLogAt: "2026-07-30T00:00:00.000Z",
          created: 0,
          updated: 0,
          deleted: 0,
          byTable: [],
        },
      }),
    });
    render();
    expect(screen.getByText(/Değişiklik izi ölçülemedi/i)).toBeInTheDocument();
    expect(screen.queryByText(/kayıt güncellendi/i)).not.toBeInTheDocument();
  });

  it("UPDATE hacmini raporlar (INSERT-only sınırının telafisi)", () => {
    stub({ data: makeImpact() });
    render();
    expect(screen.getByText(/735/)).toBeInTheDocument();
    expect(screen.getByText(/kayıt güncellendi/i)).toBeInTheDocument();
  });

  it("güvenlik yedeği notu ve acil çıkış görünür", () => {
    stub({ data: makeImpact() });
    render();
    expect(screen.getByText(/pre-restore_20260730_142312\.dump/)).toBeInTheDocument();
    expect(screen.getByText(/Acil durum/i)).toBeInTheDocument();
  });

  it("DB adı yazılana dek kopyalama kapalı; yakın-ıska da kapalı", async () => {
    stub({ data: makeImpact() });
    render();
    expect(copyBtn()).toBeDisabled();
    const input = screen.getByRole("textbox");
    await userEvent.type(input, "tekserpdb"); // harf farkı
    expect(copyBtn()).toBeDisabled();
    await userEvent.clear(input);
    await userEvent.type(input, DB);
    expect(copyBtn()).toBeEnabled();
  });

  it("onaydan sonra tık → komut BİR KEZ kopyalanır ve güvenlik dosyasını içerir", async () => {
    stub({ data: makeImpact() });
    render();
    await userEvent.type(screen.getByRole("textbox"), DB);
    await userEvent.click(copyBtn());
    expect(copyText).toHaveBeenCalledTimes(1);
    const cmd = vi.mocked(copyText).mock.calls[0]![0];
    expect(cmd).toContain("pre-restore_20260730_142312.dump");
    expect(cmd).toContain("if ($ok) {");
    expect(cmd).toContain("$LASTEXITCODE = 1");
  });

  it("başka dosya için yeniden açılışta yazılan onay SIFIRLANIR", async () => {
    stub({ data: makeImpact() });
    const { rerender } = render();
    await userEvent.type(screen.getByRole("textbox"), DB);
    expect(copyBtn()).toBeEnabled();

    // Dialog kapanıp farklı bir dosya için açılıyor.
    rerender(<RestoreDialog name={null} listing={LISTING} onClose={vi.fn()} />);
    rerender(
      <RestoreDialog name="tekserp_20260728_030000.dump" listing={LISTING} onClose={vi.fn()} />,
    );
    expect(screen.getByRole("textbox")).toHaveValue("");
    expect(copyBtn()).toBeDisabled();
  });
});
