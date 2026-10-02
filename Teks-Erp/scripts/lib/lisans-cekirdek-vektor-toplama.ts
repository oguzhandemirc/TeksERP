// Parmak izi TOPLAMA vektörleri (K8 çok yollu okuma, L2-10): yol sonuçlarından seçim + özet, Windows sonda
// çıktısının çözümü ve Linux SMBIOS yapı okuyucusu. TS (`fingerprint-paths.ts` · `fingerprint-os.ts`) beklenenleri
// üretir; native `cargo test` (`tests/toplama.rs`) aynı dosyayı `api::collected_value` · `paths::*`ten geçirir.
// Değerler UYDURMADIR (gerçek donanım kimliği taşımaz). `test_` öneki yok → koşucu bunu bekçi saymaz.
import path from "node:path";
import { b64uEncode } from "../../src/lib/license/protocol";
import { collectedFrom, parseWindowsProbeOutput, type CollectedOs, type PathOutcomes, type ProbePlatform } from "../../src/lib/license/fingerprint-paths";
import { smbiosSerial, smbiosStrings, smbiosUuid } from "../../src/lib/license/fingerprint-os";

export const VEKTOR_TOPLAMA_BICIMI = 1;
/** Bütün toplama vektörlerinin tuzu (özetin kendisi de kıyaslanır). */
export const TOPLAMA_TUZU = Buffer.alloc(32, 0x42);

export function vektorToplamaDosyasiYolu(teksKok: string): string {
  return path.join(teksKok, "native", "lisans-cekirdek", "test-vektorleri", "toplama.json");
}

export type VektorToplama =
  | { readonly tur: "toplama"; readonly ad: string; readonly platform: ProbePlatform | null; readonly sonuclar: PathOutcomes; readonly f5: string | null }
  | { readonly tur: "windowsCikti"; readonly ad: string; readonly stdout: string }
  | { readonly tur: "smbios"; readonly ad: string; readonly hex: string };

export interface VektorToplamaKaydi {
  readonly vektor: VektorToplama;
  readonly beklenen: unknown;
}

export interface VektorToplamaDosyasi {
  readonly bicim: number;
  readonly not: string;
  readonly tuz: string;
  readonly kayitlar: readonly VektorToplamaKaydi[];
}

export function degerlendirToplama(v: VektorToplama): unknown {
  if (v.tur === "toplama") return collectedFrom(v.platform, v.sonuclar, TOPLAMA_TUZU, v.f5);
  if (v.tur === "windowsCikti") {
    const sonuclar = parseWindowsProbeOutput(v.stdout);
    const toplama: CollectedOs = collectedFrom("win32", sonuclar, TOPLAMA_TUZU, null);
    return { sonuclar, toplama };
  }
  const bytes = Buffer.from(v.hex, "hex");
  return { dizgeler: smbiosStrings(bytes), seri: smbiosSerial(bytes), uuid: smbiosUuid(bytes) };
}

// ── Uydurma değerler ─────────────────────────────────────────────────────────────
const GUID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const UUID = "7c3e91d2-58af-4b06-9e21-c4d8a1f05b37";
const UUID2 = "8d4fa2e3-69b0-4c17-af32-d5e9b2016c48";
const SERI_NVME = "0025_3881_91B4_5C67.";
const KIMLIK_NVME = "eui.0025388191B45C67";
const BIOS = "PF2ABCDE";
const ANAKART = "L1HF0123ABC";

/** Windows: her yol aynı türde aynı değeri verir (thinkpad-1'in ölçülen düzeni). */
function windowsTam(): Record<string, string | null> {
  return {
    "f1.kayit": GUID,
    "f1.kayit-net64": GUID,
    "f2.cim": UUID.toUpperCase(),
    "f2.wmi": UUID.toUpperCase(),
    "f2.donanim-kaydi": `{${UUID}}`,
    "f3.disk-seri": SERI_NVME,
    "f3.msft-disk-seri": SERI_NVME,
    "f3.win32-disk-seri": SERI_NVME,
    "f3.disk-kimlik": KIMLIK_NVME,
    "f3.msft-disk-kimlik": KIMLIK_NVME,
    "f4.cim-bios": BIOS,
    "f4.wmi-bios": BIOS,
    "f4.smbios-sistem": BIOS,
    "f4.cim-anakart": ANAKART,
    "f4.wmi-anakart": ANAKART,
    "f4.smbios-anakart": ANAKART,
  };
}

