// =============================================================================
// Test: e-İrsaliye UBL-TR DespatchAdvice XML üretimi + yapısal doğrulama (E4-XML)
// Çalıştır: npx tsx scripts/test_e_irsaliye_xml.ts   (DB gerekmez — saf modül)
// Altın örnekleri yeniden yaz: npx tsx scripts/test_e_irsaliye_xml.ts --altin-yaz
//   (yalnız bilinçli eşleme değişikliğinde; fark PR'da gözle incelenir)
//
// Bölümler: §1 altın örnekler bayt-eşit · §2 determinizm · §3 kaçış/kontrol karakteri ·
// §4 girdi doğrulayıcı hataları · §5 XML doğrulayıcı · §6 VKN/TCKN · §7 kaynak eşleme ·
// §8 tek kaynak sürüklenme bekçisi.
// XSD doğrulaması YOK (plan §7 V3 kullanıcı kararı) — bu bekçi XSD'nin yerini tutmaz.
//
// NEGATİF SONDA (2026-10-24, E4-XML commit'i; her biri geri alındı, md5 eşit):
//   ① `escapeXml` kaçışsız (`return value`) → §1 cok-satirli-ozel-karakter (iyi biçim + bayt) ve
//      vkn-alici (apostrof) ❌ · §3a–§3e ❌ · §5 (kaynak XML iyi biçimli değil) ❌ — 14 ❌
//   ② builder `LineCountNumeric` sabit "1" → §1 çok satırlı iki altın (vkn-alici, cok-satirli)
//      yapısal doğrulama + bayt ❌ (4 ❌; tek satırlı örnekler doğal olarak yeşil)
//   ③ `isValidVkn` sağlama satırı `return sum >= 0` → §4b, §4o, §6b ❌ (3 ❌)
// =============================================================================
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildDespatchAdvice } from "../src/services/e-irsaliye/despatch-advice.builder";
import {
  DISPATCH_QTY_DECIMALS,
  mapSnapshotToDespatchInput,
  normalizePlate,
} from "../src/services/e-irsaliye/despatch-advice.source";
import type { DespatchInput } from "../src/services/e-irsaliye/despatch-advice.types";
import { validateDespatchInput, validateDespatchXml } from "../src/services/e-irsaliye/despatch-advice.validate";
import { isValidTckn, isValidVkn } from "../src/services/e-irsaliye/tax-id";
import { escapeXml } from "../src/services/e-irsaliye/ubl-xml-writer";
import { parseXml, childrenNamed } from "../src/services/e-irsaliye/ubl-xml-reader";
import { DISPATCHED_AT, dispatchDoc, envelope, GOLDEN_CASES, NOW, SUPPLIER } from "./fixture-e-irsaliye";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}

const FIXTURE_DIR = join(__dirname, "fixtures", "e-irsaliye");
const SRC = join(__dirname, "..", "src");
const md5 = (s: string): string => createHash("md5").update(s).digest("hex");
const clone = <T>(v: T): T => structuredClone(v);
const fields = (input: DespatchInput): string[] => validateDespatchInput(input).errors.map((e) => e.field);
const base = (): DespatchInput => mapSnapshotToDespatchInput(GOLDEN_CASES[0]!.args);

// ── §1 altın örnekler ────────────────────────────────────────────────────────
if (process.argv.includes("--altin-yaz")) {
  for (const c of GOLDEN_CASES) {
    writeFileSync(join(FIXTURE_DIR, c.file), buildDespatchAdvice(mapSnapshotToDespatchInput(c.args)));
    console.log(`yazıldı: ${c.file}`);
  }
  process.exit(0);
}
console.log("\n§1 altın örnekler");
for (const c of GOLDEN_CASES) {
  const input = mapSnapshotToDespatchInput(c.args);
  const v = validateDespatchInput(input);
  check(`§1 ${c.file}: girdi doğrulamadan geçer`, v.ok, JSON.stringify(v.errors));
  const xml = buildDespatchAdvice(input);
  const vx = validateDespatchXml(xml);
  check(`§1 ${c.file}: XML yapısal doğrulamadan geçer`, vx.ok, JSON.stringify(vx.errors));
  const golden = readFileSync(join(FIXTURE_DIR, c.file), "utf8");
  check(`§1 ${c.file}: altın örnekle bayt-eşit`, xml === golden, xml === golden ? "" : `md5 ${md5(xml)} ≠ ${md5(golden)}`);
}

// ── §2 determinizm ───────────────────────────────────────────────────────────
console.log("\n§2 determinizm");
for (const c of GOLDEN_CASES) {
  const a = buildDespatchAdvice(mapSnapshotToDespatchInput(c.args));
  const b = buildDespatchAdvice(mapSnapshotToDespatchInput(clone(c.args)));
  check(`§2 ${c.file}: iki çağrı aynı bayt`, a === b);
}

