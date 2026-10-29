// =============================================================================
// TEST (gelen belge H9 / OCR F1.2): işlem metni → kurşun gramaj çeşidi ÖNERİSİ
// =============================================================================
//   §1 saf kalıp: 27 işlem metni (13'ü belirsiz liste/çarpan + serbest irsaliye biçimi); önceki 14 gerçekçi işlem metni (motor fikstürleri 0245 "KDK APRE"/"YUMUŞAK APRE" + tasarım §3 "25 GR")
//      → yanlış öneri 0 (ya doğru ya boş); aralık / iki gramaj / birimsiz sayı / pasif çeşit → boş
//   §2 birden çok aday → boş (aynı gramaja iki aktif çeşit uyuyorsa öneri YOK)
//   §3 DB: /eslestirme yanıtında başlık + satır `process` önerisi (PATTERN); satırda metin yoksa başlığınki
//   §4 onay: kabul edilen/düzeltilen öneri PROCESS sözlüğüne yazılır (hitCount 1 → 2); sözlük kalıptan ÖNCE gelir;
//      geçersiz değer 400 PROCESS_VALUE_INVALID ve top doğmaz; öneri hiçbir topa/İE'ye değer YAZMAZ
//   §5 D4-D1 bayt-aynılık: yalnız-kurşun katalogda suggestProcess / suggestForNote yanıtı H9 biçimiyle bayt-aynı
//      (variants / processGroups anahtarı YOK)
//   §6 D4-D1 brode deseni (kurşun dışı CHOICE çeşidi): saf sözcük kalıbı; özellik gruplu yanıt; iki değerde
//      birleşmeyen metin → öneri yok; gönderene özel PROCESS sözlüğü kalıptan ÖNCE (başka gönderende kalıp)
// Negatif sonda: gramaj-oneri.ts'te `hits.length === 1 ?` → `hits.length >= 1 ?` yapılınca §2 kırmızı;
// BARE_NUMBER_RE satırı kaldırılınca §1 belirsiz biçimler kırmızı. D4-D1: suggestProcess'te çeşit grubunda kalıp
// sözlükten önce denenince (alias önceliği ters) §6 ⭐ ALIAS maddeleri kırmızı; `matchChoiceOption`ta `hits.length === 1`
// → `>= 1` yapılınca §6 "iki değer" maddeleri kırmızı.
// Çalıştır: npx tsx scripts/test_gelen_belge_gramaj_oneri.ts
// =============================================================================
import prisma from "../src/lib/prisma";
import { AppError } from "../src/utils/app-error";
import { extractGramValues, matchChoiceOption, matchGramajOption, type GramajOption } from "../src/lib/gelen-belge/gramaj-oneri";
import { loadProcessChoiceGroups } from "../src/services/helpers/process-choice-catalog.helper";
import { suggestForNote, suggestProcess } from "../src/services/gelen-belge-eslestirme.service";
import { createDeliveryNote } from "../src/services/gelen-belge-note.service";
import { approveDeliveryNote } from "../src/services/gelen-belge-onay.service";
import { loadKursunGramajOptions } from "../src/services/helpers/kursun-bypass-gramaj.helper";
import { KURSUN_PROPERTY_CODE } from "../src/services/helpers/quality-station.helper";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { stopNotificationJobs } from "../src/jobs/notification-dispatch.job";
import { testActorId } from "./fixture-test-user";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