function linuxTam(): Record<string, string | null> {
  return {
    "f1.machine-id": "0a1b2c3d4e5f4a6b8c7d9e0f1a2b3c4d",
    "f1.dbus-machine-id": "0a1b2c3d4e5f4a6b8c7d9e0f1a2b3c4d",
    "f2.dmi-uuid": UUID,
    "f2.smbios-uuid": UUID,
    "f3.udev-seri": "S4EVNX0N123456",
    "f3.sysfs-aygit-seri": "S4EVNX0N123456",
    "f3.sysfs-seri": "",
    "f3.sysfs-wwid": "eui.0025388191b45c67",
    "f4.dmi-sistem": BIOS,
    "f4.smbios-sistem": BIOS,
    "f4.dmi-anakart": ANAKART,
    "f4.smbios-anakart": ANAKART,
  };
}

const ile = (taban: Record<string, string | null>, degisen: Record<string, string | null>): Record<string, string | null> => ({ ...taban, ...degisen });

function toplamaVektorleri(): VektorToplama[] {
  const w = windowsTam();
  const l = linuxTam();
  const t = (ad: string, platform: ProbePlatform | null, sonuclar: PathOutcomes, f5: string | null = "7412345678901234567"): VektorToplama => ({ tur: "toplama", ad, platform, sonuclar, f5 });
  const seriHata = { "f3.disk-seri": null, "f3.msft-disk-seri": null, "f3.win32-disk-seri": null };
  return [
    t("win32 tam: her tür kendi içinde aynı değer", "win32", w),
    t("win32 f2 çelişki: CIM ≠ WMI → CIM kazanır, WMI çelişki", "win32", ile(w, { "f2.wmi": UUID2 })),
    t("win32 f1 yalnız .NET 64 bit görünümü okudu", "win32", ile(w, { "f1.kayit": null })),
    t("⭐ win32 f3 seri türü yalnız HATA verdi → UniqueId'ye GEÇİLMEZ (OKUNAMADI)", "win32", ile(w, seriHata)),
    t("win32 f3 Storage reddetti, Win32_DiskDrive okudu → seri aynı değer", "win32", ile(w, { "f3.disk-seri": null, "f3.msft-disk-seri": null, "f3.disk-kimlik": null, "f3.msft-disk-kimlik": null })),
    t(
      "⭐ win32 RAID (SAHINSRV RST RAID-1): üç seri genel desende/boş → UniqueId devreye girer",
      "win32",
      ile(w, { "f3.disk-seri": "Volume0", "f3.msft-disk-seri": "Volume0", "f3.win32-disk-seri": "", "f3.disk-kimlik": "SCSI\\Disk&Ven_Intel&Prod_Raid_1_Volume\\4&2b4d3e7f&0&000100", "f3.msft-disk-kimlik": "SCSI\\Disk&Ven_Intel&Prod_Raid_1_Volume\\4&2b4d3e7f&0&000100" }),
    ),
    t("win32 RAID: Storage seri genel desende, Win32_DiskDrive kullanılabilir seri verirse o kazanır", "win32", ile(w, { "f3.disk-seri": "Volume0", "f3.msft-disk-seri": "Volume1", "f3.win32-disk-seri": "RST7A3F00112233" })),
    t("win32 RAID: seri genel desende, UniqueId yolları hata → OKUNAMADI", "win32", ile(w, { "f3.disk-seri": "Volume0", "f3.msft-disk-seri": "Volume0", "f3.win32-disk-seri": "", "f3.disk-kimlik": null, "f3.msft-disk-kimlik": null })),
    t("win32 f4 BIOS yer tutucu (üç yolda) → anakart serisi", "win32", ile(w, { "f4.cim-bios": "To Be Filled By O.E.M.", "f4.wmi-bios": "To Be Filled By O.E.M.", "f4.smbios-sistem": "To Be Filled By O.E.M." })),
    t("win32 f4 BIOS yolları yalnız hata → anakarta geçilmez (OKUNAMADI)", "win32", ile(w, { "f4.cim-bios": null, "f4.wmi-bios": null, "f4.smbios-sistem": null })),
    t("win32 f4 BIOS bir yolda kesin anlamsız, ötekiler hata → anakart", "win32", ile(w, { "f4.cim-bios": null, "f4.wmi-bios": "Default string", "f4.smbios-sistem": null })),
    t("win32 f4 BIOS boş, anakart da boş → DEGER_YOK", "win32", ile(w, { "f4.cim-bios": "", "f4.wmi-bios": "", "f4.smbios-sistem": "", "f4.cim-anakart": "", "f4.wmi-anakart": "", "f4.smbios-anakart": "" })),
    t("win32 her yol hata → dört etken OKUNAMADI, F5 yine özetlenir", "win32", Object.fromEntries(Object.keys(w).map((k) => [k, null]))),
    t("win32 sonda hiç çıktı vermedi (zaman aşımı/arıza) → eksik yollar OKUNAMADI", "win32", {}),
    t("win32 tabloda olmayan yol yok sayılır", "win32", ile(w, { "f9.bilinmeyen": "x123456" })),
    t("win32 F5 anlamsız → ölçülmedi", "win32", w, "abc"),
    t("win32 F5 yok", "win32", w, null),
    t("linux tam", "linux", l),
    t("linux konteyner: yalnız machine-id; DMI/disk yok (kesin)", "linux", { "f1.machine-id": "0a1b2c3d4e5f4a6b8c7d9e0f1a2b3c4d", "f1.dbus-machine-id": "", "f2.dmi-uuid": "", "f2.smbios-uuid": "", "f3.udev-seri": "", "f3.sysfs-aygit-seri": "", "f3.sysfs-seri": "", "f3.sysfs-wwid": "", "f4.dmi-sistem": "", "f4.smbios-sistem": "", "f4.dmi-anakart": "", "f4.smbios-anakart": "" }),
    t("linux DMI yalnız root'a açık (servis kullanıcısı) → f2/f4 OKUNAMADI", "linux", ile(l, { "f2.dmi-uuid": null, "f2.smbios-uuid": null, "f4.dmi-sistem": null, "f4.smbios-sistem": null, "f4.dmi-anakart": null, "f4.smbios-anakart": null })),
    t("linux udev yok → sysfs aygıt serisi", "linux", ile(l, { "f3.udev-seri": "" })),
    t("linux udev okunamadı → f3 OKUNAMADI (sysfs'e geçilmez)", "linux", ile(l, { "f3.udev-seri": null })),
    t("linux yalnız wwid", "linux", ile(l, { "f3.udev-seri": "", "f3.sysfs-aygit-seri": "", "f3.sysfs-seri": "" })),
    t("linux SMBIOS ham yapı UUID'si DMI ile çelişir → DMI kazanır, çelişki bilgisi", "linux", ile(l, { "f2.smbios-uuid": UUID2 })),
    t("linux machine-id yok, dbus kopyası var", "linux", ile(l, { "f1.machine-id": "" })),
    t("darwin ioreg okundu", "darwin", { "f1.ioreg-uuid": UUID.toUpperCase(), "f4.ioreg-seri": "C02XK1ABJG5J" }),
    t("darwin ioreg düştü", "darwin", { "f1.ioreg-uuid": null, "f4.ioreg-seri": null }),
    t("platform tabloda yok → dört etken OKUNAMADI", null, w),
  ];
}