// ── §3 kaçış ─────────────────────────────────────────────────────────────────
console.log("\n§3 kaçış");
{
  const special = GOLDEN_CASES[3]!;
  const xml = buildDespatchAdvice(mapSnapshotToDespatchInput(special.args));
  check("§3a ham '<Tekstil>' / '<TEST>' XML'e sızmaz", !xml.includes("<Tekstil>") && !xml.includes("<TEST>"));
  check("§3b '&' kaçışlı", xml.includes("R&amp;D KUMAŞ &lt;TEST&gt;") && !/&(?!amp;|lt;|gt;|quot;|apos;)/.test(xml));
  const first = buildDespatchAdvice(base());
  check("§3c tırnaklar kaçışlı", xml.includes("&quot;Örme&quot;") && xml.includes("&quot;dikkat&quot;") && first.includes("Rampa 2&apos;den"));
  let names: string[] = [];
  try {
    const root = parseXml(xml);
    names = childrenNamed(root, "cac:DespatchLine").map((l) => childrenNamed(childrenNamed(l, "cac:Item")[0]!, "cbc:Name")[0]!.text);
  } catch (e) {
    names = [`okunamadı: ${(e as Error).message}`];
  }
  check("§3d okuyucu geri çözünce adlar aynen döner (Türkçe harf dahil)", names[0] === "R&D KUMAŞ <TEST>" && names[1] === "ĞÜŞİÖÇ ğüşıöç", names[0]);
  check("§3e escapeXml beş varlık", escapeXml(`&<>"'`) === "&amp;&lt;&gt;&quot;&apos;");
  let threw = false;
  try {
    escapeXml("a" + String.fromCharCode(1) + "b");
  } catch {
    threw = true;
  }
  check("§3f kontrol karakteri yazıcıda reddedilir", threw);
  const bad = base();
  bad.lines[0]!.itemName = "KUMAŞ" + String.fromCharCode(7);
  check("§3g doğrulayıcı kontrol karakterini alanıyla söyler", fields(bad).includes("lines[0].itemName"));
  const lone = base();
  lone.notes = ["x" + String.fromCharCode(0xd800)];
  check("§3h eşsiz vekil (surrogate) reddedilir", fields(lone).includes("notes[0]"));
}

// ── §4 girdi doğrulayıcı ─────────────────────────────────────────────────────
console.log("\n§4 girdi doğrulayıcı");
{
  const msgOf = (input: DespatchInput, field: string): string =>
    validateDespatchInput(input).errors.find((e) => e.field === field)?.message ?? "";
  let i = base();
  i.customer.address.cityName = "";
  check("§4a eksik il → customer.address.cityName", fields(i).includes("customer.address.cityName"), msgOf(i, "customer.address.cityName"));
  i = base();
  i.customer.taxId = "5550001113";
  check("§4b bozuk VKN → customer.taxId", fields(i).includes("customer.taxId"), msgOf(i, "customer.taxId"));
  i = base();
  i.lines[0]!.meters = "0.00";
  check("§4c 0 metre → lines[0].meters", fields(i).includes("lines[0].meters"), msgOf(i, "lines[0].meters"));
  i = base();
  i.customer.address.citySubdivisionName = " ";
  check("§4d boş ilçe", fields(i).includes("customer.address.citySubdivisionName"));
  i = base();
  i.customer.taxId = "10000000146";
  i.customer.person = null;
  check("§4e TCKN'li alıcıda kişi adı zorunlu", fields(i).includes("customer.person.firstName") && fields(i).includes("customer.person.familyName"));
  i = base();
  i.customer.taxId = "123456789";
  check("§4f 9 haneli vergi no reddedilir", fields(i).includes("customer.taxId"));
  i = base();
  i.documentNo = "EI2026000000001";
  check("§4g bozuk belge no", fields(i).includes("documentNo"));
  i = base();
  i.documentNo = "EIR2025000000001";
  check("§4h numara yılı ≠ düzenleme yılı", fields(i).includes("documentNo"));
  i = base();
  i.ettn = "not-a-uuid";
  check("§4i bozuk ETTN", fields(i).includes("ettn"));
  i = base();
  i.lines = [];
  check("§4j satırsız irsaliye", fields(i).includes("lines"));
  i = base();
  i.transport.licensePlate = "16 ABC 123";
  check("§4k boşluklu plaka reddedilir (normalleştirme eşlemede)", fields(i).includes("transport.licensePlate"));
  i = base();
  i.transport = { drivers: [], licensePlate: null, carrier: null };
  check("§4l taşıma bilgisi yok", fields(i).includes("transport"));
  i = base();
  i.transport.drivers[0]!.nationalId = "10000000147";
  check("§4m bozuk şoför TCKN", fields(i).includes("transport.drivers[0].nationalId"));
  i = base();
  i.destination = "EXPORT";
  check("§4n yurt dışı sevkiyat v1'de reddedilir", fields(i).includes("destination"));
  i = base();
  i.supplier = { ...i.supplier, taxId: "4721003457" };
  check("§4o gönderici VKN sağlaması", fields(i).includes("supplier.taxId"));
  i = base();
  i.issueDate = "2026-02-30";
  check("§4p takvimde olmayan tarih", fields(i).includes("issueDate"));
  i = base();
  i.customer.name = "x".repeat(301);
  check("§4q uzunluk sınırı", fields(i).includes("customer.name"));
  const all = validateDespatchInput({ ...base(), lines: [], ettn: "" });
  check("§4r mesajlar Türkçe ve alan alan", all.errors.length >= 2 && all.errors.every((e) => e.field && /[a-zçğıöşü]/i.test(e.message)));
}

