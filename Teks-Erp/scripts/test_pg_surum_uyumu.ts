// =============================================================================
// BEKÇİ — PostgreSQL İSTEMCİ ↔ SUNUCU SÜRÜM UYUMU (saf çekirdek)
// =============================================================================
// Çalıştır: npx tsx scripts/run-all-tests.ts pg_surum_uyumu
//
// ⭐ NEDEN VAR (ölçüldü 2026-09-13): `pgTool()` `PG_BIN_DIR` yoksa PATH'e düşer
// ve istemci ↔ sunucu uyumu HİÇBİR YERDE ölçülmüyordu. Ölçülen arıza: istemci
// 18.6 ↔ sunucu 16.15 → `pg_restore` "unrecognized configuration parameter
// transaction_timeout" (PG17+) ile düşüyor. Uyumsuz istemciyle alınan yedek
// BUGÜN sorunsuz görünür, LAZIM OLDUĞU GÜN açılmaz. Fabrikanın sunucusu 16.15.
//
// ⚠️ ENJEKSİYONLA KURULUR: `surumUyumu()` SAF bir karar — süreç doğurmaz, DB'ye
// gitmez. Bekçi sürüm çiftlerini ELLE verir ⇒ gerçek bir PG 18 kurulumu GEREKMEZ.
// Aksi hâlde bu bekçi "yalnız bir makinede koşan" sınıfına düşerdi (o sınıf
// 2026-09-13'te ölçüldü: `update-feed-url` sertifika yüklemi).
//
// ⚠️ ÜÇ SONUÇ, İKİ DEĞİL — "araç YOK" ile "araç UYUMSUZ" aynı şey DEĞİLDİR:
//   uyumlu       → sessiz geçer
//   istemci-yeni → YEDEK yolunda fail-closed, GERİ YÜKLEME yolunda uyarı+devam
//   ölçülemedi   → hiçbir yolu durdurmaz, İZ bırakır
// Ortadakini "uyumsuz" saymak, aracı olmayan HER kurulumda yedeği durdururdu —
// kapı, çözmeye çalıştığından büyük bir arıza üretirdi.
//
// DB gerektirmez. jest/vitest YOK (CLAUDE.md).
// =============================================================================
import {
  istemciAnaSurumu,
  sunucuSurumNumarasi,
  surumUyumu,
  surumUyumuMetni,
  surumUyumuOlc,
} from "../src/services/helpers/pg-tool.helper";

