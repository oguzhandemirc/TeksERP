// =============================================================================
// Test: kanvas eleman modeli → 4 dil emit (Etiket Stüdyosu F2)
// =============================================================================
// DB'siz sentetik test: degrade matrisi (PPLA'da line/box/banner atlanır),
// present:false alan atlanır (mutlak konum — diğer elemanlar KAYMAZ), rotasyon
// kodları, QR ölçeği, code128 human bayrağı, HTML mutlak konum + UTF-8,
// validateCanvasLayout kuralları, native-preview PPLA rot/QR-mag parse fix'i.
// Çalıştır: npx tsx scripts/test_label_canvas_renderer.ts
// =============================================================================
import {
  emitCanvasPpla,
  emitCanvasPplb,
  emitCanvasZpl,
  type CanvasRenderInput,
} from "../src/services/helpers/label-canvas-native.helper";
import { buildCanvasLabelHtml } from "../src/services/helpers/label-canvas-html.helper";
import {
  validateCanvasLayout,
  readCanvasLayout,
  CanvasValidationError,
  type CanvasLayout,
} from "../src/config/label-elements";
import { renderPplaToSvg, renderPplbToSvg } from "../src/services/helpers/native-preview";
import type { ResolvedLabelFormat } from "../src/services/helpers/label-format.resolver";
import type { LabelPayload } from "../src/services/label.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

const format: ResolvedLabelFormat = {
  widthMm: 100, heightMm: 60, marginMm: 3,
  marginTopMm: 3, marginRightMm: 3, marginBottomMm: 3, marginLeftMm: 3, gapMm: 2,
  orientation: "LANDSCAPE" as never,
  dpi: 203, language: "PPLB" as never, source: "machine" as never,
};

const payload = {
  barcode: "TEKS20260706AB12", qualityGrade: "1.KALITE", widthCm: 150,
  lengthMeters: 320, weightKg: 40, itemName: "PATOS", colorName: "MAVİ",
  customerName: "Şahin Tekstil", batchNumber: "P-1",
} as unknown as LabelPayload;

const layout: CanvasLayout = {
  v: 1,
  elements: [
    { id: "qr", type: "qr", x: 3, y: 3, scale: 6 },
    { id: "t1", type: "field", bind: "itemName", x: 30, y: 3, font: "lg", bold: true },
    { id: "t2", type: "field", bind: "customerName", label: "Müşteri", x: 30, y: 12 },
    { id: "t3", type: "text", text: "SABİT NOT", x: 30, y: 20, rot: 90 },
    { id: "ln", type: "line", x: 3, y: 30, wMm: 90, hMm: 0.8 },
    { id: "bx", type: "box", x: 3, y: 32, wMm: 40, hMm: 10, thickMm: 1 },
    { id: "bn", type: "lengthBanner", x: 88, y: 3, wMm: 9, hMm: 50 },
    { id: "bc", type: "code128", x: 3, y: 46, hMm: 9, human: true },
  ],
};

function mk(input?: Partial<CanvasRenderInput>): CanvasRenderInput {
  return { payload, format, copies: 2, layout, ...input };
}

