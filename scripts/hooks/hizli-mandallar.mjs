#!/usr/bin/env node
// =============================================================================
// HIZLI MANDALLAR — commit kapısının 5. adımı (zero-dep, Node ESM)
// =============================================================================
// Çalıştır: node scripts/hooks/hizli-mandallar.mjs        (kök dizinden; kapı çağırır)
// Çıkış: 0 = hepsi yeşil ya da ⏭ beyanla atlandı · 1 = en az bir mandal kırmızı
//
// ⭐ NEDEN VAR (2026-09-13, 1e hükmü): commit kapısı BEKÇİ koşmaz; mandallar
//    (cırcır/tarayıcı) yalnız CI'da ısırıyordu — `test_keyfi_arama` bir commit'in
//    iki yeni keyfi çiftini kapıda değil CI'da gördü. "Bunu biliyorum" bir kapı
//    değildir; kendine uygulanmayan kural için tek çare kapıdır.
//
// KÜME (ölçüldü 2026-09-13, d5): 534 bekçinin 105'i DB'siz geçiyor, 95'i ≤5 sn;
//    bunların `Teks-Erp/scripts/` | `docs/standart/` | `docs/kurallar/`ı KONU
//    edinen 12'si burada (+13. `belge_capa_atfi` · 14. `gun_anahtari_kaynagi` · 15. `yerel_ayar_bagimliligi` · 16. `harita_sonda_atfi` · 17. `fikstur_sabit_ad` · 18. `lookup_beyan_aynasi` · 19. `sha_atfi` · 20. `audit_muafiyeti`, 2026-09-14 · 21. `rapor_katalogu` · 22. `rapor_kapisi` · 23. `finans_rapor_eksenleri`, 2026-09-15 · 24. `migration_order` · 25. `seri_modul_yuklemesi`, 2026-09-23). Küme ELLE listelenir — "scripts/ altında DB'siz olan
//    her şey" gibi türetilmiş bir kapsam, DB'siz görünen ama vakumen yeşil kalan
//    bekçiyi de (0/0, çıkış 0 — iki emsal var) kapıya sokardı.
//
// ⚠️ DB'SİZLİK YAPISAL: DATABASE_URL ulaşılamaz bir adrese ÇEVRİLİR. Bir mandal
//    yarın DB'ye uzanırsa kapıda KIRMIZI düşer — sessizce dev DB'ye dokunmaz.
//
// ⚠️ EŞZAMANLILIK 4 (1e hükmü): 12 süreç birden, üç oturumun kapısı aynı anda
//    koşarken bir OOM üretti (ısırık #8). Ölçüm: 12 sıralı 16–23 sn (yük altında),
//    12 paralel 6,4 sn; 4'lü ≈ 7 sn, bütçe 15 sn.
//
// ⚠️ YALNIZ İZOLE AĞAÇTA (`.git/worktrees/` altı): 12'nin 9'u AĞAÇTAN okur; ortak
//    ağaçta BAŞKASININ commit'siz dosyasındaki ihlal bizi durdururdu (2026-09-13
//    gecesi identifier_language'da tam bu oldu). Ortak ağaçta ⏭ — ama SESSİZ DEĞİL:
//    kapsam kaybı tek satırla duyurulur (ölüm biçimi ⑪), CI ısırır.
// =============================================================================
import { spawn, execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BACKEND = join(REPO, "Teks-Erp");
const ESZAMANLI = 4;

/** Ad · okuduğu · kaynak (ağaç/INDEX) — sıra pahalıdan ucuza (uzun iş önce başlar). */
const MANDALLAR = [
  "test_kapi_kapsami", // 3 proje kapı config · ağaç · 2,7–4,8 sn
  "test_borc_notu_bicimi", // docs/kurallar · INDEX
  "test_kural_bekci_atfi", // docs/kurallar + scripts · INDEX
  "test_identity_ledger", // scripts + src + docs · INDEX
  "test_atlama_defteri", // lib birimi
  "test_kimlik_sizintisi", // scripts + src + docs · ağaç
  "test_ortam_bagimliligi_tavani", // scripts · ağaç
  "test_devralinan_tavan", // docs/standart + src · ağaç
  "test_olcum_iddiasi", // scripts + docs · ağaç (taban dosya-kümesi)
  "test_bekci_sozlesmesi", // scripts · ağaç
  "test_negatif_sonda_kapsami", // scripts · ağaç
  "test_keyfi_arama", // scripts · ağaç (dosya::model mandalı)
  "test_belge_capa_atfi", // tüm takipli *.md `X.md § N` çapaları · ağaç · 1,3–2,4 sn (13., 1e hükmü 2026-09-14)
  "test_gun_anahtari_kaynagi", // src+scripts gün anahtarı tek kaynak (ANAHTAR sert · gösterim cırcır) · ağaç+others · 0,6 sn (14., 2026-09-14)
  "test_yerel_ayar_bagimliligi", // src+scripts toLocale*/Intl yerel bağımlılığı (§1 sert + iki cırcır) · ağaç+others · 0,7 sn (15., 2026-09-14)

  "test_harita_sonda_atfi", // BEKCI-HARITASI "Negatif sonda" hücresi: ✓B sha atfı sert · düz ✓ cırcır · INDEX · 0,5 sn (16., 2026-09-14)

  "test_fikstur_sabit_ad", // scripts/test_* fikstürlerinde SABİT ad/kod (P2002 maskesi) · ağaç+others · ~1,5 sn · taban 0 sert (17., d9 yazdı, 2026-09-14)
  "test_lookup_beyan_aynasi", // import LOOKUP_SOURCES beyanı ↔ resolveReference çağrıları · src (import-lookup + tüm src taraması) · ağaç+others · 0,4–1,2 sn · taban 0 sert (18., d9 yazdı, 2026-09-14)
  "test_sha_atfi", // belgelerde backtick'li ÖLÜ sha atfı (git cat-file) · Teks-Erp/scripts + docs + Teks-Erp/docs · 0,4–0,7 sn · taban 0 sert; sığ klonda ⏭ sayıyla (19., d9 yazdı, 2026-09-14)
  "test_audit_muafiyeti", // "her CUD → audit" istisnaları BEYANLI (AUDIT_EXEMPT_MODELS kapalı küme) · src/services + routes + helpers/jobs · ağaç · 0,7 sn · §2 sert + §7 dosya cırcırı (20., d9 yazdı, 2026-09-14)
  "test_rapor_katalogu", // REPORT_CATALOG ⇄ backend route · panel route · karo · SCREEN_CATALOG · Electron aynası (+ `varsayilanGun` çift yazımı) · src/constants + src/routes + Electron/src · ağaç · ~1,5 sn · taban 0 sert (21., d9 yazdı, 2026-09-15)
  "test_rapor_kapisi", // rapor kapısı: 29 uçta `requireReportOpen` · sıra · İKİ YÖNLÜ kapsama · süperadmin yazma kümesi · üç sonuç · src/middlewares + src/routes + src/services + src/jobs · ağaç · ~0,4 sn · statik kol DB'siz (canlı §7 sunucu yoksa ⏭ beyanla) (22., d9 yazdı, 2026-09-15)
  "test_finans_rapor_eksenleri", // finans rapor süzgeç sözleşmesi: eksen uca bağlı · kap koşullu · düşen satır sayılı · bakiye süzgeçten etkilenmez · src/routes + src/services · ağaç · ~0,3 sn · taban 0 sert (23., d9 yazdı, 2026-09-15)
  "test_migration_order", // prisma/migrations sırası: sonra doğan tabloya önce dokunma · DB'siz · 0,3 sn · taban 0 sert (24., 2026-09-23)
  "test_seri_modul_yuklemesi", // numara serisi çağrısı modül yüklenirken koşmaz (AST) · DB'siz · ~0,9 sn · taban 0 sert (25., 2026-09-23)
];

function izoleAgacMi() {
  try {
    const gitDir = execFileSync("git", ["rev-parse", "--git-dir"], { cwd: REPO, encoding: "utf8" }).trim();
    return gitDir.includes("/worktrees/");
  } catch {
    return false;
  }
}

function kos(ad) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const cp = spawn("npx", ["tsx", `scripts/${ad}.ts`], {
      cwd: BACKEND,
      env: {
        ...process.env,
        DATABASE_URL: "postgresql://mandal:mandal@127.0.0.1:1/mandal_test?schema=public",
        SKIP_TYPECHECK: "1",
        // Cırcırların ÇÜRÜME kolu (gerçek < taban) commit kapısında UYARI, CI'da sert —
        // sabiti yalnız entegratör yazar; borcu ödeyenin commit'i düşmesin (scripts/lib/circir-kolu.ts).
        TEKSERP_KAPI_ADIMI: "commit",
      },
    });
    let out = "";
    cp.stdout.on("data", (d) => (out += d));
    cp.stderr.on("data", (d) => (out += d));
    cp.on("close", (code) => resolve({ ad, code, out, sn: ((Date.now() - t0) / 1000).toFixed(1) }));
    cp.on("error", (e) => resolve({ ad, code: -1, out: String(e), sn: ((Date.now() - t0) / 1000).toFixed(1) }));
  });
}

