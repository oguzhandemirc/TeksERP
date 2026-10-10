// parola-kaydet.mjs --dogrula yardımcısı: stdin'deki parola anahtar dosyasını AÇAR mı? Yalnız bellekte; hiçbir şey yazılmaz,
// açılan özel yarı basılmaz. Çıkış: 0 açıldı · 1 parola yanlış · 2 dosya/biçim sorunu. Çıktıda yalnız kid.
import { readFileSync } from "node:fs";
import { KeyFileError, openSealedKey, type KeyWrapMeta, type SealedKey } from "../src/lib/license/protocol/anahtar-sarma";

async function main(): Promise<number> {
  const dosya = process.argv[2];
  if (!dosya) return 2;
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  const parola = Buffer.concat(chunks);
  chunks.forEach((c) => c.fill(0));
  try {
    const f = JSON.parse(readFileSync(dosya, "utf8")) as KeyWrapMeta & SealedKey;
    const raw = await openSealedKey(f, parola);
    raw.fill(0);
    process.stdout.write(`${f.kid}\n`);
    return 0;
  } catch (e) {
    if (e instanceof KeyFileError && e.kind === "YANLIS_PAROLA") return 1;
    return 2;
  } finally {
    parola.fill(0);
  }
}

main().then((k) => process.exit(k));
