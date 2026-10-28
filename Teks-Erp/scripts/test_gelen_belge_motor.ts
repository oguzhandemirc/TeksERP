// =============================================================================
// BEKÇİ — GELEN BELGE MOTORU (D3a): vendor motor + TABLO/bölgeleme/ızgara/toplam
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts gelen_belge_motor   (DB'siz, sunucusuz)
//
// ⭐ NEDEN VAR (2026-10-28): TASARIM-KARARI-2026-10-28 §6 D3a kabul satırı SOMUT EŞİKTİR:
//    0245 → 2 blok, 21/21 satır, beyan (5/141,70/586,00 · 16/819,20/3.935,00) = Σ ·
//    0246 → 2 bölge, her birinde başlık alanları · 0244 → ≥15 hücre rect + el yazısı
//    toplam uyarısı · 0243 → başlık 3 alan · sentetik alt küme alan doğruluğu ≥ %93.
//    Motor saf fonksiyondur; fikstürler anonim (`__tests__/fikstur/gercek/README.md`).
//
// ⚠️ DEFTER KURALI: motor deftere YAZMAZ; TOTAL_MISMATCH yalnız uyarı dizesidir, 409'u
//    onay ucu (D4) üretir. Bu bekçi uyarının ÜRETİLDİĞİNİ ölçer (§7 kasıtlı bozulmuş toplam).
//
// ⭐ NEGATİF SONDA (2026-10-28, raporda): rows-tilted.ts'te tan(a) → 0 yapılınca §3 21/21
//    düşer; totals.ts'te MISMATCH dalı kapatılınca §7 TOTAL_MISMATCH düşer. md5 ile geri alındı.
// =============================================================================
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  buildRowsTilted,
  classifyDocument,
  computeNoteTotals,
  extractDocument,
  extractFields,
  loadTemplates,
  pageMedianAngle,
  splitRegions,
  sumCanonical,
  validateTemplate,
  type DocumentTemplate,
  type OcrLine,
  type OcrResult,
} from "../src/lib/gelen-belge/motor";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detay ? ` — ${detay}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detay ? ` — ${detay}` : ""}`);
  }
}

const FIKSTUR = join(__dirname, "..", "src", "lib", "gelen-belge", "motor", "__tests__", "fikstur");
const gercek = (ad: string): OcrResult => JSON.parse(readFileSync(join(FIKSTUR, "gercek", `${ad}.json`), "utf8")) as OcrResult;
const sablonlar = loadTemplates();

function kutu(text: string, x: number, y: number, w: number, h: number, angle: number | null = 0): OcrLine {
  return { text, rect: { x, y, width: w, height: h }, confidence: 0.99, angle, elements: [{ text, rect: { x, y, width: w, height: h }, confidence: 0.99 }] };
}

// ── §1 Vendor + şablonlar ────────────────────────────────────────────────────
{
  check("§1a 6 başlangıç şablonu (5 gönderen taslağı + GENEL) yüklendi", sablonlar.length === 6, sablonlar.map((t) => t.id).join(","));
  const hatalar = sablonlar.flatMap((t) => validateTemplate(t).errors.map((e) => `${t.id}: ${e}`));
  check("§1b her şablon validateTemplate'ten geçiyor (tables/grid dahil)", hatalar.length === 0, hatalar.join(" | "));
  check("§1c GENEL şablon listenin SONUNDA (yedek; puanlamaya girmez)", sablonlar[sablonlar.length - 1]!.id === "genel");
  const bozuk = validateTemplate({ ...sablonlar[0], tables: [{ key: "t", columns: [{ key: "a", type: "para", headers: [] }] }] });
  check("§1d bozuk tablo tanımı (bilinmeyen tip + boş headers) reddediliyor", !bozuk.ok && bozuk.errors.length >= 2, bozuk.errors.join(" | "));
}

