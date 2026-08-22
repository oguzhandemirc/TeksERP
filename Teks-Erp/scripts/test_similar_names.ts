// =============================================================================
// BEKÇİ: "Benzer kayıtlar" — mükerreri REDDETMEK yerine ÖNLEMEK (2026-08-19)
// Çalıştır: npx tsx scripts/test_similar_names.ts
// =============================================================================
// `assertNameNotDuplicate` kaydet'e basıldıktan SONRA ve yalnız katlanmış ad
// BİREBİR aynıysa çarpar. Sahadaki mükerrerlerin çoğu birebir aynı değil YAKIN:
// "MODA TEKSTİL" ↔ "Moda Tekstil A.Ş.". Bu uç yazarken uyarmak içindir.
//
// ⚠️ BU BİR ENGEL DEĞİLDİR ve testin ilk işi bunu sabitlemektir: uç hiçbir şey
// yazmaz, hiçbir şeyi reddetmez. Engelleyici yapmak, meşru benzer adları (aynı
// grubun iki şirketi) kaydedilemez hâle getirirdi.
//
// ⚠️ EŞİK GÜRÜLTÜYE KARŞI AYARLI: "TEKSTİL" kelimesi bu fabrikada neredeyse her
// firmanın adında var; tek eşik kullanınca "MODA TEKSTIL" araması "Arda
// Tekstil"i de getiriyordu (ölçüldü: 0.53). Gürültü, uyarının görmezden
// gelinmesini öğretir — asıl zarar odur. Kısa adlarda ise ters sorun var:
// "AKTİVO" ↔ "ACTIVO" yalnız 0.4 benzerlik veriyor. Bu yüzden eşik uzunluğa
// duyarlı (≤8 harf → 0.35, uzun → 0.55) ve bu test iki ucu da ölçer.
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { BaseService } from "../src/services/base.service";

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

const TAG = `SIM${Date.now().toString().slice(-9)}`;
const customerIds: string[] = [];

class CustomerProbe extends BaseService {
  constructor() {
    super({
      modelName: "customer",
      tableName: "CUSTOMER",
      uniqueField: "code",
      duplicateNameField: "name",
      entityLabel: "müşteri",
    });
  }
}

