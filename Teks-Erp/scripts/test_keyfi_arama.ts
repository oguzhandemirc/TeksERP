// =============================================================================
// BEKÇİ — "ORTAMDA NE VARSA" ARAMASI ARTMAZ (mandal, `dosya::model`)
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts keyfi_arama
//
// ⭐ NEDEN VAR (6e'nin envanteri, 2026-09-13): bekçilerin bir kısmı fikstürünü
//    kurmak yerine ORTAMDA NE VARSA onu buluyor — `findFirst` ile "herhangi bir
//    aktif kayıt". Temiz bir CI DB'sinde bu ya düşer ya VAKUMEN yeşil kalır.
//    Ölçüldü 2026-09-13 (`npx tsx scripts/test_keyfi_arama.ts --yaz`): 912 çağrının
//    175'i keyfi, 122 dosyada, 173 (dosya, model) çifti.
//
// ⚠️ DÜZELTME TURU YOK — MANDAL (1e'nin hükmü). Ayırt edici ölçüt tek:
//    *bir borcun ÜRÜNDE bir kırılma üretip üretmediği.* 137 kalite literali
//    ürünü kırıyordu ⇒ dilim dilim düzeltildi; buradaki borç kırılma üretmiyor,
//    teşhis bulanıklığı üretiyor ⇒ mevcut küme DONDURULUR, yenisi girmez.
//    123 dosyaya dokunmak, çözdüğünden büyük risk.
//
// ⚠️ TANECİK `dosya::model` VE BU ÖLÇÜLEREK SEÇİLDİ (30 commit):
//      dosya::satır (çağrı)  940 → 912   kıpırdama 290   ⇒ REDDEDİLDİ
//      dosya::model          750 → 722   kıpırdama  28   ⇒ SEÇİLEN (YENİ üye 0)
//      dosya                 284 → 283   kıpırdama   1   ⇒ adres vermiyor
//    Çağrı taneciği her fikstür düzenlemesinde oynar, körü körüne güncellenir ve
//    kapı iki haftada ölür. Model taneciği 30 commit'te **sıfır yeni üye** verdi
//    — yani mandal bir kez bile yanlış ısırmazdı — ve adres kazandırıyor.
//    ⚠️ BEDELİ: aynı dosyada AYNI modele İKİNCİ bir keyfi çağrı eklemek mandalı
//    UYANDIRMAZ (üye sayısı artmaz). Beyan edilir, gizlenmez.
//    📌 *Tanecik KALEME özgüdür, kurala değil* — bu repoda üç kalem, üç tanecik.
//
// ⚠️ SINIFLANDIRICI TABANI KURMAZ, yalnız YENİ çağrıyı sınıflandırır. `IS_ANAHTARI`
//    ELLE kurulmuş bir allowlist'tir ve yeni bir anahtar alanı (`installationId`,
//    `deviceCode`) MEŞRU bir çağrıyı KEYFİ gösterirdi.
//      ⇒ Bu, *"düzeltmesi yasak olan ihlali gösteren kapı"nın bir adım incesi:
//        İHLAL OLMAYANI ihlal göstermek.* İlkinde kapı haklı ama çare yok;
//        ikincisinde kapı HAKSIZ ve düzeltme "muafiyet eklemek" gibi görünür —
//        o yol kapıyı bir LİSTEYE çevirir ve öldürür.
//
// ⚠️ TABAN AĞAÇ DAMGASI TAŞIR: taban `scripts/test_*.ts`ten türüyor ve o ağaç her
//    commit'te oynuyor. Benim `848f84f3` dilimim ~20 bekçiye dokundu ve 6e'nin
//    aynı aracı ölçtüğü tabanı 174→173 kaydırdı.
//      ⇒ *İki değişiklik hiçbir DOSYADA kesişmeden aynı ÖLÇÜMDE kesişebilir.*
//    Damga olmadan sonraki okuyan farkı "yeni ihlal" sanar.
// =============================================================================
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { KAPSAM_SERHI, kendiniSina, olcum } from "./lib/keyfi-arama-taramasi";

const SCRIPTS = __dirname;
const TABAN_DOSYA = join(SCRIPTS, "keyfi-arama-baseline.json");
const YAZ = process.argv.includes("--yaz");

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

