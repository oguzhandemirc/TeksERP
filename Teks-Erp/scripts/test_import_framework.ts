// =============================================================================
// BEKÇİ — TOPLU İÇE AKTARIM ÇERÇEVESİ
// =============================================================================
// Tasarım: docs/design/IMPORT-EXPORT-TASARIM.md
//
// Doğrulanan invariant'lar (her biri gerçek bir arıza sınıfına karşılık gelir):
//   1. Hücre dönüşümü: TR/EN sayı, tarih, Evet/Hayır, NULL sabiti
//   2. "Boş hücre = DOKUNMA" (D3) — kısmi dosya veri SİLMEZ
//   3. `NULL` = temizle
//   4. Önizleme HİÇBİR ŞEY YAZMAZ
//   5. Dosya-içi mükerrer anahtar reddedilir
//   6. Hata varsa (abort) HİÇBİR kayıt yazılmaz — kısmi yazma yok
//   7. autoCode modelinde DOLU + eşleşmeyen kod HATA (sessiz yeniden numaralama yok)
//   8. Servis guard'ları ATLANMAZ (ad mükerrer → hata)
//   9. Mevcut kayıt + aynı veri → SKIP (gereksiz UPDATE yok, `updatedAt` kaymaz)
//  10. `clientToken` idempotent — aynı deneme ikinci kez YAZMAZ
//  11. Registry izinleri katalogda TANIMLI
//  12. exportRows sütunları şablon sütunlarıyla AYNI (round-trip)
//
// Fixture: `TEST-IMP-` önekli renkler + kumaşlar. Cleanup `finally`de.

import prisma from "../src/lib/prisma";
import { ImportService } from "../src/services/import/import.service";
import { listAdapters, getImportAdapter } from "../src/services/import/import-registry";
import { PERMISSION_CATALOG } from "../src/constants/permission-catalog";
import { parseLocaleNumber, parseBool, parseDateCell, isClearLiteral } from "../src/services/import/import-coerce";

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

const PREFIX = "TEST-IMP";
const row = (rowNo: number, cells: Record<string, string>) => ({ rowNo, cells });

