// Raster dil zarfı testi (DB'siz): PPLB GW (polarite + ayraçsız + blok uzunluğu),
// ZPL ^GFA (hex + salt-ASCII + 1=siyah), PPLA unsupported (F0'a dek komuta düşer).
// Koş: npx tsx scripts/test_raster_envelope.ts

import { Bitmap1 } from "../src/services/helpers/raster/raster-bitmap";
import { wrapPplbRaster } from "../src/services/helpers/raster/raster-envelope-pplb";
import { wrapZplRaster } from "../src/services/helpers/raster/raster-envelope-zpl";
import { wrapPplaRaster, PplaRasterUnsupportedError } from "../src/services/helpers/raster/raster-envelope-ppla";
import type { ResolvedLabelFormat } from "../src/services/helpers/label-format.resolver";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

function fmt(language: string, mediaType: string | null = null): ResolvedLabelFormat {
  return {
    widthMm: 100, heightMm: 60, marginMm: 3,
    marginTopMm: 3, marginRightMm: 3, marginBottomMm: 3, marginLeftMm: 3, gapMm: 2,
    orientation: "LANDSCAPE" as never, dpi: 203, language: language as never,
    source: "machine" as never, mediaType: mediaType as never,
  };
}

// Küçük test bitmap'i: 16×4 → rowBytes=2, toplam 8 bayt.
function whiteBmp(): Bitmap1 { return new Bitmap1(16, 4); }
function blackBmp(): Bitmap1 { const b = new Bitmap1(16, 4); b.fillRect(0, 0, 16, 4); return b; }

// =============================================================================
// PPLB — GW
// =============================================================================
{
  const buf = wrapPplbRaster(whiteBmp(), fmt("PPLB"), 2);
  check("PPLB Buffer döner", Buffer.isBuffer(buf));
  const s = buf.toString("latin1");
  // q/Q FORMAT boyutundan (fiziksel etiket 100×60mm@203 = 799×480, gap 2mm=16);
  // GW imaj boyutu ise BİTMAP'ten (16×4) — ikisi ayrı (gerçek kullanımda eşit).
  check("PPLB N/q/Q/D8 header (format boyutu)", s.startsWith("N\r\nq799\r\nQ480,16\r\nD8\r\n"));
  check("PPLB GW başlığı (p4 sonrası virgül, rowBytes=2 h=4)", s.includes("GW0,0,2,4,"));
  check("PPLB P{copies} kuyruğu (clamp 2)", s.trimEnd().endsWith("P2"));

  // GW başlığı (p4 SONRASI VİRGÜL) sonrası 8 baytlık blok — Argox PPLB `GWp1,p2,p3,p4,DATA`.
  const marker = "GW0,0,2,4,";
  const at = buf.indexOf(Buffer.from(marker, "latin1"));
  const block = buf.subarray(at + marker.length, at + marker.length + 8);
  check("PPLB GW blok uzunluğu = rowBytes×h = 8", block.length === 8);
  // Polarite: iç beyaz (bit=0) → GW 1=beyaz konvansiyonu için INVERT → 0xFF.
  check("PPLB polarite: beyaz bitmap → blok 0xFF (invert)", block.every((b) => b === 0xff),
    "GW 1=beyaz varsayımı; F6.3 fiziksel teyit");
  const blockBlack = (() => {
    const b = wrapPplbRaster(blackBmp(), fmt("PPLB"), 1);
    const a = b.indexOf(Buffer.from(marker, "latin1"));
    return b.subarray(a + marker.length, a + marker.length + 8);
  })();
  check("PPLB polarite: siyah bitmap → blok 0x00", blockBlack.every((b) => b === 0x00));

  // Binary blok İÇİNE CRLF (0x0D0A) enjekte EDİLMEZ — blok tam 8 bayt, ardından \r\n gelir.
  const after = buf.subarray(at + marker.length + 8, at + marker.length + 10);
  check("PPLB blok sonrası \\r\\n (blok içine enjekte değil)", after[0] === 0x0d && after[1] === 0x0a);
}

// =============================================================================
// ZPL — ^GFA
// =============================================================================
{
  const buf = wrapZplRaster(blackBmp(), fmt("ZPL"), 3);
  const s = buf.toString("latin1");
  check("ZPL ^XA…^XZ çerçeve", s.startsWith("^XA") && s.trimEnd().endsWith("^XZ"));
  check("ZPL ^PW/^LL (799×480)", s.includes("^PW799") && s.includes("^LL480"));
  check("ZPL ^GFA param (total=8, rowBytes=2)", s.includes("^GFA,8,8,2,"));
  check("ZPL ^PQ{copies}", s.includes("^PQ3"));
  // ^GF 1=siyah → invert YOK: siyah bitmap → hex tümü FF.
  const m = s.match(/\^GFA,8,8,2,([0-9A-F]+)\^FS/);
  check("ZPL hex uzunluğu = 2×total = 16", !!m && m[1].length === 16, m ? `${m[1].length}` : "eşleşme yok");
  check("ZPL siyah bitmap → hex tümü FF (1=siyah, invert yok)", !!m && /^F+$/.test(m[1]));
  const white = wrapZplRaster(whiteBmp(), fmt("ZPL"), 1).toString("latin1").match(/\^GFA,8,8,2,([0-9A-F]+)\^FS/);
  check("ZPL beyaz bitmap → hex tümü 00", !!white && /^0+$/.test(white[1]));
  check("ZPL salt-ASCII (binary transport gerektirmez)", buf.every((b) => b < 0x80));
  // mediaType → ^MTT
  const tt = wrapZplRaster(blackBmp(), fmt("ZPL", "THERMAL_TRANSFER"), 1).toString("latin1");
  check("ZPL mediaType THERMAL_TRANSFER → ^MTT", tt.includes("^MTT"));
}

// =============================================================================
// PPLA — F0'a dek desteksiz (fırlatır → registry komuta düşer)
// =============================================================================
{
  let threw = false;
  let isTyped = false;
  try {
    wrapPplaRaster(blackBmp(), fmt("PPLA"), 1);
  } catch (e) {
    threw = true;
    isTyped = e instanceof PplaRasterUnsupportedError;
  }
  check("PPLA raster zarfı fırlatır (F0 bekliyor)", threw);
  check("PPLA hatası tipli (PplaRasterUnsupportedError)", isTyped);
}

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