// ── §5 XML doğrulayıcı ───────────────────────────────────────────────────────
console.log("\n§5 XML doğrulayıcı");
{
  const multi = buildDespatchAdvice(mapSnapshotToDespatchInput(GOLDEN_CASES[3]!.args));
  const xf = (xml: string): string[] => validateDespatchXml(xml).errors.map((e) => e.field);
  check("§5a LineCountNumeric bozulunca yakalanır", xf(multi.replace("<cbc:LineCountNumeric>4<", "<cbc:LineCountNumeric>1<")).includes("cbc:LineCountNumeric"));
  check("§5b kökte ikinci cbc:ID", xf(multi.replace("<cbc:CopyIndicator>", "<cbc:ID>EIR2026000000009</cbc:ID><cbc:CopyIndicator>")).includes("cbc:ID"));
  check("§5c kökte ikinci cbc:UUID", xf(multi.replace("<cbc:IssueDate>", "<cbc:UUID>11111111-2222-4333-8444-555555555555</cbc:UUID><cbc:IssueDate>")).includes("cbc:UUID"));
  check("§5d kaçışsız '&' iyi biçimli değil", xf(multi.replace("R&amp;D", "R&D")).includes("xml"));
  check("§5e yanlış kök", xf(multi.replace(/DespatchAdvice(?= |>)/g, "Invoice")).includes("kök"));
  check("§5f izinsiz birim kodu", xf(multi.replace('unitCode="MTR"', 'unitCode="LTR"')).some((f) => f.endsWith("cbc:DeliveredQuantity")));
  const swapped = multi.replace(
    /(<cbc:IssueDate>[^<]*<\/cbc:IssueDate>)(<cbc:IssueTime>[^<]*<\/cbc:IssueTime>)/,
    "$2$1",
  );
  check("§5g öğe sırası bozulunca yakalanır", swapped !== multi && xf(swapped).some((f) => f.includes("cbc:IssueDate")));
  check("§5h kapanmamış belge", xf(multi.slice(0, -5)).includes("xml"));
}

// ── §6 VKN / TCKN ────────────────────────────────────────────────────────────
console.log("\n§6 VKN/TCKN");
{
  const goodVkn = ["3230512384", "9000068418", "4721003456", "5550001112", "9876543217"];
  check("§6a geçerli VKN'ler", goodVkn.every(isValidVkn));
  check("§6b son hanesi değişmiş VKN geçersiz", goodVkn.every((v) => !isValidVkn(v.slice(0, 9) + String((Number(v[9]) + 1) % 10))));
  check("§6c harfli/9 haneli VKN geçersiz", !isValidVkn("12345678A0") && !isValidVkn("123456789"));
  check("§6d geçerli TCKN", isValidTckn("10000000146") && isValidTckn("12345678950"));
  check("§6e bozuk TCKN (10. hane, 11. hane, 0 ile başlayan)", !isValidTckn("10000000156") && !isValidTckn("10000000147") && !isValidTckn("01234567890"));
}

