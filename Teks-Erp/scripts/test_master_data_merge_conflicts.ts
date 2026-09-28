// =============================================================================
// BİRLEŞTİRME ÇAKIŞMA POLİTİKALARI (Faz B5)
// =============================================================================
// Her politikaya en az bir vaka. En kritik üçü:
//
//  ① "BOŞ = HEPSİ" ASİMETRİSİ — `item_allowed_colors` satır kümesi bir KÜME
//     değil KISITTIR. Survivor BOŞ (=hepsi serbest) + kaynak 3 satır → naif
//     union survivor'ı HEPSİ'ten 3'e DARALTIR ve o kumaş bir daha 4. renkle
//     sipariş edilemez. Üç alt vaka ölçülüyor.
//  ② `assigned` OR — kaynağa ATANMIŞ renk survivor'da atanmamışsa, düz SKIP o
//     rengi survivor'ın "Müşteri Renkleri"nden düşürür ve picker'da görünmez
//     olur (sessiz özellik kaybı).
//  ③ RENK NULL BÜTÜNLÜĞÜ — birleştirme hiç DELETE yapmadığı için `colorId`
//     NULL'a düşemez; `Roll.colorId IS NULL` bu sistemde "HAM KUMAŞ" demektir.
//     Merge öncesi/sonrası NULL sayısı BİREBİR eşit olmalı.
//  ⑥ KUMAŞA ÖZEL RENK ADI (customer_item_color_aliases, SKIP) — survivor'ın adı
//     kazanır, çakışmayan taşınır; taşınan satırın survivor'ın o kumaştaki adını
//     değiştirdiği önizlemede KAYIT BAŞINA listelenir (gölgeleme); ÇOK KAYNAKTA
//     aynı (kumaş, renk) varsa ikinci UPDATE P2002 vermemeli.
//  ⑦ KAYNAKLAR ARASI ÇAKIŞMA — hedefte olmayan anahtar İKİ kaynakta birden varsa
//     (iki müşteri aynı kumaşa ad vermiş) ikinci kaynağın taşınması tekil kısıta
//     çarpmamalı; önizleme bunu "kaynaklar arası" diye ayrı söyler. Müşteri, ürün ve
//     renk birleştirmesinin üçünde ölçülür; BLOCK 409'u details.code ile, geniş
//     anahtarlı `item_prices`in YANLIŞ bloklamadığı da (⑦e) ölçülür.

import prisma, { pool } from "../src/lib/prisma";
import { MasterDataMergeService } from "../src/services/master-data-merge.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    pass++;
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const TAG = `TESTCNF${Date.now().toString().slice(-8)}`;
const trash: { items: string[]; colors: string[]; customers: string[] } = {
  items: [],
  colors: [],
  customers: [],
};

async function mkColor(suffix: string): Promise<string> {
  const c = await prisma.color.create({
    data: { code: `${TAG}${suffix}`.slice(0, 32), name: `${TAG} ${suffix}` },
  });
  trash.colors.push(c.id);
  return c.id;
}
async function mkItem(suffix: string): Promise<string> {
  const i = await prisma.item.create({
    data: { code: `${TAG}${suffix}`.slice(0, 32), name: `${TAG} ${suffix}`, itemType: "FABRIC", unit: "MT" },
  });
  trash.items.push(i.id);
  return i.id;
}
async function mkCustomer(suffix: string): Promise<string> {
  const c = await prisma.customer.create({
    data: { code: `${TAG}${suffix}`.slice(0, 32), name: `${TAG} ${suffix}` },
  });
  trash.customers.push(c.id);
  return c.id;
}

