// =============================================================================
// BEKÇİ: Master-data adları DB'ye BÜYÜK harfle yazılır (2026-08-19)
// Çalıştır: npx tsx scripts/test_name_uppercase_storage.ts
// =============================================================================
// Saha talebi: müşteri / kumaş / renk / fason firma vb. HER ŞEY büyük harfle
// kaydedilsin. Aynı ad üç yazımla giriliyordu ("öz şahin", "Öz Şahin",
// "ÖZ ŞAHİN") ve mükerrer görünmüyordu.
//
// ⚠️ İKİ CEPHE, ikisi de gerekli:
//   A) DAVRANIŞ — yazma yolları gerçekten büyütüyor mu (BaseService + kendi
//      create'ini yazan servisler).
//   B) SÖZLEŞME — depolanan biçim, mükerrer kontrolünün katlamasıyla AYNI mı.
//      Ayrışırlarsa "aynı ada izin verme" kontrolü kendi yazdığı kaydı
//      bulamaz; hata sessizdir ve ancak sahada mükerrer olarak görünür.
//
// ⚠️ Türkçe: `toLocaleUpperCase("tr")` ZORUNLU — "iplik" → "İPLİK" olmalı,
// "IPLIK" DEĞİL. Barkod/kod tarafında kural TERSİDİR (ASCII), karıştırma.
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import {
  normalizeDisplayName,
  foldNameForCompare,
} from "../src/services/helpers/name-normalize.helper";

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean, extra = ""): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`);
  } else {
    fail++;
    console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`);
  }
}

const SUFFIX = `NUP${Date.now().toString().slice(-8)}`;
const cleanup: { customerIds: string[]; subIds: string[] } = { customerIds: [], subIds: [] };

// ── A) Saf kural ────────────────────────────────────────────────────────────
function testHelper(): void {
  console.log("\n── A) normalizeDisplayName ──");
  check("küçük → BÜYÜK", normalizeDisplayName("öz şahin tekstil") === "ÖZ ŞAHİN TEKSTİL");
  check(
    "Türkçe i doğru döner (İPLİK, IPLIK değil)",
    normalizeDisplayName("iplik") === "İPLİK",
    normalizeDisplayName("iplik"),
  );
  check("ı → I", normalizeDisplayName("ışık") === "IŞIK", normalizeDisplayName("ışık"));
  check("çoklu boşluk teklenir", normalizeDisplayName("  a   b  ") === "A B");
  check("idempotent", normalizeDisplayName(normalizeDisplayName("Öz Şahin")) === "ÖZ ŞAHİN");

  // B) SÖZLEŞME — 2026-08-19'da DEĞİŞTİ: depolama ≡ karşılaştırma anahtarı DEĞİL,
  // ama ayrışma da mümkün DEĞİL.
  //
  // ESKİ KURAL: `normalizeDisplayName` çıktısı `foldNameForCompare` ile BİREBİR
  // aynı olmalıydı — çünkü ikisi de elle yazılmış iki ayrı fonksiyondu ve
  // ayrışırlarsa mükerrer kontrolü kendi yazdığı kaydı bulamazdı.
  //
  // YENİ KURAL: mükerrer anahtarı artık DB'de `<kolon>Fold` GENERATED kolonudur
  // ve DEPOLANAN DEĞERDEN türetilir (`GENERATED ALWAYS AS (tr_fold(name)) STORED`).
  // İki fonksiyonu elle hizada tutmak yerine PostgreSQL türetiyor → "ayrışabilir"
  // ihtimali ortadan kalktı. Depolama BÜYÜK harf (görünüm), anahtar küçük ASCII
  // (arama/mükerrer); FARKLI olmaları doğrudur.
  //
  // Bu yüzden test artık eşitliği değil DOĞRU İLİŞKİYİ ölçer:
  //   fold(normalize(x)) === fold(x)   — normalize etmek anahtarı DEĞİŞTİRMEZ.
  // Bu, kontrolün kendi yazdığı kaydı bulacağının garantisidir ve DB'nin
  // türetmesiyle birebir aynı şeyi söyler.
  for (const s of ["öz şahin", "Öz Şahin", "ÖZ  ŞAHİN", "iplik", "ışık", "SAHIN", "ŞAHİN"]) {
    check(
      `normalize anahtarı değiştirmiyor: "${s}"`,
      foldNameForCompare(normalizeDisplayName(s)) === foldNameForCompare(s),
      `${normalizeDisplayName(s)} → ${foldNameForCompare(s)}`,
    );
  }
  // D3 (kullanıcı kararı): ASCII yazım da AYNI kayda düşer.
  check(
    'mükerrer anahtarı ASCII katlar: "ŞAHİN" ≡ "SAHIN"',
    foldNameForCompare("ŞAHİN TEKSTİL") === foldNameForCompare("SAHIN TEKSTIL"),
    foldNameForCompare("ŞAHİN TEKSTİL"),
  );
  check(
    "depolama BÜYÜK kalır (anahtar küçüktür — ikisi farklı olmalı)",
    normalizeDisplayName("öz şahin") === "ÖZ ŞAHİN" &&
      foldNameForCompare("öz şahin") === "oz sahin",
  );
}

