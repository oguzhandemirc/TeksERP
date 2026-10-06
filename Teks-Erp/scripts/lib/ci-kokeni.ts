// =============================================================================
// CI KÖKENİ — PAKET imzasından ÖNCE yapıtın hangi CI koşusundan geldiği (G22 / ALT-9, Mac tarafı)
// =============================================================================
// Korumalı paketin `.jsc`si platforma kilitlidir ve CI'da derlenir; Mac onu gözle denetleyemez, yalnız
// birleştirir ve PAKET anahtarıyla imzalar. İmza "bizden geldi" dediği için kökeni ölçülmeden atılmaz:
// koşu `korumali-paket.yml` iş akışının, başarıyla bitmiş, (üretim anahtarında) `main` dalının koşusu
// olmalı ve commit'i yapıtın künyesindeki (`dist/server-kunye.json`) ve paketin (PAKET.json) commit'i olmalı.
// Üç sonuç: uyumlu · ihlal · ÖLÇÜLEMEDİ (okunamayan koşu geçmiş kapı değildir).
// KAÇIŞ (kullanıcı kararı 2026-10-01) yalnız KULLANICININ CÜMLESİYLE: CI koşusu yokken üretim imzası
// `--ci-atla="<cümle>"` ister; boş/kısa/kalıp dışı cümle RED, `--ci-kosu` ile birlikte RED, üretim dışı (test) anahtarda RED.
// Cümle + saat + makine + HEAD imzalı künyeye (`ciKokeni` ek anahtarı) girer; yayıncı görünce uyarır, defterine yazar.
// =============================================================================
import { execFileSync } from "node:child_process";
import { kacisCumlesiDenetle } from "../../../scripts/lib/kullanici-cumlesi.mjs";

export const KORUMALI_IS_AKISI = Object.freeze({ yol: ".github/workflows/korumali-paket.yml", ad: "Korumalı paket (.jsc)" });
/** Üretim PAKET imzası yalnız bu dalın koşusundan gelen yapıta atılır. */
export const URETIM_DALI = "main";

/** GitHub `actions/runs/<id>` yanıtının kullanılan alanları. */
export interface CiKosusu {
  readonly id?: number;
  readonly head_sha?: string;
  readonly head_branch?: string;
  readonly path?: string;
  readonly name?: string;
  readonly status?: string;
  readonly conclusion?: string | null;
}

export interface KokenHukmu {
  readonly sonuc: "uyumlu" | "ihlal" | "olculemedi";
  readonly satirlar: string[];
}

/** `gh api repos/{owner}/{repo}/actions/runs/<id>` — okunamazsa fırlatır (çağıran DURUR: ÖLÇÜLEMEDİ). */
export function ciKosusuOku(id: string, gh = "gh"): CiKosusu {
  if (!/^\d{1,20}$/.test(id)) throw new Error(`--ci-kosu biçimsiz: "${id}" (sayısal koşu numarası: gh run list --workflow=korumali-paket.yml)`);
  let cikti: string;
  try {
    cikti = execFileSync(gh, ["api", `repos/{owner}/{repo}/actions/runs/${id}`], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 });
  } catch (e) {
    const neden = String((e as { stderr?: string }).stderr || (e as Error).message).trim().slice(0, 200);
    throw new Error(`CI koşusu ${id} okunamadı (gh api) — CI kökeni ÖLÇÜLEMEDİ: ${neden}`);
  }
  try {
    return JSON.parse(cikti) as CiKosusu;
  } catch {
    throw new Error(`CI koşusu ${id} yanıtı JSON değil — CI kökeni ÖLÇÜLEMEDİ`);
  }
}

/**
 * Koşu ↔ yapıt bağı. `kunyeCommit`: `dist/server-kunye.json` `commit` (CI'daki derlemenin HEAD'i);
 * `paketCommit`: PAKET.json `commit` (paketin birleştirildiği commit, kısa olabilir; dizin imzasında null).
 */
