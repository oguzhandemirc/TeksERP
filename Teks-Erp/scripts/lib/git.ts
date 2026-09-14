// =============================================================================
// GIT YARDIMCISI — bekçilerin `git` çağrısı TEK YERDEN, tamponu AÇIK
// =============================================================================
// NEDEN: `execFileSync`in varsayılan `maxBuffer`ı 1 MB'tır ve aşıldığında komut
// ENOBUFS ile ÇÖKER — kontrol kırmızı vermez, BEKÇİ ÖLÜR. 2026-09-14'te
// `CLAUDE-NOT-ARSIVI.md` 1 MB'ı aştı ve `test_identity_ledger` tam olarak böyle
// düştü: ihlal yoktu, tampon yetmedi. ⇒ ***Bir aracın kapasite sınırı, ölçtüğü
// şeyin büyümesiyle sessizce ihlale dönüşür;*** kapı "ölçemedim" bile diyemez,
// çünkü diyecek kod hiç çalışmaz.
//
// Tamponu çağrı başına ayarlamak bu sınıfı KAPATMAZ: sayı her dosyada ayrı yaşar,
// biri güncellenir diğeri kalır (ölçüldü: aynı gün altı bekçi 1 MB varsayılanıyla
// koşuyordu, biri 32 MB, biri 64 MB, biri 256 MB). Tek yardımcı, tek sayı.
//
// ⚠️ BU DOSYA `scripts/lib` ALTINDA ÇÜNKÜ ÜRÜN KODU DEĞİL: `src/` git çalıştırmaz.
// =============================================================================
import { execFileSync } from "node:child_process";

/**
 * Tampon — arşiv dosyası bugün 1 MB; `rev-list` çıktısı onlarca MB olabilir.
 * Tek sayı: çağrı başına ayarlanan tampon, bu sınıfın kendisidir.
 */
const TAMPON = 256 * 1024 * 1024;

export interface GitSecenek {
  cwd?: string;
  /** `yut`: stderr yutulur (varlık sondası gibi, hata BEKLENEN olduğunda). */
  stdio?: "yut" | "gecir";
  env?: NodeJS.ProcessEnv;
}

/**
 * `git <args>` — çıktıyı string döner. Hata mesajı KOMUTU taşır: tamponsuz
 * çağrının ENOBUFS'u "spawn hatası" diye okunuyordu, hangi komut olduğu değil.
 */
export function git(args: string[], secenek: GitSecenek = {}): string {
  try {
    return execFileSync("git", args, {
      cwd: secenek.cwd,
      encoding: "utf8",
      maxBuffer: TAMPON,
      env: secenek.env,
      stdio: secenek.stdio === "yut" ? ["ignore", "pipe", "ignore"] : undefined,
    });
  } catch (e) {
    const sebep = (e as { code?: string }).code === "ENOBUFS"
      ? `ÇIKTI TAMPONU AŞILDI (${TAMPON} bayt) — ölçülen dosya büyümüş olabilir`
      : String((e as Error).message).slice(0, 200);
    throw new Error(`git ${args.join(" ")} → ${sebep}`);
  }
}

/** Bu dizin bir git deposu mu? Hata BEKLENEN olduğu için yutulur. */
export function gitDeposuMu(cwd: string): boolean {
  try { git(["rev-parse", "--git-dir"], { cwd, stdio: "yut" }); return true; } catch { return false; }
}