async function main(): Promise<void> {
  console.log("=== Birleştirme çakışma politikaları ===\n");

  const red = await mkColor("RED");
  const blue = await mkColor("BLU");

  // ── ① BOŞ = HEPSİ, üç alt vaka ───────────────────────────────────────────
  console.log("── ① 'Boş = hepsi' asimetrisi (item_allowed_colors) ──");

  // 1a) Survivor BOŞ (=hepsi), kaynakta 2 satır → kaynağınkiler ATILIR
  {
    const s = await mkItem("EA-S");
    const k = await mkItem("EA-K");
    await prisma.itemAllowedColor.createMany({
      data: [
        { itemId: k, colorId: red },
        { itemId: k, colorId: blue },
      ],
    });
    await MasterDataMergeService.merge("item", {
      survivorId: s,
      sourceIds: [k],
      reason: "bos hepsi asimetrisi sondasi 1a",
      acknowledgedConflicts: 0,
    });
    const after = await prisma.itemAllowedColor.count({ where: { itemId: s } });
    check(
      "1a) survivor BOŞken kaynağın kısıtları TAŞINMAZ (hepsi serbest kalır)",
      after === 0,
      `${after} satır`,
    );
  }

  // 1b) Survivor DOLU, kaynakta ÇAKIŞMAYAN satır → taşınır (genişler)
  {
    const s = await mkItem("EB-S");
    const k = await mkItem("EB-K");
    await prisma.itemAllowedColor.create({ data: { itemId: s, colorId: red } });
    await prisma.itemAllowedColor.create({ data: { itemId: k, colorId: blue } });
    await MasterDataMergeService.merge("item", {
      survivorId: s,
      sourceIds: [k],
      reason: "bos hepsi asimetrisi sondasi 1b",
      acknowledgedConflicts: 0,
    });
    const after = await prisma.itemAllowedColor.count({ where: { itemId: s } });
    check("1b) survivor DOLUysa çakışmayan kısıt taşınır", after === 2, `${after} satır`);
  }

  // 1c) Survivor DOLU, kaynakta AYNI renk → tek satır kalır (dedupe)
  {
    const s = await mkItem("EC-S");
    const k = await mkItem("EC-K");
    await prisma.itemAllowedColor.create({ data: { itemId: s, colorId: red } });
    await prisma.itemAllowedColor.create({ data: { itemId: k, colorId: red } });
    await MasterDataMergeService.merge("item", {
      survivorId: s,
      sourceIds: [k],
      reason: "bos hepsi asimetrisi sondasi 1c",
      acknowledgedConflicts: 1,
    });
    const after = await prisma.itemAllowedColor.count({ where: { itemId: s } });
    check("1c) çakışan kısıt mükerrer satır bırakmıyor", after === 1, `${after} satır`);
  }

  // ── ② assigned = OR (customer_color_aliases) ─────────────────────────────
  console.log("\n── ② Müşteri renk adı: assigned OR + alias COALESCE ──");
  {
    const s = await mkCustomer("AL-S");
    const k = await mkCustomer("AL-K");
    // Survivor: atanmamış + alias YOK · Kaynak: ATANMIŞ + alias VAR
    await prisma.customerColorAlias.create({
      data: { customerId: s, colorId: red, assigned: false },
    });
    await prisma.customerColorAlias.create({
      data: { customerId: k, colorId: red, assigned: true, alias: "MÜŞTERİ ADI" },
    });
    await MasterDataMergeService.merge("customer", {
      survivorId: s,
      sourceIds: [k],
      reason: "assigned OR sondasi",
      acknowledgedConflicts: 1,
    });
    const row = await prisma.customerColorAlias.findFirst({ where: { customerId: s, colorId: red } });
    check("② atanmışlık KAYBOLMADI (assigned = OR)", row?.assigned === true, String(row?.assigned));
    check("② boş alias kaynağınkiyle dolduruldu (COALESCE)", row?.alias === "MÜŞTERİ ADI", String(row?.alias));
    const left = await prisma.customerColorAlias.count({ where: { customerId: k } });
    check("② kaynağın satırı kalmadı", left === 0, `${left} satır`);
  }

  // Survivor'ın DOLU alias'ı KORUNUR — etikete basılan değeri değiştirmiyoruz.
  {
    const s = await mkCustomer("AK-S");
    const k = await mkCustomer("AK-K");
    await prisma.customerColorAlias.create({
      data: { customerId: s, colorId: blue, assigned: true, alias: "SURVIVOR ADI" },
    });
    await prisma.customerColorAlias.create({
      data: { customerId: k, colorId: blue, assigned: true, alias: "KAYNAK ADI" },
    });
    await MasterDataMergeService.merge("customer", {
      survivorId: s,
      sourceIds: [k],
      reason: "alias korunma sondasi",
      acknowledgedConflicts: 1,
    });
    const row = await prisma.customerColorAlias.findFirst({ where: { customerId: s, colorId: blue } });
    check(
      "② survivor'ın DOLU alias'ı korunuyor (etikete basılan değer değişmez)",
      row?.alias === "SURVIVOR ADI",
      String(row?.alias),
    );
  }

  // ── ③ Renk NULL bütünlüğü ────────────────────────────────────────────────
  console.log("\n── ③ Renk birleştirmesi topların colorId'sini NULL'lamıyor ──");
  {
    const nullsBefore = await prisma.roll.count({ where: { colorId: null } });
    const cs = await mkColor("NS");
    const ck = await mkColor("NK");
    const item = await mkItem("NULLTEST");
    const r = await prisma.roll.create({
      data: {
        barcode: `${TAG}NR`,
        itemId: item,
        colorId: ck,
        status: "STOCK",
        initialQty: 10,
        currentQty: 10,
      },
    });
    await MasterDataMergeService.merge("color", {
      survivorId: cs,
      sourceIds: [ck],
      reason: "renk null butunlugu sondasi",
      acknowledgedConflicts: 0,
    });
    const after = await prisma.roll.findUnique({ where: { id: r.id } });
    check("③ top survivor renge taşındı", after?.colorId === cs, String(after?.colorId));
    const nullsAfter = await prisma.roll.count({ where: { colorId: null } });
    check(
      "③ NULL colorId sayısı BİREBİR aynı (boyalı top hama dönmedi)",
      nullsBefore === nullsAfter,
      `${nullsBefore} → ${nullsAfter}`,
    );
    // ADI kapının okuduğu şeydir: teardown bağlamı fonksiyon adından tanınır (§10b2).
    const temizlikTop = async (): Promise<void> => {
      await prisma.rollMovement.deleteMany({ where: { rollId: r.id } }).catch(() => undefined);
      await prisma.roll.delete({ where: { id: r.id } }).catch(() => undefined);
    };
    await temizlikTop();
  }

  // ── ④ Şube ihracat kodu çakışması BLOK ───────────────────────────────────
  console.log("\n── ④ Şube ihracat kodu çakışması (BLOCK) ──");
  {
    const s = await mkCustomer("BR-S");
    const k = await mkCustomer("BR-K");
    await prisma.customerBranch.create({ data: { customerId: s, name: "Merkez", code: "TR34" } });
    await prisma.customerBranch.create({ data: { customerId: k, name: "Ana", code: "TR34" } });
    const pv = await MasterDataMergeService.preview("customer", s, [k]);
    check(
      "④ aynı ihracat kodlu şube birleştirmeyi ENGELLİYOR",
      !pv.canMerge && pv.blockers.some((b) => b.key.startsWith("CONFLICT_CUSTOMER_BRANCHES")),
      pv.blockers.map((b) => b.key).join(",") || "blokçu YOK",
    );
    let blocked = false;
    try {
      await MasterDataMergeService.merge("customer", {
        survivorId: s,
        sourceIds: [k],
        reason: "sube kodu cakismasi sondasi",
        acknowledgedConflicts: 1,
      });
    } catch {
      blocked = true;
    }
    check("④ uygulama katmanı da engelliyor (çift kapı)", blocked);
  }

  // NULL kodlu şubeler PG'de çakışmaz → serbestçe taşınmalı.
  {
    const s = await mkCustomer("BN-S");
    const k = await mkCustomer("BN-K");
    await prisma.customerBranch.create({ data: { customerId: s, name: "Merkez" } });
    await prisma.customerBranch.create({ data: { customerId: k, name: "Ana" } });
    const pv = await MasterDataMergeService.preview("customer", s, [k]);
    check("④ NULL kodlu şubeler ÇAKIŞMA SAYILMIYOR", pv.canMerge, pv.blockers.map((b) => b.key).join(","));
    await MasterDataMergeService.merge("customer", {
      survivorId: s,
      sourceIds: [k],
      reason: "null kodlu sube tasima sondasi",
      acknowledgedConflicts: 0,
    });
    const n = await prisma.customerBranch.count({ where: { customerId: s } });
    check("④ iki şube de survivor'a taşındı", n === 2, `${n} şube`);
  }

  await kumasaOzelRenkAdi(red);

  // ── ⑤ Onay sayısı uyuşmazlığı 409 ────────────────────────────────────────
  console.log("\n── ⑤ Onaylanan çakışma sayısı uyuşmazlığı ──");
  {
    const s = await mkItem("AC-S");
    const k = await mkItem("AC-K");
    await prisma.itemAllowedColor.create({ data: { itemId: s, colorId: red } });
    await prisma.itemAllowedColor.create({ data: { itemId: k, colorId: red } });
    let mismatch = false;
    try {
      await MasterDataMergeService.merge("item", {
        survivorId: s,
        sourceIds: [k],
        reason: "onay sayisi uyusmazligi sondasi",
        acknowledgedConflicts: 0, // gerçekte 1 çakışma var
      });
    } catch {
      mismatch = true;
    }
    check("⑤ 'gördüm' sayısı uyuşmazsa 409 (önizleme bayatladı)", mismatch);
    check(
      "⑤ reddedilen birleştirmede kaynak DOKUNULMADAN kaldı",
      (await prisma.item.findUnique({ where: { id: k } }))?.mergedIntoId === null,
    );
  }

  await crossSourceCases();
}