// ── §2 Eğime duyarlı satır gruplama (birim) ──────────────────────────────────
{
  // −3° eğik satır: 375 px sağdaki kutu ~20 px yukarıda; eğimsiz eşik (0,5·h=15) bunu AYIRIR (negatif sonda A bunu ölçer)
  const a = kutu("26209943", 300, 1000, 120, 30, -3);
  const b = kutu("33,20", 700, 980, 70, 30, -3);
  const c = kutu("212,30", 900, 969, 90, 30, -3);
  const dar = kutu("6", 240, 1006, 20, 30, 0); // dar kutu: açı 0 bildirir, sayfa medyanı kullanılmalı
  const baska = kutu("38,80", 700, 1025, 70, 30, -3); // bir alt satır
  const rows = buildRowsTilted([baska, c, dar, a, b]);
  check("§2a eğik 4 kutu + dar sıra no TEK satır, alt satır ayrı", rows.length === 2 && rows[0]!.lines.length === 4, rows.map((r) => r.text).join(" || "));
  check("§2b satır içi sıra soldan sağa", rows[0]!.text === "6  26209943  33,20  212,30", rows[0]!.text);
  check("§2c sayfa medyan açısı yalnız geniş kutulardan", pageMedianAngle([a, b, c, dar]) === -3);
  const duz = buildRowsTilted([kutu("A", 0, 0, 100, 20), kutu("B", 150, 2, 100, 20), kutu("C", 0, 60, 100, 20)]);
  check("§2d açısız (ML Kit) kutularda düz y gruplaması korunuyor", duz.length === 2 && duz[0]!.text === "A  B");
}

// ── §3 0245 — iki blok, 21/21, beyan = Σ ────────────────────────────────────
{
  const r = extractDocument(gercek("0245-ceki-listesi-a"), sablonlar);
  const reg = r.regions[0]!;
  check("§3a 0245 tek bölge, şablon ceki-listesi-a", r.regions.length === 1 && reg.templateId === "ceki-listesi-a", `${r.regions.length}/${reg.templateId}`);
  const t = reg.tables[0]!;
  check("§3b 2 blok", t.blocks.length === 2, String(t.blocks.length));
  const satirlar = t.blocks.flatMap((b) => b.rows);
  check("§3c 21/21 satır (5 + 16)", t.blocks[0]!.rows.length === 5 && t.blocks[1]!.rows.length === 16, t.blocks.map((b) => b.rows.length).join("+"));
  const tam = satirlar.every((row) => /^\d{8}$/.test(row.cells.topNo?.value ?? "") && row.cells.kg?.value && row.cells.m?.value);
  check("§3d her satırda top no (8 hane) + kg + m", tam);
  check("§3e satırlar gözden geçirme istemiyor (basılı, güven yüksek)", satirlar.every((row) => !row.needsReview), String(satirlar.filter((x) => x.needsReview).length));
  const d1 = t.blocks[0]!.declared;
  const d2 = t.blocks[1]!.declared;
  check("§3f blok 1 beyan 5 / 141,70 / 586,00", d1?.count === "5" && d1.kg === "141.7" && d1.m === "586", JSON.stringify(d1));
  check("§3g blok 2 beyan 16 / 819,20 / 3.935,00 (sahipsiz üst satır Σ ile bağlandı)", d2?.count === "16" && d2.kg === "819.2" && d2.m === "3935", JSON.stringify(d2));
  const tot = reg.totals!;
  check("§3h her iki blokta beyan = Σ (MATCH)", tot.blocks.every((b) => b.status === "MATCH"), JSON.stringify(tot.blocks.map((b) => [b.status, b.computed])));
  check("§3i genel toplam 21 / 960,90 / 4.521,00", tot.grand.count === 21 && tot.grand.kg === "960.9" && tot.grand.m === "4521", JSON.stringify(tot.grand));
  check("§3j başlıktaki '4 TOP' ↔ 5 satır yalnız UYARI (DECLARED_TOP_COUNT_DIFF), TOTAL_MISMATCH YOK",
    reg.warnings.some((w) => w.startsWith("DECLARED_TOP_COUNT_DIFF")) && !reg.warnings.some((w) => w.startsWith("TOTAL_MISMATCH")), reg.warnings.join(" | "));
  const f = reg.fields!.fields;
  check("§3k başlık: fiş no, tarih, firma, iş emri, ham parti", f.fisNo?.value === "214279" && f.tarih?.value === "2026-10-19" && f.firma?.value === "ÖRNEK TEKSTİL A" && f.isEmriNo?.value === "26K-24749" && f.hamPartiNo?.value === "P2618733",
    JSON.stringify({ fisNo: f.fisNo?.value, tarih: f.tarih?.value, firma: f.firma?.value, isEmriNo: f.isEmriNo?.value, hamPartiNo: f.hamPartiNo?.value }));
}

