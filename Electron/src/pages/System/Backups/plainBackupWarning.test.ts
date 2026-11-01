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
  it("LAN sunucusu (hostedRequired yok) → sarı uyarı, bugünkü metin", () => {
    expect(plainBackupWarning({ backupDir: "/y", encryption: enc("kapali") })?.tone).toBe("warning");
  });
  it("barındırılan sunucu: kapalı ya da geçersiz → KIRMIZI uyarı (K2)", () => {
    const k = plainBackupWarning({ backupDir: "/y", encryption: { ...enc("kapali"), hostedRequired: true } });
    expect(k?.tone).toBe("danger");
    expect(k?.title).toMatch(/ŞİFRESİZ/);
    const g = plainBackupWarning({ backupDir: "/y", encryption: { ...enc("gecersiz", ["Anahtar dizininde alıcı yok (/k/*.tkpub)."]), hostedRequired: true } });
    expect(g?.tone).toBe("danger");
    expect(g?.body).toMatch(/alıcı yok/);
  });
  it("barındırılan + açık → uyarı yok", () => {
    expect(plainBackupWarning({ backupDir: "/y", encryption: { ...enc("acik"), hostedRequired: true } })).toBeNull();
  });
  it("eski sunucu (encryption yok) ya da yedekleme kapalı → uyarı yok", () => {
    expect(plainBackupWarning({ backupDir: "/y" })).toBeNull();
    expect(plainBackupWarning({ backupDir: null, encryption: enc("kapali") })).toBeNull();
    expect(plainBackupWarning(undefined)).toBeNull();
  });
});
