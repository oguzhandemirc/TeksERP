// =============================================================================
// Kural dosyaları (`docs/kurallar/*.md`) — INDEX'ten okuma + `bekçi:` alanları
// =============================================================================
// Kural belgelerini tarayan cırcırların (test_kural_bekci_atfi · test_borc_notu_
// bicimi) ORTAK okuyucusu. Tabanı olan her kapı buradan okur ki iki kapı aynı
// anlık görüntüyü ölçsün.
//
// ⚠️ NEDEN INDEX (ne ağaç ne HEAD) — ölçüldü 2026-09-13: ortak ağaçta üç
// oturumun commit'lenmemiş satırları varken ağaçtan ölçen oturum tabanı 27
// yazdı, HEAD gerçeği 31'di ⇒ inseydi kapı herkese kırmızı verecekti. HEAD de
// doğru kaynak değil: HEAD'den ölçen kapı, tabanı düşüren commit'in kendisini
// commit ÖNCESİ kırmızı gösterir (HEAD eski sayı, sabit yeni). Index tam olarak
// "commit'lenecek olan"dır; CI'da HEAD = index = ağaç.
// =============================================================================
import { execFileSync } from "child_process";
import { git } from "./git";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

export const KOK = join(__dirname, "..", "..", "..");
const KURALLAR = join(KOK, "docs", "kurallar");

export type KuralKaynagi = {
  /** Ölçüme esas içerik nereden okundu — `ağaç` yalnız git yoksa. */
  kaynak: "index" | "ağaç";
  /** yol (`docs/kurallar/x.md`) → içerik; tabana ESAS olan. */
  index: Map<string, string>;
  /** Çalışma ağacı; yalnız "commit'lenmemiş fark" satırı için. */
  agac: Map<string, string>;
};

export function kuralDosyalari(): KuralKaynagi {
  const agac = new Map<string, string>();
  for (const ad of readdirSync(KURALLAR).filter((f) => f.endsWith(".md"))) {
    agac.set(`docs/kurallar/${ad}`, readFileSync(join(KURALLAR, ad), "utf8"));
  }
  try {
    const g = (...args: string[]): string => git(["-C", KOK, ...args], { stdio: "yut" });
    const index = new Map<string, string>();
    for (const yol of g("ls-files", "-z", "--", "docs/kurallar/*.md").split("\0").filter(Boolean)) {
      index.set(yol, g("show", `:${yol}`));
    }
    if (index.size === 0) throw new Error("index boş");
    return { kaynak: "index", index, agac };
  } catch {
    return { kaynak: "ağaç", index: agac, agac };
  }
}

export type BekciAlani = { dosya: string; satir: number; icerik: string; tamSatir: string };

/** Alanın yaşayabileceği parça: bir sonraki kardeş alana ya da `<sub>`e kadar. */
const ALAN_SONU = / <sub>| · (?:Kapanır|Öncül|Çapa|KAPANDI):|$/;

/**
 * Kardeş alanın (`Kapanır:` · `Öncül:` · `Çapa:` · `KAPANDI:`) İÇERİĞİ — satırda
 * ilk geçtiği yerden bir sonraki kardeşe/`<sub>`e kadar, kırpılmış. Backtick
 * ZORUNLU DEĞİL ve bu bilinçli (2026-09-13): alanın sınırı kardeşlerle çizilir,
 * backtick'le değil — ev cümleyi bazen düz yazıyor, bazen içine kod adı koyuyor
 * (`--apply`, `GIN`). Eski yüklem backtick'le sınırlıyordu ve içindeki ilk
 * backtick'te durup KESİK cümleyi "var" sayıyordu; sıkılaştırılmış hâli ise iç
 * backtick'li ve düz yazılmış cümleleri "YOK" sayıyordu (deploy-kurulum ×3) —
 * ikisi de aynı kusurun iki yüzü: sınırı YANLIŞ ŞEYLE çizmek. Alan yoksa null.
 */
export function kardesAlan(satir: string, ad: "Kapanır" | "Öncül" | "Çapa" | "KAPANDI"): string | null {
  const m = new RegExp(` · ${ad}:|^${ad}:`).exec(satir);
  if (!m) return null;
  const bas = m.index + m[0].length;
  const kalan = satir.slice(bas);
  const son = new RegExp(` <sub>| · (?:${["Kapanır", "Öncül", "Çapa", "KAPANDI"].filter((k) => k !== ad).join("|")}):|$`).exec(kalan)?.index ?? kalan.length;
  const icerik = kalan.slice(0, son).trim().replace(/^`|`$/g, "").trim();
  return icerik.length > 0 ? icerik : null;
}
/** Alanı kapatan backtick: ardından ayraç gelen İLK backtick. */
const KAPANIS = /`(?= ·| —| <sub>|$)/;

/**
 * `· bekçi: `…`` alanları — dosya + satır + içerik + tam satır.
 *
 * ⚠️ İÇERİK İLK BACKTICK'TE KESİLMEZ (ölçüldü 2026-09-13, 5e): eski yüklem
 * `bekçi: \`[^\`]*\`` alanın İÇİNDEKİ backtick'te duruyor, yarısını okuyup
 * "dengesiz parantez" diyordu — kesik cırcırının 6 kaleminin 4'ü bu artefakttı
 * (`sebep-katalogu.md:32` 9 → 64 karakter). Sahte borç tabanı yukarıda tutuyor,
 * gerçek borca yer açıyordu: *bir kapı kendi ayrıştırıcısının darlığını sayıya
 * çevirebilir.* Şimdi: alanın parçası kardeş alana/`<sub>`e kadar; kapanış,
 * ardından ayraç gelen İLK backtick; öyle bir backtick yoksa (alan `(…)`
 * açıklamasıyla sürüyorsa) eski davranış — ilk backtick. 600/600 alan, 12'si
 * daha uzun okundu, hiçbiri kaybolmadı (index'te ölçüldü).
 * Sondalar (geçici worktree, 2026-09-13): iç backtick + dengeli parantez → kesik
 * SAYILMADI ✓ · `x.ts` ("a" · "b") biçimi → kısa ad okundu ✓ · 80'lik → +1 ✓ ·
 * iç backtick'li alanın SONUNDAKİ uydurma ad → "1 çözülmeyen" (alan sonuna kadar
 * okunduğunun kanıtı) ✓.
 */
export function bekciAlanlari(dosyalar: Map<string, string>): BekciAlani[] {
  const out: BekciAlani[] = [];
  const BASLIK = "bekçi: `";
  for (const [dosya, metin] of dosyalar) {
    metin.split("\n").forEach((s, i) => {
      let from = 0;
      for (;;) {
        const j = s.indexOf(BASLIK, from);
        if (j < 0) break;
        const bas = j + BASLIK.length;
        const parca = s.slice(bas, bas + (ALAN_SONU.exec(s.slice(bas))?.index ?? 0));
        const kapanis = KAPANIS.exec(parca)?.index ?? parca.indexOf("`");
        if (kapanis >= 0) out.push({ dosya, satir: i + 1, icerik: parca.slice(0, kapanis), tamSatir: s });
        from = bas;
      }
    });
  }
  return out;
}
