// test_gelen_belge_motor §19 (Gülkesim çok parti, 2026-11-10): yan çekilmiş ML Kit taraması (0248, anonim) — partinin gelen
// metre/kg/adedi BASILI toplam satırından ("T.Adet N | kg | m"; etiket şablondan), toplam satırı partiye ADETLE (= tablo satır
// sayısı) bağlanır, yeri ne olursa olsun; tablo Σ teyittir (fark → PARTİ TOPLAMI TUTMUYOR). Saf (DB'siz).
import { extractDocument, type DocumentTemplate, type OcrLine, type OcrResult } from "../../src/lib/gelen-belge/motor";
import { draftFromExtraction } from "../../src/lib/gelen-belge/taslak";
import { noteParties } from "../../src/lib/gelen-belge/parti-ozet";

type Check = (label: string, ok: boolean, detay?: string) => void;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Kurulumun tanıttığı şablonun anonim eşi (bölüm başı "Sipariş No", tablo Top/Kilo/Metre, toplam satırı "T.Adet"). */
export function mlkitSablon(totals: boolean): DocumentTemplate {
  return {
    id: "u-ceki-mlkit", name: "Çeki listesi (ML Kit)", version: 1, rules: { multiParty: "PER_PARTY" },
    identifiers: { keywords: ["KUMAŞ ÇEKİ LİSTESİ", "FIŞ NO", "FIRMA", "Sipariş No", "Model", "Top", "Kilo", "Metre"], minScore: 0.6 },
    fields: [
      { key: "partiNo", type: "alnum", label: "Parti No", strategies: [{ kind: "anchor", labels: ["Ham PartiNo"], maxWords: 1, direction: "right", valueShape: "^\\p{L}+\\d+$" }], postProcess: ["upper", "stripSpaces"] },
      { key: "desen", type: "text", label: "Gelen kumaş", maxLength: 80, strategies: [{ kind: "anchor", labels: ["Kalite"], direction: "right" }], postProcess: ["collapseSpaces", "trimPunct"] },
    ],
    tables: [{
      key: "toplar", minHeaderMatches: 2,
      columns: [
        { key: "topNo", type: "alnum", label: "Top No", headers: ["Top"] },
        { key: "kg", type: "decimal", label: "Kilo", headers: ["Kilo"] },
        { key: "m", type: "decimal", label: "Metre", headers: ["Metre"], required: true },
      ],
      ...(totals ? { totals: { labels: ["T.Adet 5"] } } : {}),
    }],
    sections: { table: "toplar", fields: ["partiNo", "desen"], batchField: "partiNo", startLabels: ["Sipariş No"] },
  } as unknown as DocumentTemplate;
}

const lines = (o: OcrResult) => o.blocks.flatMap((b) => b.lines);
/** Toplam satırının kutuları: etiket + sağındaki sayılar (0248: "T.Adet16" + "819,20 3.935,00"; "T.Adet 5" + "141,7" + "586,00"). */
const totalsOf = (o: OcrResult, label: RegExp): OcrLine[] => {
  const l = lines(o).find((x) => label.test(x.text))!;
  const cy = l.rect.y + l.rect.height / 2;
  return lines(o).filter((x) => x === l || (x.rect.x > l.rect.x + l.rect.width && Math.abs(x.rect.y + x.rect.height / 2 - cy) < 30 && /^[\d.,\s]+$/.test(x.text)));
};
/** Kutu grubunu (dx, dy) taşı. */
function shift(o: OcrResult, group: OcrLine[], to: { x: number; y: number }): void {
  const dx = to.x - Math.min(...group.map((l) => l.rect.x)), dy = to.y - Math.min(...group.map((l) => l.rect.y));
  for (const l of group) { l.rect.x += dx; l.rect.y += dy; l.elements.forEach((e) => { e.rect.x += dx; e.rect.y += dy; }); }
}
/** Satır yazısını ve kelimelerini değiştir (kutular aynı; kelime sayısı değişirse son kelimenin kutusu paylaştırılır). */
function setText(o: OcrResult, text: string, words: string[]): void {
  const l = lines(o).find((x) => x.text === text)!;
  const els = l.elements;
  const last = els[els.length - 1]!;
  l.text = words.join(" ");
  l.elements = words.map((w, i) => ({ ...(els[i] ?? last), text: w, rect: { ...(els[i] ?? last).rect } }));
}
const drop = (o: OcrResult, pred: (l: OcrLine) => boolean) => { o.blocks = o.blocks.map((b) => ({ ...b, lines: b.lines.filter((l) => !pred(l)) })); };

