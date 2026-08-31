// =============================================================================
// Test: Tanımlarda ad-mükerrer koruması (2026-07-27)
// Çalıştır: npx tsx scripts/test_master_data_name_dup.ts
// Doğrulananlar:
//   1. Renk: aynı ad 409; legacy tireli ad ile yeni boşluklu yazım da çakışır
//   2. Ürün: aynı ad (case-farklı) 409; farklı ad serbest
//   3. İstasyon (bare BaseService): aynı ad 409; pasif eş "aktifleştirin" 409
//   4. Makine: ad AYNI istasyonda tekil; farklı istasyonda aynı ad serbest
//   5. Müşteri: aynı ad 409
//   6. Fason firma + kategori: aynı ad 409
//   7. Müşteri şubesi: aynı müşteride aynı ad 409; farklı müşteride serbest;
//      inline branches[] dizi-içi mükerrer 400
//   8. Tarihsel mükerrer: ad DEĞİŞMEYEN update engellenmez
//   9. DB SEDDİ (2026-08-21): customers/items/subcontractors'ta servisi ATLAYAN
//      doğrudan yazım da P2002 (`<tablo>_nameFold_key` partial UNIQUE); tombstone
//      (mergedIntoId dolu) aynı adı taşırken yeni kayıt SERBEST (predicate kanıtı)
// =============================================================================
import prisma from "../src/lib/prisma";
import { BaseService } from "../src/services/base.service";
import { ItemService } from "../src/services/item.service";
import { ColorService } from "../src/services/color.service";
import { CustomerService } from "../src/services/customer.service";
import {
  SubcontractorManagementService,
  SubcontractorCategoryService,
} from "../src/services/subcontractor-management.service";
import { CustomerBranchService } from "../src/services/customer-branch.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}

/**
 * DB seddi beklentisi: servis ATLANARAK yapılan yazım P2002 ile düşmeli ve hata
 * `nameFold` seddini (kısıt adı ya da kolon) işaret etmeli. "Kayıt yazıldı" = sed yok.
 */
async function expectP2002(label: string, fn: () => Promise<unknown>, constraint: string): Promise<void> {
  try {
    await fn();
    check(label, false, "P2002 beklenirken kayıt YAZILDI — DB seddi yok");
  } catch (e) {
    const code = (e as { code?: string }).code;
    const msg = e instanceof Error ? e.message : String(e);
    const meta = JSON.stringify((e as { meta?: unknown }).meta ?? {});
    const mentions = [msg, meta].some((s) => s.includes(constraint) || s.includes("nameFold"));
    check(label, code === "P2002" && mentions, `${code ?? "?"} ${msg.replace(/\s+/g, " ").slice(0, 140)}`);
  }
}

/** err 409/400 + mesaj parçası bekle. */
async function expectReject(
  label: string,
  fn: () => Promise<unknown>,
  msgPart: string,
): Promise<void> {
  try {
    await fn();
    check(label, false, "hata beklenirken başarı döndü");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    check(label, msg.includes(msgPart), msg);
  }
}