async function main() {
  if (!izoleAgacMi()) {
    process.stderr.write(
      "   ⏭  hızlı mandallar ORTAK ağaçta atlandı (başkasının commit'siz dosyası bizi durdurmasın); CI'da ısırır\n",
    );
    process.exit(0);
  }
  const t0 = Date.now();
  const kuyruk = [...MANDALLAR];
  const sonuclar = [];
  const isci = async () => {
    for (let ad = kuyruk.shift(); ad; ad = kuyruk.shift()) sonuclar.push(await kos(ad));
  };
  await Promise.all(Array.from({ length: ESZAMANLI }, isci));

  const kirmizi = sonuclar.filter((s) => s.code !== 0);
  const toplam = ((Date.now() - t0) / 1000).toFixed(1);

  // Kırmızının KENDİ ❌ satırları aynen (dosya:satır orada) — ama yalnız onlar:
  // kapı koşucusu adım çıktısının SON 30 satırını gösterir; iki mandal birden
  // kırmızıysa ilkinin tam çıktısı pencereden düşer ve "hangisi" görünmez.
  // Özet tablo bu yüzden EN SONA basılır.
  for (const s of kirmizi) {
    const satirlar = s.out.split("\n").filter((l) => l.includes("❌") || l.includes("Sonuç:") || /error/i.test(l));
    process.stderr.write(`   ❌ ${s.ad} KIRMIZI (çıkış ${s.code}):\n`);
    process.stderr.write(satirlar.slice(-8).map((l) => `      | ${l.trim()}`).join("\n") + "\n");
  }
  for (const s of sonuclar.sort((a, b) => a.ad.localeCompare(b.ad))) {
    process.stderr.write(`      ${s.code === 0 ? "✅" : "❌"} ${s.ad} (${s.sn}s)\n`);
  }
  process.stderr.write(`      ${MANDALLAR.length} mandal · eşzamanlı ${ESZAMANLI} · duvar ${toplam}s · kırmızı ${kirmizi.length}\n`);
  process.exit(kirmizi.length === 0 ? 0 : 1);
}

main();