const engel = hedefDbEngeli();
if (engel) {
  console.error(`⛔ DURDURULDU — ${engel}`);
  process.exitCode = 1;
}

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`  ✅ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}

// Sabit harf sonu: base36 "…5G" ile biterse başlıktaki TAG ikinci bir gramaj ("5g") gibi okunurdu (flaky).
const TAG = `TST-GO${Date.now().toString(36).toUpperCase()}Z`;
const SETTINGS = [SETTING_KEYS.EMANET_ENABLED, SETTING_KEYS.GELEN_BELGE_ENABLED, SETTING_KEYS.GELEN_BELGE_DEFAULT_ITEM_ID, SETTING_KEYS.GELEN_BELGE_UNREVIEWED_APPROVAL];
const made = { notes: [] as string[], items: [] as string[], customers: [] as string[], props: [] as string[], flags: [] as string[], kursunCreated: null as string | null };

// Kurşun çeşit kataloğu (aktif) — "75 gr" pasif olduğu için seçici kaynağında YOK.
const OPTIONS: GramajOption[] = [
  { id: "v25", name: "25 gr" },
  { id: "v50", name: "50 GR" },
  { id: "v100", name: "100gr" },
  { id: "v125", name: "12,5 gr" },
];
// 27 işlem metni: beklenen çeşit ya da null (emin değil → boş). Gerçek firma adı YOK.
const CASES: Array<[string, string | null]> = [
  ["KDK APRE", null], // 0245 blok 1
  ["YUMUŞAK APRE", null], // 0245 blok 2
  ["KURŞUN 25 GR", "v25"], // tasarım §3 madde 2
  ["25GR KURŞUN", "v25"],
  ["kurşun 50 gr/m", "v50"],
  ["KURŞUNLU 100 GR/MT APRE", "v100"],
  ["ŞARDON + KURŞUN 50GR", "v50"],
  ["Kurşun 12,5 gr", "v125"],
  ["25-30 GR KURŞUN", null], // aralık
  ["KURŞUN 25 GR + 50 GR", null], // iki gramaj
  ["30/1 SÜPREM KURŞUN", null], // birimsiz sayı (iplik numarası)
  ["KURŞUN 75 GR", null], // pasif çeşit — katalogda yok
  ["KURŞUN 40", null], // birimsiz
  ["BRODE 2 KG", null], // kg gramaj değil
  // Belirsiz liste/çarpan biçimleri (H9 inceleme): gramaj dışı çıplak sayı → boş.
  ["25 VE 50 GR", null],
  ["25 VEYA 50 GR", null],
  ["25, 50 GR", null],
  ["25 ile 50 gr", null],
  ["25X50 GR", null],
  ["2x50 GR", null],
  ["KURŞUN 50 GR 2 KAT", null],
  ["1/2 50 GR", null],
  // Fabrika irsaliyesine benzer serbest metinler.
  ["30/1 PENYE SÜPREM KURŞUN 25 GR", null], // iplik numarası çıplak sayı
  ["KURŞUN 25 GR 180 CM EN", null], // en ölçüsü çıplak sayı
  ["KURŞUN 25 GR - 3 TOP", null],
  ["TEK YÜZ KURŞUN 25GR/M2", "v25"], // "m2" birim ekidir, çıplak sayı değil
  ["KURŞUN APRE (50 GR)", "v50"],
];

function section1(): void {
  console.log("§1 Saf kalıp — yanlış öneri 0");
  let wrong = 0, right = 0, empty = 0;
  for (const [text, expected] of CASES) {
    const got = matchGramajOption(text, OPTIONS)?.id ?? null;
    if (got === expected) { if (got) right++; else empty++; }
    else if (got !== null) wrong++;
    check(`§1 "${text}" → ${expected ?? "boş"}`, got === expected, String(got));
  }
  check("§1 ⭐ YANLIŞ öneri 0 (ya doğru ya boş)", wrong === 0, `doğru ${right} · boş ${empty} · yanlış ${wrong}`);
  check("§1 Türkçe harf katlaması: 'KURŞUN 25 GR' ≡ 'kursun 25 gr'", extractGramValues("KURŞUN 25 GR")[0] === 25 && extractGramValues("kursun 25 gr")[0] === 25);
}

function section2(): void {
  console.log("§2 Birden çok aday → boş");
  const dup: GramajOption[] = [...OPTIONS, { id: "v50b", name: "50 gr özel" }];
  check("§2 ⭐ 50 gr'a iki aktif çeşit uyuyor → öneri BOŞ", matchGramajOption("KURŞUN 50 GR", dup) === null, String(matchGramajOption("KURŞUN 50 GR", dup)?.id));
  check("§2 tek adaylı 25 gr aynı katalogda yine önerilir", matchGramajOption("KURŞUN 25 GR", dup)?.id === "v25");
}

async function expect400(fn: () => Promise<unknown>, code: string): Promise<boolean> {
  try { await fn(); return false; } catch (e) { return e instanceof AppError && (e.details as { code?: string } | undefined)?.code === code; }
}

async function sections3and4(): Promise<void> {
  console.log("§3 Eşleme yanıtı — başlık + satır önerisi");
  const actor = await testActorId();
  const kursun = await prisma.fabricProperty.findUnique({ where: { code: KURSUN_PROPERTY_CODE }, select: { id: true } });
  const kursunId = kursun?.id ?? (await prisma.fabricProperty.create({ data: { code: KURSUN_PROPERTY_CODE, name: `TEST Kurşunlu ${TAG}`, valueType: "FLAG" }, select: { id: true } })).id;
  if (!kursun) made.kursunCreated = kursunId;
  // Ortamdan bağımsızlık: seçilen gramajlar (37/63) başka aktif çeşitte yoksa kalıp tek adaylıdır.
  const env = await loadKursunGramajOptions();
  check("§3 zemin: ortamda başka 37/63 gr çeşidi yok", !env.some((o) => /\b(37|63) ?gr\b/i.test(o.name)), env.map((o) => o.name).join(","));
  const gramaj = await prisma.fabricProperty.create({
    data: { code: `${TAG}-GR`.slice(0, 32), name: `TEST gramaj ${TAG}`, valueType: "CHOICE", variantOfPropertyId: kursunId, values: { create: [{ code: `${TAG}37`, name: "37 gr", sortOrder: 1 }, { code: `${TAG}63`, name: "63 gr", sortOrder: 2 }] } },
    select: { id: true, values: { select: { id: true, name: true } } },
  });
  made.props.push(gramaj.id);
  const v37 = gramaj.values.find((v) => v.name === "37 gr")!.id;
  const v63 = gramaj.values.find((v) => v.name === "63 gr")!.id;

  const owner = await prisma.customer.create({ data: { code: `${TAG}-OWN`, name: `${TAG} sahip` }, select: { id: true } });
  made.customers.push(owner.id);
  const fabric = await prisma.item.create({ data: { code: `${TAG}-KUM`, name: `${TAG} süprem`, itemType: "FABRIC", unit: "MT" }, select: { id: true } });
  made.items.push(fabric.id);
  for (const [k, v] of [[SETTING_KEYS.EMANET_ENABLED, true], [SETTING_KEYS.GELEN_BELGE_ENABLED, true]] as const) {
    await prisma.systemSetting.upsert({ where: { key: k }, create: { key: k, value: v }, update: { value: v } });
  }
  await prisma.systemSetting.deleteMany({ where: { key: { in: [SETTING_KEYS.GELEN_BELGE_DEFAULT_ITEM_ID, SETTING_KEYS.GELEN_BELGE_UNREVIEWED_APPROVAL] } } });

  const HEADER = `KURŞUN 37 GR ${TAG}`;
  const LINE = `ÖZEL İŞLEM ${TAG}`;
  const mkNote = async () => {
    const n = await createDeliveryNote({
      sourceKind: "MANUAL", ownerCustomerId: owner.id, senderText: `${TAG} GÖNDEREN`, processText: HEADER,
      lines: [
        { senderRollNo: `${TAG}-1`, meters: 100, itemId: fabric.id },
        { senderRollNo: `${TAG}-2`, meters: 80, itemId: fabric.id, processText: LINE },
      ],
    }, actor);
    made.notes.push(n.id);
    const lines = await prisma.customerDeliveryNoteLine.findMany({ where: { noteId: n.id }, orderBy: { lineNo: "asc" }, select: { id: true } });
    return { id: n.id, plainLine: lines[0]!.id, textLine: lines[1]!.id };
  };
  const n1 = await mkNote();
  const s1 = await suggestForNote(n1.id);
  check("§3 ⭐ başlık '…37 GR…' → 37 gr (PATTERN)", s1.process.suggested?.id === v37 && s1.process.source === "PATTERN", JSON.stringify(s1.process));
  check("§3 metinsiz satır başlığın önerisini taşır", s1.lines[0]?.process.suggested?.id === v37);
  check("§3 ⭐ processOptions: aktif gramaj çeşitleri yanıtta (panel property:read'siz okur)", s1.processOptions.some((o) => o.id === v37) && s1.processOptions.some((o) => o.id === v63), String(s1.processOptions.length));
  console.log("§5 Yalnız-kurşun katalog — H9 yanıtı bayt-aynı (D4-D1)");
  check("§5 zemin: kurşun dışı çeşit özelliği yok", (await loadProcessChoiceGroups()).length === 0);
  const H9_KEYS = ["noteId", "sender", "owner", "process", "processOptions", "lines", "defaultItem"];
  check("§5 ⭐ suggestForNote anahtarları H9 ile aynı (processGroups YOK)", JSON.stringify(Object.keys(s1)) === JSON.stringify(H9_KEYS), Object.keys(s1).join(","));
  check("§5 ⭐ başlık + satır process'te variants anahtarı YOK", [s1.process, ...s1.lines.map((l) => l.process)].every((p) => !("variants" in p)));
  let same = 0;
  for (const [text] of CASES) {
    const legacyHit = matchGramajOption(text, OPTIONS);
    const legacy = JSON.stringify(legacyHit ? { rawText: text, suggested: legacyHit, source: "PATTERN" } : { rawText: text, suggested: null, source: "NONE" });
    if (JSON.stringify(await suggestProcess(text, null, OPTIONS)) === legacy && JSON.stringify(await suggestProcess(text, null, OPTIONS, [])) === legacy) same++;
  }
  check("§5 ⭐ 27 işlem metninde suggestProcess yanıtı H9 biçimiyle bayt-aynı", same === CASES.length, `${same}/${CASES.length}`);
  check("§5 boş metin / boş katalog bayt-aynı", JSON.stringify(await suggestProcess("  ", null, OPTIONS)) === JSON.stringify({ rawText: null, suggested: null, source: "NONE" }) && JSON.stringify(await suggestProcess("X", null, [])) === JSON.stringify({ rawText: "X", suggested: null, source: "NONE" }));
  check("§3 gramajsız satır metni → boş (NONE)", s1.lines[1]?.process.suggested === null && s1.lines[1]?.process.source === "NONE", JSON.stringify(s1.lines[1]?.process));

  console.log("§4 Onay — PROCESS sözlüğü öğrenmesi");
  const rollsBefore = await prisma.customerDeliveryNoteLine.count({ where: { noteId: n1.id, rollId: { not: null } } });
  check("§4 geçersiz değer (çeşit değeri olmayan kimlik) → 400 PROCESS_VALUE_INVALID", await expect400(() => approveDeliveryNote(n1.id, { processChoices: [{ lineId: null, valueId: fabric.id }] }, actor), "PROCESS_VALUE_INVALID"));
  check("§4 başka belgenin satırı → 400 PROCESS_CHOICE_LINE_INVALID", await expect400(() => approveDeliveryNote(n1.id, { processChoices: [{ lineId: owner.id, valueId: v37 }] }, actor), "PROCESS_CHOICE_LINE_INVALID"));
  check("§4 aynı metne çelişkili iki seçim → 400 PROCESS_CHOICE_CONFLICT", await expect400(() => approveDeliveryNote(n1.id, { processChoices: [{ lineId: null, valueId: v37 }, { lineId: n1.plainLine, valueId: v63 }] }, actor), "PROCESS_CHOICE_CONFLICT"));
  check("§4 reddedilen onay top doğurmadı", rollsBefore === 0 && (await prisma.customerDeliveryNoteLine.count({ where: { noteId: n1.id, rollId: { not: null } } })) === 0);
  // Operatör: başlık önerisini kabul (37), satır metnine elle 63 seçti (düzeltme).
  const a1 = await approveDeliveryNote(n1.id, { processChoices: [{ lineId: null, valueId: v37 }, { lineId: n1.textLine, valueId: v63 }] }, actor);
  check("§4 onay iki top doğurdu", a1.summary.entered === 2, JSON.stringify(a1.summary));
  const aliasOf = (text: string) => prisma.deliveryNoteAlias.findMany({ where: { scope: "PROCESS", targetId: { in: [v37, v63] }, rawKey: { contains: TAG.toLowerCase() } }, select: { rawKey: true, targetId: true, hitCount: true } }).then((rows) => rows.filter((r) => r.rawKey.includes(text)));
  const lineAlias1 = await aliasOf("ozel islem");
  check("§4 ⭐ satır metni → 63 gr PROCESS sözlüğüne yazıldı, hitCount 1", lineAlias1.length === 1 && lineAlias1[0]!.targetId === v63 && lineAlias1[0]!.hitCount === 1, JSON.stringify(lineAlias1));
  const headAlias1 = await aliasOf("kursun 37 gr");
  check("§4 kabul edilen başlık önerisi de öğrenildi (37 gr)", headAlias1.length === 1 && headAlias1[0]!.targetId === v37, JSON.stringify(headAlias1));
  const props = await prisma.rollProperty.count({ where: { rollId: { in: a1.summary.rollIds }, propertyId: gramaj.id } });
  check("§4 öneri topa DEĞER YAZMAZ (RollProperty gramaj 0)", props === 0, String(props));

  const n2 = await mkNote();
  const s2 = await suggestForNote(n2.id);
  check("§4 ⭐ öğrenilmiş satır metni → 63 gr (ALIAS)", s2.lines[1]?.process.suggested?.id === v63 && s2.lines[1]?.process.source === "ALIAS", JSON.stringify(s2.lines[1]?.process));
  // Düzeltme: başlık metni kalıpla 37 derken operatör 63 seçer → sözlük kalıbı ezer.
  await approveDeliveryNote(n2.id, { processChoices: [{ lineId: null, valueId: v63 }, { lineId: n2.textLine, valueId: v63 }] }, actor);
  const lineAlias2 = await aliasOf("ozel islem");
  check("§4 ⭐ aynı metin ikinci onayda hitCount 2", lineAlias2.length === 1 && lineAlias2[0]!.hitCount === 2, JSON.stringify(lineAlias2));
  const s3 = await suggestProcess(HEADER, null, await loadKursunGramajOptions());
  check("§4 ⭐ sözlük kalıptan ÖNCE: '…37 GR…' düzeltildi → 63 gr (ALIAS)", s3.suggested?.id === v63 && s3.source === "ALIAS", JSON.stringify(s3));
}

const BRODE_OPTS = [
  { id: "d12", code: "D12", name: "Desen D12" },
  { id: "d1", code: "D1", name: "Desen D1" },
  { id: "lale", code: "LL-7", name: "Lale" },
];
// Brode deseni saf kalıbı: tam sözcük ("d1" ⊄ "d12"); iki değere uyan metin boş.
const BRODE_CASES: Array<[string, string | null]> = [
  ["BRODE DESEN D12", "d12"],
  ["brode d1 iç", "d1"],
  ["BRODE desen-d12 ÇİFT YÜZ", "d12"],
  ["BRODE LALE", "lale"],
  ["BRODE LL 7", "lale"], // kod ayraçtan bağımsız
  ["BRODE D12 + D1", null], // iki değer → birleşmiyor
  ["BRODE LALE D12", null], // iki değer
  ["BRODE D123", null], // alt-dize değil
  ["BRODE", null],
  ["KURŞUN 25 GR", null],
];

async function section6(): Promise<void> {
  console.log("§6 Brode deseni (kurşun dışı CHOICE çeşidi) — D4-D1");
  for (const [text, expected] of BRODE_CASES) {
    const got = matchChoiceOption(text, BRODE_OPTS)?.id ?? null;
    check(`§6 "${text}" → ${expected ?? "boş"}`, got === expected, String(got));
  }
  const actor = await testActorId();
  const flag = await prisma.fabricProperty.create({ data: { code: `${TAG}-BR`.slice(0, 32), name: `TEST Brode ${TAG}`, valueType: "FLAG" }, select: { id: true } });
  made.flags.push(flag.id);
  const desen = await prisma.fabricProperty.create({
    data: { code: `${TAG}-BD`.slice(0, 32), name: "Brode deseni", valueType: "CHOICE", variantOfPropertyId: flag.id, values: { create: [{ code: "D12", name: "Desen D12", sortOrder: 1 }, { code: "D15", name: "Desen D15", sortOrder: 2 }, { code: "D99", name: "Desen D99", sortOrder: 3, isActive: false }] } },
    select: { id: true, values: { select: { id: true, code: true } } },
  });
  made.props.push(desen.id);
  const d12 = desen.values.find((v) => v.code === "D12")!.id;
  const d15 = desen.values.find((v) => v.code === "D15")!.id;
  const groups = await loadProcessChoiceGroups();
  const g = groups.find((x) => x.propertyId === desen.id);
  check("§6 katalog: brode deseni grubu, pasif değer yok, kurşun grubu YOK", !!g && g.options.length === 2 && !g.options.some((o) => o.code === "D99") && groups.length === 1, JSON.stringify(groups.map((x) => x.propertyName)));

  const [senderA, senderB, owner] = await Promise.all(["SA", "SB", "OW"].map((k) => prisma.customer.create({ data: { code: `${TAG}-${k}`, name: `${TAG} ${k}` }, select: { id: true } })));
  made.customers.push(senderA!.id, senderB!.id, owner!.id);
  const fabric = await prisma.item.create({ data: { code: `${TAG}-BKUM`, name: `${TAG} brode kumaş`, itemType: "FABRIC", unit: "MT" }, select: { id: true } });
  made.items.push(fabric.id);
  const TEXT = `BRODE DESEN D12 ${TAG}`;
  const TWO = `BRODE D12 VE D15 ${TAG}`;
  const n = await createDeliveryNote({
    sourceKind: "MANUAL", ownerCustomerId: owner!.id, senderCustomerId: senderA!.id, senderText: `${TAG} A`, processText: TEXT,
    lines: [{ senderRollNo: `${TAG}-B1`, meters: 50, itemId: fabric.id }, { senderRollNo: `${TAG}-B2`, meters: 40, itemId: fabric.id, processText: TWO }],
  }, actor);
  made.notes.push(n.id);
  const s = await suggestForNote(n.id);
  const brodeOf = (p: { variants?: ReadonlyArray<{ propertyId: string; suggested: { id: string } | null; source: string }> } | undefined) => p?.variants?.find((v) => v.propertyId === desen.id);
  check("§6 ⭐ yanıt özellik gruplu: processGroups brode kataloğunu taşır", s.processGroups?.some((x) => x.propertyId === desen.id && x.options.length === 2) === true, JSON.stringify(s.processGroups?.map((x) => x.propertyName)));
  check("§6 ⭐ başlık 'BRODE DESEN D12' → D12 (PATTERN), kurşun grubu boş", brodeOf(s.process)?.suggested?.id === d12 && brodeOf(s.process)?.source === "PATTERN" && s.process.suggested === null, JSON.stringify(s.process));
  check("§6 metinsiz satır başlığın brode önerisini taşır", brodeOf(s.lines[0]?.process)?.suggested?.id === d12);
  check("§6 ⭐ iki değerde birleşmeyen metin ('D12 VE D15') → öneri YOK (NONE)", brodeOf(s.lines[1]?.process)?.suggested === null && brodeOf(s.lines[1]?.process)?.source === "NONE", JSON.stringify(s.lines[1]?.process));

  // Operatör başlıkta kalıbın D12'sini D15'e düzeltir → gönderen A'ya özel PROCESS sözlüğü.
  await approveDeliveryNote(n.id, { processChoices: [{ lineId: null, valueId: d15 }] }, actor);
  const alias = await prisma.deliveryNoteAlias.findMany({ where: { scope: "PROCESS", targetId: d15 }, select: { senderCustomerId: true } });
  check("§6 onay brode seçimini gönderen A'ya özel öğrendi", alias.length === 1 && alias[0]!.senderCustomerId === senderA!.id, JSON.stringify(alias));
  const kursunOpts = await loadKursunGramajOptions();
  const fresh = await loadProcessChoiceGroups();
  const a = await suggestProcess(TEXT, senderA!.id, kursunOpts, fresh);
  check("§6 ⭐ gönderen A: sözlük kalıptan ÖNCE → D15 (ALIAS)", brodeOf(a)?.suggested?.id === d15 && brodeOf(a)?.source === "ALIAS", JSON.stringify(a));
  check("§6 sözlük hedefi brode değeri: kurşun grubu kalıba düşer (boş)", a.suggested === null && a.source === "NONE");
  const b = await suggestProcess(TEXT, senderB!.id, kursunOpts, fresh);
  check("§6 ⭐ gönderen B (sözlüğü yok): kalıp → D12 (PATTERN)", brodeOf(b)?.suggested?.id === d12 && brodeOf(b)?.source === "PATTERN", JSON.stringify(b));
  // Pasif değere giden sözlük yok sayılır (kalıba düşer).
  await prisma.fabricPropertyValue.update({ where: { id: d15 }, data: { isActive: false } });
  const c = await suggestProcess(TEXT, senderA!.id, kursunOpts, await loadProcessChoiceGroups());
  check("§6 sözlük hedefi pasifse kalıba düşer → D12 (PATTERN)", brodeOf(c)?.suggested?.id === d12 && brodeOf(c)?.source === "PATTERN", JSON.stringify(c));
  check("§6 pasif değer onayda öğretilemez → 400 PROCESS_VALUE_INVALID", await expect400(async () => {
    const n2 = await createDeliveryNote({ sourceKind: "MANUAL", ownerCustomerId: owner!.id, senderCustomerId: senderA!.id, senderText: `${TAG} A`, processText: TEXT, lines: [{ senderRollNo: `${TAG}-B3`, meters: 10, itemId: fabric.id }] }, actor);
    made.notes.push(n2.id);
    return approveDeliveryNote(n2.id, { processChoices: [{ lineId: null, valueId: d15 }] }, actor);
  }, "PROCESS_VALUE_INVALID"));
}

async function cleanup(): Promise<void> {
  const rollIds = (await prisma.customerDeliveryNoteLine.findMany({ where: { noteId: { in: made.notes }, rollId: { not: null } }, select: { rollId: true } })).map((r) => r.rollId!);
  await prisma.customerDeliveryNote.deleteMany({ where: { id: { in: made.notes } } });
  await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } });
  await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
  await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
  await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds } } });
  await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
  const valueIds = (await prisma.fabricPropertyValue.findMany({ where: { propertyId: { in: made.props } }, select: { id: true } })).map((v) => v.id);
  await prisma.deliveryNoteAlias.deleteMany({ where: { targetId: { in: [...made.items, ...made.customers, ...valueIds] } } });
  await prisma.fabricPropertyValue.deleteMany({ where: { propertyId: { in: made.props } } });
  await prisma.fabricProperty.deleteMany({ where: { id: { in: made.props } } });
  await prisma.fabricProperty.deleteMany({ where: { id: { in: made.flags } } });
  if (made.kursunCreated) await prisma.fabricProperty.deleteMany({ where: { id: made.kursunCreated } });
  await prisma.item.deleteMany({ where: { id: { in: made.items } } });
  await prisma.customer.deleteMany({ where: { id: { in: made.customers } } });
}

async function run(): Promise<void> {
  const prior = await prisma.systemSetting.findMany({ where: { key: { in: SETTINGS } }, select: { key: true, value: true } });
  try {
    section1();
    section2();
    await sections3and4();
    await section6();
  } catch (e) {
    fail++;
    console.error("HATA:", e);
  } finally {
    stopNotificationJobs();
    for (const k of SETTINGS) {
      const p = prior.find((x) => x.key === k);
      if (p) await prisma.systemSetting.update({ where: { key: k }, data: { value: p.value as never } });
      else await prisma.systemSetting.deleteMany({ where: { key: k } });
    }
    await cleanup().catch((e) => check("temizlik", false, (e as Error).message.replace(/\s+/g, " ").slice(0, 300)));
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız === (test verisi temizlendi)`);
    await prisma.$disconnect();
    process.exitCode = fail > 0 ? 1 : 0;
  }
}

if (!engel) void run();
else void prisma.$disconnect();