// ── §4 0246 — tek fotoğrafta iki belge ──────────────────────────────────────
{
  const ocr = gercek("0246-iki-belge");
  const bolgeler = splitRegions(ocr);
  check("§4a 2 bölge; ikincisi ~1225 px'ten başlıyor, rect'ler bölge uzayına kaydırılmış",
    bolgeler.length === 2 && bolgeler[1]!.rect.y > 1100 && bolgeler[1]!.rect.y < 1400 && bolgeler[1]!.ocr.blocks.every((b) => b.rect.y >= 0 && b.rect.y < bolgeler[1]!.rect.height),
    JSON.stringify(bolgeler.map((b) => [b.regionNo, b.rect.y, b.lineCount])));
  const r = extractDocument(ocr, sablonlar);
  const [r1, r2] = r.regions;
  check("§4b bölge 1 → cikis-ceki-listesi, bölge 2 → urun-sevk-fisi", r1?.templateId === "cikis-ceki-listesi" && r2?.templateId === "urun-sevk-fisi", `${r1?.templateId}/${r2?.templateId}`);
  const f1 = r1!.fields!.fields;
  check("§4c bölge 1 başlık: iş emri ISM1439770, tarih 2026-10-19, müşteri, müşteri MT 238",
    f1.isEmriNo?.value === "ISM1439770" && f1.tarih?.value === "2026-10-19" && f1.musteri?.value === "MA" && f1.musteriMt?.value === "238",
    JSON.stringify({ isEmriNo: f1.isEmriNo?.value, tarih: f1.tarih?.value, musteri: f1.musteri?.value, mt: f1.musteriMt?.value }));
  const b1 = r1!.tables[0]!.blocks[0];
  check("§4d bölge 1 tablo: ARABA satırı 241 m / 734 kg, TOPLAM = Σ", b1?.rows.length === 1 && b1.rows[0]!.cells.m?.value === "241" && b1.rows[0]!.cells.kg?.value === "734" && r1!.totals?.blocks[0]?.status === "MATCH",
    JSON.stringify(b1?.rows.map((x) => [x.cells.m?.value, x.cells.kg?.value])) + " " + r1!.totals?.blocks[0]?.status);
  const f2 = r2!.fields!.fields;
  check("§4e bölge 2 başlık: sevk no 46399, sevk tarihi 2026-10-16, müşteri adı, toplam 200 m / 36 kg",
    f2.sevkNo?.value === "46399" && f2.sevkTarihi?.value === "2026-10-16" && f2.musteriAdi?.value === "ÖRNEK" && f2.toplamMetre?.value === "200" && f2.toplamKg?.value === "36",
    JSON.stringify({ sevkNo: f2.sevkNo?.value, tarih: f2.sevkTarihi?.value, musteri: f2.musteriAdi?.value, m: f2.toplamMetre?.value, kg: f2.toplamKg?.value }));
  check("§4f bölge 2 giriş toplamı (198,10 mt / 35,70 kg) ↔ başlık uyarısı için okunuyor", f2.girisToplamMt?.value === "198.1" && f2.girisToplamKg?.value === "35.7");
  check("§4g MULTI_REGION uyarısı var", r.warnings.some((w) => w.startsWith("MULTI_REGION")));
  check("§4h 0245 ve 0243 YANLIŞ bölünmüyor (imza/altbilgi kuyruğu bölge değil)", splitRegions(gercek("0245-ceki-listesi-a")).length === 1 && splitRegions(gercek("0243-kesim-takip-formu")).length === 1);
}

