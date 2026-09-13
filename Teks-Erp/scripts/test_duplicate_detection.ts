// =============================================================================
// Test: MÜKERRER TESPİT MOTORU + İNCELEME KUYRUĞU (mükerrer paneli v2 P1, 2026-08-22)
// Çalıştır: npx tsx scripts/test_duplicate_detection.ts
// =============================================================================
// Kilitlenen sözleşmeler:
//   §0 Kimlik kuralı alanları gerçekten şemada (DMMF) — yanlış kolon adı sessiz no-op olurdu
//   §1 Benzerlik yardımcıları saf: Jaro-Winkler / token-set / NUMERİK TOKEN KORUMASI
//      (canlı ölçüm: "KRİSTAL V-01"/"V-02" aday OLMAMALI) / gürültü kelimeleri
//   §2 Tarama: kesin ad (renk token-sırası bağımsız) · kimlik (VKN biçim farkı,
//      kod harf-ikizi) · bulanık ad (firma adı varyantı) — her aday GEREKÇELİ
//   §3 Karar: NOT_DUPLICATE çifti gizler (includeNotDuplicate ile görünür), DEFERRED
//      kuyrukta işaretli kalır, geri açınca çift döner; MERGED geri açılamaz
//   §4 Ayar kapısı: eşik yükselince bulanık düşer (kimlik kalır), bayrak kapalıyken
//      hiç bulanık gerekçe yok
//   §5 Birleştirme motoru MERGED izini yazar (hook) ve tombstone taramadan düşer
//   §6 CSV: BOM + başlık + çift satırları
// =============================================================================
import { DuplicateReviewDecision, Prisma } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { IDENTITY_RULES } from "../src/constants/duplicate-rules";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { DuplicateDetectionService } from "../src/services/duplicate-detection.service";
import { DuplicateReviewService, pairKeyOf } from "../src/services/duplicate-review.service";
import { MasterDataMergeService } from "../src/services/master-data-merge.service";
import {
  editRatio,
  alignedTokenScore,
  numericTokensEqual,
  stripNoiseWords,
  compactKey,
  firmNameSimilarity,
  productNameSimilarity,
} from "../src/utils/string-similarity";
import { FUZZY_NOISE_WORDS, DUPLICATES_FUZZY_MIN_PCT } from "../src/constants/duplicate-rules";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}

const TAG = `TDUP${Date.now().toString().slice(-7)}`;
const created = { customers: [] as string[], items: [] as string[], colors: [] as string[] };
const settingKeys = [SETTING_KEYS.DUPLICATES_FUZZY_ENABLED, SETTING_KEYS.DUPLICATES_FUZZY_THRESHOLD_PCT];
let settingsBackup: Array<{ key: string; value: Prisma.JsonValue }> = [];

