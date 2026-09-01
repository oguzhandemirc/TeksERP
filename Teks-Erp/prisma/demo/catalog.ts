// =============================================================================
// DEMO SEED — KATALOG (kumaş · renk · özellik)
// =============================================================================
// Kaynak `katalog.json`: SAHADAKİ fabrikanın kendi kataloğunun aktif satırları
// (kullanıcı kararı: "tanımlar kısmı buradakinin birebir aynısı olsun").
// Müşteri/sipariş/iş emri verisi buradan GELMEZ — o taraf uydurmadır (gizlilik).
//
// ⚠️ TEKİLLEŞTİRME ŞART: `items`/`colors` üzerinde katlanmış ad seddi var
// (`items_nameFold_key`, `colors_nameFoldColor_key`). Katalogda harf/boşluk
// farkıyla ikizlenen satırlar varsa ikinci INSERT P2002'ye düşer ve seed yarıda
// kalır. Bu yüzden yazımdan ÖNCE katlanmış anahtara göre elenir.
// =============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import prisma from "../../src/lib/prisma";
import { adim, say, not } from "./_kit";

interface Katalog {
  items: Array<{ code: string; name: string; unit: string; width: number | null }>;
  colors: Array<{ name: string; hex: string | null }>;
  properties: Array<{ code: string; name: string; valueType: string }>;
}

/** JS tarafı kaba katlama — DB'deki `tr_fold` ile birebir olmak zorunda DEĞİL;
 *  işi yalnız "aynı satırı iki kez yazma" (ikizleri elemek). */
function katla(s: string): string {
  return s
    .toLocaleUpperCase("tr")
    .replace(/[İIıi]/g, "I")
    .replace(/[ĞğǴ]/g, "G")
    .replace(/[Üü]/g, "U")
    .replace(/[Şş]/g, "S")
    .replace(/[Öö]/g, "O")
    .replace(/[Çç]/g, "C")
    .replace(/[^A-Z0-9]/g, "");
}

/** Ada bakarak KOD üretir (renk kataloğunda kod yok). Çakışırsa sayı ekler. */
function kodUret(ad: string, kullanilan: Set<string>, onek = ""): string {
  const taban = (onek + katla(ad)).slice(0, 28) || "X";
  let kod = taban;
  let i = 2;
  while (kullanilan.has(kod)) kod = `${taban.slice(0, 26)}${i++}`;
  kullanilan.add(kod);
  return kod;
}