// ── B) Gerçek yazma yolları ─────────────────────────────────────────────────
async function testWritePaths(): Promise<void> {
  console.log("\n── B) Yazma yolları ──");

  // BaseService yolu — müşteri (duplicateNameField: "name")
  // Servis config'i route dosyasında kuruluyor; testte AYNI alanlarla kurulur
  // (route'u import etmek tüm Express zincirini ayağa kaldırırdı).
  const { CustomerService } = await import("../src/services/customer.service");
  const svc = new CustomerService({
    model: prisma.customer,
    modelName: "customer",
    tableName: "CUSTOMER",
    searchFields: ["name"],
    codeSearchFields: ["code"],
    uniqueField: "code",
    duplicateNameField: "name",
    entityLabel: "müşteri",
  } as never);
  const res = (await svc.create(
    { code: `TEST-${SUFFIX}`, name: `öz şahin ${SUFFIX} iplik` },
    undefined,
  )) as { data?: { id: string; name: string } };
  const created = res.data;
  if (created?.id) cleanup.customerIds.push(created.id);
  check(
    "BaseService.create adı BÜYÜK yazdı",
    created?.name === `ÖZ ŞAHİN ${SUFFIX} İPLİK`,
    created?.name,
  );

  // DB'den taze oku — dönen nesne değil, GERÇEKTEN yazılan değer ölçülür.
  const row = created?.id
    ? await prisma.customer.findUnique({ where: { id: created.id }, select: { name: true } })
    : null;
  check("DB'deki değer de BÜYÜK", row?.name === `ÖZ ŞAHİN ${SUFFIX} İPLİK`, row?.name ?? "-");

  // update yolu ayrı kapıdır — create'i düzeltip update'i unutmak kolay.
  if (created?.id) {
    const upd = (await svc.update(created.id, { name: `yeni ad ${SUFFIX}` }, undefined)) as {
      data?: { name: string };
    };
    check("BaseService.update adı BÜYÜK yazdı", upd.data?.name === `YENİ AD ${SUFFIX}`, upd.data?.name);
  }

  // Kendi create'ini yazan servis — fason firma (BaseService KULLANMAZ)
  const { SubcontractorManagementService } = await import(
    "../src/services/subcontractor-management.service"
  );
  const subSvc = new SubcontractorManagementService();
  const cat = await prisma.subcontractorCategory.findFirst({
    where: { isActive: true },
    select: { id: true },
  });
  if (cat) {
    const sres = (await subSvc.create(
      { code: `TEST-S-${SUFFIX}`, name: `çınar boya ${SUFFIX}`, categoryIds: [cat.id] },
      undefined,
    )) as { data?: { id: string; name: string } };
    if (sres.data?.id) cleanup.subIds.push(sres.data.id);
    check(
      "fason firma (BaseService'siz yol) BÜYÜK yazdı",
      sres.data?.name === `ÇINAR BOYA ${SUFFIX}`,
      sres.data?.name,
    );
  } else {
    check("fason kategorisi bulundu", false, "aktif kategori yok — bölüm atlandı");
  }
}

async function main(): Promise<void> {
  console.log("=== Ad BÜYÜK harf depolama bekçisi ===");
  try {
    testHelper();
    await testWritePaths();
  } catch (err) {
    fail++;
    console.error("Beklenmeyen hata:", err);
  } finally {
    await prisma.subcontractorToCategory
      .deleteMany({ where: { subcontractorId: { in: cleanup.subIds } } })
      .catch(() => {});
    await prisma.subcontractor.deleteMany({ where: { id: { in: cleanup.subIds } } }).catch(() => {});
    await prisma.customer.deleteMany({ where: { id: { in: cleanup.customerIds } } }).catch(() => {});
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Beklenmeyen hata:", err);
  process.exit(1);
});
