import { describe, expect, it } from "vitest";
import {
  buildHwClaim,
  computeHwDigest,
  parseLinuxMachineId,
  parseMacPlatformUuid,
  parseWindowsMachineGuid,
  sourceForPlatform,
} from "../../electron/device-identity/machine-id.core";

// =============================================================================
// Makine kimliği (cihaz eşleme v2, D3). İddia: üç işletim sistemi çıktısı doğru
// ayrışır; boş/bozuk çıktı → kimlik YOK (hw gönderilmez); özet D1 sunucu vektörüyle
// bayt-eşit (`Teks-Erp/scripts/test_cihaz_yeniden_baglama.ts` VEKTOR); ham değer dönüşte yok.
// =============================================================================

const VEKTOR = {
  installationId: "00000000-0000-4000-8000-000000000001",
  kaynak: "ANDROID_ID" as const,
  ham: "9774d56d682e549c",
  ozet: "b1c0721db73f7297afbeadaddff6de68c62f572cc68d36c9a0de087600dea9c7",
};

const WIN_OUT = `\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography\r\n    MachineGuid    REG_SZ    6F1D2C3B-4A59-4E1F-9C2D-0A1B2C3D4E5F\r\n\r\n`;
const MAC_OUT = `+-o J314sAP  <class IOPlatformExpertDevice, id 0x100000210, registered, matched, active, busy 0 (0 ms), retain 34>
    {
      "IOPlatformSerialNumber" = "C02XXXXX"
      "IOPlatformUUID" = "1A2B3C4D-5E6F-7081-92A3-B4C5D6E7F809"
      "model" = <"MacBookPro18,3">
    }`;

describe("ayrıştırıcılar", () => {
  it("Windows MachineGuid (küçük harfe indirger)", () => {
    expect(parseWindowsMachineGuid(WIN_OUT)).toBe("6f1d2c3b-4a59-4e1f-9c2d-0a1b2c3d4e5f");
  });
  it("macOS IOPlatformUUID (seri numarasını almaz)", () => {
    expect(parseMacPlatformUuid(MAC_OUT)).toBe("1A2B3C4D-5E6F-7081-92A3-B4C5D6E7F809");
  });
  it("Linux machine-id", () => {
    expect(parseLinuxMachineId("0123456789abcdef0123456789abcdef\n")).toBe("0123456789abcdef0123456789abcdef");
  });
  it("boş / bozuk / sıfır çıktı → null", () => {
    expect(parseWindowsMachineGuid("")).toBeNull();
    expect(parseWindowsMachineGuid("ERROR: The system was unable to find the specified registry key or value.")).toBeNull();
    expect(parseWindowsMachineGuid("    MachineGuid    REG_SZ    00000000-0000-0000-0000-000000000000")).toBeNull();
    expect(parseMacPlatformUuid("")).toBeNull();
    expect(parseMacPlatformUuid('"IOPlatformUUID" = "kirik"')).toBeNull();
    expect(parseLinuxMachineId("")).toBeNull();
    expect(parseLinuxMachineId("uninitialized\n")).toBeNull();
    expect(parseLinuxMachineId("0".repeat(32))).toBeNull();
  });
  it("platform → kaynak", () => {
    expect(sourceForPlatform("win32")).toBe("WIN_MACHINE_GUID");
    expect(sourceForPlatform("darwin")).toBe("MAC_PLATFORM_UUID");
    expect(sourceForPlatform("linux")).toBe("LINUX_MACHINE_ID");
    expect(sourceForPlatform("aix")).toBeNull();
  });
});

describe("özet sözleşmesi", () => {
  it("⭐ D1 test vektörüyle bayt-eşit", () => {
    expect(computeHwDigest(VEKTOR.installationId, VEKTOR.kaynak, VEKTOR.ham)).toBe(VEKTOR.ozet);
  });
  it("iddia yalnız {v, kaynak, ozet}; ham değer dönüşte YOK", () => {
    const ham = "6f1d2c3b-4a59-4e1f-9c2d-0a1b2c3d4e5f";
    const claim = buildHwClaim(VEKTOR.installationId, { kaynak: "WIN_MACHINE_GUID", ham });
    expect(claim).not.toBeNull();
    expect(Object.keys(claim ?? {}).sort()).toEqual(["kaynak", "ozet", "v"]);
    expect(JSON.stringify(claim)).not.toContain(ham);
    expect(claim?.ozet).toMatch(/^[0-9a-f]{64}$/);
  });
  it("kurulum anahtarı ya da ham yoksa iddia yok (hw gönderilmez)", () => {
    expect(buildHwClaim(null, { kaynak: "LINUX_MACHINE_ID", ham: "x" })).toBeNull();
    expect(buildHwClaim(VEKTOR.installationId, null)).toBeNull();
  });
});