async function main(): Promise<void> {
  // ── §0 DMMF: kimlik kuralı alanları şemada ────────────────────────────────
  console.log("\n── §0 Kimlik kuralı alanları şemada mı (DMMF) ──");
  const models = (Prisma as unknown as { dmmf?: { datamodel?: { models?: Array<{ name: string; fields: Array<{ name: string }> }> } } }).dmmf?.datamodel?.models ?? [];
  const modelOf: Record<string, string> = { customer: "Customer", item: "Item", color: "Color", subcontractor: "Subcontractor" };
  for (const [entity, rules] of Object.entries(IDENTITY_RULES)) {
    const m = models.find((x) => x.name === modelOf[entity]);
    const fields = new Set(m?.fields.map((f) => f.name) ?? []);
    for (const r of rules) check(`${entity}.${r.field} şemada var`, fields.has(r.field));
  }
  check("körlük zemini: DMMF modelleri okundu", models.length > 50, `${models.length} model`);

  // ── §1 Benzerlik yardımcıları ─────────────────────────────────────────────
  console.log("\n── §1 Benzerlik yardımcıları (saf) ──");
  check("editRatio: tek harf hatası ~0.8 (5 harfli kelime)", Math.abs(editRatio("sahin", "sahim") - 0.8) < 0.001, editRatio("sahin", "sahim").toFixed(2));
  check("hizalama: kelime SIRASI önemsiz", alignedTokenScore("sahin tekstil", "tekstil sahin", "avg") === 1);
  check("hizalama(avg): fazladan anlamlı kelime skoru böler ('boyer emre' ↔ 'boyer')", Math.abs(alignedTokenScore("boyer emre", "boyer", "avg") - 0.5) < 0.001);
  check("hizalama(min): tek kelime farkı skoru çeker", alignedTokenScore("kristal gumus ekru", "kristal gumus gri", "min") < 0.4);
  check("compactKey: yalnız boşluk/ayraç farkı aynı anahtar", compactKey("mikro canvas") === compactKey("mikrocanvas"));
  check("numerik koruma: V-01 ≠ V-02", !numericTokensEqual("kristal v-01", "kristal v-02"));
  check("numerik koruma: 035 ≠ 036", !numericTokensEqual("quality 035", "quality 036"));
  check("numerik koruma: ikisi de sayısız → eşit", numericTokensEqual("sahin tekstil", "sahin tekstil as"));
  check("numerik koruma: aynı sayı, farklı ayraç → eşit", numericTokensEqual("mrt04 v-04", "mrt04 v 04"));
  check("gürültü: 'sahin tekstil ltd sti' → 'sahin'", stripNoiseWords("sahin tekstil ltd sti", FUZZY_NOISE_WORDS) === "sahin");
  check("gürültü: hepsi gürültüyse orijinal korunur", stripNoiseWords("tekstil as", FUZZY_NOISE_WORDS) === "tekstil as");
  const sim = firmNameSimilarity("sahin tekstil as", "sahin tekstil ltd sti", FUZZY_NOISE_WORDS);
  check("FİRMA: eklenti farkı (A.Ş. ↔ LTD ŞTİ) → 1", sim === 1, sim.toFixed(2));
  // ⭐ SAHA KARARI 2026-08-22: "BOYER EMRE" ile "BOYER" FARKLI FİRMA. İlk sürümde
  // Jaro-Winkler ön ek bonusu bunu tam 0.900 ile aday yapıyordu (canlı kopyada çıktı).
  const simExtra = firmNameSimilarity("boyer emre", "boyer", FUZZY_NOISE_WORDS);
  check("FİRMA: fazladan ANLAMLI kelime → 0.50 (BOYER EMRE ≠ BOYER, saha kararı)", Math.abs(simExtra - 0.5) < 0.001, simExtra.toFixed(2));
  check("FİRMA: en düşük eşikte (%50) bile 'BOYER EMRE' aday DEĞİL (0.50 < 0.50+)", simExtra < DUPLICATES_FUZZY_MIN_PCT / 100 + 0.001 && simExtra <= 0.5);
  const simSubset = firmNameSimilarity("moda tekstil", "moda ankara tekstil", FUZZY_NOISE_WORDS);
  check("FİRMA: alt-küme ad eşik altı (%90)", simSubset < 0.9, simSubset.toFixed(2));
  const simTypo = firmNameSimilarity("sahin tekstil", "sahim tekstil", FUZZY_NOISE_WORDS);
  check("FİRMA: tek harf hatası %80 bandında (eşik düşürülünce gelir)", simTypo >= 0.79 && simTypo < 0.9, simTypo.toFixed(2));
  // ÜRÜN profili — canlı ölçümdeki yanlış pozitif aileleri (hepsi 0 ya da eşik altı olmalı)
  check("ÜRÜN: 'kristal gumus ekru' ↔ 'kristal gumus gri' varyant → eşik altı", productNameSimilarity("kristal gumus ekru", "kristal gumus gri") < 0.9);
  check("ÜRÜN: 'kristal' ↔ 'kristal altin' token sayısı farklı → 0", productNameSimilarity("kristal", "kristal altin") === 0);
  check("ÜRÜN: 'a gri' ↔ 'gri' (renk ön eki) → 0", productNameSimilarity("a gri", "gri") === 0);
  check("ÜRÜN: 'activo siyah krem altin' ↔ 'activo siyah krem gumus' → eşik altı", productNameSimilarity("activo siyah krem altin", "activo siyah krem gumus") < 0.9);
  check("ÜRÜN: yalnız boşluk/ayraç farkı → 1 ('mikro canvas' ↔ 'mikrocanvas')", productNameSimilarity("mikro canvas", "mikrocanvas") === 1);
  check("ÜRÜN: kelime sırası ('gumus beyaz' ↔ 'beyaz gumus') → 1 (insan incelesin)", productNameSimilarity("gumus beyaz", "beyaz gumus") === 1);

  // ── §2 Fixture + tarama ───────────────────────────────────────────────────
  console.log("\n── §2 Tarama: kesin ad · kimlik · bulanık ad ──");
  const custA = await prisma.customer.create({ data: { code: `${TAG}-CA`, name: `${TAG} Şahin Tekstil A.Ş.`, taxNumber: "123 456 78 90" }, select: { id: true } });
  // B: çekirdek kelimede TEK HARF farkı (SAHİM) → skor tam %90 bandında kalsın ki §4
  // eşik testi gerçekten bir şey ölçsün (çekirdekler birebir aynıysa eşik ne olursa
  // olsun 1.0 çıkar — ilk kurguda tam bu yüzden kördü).
  const custB = await prisma.customer.create({ data: { code: `${TAG}-CB`, name: `${TAG} SAHİM TEKSTİL LTD. ŞTİ.`, taxNumber: "1234567890" }, select: { id: true } });
  const custC = await prisma.customer.create({ data: { code: `${TAG}-CC`, name: `${TAG} Şahin Tekstil 2`, taxNumber: "9876543210" }, select: { id: true } });
  const custD = await prisma.customer.create({ data: { code: `${TAG}-CD`, name: `${TAG} Bambaşka Firma` }, select: { id: true } });
  // E: A'nın adına ANLAMLI bir kelime eklenmiş hâli — saha kararı gereği aday OLMAMALI
  // ("BOYER EMRE" ≠ "BOYER"). VKN'si YOK ki kimlik kuralı devreye girip testi körleştirmesin.
  const custE = await prisma.customer.create({ data: { code: `${TAG}-CE`, name: `${TAG} Şahin Tekstil Emre` }, select: { id: true } });
  created.customers.push(custA.id, custB.id, custC.id, custD.id, custE.id);
  const colA = await prisma.color.create({ data: { code: `${TAG}-R1`, name: `${TAG} BEYAZ 055`, hex: "#ffffff" }, select: { id: true } });
  // Renk katlaması: sayı token'ları başa, kalanlar kendi sırasıyla — "BEYAZ 055" ≡ "055-BEYAZ".
  // ⚠️ RENK AD SEDDİ KURULUYSA BU ÇİFT ARTIK YARATILAMAZ (2026-08-30).
  // `colors_nameFoldColor_key` tam da bu ikizi engellemek için var: "BEYAZ 055"
  // ile "055-BEYAZ" katlandığında AYNI addır. Sed kurulu bir veritabanında
  // exact-fold renk mükerreri artık DOĞAMAZ — tespit kuralı yalnız SEDDEN ÖNCE
  // doğmuş ESKİ satırlar için anlamlıdır. Test bunu ölçerek uyarlanır:
  //   • sed VARSA  → ikinci kaydın REDDEDİLDİĞİ ölçülür (daha güçlü garanti),
  //   • sed YOKSA  → eski tespit senaryosu aynen koşar.
  // Sabit varsayım yazmak, testi ortama göre yanlış yerden kırmızıya düşürürdü.
  /**
 * ⚠️ ÇIPLAK `catch` YASAK — bir yokluğa mekanizma atfetmek, o mekanizmayı ÖLÇMEK değildir.
 * Bağlantı koptuğunda · fikstürde yazım hatası olduğunda · ALAKASIZ bir unique ihlalinde
 * (ör. fikstürün kendi `code`u çakışırsa `colors_code_key` de P2002 verir) çıplak `catch`
 * hepsini "sed engelledi" sayar ve YEŞİL basar. Bu yüzden iki şey birden ölçülür:
 * hata KODU (`P2002`) **ve** KISITA ÖZGÜ ad. Ölçüldü 2026-09-13: aynı kod, ÜÇ farklı kısıt
 * (`tr_fold_color(name::text)` · `"nameFold"` · `upper(code::text)`).
 */
function p2002Kisit(e: unknown, kisitDeseni: RegExp): boolean {
  const p = e as { code?: string; message?: string };
  return p?.code === "P2002" && kisitDeseni.test(p.message ?? "");
}

let colB: { id: string } | null = null;
  let sedEngelledi = false;
  try {
    colB = await prisma.color.create({ data: { code: `${TAG}-R2`, name: `${TAG} 055-BEYAZ`, hex: "#fffffe" }, select: { id: true } });
  } catch (e) {
    if (!p2002Kisit(e, /tr_fold_color\(name/)) throw e;   // beklenmedik hata SESSİZ KALMAZ
    sedEngelledi = true;
  }
  created.colors.push(colA.id, ...(colB ? [colB.id] : []));
  if (sedEngelledi) {
    check(
      "renk ad seddi exact-fold ikizi ÜRETİLEMEZ kıldı (tespitten güçlü garanti)",
      true,
      "P2002 · tr_fold_color(name) — kısıt ADIYLA doğrulandı",
    );
  }
  const itA = await prisma.item.create({ data: { code: `${TAG.toLowerCase()}-aktivo`, name: `${TAG} Aktivo Bir`, itemType: "FABRIC" }, select: { id: true } });
  // ⚠️ KUMAŞ KOD SEDDİ KURULUYSA BU İKİZ DE YARATILAMAZ (2026-08-30).
  // `items_code_fold_key` harf farkını aynı kod sayar — renk seddiyle aynı
  // gerekçe, aynı uyarlama: sed varsa reddedilme ölçülür, yoksa tespit senaryosu.
  let itB: { id: string } | null = null;
  try {
    itB = await prisma.item.create({ data: { code: `${TAG}-AKTIVO`, name: `${TAG} Aktivo Dokuma`, itemType: "FABRIC" }, select: { id: true } });
  } catch (e) {
    if (!p2002Kisit(e, /upper\(code|items_code_fold/)) throw e;   // beklenmedik hata SESSİZ KALMAZ
    check("kumaş kod seddi harf-ikizini ÜRETİLEMEZ kıldı", true, "P2002 · upper(code) — kısıt ADIYLA doğrulandı");
  }
  const itC = await prisma.item.create({ data: { code: `${TAG}-KV1`, name: `${TAG} Kristal V-01`, itemType: "FABRIC" }, select: { id: true } });
  const itD = await prisma.item.create({ data: { code: `${TAG}-KV2`, name: `${TAG} Kristal V-02`, itemType: "FABRIC" }, select: { id: true } });
  // ÜRÜN profili (varyant ailesi): E/F farklı renk varyantı → aday DEĞİL; G/H yalnız boşluk farkı → %100 aday
  const itE = await prisma.item.create({ data: { code: `${TAG}-KGE`, name: `${TAG} Kristal Gümüş Ekru`, itemType: "FABRIC" }, select: { id: true } });
  const itF = await prisma.item.create({ data: { code: `${TAG}-KGG`, name: `${TAG} Kristal Gümüş Gri`, itemType: "FABRIC" }, select: { id: true } });
  const itG = await prisma.item.create({ data: { code: `${TAG}-MC1`, name: `${TAG} Mikro Canvas`, itemType: "FABRIC" }, select: { id: true } });
  const itH = await prisma.item.create({ data: { code: `${TAG}-MC2`, name: `${TAG} MikroCanvas`, itemType: "FABRIC" }, select: { id: true } });
  created.items.push(itA.id, ...(itB ? [itB.id] : []), itC.id, itD.id, itE.id, itF.id, itG.id, itH.id);

  // Ayarları yedekle ve varsayılana getir (test ortamdan bağımsız ölçsün)
  settingsBackup = await prisma.systemSetting.findMany({ where: { key: { in: settingKeys } }, select: { key: true, value: true } });
  await prisma.systemSetting.deleteMany({ where: { key: { in: settingKeys } } });

  const pk = (a: string, b: string) => pairKeyOf(a, b);
  const scanC = await DuplicateDetectionService.scan("customer");
  const pairAB = scanC.groups.flatMap((g) => g.pairs).find((p) => p.pairKey === pk(custA.id, custB.id));
  check("müşteri A–B aday", Boolean(pairAB), JSON.stringify(pairAB?.evidence.map((e) => e.rule)));
  check("A–B gerekçe: KİMLİK (VKN biçim farkıyla eşleşti)", Boolean(pairAB?.evidence.some((e) => e.rule === "IDENTITY" && e.detail.includes("1234567890"))));
  check("A–B gerekçe: BULANIK AD (A.Ş. ~ LTD ŞTİ, eşik %90)", Boolean(pairAB?.evidence.some((e) => e.rule === "FUZZY_NAME" && (e.score ?? 0) >= 0.9)));
  const pairAC = scanC.groups.flatMap((g) => g.pairs).find((p) => p.pairKey === pk(custA.id, custC.id));
  check("A–C aday DEĞİL (numerik koruma: '2')", !pairAC);
  const pairAD = scanC.groups.flatMap((g) => g.pairs).find((p) => p.pairKey === pk(custA.id, custD.id));
  check("A–D aday DEĞİL (alakasız ad)", !pairAD);
  const pairAE = scanC.groups.flatMap((g) => g.pairs).find((p) => p.pairKey === pk(custA.id, custE.id));
  check("⭐ A–E aday DEĞİL (fazladan anlamlı kelime: 'Şahin Tekstil' ↔ '… Emre' — BOYER EMRE saha kararı)", !pairAE);
  const grpAB = scanC.groups.find((g) => g.records.some((r) => r.id === custA.id));
  check("grup A+B (C/D dışarıda) ve referans sayısı ölçüldü", Boolean(grpAB) && grpAB!.records.length === 2 && grpAB!.records.every((r) => r.refCount !== null), `${grpAB?.records.length} kayıt`);
  check("grup rozetleri IDENTITY+FUZZY, skor ≥0.9", Boolean(grpAB?.rules.includes("IDENTITY") && grpAB?.rules.includes("FUZZY_NAME") && (grpAB?.maxScore ?? 0) >= 0.9));

  const scanR = await DuplicateDetectionService.scan("color");
  const pairR = colB ? scanR.groups.flatMap((g) => g.pairs).find((p) => p.pairKey === pk(colA.id, colB.id)) : undefined;
  if (colB) {
    check("renk: 'BEYAZ 055' ≡ '055-BEYAZ' KESİN AD (token sırası bağımsız)", Boolean(pairR?.evidence.some((e) => e.rule === "EXACT_NAME")));
  } else {
    check("renk exact-fold tespiti ATLANDI — sed ikizi üretilemez kıldı", true);
  }

  const scanI = await DuplicateDetectionService.scan("item");
  const pairIt = itB ? scanI.groups.flatMap((g) => g.pairs).find((p) => p.pairKey === pk(itA.id, itB.id)) : undefined;
  if (itB) {
    check("kumaş: kod harf-ikizi (aktivo/AKTIVO) KİMLİK adayı", Boolean(pairIt?.evidence.some((e) => e.rule === "IDENTITY" && e.label === "Kimlik çakışması")));
  } else {
    check("kumaş kod-ikizi tespiti ATLANDI — sed ikizi üretilemez kıldı", true);
  }
  const pairKV = scanI.groups.flatMap((g) => g.pairs).find((p) => p.pairKey === pk(itC.id, itD.id));
  check("kumaş: Kristal V-01 / V-02 aday DEĞİL (numerik koruma)", !pairKV);
  const pairEF = scanI.groups.flatMap((g) => g.pairs).find((p) => p.pairKey === pk(itE.id, itF.id));
  check("kumaş: Kristal Gümüş Ekru / Gri (renk varyantı) aday DEĞİL (ürün profili)", !pairEF);
  const pairGH = scanI.groups.flatMap((g) => g.pairs).find((p) => p.pairKey === pk(itG.id, itH.id));
  check("kumaş: 'Mikro Canvas' / 'MikroCanvas' yalnız boşluk farkı → %100 BULANIK aday", Boolean(pairGH?.evidence.some((e) => e.rule === "FUZZY_NAME" && (e.score ?? 0) >= 0.999)), JSON.stringify(pairGH?.evidence.map((e) => e.detail)));
  check("tarama meta: eşik %90, bulanık açık", scanC.thresholdPct === 90 && scanC.fuzzyEnabled === true);

  // ── §3 Kararlar ───────────────────────────────────────────────────────────
  console.log("\n── §3 İnceleme kararları ──");
  const rv = await DuplicateReviewService.decide({ entity: "customer", aId: custB.id, bId: custA.id, decision: DuplicateReviewDecision.NOT_DUPLICATE, note: "farklı şirketler, aynı VKN yanlış girilmiş", evidence: pairAB?.evidence });
  check("karar yazıldı, pairKey sıradan bağımsız", rv.pairKey === pk(custA.id, custB.id));
  const scanC2 = await DuplicateDetectionService.scan("customer");
  check("NOT_DUPLICATE çift kuyruktan düştü", !scanC2.groups.flatMap((g) => g.pairs).some((p) => p.pairKey === rv.pairKey) && scanC2.totals.hiddenNotDuplicate >= 1, `hidden=${scanC2.totals.hiddenNotDuplicate}`);
  const scanC3 = await DuplicateDetectionService.scan("customer", { includeNotDuplicate: true });
  const shown = scanC3.groups.flatMap((g) => g.pairs).find((p) => p.pairKey === rv.pairKey);
  check("includeNotDuplicate ile görünür ve kararı taşır", shown?.review?.decision === DuplicateReviewDecision.NOT_DUPLICATE && Boolean(shown?.review?.note?.includes("farklı")));
  await DuplicateReviewService.decide({ entity: "customer", aId: custA.id, bId: custB.id, decision: DuplicateReviewDecision.DEFERRED, note: "muhasebeye soruldu" });
  const scanC4 = await DuplicateDetectionService.scan("customer");
  const deferred = scanC4.groups.find((g) => g.records.some((r) => r.id === custA.id));
  check("DEFERRED: kuyrukta kalır, grup 'ertelenmiş' işaretli", Boolean(deferred?.hasDeferred) && deferred!.pairs[0]?.review?.decision === DuplicateReviewDecision.DEFERRED);
  const listed = await DuplicateReviewService.list("customer", DuplicateReviewDecision.DEFERRED);
  check("liste: DEFERRED süzgeci çalışıyor", listed.some((r) => r.pairKey === rv.pairKey));
  await DuplicateReviewService.reopen(rv.id);
  const scanC5 = await DuplicateDetectionService.scan("customer");
  check("geri açınca çift kararsız döner", scanC5.groups.flatMap((g) => g.pairs).some((p) => p.pairKey === rv.pairKey && p.review === null));
  let bad = false;
  try { await DuplicateReviewService.decide({ entity: "customer", aId: custA.id, bId: custB.id, decision: DuplicateReviewDecision.MERGED }); } catch { bad = true; }
  check("panelden MERGED kararı verilemez", bad);

  // ── §4 Ayar kapısı ────────────────────────────────────────────────────────
  console.log("\n── §4 Ayar kapısı (eşik / bayrak) ──");
  await prisma.systemSetting.upsert({ where: { key: SETTING_KEYS.DUPLICATES_FUZZY_THRESHOLD_PCT }, create: { key: SETTING_KEYS.DUPLICATES_FUZZY_THRESHOLD_PCT, value: 99, description: "test" }, update: { value: 99 } });
  const scanHi = await DuplicateDetectionService.scan("customer");
  const pairHi = scanHi.groups.flatMap((g) => g.pairs).find((p) => p.pairKey === pk(custA.id, custB.id));
  check("eşik %99: bulanık gerekçe düştü, KİMLİK kaldı", Boolean(pairHi) && !pairHi!.evidence.some((e) => e.rule === "FUZZY_NAME") && pairHi!.evidence.some((e) => e.rule === "IDENTITY"));
  check("tarama meta eşiği yansıtır", scanHi.thresholdPct === 99);
  await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.DUPLICATES_FUZZY_THRESHOLD_PCT } });
  await prisma.systemSetting.upsert({ where: { key: SETTING_KEYS.DUPLICATES_FUZZY_ENABLED }, create: { key: SETTING_KEYS.DUPLICATES_FUZZY_ENABLED, value: false, description: "test" }, update: { value: false } });
  const scanOff = await DuplicateDetectionService.scan("customer");
  check("bayrak kapalı: hiçbir bulanık gerekçe yok", scanOff.fuzzyEnabled === false && !scanOff.groups.flatMap((g) => g.pairs).some((p) => p.evidence.some((e) => e.rule === "FUZZY_NAME")));
  await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.DUPLICATES_FUZZY_ENABLED } });

  // ── §5 Birleştirme hook'u ─────────────────────────────────────────────────
  console.log("\n── §5 Birleştirme motoru MERGED izi ──");
  // ⚠️ BİRLEŞTİRME AKIŞI yalnız çift GERÇEKTEN varsa ölçülebilir. Renk ad seddi
  // kurulu bir veritabanında exact-fold ikizi doğamaz (yukarıda ölçüldü), yani
  // bu blok ESKİ satırların akışını temsil eder. Sessizce atlamıyoruz: durumu
  // bir kontrol olarak raporluyoruz ki "atlandı" ile "yeşil" karışmasın.
  if (!colB) {
    check(
      "birleştirme akışı ATLANDI — sed exact-fold ikizini üretilemez kıldı",
      true,
      "eski satırı olan bir DB'de bu blok koşar",
    );
  } else {
    const pv = await MasterDataMergeService.preview("color", colA.id, [colB.id]);
    check("renk çifti birleştirilebilir", pv.canMerge, pv.blockers.map((b) => b.message).join(" | "));
    await MasterDataMergeService.merge("color", { survivorId: colA.id, sourceIds: [colB.id], reason: "test birleştirme — aynı renk iki kez", acknowledgedConflicts: pv.conflicts.length });
    const merged = await prisma.duplicateReview.findUnique({ where: { entity_pairKey: { entity: "COLOR", pairKey: pk(colA.id, colB.id) } }, select: { decision: true, note: true } });
    check("MERGED izi yazıldı (gerekçeyle)", merged?.decision === DuplicateReviewDecision.MERGED && Boolean(merged?.note));
    const scanR2 = await DuplicateDetectionService.scan("color");
    check("tombstone taramadan düştü", !scanR2.groups.flatMap((g) => g.pairs).some((p) => p.pairKey === pk(colA.id, colB.id)));
    let reopenBad = false;
    const mergedRow = await prisma.duplicateReview.findUniqueOrThrow({ where: { entity_pairKey: { entity: "COLOR", pairKey: pk(colA.id, colB.id) } }, select: { id: true } });
    try { await DuplicateReviewService.reopen(mergedRow.id); } catch { reopenBad = true; }
    check("MERGED geri açılamaz (409)", reopenBad);
  }

  // ── §6 CSV ────────────────────────────────────────────────────────────────
  console.log("\n── §6 CSV ──");
  const csv = DuplicateDetectionService.toCsv(await DuplicateDetectionService.scan("customer"));
  check("BOM + başlık", csv.startsWith("﻿grup;kural;skor;"));
  check("A–B satırı var, noktalı virgül ayraç", csv.split("\r\n").some((l) => l.includes(custA.id) && l.includes(custB.id) && l.split(";").length >= 15));

  // ── §7 YER TUTUCU KİMLİK BASTIRMA ─────────────────────────────────────────
  // Ölçülen arıza (2026-09-01, canlı demo): 12 müşteri aynı santral numarasını
  // (`0212 000 00 00`) taşıyordu ve kimlik kuralı BİRBİRİYLE ALAKASIZ 12 firmayı
  // tek mükerrer grubu yapıyordu. Kimlik varsayımı ("aynı değer = aynı tüzel
  // kişi") ancak değer AZ kayıtta geçerken geçerlidir.
  console.log("\n── §7 Yer tutucu kimlik bastırma ──");
  const YER_TUTUCU = "0212 000 00 00";
  const yerTutucular: string[] = [];
  // Eşiği (4) AŞACAK kadar: 6 alakasız firma, hepsi aynı telefonda.
  for (let i = 0; i < 6; i++) {
    const c = await prisma.customer.create({
      data: { code: `${TAG}-YT${i}`, name: `${TAG} Bağımsız Firma ${i} ${["Akdeniz", "Konya", "İzmir", "Trakya", "Bursa", "Ankara"][i]}`, contactPhone: YER_TUTUCU },
      select: { id: true },
    });
    yerTutucular.push(c.id);
    created.customers.push(c.id);
  }
  const s7 = await DuplicateDetectionService.scan("customer");
  const ytKume = new Set(yerTutucular);
  const ytCifti = s7.groups.some((g) =>
    g.pairs.some((p) => ytKume.has(p.aId) && ytKume.has(p.bId)),
  );
  check("§7a alakasız firmalar aynı telefonla EŞLEŞMEDİ", !ytCifti);
  const bastirilan = s7.suppressedIdentities.find((x) => x.field === "contactPhone" && x.recordCount >= 6);
  check("§7b bastırma RAPORLANDI (sessiz değil)", Boolean(bastirilan), `${bastirilan?.recordCount ?? 0} kayıt`);

  // ⚠️ NEGATİF TARAF: bastırma "kimlik kuralını kapat" DEĞİLDİR. Eşiğin
  // ALTINDAKİ paylaşım (2 kayıt, aynı VKN) hâlâ eşleşmeli — yoksa düzeltme
  // gerçek mükerrerleri de yutmuş olur.
  const s7b = s7.groups.some((g) => g.pairs.some((p) =>
    (p.aId === custA.id && p.bId === custB.id) || (p.aId === custB.id && p.bId === custA.id)));
  check("§7c az-sayıda paylaşılan VKN hâlâ eşleşiyor", s7b);

  // Körlük zemini: tarama gerçekten kayıt gördü mü (boş taramada §7a vakumen yeşil).
  check("§7d körlük zemini — tarama kayıt gördü", s7.totals.records >= 6, `${s7.totals.records} kayıt`);

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

main()
  .catch((e) => { fail++; console.error("HATA:", e); })
  .finally(async () => {
    try {
      await prisma.duplicateReview.deleteMany({ where: { OR: [{ aId: { in: [...created.customers, ...created.colors, ...created.items] } }, { bId: { in: [...created.customers, ...created.colors, ...created.items] } }] } });
      await prisma.color.updateMany({ where: { id: { in: created.colors } }, data: { mergedIntoId: null } });
      await prisma.color.deleteMany({ where: { id: { in: created.colors } } });
      await prisma.item.deleteMany({ where: { id: { in: created.items } } });
      await prisma.customer.deleteMany({ where: { id: { in: created.customers } } });
      await prisma.systemSetting.deleteMany({ where: { key: { in: settingKeys } } });
      for (const s of settingsBackup) {
        await prisma.systemSetting.create({ data: { key: s.key, value: s.value as Prisma.InputJsonValue, description: "restore" } });
      }
    } catch (e) {
      console.error("cleanup hatası:", e);
    }
    if (fail > 0) console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