async function main() {
  const ts = Date.now();
  const suffix = `${ts}`.slice(-8);
  const created = {
    colorIds: [] as string[],
    itemIds: [] as string[],
    stationIds: [] as string[],
    machineIds: [] as string[],
    customerIds: [] as string[],
    subIds: [] as string[],
    subCatIds: [] as string[],
  };

  const colorSvc = new ColorService({
    modelName: "color",
    tableName: "COLOR",
    searchFields: ["name"],
    codeSearchFields: ["code"],
    uniqueField: "code",
  });
  const itemSvc = new ItemService({
    modelName: "item",
    tableName: "ITEM",
    searchFields: ["name"],
    codeSearchFields: ["code"],
    duplicateNameField: "name",
    entityLabel: "ürün",
  });
  const stationSvc = new BaseService({
    modelName: "station",
    tableName: "STATION",
    searchFields: ["name"],
    codeSearchFields: ["code"],
    uniqueField: "code",
    duplicateNameField: "name",
    entityLabel: "istasyon",
  });
  const machineSvc = new BaseService({
    modelName: "machine",
    tableName: "MACHINE",
    searchFields: ["name"],
    codeSearchFields: ["code"],
    uniqueField: "code",
    duplicateNameField: "name",
    duplicateNameScopeField: "stationId",
    entityLabel: "makine",
  });
  const customerSvc = new CustomerService({
    modelName: "customer",
    tableName: "CUSTOMER",
    searchFields: ["name"],
    codeSearchFields: ["code"],
    uniqueField: "code",
    duplicateNameField: "name",
    entityLabel: "müşteri",
    nestedCreateFields: ["branches"],
  });
  const subSvc = new SubcontractorManagementService();
  const subCatSvc = new SubcontractorCategoryService();
  const branchSvc = new CustomerBranchService();

  try {
    // --- 1) Renk ---
    const c1 = await colorSvc.create(
      { code: `TEST-DUP-C1-${suffix}`, name: `test dup gümüş ${suffix}` },
      undefined,
    );
    created.colorIds.push((c1.data as { id: string }).id);
    await expectReject(
      "Renk: aynı ad ikinci kez 409",
      () => colorSvc.create({ code: `TEST-DUP-C2-${suffix}`, name: `TEST DUP GÜMÜŞ ${suffix}` }, undefined),
      "zaten var",
    );
    // Legacy tireli ada karşı yeni boşluklu yazım
    const legacyName = `TESTDUP-${suffix}-GRİ`;
    const c3 = await prisma.color.create({
      data: { code: `TEST-DUP-C3-${suffix}`, name: legacyName },
    });
    created.colorIds.push(c3.id);
    await expectReject(
      "Renk: legacy tireli ada boşluklu yazım da çakışır",
      () => colorSvc.create({ code: `TEST-DUP-C4-${suffix}`, name: `testdup ${suffix} gri` }, undefined),
      "zaten var",
    );

    // --- 2) Ürün ---
    const i1 = await itemSvc.create(
      { name: `test dup kumaş ${suffix}`, itemType: "FABRIC", unit: "MT" },
      undefined,
    );
    created.itemIds.push((i1.data as { id: string }).id);
    await expectReject(
      "Ürün: aynı ad (case-farklı) 409",
      () => itemSvc.create({ name: `TEST DUP KUMAŞ ${suffix}`, itemType: "FABRIC", unit: "MT" }, undefined),
      "zaten var",
    );
    const i2 = await itemSvc.create(
      { name: `test dup kumaş b ${suffix}`, itemType: "FABRIC", unit: "MT" },
      undefined,
    );
    created.itemIds.push((i2.data as { id: string }).id);
    check("Ürün: farklı ad serbest", true);

    // --- 3) İstasyon + pasif eş ---
    const s1 = await stationSvc.create(
      { code: `TEST-DUP-S1-${suffix}`, name: `Test Dup İstasyon ${suffix}`, kind: "OTHER", type: "INTERNAL" },
      undefined,
    );
    const s1id = (s1.data as { id: string }).id;
    created.stationIds.push(s1id);
    await expectReject(
      "İstasyon: aynı ad 409",
      () => stationSvc.create({ code: `TEST-DUP-S2-${suffix}`, name: `test dup istasyon ${suffix}`, kind: "OTHER", type: "INTERNAL" }, undefined),
      "zaten var",
    );
    await prisma.station.update({ where: { id: s1id }, data: { isActive: false } });
    await expectReject(
      "İstasyon: pasif eş 'aktifleştirin' 409",
      () => stationSvc.create({ code: `TEST-DUP-S3-${suffix}`, name: `Test Dup İstasyon ${suffix}`, kind: "OTHER", type: "INTERNAL" }, undefined),
      "aktifleştirin",
    );
    await prisma.station.update({ where: { id: s1id }, data: { isActive: true } });

    // --- 4) Makine: istasyon-kapsamlı ---
    const s2 = await stationSvc.create(
      { code: `TEST-DUP-S4-${suffix}`, name: `Test Dup İstasyon B ${suffix}`, kind: "OTHER", type: "INTERNAL" },
      undefined,
    );
    const s2id = (s2.data as { id: string }).id;
    created.stationIds.push(s2id);
    const m1 = await machineSvc.create(
      { code: `TEST-DUP-M1-${suffix}`, name: `Test Makine ${suffix}`, stationId: s1id },
      undefined,
    );
    created.machineIds.push((m1.data as { id: string }).id);
    await expectReject(
      "Makine: aynı istasyonda aynı ad 409",
      () => machineSvc.create({ code: `TEST-DUP-M2-${suffix}`, name: `test makine ${suffix}`, stationId: s1id }, undefined),
      "zaten var",
    );
    const m3 = await machineSvc.create(
      { code: `TEST-DUP-M3-${suffix}`, name: `Test Makine ${suffix}`, stationId: s2id },
      undefined,
    );
    created.machineIds.push((m3.data as { id: string }).id);
    check("Makine: farklı istasyonda aynı ad serbest", true);
    await expectReject(
      "Makine: dolu istasyona aynı adla TAŞIMA 409",
      () => machineSvc.update((m3.data as { id: string }).id, { stationId: s1id }, undefined),
      "zaten var",
    );

    // --- 5) Müşteri (+ inline şube dizi-içi mükerrer) ---
    const cu1 = await customerSvc.create({ name: `Test Dup Müşteri ${suffix}` }, undefined);
    created.customerIds.push((cu1.data as { id: string }).id);
    await expectReject(
      "Müşteri: aynı ad 409",
      () => customerSvc.create({ name: `TEST DUP MÜŞTERİ ${suffix}` }, undefined),
      "zaten var",
    );
    await expectReject(
      "Müşteri: inline şube dizi-içi mükerrer 400",
      () =>
        customerSvc.create(
          {
            name: `Test Dup Müşteri B ${suffix}`,
            branches: [{ name: "Merkez" }, { name: "MERKEZ" }],
          },
          undefined,
        ),
      "tekrar edemez",
    );

    // --- 6) Fason firma + kategori ---
    const sc1 = await subCatSvc.create(
      { code: `TEST-DUP-SC1-${suffix}`, name: `Test Dup Kategori ${suffix}` },
      undefined,
    );
    created.subCatIds.push((sc1.data as { id: string }).id);
    await expectReject(
      "Fason kategorisi: aynı ad 409",
      () => subCatSvc.create({ code: `TEST-DUP-SC2-${suffix}`, name: `test dup kategori ${suffix}` }, undefined),
      "zaten var",
    );
    const sb1 = await subSvc.create(
      { code: `TEST-DUP-SB1-${suffix}`, name: `Test Dup Fason ${suffix}` },
      undefined,
    );
    created.subIds.push((sb1.data as { id: string }).id);
    await expectReject(
      "Fason firma: aynı ad 409",
      () => subSvc.create({ code: `TEST-DUP-SB2-${suffix}`, name: `TEST DUP FASON ${suffix}` }, undefined),
      "zaten var",
    );

    // --- 7) Müşteri şubesi: müşteri-kapsamlı ---
    const cuAId = created.customerIds[0]!;
    const cu2 = await customerSvc.create({ name: `Test Dup Müşteri C ${suffix}` }, undefined);
    const cuBId = (cu2.data as { id: string }).id;
    created.customerIds.push(cuBId);
    await branchSvc.create(cuAId, { name: `Test Şube ${suffix}` }, undefined);
    await expectReject(
      "Şube: aynı müşteride aynı ad 409",
      () => branchSvc.create(cuAId, { name: `TEST ŞUBE ${suffix}` }, undefined),
      "zaten var",
    );
    await branchSvc.create(cuBId, { name: `Test Şube ${suffix}` }, undefined);
    check("Şube: farklı müşteride aynı ad serbest", true);

    // --- 8) Tarihsel mükerrer düzenlenebilir kalır ---
    // İki aynı-adlı istasyonu koruma-öncesi veri gibi doğrudan DB'ye yaz.
    const legacyA = await prisma.station.create({
      data: { code: `TEST-DUP-L1-${suffix}`, name: `Test Legacy İst ${suffix}`, kind: "OTHER", type: "INTERNAL" },
    });
    const legacyB = await prisma.station.create({
      data: { code: `TEST-DUP-L2-${suffix}`, name: `Test Legacy İst ${suffix}`, kind: "OTHER", type: "INTERNAL" },
    });
    created.stationIds.push(legacyA.id, legacyB.id);
    const legacyUpdate = await stationSvc.update(
      legacyA.id,
      { name: `Test Legacy İst ` },
      undefined,
    );
    check("Tarihsel mükerrer: ad değişmeyen update serbest", legacyUpdate.success === true);
    await expectReject(
      "Update: ad BAŞKA kayıtla çakışırsa 409",
      () => stationSvc.update(legacyA.id, { name: `Test Dup İstasyon B ${suffix}` }, undefined),
      "zaten var",
    );

    // --- 9) DB SEDDİ — servisi ATLAYAN yazım da reddedilir (2026-08-21) ---
    // customers/items/subcontractors'ta partial UNIQUE `<tablo>_nameFold_key`
    // (`WHERE "mergedIntoId" IS NULL`, migration 20260821150000_name_fold_unique_live).
    // Uygulama bekçisi check-then-act'tir: yarış, `duplicateNameField` unutması, içe
    // aktarım adaptörünün guard beyan etmemesi, elle SQL — bu yolları yalnız DB kapatır.
    // Yukarıdaki 8 bölüm bekçinin 409'unu ölçer; bu bölüm bekçi HİÇ koşmadan yazar.
    const sedName = `Test Sed Müşteri ${suffix}`;
    const sedA = await prisma.customer.create({
      data: { code: `TEST-SED-A-${suffix}`, name: sedName },
      select: { id: true },
    });
    created.customerIds.push(sedA.id);
    await expectP2002(
      "DB seddi: doğrudan create ile fold-eş müşteri (BÜYÜK harf) → P2002 customers_nameFold_key",
      () =>
        prisma.customer
          .create({ data: { code: `TEST-SED-B-${suffix}`, name: sedName.toLocaleUpperCase("tr") }, select: { id: true } })
          .then((r) => created.customerIds.push(r.id)),
      "customers_nameFold_key",
    );
    // Predicate kanıtı: A birleşmiş (tombstone) sayılınca aynı ad yeniden SERBEST —
    // birleşmiş adın yeniden kullanımı meşrudur (base.service.ts §assertNameNotDuplicate).
    const sedAnchor = await prisma.customer.create({
      data: { code: `TEST-SED-ANC-${suffix}`, name: `Test Sed Anchor ${suffix}` },
      select: { id: true },
    });
    created.customerIds.push(sedAnchor.id);
    await prisma.customer.update({
      where: { id: sedA.id },
      data: { mergedIntoId: sedAnchor.id, mergedAt: new Date(), isActive: false },
    });
    const sedC = await prisma.customer.create({
      data: { code: `TEST-SED-C-${suffix}`, name: sedName },
      select: { id: true },
    });
    created.customerIds.push(sedC.id);
    check("DB seddi: tombstone (mergedIntoId dolu) aynı adı taşırken yeni kayıt SERBEST (predicate)", Boolean(sedC.id));
    // Tombstone dururken ÜÇÜNCÜ canlı kopya yine reddedilir (predicate yalnız tombstone'u muaf tutar).
    await expectP2002(
      "DB seddi: tombstone + canlı kopya varken ikinci canlı kopya yine P2002",
      () =>
        prisma.customer
          .create({ data: { code: `TEST-SED-D-${suffix}`, name: sedName }, select: { id: true } })
          .then((r) => created.customerIds.push(r.id)),
      "customers_nameFold_key",
    );

    const sedItem = await prisma.item.create({
      data: { code: `TEST-SED-I-${suffix}`, name: `Test Sed Ürün ${suffix}`, itemType: "FABRIC" },
      select: { id: true },
    });
    created.itemIds.push(sedItem.id);
    await expectP2002(
      "DB seddi: items — fold-eş (ÜRÜN/urun, İ/ı) doğrudan create → P2002 items_nameFold_key",
      () =>
        prisma.item
          .create({ data: { code: `TEST-SED-I2-${suffix}`, name: `TEST SED ÜRÜN ${suffix}`, itemType: "FABRIC" }, select: { id: true } })
          .then((r) => created.itemIds.push(r.id)),
      "items_nameFold_key",
    );

    const sedSub = await prisma.subcontractor.create({
      data: { code: `TEST-SED-S-${suffix}`, name: `Test Sed Fason ${suffix}` },
      select: { id: true },
    });
    created.subIds.push(sedSub.id);
    await expectP2002(
      "DB seddi: subcontractors — fold-eş doğrudan create → P2002 subcontractors_nameFold_key",
      () =>
        prisma.subcontractor
          .create({ data: { code: `TEST-SED-S2-${suffix}`, name: `TEST SED FASON ${suffix}` }, select: { id: true } })
          .then((r) => created.subIds.push(r.id)),
      "subcontractors_nameFold_key",
    );

    // RENK (2026-08-25): sed düz nameFold'da DEĞİL, `tr_fold_color(name)` ifadesinde —
    // ayraç + sayı-sırası bağımsız. "Test Sed Renk X 055" ≡ "055-TEST SED RENK X".
    // Servis atlanır (normalizeColorName koşmaz); katlama farkı DB'de kapanmalı.
    // ⚠️ `suffix` salt rakamdır ve kuralda RAKAM BLOKLARI KENDİ SIRASINI KORUR
    // ("… 534 055" ≠ "055 … 534") — bu yüzden suffix harfle birleşik (`X534…`), yoksa
    // sonda kendi kendini çürütür (ilk yazımda tam bu oldu).
    const sedColor = await prisma.color.create({
      data: { code: `TEST-SED-R-${suffix}`, name: `Test Sed Renk X${suffix} 055` },
      select: { id: true },
    });
    created.colorIds.push(sedColor.id);
    await expectP2002(
      "DB seddi: colors — ayraç/sıra farklı ama renk-eş ad (055-… ≡ … 055) doğrudan create → P2002 colors_nameFoldColor_key",
      () =>
        prisma.color
          .create({ data: { code: `TEST-SED-R2-${suffix}`, name: `055-TEST SED RENK X${suffix}` }, select: { id: true } })
          .then((r) => created.colorIds.push(r.id)),
      "colors_nameFoldColor_key",
    );
    // Aynı sözcükler, FARKLI rakam sırası → farklı renk (kural bilinçli): yazılabilmeli.
    const sedColorOther = await prisma.color.create({
      data: { code: `TEST-SED-R3-${suffix}`, name: `055 Test Sed Renk X${suffix} 7` },
      select: { id: true },
    });
    created.colorIds.push(sedColorOther.id);
    check("DB seddi: colors — ek rakam bloğu (… 055 … 7) FARKLI renk sayılır, yazılır", Boolean(sedColorOther.id));
  } finally {
    // Cleanup — test kendi yarattığını siler (FK sırasına dikkat).
    await prisma.machine.deleteMany({ where: { id: { in: created.machineIds } } }).catch(() => {});
    await prisma.station.deleteMany({ where: { id: { in: created.stationIds } } }).catch(() => {});
    await prisma.customerBranch.deleteMany({ where: { customerId: { in: created.customerIds } } }).catch(() => {});
    await prisma.customer.deleteMany({ where: { id: { in: created.customerIds } } }).catch(() => {});
    await prisma.subcontractorToCategory.deleteMany({ where: { subcontractorId: { in: created.subIds } } }).catch(() => {});
    await prisma.subcontractor.deleteMany({ where: { id: { in: created.subIds } } }).catch(() => {});
    await prisma.subcontractorCategory.deleteMany({ where: { id: { in: created.subCatIds } } }).catch(() => {});
    await prisma.item.deleteMany({ where: { id: { in: created.itemIds } } }).catch(() => {});
    await prisma.color.deleteMany({ where: { id: { in: created.colorIds } } }).catch(() => {});
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // §10 — SED ENVANTERİ (2026-08-31, BULGU-T1-007): her nameFold tablosu ya
  //       SEDLİ ya da GEREKÇELİ MUAF. İKİ YÖNLÜ.
  // ═══════════════════════════════════════════════════════════════════════════
  // Neden gerekli: `assertNameNotDuplicate` kilitsiz check-then-act'tir ve
  // `create()` transaction bile açmaz — yarışı kapatan tek şey DB seddidir.
  // Yeni bir `nameFold` kolonu eklendiğinde sed eklemeyi unutmak SESSİZDİR:
  // uygulama guard'ı normal yolda çalıştığı için hiçbir şey kırmızıya dönmez.
  //
  // ⚠️ Muaf listesi GEREKÇELİDİR ve BAYATLIĞA KARŞI DENETLENİR: muaf edilen
  // tablo sonradan sedlenirse ölü muaf testi DÜŞÜRÜR. Ölü muaf, gerçek bir
  // boşluğu sessizce kapsam dışında tutar.
  const SED_MUAFLARI: Record<string, string> = {
    // Uygulama guard'ı YOK (`duplicateNameField` tanımlı değil) → bugün mükerrer
    // ad MEŞRUDUR. Sed eklemek uygulamanın aynası değil YENİ KISIT olurdu; iş
    // kararı bekliyor ("iki müşterinin de 'Merkez' şubesi olabilir mi?").
    customer_branches: "uygulama guard'ı yok — iş kararı bekliyor",
    label_templates: "uygulama guard'ı yok — iş kararı bekliyor",
    permission_templates: "uygulama guard'ı yok — iş kararı bekliyor",
    subcontractor_categories: "uygulama guard'ı yok — iş kararı bekliyor",
    // Saha kopyasında TEMİZ, dev'de 3 grup — üçü de test fixture artığı
    // ("TEST Rota Zımpara" ×3). Sabit adla istasyon yaratan fixture'lar
    // damgalanmadan sed eklemek onları 2. koşumda P2002'ye düşürür.
    // ⚠️ KANIT BU DOSYADA: §8 ("Tarihsel mükerrer düzenlenebilir kalır") aynı
    // adlı İKİ istasyonu bilerek doğrudan DB'ye yazıyor — sed eklemek o senaryoyu
    // imkânsız kılar. Ayrıca dev'deki 3 mükerrer grubun üçü de fixture artığı
    // ("TEST Rota Zımpara" ×3); saha kopyasında istasyonlar TEMİZ.
    stations: "tarihsel-mükerrer senaryosu + sabit adlı fixture'lar (§8)",
  };

  const foldTablolar = await prisma.$queryRaw<Array<{ tablo: string }>>`
    SELECT table_name AS tablo FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'nameFold'
    ORDER BY 1
  `;
  const sedliler = await prisma.$queryRaw<Array<{ tablo: string }>>`
    SELECT DISTINCT t.relname AS tablo
    FROM pg_index x
    JOIN pg_class i ON i.oid = x.indexrelid
    JOIN pg_class t ON t.oid = x.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND x.indisunique AND x.indisvalid
      AND (i.relname LIKE '%nameFold%' OR pg_get_indexdef(i.oid) ILIKE '%nameFold%')
  `;
  const sedliSet = new Set(sedliler.map((r) => r.tablo));

  // KÖRLÜK ZEMİNİ: sorgular boş dönerse aşağıdaki iki kontrol vakumen yeşil kalır.
  check(
    `§10: nameFold tabloları tarandı (körlük zemini)`,
    foldTablolar.length >= 15,
    `${foldTablolar.length} tablo`,
  );
  check(`§10: sedli tablo bulundu (körlük zemini)`, sedliSet.size >= 8, `${sedliSet.size} sedli`);

  // ① Sedsiz VE muaf olmayan tablo kalmamalı.
  const acikta = foldTablolar
    .map((r) => r.tablo)
    .filter((t) => !sedliSet.has(t) && !(t in SED_MUAFLARI));
  check(
    "§10a: sedsiz ve gerekçesiz nameFold tablosu YOK",
    acikta.length === 0,
    acikta.join(", ") || "hepsi ya sedli ya gerekçeli muaf",
  );

  // ② Ölü muaf kalmamalı (muaf ama artık sedli).
  const oluMuaf = Object.keys(SED_MUAFLARI).filter((t) => sedliSet.has(t));
  check(
    "§10b: ölü muaf yok (muaf edilen tablo sedlenmemiş)",
    oluMuaf.length === 0,
    oluMuaf.join(", ") || "muaf listesi güncel",
  );
  // ③ Muaf listesindeki tablo gerçekten var olmalı (yeniden adlandırma sonrası bayat girdi).
  const hayaletMuaf = Object.keys(SED_MUAFLARI).filter(
    (t) => !foldTablolar.some((r) => r.tablo === t),
  );
  check(
    "§10c: muaf listesinde hayalet tablo yok",
    hayaletMuaf.length === 0,
    hayaletMuaf.join(", ") || "hepsi mevcut",
  );
  console.log(`   muaflar: ${Object.entries(SED_MUAFLARI).map(([t, n]) => `${t} (${n})`).join(" · ")}`);

  // ── §10d: sed VAR olmakla ISIRMAK ayrı iddialardır ────────────────────────
  // "index listede görünüyor" ile "ikinci kaydı gerçekten reddediyor" farklı
  // şeyler. Aşağısı uygulama guard'ını ATLAYARAK (prisma doğrudan) yazar.
  const ek = `${Date.now()}`.slice(-6);
  const sedIds = { defect: [] as string[], station: [] as string[], machine: [] as string[] };
  try {
    const d1 = await prisma.defectType.create({
      data: { code: `TEST-SED-D1-${ek}`, name: `Test Sed Hata ${ek}` },
    });
    sedIds.defect.push(d1.id);
    await expectP2002(
      "§10d: aynı ad ikinci kez YAZILAMAZ (defect_types seddi ısırıyor)",
      async () => {
        const d2 = await prisma.defectType.create({
          // Kod FARKLI — reddin sebebi ad olmalı, kod değil.
          data: { code: `TEST-SED-D2-${ek}`, name: `Test Sed Hata ${ek}` },
        });
        sedIds.defect.push(d2.id);
      },
      "defect_types_nameFold_key",
    );

    // ── Kapsamlı sed: makine adı İSTASYON İÇİNDE tekil ──────────────────────
    const st1 = await prisma.station.create({
      data: { code: `TEST-SED-S1-${ek}`, name: `Test Sed İst A ${ek}`, kind: "OTHER", type: "INTERNAL" },
    });
    const st2 = await prisma.station.create({
      data: { code: `TEST-SED-S2-${ek}`, name: `Test Sed İst B ${ek}`, kind: "OTHER", type: "INTERNAL" },
    });
    sedIds.station.push(st1.id, st2.id);

    const m1 = await prisma.machine.create({
      data: { code: `TEST-SED-M1-${ek}`, name: `Makine ${ek}`, stationId: st1.id },
    });
    sedIds.machine.push(m1.id);
    await expectP2002(
      "§10d: AYNI istasyonda aynı makine adı reddedilir",
      async () => {
        const m2 = await prisma.machine.create({
          data: { code: `TEST-SED-M2-${ek}`, name: `Makine ${ek}`, stationId: st1.id },
        });
        sedIds.machine.push(m2.id);
      },
      "machines_stationId_nameFold_key",
    );

    // ⭐ EN KRİTİK KONTROL: sed KAPSAMLI kalmalı. Biri onu düz
    // `@@unique([nameFold])`e çevirirse (denetimin naif tavsiyesi) burası
    // kırmızı verir — o değişiklik "Makine 1" adını fabrikada TEK bir istasyona
    // hapsederdi.
    //
    // ⚠️ ÖLÇÜLDÜ (sonda, 2026-08-31): sed düz nameFold'a çevrildiğinde bu
    // kontrola sıra GELMEYEBİLİR — dosyanın önceki bölümleri de farklı
    // istasyonlarda aynı adlı makine yaratıyor ve orada P2002 ile ÇÖKÜYOR.
    // Çöküş de kırmızıdır (`main().catch` → exit 1) ama sebebi Prisma yığınının
    // içinde kalır. İki sinyali de tanı: buradaki net mesaj YA DA
    // `machines_stationId_nameFold_key` içeren beklenmeyen bir çöküş.
    let farkliIstasyonOk = false;
    try {
      const m3 = await prisma.machine.create({
        data: { code: `TEST-SED-M3-${ek}`, name: `Makine ${ek}`, stationId: st2.id },
      });
      sedIds.machine.push(m3.id);
      farkliIstasyonOk = true;
    } catch (e) {
      farkliIstasyonOk = false;
      console.log(`   (farklı istasyon reddedildi: ${(e as Error).message.slice(0, 90)})`);
    }
    check(
      "§10d: FARKLI istasyonda aynı makine adı SERBEST (sed kapsamlı kaldı)",
      farkliIstasyonOk,
      farkliIstasyonOk ? "aynı ad iki istasyonda yaşayabiliyor" : "sed düz nameFold'a düşmüş",
    );
  } finally {
    await prisma.machine.deleteMany({ where: { id: { in: sedIds.machine } } }).catch(() => {});
    await prisma.station.deleteMany({ where: { id: { in: sedIds.station } } }).catch(() => {});
    await prisma.defectType.deleteMany({ where: { id: { in: sedIds.defect } } }).catch(() => {});
  }


  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
