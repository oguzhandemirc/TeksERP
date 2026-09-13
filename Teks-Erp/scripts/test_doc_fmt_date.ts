// =============================================================================
// test_doc_fmt_date — belge tarih yardımcısı TEK KAYNAK, biçim aynen (DB'siz)
// =============================================================================
// Koşum: npx tsx scripts/test_doc_fmt_date.ts
//   CI gibi: TZ=UTC npx tsx scripts/test_doc_fmt_date.ts
//
// On iki renderer'daki beş `fmtDate` varyantı `document-render/fmt-date.ts`te
// birleşti. İki iddia:
//   §1 BİÇİM AYNEN: İstanbul saat diliminde eski beş formülün çıktısı ile yeni
//      yardımcı, sabit an ızgarasında BYTE-BYTE aynı (boş/geçersiz girdi dahil).
//      Eski formüller burada REFERANS olarak duruyor — ürün kodunda değil.
//   §2 GÜN KAYNAĞI FABRİKA: `TZ=UTC` altında 21:30Z anı eski formülde bir gün
//      geri, yeni yardımcıda fabrika günü (`factoryYmd`); saat de fabrika saati.
// Negatif sonda: `fmtDate`i `getDate()` formülüne çevir → §2 `TZ=UTC` ile kırmızı;
// biçimi değiştir (örn. `/` ayırıcı) → §1 her TZ'de kırmızı.

import { fmtDate, fmtDateTime } from "../src/services/document-render/fmt-date";
import { FACTORY_TIMEZONE, factoryYmd } from "../src/constants/time";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}
const TZ = process.env.TZ ?? "(süreç)";
const p = (x: number) => String(x).padStart(2, "0");

// --- ESKİ FORMÜLLER (referans; on iki dosyadan birebir) ------------------------
const legacy = {
  // 8 dosya: fason-direct-ship · fason-receipt · free-document · kartela-ceki ·
  // quality-certificate · return-dispatch · shipment-dispatch · warehouse-doc
  bos(iso: string | null): string {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
  },
  // fason-ceki: string-only, boş dize fallback
  fasonCeki(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
  },
  // traveler-card (+raw): "—" fallback
  tire(iso: string | null | undefined, fallback = "—"): string {
    if (!iso) return fallback;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return fallback;
    return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
  },
  // finance-doc: toLocaleDateString("tr-TR")
  finance(v: string | null): string {
    if (!v) return "—";
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("tr-TR");
  },
  // traveler-card(+raw) fmtDateTime
  dateTime(iso: string | null | undefined): string {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  },
};

const grid = [
  "2026-09-14T09:05:00.000Z", // gün ortası
  "2026-09-13T21:30:00.000Z", // İstanbul 00:30 — kırmızı pencere
  "2026-09-13T20:59:59.000Z", // İstanbul 23:59:59
  "2026-01-05T00:00:00.000Z", // tek haneli gün/ay → sıfır dolgusu
  "2026-12-31T21:00:00.000Z", // yıl devri
  "2026-03-29T00:30:00.000Z", // eski DST tarihi — Türkiye'de DST yok
  "2026-06-15T12:34:56.789Z",
];

if (TZ === FACTORY_TIMEZONE) {
  // §1 — biçim aynen (yalnız fabrika diliminde anlamlı: eski formül süreç dilimini okur)
  for (const iso of grid) {
    check(`§1 boş-fallback ailesi @${iso}`, fmtDate(iso) === legacy.bos(iso), `${fmtDate(iso)} ↔ ${legacy.bos(iso)}`);
    check(`§1 fason-ceki @${iso}`, fmtDate(iso) === legacy.fasonCeki(iso));
    check(`§1 tire ailesi @${iso}`, fmtDate(iso, "—") === legacy.tire(iso));
    check(`§1 finance tr-TR @${iso}`, fmtDate(iso, "—") === legacy.finance(iso), `${fmtDate(iso, "—")} ↔ ${legacy.finance(iso)}`);
    check(`§1 tarih-saat @${iso}`, fmtDateTime(iso) === legacy.dateTime(iso), `${fmtDateTime(iso)} ↔ ${legacy.dateTime(iso)}`);
  }
  // boş / geçersiz girdi — her ailenin kendi fallback'i
  for (const bad of [null, undefined, "", "abc", "2026-13-45"] as const) {
    const b = bad as string | null | undefined;
    check(`§1 boş-fallback ailesi bozuk girdi ${JSON.stringify(bad)}`, fmtDate(b) === legacy.bos(b ?? null));
    check(`§1 tire ailesi bozuk girdi ${JSON.stringify(bad)}`, fmtDate(b, "—") === legacy.tire(b));
    check(`§1 finance bozuk girdi ${JSON.stringify(bad)}`, fmtDate(b, "—") === legacy.finance(b ?? null));
    check(`§1 tarih-saat bozuk girdi ${JSON.stringify(bad)}`, fmtDateTime(b) === legacy.dateTime(b));
  }
  check("§1 fason-ceki geçersiz dize", fmtDate("abc") === legacy.fasonCeki("abc"));
} else {
  console.log(`ℹ️ §1 (biçim aynen) yalnız TZ=${FACTORY_TIMEZONE} altında ölçülür; şu an TZ=${TZ}`);
}

// §2 — gün kaynağı fabrika (her TZ'de aynı sonuç vermeli)
for (const iso of grid) {
  const ymd = factoryYmd(new Date(iso));
  const expected = `${ymd.slice(8, 10)}.${ymd.slice(5, 7)}.${ymd.slice(0, 4)}`;
  check(`§2 fmtDate fabrika günü @${iso}`, fmtDate(iso) === expected, `${fmtDate(iso)} beklenen=${expected} TZ=${TZ}`);
  check(`§2 fmtDateTime günü fabrika @${iso}`, fmtDateTime(iso).startsWith(expected), fmtDateTime(iso));
}
check("§2 21:30Z → İstanbul 00:30 ertesi gün", fmtDateTime("2026-09-13T21:30:00Z") === "14.09.2026 00:30", fmtDateTime("2026-09-13T21:30:00Z"));
if (TZ === "UTC") {
  check(
    "§2 UTC'de eski formül bir gün GERİ, yeni yardımcı fabrika günü (kusurun kanıtı)",
    legacy.bos("2026-09-13T21:30:00Z") === "13.09.2026" && fmtDate("2026-09-13T21:30:00Z") === "14.09.2026"
  );
}

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