// ── §5 0244 — el yazısı ızgarası ─────────────────────────────────────────────
{
  const r = extractDocument(gercek("0244-kumas-irsaliyesi"), sablonlar);
  const reg = r.regions[0]!;
  check("§5a şablon kumas-irsaliyesi", reg.templateId === "kumas-irsaliyesi", reg.templateId ?? "null");
  const g = reg.grid!;
  check("§5b ≥15 hücre rect (5 sıra kolonu × 20 satır × 2 değer kolonu = 200)", g.cells.length >= 15 && g.cells.length === 200, String(g.cells.length));
  check("§5c sıra kolonları 1-20 / 21-40 / 41-60 / 61-80 / 81-100 (okunamayan '1', '21' ve sapan '7', '03' düzeltildi)",
    JSON.stringify(g.seqColumns.map((c) => [c.first, c.last])) === "[[1,20],[21,40],[41,60],[61,80],[81,100]]", JSON.stringify(g.seqColumns.map((c) => [c.first, c.last])));
  check("§5d her hücre needsReview (el yazısı; OCR adayı yalnız öneri)", g.cells.every((c) => c.needsReview));
  const h11 = g.cells.find((c) => c.seqNo === 11 && c.key === "metre");
  check("§5e 11. satır metre hücresi el yazısı '170' adayını taşıyor", h11?.candidates.some((c) => c.text === "170") === true, JSON.stringify(h11?.candidates.map((c) => c.text)));
  check("§5f hücre rect'leri çakışmıyor ve pozitif", g.cells.every((c) => c.rect.width > 0 && c.rect.height > 0));
  check("§5g el yazısı toplam uyarısı (TOTAL_UNVERIFIED)", reg.warnings.some((w) => w.startsWith("TOTAL_UNVERIFIED")), reg.warnings.join(" | "));
}

// ── §6 0243 — başlık 3 alan + ızgara ────────────────────────────────────────
{
  const r = extractDocument(gercek("0243-kesim-takip-formu"), sablonlar);
  const reg = r.regions[0]!;
  const f = reg.fields!.fields;
  check("§6a şablon kesim-takip-formu", reg.templateId === "kesim-takip-formu", reg.templateId ?? "null");
  check("§6b başlık 3 alan: tarih 2026-10-15, evrak no 70779, giriş mt 1375", f.tarih?.value === "2026-10-15" && f.evrakNo?.value === "70779" && f.girisMt?.value === "1375",
    JSON.stringify({ tarih: f.tarih?.value, evrakNo: f.evrakNo?.value, girisMt: f.girisMt?.value }));
  check("§6c el yazısı giriş/çıkış mt gözden geçirme istiyor (otomatik satılmaz)", f.girisMt?.needsReview === true && f.cikisMt?.needsReview === true);
  const g = reg.grid!;
  check("§6d ızgara 3 kolon 1-25 / 26-50 / 51-75, 75 hücre", JSON.stringify(g.seqColumns.map((c) => [c.first, c.last])) === "[[1,25],[26,50],[51,75]]" && g.cells.length === 75,
    JSON.stringify(g.seqColumns.map((c) => [c.first, c.last])) + " " + g.cells.length);
  check("§6e 1. hücre el yazısı '1775' adayını taşıyor (satırsız form: tek top önerisi)", g.cells.find((c) => c.seqNo === 1)?.candidates.some((c) => c.text === "1775") === true);
}