async function tryMerge(
  entity: "customer" | "item" | "color",
  survivorId: string,
  sourceIds: string[],
  reason: string,
): Promise<string | null> {
  try {
    const pv = await MasterDataMergeService.preview(entity, survivorId, sourceIds);
    await MasterDataMergeService.merge(entity, {
      survivorId,
      sourceIds,
      reason,
      acknowledgedConflicts: pv.conflicts.filter((c) => c.count > 0).length,
    });
    return null;
  } catch (e) {
    return (e as Error).message.replace(/\s+/g, " ").trim().slice(0, 300);
  }
}

async function crossSourceCases(): Promise<void> {
  console.log("\n── ⑦ Kaynaklar arası çakışma (hedefte olmayan anahtar iki kaynakta) ──");
  const item = await mkItem("XS-I");
  const color = await mkColor("XS-C");

  // ⑦a MÜŞTERİ: iki kaynak aynı kumaşa ve aynı renge ad vermiş, hedefte ikisi de yok.
  {
    const s = await mkCustomer("XS-S");
    const k1 = await mkCustomer("XS-K1");
    const k2 = await mkCustomer("XS-K2");
    await prisma.customerItemAlias.createMany({
      data: [
        { customerId: k1, itemId: item, alias: "BİRİNCİ KAYNAK ADI" },
        { customerId: k2, itemId: item, alias: "İKİNCİ KAYNAK ADI" },
      ],
    });
    await prisma.customerColorAlias.createMany({
      data: [
        { customerId: k1, colorId: color, assigned: false, alias: null },
        { customerId: k2, colorId: color, assigned: true, alias: "İKİNCİ RENK ADI" },
      ],
    });
    const pv = await MasterDataMergeService.preview("customer", s, [k1, k2]);
    const seen = pv.conflicts.filter((c) => c.count > 0).map((c) => `${c.table}:${c.count}`).sort();
    check(
      "⑦a önizleme kaynaklar arası çakışmayı GÖSTERİYOR (operatör onayı ona göre)",
      seen.join(",") === "customer_color_aliases:1,customer_item_aliases:1",
      seen.join(",") || "çakışma YOK",
    );
    const itemConflict = pv.conflicts.find((c) => c.table === "customer_item_aliases");
    check(
      "⑦a önizleme kaynaklar arası kısmı AYRI sayıyor ve kazananı sırayla söylüyor",
      itemConflict?.crossSourceCount === 1 && itemConflict.survivorCount === 0 &&
        Boolean(itemConflict.crossSourceNote?.includes("İLK")) &&
        Boolean(itemConflict.crossSourceNote?.includes(`${TAG} XS-K1 → ${TAG} XS-K2`)),
      JSON.stringify({ n: itemConflict?.crossSourceCount, note: itemConflict?.crossSourceNote }),
    );
    const err = await tryMerge("customer", s, [k1, k2], "iki kaynak ayni kumasa ad vermis sondasi");
    check("⑦a ⭐ iki kaynaklı müşteri birleştirmesi tekil kısıta ÇARPMIYOR", err === null, err ?? "");
    const itemRows = await prisma.customerItemAlias.findMany({ where: { customerId: s, itemId: item }, select: { alias: true } });
    check(
      "⑦a hedefte TEK ürün adı kaldı: kaynak sırasında ilki kazanır",
      itemRows.length === 1 && itemRows[0]!.alias === "BİRİNCİ KAYNAK ADI",
      JSON.stringify(itemRows),
    );
    const colorRow = await prisma.customerColorAlias.findFirst({ where: { customerId: s, colorId: color } });
    check(
      "⑦a renk adı alan alan birleşti (assigned OR + alias COALESCE, iki kaynaktan)",
      colorRow?.assigned === true && colorRow.alias === "İKİNCİ RENK ADI",
      JSON.stringify({ assigned: colorRow?.assigned, alias: colorRow?.alias }),
    );
    const left = await prisma.customerItemAlias.count({ where: { customerId: { in: [k1, k2] } } });
    check("⑦a kaynaklarda ürün adı kalmadı", left === 0, `${left} satır`);
  }

  // ⑦b ÜRÜN: aynı müşteri iki kaynak karta da ad vermiş.
  {
    const cust = await mkCustomer("XS-M");
    const s = await mkItem("XS-IS");
    const k1 = await mkItem("XS-IK1");
    const k2 = await mkItem("XS-IK2");
    await prisma.customerItemAlias.createMany({
      data: [
        { customerId: cust, itemId: k1, alias: "BİRİNCİ KART ADI" },
        { customerId: cust, itemId: k2, alias: "İKİNCİ KART ADI" },
      ],
    });
    const err = await tryMerge("item", s, [k1, k2], "iki kaynak kart ayni musteride adli sondasi");
    const rows = await prisma.customerItemAlias.findMany({ where: { customerId: cust, itemId: s }, select: { alias: true } });
    check("⑦b ⭐ iki kaynaklı ürün birleştirmesi tekil kısıta ÇARPMIYOR", err === null, err ?? "");
    check("⑦b hedefte tek ad, ilk kaynağınki", rows.length === 1 && rows[0]!.alias === "BİRİNCİ KART ADI", JSON.stringify(rows));
  }

  // ⑦c RENK: aynı müşteri iki kaynak renge de ad vermiş.
  {
    const cust = await mkCustomer("XS-R");
    const s = await mkColor("XS-CS");
    const k1 = await mkColor("XS-CK1");
    const k2 = await mkColor("XS-CK2");
    await prisma.customerColorAlias.createMany({
      data: [
        { customerId: cust, colorId: k1, assigned: true, alias: null },
        { customerId: cust, colorId: k2, assigned: false, alias: "İKİNCİ RENK KARTI" },
      ],
    });
    const err = await tryMerge("color", s, [k1, k2], "iki kaynak renk ayni musteride adli sondasi");
    const row = await prisma.customerColorAlias.findFirst({ where: { customerId: cust, colorId: s } });
    check("⑦c ⭐ iki kaynaklı renk birleştirmesi tekil kısıta ÇARPMIYOR", err === null, err ?? "");
    check(
      "⑦c renk adı iki kaynaktan alan alan birleşti",
      row?.assigned === true && row.alias === "İKİNCİ RENK KARTI",
      JSON.stringify({ assigned: row?.assigned, alias: row?.alias }),
    );
  }

  // ⑦d BLOCK politikası kaynaklar arasında da bloklar: iki kaynak şubesi aynı ihracat kodunda.
  {
    const s = await mkCustomer("XS-BS");
    const k1 = await mkCustomer("XS-BK1");
    const k2 = await mkCustomer("XS-BK2");
    await prisma.customerBranch.create({ data: { customerId: k1, name: "Bir", code: "TR35" } });
    await prisma.customerBranch.create({ data: { customerId: k2, name: "İki", code: "TR35" } });
    const pv = await MasterDataMergeService.preview("customer", s, [k1, k2]);
    const blocker = pv.blockers.find((b) => b.key.startsWith("CONFLICT_CUSTOMER_BRANCHES"));
    check("⑦d ⭐ iki kaynakta aynı ihracat kodu önizlemede BLOKÇU", !pv.canMerge && Boolean(blocker),
      pv.blockers.map((b) => b.key).join(",") || "blokçu YOK");
    // Hedefin hiç şubesi yok: metin operatörü hedefte aramaya YOLLAMAMALI.
    check("⑦d blokçu metni kaynaklar arası çakışmayı söylüyor, 'hedefteki' demiyor",
      Boolean(blocker?.message.includes("birleşecek başka bir kayıttakiyle")) && !blocker?.message.includes("hedefteki"),
      blocker?.message ?? "");
    // Onay sayısı ÖNİZLEMEDEN: sabit sayı, terim sökülünce "önizleme bayat" 409'uyla sahte yeşil verirdi.
    let code: unknown;
    try {
      await MasterDataMergeService.merge("customer", {
        survivorId: s,
        sourceIds: [k1, k2],
        reason: "kaynaklar arasi sube kodu cakismasi sondasi",
        acknowledgedConflicts: pv.conflicts.length,
      });
    } catch (e) {
      code = (e as { statusCode?: number; details?: { code?: unknown } }).details?.code;
    }
    check("⑦d işlem BLOCK 409'uyla reddediyor (details.code, ham 23505/500 değil)", code === "MERGE_CONFLICT_BLOCKED", String(code));
  }

  // ⑦e GENİŞ ANAHTAR kaynaklar arasında yanlış BLOKLAMAMALI: `item_prices`in ürün kuralı
  // (itemId, kind, currency) üzerinden sayar; farklı müşteri istisnaları hedefte yan yana durabilir.
  {
    const c1 = await mkCustomer("XS-P1");
    const c2 = await mkCustomer("XS-P2");
    const s = await mkItem("XS-PS");
    const k1 = await mkItem("XS-PK1");
    const k2 = await mkItem("XS-PK2");
    await prisma.itemPrice.createMany({
      data: [
        { itemId: k1, customerId: c1, kind: "SALE", currency: "TRY", price: 10 },
        { itemId: k2, customerId: c2, kind: "SALE", currency: "TRY", price: 20 },
        { itemId: k2, customerId: null, kind: "SALE", currency: "TRY", price: 15 },
      ],
    });
    const pv = await MasterDataMergeService.preview("item", s, [k1, k2]);
    check("⑦e ⭐ farklı müşteri istisnaları + varsayılan iki kaynakta: BLOKÇU YOK",
      pv.canMerge && !pv.blockers.some((b) => b.key === "CONFLICT_ITEM_PRICES"),
      pv.blockers.map((b) => `${b.key}:${b.count}`).join(",") || "blokçu yok");
    const err = await tryMerge("item", s, [k1, k2], "farkli musteri fiyat istisnalari sondasi");
    const moved = await prisma.itemPrice.count({ where: { itemId: s } });
    check("⑦e birleştirme geçti, üç fiyat satırı hedefte", err === null && moved === 3, `${err ?? ""} taşınan=${moved}`);

    // Pozitif ikiz: aynı müşteri, aynı tür/para iki kaynakta → gerçek kısıt çarpar, BLOK kalır.
    const s2 = await mkItem("XS-PS2");
    const k3 = await mkItem("XS-PK3");
    const k4 = await mkItem("XS-PK4");
    await prisma.itemPrice.createMany({
      data: [
        { itemId: k3, customerId: c1, kind: "SALE", currency: "TRY", price: 10 },
        { itemId: k4, customerId: c1, kind: "SALE", currency: "TRY", price: 11 },
      ],
    });
    const pv2 = await MasterDataMergeService.preview("item", s2, [k3, k4]);
    check("⑦e aynı müşterinin iki kaynaktaki istisnası hâlâ BLOKÇU",
      pv2.blockers.some((b) => b.key === "CONFLICT_ITEM_PRICES" && b.count === 1),
      pv2.blockers.map((b) => `${b.key}:${b.count}`).join(",") || "blokçu yok");
    // İki kaynakta kart VARSAYILANI (customerId NULL): varsayılan partial UNIQUE'i çarpar — NULL eşit sayılmalı.
    const s3 = await mkItem("XS-PS3");
    const k5 = await mkItem("XS-PK5");
    const k6 = await mkItem("XS-PK6");
    await prisma.itemPrice.createMany({
      data: [
        { itemId: k5, customerId: null, kind: "SALE", currency: "TRY", price: 10 },
        { itemId: k6, customerId: null, kind: "SALE", currency: "TRY", price: 12 },
      ],
    });
    const pv3 = await MasterDataMergeService.preview("item", s3, [k5, k6]);
    check("⑦e iki kaynaktaki kart varsayılanı BLOKÇU (NULL müşteri eşit sayılır)",
      pv3.blockers.some((b) => b.key === "CONFLICT_ITEM_PRICES" && b.count === 1),
      pv3.blockers.map((b) => `${b.key}:${b.count}`).join(",") || "blokçu yok");
  }
}

