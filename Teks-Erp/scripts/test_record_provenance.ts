// =============================================================================
// BEKÇİ: Kayıt künyesi — kim oluşturdu / kim son değiştirdi (2026-08-19)
// Çalıştır: npx tsx scripts/test_record_provenance.ts
// =============================================================================
// Tasarım: docs/design/KAYIT-KUNYESI-TASARIM.md
//
// KURAL: kaydın kimliğine ait KALICI gerçek KOLONDA durur, audit'ten OKUNMAZ —
// audit 6 ayda arşivlenir. (`record-info` ucu tam bu yüzden 6 aydan eski kayıtta
// sessizce boş dönüyordu; künye kolonu o kusurun yapısal cevabıdır.)
//
// ⚠️ İKİ YÖNLÜ: kolonu olan model `PROVENANCE_MODELS` listesinde OLMALI (yoksa
// yazılmaz, kolon boş kalır) — ve listede olan modelin kolonu OLMALI (yoksa
// Prisma çalışma-zamanında patlar). Tek yönlü kontrol iki arızayı da kaçırır.
// =============================================================================
import fs from "fs";
import path from "path";
import prisma, { pool } from "../src/lib/prisma";
import { ensureTestAdmin } from "./fixture-test-user";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}

/** Şemada künye kolonu taşıyan modeller. */
function schemaModelsWithProvenance(): Set<string> {
  const src = fs.readFileSync(path.join(__dirname, "..", "prisma", "schema.prisma"), "utf8");
  const out = new Set<string>();
  for (const m of src.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
    if (/^\s+createdById\s/m.test(m[2]!) && /^\s+updatedById\s/m.test(m[2]!)) out.add(m[1]!);
  }
  return out;
}

/** BaseService'in yazdığı model listesi (kaynak koddan okunur, kopyalanmaz). */
function baseServiceModels(): Set<string> {
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "services", "base.service.ts"), "utf8");
  const m = /const PROVENANCE_MODELS = new Set\(\[([\s\S]*?)\]\)/.exec(src);
  if (!m) return new Set();
  return new Set([...m[1]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]!));
}

/** Prisma model adı → şema model adı (ilk harf büyük). */
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