function run(ocr: OcrResult, tpl: DocumentTemplate) {
  const ex = extractDocument(ocr, [tpl], null);
  const d = draftFromExtraction(ex, { templates: [tpl] });
  const { parties } = noteParties(d.lines.map((l) => ({ blockNo: l.blockNo ?? 1, meters: l.meters ?? 0, weightKg: l.weightKg ?? null })), d.header.totalsDeclared);
  const p = parties.map((x) => `${x.batchNo}:${x.lineCount}:${x.suggestedMeters}/${x.suggestedMetersSource}:${x.suggestedKg}/${x.kgSource}:${d.header.totalsDeclared.blocks.find((b) => b.blockNo === x.blockNo)?.count ?? "-"}`);
  const w = d.header.warnings;
  const has = (code: string, inc?: string) => w.some((x) => x.startsWith(code) && (inc === undefined || x.includes(inc)));
  const pw = parties.flatMap((x) => x.warnings);
  return { p: p.join(" | "), w, pw, has, tables: ex.regions[0]!.tables, info: JSON.stringify({ p, w: w.map((x) => x.slice(0, 110)), pw }) };
}

const BEKLENEN = "P9918733:5:586/TOTAL:141.7/TOTAL:5 | P9918734:16:3935/TOTAL:819.2/TOTAL:16";

