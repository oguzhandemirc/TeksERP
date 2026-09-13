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
    const git = (...args: string[]): string =>
      execFileSync("git", ["-C", KOK, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const index = new Map<string, string>();
    for (const yol of git("ls-files", "-z", "--", "docs/kurallar/*.md").split("\0").filter(Boolean)) {
      index.set(yol, git("show", `:${yol}`));
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
