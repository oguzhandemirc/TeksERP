// SÖZLÜK BEKÇİSİ: ekranda ham kod/enum görünmesin. §1 bulut kataloğundaki (üretilmiş `katalog-ozeti.json`) her izin
// kodu izin sözlüğünde · §2 teldeki (`wire.ts`) durum/tür değerlerinin hepsi sözlükte · §3 bilinmeyen değer ham döner.
import { readFileSync } from "fs";
import { join } from "path";
import { INBOX_STATUSES, NOTIFICATION_KINDS, NOTIFICATION_STATUSES, REPORT_STATUSES } from "../src/api/wire";
import { STATUS_DICT, lookup, statusEntry } from "../src/lib/labels";
import { ACCOUNT_TEMPLATE, ACCOUNT_TEMPLATES, EXPORT_DATASET_LABEL, INBOX_KIND, NOTIFICATION_KIND, devicePlatform, inboxKind, notificationKind } from "../src/lib/labels/diger";
import { PERMISSION_GROUPS, PERMISSION_LABEL, groupPermissions, permissionLabel } from "../src/lib/labels/izin";

const ROOT = join(__dirname, "..");
const OZET = JSON.parse(readFileSync(join(ROOT, "..", "sunucu", "src", "catalog", "katalog-ozeti.json"), "utf8")) as { CLOUD_PERMISSIONS: string[]; ROOT_PROJECTIONS: { name: string }[] };
const WIRE = readFileSync(join(ROOT, "src", "api", "wire.ts"), "utf8");
const EXPORT_SRC = readFileSync(join(ROOT, "..", "sunucu", "src", "services", "export.service.ts"), "utf8");
const PERMS_SRC = readFileSync(join(ROOT, "..", "sunucu", "src", "catalog", "permissions.ts"), "utf8");

/** `export type X = "A" | "B";` birleşiminin değerleri (tip çalışma anında yok; metinden okunur). */
function unionOf(name: string): string[] {
  const m = new RegExp(`export type ${name} = ([^;]+);`).exec(WIRE);
  const values = m ? [...m[1]!.matchAll(/"([A-Z_]+)"/g)].map((x) => x[1]!) : [];
  expect(values.length).toBeGreaterThan(1); // desen körleşirse boş küme sahte yeşil verir
  return values;
}

describe("§1 izin sözlüğü ↔ bulut kataloğu", () => {
  it("katalogdaki her izin kodu sözlükte (Türkçe ad + açıklama + grup)", () => {
    expect(OZET.CLOUD_PERMISSIONS.length).toBeGreaterThan(10);
    const missing = OZET.CLOUD_PERMISSIONS.filter((c) => !PERMISSION_LABEL[c]);
    expect(missing).toEqual([]);
    for (const c of OZET.CLOUD_PERMISSIONS) {
      const l = PERMISSION_LABEL[c]!;
      expect(l.ad).not.toMatch(/bulut:/);
      if (c !== "bulut:oturum") expect(l.aciklama.length).toBeGreaterThan(10);
      expect(PERMISSION_GROUPS.map((g) => g.key)).toContain(l.grup);
    }
  });
  it("sözlükte katalogda olmayan (ölü) kod yok", () => {
    expect(Object.keys(PERMISSION_LABEL).filter((c) => !OZET.CLOUD_PERMISSIONS.includes(c))).toEqual([]);
  });
  it("şablonlar sunucu ROLE_TEMPLATES anahtarlarıyla aynı", () => {
    const m = /ROLE_TEMPLATES:\s*Readonly<Record<([^,]+),/.exec(PERMS_SRC);
    const keys = m ? [...m[1]!.matchAll(/"([A-Z_]+)"/g)].map((x) => x[1]!) : [];
    expect(keys.length).toBeGreaterThan(1);
    expect([...ACCOUNT_TEMPLATES].sort()).toEqual([...keys].sort());
    expect(Object.keys(ACCOUNT_TEMPLATE).sort()).toEqual([...keys].sort());
  });
  it("gruplama: grup sırası sabit, boş grup düşer, kod kaybolmaz", () => {
    const g = groupPermissions(["bulut:hesap:yonet", "bulut:kasa:oku", "bulut:siparis:oku"]);
    expect(g.map((x) => x.ad)).toEqual(["Sipariş", "Finans", "Hesap yönetimi"]);
    expect(groupPermissions(OZET.CLOUD_PERMISSIONS).flatMap((x) => x.codes).sort()).toEqual([...OZET.CLOUD_PERMISSIONS].sort());
  });
});

describe("§2 tel değerleri sözlükte", () => {
  it("gelen kutusu, rapor, bildirim gönderimi ve hesap durumları STATUS_DICT'te", () => {
    const all = [...INBOX_STATUSES, ...REPORT_STATUSES, ...NOTIFICATION_STATUSES, ...unionOf("AccountStatus")];
    expect(all.filter((s) => !(s in STATUS_DICT))).toEqual([]);
    expect(statusEntry("PASIF").label).toBe("Arşiv");
  });
  it("gelen kutusu türleri ve bildirim türleri sözlükte", () => {
    expect(unionOf("InboxItemKind").filter((k) => !(k in INBOX_KIND))).toEqual([]);
    expect(NOTIFICATION_KINDS.filter((k) => !(k in NOTIFICATION_KIND))).toEqual([]);
  });
});

describe("§3 bilinmeyen değer ham döner", () => {
  it("izin, tür, platform, durum", () => {
    expect(permissionLabel("bulut:yeni:oku").ad).toBe("bulut:yeni:oku");
    expect(inboxKind("YENI").ad).toBe("YENI");
    expect(notificationKind("yeni-tur").ad).toBe("yeni-tur");
    expect(devicePlatform("tv").ad).toBe("tv");
    expect(statusEntry("YENI_DURUM")).toEqual({ label: "YENI_DURUM", tone: "bilgi" });
    expect(lookup({ A: "a" }, "B")).toBe("B");
    expect(inboxKind(undefined).ad).toBe("—");
  });
});

describe("§4 dışa aktarma küme adları sözlükte", () => {
  it("her kök projeksiyon ve bulutta doğan her küme Türkçe adlı; sözlükte ölü ad yok", () => {
    const cloud = [...EXPORT_SRC.matchAll(/name: "([a-z-]+)",\s*kind: "BULUT"/g)].map((x) => x[1]!);
    expect(cloud.length).toBeGreaterThan(2);
    const names = [...OZET.ROOT_PROJECTIONS.map((p) => p.name), ...cloud];
    expect(OZET.ROOT_PROJECTIONS.length).toBeGreaterThan(20);
    expect(names.filter((n) => !EXPORT_DATASET_LABEL[n])).toEqual([]);
    expect(Object.keys(EXPORT_DATASET_LABEL).filter((n) => !names.includes(n))).toEqual([]);
  });
});