export function toplamSatiri(check: Check, gercek: (ad: string) => OcrResult): void {
  const base = gercek("0248-ceki-listesi-mlkit-yan");
  const tpl = mlkitSablon(true);
  const temiz = (r: ReturnType<typeof run>) => !r.has("TOTAL_") && !r.has("SECTION_SUBTOTAL") && !r.has("TABLE_TOTALS") && !r.has("TABLE_ROWS_SKIPPED");

  const r = run(base, tpl);
  check("§19a ⭐ ML Kit yan tarama: P..33 = 5 top / 586 m / 141,7 kg, P..34 = 16 top / 3935 m / 819,2 kg (basılı toplamdan), uyarısız",
    r.p === BEKLENEN && temiz(r), r.info);

  const t1 = r.tables[0]!.blocks;
  check("§19b birleşik hücre '13,70 54,4' (Kilo+Metre tek ML Kit satırı) bölünür; birleşik başlık 'Kilo Metre' 2. bölümde 16 satır; '212,30|' = 212.3",
    t1[0]!.rows.some((x) => x.cells.m?.value === "54.4" && x.cells.kg?.value === "13.7") && t1[1]!.rows.length === 16
      && t1[1]!.rows.some((x) => x.cells.m?.value === "212.3"), JSON.stringify(t1.map((b) => b.rows.map((x) => x.cells.m?.value))));

  // Yer değiştirme: iki toplam satırı birbirinin yerine (üst sağ ↔ blok 1 altı) — atama adetle, sonuç aynı
  const swap = clone(base);
  const a = totalsOf(swap, /^T\.Adet16$/), b = totalsOf(swap, /^T\.Adet 5$/);
  const aAt = { x: Math.min(...a.map((l) => l.rect.x)), y: Math.min(...a.map((l) => l.rect.y)) };
  const bAt = { x: Math.min(...b.map((l) => l.rect.x)), y: Math.min(...b.map((l) => l.rect.y)) };
  shift(swap, a, bAt); shift(swap, b, aAt);
  const rs = run(swap, tpl);
  check("§19c ⭐ toplam satırları yer değiştirdi (üst ↔ alt): sonuç aynı, uyarısız", rs.p === BEKLENEN && temiz(rs), rs.info);

  // Sol alt: blok 1'in toplamı 2. bölümün sonuna (sol kenar), blok 2'ninki 1. bölümün künye alanının sağına
  const yer = clone(base);
  shift(yer, totalsOf(yer, /^T\.Adet 5$/), { x: 100, y: 2345 });
  shift(yer, totalsOf(yer, /^T\.Adet16$/), { x: 760, y: 455 });
  const ry = run(yer, tpl);
  check("§19d toplam satırları başka bölümün bandında (sol alt / künye sağı): sonuç aynı", ry.p === BEKLENEN && temiz(ry), ry.info);

  // Teyit: 2. partiden bir top satırı kaçtı → metre basılı toplamdan (3935) kalır, PARTİ TOPLAMI TUTMUYOR + TOTAL_MISMATCH blok 2
  const kacan = clone(base);
  drop(kacan, (l) => l.rect.y > 1800 && l.rect.y < 1830);
  const rk = run(kacan, tpl);
  check("§19e satır kaçtı: parti metresi basılı toplam (3935 TOTAL), sessiz değil — PARTİ TOPLAMI TUTMUYOR + TOTAL_MISMATCH blok 2",
    rk.p.includes("P9918734:15:3935/TOTAL:819.2/TOTAL:16") && rk.has("SECTION_SUBTOTAL_MISMATCH", "PARTİ TOPLAMI TUTMUYOR: P9918734") && rk.has("TOTAL_MISMATCH blok 2")
      && !rk.has("TOTAL_MISMATCH blok 1") && !rk.has("TABLE_TOTALS_BY_ORDER"), rk.info);

  // İki partide de adet tutmuyor → okuma sırası yedeği + TABLE_TOTALS_BY_ORDER (sessiz atama yok)
  const iki = clone(base);
  drop(iki, (l) => (l.rect.y > 1800 && l.rect.y < 1830) || (l.rect.y > 960 && l.rect.y < 990));
  const ri = run(iki, tpl);
  check("§19f iki partide adet tutmuyor: okuma sırası yedeği + TABLE_TOTALS_BY_ORDER uyarısı", ri.has("TABLE_TOTALS_BY_ORDER"), ri.info);

  // Toplam değerinin sonunda tablo çizgisi (gerçek tarama GB1011260003: "819,20 3.935,00|") — kg/m düşmez, sonuç aynı
  const cizgi = clone(base);
  setText(cizgi, "819,20 3.935,00", ["819,20", "3.935,00|"]);
  const rc = run(cizgi, tpl);
  check("§19h ⭐ toplam değerinde sondaki tablo çizgisi ('3.935,00|'): 3935 m / 819,2 kg basılı toplamdan, uyarısız", rc.p === BEKLENEN && temiz(rc), rc.info);
  const bas = clone(base);
  setText(bas, "819,20 3.935,00", ["¦819,20", "[3.935,00]"]);
  const rb = run(bas, tpl);
  check("§19h2 baş/son '¦' '[' ']' çizgi gürültüsü de sayıyı düşürmez", rb.p === BEKLENEN && temiz(rb), rb.info);
  // Sayının İÇİNDEKİ karakter yutulmaz: "3.9|35,00" sayı değildir → 3935 uydurulmaz
  const ic = clone(base);
  setText(ic, "819,20 3.935,00", ["819,20", "3.9|35,00"]);
  const ri2 = run(ic, tpl);
  check("§19h3 sayı içindeki '|' temizlenmez: '3.9|35,00' 3935 okunmaz; metresi okunamayan toplam sessiz değil (TOTAL_UNVERIFIED blok 2)",
    !ri2.p.includes("P9918734:16:3935/TOTAL") && ri2.has("TOTAL_UNVERIFIED blok 2", "metresi okunamadı"), ri2.info);

  // Top satırı ölçüsünün başındaki AYRIK tire tablo çizgisidir (gerçek tarama GB1011260003 "- 212,30"): 212,3 okunur, satır atlanmaz
  const tire = clone(base);
  setText(tire, "33,20 212,30|", ["33,20", "-", "212,30"]);
  const rt = run(tire, tpl);
  check("§19k ⭐ top satırında '- 212,30' (ayrık baş tire = çizgi): 212.3 okunur, P..34 16 satır, uyarısız (LINE_SKIPPED yok)",
    rt.p === BEKLENEN && temiz(rt) && !rt.has("LINE_SKIPPED_NO_METERS") && rt.tables[0]!.blocks[1]!.rows.some((x) => x.cells.m?.value === "212.3"), rt.info);
  // Toplam satırında da: "- 3.935,00" basılı toplam düşmez
  const ttire = clone(base);
  setText(ttire, "819,20 3.935,00", ["819,20", "- 3.935,00"]);
  const rtt = run(ttire, tpl);
  check("§19k2 toplam satırında '- 3.935,00': 3935 m basılı toplamdan, uyarısız", rtt.p === BEKLENEN && temiz(rtt), rtt.info);
  // Dar kapsam: bitişik eksi ("-212,30") ayrık çizgi değildir, temizlenmez — genel ayrıştırıcı eksiyi korur, satır pozitif değil → atlanır
  const bitisik = clone(base);
  setText(bitisik, "33,20 212,30|", ["33,20", "-212,30"]);
  const rbt = run(bitisik, tpl);
  check("§19k3 bitişik eksi '-212,30' temizlenmez (ayrıştırıcı değişmedi): satır atlanır, LINE_SKIPPED_NO_METERS blok 2",
    rbt.has("LINE_SKIPPED_NO_METERS", "blok 2") && rbt.p.includes("P9918734:15:"), rbt.info);

  // Bir top satırının metresi okunamadı ("0,00" → satır atlanır): parti metresi basılı toplamda kalır, ama adet (15 ≠ 16) ve
  // metre farkı parti kartında görünür, atlanan satır uyarısı kalır
  const eksi = clone(base);
  setText(eksi, "33,20 212,30|", ["33,20", "0,00"]);
  const re = run(eksi, tpl);
  check("§19i ⭐ metresi okunamayan satır: P..34 15 satır, metre 3935 TOTAL; parti uyarısı 'tablo 15 top / belge 16 top' + metre farkı; LINE_SKIPPED_NO_METERS",
    re.p.includes("P9918734:15:3935/TOTAL:819.2/TOTAL:16") && re.pw.some((x) => x.includes("PARTİ TOPLAMI TUTMUYOR: P9918734") && x.includes("tablo 15 top / belge 16 top") && x.includes("belge 3935 m"))
      && re.has("LINE_SKIPPED_NO_METERS", "blok 2"), re.info);
  // Basılı metre de okunamadıysa (çizgi gürültüsünün eski hâli) adet farkı yine sessiz kalmaz
  const ikisi = clone(eksi);
  setText(ikisi, "819,20 3.935,00", ["819,20", "3.9|35,00"]);
  const r2 = run(ikisi, tpl);
  check("§19j basılı metre okunamadı + satır atlandı: parti uyarısı yine 'tablo 15 top / belge 16 top'",
    r2.pw.some((x) => x.includes("PARTİ TOPLAMI TUTMUYOR: P9918734") && x.includes("tablo 15 top / belge 16 top")) && r2.has("TOTAL_UNVERIFIED blok 2") && r2.has("LINE_SKIPPED_NO_METERS"), r2.info);

  // Şablonda toplam satırı etiketi yoksa motor etiketi uydurmaz (koda sabit 'T.Adet' YOK): toplam okunmaz → TOTAL_UNVERIFIED
  const rn = run(base, mlkitSablon(false));
  check("§19g şablonda 'Toplam satırı' yok: beyan okunmaz (sabit etiket yok), TOTAL_UNVERIFIED", rn.has("TOTAL_UNVERIFIED"), rn.info);
}