/** Sondanın satır biçimi (PS 5.1 `ConvertTo-Json -Compress`); `v` bilerek ham. */
const satir = (y: string, v: string | null): string => (v === null ? `{"h":1,"y":"${y}"}` : JSON.stringify({ y, v }));

function windowsCiktiVektorleri(): VektorToplama[] {
  const w = windowsTam();
  const tam = Object.entries(w).map(([y, v]) => satir(y, v));
  const c = (ad: string, stdout: string): VektorToplama => ({ tur: "windowsCikti", ad, stdout });
  return [
    c("tam çıktı, CRLF", `${tam.join("\r\n")}\r\n`),
    c("⭐ zaman aşımı: kayıt defteri satırları geldi, son satır yarım kaldı", `${tam.slice(0, 4).join("\r\n")}\r\n{"y":"f2.cim","v":"7C3E`),
    c("çöp satırlar yok sayılır (BOM · düz metin · dizi · null · sayı · y'siz · y metin değil)", ["\uFEFF" + tam[0], "Get-Disk : Access denied", "[1,2]", "null", "42", '{"v":"x"}', '{"y":5,"v":"x"}', tam[1]].join("\n")),
    c("aynı yolun İLK satırı kazanır (hata önce gelirse hata)", [satir("f2.cim", null), satir("f2.cim", UUID), satir("f1.kayit", GUID), satir("f1.kayit", UUID2)].join("\n")),
    c("v metin değilse hata; v ile h birlikteyse v", ['{"y":"f1.kayit","v":123}', '{"y":"f1.kayit-net64","v":null}', `{"y":"f2.cim","h":1,"v":"${UUID}"}`].join("\n")),
    c("⭐ tek başına vekil taşıyan satır iki uygulamada da yok sayılır", ['{"y":"f4.cim-bios","v":"\\ud800PF2"}', satir("f4.cim-bios", BIOS), '{"y":"f4.wmi-bios","v":"PF2","x":"\\udc00"}'].join("\n")),
    c("JSON kaçışları ve tam genişlik karakterler (NFKC)", ['{"y":"f4.cim-bios","v":"PF2\\u0027AB\\u00e9CDE"}', satir("f4.wmi-bios", "ＰＦ２ＡＢＣＤＥ"), satir("f4.smbios-sistem", "PF2ABCDE")].join("\n")),
    c("boş ve yalnız boşluklu satırlar (NBSP dahil)", ["", "   ", "\u00a0", tam[0], "\t", tam[2]].join("\n")),
    c("hiç çıktı yok", ""),
  ];
}