async function main(): Promise<void> {
  console.log("=== Kayıt künyesi bekçisi ===\n");

  const schemaModels = schemaModelsWithProvenance();
  const written = baseServiceModels();

  // ── Körlük zeminleri ────────────────────────────────────────────────────
  // Tarayıcı boşa düşerse "ihlal yok" ile "hiçbir şeye bakılmadı" aynı yeşile
  // çıkar. Zeminler bugünkü gerçeğin belirgin ALTINDA tutulur.
  check("körlük zemini: şemada künyeli model bulundu", schemaModels.size >= 25, `${schemaModels.size} model`);
  check("körlük zemini: BaseService listesi okundu", written.size >= 10, `${written.size} model`);

  // ── 1) Liste ⊆ şema (yazdığımız her modelin kolonu var mı) ──────────────
  const missingCols = [...written].filter((m) => !schemaModels.has(cap(m)));
  check(
    "BaseService'in yazdığı her modelin künye kolonu VAR",
    missingCols.length === 0,
    missingCols.join(", ") || `${written.size} model`,
  );

  // ── 2) DB'de kolonlar gerçekten var mı ──────────────────────────────────
  const cols = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM information_schema.columns
    WHERE table_schema='public' AND column_name IN ('createdById','updatedById')`;
  check("DB'de künye kolonları mevcut", Number(cols[0]!.n) >= 34, `${cols[0]!.n} kolon`);

  // ── 3) Kolonlar NULLABLE olmalı ─────────────────────────────────────────
  // NOT NULL, geçmiş kayıtları olan canlı tabloda migration'ı imkânsız kılar
  // ve backfill eşleşmeyen kayıtları uydurmaya zorlar.
  const notNull = await prisma.$queryRaw<{ table_name: string; column_name: string }[]>`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema='public' AND column_name IN ('createdById','updatedById')
      AND is_nullable='NO'`;
  check("künye kolonlarının hepsi NULLABLE", notNull.length === 0,
    notNull.map((r) => `${r.table_name}.${r.column_name}`).join(", "));

  // ── 3b) record-info KAPSAM LİSTESİ ⊆ ŞEMA (Faz A2) ─────────────────────
  // ⚠️ CANLI TURDAN ÖNCE: liste bozuksa Prisma çalışma-zamanında yığın iziyle
  // patlıyor ve asıl sebep gürültüde kayboluyor. Statik kontrol önce koşar.
  // `PROVENANCE_TABLES` elle yazılır: kolonu olmayan tabloyu listeye koymak
  // çalışma-zamanında Prisma hatası, kolonu olanı KOYMAMAK ise sessiz gerileme
  // (bilgi kolonda dururken audit'ten okunmaya devam eder). İki yönü de ölç.
  const riSrc = fs.readFileSync(
    path.join(__dirname, "..", "src", "services", "record-info.service.ts"), "utf8",
  );
  const riBlock = /const PROVENANCE_TABLES = \{([\s\S]*?)\} as const;/.exec(riSrc);
  check("record-info kapsam listesi okunabildi", Boolean(riBlock));
  if (riBlock) {
    const mapped = [...riBlock[1]!.matchAll(/prisma\.(\w+)\s*,/g)].map((m) => m[1]!);
    check("körlük zemini: kapsam listesi dolu", mapped.length >= 20, `${mapped.length} tablo`);
    const badMap = mapped.filter((m) => !schemaModels.has(cap(m)));
    check(
      "record-info'nun okuduğu her modelin künye kolonu VAR",
      badMap.length === 0,
      badMap.join(", ") || `${mapped.length} tablo`,
    );
  }

  // ── 4) CANLI TUR: create künye yazıyor, update createdById'yi KORUYOR ───
  // En kolay kaybedilen kural bu: update'te `{...data}` yayılırken createdById
  // yanlışlıkla ezilirse kaydın kökeni sessizce kaybolur.
  // ⚠️ İKİNCİ KULLANICI GARANTİ EDİLİR (2026-09-06). Eskiden ortamda İKİ kullanıcı
  // olduğu VARSAYILIYORDU; temiz CI veritabanında seed YALNIZ `admin` yaratır,
  // `u2` null gelir ve bekçi `u2!.id` satırında TypeError ile ÇÖKERDİ (ölçüldü).
  // Reçetenin kendi kuralı: aktör `fixture-test-user.ts`ten çözülür. [TD-17]
  const u1 = await prisma.user.findFirst({ select: { id: true } });
  const testAdmin = await ensureTestAdmin();
  const u2 =
    (await prisma.user.findFirst({ where: { id: { not: u1!.id } }, select: { id: true } })) ??
    { id: testAdmin.id };
  const ts = Date.now();
  let colorId = "";
  try {
    const { ColorService } = await import("../src/services/color.service");
    const svc = new ColorService({
      model: prisma.color, modelName: "color", tableName: "COLOR",
      searchFields: ["name"],
      codeSearchFields: ["code"], duplicateNameField: "name", entityLabel: "renk",
    } as never);
    const created = (await svc.create(
      { code: `TEST-PRV-${ts}`, name: `TEST KUNYE BEKCI ${ts}` }, u1!.id,
    )) as unknown as { data: { id: string } };
    colorId = created.data.id;

    const afterCreate = await prisma.color.findUnique({
      where: { id: colorId }, select: { createdById: true, updatedById: true },
    });
    check("create → createdById yazıldı", afterCreate?.createdById === u1!.id);
    check("create → updatedById DE yazıldı (boş alan gösterilmesin)", afterCreate?.updatedById === u1!.id);

    await svc.update(colorId, { name: `TEST KUNYE BEKCI ${ts} V2` }, u2!.id);
    const afterUpdate = await prisma.color.findUnique({
      where: { id: colorId }, select: { createdById: true, updatedById: true },
    });
    check("update → createdById KORUNDU", afterUpdate?.createdById === u1!.id, String(afterUpdate?.createdById));
    check("update → updatedById değişti", afterUpdate?.updatedById === u2!.id);

    // userId YOKSA (dahili çağrı) künye EZİLMEMELİ — null yazmak, bilinen
    // kökeni bilinmeyene çevirirdi.
    await svc.update(colorId, { name: `TEST KUNYE BEKCI ${ts} V3` }, undefined);
    const afterAnon = await prisma.color.findUnique({
      where: { id: colorId }, select: { createdById: true, updatedById: true },
    });
    check("userId yokken künye EZİLMEZ", afterAnon?.createdById === u1!.id && afterAnon?.updatedById === u2!.id);
  } finally {
    if (colorId) await prisma.color.deleteMany({ where: { id: colorId } }).catch(() => {});
  }

  // ── 5) record-info: ÖNCE KOLON, kolonsuz tabloda AUDIT ─────────────────
  // İlk yazımda bilgi yalnız audit'ten okunuyordu → 6 aydan eski kayıtta ⓘ
  // sessizce boş dönüyordu. Bu bölüm iki yolun da canlıda çalıştığını ölçer.
  const { recordInfoService } = await import("../src/services/record-info.service");

  // ⚠️ FIXTURE KENDİ KURULUR, ORTAMDAN DEVŞİRİLMEZ (2026-09-05 yeşile-çekme).
  // Eskiden burada `customer.findFirst({ createdById: { not: null } })` vardı:
  // künyeli müşteri satırı OLMAYAN bir DB'de (backfill'in eşleşecek audit
  // satırı bulamadığı canlı kopya dahil) bekçi KOD sağlamken kırmızı veriyordu
  // — Teks-Erp/CLAUDE.md "ortamdaki veriye BAĞIMLI OLMA" kuralının ihlali.
  // Kolon yolu ölçülecekse künyeli satırı bekçi kendisi doğurur.
  let prvCustomerId = "";
  try {
    const c = await prisma.customer.create({
      data: {
        code: `TEST-PRV-C-${ts}`,
        // Ad da damgalı — customers nameFold seddi (2026-08-21).
        name: `TEST KUNYE MUSTERI ${ts}`,
        createdById: u1!.id,
        updatedById: u1!.id,
      },
      select: { id: true },
    });
    prvCustomerId = c.id;
    const r = await recordInfoService.get("CUSTOMER", prvCustomerId);
    check("künyeli kayıt KOLONDAN okunur", r.data.source === "column", r.data.source);
    check("kolon yolunda oluşturan adı çözülür", Boolean(r.data.created?.userName));
  } finally {
    if (prvCustomerId) {
      await prisma.customer.deleteMany({ where: { id: prvCustomerId } }).catch(() => {});
    }
  }

  // A2 KABUL ÖLÇÜTÜ: iş emrinde "kim açtı" artık KOLONDAN gelir.
  // Faz A2 öncesi bu bilgi HİÇ yoktu, yalnız audit'ten okunabiliyordu.
  // ⚠️ FIXTURE GARANTİ EDİLİR (2026-09-06): temiz CI veritabanında `createdById`
  // dolu HİÇ iş emri yoktur ve kontrol "backfill koşmamış olabilir" diye kırmızı
  // verirdi — oysa ölçtüğü şey KOLON YOLUNUN çalışması, veritabanının geçmişi değil.
  const prvWo = await prisma.workOrder.create({
    data: { workOrderNumber: `TEST-PRV-WO-${ts}`, createdById: u1!.id },
    select: { id: true },
  });
  const woWithActor = await prisma.workOrder.findFirst({
    where: { createdById: { not: null } }, select: { id: true },
  });
  if (woWithActor) {
    const r = await recordInfoService.get("WORK_ORDER", woWithActor.id);
    check("iş emri künyesi KOLONDAN gelir (A2)", r.data.source === "column", r.data.source);
  } else {
    check("iş emri künyesi KOLONDAN gelir (A2)", false, "backfill koşmamış olabilir");
  }

  // Kolonu OLMAYAN bir tablo hâlâ audit/arşiv yoluna düşmeli. `SACK` bilinçli
  // olarak kapsam dışı (mevcut `weighedById` aktörü var) → doğru örnek.
  const sack = await prisma.sack.findFirst({ select: { id: true } });
  if (sack) {
    const r = await recordInfoService.get("SACK", sack.id);
    check("kolonsuz tablo AUDIT/ARŞİV yoluna düşer", r.data.source !== "column", r.data.source);
  }

  // ⚠️ ARŞİV YOLU SERVİSİN KENDİSİYLE sınanır, elle yazılmış bir sorguyla DEĞİL.
  // İlk yazımda burada kendi `findFirst`'ümü kuruyordum — o, Prisma'nın
  // davranışını ölçer, BİZİM kodumuzu değil: servis bozulduğunda test yeşil
  // kalıyordu (negatif sondayla görüldü, 2026-08-19).
  //
  // Sıcak audit'te HİÇ satırı olmayan bir kayıt seçilir → `fromAudit` zorunlu
  // olarak arşiv sorgusunu koşar. `SystemLogArchive`'ın `user` ilişkisi YOKTUR;
  // sıcak tablonun select'i oraya kopyalanırsa çalışma-zamanında patlar.
  // ⚠️ FIXTURE'I TEST KENDİSİ YARATIR (2026-09-06). Eskiden ortamda "auditsiz bir
  // müşteri" ARANIYORDU ve bulunamazsa kontrol KIRMIZI veriyordu — yani ölçtüğü
  // şey kodun doğruluğu değil VERİTABANININ HÂLİYDİ. Fabrika yedeğinde ve temiz
  // CI veritabanında böyle bir kayıt yok (her CUD audit yazar), o yüzden bu
  // kontrol oralarda hep kırmızıydı. [TD-17]: bekçi ortamdaki veriye bağımlı olmaz.
  //
  // ⚠️ AUDIT'İ SONRADAN SİLİYORUZ: müşteriyi `prisma` ile doğrudan yaratmak audit
  // yazmaz ama `createdById` de yazmaz; ikisini birden garantilemek için kayıt
  // kurulur ve audit satırı (varsa) temizlenir — aranan hâl "sıcak audit'te HİÇ
  // satırı olmayan kayıt"tır.
  const orphanCustomer = await prisma.customer.create({
    data: { code: `TEST-PRV-ORPHAN-${ts}`, name: `TEST PRV ARSIV YOLU ${ts}` },
    select: { id: true },
  });
  await prisma.systemLog.deleteMany({ where: { tableName: "CUSTOMER", recordId: orphanCustomer.id } });
  const orphan = [{ id: orphanCustomer.id }];
  if (orphan.length > 0) {
    let archiveOk = true;
    let detail = "";
    try {
      const r = await recordInfoService.get("CUSTOMER", orphan[0]!.id);
      detail = r.data.source;
    } catch (e) {
      archiveOk = false;
      detail = (e as Error).message.slice(0, 90);
    }
    check("arşiv yolu servisten koşuyor (user ilişkisi YOK)", archiveOk, detail);
  } else {
    check("arşiv yolu servisten koşuyor (user ilişkisi YOK)", false, "fixture yok — auditsiz kayıt bulunamadı");
  }

  // ── 6) TAŞIYICI VARSAYIM: kullanıcı HARD DELETE edilmez ────────────────
  // Künye FK'larına index KOYMADIK (CLAUDE.md perf #1 istisnası: "kim yaptı"
  // audit FK'ları sorgulanmadıkça indexlenmez). Bu kararın tek gerçek riski
  // ANA KAYDI SİLMEKTİR: bir `users` satırı silinirse PostgreSQL, referans veren
  // 22 tabloyu İNDEKSSİZ taramak zorunda kalır.
  //
  // Bugün risk YOK çünkü kullanıcılar yalnız SOFT DELETE ediliyor (`deletedAt`;
  // 2026-08-19'da kullanıcı tarafından da teyit edildi). Ama bu bir VARSAYIM ve
  // sessizce bozulabilir — biri `prisma.user.delete` yazdığı gün bu kontrol
  // kırmızı verir ve karar yeniden değerlendirilir (index ekle YA DA silmeyi
  // engelle). Ölçüm: yazma maliyeti bugün satır başına +0,021 ms.
  const srcDir = path.join(__dirname, "..", "src");
  const files: string[] = [];
  (function walk(d: string) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const fp = path.join(d, e.name);
      if (e.isDirectory()) walk(fp);
      else if (e.name.endsWith(".ts")) files.push(fp);
    }
  })(srcDir);
  check("körlük zemini: kaynak tarandı", files.length >= 100, `${files.length} dosya`);

  const hardDeletes: string[] = [];
  for (const f of files) {
    const t = fs.readFileSync(f, "utf8");
    // `prisma.user.delete(` / `tx.user.deleteMany(` — userPermission/userPreference
    // gibi ALT tablolar kapsam DIŞI (onların silinmesi künyeyi etkilemez).
    for (const m of t.matchAll(/\b(?:prisma|tx)\.user\.(delete|deleteMany)\s*\(/g)) {
      hardDeletes.push(`${path.relative(srcDir, f)} → user.${m[1]}`);
    }
  }
  check(
    "kullanıcı HARD DELETE edilmiyor (indekssiz FK kararının şartı)",
    hardDeletes.length === 0,
    hardDeletes.join(" · ") || "yalnız soft delete (deletedAt)",
  );

  await prisma.workOrder.deleteMany({ where: { id: prvWo.id } }).catch(() => {});
  // Fixture temizliği — arşiv-yolu müşterisi bu koşumun ürünüdür, kalıcı değil.
  await prisma.systemLog
    .deleteMany({ where: { tableName: "CUSTOMER", recordId: orphanCustomer.id } })
    .catch(() => {});
  await prisma.customer.deleteMany({ where: { id: orphanCustomer.id } }).catch(() => {});

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error("Beklenmeyen hata:", e); process.exit(1); });
