import { describe, expect, it } from "vitest";
import { plainBackupWarning, type BackupEncryptionSummary } from "./service";

const enc = (state: BackupEncryptionSummary["state"], problems: string[] = []): BackupEncryptionSummary => ({
  state,
  keyDir: state === "kapali" ? null : "/k",
  recipients: [],
  localKey: false,
  problems,
  warnings: [],
});

// Güvenlik denetimi B1: şifresiz yedek parola özetlerini ve kimlik kayıtlarını taşır — panel söyler.
describe("plainBackupWarning", () => {
  it("şifreleme kapalı → 'Yedekler şifresiz' uyarısı", () => {
    const w = plainBackupWarning({ backupDir: "/y", encryption: enc("kapali") });
    expect(w?.title).toBe("Yedekler şifresiz");
    expect(w?.body).toMatch(/parola özetleri/);
  });
  it("geçersiz → sebebiyle birlikte uyarı", () => {
    const w = plainBackupWarning({ backupDir: "/y", encryption: enc("gecersiz", ["Anahtar dizini boş (/k)."]) });
    expect(w?.title).toMatch(/çalışmıyor/);
    expect(w?.body).toMatch(/Anahtar dizini boş/);
  });
  it("açık → uyarı yok", () => {
    expect(plainBackupWarning({ backupDir: "/y", encryption: enc("acik") })).toBeNull();
  });
  it("eski sunucu (encryption yok) ya da yedekleme kapalı → uyarı yok", () => {
    expect(plainBackupWarning({ backupDir: "/y" })).toBeNull();
    expect(plainBackupWarning({ backupDir: null, encryption: enc("kapali") })).toBeNull();
    expect(plainBackupWarning(undefined)).toBeNull();
  });
});
