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

    it("pm2 stop ilk iş, pm2 start en sonda", () => {
      // İlk satır artık `$LASTEXITCODE = 1` (stop'un çıkış kodu guard'lanıyor),
      // pm2 stop hemen ardından gelir.
      expect(code.slice(0, 3).some((l) => l === "pm2 stop teks-erp-backend")).toBe(true);
      expect(code[code.length - 1]).toBe("pm2 start teks-erp-backend");
    });

    it("KRİTİK: pg_dump'tan ÖNCE $LASTEXITCODE sıfırlanır", () => {
      const dumpIdx = code.findIndex((l) => l.includes("pg_dump "));
      const resetIdx = code.slice(0, dumpIdx).map((l) => l.includes("$LASTEXITCODE = 1")).lastIndexOf(true);
      expect(dumpIdx).toBeGreaterThan(0);
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
      const dumpIdx = code.findIndex((l) => l.includes("pg_dump "));
      expect(stopIdx).toBeGreaterThanOrEqual(0);
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

    it("KRİTİK: pm2 stop guard'lı — SYSTEM daemon'a normal shell'den erişilemez", () => {
      // PM2 daemon boot'ta SYSTEM olarak kalkıyor; normal pencerede pm2 komutları
      // EPERM ile düşer. Guard yoksa backend ayakta kalır ve `--clean` şemayı
      // açık bağlantılarla yarım düşürür.
      expect(cmd).toContain("$stopped = ($LASTEXITCODE -eq 0)");
      const dump = code.find((l) => l.includes("pg_dump "))!;
      expect(dump.startsWith("if ($stopped) {")).toBe(true);
      expect(cmd).toContain("$ok = $stopped -and");
    });

    it("yönetici shell uyarısı blokta yazıyor", () => {
      expect(cmd).toMatch(/YONETICI/);
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

describe("restoreCommand — şifreli yedek (.tkenc)", () => {
  const ENC_NAME = "tekserp_20260729_030000.dump.tkenc";
  const encImpact = (over: Record<string, unknown> = {}) =>
    ({
      ...IMPACT,
      file: { ...IMPACT.file, name: ENC_NAME, absPath: `C:\\TeksERP\\backups\\${ENC_NAME}` },
      encryption: {
        state: "acik",
        keyDir: "C:\\TeksERP\\yedek-anahtar",
        toolPath: "C:\\TeksERP\\app\\dist\\tools\\yedek-sifrele.cjs",
        fileEncrypted: true,
        decryptedPath: "C:\\TeksERP\\backups\\tekserp_20260729_030000.dump.coz-elle.part",
        unlocked: true,
        ...over,
      },
    }) as unknown as RestoreImpact;
  const cmd = restoreCommand(LISTING, ENC_NAME, encImpact())!;
  const code = cmd.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#"));

  it("çözme adımı güvenlik yedeğinden SONRA, geri yüklemeden ÖNCE ve $ok guard'ında", () => {
    const safeIdx = code.findIndex((l) => l.includes('pg_restore --list "$safe"'));
    const cozIdx = code.findIndex((l) => l.includes(" coz --girdi "));
    const restoreIdx = code.findIndex((l) => l.includes("--clean --if-exists"));
    expect(cozIdx).toBeGreaterThan(safeIdx);
    expect(restoreIdx).toBeGreaterThan(cozIdx);
    expect(code[cozIdx]!.startsWith("if ($ok) { node ")).toBe(true);
  });

  it("KRİTİK: pg_restore ŞİFRELİ dosyayı değil çözülmüş kopyayı okur", () => {
    const restore = code.find((l) => l.includes("--clean --if-exists"))!;
    expect(restore).toContain('"$plain"');
    expect(restore).not.toContain(".tkenc");
  });

  it("KRİTİK: parola bloğa GİRMEZ — araç onu pencerede sorar", () => {
    expect(cmd).not.toMatch(/--parola|X-Backup-Password/i);
  });

  it("çözme başarısızsa $ok düşer (geri yükleme yapılmaz)", () => {
    expect(cmd).toContain('$ok = $ok -and ($LASTEXITCODE -eq 0) -and (Test-Path "$plain")');
  });

  it("çözülmüş kopya KOŞULSUZ silinir ve pm2 start yine en sonda", () => {
    const rm = code.find((l) => l.startsWith('Remove-Item "$plain"'));
    expect(rm).toBeDefined();
    expect(code[code.length - 1]).toBe("pm2 start teks-erp-backend");
  });

  it("şifreleme açıksa güvenlik yedeği de şifrelenir (--duzu-sil)", () => {
    expect(cmd).toContain('sifrele --girdi "$safe"');
    expect(cmd).toContain("--duzu-sil");
  });

  it("anahtar dizini ya da çözme yolu yoksa komut ÜRETİLMEZ (fail-closed)", () => {
    expect(restoreCommand(LISTING, ENC_NAME, encImpact({ keyDir: null }))).toBeNull();
    expect(restoreCommand(LISTING, ENC_NAME, encImpact({ decryptedPath: null }))).toBeNull();
  });

  it("düz yedekte (eski sunucu: encryption alanı yok) blok değişmez", () => {
    const plain = restoreCommand(LISTING, NAME, IMPACT)!;
    expect(plain).not.toContain("$plain");
    expect(plain).not.toContain("yedek-sifrele");
  });
});

describe("restoreCommand — Windows hizmeti düzeni (TeksERP-Backend)", () => {
  const HIZMET = {
    processManager: "service",
    serviceName: "TeksERP-Backend",
    nodePath: "C:\\TeksERP\\surumler\\2.13.0\\runtime\\node.exe",
    envFile: "C:/TeksERP/yapilandirma/.env",
    pgDumpPath: "C:/TeksERP/pgsql/bin/pg_dump.exe",
    pgRestorePath: "C:/TeksERP/pgsql/bin/pg_restore.exe",
    backendCwd: "C:\\TeksERP\\surumler\\2.13.0",
  };
  const svcImpact = (over: Record<string, unknown> = {}) => ({ ...IMPACT, ...HIZMET, ...over }) as unknown as RestoreImpact;
  const cmd = restoreCommand(LISTING, NAME, svcImpact())!;
  const code = cmd.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#"));

  it("pm2 komutu HİÇ yok; durdurma Stop-Service, başlatma Start-Service ve EN SON satır", () => {
    expect(cmd).not.toMatch(/\bpm2\b/);
    expect(code.some((l) => l === "Stop-Service -Name $svc -ErrorAction SilentlyContinue")).toBe(true);
    expect(code[code.length - 1]).toBe("Start-Service -Name $svc -ErrorAction SilentlyContinue");
  });

  it("KRİTİK: durdurma guard'lı — hizmet durmadıysa güvenlik yedeği/geri yükleme yok", () => {
    expect(cmd).toContain("$stopped = ((Get-Service -Name $svc -ErrorAction SilentlyContinue).Status -eq 'Stopped')");
    const dump = code.find((l) => l.includes("pg_dump.exe"))!;
    expect(dump.startsWith("if ($stopped) { & \"C:/TeksERP/pgsql/bin/pg_dump.exe\"")).toBe(true);
  });

  it("pg araçları TAM YOLLA (hizmette PATH'te değil); npx YOK, göç paketin Node'uyla", () => {
    expect(code.filter((l) => /(^|[{ ])pg_(dump|restore) /.test(l))).toEqual([]);
    expect(cmd).not.toContain("npx");
    const deploy = code.find((l) => l.includes("migrate deploy"))!;
    expect(deploy).toBe(`if ($restored) { & "${HIZMET.nodePath}" "node_modules\\prisma\\build\\index.js" migrate deploy }`);
    const env = code.findIndex((l) => l.includes("DOTENV_CONFIG_PATH = "));
    expect(env).toBeGreaterThan(-1);
    expect(env).toBeLessThan(code.indexOf(deploy));
  });

  it("temizlik koşulsuz: PGPASSWORD ve DOTENV_CONFIG_PATH if dışında", () => {
    for (const k of ["Remove-Item Env:PGPASSWORD", "Remove-Item Env:DOTENV_CONFIG_PATH"]) {
      const l = code.find((x) => x.startsWith(k));
      expect(l).toBeDefined();
    }
  });

  it("şifreli yedekte araç paketin Node'uyla koşar (sistem Node'u yok sayılır)", () => {
    const enc = restoreCommand(
      LISTING,
      NAME,
      svcImpact({
        encryption: {
          state: "acik",
          keyDir: "C:\\TeksERP\\yedek-anahtar",
          toolPath: "C:\\TeksERP\\surumler\\2.13.0\\dist\\tools\\yedek-sifrele.cjs",
          fileEncrypted: true,
          decryptedPath: "C:\\TeksERP\\backups\\x.dump.coz-elle.part",
          unlocked: true,
        },
      }),
    )!;
    expect(enc).toContain(`if ($ok) { & "${HIZMET.nodePath}" "C:\\TeksERP\\surumler\\2.13.0\\dist\\tools\\yedek-sifrele.cjs" coz `);
    expect(enc).not.toMatch(/\{ node /);
  });

  it("FAIL-CLOSED: hizmet düzeni ama yol eksik → komut ÜRETİLMEZ (pm2 bloğu yanlış süreci hedeflerdi)", () => {
    for (const eksik of ["serviceName", "nodePath", "envFile", "pgDumpPath", "pgRestorePath"]) {
      expect(restoreCommand(LISTING, NAME, svcImpact({ [eksik]: null }))).toBeNull();
    }
  });

  it("eski sunucu (alan yok) → pm2 bloğu, bugünkü gibi", () => {
    const eski = restoreCommand(LISTING, NAME, IMPACT)!;
    expect(eski.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#")).pop()).toBe("pm2 start teks-erp-backend");
  });
});
