// JWKS ÇEKİCİ — satıcının yan konteyneri (`satici-jwks`, deploy/satici/docker-compose.portal-genel.yml).
// Satıcı DIŞ BAĞLANTISIZ kalır: Cloudflare Access imza anahtarlarını (takım JWKS'i) YALNIZ bu süreç çeker,
// satıcıyla aynı kuralla doğrular (`normalizeJwks`: RS256 · ≥ 2048 bit RSA · use=sig; geçerli anahtar yoksa hata)
// ve paylaşılan dizine ATOMİK yazar (aynı dizinde geçici dosya + fsync + rename). Başarısız çekim eski dosyaya
// DOKUNMAZ. Sır tutmaz, dinlemez, DB'ye bağlanmaz; satıcı dosyayı salt okunur bağdan okur.
// Çalıştırma (imajda): node /uygulama/dist/jwks-cekici.js — ortam: CF_ACCESS_TAKIM_ALANI · JWKS_DOSYASI · JWKS_CEKIM_DK
import { closeSync, fsyncSync, openSync, renameSync, rmSync, writeSync } from "node:fs";
import path from "node:path";
import { ACCESS_TEAM_DOMAIN_PATTERN } from "./config";
import { fetchJwksOverNetwork, jwksUrlOf, normalizeJwks, type JwksFetch } from "./http/access-jwt";

export const CEKIM_ARALIK_DK_VARSAYILAN = 10;
const HATA_TEKRAR_MS = 60_000;
const CEKIM_ZAMAN_ASIMI_MS = 10_000;

export interface CekiciAyar {
  readonly teamDomain: string;
  readonly file: string;
  readonly intervalMs: number;
}

/** Ortamdan ayar: takım alanı config.ts ile aynı normalleştirme + desen; dosya mutlak yol; aralık 1–60 dk. Geçersiz → hata. */
export function cekiciAyari(env: NodeJS.ProcessEnv): CekiciAyar {
  const team = (env.CF_ACCESS_TAKIM_ALANI ?? "").trim().toLowerCase().replace(/^https:\/\//, "").replace(/\/+$/, "");
  if (!ACCESS_TEAM_DOMAIN_PATTERN.test(team)) throw new Error("CF_ACCESS_TAKIM_ALANI <takım>.cloudflareaccess.com biçiminde olmalı");
  const file = env.JWKS_DOSYASI ?? "";
  if (!path.isAbsolute(file)) throw new Error("JWKS_DOSYASI mutlak yol olmalı");
  const dk = Number(env.JWKS_CEKIM_DK ?? CEKIM_ARALIK_DK_VARSAYILAN);
  if (!Number.isInteger(dk) || dk < 1 || dk > 60) throw new Error("JWKS_CEKIM_DK 1–60 olmalı");
  return { teamDomain: team, file, intervalMs: dk * 60_000 };
}

export type CekimSonucu = { readonly ok: true; readonly count: number } | { readonly ok: false; readonly error: string };

/** Tek çekim: başarıda dosya atomik değişir; her hatada eski dosya AYNEN kalır ve geçici dosya bırakılmaz. */
export async function jwksCekVeYaz(ayar: Pick<CekiciAyar, "teamDomain" | "file">, fetchJwks: JwksFetch = fetchJwksOverNetwork): Promise<CekimSonucu> {
  const gecici = path.join(path.dirname(ayar.file), `.${path.basename(ayar.file)}.${process.pid}.gecici`);
  try {
    const r = await fetchJwks(jwksUrlOf(ayar.teamDomain), AbortSignal.timeout(CEKIM_ZAMAN_ASIMI_MS));
    if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
    const { json, count } = normalizeJwks(r.body);
    const fd = openSync(gecici, "w", 0o644);
    try {
      writeSync(fd, json);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(gecici, ayar.file);
    return { ok: true, count };
  } catch (err) {
    try {
      rmSync(gecici, { force: true });
    } catch {
      // geçici dosya silinemese de eski dosya yerinde; hata aşağıda raporlanır
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function calis(): Promise<void> {
  const ayar = cekiciAyari(process.env);
  console.log(`[jwks] başladı: ${jwksUrlOf(ayar.teamDomain)} → ${ayar.file} (${ayar.intervalMs / 60_000} dk)`);
  let zamanlayici: NodeJS.Timeout | undefined;
  const tur = async (): Promise<void> => {
    const r = await jwksCekVeYaz(ayar);
    if (r.ok) console.log(`[jwks] yazıldı: ${r.count} anahtar`);
    else console.warn(`[jwks] çekilemedi (eski dosya KORUNDU): ${r.error}`);
    zamanlayici = setTimeout(() => void tur(), r.ok ? ayar.intervalMs : HATA_TEKRAR_MS);
  };
  const dur = (): void => {
    if (zamanlayici) clearTimeout(zamanlayici);
    process.exit(0);
  };
  process.on("SIGTERM", dur);
  process.on("SIGINT", dur);
  await tur();
}

if (require.main === module) {
  calis().catch((err: Error) => {
    console.error(`[jwks] açılış başarısız: ${err.message}`);
    process.exit(1);
  });
}
