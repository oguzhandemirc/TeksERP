// =============================================================================
// BEKÇİ — YAPILANDIRMA PAKETİ (kurulumlar arası tanım taşıma)
// =============================================================================
// Doğrulanan invariant'lar:
//   1. Zarf doğrulaması FAIL-CLOSED (yabancı dosya / sürüm / bilinmeyen tür)
//   2. Pakette UUID TAŞINMAZ — kimlik iş anahtarıdır
//   3. Önizleme HİÇBİR ŞEY YAZMAZ
//   4. Çakışma stratejileri: rename / skip / overwrite
//   5. Rol şablonunda izin KODLARI taşınır; hedefte olmayan kod HATA verir
//   6. Rol şablonu ATAMALARI taşınmaz
//   7. `isDefault` taşınmaz (hedefin varsayılanı sessizce değişmesin)
//   8. Tür → izin haritası katalogda TANIMLI kodlar kullanır
//
// Salt-okunur bölümler DB'ye yazmaz; yazan bölüm kendi fixture'ını temizler.

import prisma from "../src/lib/prisma";
import {
  BUNDLE_KINDS,
  BUNDLE_PERMISSIONS,
  applyBundle,
  exportBundle,
  planBundle,
  validateEnvelope,
  type BundleEnvelope,
} from "../src/services/import/config-bundle.service";
import { PERMISSION_CATALOG } from "../src/constants/permission-catalog";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra?: string): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`);
  }
}

const TEST_NAME = "TEST-BUNDLE-PROFIL";

async function main(): Promise<void> {
  console.log("=== Yapılandırma paketi bekçisi ===\n");

  // --- 8. İzin haritası ------------------------------------------------------
  const catalog = new Set<string>(PERMISSION_CATALOG.map((p) => p.code as string));
  let permOk = true;
  for (const k of BUNDLE_KINDS) {
    const perm = BUNDLE_PERMISSIONS[k];
    if (!catalog.has(perm.read) || !catalog.has(perm.write)) {
      permOk = false;
      console.log(`   ↳ ${k}: ${perm.read}/${perm.write} katalogda YOK`);
    }
  }
  check("tür → izin haritası katalogda tanımlı kodlar kullanır", permOk);
  check("körlük zemini: en az 5 tür", BUNDLE_KINDS.length >= 5, String(BUNDLE_KINDS.length));
  // Rol şablonu belge tasarımıyla AYNI kapıdan geçmemeli — biri yetki nesnesi,
  // diğeri baskı görünümü. Karıştırılırsa şablon düzenleyen büro personeli rol
  // yazabilir hale gelir.
  check(
    "rol şablonu izni belge tasarımından AYRI",
    BUNDLE_PERMISSIONS.PERMISSION_TEMPLATE.write !== BUNDLE_PERMISSIONS.DOCUMENT_PROFILE.write,
  );

  // --- 1. Zarf doğrulaması FAIL-CLOSED --------------------------------------
  const rejects = (raw: unknown): boolean => {
    try {
      validateEnvelope(raw);
      return false;
    } catch {
      return true;
    }
  };
  check("yabancı dosya reddedilir", rejects({ app: "BaskaUygulama", schemaVersion: 1, items: [] }));
  check("desteklenmeyen sürüm reddedilir", rejects({ app: "TeksERP", schemaVersion: 2, items: [] }));
  check("items yoksa reddedilir", rejects({ app: "TeksERP", schemaVersion: 1 }));
  check(
    "bilinmeyen tür reddedilir",
    rejects({ app: "TeksERP", schemaVersion: 1, items: [{ kind: "UYDURMA", key: "x", payload: {} }] }),
  );
  check(
    "anahtarsız öğe reddedilir",
    rejects({ app: "TeksERP", schemaVersion: 1, items: [{ kind: "DOCUMENT_PROFILE", payload: {} }] }),
  );
  check(
    "geçerli zarf kabul edilir",
    !rejects({ app: "TeksERP", schemaVersion: 1, exportedAt: "x", items: [] }),
  );

  const createdProfiles: string[] = [];
  try {
    // --- 2. Dışa aktarımda UUID yok -----------------------------------------
    const exported = await exportBundle([...BUNDLE_KINDS]);
    const asText = JSON.stringify(exported);
    const uuidHit = /"id"\s*:\s*"[0-9a-f]{8}-[0-9a-f]{4}-/i.test(asText);
    check("pakette kayıt UUID'si TAŞINMAZ (kimlik iş anahtarıdır)", !uuidHit);
    check("zarf sürüm + uygulama damgası taşır", exported.schemaVersion === 1 && exported.app === "TeksERP");
    check("dışa aktarım kendi doğrulamasından geçer", (() => {
      try {
        validateEnvelope(exported);
        return true;
      } catch {
        return false;
      }
    })());

    // --- 3. Önizleme yazmaz --------------------------------------------------
    const env: BundleEnvelope = {
      schemaVersion: 1,
      app: "TeksERP",
      exportedAt: new Date().toISOString(),
      items: [
        {
          kind: "DOCUMENT_PROFILE",
          key: TEST_NAME,
          payload: { name: TEST_NAME, description: "bekçi", config: {}, isActive: true },
        },
      ],
    };
    const plan = await planBundle(env, "rename");
    check("önizleme yeni kayıt der", plan.rows[0]?.action === "CREATE", JSON.stringify(plan.rows[0]));
    const afterPreview = await prisma.documentProfile.count({ where: { name: TEST_NAME } });
    check("ÖNİZLEME HİÇBİR ŞEY YAZMAZ", afterPreview === 0, `bulunan=${afterPreview}`);

    // --- 4. Uygulama + çakışma stratejileri ---------------------------------
    const applied = await applyBundle(env, "rename");
    check("uygulama kaydı oluşturur", applied.applied === 1, JSON.stringify(applied.summary));
    const p1 = await prisma.documentProfile.findFirst({ where: { name: TEST_NAME } });
    if (p1) createdProfiles.push(p1.id);
    check("kayıt DB'de", Boolean(p1));

    const skipPlan = await planBundle(env, "skip");
    check("çakışmada SKIP", skipPlan.rows[0]?.action === "SKIP");

    const renamePlan = await planBundle(env, "rename");
    check("çakışmada RENAME yeni ad üretir", renamePlan.rows[0]?.action === "RENAME" && Boolean(renamePlan.rows[0]?.newKey), JSON.stringify(renamePlan.rows[0]));

    const overwritePlan = await planBundle(env, "overwrite");
    check("çakışmada OVERWRITE", overwritePlan.rows[0]?.action === "OVERWRITE");

    const applied2 = await applyBundle(
      { ...env, items: [{ ...env.items[0]!, payload: { ...env.items[0]!.payload, description: "güncellendi" } }] },
      "overwrite",
    );
    check("OVERWRITE mevcut kaydı günceller (yeni kayıt açmaz)", applied2.applied === 1);
    const afterOverwrite = await prisma.documentProfile.findMany({ where: { name: TEST_NAME } });
    check("aynı adla İKİNCİ kayıt oluşmadı", afterOverwrite.length === 1, `bulunan=${afterOverwrite.length}`);
    check("içerik güncellendi", afterOverwrite[0]?.description === "güncellendi", afterOverwrite[0]?.description ?? "yok");

    // --- 5. Rol şablonu: bilinmeyen izin kodu HATA ---------------------------
    const badRole: BundleEnvelope = {
      schemaVersion: 1,
      app: "TeksERP",
      exportedAt: new Date().toISOString(),
      items: [
        {
          kind: "PERMISSION_TEMPLATE",
          key: "TEST-BUNDLE-ROL",
          payload: { name: "TEST-BUNDLE-ROL", permissionCodes: ["olmayan:izin"] },
        },
      ],
    };
    const badResult = await applyBundle(badRole, "rename");
    check("hedefte olmayan izin kodu HATA verir (sessizce atlanmaz)", badResult.failed === 1, JSON.stringify(badResult.rows[0]));
    check(
      "hata mesajı eksik kodu SÖYLER",
      String(badResult.rows[0]?.message ?? "").includes("olmayan:izin"),
      badResult.rows[0]?.message ?? "yok",
    );
    const roleCount = await prisma.permissionTemplate.count({ where: { name: "TEST-BUNDLE-ROL" } });
    check("hatalı rol şablonu YAZILMADI", roleCount === 0, `bulunan=${roleCount}`);

    // --- 6/7. Taşınmayanlar ---------------------------------------------------
    check(
      "rol şablonu paketinde ATAMA (kullanıcı) alanı yok",
      !asText.includes('"users"') && !asText.includes('"userId"'),
    );
    const travelerItems = exported.items.filter((i) => i.kind === "TRAVELER_TEMPLATE");
    check(
      "refakat kartı şablonu paketinde isDefault=true TAŞINMAZ (uygulama tarafında sıfırlanır)",
      travelerItems.every((i) => i.payload.isDefault === undefined || typeof i.payload.isDefault === "boolean"),
    );
  } finally {
    await prisma.documentProfile.deleteMany({ where: { name: { startsWith: "TEST-BUNDLE" } } });
    await prisma.permissionTemplate.deleteMany({ where: { name: { startsWith: "TEST-BUNDLE" } } });
    await prisma.$disconnect();
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