export async function katalogKur(): Promise<{
  itemIds: string[];
  colorIds: string[];
  propertyIds: string[];
}> {
  adim("Katalog — kumaş · renk · özellik");
  const k: Katalog = JSON.parse(readFileSync(join(__dirname, "katalog.json"), "utf8"));

  // ── RENKLER ───────────────────────────────────────────────────────────────
  // ⚠️ `isActive` süzgeci LOAD-BEARING: dönen id'ler sipariş/iş emri kalemlerine
  // gidiyor ve servis PASİF rengi reddediyor ("bulunmayan veya pasif renk var").
  // Süzgeçsiz hâlinde 45 siparişin 4'ü sessizce düştü (ölçüldü).
  const mevcutRenk = await prisma.color.findMany({
    where: { isActive: true, mergedIntoId: null },
    select: { id: true, name: true, code: true },
  });
  const renkFold = new Set(mevcutRenk.map((c) => katla(c.name)));
  const renkKod = new Set(mevcutRenk.map((c) => c.code));
  const colorIds: string[] = mevcutRenk.map((c) => c.id);

  let sira = 100;
  for (const c of k.colors) {
    const f = katla(c.name);
    if (!f || renkFold.has(f)) continue; // ikiz ya da boş — atla
    renkFold.add(f);
    const olusan = await prisma.color.create({
      data: {
        code: kodUret(c.name, renkKod),
        name: c.name,
        hex: c.hex,
        sortOrder: sira++,
      },
      select: { id: true },
    });
    colorIds.push(olusan.id);
    say("renk");
  }

  // ── KUMAŞLAR ──────────────────────────────────────────────────────────────
  const mevcutItem = await prisma.item.findMany({
    where: { itemType: "FABRIC", isActive: true, mergedIntoId: null },
    select: { id: true, name: true, code: true },
  });
  const itemFold = new Set(mevcutItem.map((i) => katla(i.name)));
  const itemKod = new Set(mevcutItem.map((i) => katla(i.code)));
  const itemIds: string[] = mevcutItem.map((i) => i.id);

  for (const it of k.items) {
    const f = katla(it.name);
    if (!f || itemFold.has(f)) continue;
    itemFold.add(f);
    // ⚠️ `items_code_fold_key` KATLANMIŞ koda bakar → kodu da katlanmış uzayda
    // tekilleştir, yoksa "EGE" ile "Ege" ikinci insert'te P2002 verir.
    const kodTaban = katla(it.code) || katla(it.name);
    let kod = kodTaban;
    let n = 2;
    while (itemKod.has(katla(kod))) kod = `${kodTaban.slice(0, 28)}${n++}`;
    itemKod.add(katla(kod));

    const olusan = await prisma.item.create({
      data: {
        code: kod.slice(0, 32),
        name: it.name,
        itemType: "FABRIC",
        unit: (it.unit === "KG" ? "KG" : "MT") as "KG" | "MT",
      },
      select: { id: true },
    });
    itemIds.push(olusan.id);
    say("kumaş");
  }

  // ── İPLİK + SARF ──────────────────────────────────────────────────────────
  // Katalogda yok ama İplik Kg-Stok ekranının ÖN KOŞULU: `ItemType.YARN` kartı
  // olmadan o ekran tanım gereği boştur.
  const iplikler = [
    { code: "IPL-PES-150", name: "Polyester 150 Denye", unit: "KG" as const },
    { code: "IPL-PES-300", name: "Polyester 300 Denye", unit: "KG" as const },
    { code: "IPL-PAM-30", name: "Pamuk Ne 30/1", unit: "KG" as const },
    { code: "IPL-VIS-40", name: "Viskon Ne 40/1", unit: "KG" as const },
  ];
  const yarnIds: string[] = [];
  for (const y of iplikler) {
    const v = await prisma.item.upsert({
      where: { code: y.code },
      update: {},
      create: { code: y.code, name: y.name, itemType: "YARN", unit: y.unit },
      select: { id: true },
    });
    yarnIds.push(v.id);
    say("iplik kartı");
  }

  // ── KUMAŞ ÖZELLİKLERİ ─────────────────────────────────────────────────────
  // ⚠️ ADA GÖRE DE TEKİLLEŞTİR: `fabric_properties_nameFold_key` seddi var ve
  // yalnız KOD kontrolü yetmiyor — canlı demoda aynı adı FARKLI kodla taşıyan
  // özellikler vardı ve seed sunucuda P2002 ile düştü (ölçüldü). Renk ve kumaş
  // tarafında zaten yapılıyordu; özellik atlanmıştı.
  const mevcutOzellik = await prisma.fabricProperty.findMany({
    select: { id: true, code: true, name: true },
  });
  const ozellikKod = new Set(mevcutOzellik.map((p) => p.code));
  const ozellikFold = new Set(mevcutOzellik.map((p) => katla(p.name)));
  const propertyIds: string[] = mevcutOzellik.map((p) => p.id);

  for (const p of k.properties) {
    const pf = katla(p.name);
    if (ozellikKod.has(p.code) || !pf || ozellikFold.has(pf)) continue;
    ozellikKod.add(p.code);
    ozellikFold.add(pf);
    const olusan = await prisma.fabricProperty.create({
      data: {
        code: p.code,
        name: p.name,
        valueType: p.valueType === "CHOICE" ? "CHOICE" : "FLAG",
      },
      select: { id: true },
    });
    propertyIds.push(olusan.id);
    say("kumaş özelliği");
  }

  // ⚠️ ÖZELLİK İSTASYONA BAĞLANMAZSA GÖRÜNMEZ: rota adımındaki hedef seçici
  // `StationProperty` üzerinden süzer (saha vakası: `ZIMPARALI` iki hafta boyunca
  // 0 iş emrinde kullanıldı çünkü hiçbir istasyonun listesinde değildi).
  const istasyonlar = await prisma.station.findMany({
    where: { isActive: true, appliesProperty: true },
    select: { id: true },
  });
  if (istasyonlar.length === 0) {
    not("Özellik uygulayan istasyon yok — kumaş özellikleri hiçbir rota adımında seçilemeyecek.");
  } else {
    const baglar = propertyIds.flatMap((pid) =>
      istasyonlar.map((s) => ({ stationId: s.id, propertyId: pid })),
    );
    const r = await prisma.stationProperty.createMany({ data: baglar, skipDuplicates: true });
    say("özellik↔istasyon bağı", r.count);
  }

  console.log(
    `   kumaş=${itemIds.length} · iplik=${yarnIds.length} · renk=${colorIds.length} · özellik=${propertyIds.length}`,
  );
  return { itemIds, colorIds, propertyIds };
}