export function ciKokeniHukmu(o: { kosu: CiKosusu; kunyeCommit: unknown; paketCommit: string | null; uretim: boolean }): KokenHukmu {
  const { kosu, kunyeCommit, paketCommit, uretim } = o;
  if (typeof kunyeCommit !== "string" || !/^[0-9a-f]{40}$/.test(kunyeCommit)) {
    return { sonuc: "olculemedi", satirlar: ["dist/server-kunye.json `commit` yok/biçimsiz — yapıtın derlendiği commit ölçülemez"] };
  }
  const sha = String(kosu.head_sha ?? "");
  const ih: string[] = [];
  if (kosu.path !== KORUMALI_IS_AKISI.yol) ih.push(`iş akışı "${kosu.path}" — ${KORUMALI_IS_AKISI.yol} bekleniyor`);
  if (kosu.name !== KORUMALI_IS_AKISI.ad) ih.push(`iş akışı adı "${kosu.name}" — "${KORUMALI_IS_AKISI.ad}" bekleniyor`);
  if (kosu.status !== "completed" || kosu.conclusion !== "success") ih.push(`koşu ${kosu.status}/${kosu.conclusion} — yalnız başarıyla BİTMİŞ koşunun yapıtı imzalanır`);
  if (uretim && kosu.head_branch !== URETIM_DALI) ih.push(`koşu "${kosu.head_branch}" dalından — üretim imzası yalnız ${URETIM_DALI} dalının yapıtına atılır`);
  if (sha !== kunyeCommit) ih.push(`koşunun commit'i ${sha.slice(0, 12) || "(yok)"} — yapıt (server-kunye.json) ${kunyeCommit.slice(0, 12)} commit'inden derlenmiş`);
  if (paketCommit !== null && (!/^[0-9a-f]{7,40}$/.test(paketCommit) || !sha.startsWith(paketCommit))) {
    ih.push(`paket (PAKET.json) "${paketCommit}" commit'inde birleştirilmiş — koşu ${sha.slice(0, 12) || "(yok)"}`);
  }
  if (ih.length) return { sonuc: "ihlal", satirlar: ih };
  return { sonuc: "uyumlu", satirlar: [`CI kökeni: "${KORUMALI_IS_AKISI.ad}" koşu ${kosu.id ?? "?"} · ${kosu.head_branch} · ${kunyeCommit.slice(0, 12)} · başarılı`] };
}

/**
 * İmzalı künyeye giren köken kaydı (imzalı yükte `ciKokeni` ek anahtarı; v1 şeması doğrulamada atar, imzada durur).
 * `kosu`: ölçülmüş CI koşusu · `atlandi`: koşusuz, kullanıcının cümlesiyle (yayıncı uyarır, defterine yazar).
 */
export type CiKokeniKaydi =
  | { readonly kip: "kosu"; readonly kosu: number; readonly dal: string; readonly commit: string }
  | { readonly kip: "atlandi"; readonly cumle: string; readonly saat: string; readonly makine: string; readonly head: string };

/** `--ci-atla` hükmü — kaçış yalnız üretim anahtarında, koşu verilmemişken ve kullanıcının geçerli cümlesiyle. */
export function ciAtlaHukmu(o: { ham: string; uretim: boolean; kosuVar: boolean }): { sonuc: "uyumlu" | "ihlal"; cumle: string; satirlar: string[] } {
  if (!o.uretim) {
    return { sonuc: "ihlal", cumle: "", satirlar: ["üretim dışı (test) anahtarda kaçış gerekmez (CI kökeni isteğe bağlı) — --ci-atla bu anahtarla verilemez"] };
  }
  if (o.kosuVar) {
    return { sonuc: "ihlal", cumle: "", satirlar: ["--ci-kosu ile --ci-atla birlikte verilemez — koşu varsa ölçülür, kaçış yalnız koşu YOKKEN"] };
  }
  const c = kacisCumlesiDenetle(o.ham);
  if (!c.gecerli) {
    return { sonuc: "ihlal", cumle: c.cumle, satirlar: [`--ci-atla REDDEDİLDİ: ${String(c.sebep)}`, "Kaçış yalnız KULLANICININ cümlesiyle verilir; cümle imzalı künyeye ve yayın defterine yazılır."] };
  }
  return { sonuc: "uyumlu", cumle: c.cumle, satirlar: [`CI KAÇIŞI — üretim imzası CI koşusu OLMADAN, kullanıcının cümlesiyle: "${c.cumle}"`] };
}