// ── §7 computeNoteTotals + kasıtlı bozulmuş toplam → TOTAL_MISMATCH ─────────
{
  const ok = computeNoteTotals([{ blockNo: 1, declared: { count: "2", kg: "0.3", m: "300" }, lines: [{ meters: "100", weightKg: "0.1" }, { meters: "200", weightKg: "0.2" }] }]);
  check("§7a 0,1 + 0,2 = 0,3 (ölçekli tam sayı; kayan nokta değil) → MATCH, uyarı yok", ok.blocks[0]!.status === "MATCH" && ok.warnings.length === 0, JSON.stringify(ok));
  const bozuk = computeNoteTotals([{ blockNo: 1, declared: { count: "2", kg: "0.3", m: "301" }, lines: [{ meters: "100", weightKg: "0.1" }, { meters: "200", weightKg: "0.2" }] }]);
  check("§7b beyan m 301 ≠ Σ 300 → MISMATCH + TOTAL_MISMATCH uyarısı, fark 1", bozuk.blocks[0]!.status === "MISMATCH" && bozuk.warnings[0]!.startsWith("TOTAL_MISMATCH") && bozuk.blocks[0]!.diff.m === "1", JSON.stringify(bozuk.warnings));
  const yok = computeNoteTotals([{ blockNo: 1, declared: null, lines: [{ meters: "100", weightKg: null }] }]);
  check("§7c beyan yok → UNVERIFIED + TOTAL_UNVERIFIED", yok.blocks[0]!.status === "UNVERIFIED" && yok.warnings[0]!.startsWith("TOTAL_UNVERIFIED"));
  const top = computeNoteTotals([{ blockNo: 1, declared: { count: null, kg: null, m: "100" }, lines: [{ meters: "100", weightKg: null }], declaredTopCount: "4" }]);
  check("§7d '4 TOP' ↔ 1 satır → DECLARED_TOP_COUNT_DIFF, durum MATCH kalır", top.blocks[0]!.status === "MATCH" && top.warnings.some((w) => w.startsWith("DECLARED_TOP_COUNT_DIFF")));
  check("§7e sumCanonical binlik/ondalık karışımı", sumCanonical(["3935", "819.2", null, "0.005"]) === "4754.205");
  // Gerçek fikstürde KASITLI BOZMA: 0245 1. satır metre 118,60 → 119,60 (Σ 587 ≠ beyan 586)
  const ocr = JSON.parse(JSON.stringify(gercek("0245-ceki-listesi-a"))) as OcrResult;
  let degisti = 0;
  for (const b of ocr.blocks) for (const l of b.lines) if (l.text === "118,60") { l.text = "119,60"; l.elements.forEach((e) => { if (e.text === "118,60") e.text = "119,60"; }); degisti++; }
  check("§7f sonda ön koşulu: mutasyon UYGULANDI (tam 1 kutu)", degisti === 1, String(degisti));
  const r = extractDocument(ocr, sablonlar).regions[0]!;
  check("§7g ⭐ kasıtlı bozulmuş toplam → blok 1 MISMATCH + TOTAL_MISMATCH (m beyan 586 / hesap 587), blok 2 MATCH",
    r.totals?.blocks[0]?.status === "MISMATCH" && r.totals.blocks[1]?.status === "MATCH" && r.warnings.some((w) => w.startsWith("TOTAL_MISMATCH blok 1") && w.includes("586") && w.includes("587")),
    r.warnings.join(" | "));
}

// ── §8 Sentetik alt küme — alan doğruluğu ≥ %93 ─────────────────────────────
{
  const dir = join(FIKSTUR, "sentetik");
  const gts = JSON.parse(readFileSync(join(dir, "ground-truth.json"), "utf8")) as Array<{ id: string; templateId: string; truth: Record<string, string | null> }>;
  const sentetikSablonlar = readdirSync(join(dir, "sablon")).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(join(dir, "sablon", f), "utf8")) as DocumentTemplate);
  let docs = 0, clsOk = 0, total = 0, okCount = 0;
  const kacaklar: string[] = [];
  for (const gt of gts) {
    const ocr = JSON.parse(readFileSync(join(dir, `${gt.id}.ocr.json`), "utf8")) as OcrResult;
    docs++;
    if (classifyDocument(ocr, sentetikSablonlar).templateId === gt.templateId) clsOk++;
    const tpl = sentetikSablonlar.find((t) => t.id === gt.templateId)!;
    const r = extractFields(ocr, tpl);
    for (const [k, v] of Object.entries(gt.truth)) {
      total++;
      if ((r.fields[k]?.value ?? null) === v) okCount++;
      else kacaklar.push(`${gt.id}.${k}: beklenen=${v} alınan=${r.fields[k]?.value ?? null}`);
    }
  }
  const dogruluk = okCount / total;
  check("§8a sentetik alt küme ≥ 20 belge", docs >= 20, String(docs));
  check("§8b sınıflandırma ≥ %95", clsOk / docs >= 0.95, `${clsOk}/${docs}`);
  check("§8c alan doğruluğu ≥ %93 (kabul eşiği)", dogruluk >= 0.93, `${okCount}/${total} = %${(dogruluk * 100).toFixed(1)}${kacaklar.length ? " | " + kacaklar.slice(0, 8).join(" | ") : ""}`);
}

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exitCode = fail > 0 ? 1 : 0;
