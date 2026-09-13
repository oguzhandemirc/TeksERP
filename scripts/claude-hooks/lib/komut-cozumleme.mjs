// =============================================================================
// KOMUT ÇÖZÜMLEME — yasak "ÇALIŞTIRILACAK KOMUT"ta aranır, "yazılan/aranan METİN"de değil
// =============================================================================
// VAKA (2026-09-13): komut kapısı 4.962 kez hiç koşmadı (göreli yol). O ölü
// pencerenin komutları korpus olarak çıkarıldı ve kapı onlara karşı ölçüldü:
// **26 kırmızı, 22'si YANLIŞ POZİTİF.** Gerçek örnekler:
//   · `<div className="truncate text-sm">`            → CSS sınıfı
//   · `grep -rni "delete from ..."`                    → grep deseni
//   · `echo "=== TRUNCATE/DROP gecen red ==="`         → echo etiketi
//   · `"§4: silme HİÇ denenmedi (TRUNCATE çıktıda yok)"` → bir check etiketi
//   · `python3 - <<'PY' … TRUNCATE …`                  → program kaynağı
// Kalıp tek: yasak, ÇALIŞTIRILAN komut ile ARANAN/YAZILAN metni ayırt etmiyordu.
//
// ÜÇ KURAL, her biri ölçülerek eklendi (korpus: 4.974 komut):
//   ① TIRNAK FARKINDALIĞI — `grep "a\|b"` içindeki `|` AYIRAÇ DEĞİLDİR. Bu tek
//      başına birkaç yanlış pozitif üretiyordu: desen parçalanıp `truncate\`
//      kendi başına bir "komut" sanılıyordu.
//   ② METİN BORU HATTI — bir hattın TAMAMI metin aracıysa (grep/echo/head/…)
//      o hat hiçbir şey çalıştırmaz. ⚠️ Hat metin OLMAYAN bir komuta bağlanıyorsa
//      (örn. `echo "…" | psql`) ATLANMAZ — orada metin komuta DÖNÜŞÜR.
//   ③ HEREDOC — gövde, ALICISI onu çalıştırmıyorsa VERİDİR. Alıcı beyaz listesi
//      dar: `cat`/`tee` (dosyaya yazar), `git commit|tag|notes` (mesaj), ve
//      yorumlayıcılar (`python3`/`node`/`ruby`/`perl` — gövde bir PROGRAM'dır,
//      kabuk komutu değil). ⚠️ `psql <<EOF`, `bash <<EOF` gövdeyi ÇALIŞTIRIR ve
//      beyaz listede YOKTUR; orada gövde taranmaya devam eder.
//
// ÖLÇÜM: aynı korpusta 26 → 8 kırmızı. Kalan 8'in 7'si GERÇEK ihlal (4 `DROP
// DATABASE`, 3 WHERE'siz `DELETE FROM`); yani yanlış pozitif 22 → 1.
//
// ⚠️ BEYAN EDİLEN SINIR — kapı KABUK KOMUTUNU inceler, PROGRAM DAVRANIŞINI değil.
// `cat > x.sh <<EOF … EOF` artık geçer (dosyaya yazmak çalıştırmak değildir) ve
// sonraki `bash x.sh` zaten hiçbir zaman incelenemiyordu. Bu bir gevşeme değil,
// kapının BAŞTAN BERİ sahip olduğu sınırın adının konmasıdır.
// =============================================================================

/** Metin araçları: çıktısı VERİDİR. Hattın tamamı bunlardan oluşuyorsa hiçbir şey çalışmaz. */
const METIN_ARACLARI = new Set([
  "grep", "rg", "egrep", "fgrep", "ag", "echo", "printf", "head", "tail", "wc",
  "sort", "uniq", "cut", "tr", "jq", "less", "cat", "column", "nl", "rev", "tee",
]);

/** Heredoc gövdesini VERİ sayabileceğimiz alıcılar (dar ve bilinçli). */
const HEREDOC_VERI_ALICISI = [
  /^cat\b/, /^tee\b/, /^git\s+commit\b/, /^git\s+tag\b/, /^git\s+notes\b/,
  /^python3?\b/, /^node\b/, /^ruby\b/, /^perl\b/,
];

function ilkKelime(s) {
  const m = s.trim().match(/^(?:[A-Za-z_][\w]*=\S*\s+)*([^\s;|&<>]+)/);
  return m ? m[1].replace(/^.*\//, "") : "";
}

/** Komutu `{metin, ayirac}` parçalarına böler; `ayirac` parçadan SONRA gelendir. */
export function parcala(satir) {
  const out = [];
  let buf = "";
  let tirnak = null;
  for (let i = 0; i < satir.length; i++) {
    const c = satir[i];
    if (tirnak) {
      buf += c;
      if (c === tirnak && satir[i - 1] !== "\\") tirnak = null;
      continue;
    }
    if (c === "'" || c === '"') {
      tirnak = c;
      buf += c;
      continue;
    }
    if (c === "\\" && (satir[i + 1] === "|" || satir[i + 1] === ";")) {
      buf += c + satir[i + 1];
      i++;
      continue;
    }
    const iki = satir.slice(i, i + 2);
    if (iki === "&&" || iki === "||") { out.push({ metin: buf, ayirac: iki }); buf = ""; i++; continue; }
    if (c === ";" || c === "\n") { out.push({ metin: buf, ayirac: ";" }); buf = ""; continue; }
    if (c === "|") { out.push({ metin: buf, ayirac: "|" }); buf = ""; continue; }
    buf += c;
  }
  out.push({ metin: buf, ayirac: "" });
  return out.filter((p) => p.metin.trim());
}

/** Alıcısı gövdeyi çalıştırmayan heredoc'ların gövdesini çıkarır. */
export function heredocAyikla(cmd) {
  const satirlar = cmd.split("\n");
  const out = [];
  let i = 0;
  while (i < satirlar.length) {
    const s = satirlar[i];
    const m = s.match(/<<-?\s*(['"]?)([A-Za-z_][\w]*)\1/);
    if (!m) { out.push(s); i++; continue; }
    const gonderen = s.slice(0, m.index).trim().split(/[;|&]/).pop().trim();
    const veri = HEREDOC_VERI_ALICISI.some((re) => re.test(gonderen));
    out.push(veri ? s.slice(0, m.index) : s);
    const bitis = m[2];
    i++;
    while (i < satirlar.length && satirlar[i].trim() !== bitis) {
      if (!veri) out.push(satirlar[i]);
      i++;
    }
    i++;
  }
  return out.join("\n");
}

/** Parça, boru hattının TAMAMI metin aracıysa atıldır (hiçbir şey çalıştırmaz). */
function atil(parcalar, idx) {
  if (!METIN_ARACLARI.has(ilkKelime(parcalar[idx].metin))) return false;
  let j = idx;
  while (parcalar[j] && parcalar[j].ayirac === "|") {
    j++;
    if (!parcalar[j]) return true;
    if (!METIN_ARACLARI.has(ilkKelime(parcalar[j].metin))) return false;
  }
  return true;
}

/** Yasakların ARANACAĞI parçalar — çalıştırılacak komutlar. */
export function calistirilacakParcalar(cmd) {
  const parcalar = parcala(heredocAyikla(cmd));
  return parcalar.filter((_, i) => !atil(parcalar, i)).map((p) => p.metin);
}
