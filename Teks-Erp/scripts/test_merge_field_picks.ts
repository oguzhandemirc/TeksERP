// =============================================================================
// Test: BİRLEŞTİRMEDE ALAN SEÇİMİ (survivorship) — mükerrer paneli v2 P2, 2026-08-22
// Çalıştır: npx tsx scripts/test_merge_field_picks.ts
// =============================================================================
// Kilitlenen sözleşmeler:
//   §0 Katalog: seçilebilir alanlar ŞEMADA var (DMMF); `code` ve KİMLİK alanları
//      (customer.type, item.unit) seçime KAPALI — kod belgeye basılır + @unique,
//      kimlik alanı zaten birleştirmeyi engeller
//   §1 Önizleme: her alan için tüm kayıtların değeri + ÖNERİ (survivor doluysa o,
//      değilse en çok referanslı kaynağın dolu değeri) + `differs` bayrağı
//   §2 Uygulama: seçilen alanlar survivor'a yazılır, seçilmeyenler DEĞİŞMEZ;
//      tombstone eski değerini korur; ayrı audit satırı (MASTER_DATA_MERGE_FIELDS)
//   §3 Guard'lar: seçilemez alan → 400 · gruba ait olmayan kayıt → 400 ·
//      ad çakışması → 409 ve BİRLEŞTİRME HİÇ OLMAZ (tx geri sarar)
//   §4 Ad seçimi kaynağın adını alabiliyor (claim'den SONRA yazıldığı için partial
//      UNIQUE ile kavga etmiyor) — bu sıranın kanıtı
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { MERGEABLE_FIELDS, isMergeableField } from "../src/constants/merge-fields";
import { MasterDataMergeService } from "../src/services/master-data-merge.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}

async function expectError(
  label: string,
  fn: () => Promise<unknown>,
  status: number,
  msgPart?: string,
): Promise<void> {
  try {
    await fn();
    check(label, false, "hata beklenirken başarı döndü");
  } catch (e) {
    const st = (e as { statusCode?: number }).statusCode;
    const msg = e instanceof Error ? e.message : String(e);
    check(label, st === status && (!msgPart || msg.includes(msgPart)), `${st ?? "?"} ${msg.slice(0, 90)}`);
  }
}

const TAG = `TMFP${Date.now().toString().slice(-7)}`;
const created: string[] = [];
const createdColors: string[] = [];

