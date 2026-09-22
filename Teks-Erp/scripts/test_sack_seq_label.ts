// =============================================================================
// Bekçi: SEVKİYAT İÇİ ÇUVAL SIRASI ETİKETİ (2026-09-22) — DB'siz
//   §1 `formatSackSeqLabel`: serbest ön ek (≤8, temizlenir) · "n/N" · seq null → boş
//   §2 Belge: "SIRA" kolonu YALNIZ `meta.sackSeq` verilince (kapalı = bugünkü çıktı) —
//      hem çuval hem çeki listesinde; "n/N" canlı, ÖN EK sevk anında donar (`sackSeqPrefixLive`
//      açıksa canlı) — eski belgeler ön ek değişince değişmez
//   §3 Sıra başlangıcı sevk kurulumunda ve sevkiyata çuval eklemede aynı okuyucudan
//   §4 Partisiz ambalaj no: yalnız `acilista` + carili çuvalda; kilit 8035 envanterde
// ⭐ Negatif sonda (2026-09-22): html'de `meta.sackSeq ?` dalı `true ?` yapılınca §2 ❌;
//    `nextPoolPackageNoTx`'ten `!== "acilista"` kapısı silinince §4 ❌ (kaynak metni).
// Çalıştır: npx tsx scripts/test_sack_seq_label.ts
// =============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { formatSackSeqLabel, POOL_PACKAGE_NO_LOCK_NS } from "../src/services/helpers/sack-seq.helper";
import {
  sanitizeSackSeqPrefix,
  SHIPPING_SACK_SEQ_PREFIX_RE,
  SHIPPING_SACK_SEQ_PREFIX_WRITE_RE,
} from "../src/services/system-setting.service";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}
const SRC = join(__dirname, "../src");

const ship = readFileSync(join(SRC, "services/shipping.service.ts"), "utf-8");
const helper = readFileSync(join(SRC, "services/helpers/sack-seq.helper.ts"), "utf-8");

// §1
check("§1 ön ek boş → yalnız sayı", formatSackSeqLabel(3, 100, { prefix: "", showTotal: false }) === "3");
check("§1 SP → SP3", formatSackSeqLabel(3, 100, { prefix: "SP", showTotal: false }) === "SP3");
check("§1 P- → P-3/100 (toplamla)", formatSackSeqLabel(3, 100, { prefix: "P-", showTotal: true }) === "P-3/100");
check("§1 serbest metin 'Çuval ' → 'Çuval 3' (boşluk korunur)", formatSackSeqLabel(3, 100, { prefix: "Çuval ", showTotal: false }) === "Çuval 3");
check("§1 seq null (havuz) → boş", formatSackSeqLabel(null, 5, { prefix: "SP", showTotal: true }) === "");
check("§1 toplam 0 ise '/0' basılmaz", formatSackSeqLabel(1, 0, { prefix: "", showTotal: true }) === "1");
check("§1 ⭐ ön ek temizliği: 9+ karakter / yasak karakter / yalnız boşluk → boş (sayı yine basılır)",
  sanitizeSackSeqPrefix("ABCDEFGHI") === "" && sanitizeSackSeqPrefix("<b>") === "" && sanitizeSackSeqPrefix("   ") === "" && sanitizeSackSeqPrefix("P-") === "P-");