// ── §7 kaynak eşleme ─────────────────────────────────────────────────────────
console.log("\n§7 kaynak eşleme");
{
  const product = { name: "LİNEN EKRU", customerName: "BS-6650", rollCount: 1, totalMeters: 1.005 };
  const args = (over: Partial<Parameters<typeof mapSnapshotToDespatchInput>[0]>) =>
    mapSnapshotToDespatchInput({ ...GOLDEN_CASES[0]!.args, ...over });
  const doc = dispatchDoc({ customerName: "X", taxNumber: null, products: [product], sackCount: 3, manualSackCount: null });
  const half = args({ snapshot: envelope(doc), nameMode: "bizdeki" });
  const legacy = args({ snapshot: envelope(doc, "LEGACY"), nameMode: "musterideki" });
  const both = args({ snapshot: envelope(doc), nameMode: "ikisi" });
  check("§7a damgalı belge ticari yuvarlama (1,005 → 1.01)", half.lines[0]!.meters === "1.01", half.lines[0]!.meters);
  check("§7b damgasız eski belge eski yuvarlama (1,005 → 1.00)", legacy.lines[0]!.meters === "1.00", legacy.lines[0]!.meters);
  check("§7c bizdeki → bizim ad", half.lines[0]!.itemName === "LİNEN EKRU" && half.lines[0]!.itemDescription === null);
  check("§7d musterideki → müşteri adı", legacy.lines[0]!.itemName === "BS-6650");
  check("§7e ikisi → müşteri adı + bizim ad açıklamada", both.lines[0]!.itemName === "BS-6650" && both.lines[0]!.itemDescription === "LİNEN EKRU");
  const noAlias = args({ snapshot: envelope(dispatchDoc({ customerName: "X", taxNumber: "5550001112", products: [{ ...product, customerName: null }] })), nameMode: "musterideki" });
  check("§7f karşılığı olmayan üründe bizim ada düşer (fail-open)", noAlias.lines[0]!.itemName === "LİNEN EKRU");
  check("§7g sevk anı fabrika diliminden (UTC 22:30 → 24.10 01:30:00)", half.shipment.actualDespatchDate === "2026-10-24" && half.shipment.actualDespatchTime === "01:30:00");
  check("§7h düzenleme anı fabrika diliminden", half.issueDate === "2026-10-24" && half.issueTime === "11:15:30");
  check("§7i snapshot'ta vergi no yoksa cari kartındaki", args({ snapshot: envelope(doc), recipient: { taxId: "5550001112", address: {} } }).customer.taxId === "5550001112");
  check("§7j çuval: beyan yoksa sistem sayımı; kg 0 → basılmaz", half.shipment.handlingUnitCount === 3 && half.shipment.grossWeightKg === null);
  const g0 = mapSnapshotToDespatchInput(GOLDEN_CASES[0]!.args);
  check("§7k fiziksel çuval beyanı önce gelir; kg docNum'dan", g0.shipment.handlingUnitCount === 6 && g0.shipment.grossWeightKg === "142.46");
  check("§7l plaka normalleşir", normalizePlate(" 16 abc 123 ") === "16ABC123" && g0.transport.licensePlate === "16ABC123");
  check("§7m alıcı ülkesi boşsa yurt içi = Türkiye; vergi dairesi cari kartından", g0.customer.address.countryName === "Türkiye" && g0.customer.taxOffice === "Pamukkale");
  check("§7n notlar: sevk notu + sipariş no + top özeti", JSON.stringify(g0.notes) === JSON.stringify(["Rampa 2'den yüklendi", "Sipariş No: SP-2026-0101, SP-2026-0102", "Toplam 5 top"]));
  check("§7o girdi saflığı: künye nesnesi değişmez", JSON.stringify(SUPPLIER).includes("Uludağ") && NOW.toISOString() === "2026-10-24T08:15:30.000Z" && DISPATCHED_AT.getTime() === Date.parse("2026-10-23T22:30:00Z"));
}

// ── §8 tek kaynak sürüklenme ─────────────────────────────────────────────────
console.log("\n§8 tek kaynak");
{
  const html = readFileSync(join(SRC, "services/document-render/shipment-dispatch.html.ts"), "utf8");
  const qty = /const QTY: DocCellKind = \{ t: "num", dec: (\d+) \}/.exec(html);
  check("§8a XML metre/kg hanesi irsaliyedeki QTY hanesiyle aynı", qty !== null && Number(qty[1]) === DISPATCH_QTY_DECIMALS, qty?.[1] ?? "QTY bulunamadı");
  const strip = (f: string): string => readFileSync(join(SRC, "services/e-irsaliye", f), "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const source = strip("despatch-advice.source.ts");
  check("§8b eşleme sayıyı docNum'dan, adı resolveDocNameMode + customerNameOr'dan alır", /docNum\(/.test(source) && /resolveDocNameMode\(/.test(source) && /customerNameOr\(/.test(source));
  check("§8c eşleme saat/tarihi fabrika dilimi helper'ından alır", /factoryYmd\(/.test(source) && /factoryTimeHms\(/.test(source) && !/getHours|toISOString|toLocale|AT TIME ZONE/.test(source));
  for (const f of ["despatch-advice.builder.ts", "ubl-xml-writer.ts", "despatch-advice.source.ts"]) {
    check(`§8d ${f}: toFixed/Intl/new Date yok`, !/toFixed\(|Intl\.|new Date\(/.test(strip(f)));
  }
}

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exitCode = fail > 0 ? 1 : 0;