async function main(): Promise<void> {
  // ── §0 Katalog ────────────────────────────────────────────────────────────
  console.log("\n── §0 Seçilebilir alan kataloğu ──");
  const models = (Prisma as unknown as {
    dmmf?: { datamodel?: { models?: Array<{ name: string; fields: Array<{ name: string }> }> } };
  }).dmmf?.datamodel?.models ?? [];
  const modelOf: Record<string, string> = {
    customer: "Customer",
    item: "Item",
    color: "Color",
    subcontractor: "Subcontractor",
  };
  let total = 0;
  for (const [entity, fields] of Object.entries(MERGEABLE_FIELDS)) {
    const m = models.find((x) => x.name === modelOf[entity]);
    const cols = new Set(m?.fields.map((f) => f.name) ?? []);
    for (const f of fields) {
      total++;
      check(`${entity}.${f.field} şemada var`, cols.has(f.field));
    }
  }
  check("körlük zemini: en az 15 seçilebilir alan", total >= 15, `${total} alan`);
  check("`code` HİÇBİR varlıkta seçilebilir DEĞİL (belgeye basılır + @unique)",
    !Object.keys(MERGEABLE_FIELDS).some((e) => isMergeableField(e as never, "code")));
  check("kimlik alanları seçime kapalı (customer.type, item.unit)",
    !isMergeableField("customer", "type") && !isMergeableField("item", "unit"));

  // ── Fixture ───────────────────────────────────────────────────────────────
  // A (survivor adayı): adı var, VKN YOK, adres YOK · B (kaynak): VKN + adres dolu,
  // farklı ad · C: bir sipariş bağı ile "en çok referanslı" kaynak olacak.
  const a = await prisma.customer.create({
    data: { code: `${TAG}-A`, name: `${TAG} Alfa Tekstil`, city: "İstanbul" },
    select: { id: true },
  });
  const b = await prisma.customer.create({
    data: { code: `${TAG}-B`, name: `${TAG} Alfa Teks`, taxNumber: "1112223334", address: "Bursa OSB 3. Cad", city: "Bursa" },
    select: { id: true },
  });
  const c = await prisma.customer.create({
    data: { code: `${TAG}-C`, name: `${TAG} Alfa T.`, taxNumber: "9998887776", contactPhone: "05001112233" },
    select: { id: true },
  });
  created.push(a.id, b.id, c.id);

  // ── §1 Önizleme ───────────────────────────────────────────────────────────
  console.log("\n── §1 Önizleme: alan seçenekleri + öneri ──");
  const pv = await MasterDataMergeService.preview("customer", a.id, [b.id, c.id]);
  check("önizleme birleştirilebilir", pv.canMerge, pv.blockers.map((x) => x.message).join(" | "));
  const byField = new Map(pv.fieldChoices.map((f) => [f.field, f]));
  check("alan listesi geldi (ad/VKN/adres…)", pv.fieldChoices.length === MERGEABLE_FIELDS.customer.length, `${pv.fieldChoices.length} alan`);
  const nameChoice = byField.get("name")!;
  check("ad: üç kaydın da değeri listede", nameChoice.values.length === 3 && nameChoice.values.every((v) => Boolean(v.value)));
  check("ad: survivor DOLU → öneri survivor", nameChoice.suggestedFromId === a.id);
  check("ad: differs=true (üçü farklı)", nameChoice.differs);
  const taxChoice = byField.get("taxNumber")!;
  check("VKN: survivor BOŞ → öneri bir KAYNAK", taxChoice.suggestedFromId !== a.id && [b.id, c.id].includes(taxChoice.suggestedFromId));
  check("VKN: survivor değeri null olarak listelenir", taxChoice.values.find((v) => v.recordId === a.id)?.value === null);
  const emailChoice = byField.get("email")!;
  check("e-posta: hiçbirinde yok → öneri survivor, differs=false", emailChoice.suggestedFromId === a.id && !emailChoice.differs);
  const cityChoice = byField.get("city")!;
  check("il: iki farklı dolu değer → differs=true, öneri survivor (dolu)", cityChoice.differs && cityChoice.suggestedFromId === a.id);

  // ── §3a Guard'lar (birleştirmeden ÖNCE — hata sonrası kayıtlar canlı kalmalı) ──
  console.log("\n── §3 Guard'lar ──");
  await expectError(
    "seçilemez alan (`code`) → 400",
    () => MasterDataMergeService.merge("customer", { survivorId: a.id, sourceIds: [b.id], reason: "alan seçimi guard denemesi", acknowledgedConflicts: 0, fieldPicks: { code: b.id } }),
    400,
    "seçilemez",
  );
  await expectError(
    "gruba ait OLMAYAN kayıttan alan seçimi → 400",
    () => MasterDataMergeService.merge("customer", { survivorId: a.id, sourceIds: [b.id], reason: "alan seçimi guard denemesi", acknowledgedConflicts: 0, fieldPicks: { taxNumber: c.id } }),
    400,
    "grubunda değil",
  );
  const stillLive = await prisma.customer.count({ where: { id: { in: [b.id, c.id] }, mergedIntoId: null } });
  check("guard'a takılan denemede kaynaklar CANLI kaldı (tx geri sardı)", stillLive === 2, `${stillLive}/2`);

  // AD ÇAKIŞMASI — RENK üzerinden sınanır ve bu bilinçli: müşteri/kumaş/fasonda
  // `<tablo>_nameFold_key` DB seddi bu durumun OLUŞMASINI zaten engelliyor (aynı
  // katlanmış adı taşıyan ikinci CANLI kayıt yaratılamıyor — bu testin ilk hâli
  // tam oraya takıldı ve seddin çalıştığını kanıtladı). Renkte sed BİLİNÇLİ YOK
  // ve renk katlaması (`foldColorNameForCompare`) DB'nin `tr_fold`'undan GENİŞ:
  // ⚠️ BU NOT 2026-08-30'da GÜNCELLENDİ ve eskisi ARTIK YANLIŞTI. Eskiden
  // "'055-BORDO' ile 'BORDO 055' farklı `nameFold`, DB göremez" diyordu; renk ad
  // seddi (`colors_nameFoldColor_key`) `tr_fold_color` kullanıyor ve o katlama
  // SAYI SIRASINDAN BAĞIMSIZ — yani DB artık GÖRÜYOR. Servis guard'ı yine
  // değerli (ham P2002 yerine okunaklı mesaj verir) ama tek savunma değil.
  // Sed kurulu bir DB'de bu fixture'ın üçüncü kaydı YARATILAMAZ; test uyarlanır.
  const colA = await prisma.color.create({ data: { code: `${TAG}-CLA`, name: `${TAG} Kirmizi` }, select: { id: true } });
  const colB = await prisma.color.create({ data: { code: `${TAG}-CLB`, name: `${TAG} 055-BORDO` }, select: { id: true } });
  let colX: { id: string } | null = null;
  try {
    colX = await prisma.color.create({ data: { code: `${TAG}-CLX`, name: `${TAG} BORDO 055` }, select: { id: true } });
  } catch {
    check("renk ad seddi katlama-ikizini DB'DE engelledi (servis guard'ından güçlü)", true);
  }
  createdColors.push(colA.id, colB.id, ...(colX ? [colX.id] : []));
  if (colX) {
    await expectError(
      "ad seçimi grup DIŞINDAKİ canlı kayıtla çakışıyor → 409 (renk katlaması, DB'nin göremediği)",
      () => MasterDataMergeService.merge("color", { survivorId: colA.id, sourceIds: [colB.id], reason: "ad çakışması denemesi renk", acknowledgedConflicts: 0, fieldPicks: { name: colB.id } }),
      409,
      "başka bir kayıtta kullanılıyor",
    );
    const colStillLive = await prisma.color.count({ where: { id: colB.id, mergedIntoId: null } });
    check("ad çakışmasında BİRLEŞTİRME HİÇ OLMADI (kaynak canlı, tx geri sardı)", colStillLive === 1);
    // Çakışan dış kayıt kalkınca AYNI seçim geçmeli — guard'ın gerçekten o kayda baktığının kanıtı.
    await prisma.color.delete({ where: { id: colX.id } });
    createdColors.splice(createdColors.indexOf(colX.id), 1);
  }
  const okRes = await MasterDataMergeService.merge("color", {
    survivorId: colA.id,
    sourceIds: [colB.id],
    reason: "cakisma kalkinca ayni secim gecmeli",
    acknowledgedConflicts: 0,
    fieldPicks: { name: colB.id },
  });
  const colSurvivor = await prisma.color.findUniqueOrThrow({ where: { id: colA.id }, select: { name: true } });
  check("çakışan kayıt kalkınca aynı ad seçimi GEÇTİ", okRes.fieldsApplied.length === 1 && colSurvivor.name === `${TAG} 055-BORDO`, colSurvivor.name);

  // ── §2 + §4 Uygulama ──────────────────────────────────────────────────────
  console.log("\n── §2 Uygulama: seçilen alanlar survivor'a yazılır ──");
  const res = await MasterDataMergeService.merge("customer", {
    survivorId: a.id,
    sourceIds: [b.id, c.id],
    reason: "aynı firma — alan seçimiyle birleştirme testi",
    acknowledgedConflicts: 0,
    fieldPicks: {
      name: b.id, // ⭐ kaynağın adı survivor'a taşınıyor (claim SONRASI yazım kanıtı)
      taxNumber: b.id,
      address: b.id,
      contactPhone: c.id,
      // `city` SEÇİLMEDİ → survivor'ınki (İstanbul) kalmalı
    },
  });
  check("birleştirme başarılı", res.mergedCount === 2, `${res.mergedCount} kayıt`);
  check("yanıt uygulanan alanları döner", res.fieldsApplied.length === 4, JSON.stringify(res.fieldsApplied.map((f) => f.field)));
  const survivor = await prisma.customer.findUniqueOrThrow({
    where: { id: a.id },
    select: { name: true, taxNumber: true, address: true, contactPhone: true, city: true, nameFold: true },
  });
  check("⭐ ad kaynaktan alındı (partial UNIQUE kavgası YOK — claim'den sonra yazılıyor)", survivor.name === `${TAG} Alfa Teks`, survivor.name);
  check("katlanmış ad kolonu da güncellendi (DB üretir)", survivor.nameFold === `${TAG.toLowerCase()} alfa teks`, String(survivor.nameFold));
  check("VKN kaynaktan alındı", survivor.taxNumber === "1112223334", String(survivor.taxNumber));
  check("adres kaynaktan alındı", survivor.address === "Bursa OSB 3. Cad");
  check("telefon İKİNCİ kaynaktan alındı", survivor.contactPhone === "05001112233", String(survivor.contactPhone));
  check("SEÇİLMEYEN alan (il) survivor'da kaldı", survivor.city === "İstanbul", String(survivor.city));
  const tomb = await prisma.customer.findUniqueOrThrow({
    where: { id: b.id },
    select: { name: true, taxNumber: true, isActive: true, mergedIntoId: true },
  });
  check("tombstone kendi adını/VKN'sini KORUR (tarihçe)", tomb.name === `${TAG} Alfa Teks` && tomb.taxNumber === "1112223334");
  check("tombstone pasif + survivor'a bağlı", tomb.isActive === false && tomb.mergedIntoId === a.id);

  const auditFields = await prisma.systemLog.findFirst({
    // ⚠️ MANTIKSAL ad (2026-08-29 / T2-011) — fiziksel "customers" DEĞİL.
    // Birleştirme audit'i fiziksel tablo adıyla yazılıyordu ve Denetim
    // Raporu'nda hiç görünmüyordu; bu bekçi de aynı kör noktayı paylaşıyordu.
    where: { tableName: "CUSTOMER", recordId: a.id },
    orderBy: { createdAt: "desc" },
    select: { newData: true, oldData: true },
  });
  const nd = (auditFields?.newData ?? {}) as Record<string, unknown>;
  const od = (auditFields?.oldData ?? {}) as Record<string, unknown>;
  check("ayrı audit satırı: MASTER_DATA_MERGE_FIELDS", nd.event === "MASTER_DATA_MERGE_FIELDS", String(nd.event));
  check("audit ÖNCEKİ değeri taşır (ad + boş VKN)", od.name === `${TAG} Alfa Tekstil` && od.taxNumber === null, JSON.stringify(od));
  check("audit hangi koddan alındığını yazar", Boolean((nd.fieldsFrom as Record<string, string> | undefined)?.name?.includes(TAG)), JSON.stringify(nd.fieldsFrom));

  // ── §4b Alan seçimi VERİLMEZSE survivor'a dokunulmaz ──────────────────────
  console.log("\n── §4 Seçim verilmezse survivor DEĞİŞMEZ ──");
  const d = await prisma.customer.create({ data: { code: `${TAG}-D`, name: `${TAG} Beta`, city: "İzmir" }, select: { id: true } });
  const e = await prisma.customer.create({ data: { code: `${TAG}-E`, name: `${TAG} Beta 2`, city: "Ankara", taxNumber: "5556667778" }, select: { id: true } });
  created.push(d.id, e.id);
  const res2 = await MasterDataMergeService.merge("customer", {
    survivorId: d.id,
    sourceIds: [e.id],
    reason: "alan seçimi olmadan birleştirme testi",
    acknowledgedConflicts: 0,
  });
  check("alan seçimi yok → fieldsApplied boş", res2.fieldsApplied.length === 0);
  const survivor2 = await prisma.customer.findUniqueOrThrow({ where: { id: d.id }, select: { name: true, city: true, taxNumber: true } });
  check("survivor alanları AYNEN kaldı (VKN kaynakta kalsa bile)", survivor2.name === `${TAG} Beta` && survivor2.city === "İzmir" && survivor2.taxNumber === null);

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

main()
  .catch((e) => {
    fail++;
    console.error("HATA:", e);
  })
  .finally(async () => {
    try {
      const all = [...created, ...createdColors];
      await prisma.duplicateReview.deleteMany({ where: { OR: [{ aId: { in: all } }, { bId: { in: all } }] } });
      await prisma.customer.updateMany({ where: { id: { in: created } }, data: { mergedIntoId: null } });
      await prisma.customer.deleteMany({ where: { id: { in: created } } });
      await prisma.color.updateMany({ where: { id: { in: createdColors } }, data: { mergedIntoId: null } });
      await prisma.color.deleteMany({ where: { id: { in: createdColors } } });
    } catch (err) {
      console.error("cleanup hatası:", err);
    }
    if (fail > 0) console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