/** SMBIOS yapısı: başlık (tür, uzunluk, tutamak) + biçimli alan + metinler + `\0\0`. */
function yapi(tur: number, uzunluk: number, alan: Record<number, number[]>, metinler: string[] | null): string {
  const b = new Array<number>(uzunluk).fill(0);
  b[0] = tur;
  b[1] = uzunluk;
  b[2] = 0x01;
  for (const [ofs, deger] of Object.entries(alan)) deger.forEach((x, i) => (b[Number(ofs) + i] = x));
  const govde = metinler === null ? [] : metinler.length === 0 ? [0, 0] : [...Buffer.from(`${metinler.join("\0")}\0\0`, "utf8")];
  return Buffer.from([...b, ...govde]).toString("hex");
}

function smbiosVektorleri(): VektorToplama[] {
  const uuid = [0xd2, 0x91, 0x3e, 0x7c, 0xaf, 0x58, 0x06, 0x4b, 0x9e, 0x21, 0xc4, 0xd8, 0xa1, 0xf0, 0x5b, 0x37];
  const s = (ad: string, hex: string): VektorToplama => ({ tur: "smbios", ad, hex });
  return [
    s("tip 1 tam: seri 4. metin, UUID 2.6+ bayt sırası", yapi(1, 0x1b, { 4: [1, 2, 3, 4], 8: uuid }, ["LENOVO", "20S1S1UJ0R", "ThinkPad", BIOS])),
    s("tip 2 anakart serisi", yapi(2, 0x0f, { 4: [1, 2, 3, 4] }, ["LENOVO", "20S1S1UJ0R", "SDK0J40697", ANAKART])),
    s("metin bölümü yok (biçimli alanın ardından 00 00)", yapi(1, 0x1b, { 7: [0], 8: uuid }, [])),
    s("seri indeksi 0 → boş", yapi(1, 0x1b, { 4: [1, 2, 3, 0], 8: uuid }, ["A", "B", "C"])),
    s("seri indeksi metin sayısından büyük → boş", yapi(2, 0x0f, { 7: [9] }, ["A", "B"])),
    s("kısa yapı: UUID alanı yok", yapi(1, 0x08, { 7: [1] }, [BIOS])),
    s("sonlanmamış metin bölümü", Buffer.concat([Buffer.from(yapi(1, 0x1b, { 7: [1], 8: uuid }, null), "hex"), Buffer.from(`${BIOS}\0YARIM`)]).toString("hex")),
    s("geçersiz UTF-8 baytı U+FFFD olur", Buffer.concat([Buffer.from(yapi(2, 0x0f, { 7: [1] }, null), "hex"), Buffer.from([0x50, 0x46, 0xff, 0x32, 0x41, 0x42, 0, 0])]).toString("hex")),
    s("uzunluk < 4", "0103000000"),
    s("uzunluk dosyadan büyük", "01200100"),
    s("boş dosya", ""),
  ];
}

export function vektorleriKurToplama(): VektorToplama[] {
  return [...toplamaVektorleri(), ...windowsCiktiVektorleri(), ...smbiosVektorleri()];
}

export function vektorToplamaDosyasiUret(): VektorToplamaDosyasi {
  return {
    bicim: VEKTOR_TOPLAMA_BICIMI,
    not: "Üreten: Teks-Erp/scripts/test_lisans_native_kahin.ts --vektor-yaz --yalniz-toplama (TS kâhini, parmak izi çok yollu toplama, L2-10). Elle düzenlenmez; cargo tests/toplama.rs tüketir.",
    tuz: b64uEncode(TOPLAMA_TUZU),
    kayitlar: vektorleriKurToplama().map((vektor) => ({ vektor, beklenen: degerlendirToplama(vektor) })),
  };
}