async function main() {
  const pplb = emitCanvasPplb(mk());
  const ppla = emitCanvasPpla(mk());
  const zpl = await emitCanvasZpl(mk());
  const html = buildCanvasLabelHtml({ ...mk(), barcodeSvg: "<svg viewBox=\"0 0 10 10\"></svg>", qrSvg: "<svg viewBox=\"0 0 10 10\"></svg>" });

  // --- Degrade matrisi: PPLA'da YALNIZ banner yok (reverse yok); line/box artık
  //     DPL font-X kayıtlarıyla PPLA'da da basılır ---
  // Argox Line/Box: KÜÇÜK l/b = 4-haneli param (BÜYÜK L/B = 3-haneli → pad4 ile alan kayması/RESET).
  check("PPLA: line (Argox küçük 'l', 4-hane) basılır", /1X11000\d{4}\d{4}l\d{4}\d{4}/.test(ppla));
  check("PPLA: box (Argox küçük 'b', 4-hane) basılır", /1X11000\d{4}\d{4}b\d{4}\d{4}\d{4}\d{4}/.test(ppla));
  // Banner PPLA'da ÇERÇEVELİ basılır: band kutusu + 90° döndürülmüş siyah değer
  // (ters-renk yok — DPL reverse güvenilmez; dolgulu sürüm PPLB/ZPL'de).
  check(
    "PPLA: banner çerçeveli sürüm (kutu + rot-90 değer, ters-renksiz)",
    (ppla.match(/1X11000\d{4}\d{4}b/g) ?? []).length >= 2 && /^24\d\d000\d{8}320/m.test(ppla),
  );
  check("PPLB: line (LO) basılır", /LO24,240,719,6/.test(pplb));
  check("PPLB: box (X) basılır", /X24,256,8,344,336/.test(pplb) || /^X24,256,/m.test(pplb));
  // Bant: PPLB/ZPL SİYAH ZEMİN + BEYAZ değer (ters); PPLA çerçeveli (DPL reverse yok).
  check("PPLB: banner SİYAH+beyaz (ters R + boşluk dolgu)", /A775,56,1,4,3,3,R,"  320m  "/.test(pplb));
  check("ZPL: line dolu ^GB", /\^GB719,6,6,B/.test(zpl));
  check("ZPL: banner SİYAH+beyaz (dolu ^GB + ^FR ORTALANMIŞ değer)", /\^FO703,24\^GB72,400,72,B\^FS/.test(zpl) && /\^FO775,140\^A0R,72,42\^FR\^FD320m\^FS/.test(zpl));

  // --- Metin/rotasyon/font ---
  check("PPLB: bold metin çarpan 2", /A240,24,0,3,2,2,N,"PATOS"/.test(pplb));
  // PPLB Türkçe codepage (I8,E,001 + CP1254): asciiFold DEĞİL — Türkçe glif cp1254
  // baytına eşlenir (ü→ü, ş→þ, Ş→Þ) → yazıcı gerçek Türkçe basar. (commit `40b7c6f`)
  check("PPLB: label'lı alan 'Müşteri: ...'", pplb.includes('"Müþteri: Þahin Tekstil"'));
  check("PPLB: rot 90 → rotCode 1", /A240,160,1,2,1,1,N,"SABÝT NOT"/.test(pplb));
  check("PPLA: rot 90 → önek 2", /^22\d\d000\d{4}\d{4}SABIT NOT/m.test(ppla));
  check("ZPL: rot 90 → ^A0R", /\^A0R,\d+,\d+\^FDSABIT NOT\^FS/.test(zpl));
  check("ZPL: bold ^A0N,40,24 (lg×2)", /\^A0N,40,24\^FDPATOS\^FS/.test(zpl));

  // --- QR / Code128 ---
  check("PPLB: QR s6", pplb.includes(`b24,24,Q,m2,s6,"${payload.barcode}"`));
  check("PPLA: QR 1W1d66 (auto QR, tek-karakter modül)", ppla.includes(`1W1d66`));
  check("ZPL: QR mag 6", zpl.includes("^BQN,2,6"));
  // Barkod okunur satırı: firmware KAPALI (N) + manuel, barkod ALTINDA ORTALANMIŞ
  // (barkod sol x=24 değil; PPLB hx=171 dot / PPLA hcol=0084 (171 dot → 1/100 inç) / ZPL hx=139).
  check("PPLB: Code128 human=N + ortalanmış (171)", /B24,368,0,1,2,3,72,N,/.test(pplb) && /A171,448,0,1,1,1,N,"TEKS20260706AB12"/.test(pplb));
  // PPLA birim: 1/100 inç + yükseklik alanı 3 HANE (fiziksel doğrulama 2026-07-10).
  check("PPLA: Code128 (h3) + okunur satır ORTALANMIŞ (0088, DPL font1 w=7)", /1e22\d{3}\d{4}\d{4}TEKS/.test(ppla) && /1111000\d{4}0088TEKS20260706AB12/.test(ppla));
  check("ZPL: Code128 interpretation=N + ortalanmış (139)", /\^BCN,72,N,N,N/.test(zpl) && /\^FO139,448\^A0N,20,12\^FDTEKS20260706AB12\^FS/.test(zpl) && !zpl.includes("^BY"));

  // --- ÇEVRİLEBİLİR bant: rot metin yönünü döndürür (varsayılan 90 dikey) ---
  const bnRot0: CanvasLayout = { v: 1, elements: [
    { id: "q9", type: "qr", x: 3, y: 40, scale: 4 },
    { id: "bn0", type: "lengthBanner", x: 30, y: 3, wMm: 40, hMm: 8, rot: 0 },
  ] };
  const pplbR0 = emitCanvasPplb(mk({ layout: bnRot0 }));
  const zplR0 = await emitCanvasZpl(mk({ layout: bnRot0 }));
  const pplaR0 = emitCanvasPpla(mk({ layout: bnRot0 }));
  // rot=0 → PPLB rotCode 0, ZPL ^A0N, PPLA rot öneki 1 (yatay metin).
  check("bant rot=0: PPLB rotCode 0 (yatay)", /A\d+,\d+,0,4,\d,\d,R," *320m *"/.test(pplbR0));
  check("bant rot=0: ZPL ^A0N (yatay)", /\^A0N,\d+,\d+\^FR\^FD320m\^FS/.test(zplR0));
  check("bant rot=0: PPLA rot öneki 1 (yatay)", /14\d\d000\d{8}320/.test(pplaR0));
  // Varsayılan (rot yok) = 90 dikey — bayt-uyum (ana layout banner'ı).
  check("bant rot yok → 90 dikey (PPLB rotCode 1)", /A\d+,\d+,1,4,\d,\d,R,/.test(pplb));

  // --- Bant kişiselleştirme: unit kapalı + serbest değer boyutu (glyphHMm) + genişlik
  //     oranı (wr). glyphHMm=4mm=32dot → EPL font2×2 (16×2); wr=2 → hmul 4. Değer "320"
  //     (m eki YOK). PPLA kendi DPL tablosundan seçer (font4×1, hmul 2). ---
  const bnCustom: CanvasLayout = { v: 1, elements: [
    { id: "q8", type: "qr", x: 3, y: 40, scale: 4 },
    { id: "bnc", type: "lengthBanner", x: 88, y: 3, wMm: 9, hMm: 50, unit: false, glyphHMm: 4, wr: 2 },
  ] };
  const pplbBn = emitCanvasPplb(mk({ layout: bnCustom }));
  const zplBn = await emitCanvasZpl(mk({ layout: bnCustom }));
  const pplaBn = emitCanvasPpla(mk({ layout: bnCustom }));
  const htmlBn = buildCanvasLabelHtml({ ...mk({ layout: bnCustom }), barcodeSvg: "<svg viewBox=\"0 0 1 1\"></svg>", qrSvg: "<svg viewBox=\"0 0 1 1\"></svg>" });
  check("bant unit=false: PPLB değer 'm'siz", /R," *320 *"/.test(pplbBn) && !pplbBn.includes("320m"));
  check("bant glyphHMm=4+wr=2: PPLB font2, hmul4, vmul2", /A\d+,\d+,1,2,4,2,R,/.test(pplbBn));
  check("bant glyphHMm=4+wr=2: ZPL ^A0R,32,40 (ortak kombinasyon)", /\^A0R,32,40\^FR\^FD320\^FS/.test(zplBn));
  check("bant glyphHMm: PPLA kendi DPL tablosu (font4, hmul2, vmul1)", /^2421000\d{8}320$/m.test(pplaBn));
  check("bant HTML: 'm'siz değer + scaleX(2) + fiili boyut ≈4.00mm", htmlBn.includes(">320</span>") && htmlBn.includes("scaleX(2)") && /font-size:4\.0\dmm/.test(htmlBn));
  // Bayt-uyum: yeni alanlar YOKKEN ana layout banner çıktısı değişmedi (üstteki
  // "PPLB: banner SİYAH+beyaz" kontrolü sabit A775,56,1,4,3,3'ü zaten doğruluyor).

  // --- SERBEST metin boyutu (hMm/wr): ZPL/HTML birebir, PPLA/PPLB en yakın kombinasyon ---
  const freeLayout: CanvasLayout = {
    v: 1,
    elements: [
      { id: "qr0", type: "qr", x: 3, y: 30, scale: 4 },
      { id: "big", type: "text", text: "KALIN", x: 3, y: 3, hMm: 6, wr: 2 },
    ],
  };
  const pplbFree = emitCanvasPplb(mk({ layout: freeLayout }));
  const pplaFree = emitCanvasPpla(mk({ layout: freeLayout }));
  const zplFree = await emitCanvasZpl(mk({ layout: freeLayout }));
  const htmlFree = buildCanvasLabelHtml({ ...mk({ layout: freeLayout }), barcodeSvg: "<svg viewBox=\"0 0 1 1\"></svg>", qrSvg: "<svg viewBox=\"0 0 1 1\"></svg>" });
  // 6mm=48 dot → font5 (32×48) ×1 birebir; wr=2 → yatay çarpan 2.
  check("PPLB serbest: font5×(h2,v1) seçildi", /A24,24,0,5,2,1,N,"KALIN"/.test(pplbFree));
  check("PPLA serbest: 1 5 2 1 kaydı", /^1521000\d{8}KALIN/m.test(pplaFree));
  // ORTAK PAYDA: ZPL de PPLB/PPLA'nın seçtiği kombinasyonun boyutunu basar
  // (font5 h48 × hmul2 → w64) — dört dil AYNI boyut.
  check("ZPL serbest: ^A0N,48,64 (ortak kombinasyon)", /\^A0N,48,64\^FDKALIN\^FS/.test(zplFree));
  // 48 dot @203dpi = 6.006mm → HTML fiilen basılan boyutu yazar (6.01mm).
  check("HTML serbest: ortak kombinasyonun FİİLİ boyutu (≈6.01mm) + scaleX(2)", /font-size:6\.0\dmm/.test(htmlFree) && htmlFree.includes("scaleX(2)"));

  // --- Modül kalınlığı (mw): üç dilde orantılı genişletme ---
  const mwLayout: CanvasLayout = {
    v: 1,
    elements: [{ id: "bc3", type: "code128", x: 3, y: 10, hMm: 9, human: true, mw: 3 }],
  };
  const pplbMw = emitCanvasPplb(mk({ layout: mwLayout }));
  const pplaMw = emitCanvasPpla(mk({ layout: mwLayout }));
  const zplMw = await emitCanvasZpl(mk({ layout: mwLayout }));
  check("PPLB: mw=3 → dar/geniş 3,4 (human firmware KAPALI)", /B24,80,0,1,3,4,72,N,/.test(pplbMw));
  check("PPLA: mw=3 → 1e33", /1e33\d{4}/.test(pplaMw));
  check("ZPL: mw=3 → ^BY3 (interpretation KAPALI)", zplMw.includes("^BY3^BCN,72,N,N,N"));

  // --- İKON (bakım sembolü): PPLB GW inline grafik + ZPL ^GFA; PPLA'da SKIP; HTML SVG.
  //     Metin/barkod native kalır, sadece ikon bitmap gider (Bluetooth düşük yük) ---
  const iconLayout: CanvasLayout = { v: 1, elements: [
    { id: "q7", type: "qr", x: 3, y: 40, scale: 4 },
    { id: "ic1", type: "icon", icon: "wash-no", x: 30, y: 5, hMm: 8 },
    { id: "ic2", type: "icon", icon: "tumble-ok", x: 42, y: 5, hMm: 8, rot: 90 },
  ] };
  const zplIcon = await emitCanvasZpl(mk({ layout: iconLayout }));
  // PPLB ikon GW binary → yalnız binary-güvenli tüketicide (iconGraphicsOk: b64/preview/bayt).
  const pplbIcon = emitCanvasPplb(mk({ layout: iconLayout, iconGraphicsOk: true }));
  const pplbIconText = emitCanvasPplb(mk({ layout: iconLayout })); // ham text yolu (bayrak yok)
  const pplaIcon = emitCanvasPpla(mk({ layout: iconLayout }));
  const htmlIcon = buildCanvasLabelHtml({ ...mk({ layout: iconLayout }), barcodeSvg: "<svg viewBox=\"0 0 1 1\"></svg>", qrSvg: "<svg viewBox=\"0 0 1 1\"></svg>" });
  check("ikon ZPL: ^GFA inline grafik (2 ikon)", (zplIcon.match(/\^GFA,/g) ?? []).length === 2);
  // 8mm@203dpi = 64 dot kare → rowBytes 8, toplam 8×64=512 bayt.
  check("ikon ZPL: ^GFA boyut doğru (512,512,8)", zplIcon.includes("^GFA,512,512,8,"));
  check("ikon ZPL: rot=90 ayak izi AYNI (ikinci ^GFA da 512 bayt)", (zplIcon.match(/\^GFA,512,512,8,/g) ?? []).length === 2);
  // PPLB: icon → GW inline grafik (metin/barkod native). 8mm=64dot kare → rowBytes 8,
  // height 64. ic1 x=30→240, y=5→40; QR (b24,320) yine üretildi (çökmedi). Binary blok
  // latin1 ile gömülü → transport bayt round-trip (Buffer uzunluğu ≥ 2×512).
  check("ikon PPLB: 2 GW bloğu (8,64) + ilk ic1 GW240,40", (pplbIcon.match(/GW\d+,\d+,8,64,/g) ?? []).length === 2 && pplbIcon.includes("GW240,40,8,64,"));
  check("ikon PPLB: QR bozulmadan üretildi (b24,320,Q)", pplbIcon.includes("b24,320,Q,"));
  check("ikon PPLB: binary latin1 gömülü (bayt ≥ 1024)", Buffer.from(pplbIcon, "latin1").length > 1024);
  // GATE: bayrak yok (ham text yolu) → ikon ATLANIR, GW/binary yok, QR temiz ASCII kalır
  // (UTF-8 decode eden eski istemcide bozulma önlenir). Regresyon koruması.
  check("ikon PPLB gate: iconGraphicsOk yok → GW yok (text-güvenli)", !/GW\d+,\d+,8,64,/.test(pplbIconText) && pplbIconText.includes("b24,320,Q,"));
  check("ikon PPLB gate: bayraksız çıktı salt-ASCII (>0x7F yok)", [...pplbIconText].every((c) => c.charCodeAt(0) < 128));
  check("ikon PPLA: iz yok + çökmedi (QR var)", !/1Y/.test(pplaIcon) && pplaIcon.includes("1W1d"), "1Y=DPL grafik kaydı (PPLA hâlâ skip)");
  check("ikon HTML: SVG gömülü (2 ikon)", (htmlIcon.match(/<svg/g) ?? []).length >= 2);
  // Kill-switch emsali: GW polaritesi/varlığı raster zarfıyla TEK KAYNAK (pplbGwBlock).
  // native-preview PPLB: GW header'ından ikon ayak izi placeholder'ı çizilir.
  const pplbIconSvg = renderPplbToSvg(pplbIcon);
  // Önizleme = baskı: GW blokları GERÇEK BMP <image>'e çözülür (placeholder DEĞİL). İkon
  // BMP (data:image/bmp) ×2; QR ayrı (data:image/svg+xml) → yalnız bmp'leri say.
  check("ikon PPLB önizleme: 2 GW ikonu BMP olarak çizildi", !!pplbIconSvg && (pplbIconSvg.match(/data:image\/bmp/g) ?? []).length === 2);
  check("ikon PPLB önizleme: GW placeholder metni KALMADI", !!pplbIconSvg && !pplbIconSvg.includes(">GW</text>"));
  // Bilinmeyen ikon anahtarı (katalogdan kalkmış eski kayıt): emit SESSİZCE atlar.
  const ghostLayout: CanvasLayout = { v: 1, elements: [
    { id: "q6", type: "qr", x: 3, y: 40, scale: 4 },
    { id: "icx", type: "icon", icon: "yok-boyle-ikon", x: 30, y: 5, hMm: 8 },
  ] };
  const zplGhost = await emitCanvasZpl(mk({ layout: ghostLayout }));
  check("ikon ZPL: bilinmeyen anahtar sessiz atlanır", !zplGhost.includes("^GFA") && zplGhost.includes("^BQN"));

  // --- Medya komutları format profilinden ---
  check("PPLB: q/Q medya boyutu", pplb.includes("q799") && /Q480,16/.test(pplb));
  check("ZPL: ^PW/^LL", zpl.includes("^PW799") && zpl.includes("^LL480"));
  check("PPLA: STX M = TOF tavanı (gövde boyu değil; ≥5\" → 0500)", ppla.includes("\x02M0500"));
  check("kopya: P2 / Q0002 / ^PQ2", pplb.includes("P2") && ppla.includes("Q0002") && zpl.includes("^PQ2"));

  // --- groupId: editör grubu — JSON'da taşınır, emit'i ETKİLEMEZ (passthrough) ---
  const grpLayout: CanvasLayout = { v: 1, elements: [
    { id: "gq", type: "qr", x: 3, y: 3, scale: 6, groupId: "grp-1" } as unknown as CanvasLayout["elements"][number],
    { id: "gt", type: "field", bind: "itemName", x: 30, y: 3, font: "lg", bold: true, groupId: "grp-1" } as unknown as CanvasLayout["elements"][number],
  ] };
  const plainLayout: CanvasLayout = { v: 1, elements: [
    { id: "gq", type: "qr", x: 3, y: 3, scale: 6 },
    { id: "gt", type: "field", bind: "itemName", x: 30, y: 3, font: "lg", bold: true },
  ] };
  check("groupId: emit BAYT-AYNI (passthrough, çıktı etkilenmez)", emitCanvasPplb(mk({ layout: grpLayout })) === emitCanvasPplb(mk({ layout: plainLayout })));
  check("groupId: validate kabul", validateCanvasLayout(grpLayout, { widthMm: 100, heightMm: 60 }).elements.length === 2);

  // --- Çok satırlı Sabit Metin: `\n` → alt alta ayrı satır komutları (5 dilde ortak) ---
  const mlLayout: CanvasLayout = { v: 1, elements: [
    { id: "mlq", type: "qr", x: 3, y: 40, scale: 4 },
    { id: "mlt", type: "text", text: "SATIR1\nSATIR2\nSATIR3", x: 10, y: 5, hMm: 4 },
  ] };
  const pplbMl = emitCanvasPplb(mk({ layout: mlLayout }));
  const zplMl = await emitCanvasZpl(mk({ layout: mlLayout }));
  const htmlMl = buildCanvasLabelHtml({ ...mk({ layout: mlLayout }), copies: 1, barcodeSvg: "<svg viewBox=\"0 0 1 1\"></svg>", qrSvg: "<svg viewBox=\"0 0 1 1\"></svg>" });
  check("çok satır PPLB: 3 ayrı satır komutu", pplbMl.includes(',N,"SATIR1"') && pplbMl.includes(',N,"SATIR2"') && pplbMl.includes(',N,"SATIR3"'));
  const mlYs = [...pplbMl.matchAll(/A\d+,(\d+),\d+,\d+,\d+,\d+,N,"SATIR\d"/g)].map((m) => +m[1]);
  check("çok satır PPLB: y ARTAN (alt alta)", mlYs.length === 3 && mlYs[0] < mlYs[1] && mlYs[1] < mlYs[2]);
  check("çok satır ZPL: 3 ayrı ^FD", (zplMl.match(/\^FDSATIR\d\^FS/g) ?? []).length === 3);
  check("çok satır HTML: 3 satır div'i", (htmlMl.match(/>SATIR\d</g) ?? []).length === 3);
  // Tek satırlı metin `\n` yoksa BAYT-AYNI (genişletme yalnız çok satırda).
  const oneLine: CanvasLayout = { v: 1, elements: [
    { id: "mlq", type: "qr", x: 3, y: 40, scale: 4 },
    { id: "mlt", type: "text", text: "TEK", x: 10, y: 5, hMm: 4 },
  ] };
  check("tek satır: genişletme yok (bayt-uyum)", emitCanvasPplb(mk({ layout: oneLine })).includes(',N,"TEK"'));

  // --- Metin hizalama (çapa=x): center/right x'i sola çeker; left = çapa (bayt-aynı) ---
  const alignLayout = (align: string): CanvasLayout => ({ v: 1, elements: [
    { id: "aq", type: "qr", x: 3, y: 40, scale: 4 },
    { id: "at", type: "text", text: "ABCD", x: 50, y: 5, hMm: 4, align } as unknown as CanvasLayout["elements"][number],
  ] });
  const noAlign: CanvasLayout = { v: 1, elements: [
    { id: "aq", type: "qr", x: 3, y: 40, scale: 4 },
    { id: "at", type: "text", text: "ABCD", x: 50, y: 5, hMm: 4 },
  ] };
  const xOfAbcd = (s: string): number => { const m = s.match(/A(\d+),\d+,0,\d+,\d+,\d+,N,"ABCD"/); return m ? +m[1] : -1; };
  const xLeft = xOfAbcd(emitCanvasPplb(mk({ layout: alignLayout("left") })));
  const xCenter = xOfAbcd(emitCanvasPplb(mk({ layout: alignLayout("center") })));
  const xRight = xOfAbcd(emitCanvasPplb(mk({ layout: alignLayout("right") })));
  check("hizala: right < center < left (center/right sola çeker)", xRight >= 0 && xRight < xCenter && xCenter < xLeft);
  check("hizala: left = çapa (x=d(50)=400)", xLeft === 400);
  check("hizala: align yok = left BAYT-AYNI", emitCanvasPplb(mk({ layout: noAlign })) === emitCanvasPplb(mk({ layout: alignLayout("left") })));

  // --- Harf dönüşümü (textCase): BÜYÜK/küçük — native + ZPL + HTML tek metin ---
  const caseLayout = (textCase?: string): CanvasLayout => ({ v: 1, elements: [
    { id: "cq", type: "qr", x: 3, y: 40, scale: 4 },
    { id: "ct", type: "text", text: "Roll Kod", x: 10, y: 5, hMm: 4, ...(textCase ? { textCase } : {}) } as unknown as CanvasLayout["elements"][number],
  ] });
  const caseUpperPplb = emitCanvasPplb(mk({ layout: caseLayout("upper") }));
  const caseLowerPplb = emitCanvasPplb(mk({ layout: caseLayout("lower") }));
  const caseUpperZpl = await emitCanvasZpl(mk({ layout: caseLayout("upper") }));
  const caseUpperHtml = buildCanvasLabelHtml({ ...mk({ layout: caseLayout("upper") }), copies: 1, barcodeSvg: "<svg viewBox=\"0 0 1 1\"></svg>", qrSvg: "<svg viewBox=\"0 0 1 1\"></svg>" });
  check("textCase upper: PPLB büyük harf", caseUpperPplb.includes(',N,"ROLL KOD"'));
  check("textCase lower: PPLB küçük harf", caseLowerPplb.includes(',N,"roll kod"'));
  check("textCase upper: ZPL büyük harf", caseUpperZpl.includes("^FDROLL KOD^FS"));
  check("textCase upper: HTML büyük harf", caseUpperHtml.includes(">ROLL KOD<"));
  check("textCase yok = BAYT-AYNI", emitCanvasPplb(mk({ layout: caseLayout() })).includes(',N,"Roll Kod"'));

  // --- present:false alan atlanır, DİĞER elemanlar kaymaz ---
  const noCust = { ...payload, customerName: null } as unknown as LabelPayload;
  const pplbNC = emitCanvasPplb(mk({ payload: noCust }));
  // PPLB cp1254: müşteri satırı "Müþteri: ..." baytıyla yazılır (asciiFold değil).
  check("present:false: müşteri satırı yok", !pplbNC.includes("Müþteri"));
  const linesWith = pplb.split("\r\n").filter((l) => !l.includes("Müþteri"));
  const linesWithout = pplbNC.split("\r\n");
  check("present:false: diğer satırlar BAYT-AYNI (kayma yok)", linesWith.join("|") === linesWithout.join("|"));

  // --- HTML: mutlak konum + UTF-8 (native'de asciiFold, HTML'de tam Türkçe) ---
  check("HTML: mutlak konum mm", html.includes("left:30mm") && html.includes("top:3mm"));
  // ORTAK PAYDA: HTML de native ile AYNI metni basar (Türkçe ASCII'ye katlanır)
  // — eleman dilden dile farklı çıktı vermez (kullanıcı kararı).
  check("HTML: metin native ile aynı (ASCII katlama)", html.includes("Sahin Tekstil") && html.includes("SABIT NOT") && !html.includes("Şahin"));
  check("HTML: @page medya boyutu", html.includes("size: 100mm 60mm"));
  check("HTML: kopya=2 sayfa", (html.match(/page-break-after/g) ?? []).length === 1);
  check("HTML: line/box div'leri", html.includes("background:#000") && html.includes("border:1mm solid #000"));

  // --- validateCanvasLayout kuralları ---
  const canvas = { widthMm: 100, heightMm: 60 };
  const okLayout = validateCanvasLayout(layout, canvas);
  check("validate: geçerli yerleşim kabul", okLayout.elements.length === layout.elements.length);
  const expectBad = (label: string, raw: unknown) => {
    try {
      validateCanvasLayout(raw, canvas);
      check(label, false, "hata beklenirdi");
    } catch (e) {
      check(label, e instanceof CanvasValidationError, e instanceof Error ? e.message : String(e));
    }
  };
  expectBad("validate: taranabilir alan zorunlu", { v: 1, elements: [{ id: "a", type: "text", text: "x", x: 1, y: 1 }] });
  expectBad("validate: tekrarlanan id red", { v: 1, elements: [
    { id: "a", type: "qr", x: 1, y: 1 }, { id: "a", type: "text", text: "x", x: 1, y: 1 },
  ] });
  expectBad("validate: tuval dışı x red", { v: 1, elements: [{ id: "a", type: "qr", x: 150, y: 1 }] });
  expectBad("validate: geçersiz font red", { v: 1, elements: [
    { id: "a", type: "qr", x: 1, y: 1 }, { id: "b", type: "text", text: "x", x: 1, y: 1, font: "xxl" },
  ] });
  expectBad("validate: bilinmeyen tip red", { v: 1, elements: [{ id: "a", type: "image", x: 1, y: 1 }] });
  expectBad("validate: groupId sayı red", { v: 1, elements: [{ id: "a", type: "qr", x: 1, y: 1, groupId: 5 }] });
  expectBad("validate: locked sayı red", { v: 1, elements: [{ id: "a", type: "qr", x: 1, y: 1, locked: 1 }] });
  check("validate: locked+groupId (editör meta) kabul", validateCanvasLayout({ v: 1, elements: [
    { id: "a", type: "qr", x: 1, y: 1, locked: true, groupId: "g1" },
  ] }, { widthMm: 100, heightMm: 60 }).elements.length === 1);
  expectBad("validate: geçersiz align red", { v: 1, elements: [
    { id: "a", type: "qr", x: 1, y: 1 }, { id: "b", type: "text", text: "x", x: 1, y: 1, align: "orta" },
  ] });
  expectBad("validate: geçersiz textCase red", { v: 1, elements: [
    { id: "a", type: "qr", x: 1, y: 1 }, { id: "b", type: "text", text: "x", x: 1, y: 1, textCase: "üst" },
  ] });
  expectBad("validate: bant wr aralık dışı red", { v: 1, elements: [
    { id: "a", type: "qr", x: 1, y: 1 }, { id: "b", type: "lengthBanner", x: 1, y: 1, wr: 9 },
  ] });
  expectBad("validate: bant glyphHMm aralık dışı red", { v: 1, elements: [
    { id: "a", type: "qr", x: 1, y: 1 }, { id: "b", type: "lengthBanner", x: 1, y: 1, glyphHMm: 40 },
  ] });
  const okBanner = validateCanvasLayout({ v: 1, elements: [
    { id: "a", type: "qr", x: 1, y: 1 }, { id: "b", type: "lengthBanner", x: 1, y: 1, unit: false, glyphHMm: 4, wr: 2 },
  ] }, canvas);
  check("validate: bant unit/glyphHMm/wr kabul", okBanner.elements.length === 2);

  // --- İkon doğrulama + STATİK etiket (requireScannable) ---
  expectBad("validate: bilinmeyen ikon anahtarı red", { v: 1, elements: [
    { id: "a", type: "qr", x: 1, y: 1 }, { id: "b", type: "icon", icon: "yok-boyle-ikon", x: 1, y: 1 },
  ] });
  expectBad("validate: ikon hMm aralık dışı red", { v: 1, elements: [
    { id: "a", type: "qr", x: 1, y: 1 }, { id: "b", type: "icon", icon: "wash-no", x: 1, y: 1, hMm: 60 },
  ] });
  const okIcon = validateCanvasLayout({ v: 1, elements: [
    { id: "a", type: "qr", x: 1, y: 1 }, { id: "b", type: "icon", icon: "wash-no", x: 1, y: 1, hMm: 8, rot: 90 },
  ] }, canvas);
  check("validate: ikon (hMm+rot) kabul", okIcon.elements.length === 2);
  // Taranabilirsiz statik yerleşim: varsayılan (requireScannable yok) → RED (geri
  // uyum); requireScannable:false → KABUL (atanmamış havuz şablonu / önizleme yolu).
  const staticLayout = { v: 1, elements: [
    { id: "t", type: "text", text: "YIKAMA TALİMATI", x: 1, y: 1 },
    { id: "i", type: "icon", icon: "wash-no", x: 1, y: 10 },
  ] };
  expectBad("validate: statik yerleşim VARSAYILANDA red (taranabilir zorunlu)", staticLayout);
  const okStatic = validateCanvasLayout(staticLayout, { ...canvas, requireScannable: false });
  check("validate: statik yerleşim requireScannable:false ile kabul", okStatic.elements.length === 2);
  check("readCanvasLayout: çöp → null", readCanvasLayout({ foo: 1 }) == null && readCanvasLayout(null) == null);
  check("readCanvasLayout: geçerli → layout", readCanvasLayout(layout)?.elements.length === layout.elements.length);

  // --- native-preview PPLA fix'leri: rot parse + QR mag komuttan ---
  const svg = renderPplaToSvg(ppla, 799);
  check("preview PPLA: SVG üretildi", !!svg);
  check("preview PPLA: rotasyonlu metin çizildi", !!svg && svg.includes("rotate(90"));
  // QR footprint = SEMBOL modülleri × mag (sessiz bölge kutuya EKLENMEZ — basılan kara
  // alan; beyaz sessiz bölge görsel boşluk kalır). 21 modül × 6 = 126.
  check("preview PPLA: QR boyutu mag=6'dan (sembol 21×6=126)", !!svg && svg.includes('width="126"'));
}

main()
  .then(() => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exit(fail > 0 ? 1 : 0);
  })
  .catch((e) => {
    console.error("HATA:", e);
    process.exit(1);
  });
