// =============================================================================
// BEKÇİ — YETKİ ATAMASININ KAYNAĞI ve TOKEN TAZELEME (BULGU-T2-012)
// Çalıştır: npx tsx scripts/test_permission_grant_source.ts
// =============================================================================
// Yetkiler JWT'den okunur, DB'den tazelenmez (`auth.middleware` → `req.user =
// payload`). Bu yüzden bir yetkiyi DB'ye yazmak YETMEZ: `tokenVersion`
// artırılmazsa kullanıcı oturumunu kapatana kadar yeni yetkiyi KULLANAMAZ —
// panel ve DB "yetki var" derken uç 403 döner ve yönetici bunu teşhis edemez.
//
// Sahada ölçüldü (2026-08-31): `grantedById IS NULL` olan 24 atama var (4 izin ×
// 6 kullanıcı), hepsi 2026-08-05'teki iki ham-SQL koşumundan — aralarında
// SoD-kritik `shipping:undo-dispatch`. O satırlar hem token tazelemesini hem de
// "bu yetkiyi kim verdi" cevabını atlamış.
//
// ⚠️ `grantedById` kolonuna NOT NULL KONMAZ: tarihsel satırlar meşrudur ve
// silinemez. Çözüm görünürlük + tekrarın engellenmesi:
//   §1 `listPermissions()` kaynağı bilinmeyen atamayı SAYAR (panel bant basabilsin)
//   §2 SERVİS yolu `tokenVersion`ı GERÇEKTEN artırır (F255 regresyon kilidi —
//      bugüne dek bu değişmezin hiçbir bekçisi YOKTU)
//   §3 ops/sync betikleri ham yazıyorsa tokenVersion'ı ELLE artırır
// =============================================================================
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import prisma, { pool } from "../src/lib/prisma";
import { AuthService } from "../src/services/auth.service";
import { PermissionManagementService } from "../src/services/permission-management.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/**
 * Ham `userPermission` yazan ama tokenVersion artırması GEREKMEYEN betikler.
 * ⚠️ Gerekçe "tohum/fixture": taze bir veritabanında ya da yeni yaratılan bir
 * kullanıcıda henüz dağıtılmış token YOKTUR, bayatlayacak bir şey de yoktur.
 */
const MUAFLAR: Record<string, string> = {
  "seed-return.ts": "tohum betiği — taze DB, dağıtılmış token yok",
  "fixture-test-user.ts": "test fixture'ı — kullanıcıyı YARATIP hemen yetkilendirir, token sonra alınır",
};

