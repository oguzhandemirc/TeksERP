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

/** `· bekçi: `…`` alanları — dosya + satır + backtick'ler arası içerik + tam satır. */
export function bekciAlanlari(dosyalar: Map<string, string>): BekciAlani[] {
  const out: BekciAlani[] = [];
  for (const [dosya, metin] of dosyalar) {
    metin.split("\n").forEach((s, i) => {
      for (const m of s.matchAll(/bekçi: `([^`]*)`/g)) {
        out.push({ dosya, satir: i + 1, icerik: m[1]!, tamSatir: s });
      }
    });
  }
  return out;
}

/** ornek: docs/kurallar/SONDA_YOK.md okunur */
