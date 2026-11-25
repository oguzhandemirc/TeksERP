// Tezgâh dosya adı 8+3 uyarısı (K9) + mekanizma seçenekleri (K10) — saf yardımcılar.
import { describe, expect, it } from "vitest";
import { loomFileNameTooLong } from "./loom-file-name";
import { defaultMechanism, enabledMechanisms, mechanismChoices } from "./mechanism-options";

describe("loomFileNameTooLong", () => {
  it.each([
    ["D2057.DOP", false], ["GUL-0001.JC5", false], ["", false], ["  ", false], ["ABCDEFGH", false],
    ["ABCDEFGHI.DOP", true], ["D2057.DOPX", true], ["ABCDEFGHI", true], ["eski.adlar.DOP", true], ["a.b", false],
  ])("%s → %s", (name, expected) => expect(loomFileNameTooLong(name)).toBe(expected));
  it("null güvenli", () => expect(loomFileNameTooLong(null)).toBe(false));
});

describe("mekanizma seçenekleri", () => {
  it("bayrak yok/eski sunucu → üçü açık (bugünkü davranış)", () => {
    expect(enabledMechanisms(undefined)).toEqual(["CAM", "DOBBY", "JACQUARD"]);
    expect(enabledMechanisms({})).toEqual(["CAM", "DOBBY", "JACQUARD"]);
  });
  it("kapalı olan yeni seçimde görünmez; kayıtlı değer listede kalır", () => {
    const on = enabledMechanisms({ dokumaMechanismCamEnabled: false, dokumaMechanismDobbyEnabled: true, dokumaMechanismJacquardEnabled: false });
    expect(on).toEqual(["DOBBY"]);
    expect(mechanismChoices(on)).toEqual(["DOBBY"]);
    expect(mechanismChoices(on, "JACQUARD")).toEqual(["DOBBY", "JACQUARD"]);
  });
  it("yeni kartın varsayılanı: Armür açıksa Armür, değilse ilk açık", () => {
    expect(defaultMechanism(["CAM", "DOBBY"])).toBe("DOBBY");
    expect(defaultMechanism(["JACQUARD"])).toBe("JACQUARD");
    expect(defaultMechanism(["CAM", "JACQUARD"])).toBe("CAM");
  });
});
