// =============================================================================
// Bekçi: BELGE BAŞLIĞI TÜRKÇE BÜYÜK HARFLE BASILIR — DB gerekmez
// Çalıştır: npx tsx scripts/test_belge_baslik_harf.ts
// =============================================================================
// Saha hatası (2026-09-26): belge çizicileri başlığı düz `toUpperCase()` ile basıyordu;
// Türkçede "i" → "I" oldu: "TAHSILAT MAKBUZU", "CARI MUTABAKAT MEKTUBU", "…TESLIM BORDROSU"
// ve şablonda küçük "i" ile yazılmış HER başlık ("Sevk fişi" → "SEVK FIŞI"). Kural: başlık
// tek helper'dan (`document-render/doc-style.ts` `docTitle`) basılır — Türkçe belgede
// `upperTr`, İngilizce belgede (dil kararı belgenin kendi dil alanından) düz büyük harf.
//
// §1 helper davranışı · §2 kaynak: çizicilerde çıplak `toUpperCase()` yok, her çizici
// `docTitle` çağırır · §3 kayıtlı HER belge tipinin örneği küçük harfli şablon başlığıyla
// Türkçe büyük harf basar · §4 varsayılan başlığı karışık harfli üç belge doğru basar ·
// §5 İngilizce sevk irsaliyesi İngilizce büyük harf basar.
// =============================================================================
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getRegisteredDocBuilders, type PrintedDocSnapshot } from "../src/services/printed-document.service";
import { docTitle } from "../src/services/document-render/doc-style";
import { SAMPLE_PRINTED_DOCS, setSampleClock } from "../src/services/document-render/sample-data";
// Builder kaydı import yan etkisiyle olur (test_printed_doc_builders ile aynı liste).
import "../src/services/shipping.service";
import "../src/services/subcontractor.service";
import "../src/services/kartela.service";
import "../src/services/return.service";
import "../src/services/warehouse-transfer.service";
import "../src/services/goods-receipt.service";
import "../src/services/invoice.service";
import "../src/services/payment.service";
import "../src/services/reconciliation-letter.service";
import "../src/services/cheque-delivery-note.service";
import "../src/services/stock-count.service";

setSampleClock(() => new Date("2026-09-26T08:30:00.000Z"));

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
}

const render = (docType: string, cfg: Record<string, unknown>): string => {
  const entry = getRegisteredDocBuilders().get(docType as never)!;
  const snapshot = {
    schemaVersion: 1,
    frozenAt: "2026-09-26T08:30:00.000Z",
    company: { name: "Deneme", letterhead: { addressLine: "", phone: "", taxInfo: "" }, logoHash: null },
    docConfigOverride: cfg,
    doc: (SAMPLE_PRINTED_DOCS as Record<string, unknown>)[docType],
  } as unknown as PrintedDocSnapshot;
  return entry.renderHtml!(snapshot, {} as never);
};
const baslikOf = (html: string) => /<div class="title">([^<]*)<\/div>/.exec(html)?.[1] ?? null;

console.log("§1 helper");
check("Türkçe: 'Teslim bordrosu' → 'TESLİM BORDROSU'", docTitle("Teslim bordrosu", "X") === "TESLİM BORDROSU");
check("varsayılan kullanılır ve Türkçe büyür: 'Cari Mutabakat' → 'CARİ MUTABAKAT'", docTitle(null, "Cari Mutabakat") === "CARİ MUTABAKAT" && docTitle("  ", "Cari") === "CARİ");
check("'ı' → 'I', 'ş' → 'Ş' (Türkçe kural tam)", docTitle("ışık şişe", "X") === "IŞIK ŞİŞE");
check("İngilizce belge: 'delivery note' → 'DELIVERY NOTE'", docTitle("delivery note", "X", "en") === "DELIVERY NOTE");
check("büyük yazılmış başlığa dokunulmaz (büyük I korunur)", docTitle("QUALITY CERTIFICATE", "X") === "QUALITY CERTIFICATE");

console.log("§2 kaynak — çizicilerde çıplak büyük harf yok, başlık tek helper'dan");
const dir = join(__dirname, "..", "src", "services", "document-render");
const dosyalar = readdirSync(dir).filter((f) => f.endsWith(".ts"));
check("körlük zemini: document-render taranıyor (≥ 20 dosya)", dosyalar.length >= 20, `${dosyalar.length}`);
const ciplak = dosyalar.filter((f) => f !== "doc-style.ts" && /\.toUpperCase\(\)/.test(readFileSync(join(dir, f), "utf8")));
check("doc-style.ts dışında `.toUpperCase()` yok", ciplak.length === 0, ciplak.join(", "));
const helperCagiran = dosyalar.filter((f) => /\bdocTitle\(/.test(readFileSync(join(dir, f), "utf8")));
check("≥ 10 dosya başlığı `docTitle` ile basar (9 çizici + tanım)", helperCagiran.length >= 10, helperCagiran.join(", "));
const sayim = readFileSync(join(__dirname, "..", "src", "services", "stock-count.service.ts"), "utf8");
check("sayım belgesinin durum etiketi Türkçe büyük harf (`upperTr(statusLabel(…))`)", /upperTr\(statusLabel\(/.test(sayim) && !/statusLabel\([^)]*\)\.toUpperCase\(\)/.test(sayim));

console.log("§3 kayıtlı her belge tipi — küçük harfli şablon başlığı Türkçe büyür");
const tipler = [...getRegisteredDocBuilders().entries()].filter(([t, e]) => e.renderHtml && (SAMPLE_PRINTED_DOCS as Record<string, unknown>)[t]).map(([t]) => t);
check("körlük zemini: ≥ 14 belge tipi örnekle basılıyor", tipler.length >= 14, `${tipler.length}`);
const bozuk = tipler.filter((t) => baslikOf(render(t, { titleOverride: "sevk fişi içi" })) !== "SEVK FİŞİ İÇİ");
check("hepsi 'SEVK FİŞİ İÇİ' basar", bozuk.length === 0, bozuk.map((t) => `${t}: ${baslikOf(render(t, { titleOverride: "sevk fişi içi" }))}`).join(" · "));

console.log("§4 karışık harfli varsayılan başlıklar");
check("tahsilat makbuzu → 'TAHSİLAT MAKBUZU'", baslikOf(render("PAYMENT_RECEIPT", {})) === "TAHSİLAT MAKBUZU", `${baslikOf(render("PAYMENT_RECEIPT", {}))}`);
check("mutabakat → 'CARİ MUTABAKAT MEKTUBU'", baslikOf(render("RECONCILIATION_LETTER", {})) === "CARİ MUTABAKAT MEKTUBU", `${baslikOf(render("RECONCILIATION_LETTER", {}))}`);
check("çek bordrosu → '… TESLİM BORDROSU'", (baslikOf(render("CHEQUE_DELIVERY_NOTE", {})) ?? "").endsWith("TESLİM BORDROSU"), `${baslikOf(render("CHEQUE_DELIVERY_NOTE", {}))}`);

console.log("§5 İngilizce belge — dil kararı belgenin kendi alanından");
check("sevk irsaliyesi EN + 'delivery note' → 'DELIVERY NOTE'", baslikOf(render("SHIPMENT_DISPATCH", { language: "en", titleOverride: "delivery note" })) === "DELIVERY NOTE");
check("sevk irsaliyesi EN varsayılanı İngilizce büyük harf ('İ' yok)", !/İ/.test(baslikOf(render("SHIPMENT_DISPATCH", { language: "en" })) ?? "İ"), `${baslikOf(render("SHIPMENT_DISPATCH", { language: "en" }))}`);

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