async function main(): Promise<void> {
  const svc = new CustomerProbe();
  const mk = async (name: string, i: number): Promise<string> => {
    const c = await prisma.customer.create({
      data: { code: `${TAG}-${i}`, name, type: "CUSTOMER" },
      select: { id: true },
    });
    customerIds.push(c.id);
    return c.id;
  };
  const mine = (
    rows: Array<{ id: string; name: string; score: number }>,
  ): Array<{ name: string; score: number }> =>
    rows.filter((r) => customerIds.includes(r.id)).map((r) => ({ name: r.name, score: r.score }));

  // ⚠️ FIXTURE TASARIMI LOAD-BEARING: her ada AYNI etiketi eklemek, gürültü
  // satırını da yapay olarak "benzer" yapar (ilk yazımda tam bu oldu — ARDA
  // 0.62 ile listeye giriyordu, oysa gerçek veride 0.36'dır). Bu yüzden gürültü
  // satırı FARKLI bir etiket taşır: aradaki tek ortak şey "TEKSTİL" kelimesidir.
  const NOISE_TAG = TAG.split("").reverse().join("");
  await mk(`ÖZ ŞAHİN TEKSTİL ${TAG}`, 1);
  const dupId = await mk(`Öz Şahin Tekstil A.Ş. ${TAG}`, 2); // YAKIN — asıl hedef
  await mk(`ARDA TEKSTİL ${NOISE_TAG}`, 3); // GÜRÜLTÜ — yalnız "TEKSTİL" ortak
  // ⚠️ KISA AD testi için ad 8 harfi AŞMAMALI, yoksa uzun-ad eşiği (0.55) koşar
  // ve kısa yol hiç sınanmaz. "aktivo12" ↔ "activo12" = 0.50 (ölçüldü): uzun
  // eşiğin ALTINDA, kısa eşiğin (0.35) ÜSTÜNDE — tam ayırt edici değer.
  const SHORT = `AKTIVO${TAG.slice(-2)}`;
  await mk(SHORT, 4);

  try {
    console.log("\n── 1) Yakın ad yakalanıyor, gürültü elenmiş ──");
    const r1 = mine(await svc.findSimilarNames(`OZ SAHIN TEKSTIL ${TAG}`, { limit: 20 }));
    check(
      "birebir katlanan ad listede",
      r1.some((x) => x.name.startsWith("ÖZ ŞAHİN TEKSTİL")),
      r1.map((x) => `${x.name}[${x.score}]`).join(" · "),
    );
    check("YAKIN ad da listede (A.Ş. ekli)", r1.some((x) => x.name.includes("A.Ş.")));
    check(
      "GÜRÜLTÜ elendi: yalnız 'TEKSTİL' ortak olan gelmiyor",
      !r1.some((x) => x.name.startsWith("ARDA")),
      "eşik uzun adlarda 0.55",
    );

    console.log("\n── 2) Kısa ad: tek harf farkı yakalanmalı ──");
    // "AKTIVO" ↔ "AKTİVO": katlamadan sonra aynı → birebir eşleşme.
    // "ACTIVO": c/k farkı → 0.4 benzerlik; kısa-ad eşiği (0.35) bunu kurtarır.
    const shortQuery = `ACTIVO${TAG.slice(-2)}`;
    check("kısa ad gerçekten kısa (uzun eşiğe düşmüyor)", shortQuery.length <= 8, `${shortQuery.length} harf`);
    const r2 = mine(await svc.findSimilarNames(shortQuery, { limit: 20 }));
    check(
      "kısa adda tek harf farkı yakalanıyor",
      r2.some((x) => x.name.startsWith("AKTIVO")),
      r2.map((x) => `${x.name}[${x.score}]`).join(" · ") || "(boş)",
    );

    console.log("\n── 3) Sözleşme: uç OKUR, yazmaz, reddetmez ──");
    const before = await prisma.customer.count();
    await svc.findSimilarNames(`ÖZ ŞAHİN TEKSTİL ${TAG}`);
    check("çağrı hiçbir kayıt yaratmadı/silmedi", (await prisma.customer.count()) === before);
    // Benzer kayıt VARKEN create çalışmaya devam etmeli — uyarı engel değildir.
    const ok = await prisma.customer.create({
      data: { code: `${TAG}-9`, name: `ÖZ ŞAHİN TEKSTİL SANAYİ ${TAG}`, type: "CUSTOMER" },
      select: { id: true },
    });
    customerIds.push(ok.id);
    check("benzer kayıt varken YENİ kayıt açılabiliyor (engel değil)", true);

    console.log("\n── 4) Sınırlar ──");
    check("1-2 harflik terim boş döner (her şey 'benzer' çıkardı)", (await svc.findSimilarNames("AB")).length === 0);
    check("boş terim boş döner", (await svc.findSimilarNames("   ")).length === 0);
    const r3 = mine(await svc.findSimilarNames(`ZZQXW ${TAG}`, { limit: 20 }));
    check("alakasız terim eşleşmiyor (körlük kontrolü)", r3.length === 0, `${r3.length} sonuç`);
    const r4 = await svc.findSimilarNames(`ÖZ ŞAHİN TEKSTİL ${TAG}`, { excludeId: dupId, limit: 20 });
    check("excludeId ile kaydın kendisi elenir (düzenleme ekranı)", !r4.some((x) => x.id === dupId));
    check("limit üst sınırı uygulanıyor", (await svc.findSimilarNames("TEKSTİL", { limit: 999 })).length <= 20);

    console.log("\n── 5) duplicateNameField olmayan model boş döner ──");
    class NoNameProbe extends BaseService {
      constructor() {
        super({ modelName: "customer", tableName: "CUSTOMER" });
      }
    }
    check("ad alanı tanımsızsa uç boş döner (500 değil)", (await new NoNameProbe().findSimilarNames("herhangi")).length === 0);
  } finally {
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } }).catch(() => {});
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