let pass = 0, fail = 0;
function check(l: string, ok: boolean, x = ""): void {
  if (ok) { pass++; console.log(`  ✓ ${l}${x ? ` — ${x}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${l}${x ? ` — ${x}` : ""}`); }
}

// ═══ §1 — SÜRÜM METNİ ÇÖZÜMLEME ══════════════════════════════════════════════
console.log("=== BEKÇİ: PostgreSQL sürüm uyumu ===\n── §1 metin çözümleme ──");
check("§1a `pg_dump (PostgreSQL) 18.6` → 18", istemciAnaSurumu("pg_dump (PostgreSQL) 18.6") === 18);
check("§1b `pg_restore (PostgreSQL) 16.15` → 16", istemciAnaSurumu("pg_restore (PostgreSQL) 16.15") === 16);
check("§1c yama hanesiz `psql (PostgreSQL) 17` → 17", istemciAnaSurumu("psql (PostgreSQL) 17") === 17);
check("§1d boş/okunamaz → null (UYUMSUZ değil, ÖLÇÜLEMEDİ)", istemciAnaSurumu("") === null && istemciAnaSurumu(null) === null);
check("§1e çöp metin → null", istemciAnaSurumu("command not found") === null);

// ═══ §2 — KARAR: üç sonuç ════════════════════════════════════════════════════
console.log("\n── §2 karar (enjekte edilmiş çiftler) ──");
const uAyni = surumUyumu(16, 160015);   // istemci 16 ↔ sunucu 16.15
const uYeni = surumUyumu(18, 160015);   // ÖLÇÜLEN ARIZA
const uEski = surumUyumu(16, 180006);   // istemci ESKİ — bizim yönümüzde ihlal DEĞİL
const uYok   = surumUyumu(null, 160015); // araç yok
const uSrvYok = surumUyumu(18, null);    // sunucu okunamadı

check("§2a uyumlu çift (16 ↔ 16) → uyumlu", uAyni.sonuc === "uyumlu", JSON.stringify(uAyni));
check("§2b ⭐ ÖLÇÜLEN ARIZA (18 ↔ 16) → istemci-yeni", uYeni.sonuc === "istemci-yeni", JSON.stringify(uYeni));
check("§2c istemci ESKİ (16 ↔ 18) → uyumlu (ihlal YÖNLÜDÜR)", uEski.sonuc === "uyumlu", JSON.stringify(uEski));
check("§2d ⭐ araç YOK → 'ölçülemedi' (uyumsuz DEĞİL)", uYok.sonuc === "olculemedi", JSON.stringify(uYok));
check("§2e sunucu okunamadı → 'ölçülemedi'", uSrvYok.sonuc === "olculemedi", JSON.stringify(uSrvYok));
check("§2f sunucu numarası ana sürüme çevriliyor (160015 → 16)",
  uAyni.sonuc === "uyumlu" && uAyni.sunucu === 16, JSON.stringify(uAyni));

// ═══ §3 — İZ: "uyardım" okunabilir olmalı ════════════════════════════════════
console.log("\n── §3 iz metni ──");
const izYedek = surumUyumuMetni(uYeni, "yedek");
const izOlcmedi = surumUyumuMetni(uYok, "geri-yükleme");
check("§3a ⭐ iz HER İKİ SÜRÜMÜ de basar (soyut uyarı yetmez)",
  izYedek.includes("18") && izYedek.includes("16"), izYedek.slice(0, 90));
check("§3b iz HANGİ YOLU söyler", izYedek.includes("yedek") && izOlcmedi.includes("geri-yükleme"));
check("§3c iz ÇÖZÜMÜ söyler (PG_BIN_DIR)", izYedek.includes("PG_BIN_DIR"));
check("§3d 'ölçülemedi' izi yolu DURDURMADIĞINI söyler",
  /devam ediyor/i.test(izOlcmedi) && /GARANTİ EDİLMİYOR/i.test(izOlcmedi), izOlcmedi.slice(0, 90));

// ═══ §4 — YÖN: tek yönlü olduğu KİLİTLENİR ═══════════════════════════════════
// Kapsam başlıkta yazılı: dump+restore AYNI sürüm ailesine dönüyor. Biri genel
// PG tavsiyesini okuyup yönü "düzeltirse" bu satır kırmızı verir.
console.log("\n── §4 yön kilidi ──");
check("§4 ⭐ ihlal YALNIZ istemci > sunucu yönünde",
  surumUyumu(18, 160015).sonuc === "istemci-yeni" && surumUyumu(16, 180006).sonuc === "uyumlu");

async function main(): Promise<void> {
  // ═══ §5 — BİRLEŞTİRİCİ: okuyucular ENJEKTE, ortam GEREKMEZ ═══════════════════
  // Çağrı yerlerinin gerçekten kullandığı dal burasıdır. Enjeksiyonla basılmazsa
  // ürün kodunun bu parçası hiç ölçülmemiş olurdu (basılmayan dalın yeşili kapsam
  // değildir).
  console.log("\n── §5 birleştirici (enjekte okuyucular) ──");
  const oku = (v: number | null) => async (): Promise<number | null> => v;
  const firlat = (m: string) => async (): Promise<number | null> => {
    throw new Error(m);
  };

  const b1 = await surumUyumuOlc(oku(16), oku(160015));
  check("§5a uyumlu çift → uyumlu", b1.sonuc === "uyumlu", JSON.stringify(b1));

  const b2 = await surumUyumuOlc(oku(18), oku(160015));
  check("§5b ⭐ uyumsuz çift YAKALANIR", b2.sonuc === "istemci-yeni", JSON.stringify(b2));

  const b3 = await surumUyumuOlc(firlat("pg_dump: ENOENT"), oku(160015));
  check("§5c ⭐ istemci okuyucusu FIRLATTI → ölçülemedi (uyumsuz DEĞİL)", b3.sonuc === "olculemedi", JSON.stringify(b3));
  check("§5d ⭐ fırlatan okuyucunun SEBEBİ ize yazılır (yokluğa mekanizma atfedilmez)",
    b3.sonuc === "olculemedi" && b3.sebep.includes("ENOENT"), b3.sonuc === "olculemedi" ? b3.sebep : "");

  const b4 = await surumUyumuOlc(oku(18), firlat("DB kapalı"));
  check("§5e sunucu okuyucusu fırlattı → ölçülemedi + sebep",
    b4.sonuc === "olculemedi" && b4.sebep.includes("DB kapalı"), JSON.stringify(b4));

  const b5 = await surumUyumuOlc(oku(null), oku(160015));
  check("§5f okuyucu null döndü (fırlatmadan) → ölçülemedi", b5.sonuc === "olculemedi", JSON.stringify(b5));

  // ═══ §6 — SUNUCU SÜRÜM METNİ ═════════════════════════════════════════════════
  console.log("\n── §6 sunucu sürüm numarası ──");
  check("§6a `160015` → 160015", sunucuSurumNumarasi("160015") === 160015);
  check("§6b boşluklu → sayı", sunucuSurumNumarasi(" 180006 ") === 180006);
  check("§6c null/boş/çöp → null (ölçülemedi)",
    sunucuSurumNumarasi(null) === null && sunucuSurumNumarasi("") === null && sunucuSurumNumarasi("abc") === null);
  check("§6d `0` → null (sıfır bir sürüm değildir)", sunucuSurumNumarasi("0") === null);

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

void main();