async function main(): Promise<void> {
  // ═══ §1 — KAYNAĞI BİLİNMEYEN ATAMA SAYACI ═══
  console.log("\n=== §1: listPermissions kaynaksız atamayı sayıyor ===");
  const rows = (await PermissionManagementService.listPermissions()) as Array<{
    id: string;
    code: string;
    userCount: number;
    unknownSourceCount: number;
  }>;
  check("§1: izin listesi okundu (körlük zemini)", rows.length > 30, `${rows.length} izin`);
  check(
    "§1: sözleşmede `unknownSourceCount` alanı var",
    rows.every((r) => typeof r.unknownSourceCount === "number"),
  );
  // ⭐ Sayı DOĞRU mu — alanın varlığı yetmez, DEĞERİ de ölçülür.
  const gercek = await prisma.userPermission.groupBy({
    by: ["permissionId"],
    where: { grantedById: null },
    _count: { _all: true },
  });
  const beklenen = new Map(gercek.map((g) => [g.permissionId, g._count._all]));
  const sapan = rows.filter((r) => (beklenen.get(r.id) ?? 0) !== r.unknownSourceCount);
  check(
    "§1: sayaç DB ile birebir",
    sapan.length === 0,
    sapan.length ? sapan.slice(0, 3).map((r) => r.code).join(", ") : `${beklenen.size} izinde kaynaksız atama var`,
  );
  check(
    "§1: sayaç kaynaksız atama YOKKEN 0 döner (vakumen dolu değil)",
    rows.some((r) => r.unknownSourceCount === 0),
  );

  // ═══ §2 — SERVİS YOLU tokenVersion'ı ARTIRIR (F255) ═══
  console.log("\n=== §2: servis yolu token tazeliyor ===");
  const damga = `TST-GRANT-${Date.now().toString().slice(-8)}`;
  const olusan: string[] = [];
  try {
    const u = await prisma.user.create({
      data: {
        username: damga,
        fullName: `${damga} kullanıcı`,
        passwordHash: await AuthService.hashPassword("test123456"),
      },
      select: { id: true, tokenVersion: true },
    });
    olusan.push(u.id);
    const izin = await prisma.permission.findFirst({
      where: { code: "roll:read" },
      select: { id: true },
    });
    if (!izin) throw new Error("fixture eksik: roll:read izni yok");

    await PermissionManagementService.setUserPermissions(u.id, [izin.id], undefined);
    const sonra = await prisma.user.findUnique({
      where: { id: u.id },
      select: { tokenVersion: true },
    });
    check(
      "§2: yetki verilince tokenVersion ARTAR (eski token geçersizleşir)",
      (sonra?.tokenVersion ?? 0) > u.tokenVersion,
      `${u.tokenVersion} → ${sonra?.tokenVersion}`,
    );
    // Aktör verildiğinde kaynak KAYDEDİLİR — "kim verdi" cevapsız kalmaz.
    const satir = await prisma.userPermission.findFirst({
      where: { userId: u.id, permissionId: izin.id },
      select: { grantedById: true },
    });
    check(
      "§2: servis yolu atamayı KAYNAKSIZ bırakmaz (aktör verildiyse yazar)",
      satir !== null,
      satir?.grantedById === null ? "aktör verilmedi → null (beklenen)" : "aktör yazıldı",
    );
  } finally {
    await prisma.userPermission.deleteMany({ where: { userId: { in: olusan } } }).catch(() => undefined);
    await prisma.systemLog.deleteMany({ where: { userId: { in: olusan } } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: { in: olusan } } }).catch(() => undefined);
  }

  // ═══ §3 — OPS BETİKLERİ (iki yönlü) ═══
  console.log("\n=== §3: ham yazan ops betikleri token tazeliyor ===");
  const dizin = join(__dirname);
  const hepsi = readdirSync(dizin).filter((f) => f.endsWith(".ts"));
  const opsYazanlar: string[] = [];
  const eksik: string[] = [];
  for (const f of hepsi) {
    // Test ve repro betikleri KAPSAM DIŞI: kendi kullanıcısını yaratıp hemen
    // yetkilendirirler, ortada bayatlayacak dağıtılmış token yoktur. Onları da
    // işaretlemek 200+ dosyayı kırmızıya çevirip bekçiyi devre dışı bıraktırırdı.
    if (f.startsWith("test_") || f.startsWith("audit_repro_")) continue;
    const kod = readFileSync(join(dizin, f), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    if (!/userPermission\.(create|upsert|createMany)/.test(kod)) continue;
    opsYazanlar.push(f);
    if (f in MUAFLAR) continue;
    if (!kod.includes("tokenVersion")) eksik.push(f);
  }
  check("§3: ham yazan ops betiği bulundu (körlük zemini)", opsYazanlar.length >= 3, opsYazanlar.join(", "));
  check(
    "§3a: ham yazan HER ops betiği tokenVersion artırıyor",
    eksik.length === 0,
    eksik.join(", ") || "hepsi tazeliyor ya da gerekçeli muaf",
  );
  const oluMuaf = Object.keys(MUAFLAR).filter((m) => !opsYazanlar.includes(m));
  check("§3b: ölü muaf yok", oluMuaf.length === 0, oluMuaf.join(", ") || "muaf listesi güncel");
}

main()
  .catch((e) => {
    console.error("Beklenmeyen hata:", e);
    fail++;
  })
  .finally(async () => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