async function kumasaOzelRenkAdi(red: string): Promise<void> {
  console.log("\n── ⑥ Kumaşa özel müşteri renk adı: SKIP + gölgeleme önizlemesi + çok kaynak ──");
  const X = await mkItem("IC-X");
  const Y = await mkItem("IC-Y");
  const s = await mkCustomer("IC-S");
  const k = await mkCustomer("IC-K");
  await prisma.customerColorAlias.create({ data: { customerId: s, colorId: red, alias: "GENEL-S" } });
  await prisma.customerItemColorAlias.create({ data: { customerId: s, itemId: X, colorId: red, alias: "S-X" } });
  await prisma.customerItemColorAlias.create({ data: { customerId: k, itemId: X, colorId: red, alias: "K-X" } });
  await prisma.customerItemColorAlias.create({ data: { customerId: k, itemId: Y, colorId: red, alias: "K-Y" } });
  const pv = await MasterDataMergeService.preview("customer", s, [k]);
  const golge = pv.shadowing;
  check("⑥ önizleme: taşınan Y satırı GÖLGELEME olarak listelendi (önce GENEL-S → sonra K-Y)",
    golge.length === 1 && golge[0]?.alias === "K-Y" && golge[0]?.before === "GENEL-S", JSON.stringify(golge));
  check("⑥ önizleme: çakışan X satırı (SKIP) gölgeleme listesinde DEĞİL, çakışmada",
    pv.conflicts.some((c) => c.table === "customer_item_color_aliases" && c.count === 1));
  check("⑥ önizleme uyarısı basıldı", pv.warnings.some((w) => w.includes("kumaşa özel müşteri renk adı")));
  await MasterDataMergeService.merge("customer", { survivorId: s, sourceIds: [k], reason: "kumasa ozel ad sondasi", acknowledgedConflicts: pv.conflicts.length });
  const rows = await prisma.customerItemColorAlias.findMany({ where: { customerId: s }, select: { itemId: true, alias: true } });
  const ad = (i: string) => rows.find((r) => r.itemId === i)?.alias;
  check("⑥ SKIP: survivor'ın X adı korundu, Y taşındı", ad(X) === "S-X" && ad(Y) === "K-Y", JSON.stringify(rows));

  const s2 = await mkCustomer("IC-S2");
  const k2 = await mkCustomer("IC-K2");
  const k3 = await mkCustomer("IC-K3");
  await prisma.customerItemColorAlias.create({ data: { customerId: k2, itemId: X, colorId: red, alias: "K2-X" } });
  await prisma.customerItemColorAlias.create({ data: { customerId: k3, itemId: X, colorId: red, alias: "K3-X" } });
  let hata = "";
  try {
    const pv2 = await MasterDataMergeService.preview("customer", s2, [k2, k3]);
    await MasterDataMergeService.merge("customer", { survivorId: s2, sourceIds: [k2, k3], reason: "cok kaynak sondasi", acknowledgedConflicts: pv2.conflicts.length });
  } catch (e) {
    hata = `${(e as Error).name}: ${(e as Error).message} ${JSON.stringify((e as { details?: unknown }).details ?? null)}`;
  }
  const kalan = await prisma.customerItemColorAlias.findMany({ where: { customerId: s2 }, select: { alias: true } });
  check("⑥ ÇOK KAYNAK: iki kaynakta aynı (kumaş, renk) birleştirmeyi düşürmüyor", hata === "", hata);
  check("⑥ ÇOK KAYNAK: survivor'da TEK satır kaldı", kalan.length === 1, JSON.stringify(kalan));
}