function agacDamgasi(): string {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: SCRIPTS, encoding: "utf8" }).trim();
  } catch {
    return "?";
  }
}

function tabanYaz(uyeler: string[], o: ReturnType<typeof olcum>): void {
  writeFileSync(
    TABAN_DOSYA,
    `${JSON.stringify(
      {
        _not: "KEYFİ arama yapan (dosya, model) çiftleri — yalnız KÜÇÜLÜR. Ölçüm: --yaz",
        _agac: agacDamgasi(),
        _paydalar: { taranan: o.taranan, icerenDosya: o.icerenDosya, populasyon: o.populasyon },
        _keyfi: { cagri: o.keyfiCagri, dosya: o.keyfiDosya, uye: uyeler.length },
        uyeler,
      },
      null,
      2,
    )}\n`,
  );
}

function main(): void {
  console.log("=== Keyfi arama mandalı ===\n");

  // ⚠️ FAIL-CLOSED (1e onaylı): sınıflandırıcı bozulursa taban ANLAMSIZDIR ve
  // mandal neyin dondurulduğunu söyleyemez — "0 ihlal" ile "hiç bakılmadı" aynı
  // görünür. Arıza ARACIN KENDİSİNDE ve düzeltmek tek kişinin işi; yabancı bir
  // WIP'e bağlı değil ⇒ KIRMIZI, beyan değil.
  //   *Fail-closed'ın maliyeti, arızanın SAHİBİNE olan uzaklığıyla ölçülür.*
  const sonda = kendiniSina();
  for (const s of sonda.satirlar) console.log(`   ${s}`);
  check("§0 ⭐ gömülü sonda: sınıflandırıcı çalışıyor", sonda.gecti, `${sonda.satirlar.length} vaka`);
  if (!sonda.gecti) {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exit(1);
  }

  const o = olcum(SCRIPTS);
  const uyeler = [...o.uyeler].sort();
  console.log(`\n${KAPSAM_SERHI}`);
  console.log(
    `   ⚠️ TANECİK dosya::model — aynı dosyada AYNI modele İKİNCİ bir keyfi çağrı\n` +
      `      eklemek mandalı UYANDIRMAZ (üye sayısı artmaz, çağrı sayısı artar).\n` +
      `      ⇒ Yeşil "keyfi arama artmadı" DEĞİL, "keyfi arama yapılan (dosya, model)\n` +
      `        ÇİFTİ artmadı" demektir.`,
  );

  // KÖRLÜK ZEMİNİ: tarama boşa düşerse "0 keyfi" ile "hiç bakılmadı" aynı yeşile çıkar.
  check("§0z körlük zemini: popülasyon bulundu", o.populasyon > 100, `${o.populasyon} çağrı / ${o.taranan} dosya tarandı`);

  if (YAZ) {
    tabanYaz(uyeler, o);
    console.log(`\n✍️  taban yazıldı — ${uyeler.length} üye · ${o.keyfiCagri} keyfi çağrı / ${o.keyfiDosya} dosya`);
    process.exit(0);
  }
  if (!existsSync(TABAN_DOSYA)) {
    check("taban dosyası var", false, "önce --yaz");
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exit(1);
  }
  const taban = new Set((JSON.parse(readFileSync(TABAN_DOSYA, "utf8")) as { uyeler: string[] }).uyeler);
  const yeni = uyeler.filter((u) => !taban.has(u));
  const kalkan = [...taban].filter((u) => !uyeler.includes(u));

  console.log(`\n§1 — mandal: (dosya, model) çifti kümesi yalnız KÜÇÜLÜR`);
  console.log(`   bugün ${uyeler.length} üye · devralınan ${taban.size} · ${o.keyfiCagri} keyfi çağrı`);
  check(
    "⭐ ORTAMA yaslanan YENİ (dosya, model) çifti YOK",
    yeni.length === 0,
    yeni.length
      ? `${yeni.length} YENİ: ${yeni.slice(0, 4).join(" · ")}` +
        "  → fikstürünü İŞ ANAHTARIYLA kur (`code`/`username`), ortamda arama"
      : "temiz",
  );
  if (kalkan.length && yeni.length === 0) {
    console.log(`   ↓ küme sıkışıyor: ${taban.size} → ${uyeler.length} (${kalkan.length} çift fikstüre bağlandı) — --yaz`);
    tabanYaz(uyeler, o);
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