check("§1 ön ek HTML kaçışından geçer (html `esc(formatSackSeqLabel`)", /esc\(formatSackSeqLabel\(/.test(readFileSync(join(SRC, "services/document-render/shipment-dispatch.html.ts"), "utf-8")));

// §2
const html = readFileSync(join(SRC, "services/document-render/shipment-dispatch.html.ts"), "utf-8");
const siraKolon = html.match(/meta\.sackSeq\s*\?\s*\[\{ key: "seq"/g) ?? [];
check("§2 ⭐ 'SIRA' kolonu iki tabloda da yalnız meta.sackSeq ile", siraKolon.length === 2, `${siraKolon.length} yer`);
check("§2 etiket helper'dan (kopya biçim yok)", (html.match(/formatSackSeqLabel\(/g) ?? []).length === 2 && !/\$\{[^}]*seq\}\/\$\{/.test(html));
const printed = readFileSync(join(SRC, "services/printed-document.service.ts"), "utf-8");
check("§2 meta.sackSeq yalnız `readShippingSackSeqOnDoc()` açıkken", /\(await readShippingSackSeqOnDoc\(\)\)\s*\? \{ sackSeq: await readSackSeqFormat\(/.test(printed));
// §2b ÖN EK DONAR: sevk anındaki ön ek snapshot'a yazılır; baskıda `sackSeqPrefixLive` kapalıyken o okunur.
check("§2b ⭐ ön ek sevkiyat KURULURKEN `Shipment.sackSeqPrefix`e donar", /sackSeqPrefix: await readShippingSackSeqPrefix\(tx\),/.test(ship));
check("§2b belge snapshot'ı ön eki SEVKİYATTAN okur (ekran ile tek kaynak)", /sackSeqPrefix: sh\.sackSeqPrefix \?\? "",/.test(ship));
check("§2b ekran projeksiyonları `seqLabel` üretir (detay + çuval dökümü, aynı helper)", (ship.match(/seqLabel: seqLabelOf\(sk\.seq\)/g) ?? []).length === 2 && (ship.match(/readSackSeqFormat\((shipment|sh)\.sackSeqPrefix\)/g) ?? []).length === 2);
check("§2b ⭐ baskı ön eki: live ? bugünkü ayar : snapshot (eski belge değişmez)",
  /prefix: live \? await readShippingSackSeqPrefix\(tx\) : sanitizeSackSeqPrefix\(frozenPrefix \?\? ""\)/.test(helper));
check("§2b printed-document snapshot ön ekini helper'a geçirir", /readSackSeqFormat\(\(snapshot\.doc as \{ sackSeqPrefix\?: string \} \| null\)\?\.sackSeqPrefix\)/.test(printed));

// §3
check("§3 sevk kurulumunda seq `seqStart + i`", /seq: seqStart \+ i,/.test(ship) && /const seqStart = await readSackSeqStart\(tx\);/.test(ship));
check("§3 sevkiyata çuval eklemede boş sevkiyat da başlangıçtan", /maxSeqRow\?\.seq != null \? maxSeqRow\.seq \+ 1 : await readSackSeqStart\(tx\)/.test(ship));

// §4
const fn = helper.slice(helper.indexOf("export async function nextPoolPackageNoTx"));
check("§4 müşterisiz çuval numara almaz", /if \(!customerId\) return null;/.test(fn));
check("§4 ⭐ rejim `acilista` değilse null (sevkte = bugünkü)", /!== "acilista"\) return null;/.test(fn));
check("§4 kilit sayaç okumasından ÖNCE", fn.indexOf("pg_advisory_xact_lock") < fn.indexOf("tx.sack.aggregate"));
check("§4 uzay 8035", POOL_PACKAGE_NO_LOCK_NS === 8035);
const envanter = readFileSync(join(SRC, "services/helpers/period-guard.helper.ts"), "utf-8");
check("§4 8035 envanterde", /\/\/\s+8035\s+POOL_PACKAGE_NO_LOCK_NS/.test(envanter));
check("§4 openSack partisiz dalda helper'ı çağırır", /packageNo = await nextPoolPackageNoTx\(tx, customerId\);/.test(ship));

// ── §5 ÖN EK DESENİ: yazma DAR, okuma GENİŞ (Faz C4) ──────────────────────
// ⚠️ İKİ YÜKLEM ve ayrımı LOAD-BEARING: `sanitizeSackSeqPrefix` OKUMA yolunda
// da koşuyor ve sevk anında DONMUŞ ön eki de süzüyor. Okuma yüklemini
// daraltmak, `SP/` gibi bir ön ekle sevk edilmiş ESKİ sevkiyatların belgesini
// bugün boş gösterirdi — geçmişi geriye dönük değiştirmek, bu işin yasağı.
check("§5 \u2b50 YAZMA yüklemi eğik çizgiyi REDDEDER (dosya adını kırar)",
  !SHIPPING_SACK_SEQ_PREFIX_WRITE_RE.test("SP/"));
check("§5 \u2b50 OKUMA yüklemi eski değeri HÂLÂ kabul eder (geçmiş bozulmaz)",
  SHIPPING_SACK_SEQ_PREFIX_RE.test("SP/") && sanitizeSackSeqPrefix("SP/") === "SP/");
check("§5 Türkçe harf yazmada da KALIR (ön ek okutulmaz, barkod uzayı değil)",
  SHIPPING_SACK_SEQ_PREFIX_WRITE_RE.test("ÇUVAL") && SHIPPING_SACK_SEQ_PREFIX_WRITE_RE.test("Şİ-"));
check("§5 meşru ön ekler yazmada kabul edilir (kapı her şeyi reddetmiyor)",
  ["SP", "SP-", "S.P", "SP 1", "A_B", ""].every((v) => SHIPPING_SACK_SEQ_PREFIX_WRITE_RE.test(v)));
// \u26a0\ufe0f ÖLÇÜLDÜ: yasaklanması istenen küme `/ \\ : * ? [ ]` idi ama geniş
// yüklemde YALNIZ `/` vardı; kalan altısı zaten dışarıdaydı. Sayı beyan edilir
// ki sonraki okuyan "altı karakter kaldırıldı" sanmasın.
const ZATEN_YOKTU = ["\\", ":", "*", "?", "[", "]"];
check("§5 kalan altı karakter ZATEN kabul edilmiyordu (maruziyet tek karakterdi)",
  ZATEN_YOKTU.every((c) => !SHIPPING_SACK_SEQ_PREFIX_RE.test(`SP${c}`)),
  ZATEN_YOKTU.join(" "));

console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