main()
  .catch((e) => {
    fail++;
    console.error("HATA:", e);
  })
  .finally(async () => {
    await prisma.itemAllowedColor.deleteMany({ where: { itemId: { in: trash.items } } }).catch(() => undefined);
    await prisma.itemAllowedColor.deleteMany({ where: { colorId: { in: trash.colors } } }).catch(() => undefined);
    await prisma.customerColorAlias.deleteMany({ where: { customerId: { in: trash.customers } } }).catch(() => undefined);
    await prisma.customerItemColorAlias.deleteMany({ where: { customerId: { in: trash.customers } } }).catch(() => undefined);
    await prisma.customerItemAlias.deleteMany({ where: { customerId: { in: trash.customers } } }).catch(() => undefined);
    const ops = await prisma.mergeOperation
      .findMany({ where: { survivorId: { in: [...trash.items, ...trash.colors, ...trash.customers] } }, select: { id: true } })
      .catch(() => [] as Array<{ id: string }>);
    const opIds = ops.map((o) => o.id);
    await prisma.mergeOperationRef.deleteMany({ where: { operationId: { in: opIds } } }).catch(() => undefined);
    await prisma.mergeOperationSource.deleteMany({ where: { operationId: { in: opIds } } }).catch(() => undefined);
    await prisma.mergeOperation.deleteMany({ where: { id: { in: opIds } } }).catch(() => undefined);
    await prisma.itemPrice.deleteMany({ where: { itemId: { in: trash.items } } }).catch(() => undefined);
    await prisma.customerBranch.deleteMany({ where: { customerId: { in: trash.customers } } }).catch(() => undefined);
    await prisma.systemLog.deleteMany({
      where: { recordId: { in: [...trash.items, ...trash.colors, ...trash.customers] } },
    }).catch(() => undefined);
    for (const m of ["item", "color", "customer"] as const) {
      const ids = m === "item" ? trash.items : m === "color" ? trash.colors : trash.customers;
      await (prisma[m] as unknown as { updateMany: (a: unknown) => Promise<unknown> })
        .updateMany({ where: { id: { in: ids } }, data: { mergedIntoId: null } })
        .catch(() => undefined);
      await (prisma[m] as unknown as { deleteMany: (a: unknown) => Promise<unknown> })
        .deleteMany({ where: { id: { in: ids } } })
        .catch(() => undefined);
    }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exitCode = fail > 0 ? 1 : 0;
  });
