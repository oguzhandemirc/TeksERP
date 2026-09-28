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
  await kaynaklarArasi(red, blue);

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
}

/**
 * ⑦ Kaynaklar arası çakışma SKIP dışındaki politikalarda: iki kaynakta aynı anahtar varken
 * hedefte yoksa ikinci kaynağın taşıması P2002 verirdi (MERGE_FIELDS · EMPTY_MEANS_ALL)
 * ya da BLOCK sessizce 500'e düşerdi.
 */
async function kaynaklarArasi(red: string, blue: string): Promise<void> {
  console.log("\n── ⑦ Kaynaklar arası çakışma: MERGE_FIELDS · EMPTY_MEANS_ALL · BLOCK ──");
  const hataOf = async (fn: () => Promise<unknown>): Promise<string> => {
    try {
      await fn();
      return "";
    } catch (e) {
      return `${(e as { statusCode?: number }).statusCode ?? (e as Error).name}: ${(e as Error).message.slice(0, 200)}`;
    }
  };
  {
    const s = await mkCustomer("KA-S");
    const k2 = await mkCustomer("KA-K2");
    const k3 = await mkCustomer("KA-K3");
    await prisma.customerColorAlias.create({ data: { customerId: k2, colorId: red, assigned: false, alias: "K2-AD" } });
    await prisma.customerColorAlias.create({ data: { customerId: k3, colorId: red, assigned: true } });
    const pv = await MasterDataMergeService.preview("customer", s, [k2, k3]);
    const hata = await hataOf(() =>
      MasterDataMergeService.merge("customer", { survivorId: s, sourceIds: [k2, k3], reason: "kaynaklar arasi merge fields", acknowledgedConflicts: pv.conflicts.length }),
    );
    const row = await prisma.customerColorAlias.findFirst({ where: { customerId: s, colorId: red } });
    check("⑦ MERGE_FIELDS: iki kaynakta aynı renk birleştirmeyi düşürmüyor", hata === "", hata);
    check("⑦ MERGE_FIELDS: tek satır, ad ilk kaynaktan + atama OR (K3'ün ataması kaybolmadı)",
      row?.alias === "K2-AD" && row?.assigned === true, JSON.stringify(row && { alias: row.alias, assigned: row.assigned }));
  }
  {
    const s = await mkItem("KA-ES");
    const k2 = await mkItem("KA-EK2");
    const k3 = await mkItem("KA-EK3");
    await prisma.itemAllowedColor.create({ data: { itemId: s, colorId: blue } });
    await prisma.itemAllowedColor.create({ data: { itemId: k2, colorId: red } });
    await prisma.itemAllowedColor.create({ data: { itemId: k3, colorId: red } });
    const pv = await MasterDataMergeService.preview("item", s, [k2, k3]);
    const hata = await hataOf(() =>
      MasterDataMergeService.merge("item", { survivorId: s, sourceIds: [k2, k3], reason: "kaynaklar arasi bos hepsi", acknowledgedConflicts: pv.conflicts.length }),
    );
    const n = await prisma.itemAllowedColor.count({ where: { itemId: s } });
    check("⑦ EMPTY_MEANS_ALL: iki kaynakta aynı renk birleştirmeyi düşürmüyor", hata === "", hata);
    check("⑦ EMPTY_MEANS_ALL: survivor'da mavi + kırmızı (mükerrersiz)", n === 2, `${n} satır`);
  }
  {
    const s = await mkCustomer("KA-BS");
    const k2 = await mkCustomer("KA-BK2");
    const k3 = await mkCustomer("KA-BK3");
    await prisma.customerBranch.create({ data: { customerId: k2, name: "Ana", code: "TR35" } });
    await prisma.customerBranch.create({ data: { customerId: k3, name: "Depo", code: "TR35" } });
    const pv = await MasterDataMergeService.preview("customer", s, [k2, k3]);
    check("⑦ BLOCK: kaynaklar arası aynı ihracat kodu önizlemede ENGEL", !pv.canMerge && pv.blockers.some((b) => b.key === "CONFLICT_CUSTOMER_BRANCHES"),
      pv.blockers.map((b) => b.key).join(","));
    const hata = await hataOf(() =>
      MasterDataMergeService.merge("customer", { survivorId: s, sourceIds: [k2, k3], reason: "kaynaklar arasi block", acknowledgedConflicts: pv.conflicts.length }),
    );
    check("⑦ BLOCK: işlem 409 (P2002/500 DEĞİL)", hata.startsWith("409"), hata);
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
  let golge2 = "";
  try {
    const pv2 = await MasterDataMergeService.preview("customer", s2, [k2, k3]);
    golge2 = pv2.shadowing.map((g) => g.alias).join(",");
    await MasterDataMergeService.merge("customer", { survivorId: s2, sourceIds: [k2, k3], reason: "cok kaynak sondasi", acknowledgedConflicts: pv2.conflicts.length });
  } catch (e) {
    hata = `${(e as Error).name}: ${(e as Error).message} ${JSON.stringify((e as { details?: unknown }).details ?? null)}`;
  }
  const kalan = await prisma.customerItemColorAlias.findMany({ where: { customerId: s2 }, select: { alias: true } });
  check("⑥ ÇOK KAYNAK: iki kaynakta aynı (kumaş, renk) birleştirmeyi düşürmüyor", hata === "", hata);
  check("⑥ ÇOK KAYNAK: survivor'da TEK satır kaldı — ilk kaynağınki", kalan.length === 1 && kalan[0]?.alias === "K2-X", JSON.stringify(kalan));
  check("⑥ ÇOK KAYNAK: gölgeleme yalnız TAŞINACAK satırı listeler (atılacak K3-X basılacak ad değil)", golge2 === "K2-X", golge2);
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
