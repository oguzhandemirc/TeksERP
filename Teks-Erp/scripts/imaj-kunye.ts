// =============================================================================
// KORUMALI LINUX İMAJI KÜNYESİ — CI'da yazılır, Mac'te ölçülür (Docker'sız; kimlik ARŞİVDEN)
// =============================================================================
//   npx tsx scripts/imaj-kunye.ts yaz --arsiv=<imaj .tar.gz> --native=<.node> --cikti=<imaj-kunye.json>
//       Yalnız `korumali-paket.yml` işi `docker-linux-x64` çağırır: commit/koşu GitHub ortamından (GITHUB_SHA ·
//       GITHUB_RUN_ID · GITHUB_RUN_ATTEMPT), sürüm package.json'dan; arşivin revision etiketi GITHUB_SHA ve
//       platformu linux/amd64 değilse DUR. Biçim tek kaynak `docker/korumali/imaj-kokeni.mjs` (`kunyeDenetle`).
//   npx tsx scripts/imaj-kunye.ts olc --arsiv=<docker save çıktısı>   → stdout JSON {kimlik, platform, diffIds, revision}
//       `imaj-imzala.mjs --ci-kosu` yerel tabanı bununla ölçer (`docker image inspect .Id` containerd'de config özeti değil).
// =============================================================================
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { tabanArsiviOlc } from "./lib/oci-arsiv";
import { IMAJ_ARSIVI, KUNYE_SURUMU, PLATFORM, kunyeDenetle, type ImajKunyesi } from "../docker/korumali/imaj-kokeni.mjs";

function bayrak(ad: string): string {
  const b = process.argv.slice(3).find((a) => a.startsWith(`--${ad}=`));
  const v = b?.slice(ad.length + 3) ?? "";
  if (!v) throw new Error(`--${ad}=<…> gerekli`);
  return v;
}

function dosyaOzeti(dosya: string): Promise<string> {
  return new Promise((coz, red) => {
    const h = createHash("sha256");
    fs.createReadStream(dosya)
      .on("data", (p) => h.update(p))
      .on("error", red)
      .on("end", () => coz(h.digest("hex")));
  });
}

function ortam(ad: string): string {
  const v = process.env[ad] ?? "";
  if (!v) throw new Error(`${ad} yok — künye yalnız GitHub Actions koşusunda yazılır`);
  return v;
}

async function yaz(): Promise<void> {
  const arsiv = path.resolve(bayrak("arsiv"));
  const native = path.resolve(bayrak("native"));
  const cikti = path.resolve(bayrak("cikti"));
  if (path.basename(arsiv) !== IMAJ_ARSIVI) throw new Error(`arşiv adı ${path.basename(arsiv)} — ${IMAJ_ARSIVI} bekleniyor`);
  const commit = ortam("GITHUB_SHA");
  const t = await tabanArsiviOlc(arsiv);
  if (t.revision !== commit) throw new Error(`imajın revision etiketi ${t.revision ?? "(yok)"} — koşunun commit'i ${commit} (TEKSERP_COMMIT verilmedi mi?)`);
  if (t.platform !== PLATFORM) throw new Error(`imaj platformu ${t.platform} — ${PLATFORM} bekleniyor`);
  const surum = (JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")) as { version: string }).version;
  const kunye: ImajKunyesi = {
    v: KUNYE_SURUMU,
    commit,
    runId: Number(ortam("GITHUB_RUN_ID")),
    runAttempt: Number(ortam("GITHUB_RUN_ATTEMPT")),
    surum,
    platform: t.platform,
    configOzeti: t.kimlik,
    diffIds: t.diffIds,
    native: { dosya: path.basename(native), sha256: await dosyaOzeti(native) },
    arsiv: { dosya: IMAJ_ARSIVI, sha256: await dosyaOzeti(arsiv) },
  };
  const e = kunyeDenetle(kunye);
  if (e.length) throw new Error(`künye biçimsiz: ${e.join(", ")}`);
  fs.writeFileSync(cikti, `${JSON.stringify(kunye, null, 2)}\n`);
  console.log(JSON.stringify(kunye));
}

async function olc(): Promise<void> {
  const t = await tabanArsiviOlc(path.resolve(bayrak("arsiv")));
  process.stdout.write(`${JSON.stringify({ kimlik: t.kimlik, platform: t.platform, diffIds: t.diffIds, revision: t.revision })}\n`);
}

const komut = process.argv[2];
(komut === "yaz" ? yaz() : komut === "olc" ? olc() : Promise.reject(new Error("komut: yaz | olc"))).catch((e: unknown) => {
  console.error(`✖ imaj-kunye: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
