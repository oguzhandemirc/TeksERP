import { describe, it, expect } from "vitest";
import { restoreCommand, type BackupListing } from "./service";
import type { RestoreImpact } from "./restore-impact.types";

const LISTING: BackupListing = {
  success: true,
  files: [
    {
      name: "tekserp_20260729_030000.dump",
      sizeBytes: 1024,
      time: "2026-07-29T00:00:00.000Z",
      kind: "nightly",
    },
  ],
  backupDir: "C:\\ProgramData\\TeksERP\\backups",
  restoreTarget: { host: "127.0.0.1", port: "5433", user: "postgres", database: "TeksErpDb" },
  pm2AppName: "teks-erp-backend",
  running: false,
  lastResult: null,
};

const IMPACT = {
  file: {
    name: "tekserp_20260729_030000.dump",
    sizeBytes: 1024,
    time: "2026-07-29T00:00:00.000Z",
    absPath: "C:\\ProgramData\\TeksERP\\backups\\tekserp_20260729_030000.dump",
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
  audit: { available: true, oldestLogAt: null, created: 0, updated: 0, deleted: 0, byTable: [] },
  groups: [],
  totalCreated: 0,
  measuredAllRows: true,
  computedAt: "2026-07-30T11:23:12.000Z",
  durationMs: 80,
} as unknown as RestoreImpact;

const NAME = "tekserp_20260729_030000.dump";

describe("restoreCommand", () => {
  it("impact yoksa komut ÜRETMEZ (önizleme görülmeden onay yok)", () => {
    expect(restoreCommand(LISTING, NAME, undefined)).toBeNull();
  });

  it("safetyBackup yoksa komut üretmez", () => {
    const noSafety = { ...IMPACT, safetyBackup: null } as unknown as RestoreImpact;
    expect(restoreCommand(LISTING, NAME, noSafety)).toBeNull();
  });

  it("restoreTarget yoksa komut üretmez", () => {
    const noTarget = { ...IMPACT, restoreTarget: null } as unknown as RestoreImpact;
    expect(restoreCommand({ ...LISTING, restoreTarget: null }, NAME, noTarget)).toBeNull();
  });

  describe("üretilen blok", () => {
    const cmd = restoreCommand(LISTING, NAME, IMPACT)!;
    const lines = cmd.split("\n");
    const code = lines.filter((l) => l.trim() && !l.trim().startsWith("#"));

    it("pm2 stop en başta, pm2 start en sonda", () => {
      expect(code[0]).toBe("pm2 stop teks-erp-backend");
      expect(code[code.length - 1]).toBe("pm2 start teks-erp-backend");
    });

    it("KRİTİK: pg_dump'tan ÖNCE $LASTEXITCODE sıfırlanır", () => {
      const resetIdx = code.findIndex((l) => l.includes("$LASTEXITCODE = 1"));
      const dumpIdx = code.findIndex((l) => l.startsWith("pg_dump "));
      expect(resetIdx).toBeGreaterThanOrEqual(0);
      expect(dumpIdx).toBeGreaterThan(resetIdx);
    });

    it("KRİTİK: geri yükleme satırı if ($ok) guard'ı İÇİNDE", () => {
      const restore = code.find((l) => l.includes("--clean --if-exists"));
      expect(restore).toBeDefined();
      expect(restore!.startsWith("if ($ok) {")).toBe(true);
    });

    it("KRİTİK: blokta exit/throw YOK — yapıştırılmış blokta iptal işlemez", () => {
      expect(cmd).not.toMatch(/\b(exit|throw)\b/);
    });

    it("KRİTİK: Remove-Item ve pm2 start hiçbir if içinde değil (backend asılı kalmasın)", () => {
      const cleanup = code.find((l) => l.includes("Remove-Item Env:PGPASSWORD"));
      expect(cleanup).toBeDefined();
      expect(cleanup!.includes("if (")).toBe(false);
      expect(code[code.length - 1]!.includes("if (")).toBe(false);
    });

    it("güvenlik yedeği doğrulanıyor (pg_restore --list) ve Test-Path ile askıya alınıyor", () => {
      expect(cmd).toContain('Test-Path "$safe"');
      expect(cmd).toContain('pg_restore --list "$safe"');
    });

    it("güvenlik yedeği pm2 stop'tan SONRA alınır", () => {
      const stopIdx = code.findIndex((l) => l.startsWith("pm2 stop"));
      const dumpIdx = code.findIndex((l) => l.startsWith("pg_dump "));
      expect(dumpIdx).toBeGreaterThan(stopIdx);
    });

    it("güvenlik dosyası adı impact payload'ından HARFİ HARFİNE gelir", () => {
      expect(cmd).toContain(IMPACT.safetyBackup!.absPath);
    });

    it("bağlantı bilgisi restoreTarget'tan gelir (port 5433 dahil)", () => {
      expect(cmd).toContain("-h 127.0.0.1 -p 5433 -U postgres -d TeksErpDb");
    });

    it("her if TEK SATIR (çok satırlı blok yapıştırmada bozulur)", () => {
      for (const l of lines) {
        if (!l.trim().startsWith("if (")) continue;
        // Tek satırda açılan süslü parantez aynı satırda kapanmalı.
        if (l.includes("{")) expect(l.trim().endsWith("}")).toBe(true);
      }
    });

    it("tüm dosya yolları çift tırnaklı (Program Files boşluk içerir)", () => {
      expect(cmd).toContain(`"${IMPACT.safetyBackup!.absPath}"`);
      expect(cmd).toContain(`"${IMPACT.file.absPath}"`);
    });

    it("yollar BACKEND'den geldiği gibi kullanılır — karışık ayırıcı üretilmez", () => {
      // Regresyon: istemci `${dir}\${name}` diye birleştirdiğinde POSIX sunucuda
      // "/Users/x/backups\tekserp_....dump" gibi bozuk yol çıkıyordu.
      const posixImpact = {
        ...IMPACT,
        file: { ...IMPACT.file, absPath: "/var/backups/tekserp_20260729_030000.dump" },
        safetyBackup: {
          fileName: "pre-restore_20260730_142312.dump",
          absPath: "/var/backups/pre-restore_20260730_142312.dump",
        },
      } as unknown as RestoreImpact;
      const posix = restoreCommand({ ...LISTING, backupDir: "/var/backups" }, NAME, posixImpact)!;
      expect(posix).toContain('"/var/backups/tekserp_20260729_030000.dump"');
      expect(posix).not.toMatch(/\/[^"\s]*\\[^"\s]*\.dump/); // karışık ayırıcı yok
    });

    it("şifre YER TUTUCU — gerçek şifre bloğa girmez", () => {
      expect(cmd).toContain('$env:PGPASSWORD = "<veritabani-sifresi>"');
      // Backend restoreTarget'ta password alanı göndermiyor; ileride sızdırırsa bu düşer.
      expect(Object.keys(LISTING.restoreTarget!)).not.toContain("password");
    });

    it("KRİTİK: migrate deploy VAR ve pm2 start'tan ÖNCE (P2022 sessiz bozulması)", () => {
      // Yedek bir migration'dan önce alındıysa ve kod yeniyse, bu adım olmadan
      // backend eski şemaya bağlanır ve audit kaydı sessizce kaybolur.
      const deployIdx = code.findIndex((l) => l.includes("prisma migrate deploy"));
      const startIdx = code.findIndex((l) => l.startsWith("pm2 start"));
      expect(deployIdx).toBeGreaterThanOrEqual(0);
      expect(startIdx).toBeGreaterThan(deployIdx);
    });

    it("migrate deploy yalnız restore GERÇEKTEN olduysa koşar", () => {
      const deploy = code.find((l) => l.includes("prisma migrate deploy"))!;
      expect(deploy.startsWith("if ($restored) {")).toBe(true);
      expect(cmd).toContain("$restored = $ok -and ($LASTEXITCODE -eq 0)");
    });

    it("migrate deploy backend cwd'sinde koşar (backend'den gelen yol)", () => {
      expect(cmd).toContain(`Set-Location "${IMPACT.backendCwd}"`);
    });

    it("stderr bastırılmaz (yalnız --list stdout'u susturulur)", () => {
      expect(cmd).toContain("> $null");
      expect(cmd).not.toContain("2>&1");
    });

    it("Write-Host metni ASCII (konsol codepage 857/850 Türkçe'yi bozar)", () => {
      const warn = code.find((l) => l.includes("Write-Host"))!;
      // eslint-disable-next-line no-control-regex
      expect(/^[\x00-\x7F]*$/.test(warn)).toBe(true);
    });
  });
});