async function main(): Promise<void> {
  console.log("=== İçe aktarım çerçevesi bekçisi ===\n");

  // ---------------------------------------------------------------------------
  // 1. Hücre dönüşümü (saf fonksiyonlar — DB gerekmez)
  // ---------------------------------------------------------------------------
  console.log("--- 1. Hücre dönüşümü ---");
  check("TR sayı: 1.234,56 → 1234.56", parseLocaleNumber("1.234,56") === 1234.56);
  check("EN sayı: 1,234.56 → 1234.56", parseLocaleNumber("1,234.56") === 1234.56);
  check("tek virgül ondalıktır: 1234,5 → 1234.5", parseLocaleNumber("1234,5") === 1234.5);
  check("tam üç haneli grup binliktir: 1.234 → 1234", parseLocaleNumber("1.234") === 1234);
  check("kısa ondalık nokta korunur: 1.5 → 1.5", parseLocaleNumber("1.5") === 1.5);
  check("birim ayıklanır: '180 cm' → 180", parseLocaleNumber("180 cm") === 180);
  check("sayı olmayan → null", parseLocaleNumber("abc") === null);
  check("Evet/Hayır", parseBool("Evet") === true && parseBool("HAYIR") === false);
  check("Aktif/Pasif", parseBool("aktif") === true && parseBool("Pasif") === false);
  check("tanınmayan bool → null", parseBool("belki") === null);
  check("NULL sabiti tanınır", isClearLiteral("null") && isClearLiteral(" NULL "));
  const d = parseDateCell("19.08.2026");
  check("GG.AA.YYYY çözülür", d !== null && d.getTime() > 0);
  // Fabrika günü başı: yerel 00:00'ın MUTLAK karşılığı. UTC gece yarısı alınsaydı
  // gece vardiyası bir gün kayardı (constants/time.ts dersi).
  const istHour = d
    ? Number(
        new Intl.DateTimeFormat("en-US", {
          timeZone: "Europe/Istanbul",
          hour: "2-digit",
          hour12: false,
        }).format(d),
      )
    : -1;
  check("tarih fabrika gününün BAŞIdır (Istanbul 00:00)", istHour === 0, `saat=${istHour}`);
  check("geçersiz tarih → null", parseDateCell("32.13.2026") === null);

  // ---------------------------------------------------------------------------
  // 11. Registry izinleri katalogda tanımlı (statik — DB gerekmez)
  // ---------------------------------------------------------------------------
  console.log("\n--- 11. Registry ↔ izin kataloğu ---");
  const catalogCodes = new Set<string>(PERMISSION_CATALOG.map((p) => p.code as string));
  let permOk = true;
  for (const a of listAdapters()) {
    if (!catalogCodes.has(a.writePermission)) {
      permOk = false;
      console.log(`   ↳ ${a.entity}: writePermission '${a.writePermission}' katalogda YOK`);
    }
    if (!catalogCodes.has(a.readPermission)) {
      permOk = false;
      console.log(`   ↳ ${a.entity}: readPermission '${a.readPermission}' katalogda YOK`);
    }
  }
  check("tüm adaptör izinleri katalogda tanımlı", permOk);
  check("data:import katalogda var", catalogCodes.has("data:import"));
  // Körlük zemini: registry boşalırsa yukarıdaki kontrol VAKUMEN yeşil kalır.
  check("registry en az 10 adaptör taşıyor (körlük zemini)", listAdapters().length >= 10, `bulunan=${listAdapters().length}`);

  // Her adaptörün anahtar sütunu gerçekten TANIMLI bir sütun olmalı — yoksa
  // eşleşme sessizce hiç kurulmaz ve HER satır CREATE'e düşer.
  let keyOk = true;
  for (const a of listAdapters()) {
    const keys = new Set(a.columns.map((c) => c.key));
    for (const k of a.keyColumns) {
      if (!keys.has(k)) {
        keyOk = false;
        console.log(`   ↳ ${a.entity}: keyColumn '${k}' sütun listesinde YOK`);
      }
    }
  }
  check("her adaptörün anahtar sütunu tanımlı", keyOk);

  // Gruplu adaptörde EN AZ BİR `child` sütun olmalı; olmayan bir gruplu adaptör
  // sessizce "her satır ayrı kayıt" gibi davranmaz — grupları birleştirir ve
  // devam satırlarını YUTAR.
  let groupOk = true;
  for (const a of listAdapters().filter((x) => x.grouped)) {
    if (!a.columns.some((c) => c.child)) {
      groupOk = false;
      console.log(`   ↳ ${a.entity}: grouped=true ama child sütun YOK`);
    }
  }
  check("gruplu adaptörlerin child sütunu var", groupOk);

  // ---------------------------------------------------------------------------
  // Fixture
  // ---------------------------------------------------------------------------
  const created: string[] = [];
  try {
    console.log("\n--- 2-10. Canlı akış (renk adaptörü) ---");
    const uniq = `${PREFIX}-${Date.now().toString(36).toLocaleUpperCase("en-US")}`;
    const nameA = `${uniq}-A`;
    const nameB = `${uniq}-B`;

    // --- 4. Önizleme hiçbir şey yazmaz ---
    const prev = await ImportService.preview(
      "color",
      [row(2, { name: nameA, hex: "#112233" }), row(3, { name: nameB })],
      {},
    );
    check("önizleme iki satırı da CREATE der", prev.summary.create === 2, JSON.stringify(prev.summary));
    const afterPreview = await prisma.color.count({ where: { name: { startsWith: uniq } } });
    check("ÖNİZLEME HİÇBİR ŞEY YAZMAZ", afterPreview === 0, `bulunan=${afterPreview}`);

    // --- 5. Dosya-içi mükerrer anahtar ---
    // (Renkte anahtar `code` ve autoCode olduğu için mükerrerliği KOD üzerinden
    //  sınayamayız — kod boş bırakılır. Bunun yerine dolu-kod dalını sınıyoruz.)
    const dupPrev = await ImportService.preview(
      "color",
      [row(2, { code: "SAHTE-KOD-1", name: nameA }), row(3, { code: "SAHTE-KOD-1", name: nameB })],
      {},
    );
    const dupMsg = JSON.stringify(dupPrev.rows.map((r) => r.errors.map((e) => e.message)));
    check("dosya-içi mükerrer anahtar yakalanır", dupMsg.includes("satırda da var"), dupMsg.slice(0, 160));

    // --- 7. autoCode: dolu + eşleşmeyen kod HATA ---
    check(
      "autoCode modelinde eşleşmeyen DOLU kod HATA verir (sessiz yeniden numaralama yok)",
      dupMsg.includes("BOŞ bırakın"),
      dupMsg.slice(0, 200),
    );

    // --- 6. Hata varsa hiçbir şey yazılmaz (abort) ---
    let aborted = false;
    try {
      await ImportService.apply(
        "color",
        [row(2, { name: nameA }), row(3, { code: "SAHTE-KOD-2", name: nameB })],
        {},
      );
    } catch {
      aborted = true;
    }
    check("hatalı satır varsa apply 400 atar", aborted);
    const afterAbort = await prisma.color.count({ where: { name: { startsWith: uniq } } });
    check("ABORT'ta HİÇBİR kayıt yazılmaz (kısmi yazma yok)", afterAbort === 0, `bulunan=${afterAbort}`);

    // --- Gerçek uygulama ---
    const applied = await ImportService.apply(
      "color",
      [row(2, { name: nameA, hex: "#112233" }), row(3, { name: nameB })],
      { fileName: "bekçi.xlsx" },
    );
    check("apply iki kayıt oluşturur", applied.created === 2, JSON.stringify(applied));
    check("durum APPLIED", applied.status === "APPLIED");
    const colors = await prisma.color.findMany({ where: { name: { startsWith: uniq } } });
    created.push(...colors.map((c) => c.id));
    check("kayıtlar DB'de", colors.length === 2, `bulunan=${colors.length}`);
    const colA = colors.find((c) => c.name === nameA);
    check("kod SUNUCU tarafından üretildi (RNK…)", Boolean(colA?.code?.startsWith("RNK")), colA?.code ?? "yok");
    check("hex yazıldı", colA?.hex === "#112233", colA?.hex ?? "yok");
    check("ImportRun kaydı oluştu", Boolean(applied.runId));
    const runRow = await prisma.importRun.findUnique({ where: { id: applied.runId } });
    check("ImportRun dosya adını saklar", runRow?.fileName === "bekçi.xlsx", runRow?.fileName ?? "yok");

    // --- 9. Aynı veri tekrar → SKIP ---
    const same = await ImportService.preview(
      "color",
      [row(2, { code: colA!.code, name: nameA, hex: "#112233" })],
      {},
    );
    check("değişmeyen satır SKIP (gereksiz UPDATE yok)", same.summary.skip === 1, JSON.stringify(same.rows[0]));

    // --- 2. Boş hücre = DOKUNMA ---
    const untouched = await ImportService.apply(
      "color",
      [row(2, { code: colA!.code, name: "", hex: "" })],
      {},
    );
    const afterUntouched = await prisma.color.findUnique({ where: { id: colA!.id } });
    check("boş hücre alanı DEĞİŞTİRMEZ", afterUntouched?.hex === "#112233" && afterUntouched?.name === nameA);
    check("değişiklik yoksa skipped sayılır", untouched.skipped === 1, JSON.stringify(untouched));

    // --- 3. NULL = temizle ---
    await ImportService.apply("color", [row(2, { code: colA!.code, hex: "NULL" })], {});
    const cleared = await prisma.color.findUnique({ where: { id: colA!.id } });
    check("NULL yazılan alan TEMİZLENİR", cleared?.hex === null, String(cleared?.hex));

    // --- 8. Servis guard'ı atlanmaz (ad mükerrer) ---
    const dupName = await ImportService.preview("color", [row(2, { name: nameB })], {});
    // Ad guard'ı SERVİSTE — önizleme onu çalıştırmaz (yazma yolu), bu yüzden
    // önizlemede CREATE görünür ama APPLY'da servis 409 atar ve satır FAILED olur.
    check("önizleme yeni kayıt der (ad guard'ı yazma anında koşar)", dupName.summary.create === 1);
    const guarded = await ImportService.apply("color", [row(2, { name: nameB })], { onError: "skip" });
    check(
      "AD MÜKERRER guard'ı import'ta da koşar (kayıt YAZILMAZ)",
      guarded.created === 0 && guarded.failed === 1,
      JSON.stringify({ created: guarded.created, failed: guarded.failed }),
    );
    check("guard düşerse durum PARTIAL/FAILED olur, sessiz kalmaz", guarded.status !== "APPLIED", guarded.status);
    const stillTwo = await prisma.color.count({ where: { name: { startsWith: uniq } } });
    check("mükerrer ad ikinci kaydı OLUŞTURMADI", stillTwo === 2, `bulunan=${stillTwo}`);

    // --- 10. clientToken idempotent ---
    const token = crypto.randomUUID();
    const nameC = `${uniq}-C`;
    const first = await ImportService.apply("color", [row(2, { name: nameC })], { clientToken: token });
    const second = await ImportService.apply("color", [row(2, { name: nameC })], { clientToken: token });
    const cRows = await prisma.color.findMany({ where: { name: nameC } });
    created.push(...cRows.map((c) => c.id));
    check("aynı clientToken ikinci kez YAZMAZ", cRows.length === 1, `bulunan=${cRows.length}`);
    check("ikinci çağrı ÖNCEKİ koşumu döner", second.runId === first.runId);

    // ---------------------------------------------------------------------------
    // 12. Round-trip: export sütunları == şablon sütunları
    // ---------------------------------------------------------------------------
    console.log("\n--- 12. Round-trip sütun eşitliği ---");
    let rtOk = true;
    for (const a of listAdapters()) {
      // Sipariş adaptörü bilinçli olarak dışa aktarmaz (yalnız oluşturur) —
      // dosyayı geri yüklemek siparişleri ÇOĞALTIRDI.
      if (a.entity === "order") continue;
      const rows = await a.exportRows();
      if (rows.length === 0) continue;
      const declared = new Set(a.columns.map((c) => c.key));
      const emitted = Object.keys(rows[0]!);
      const extra = emitted.filter((k) => !declared.has(k));
      if (extra.length > 0) {
        rtOk = false;
        console.log(`   ↳ ${a.entity}: export'ta şablonda olmayan sütun(lar): ${extra.join(", ")}`);
      }
    }
    check("export sütunları şablon sütunlarının alt kümesi (round-trip)", rtOk);

    // Şablon tarifi her adaptör için üretilebilmeli (panel bunu okuyor).
    let tplOk = true;
    for (const a of listAdapters()) {
      const t = ImportService.template(a.entity);
      if (t.columns.length === 0 || t.notes.length === 0) {
        tplOk = false;
        console.log(`   ↳ ${a.entity}: şablon tarifi eksik`);
      }
    }
    check("her adaptör şablon tarifi üretir", tplOk);
    check("bilinmeyen varlık 404 verir", (() => {
      try {
        getImportAdapter("olmayan-varlik");
        return false;
      } catch {
        return true;
      }
    })());
  } finally {
    // Cleanup — testin kendi yarattığı her şey.
    await prisma.importRun.deleteMany({ where: { fileName: "bekçi.xlsx" } });
    if (created.length > 0) {
      await prisma.color.deleteMany({ where: { id: { in: created } } });
    }
    await prisma.color.deleteMany({ where: { name: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
