// =============================================================================
// VARSAYILAN SÜPERADMİN ÖZETİ — derleme sırrını üretir (kullanıcı kararı 2026-10-11)
// =============================================================================
// KULLANIM (geliştirici Mac'i, gerçek terminal):
//     npx tsx scripts/varsayilan-superadmin-ozet.ts            # dosya varsa DURUR
//     npx tsx scripts/varsayilan-superadmin-ozet.ts --uzerine-yaz
// Ad + parola (iki kez, maskeli, ≥16 karakter) sorulur; bcrypt maliyet 13 özeti
// `~/.tekserp/sirlar/varsayilan-superadmin.json`a (0600) yazılır. Düz parola hiçbir yere
// yazılmaz; özet ekrana BASILMAZ — yalnız dosya yolu ve GitHub sırrını kuran komut basılır.
// Özet her pakette durur (yapıt indirilebilir) ⇒ güç maliyet 13 + uzunluktan gelir.
// =============================================================================
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { createInterface } from "node:readline/promises";
import bcrypt from "bcryptjs";

import { passwordPolicyViolation } from "../src/constants/password-policy";
import {
  VARSAYILAN_AD_RE,
  VARSAYILAN_PAROLA_MIN,
  malzemeCoz,
} from "../src/constants/varsayilan-superadmin";

export const OZET_MALIYETI = 13;
export const SIR_DOSYASI = path.join(os.homedir(), ".tekserp", "sirlar", "varsayilan-superadmin.json");

/** Saf çekirdek: girdiyi denetler, malzeme JSON'unu üretir (yazmaz, basmaz). */
export async function ozetUret(
  kullaniciAdi: string,
  parola: string,
  tekrar: string,
  maliyet: number = OZET_MALIYETI,
): Promise<{ ok: true; json: string } | { ok: false; hata: string }> {
  if (!VARSAYILAN_AD_RE.test(kullaniciAdi)) {
    return { ok: false, hata: "Kullanıcı adı 3-50 karakter, yalnız `A-Z a-z 0-9 . _ -`." };
  }
  if (parola !== tekrar) return { ok: false, hata: "Parolalar eşleşmedi." };
  if ([...parola].length < VARSAYILAN_PAROLA_MIN) {
    return { ok: false, hata: `Parola en az ${VARSAYILAN_PAROLA_MIN} karakter olmalı (özet her pakette durur).` };
  }
  const politika = passwordPolicyViolation(parola);
  if (politika) return { ok: false, hata: politika };
  const ozet = await bcrypt.hash(parola, maliyet);
  const json = JSON.stringify({ v: 1, kullaniciAdi, ozet });
  if (!malzemeCoz(json)) return { ok: false, hata: "Üretilen malzeme sözleşmeye uymadı." };
  return { ok: true, json };
}

/** Dosyayı 0700 dizine 0600 kipte yazar (umask'a bırakılmaz). */
export function sirDosyasiYaz(yol: string, json: string): void {
  fs.mkdirSync(path.dirname(yol), { recursive: true, mode: 0o700 });
  fs.writeFileSync(yol, `${json}\n`, { mode: 0o600 });
  fs.chmodSync(yol, 0o600);
}

class SessizCikis extends Writable {
  sessiz = false;
  override _write(chunk: Buffer | string, _e: BufferEncoding, cb: (err?: Error | null) => void): void {
    if (!this.sessiz) process.stdout.write(chunk);
    cb();
  }
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (!process.stdin.isTTY) {
    console.error("Bu betik etkileşimli terminal ister (parola boru/argümanla verilmez).");
    return 1;
  }
  if (fs.existsSync(SIR_DOSYASI) && !argv.includes("--uzerine-yaz")) {
    console.error(`${SIR_DOSYASI} zaten var — değiştirmek için --uzerine-yaz (yeni parola yalnız YENİ paketlere girer).`);
    return 1;
  }
  const cikis = new SessizCikis();
  const rl = createInterface({ input: process.stdin, output: cikis, terminal: true });
  const gizli = async (soru: string): Promise<string> => {
    process.stdout.write(soru);
    cikis.sessiz = true;
    const c = await rl.question("");
    cikis.sessiz = false;
    process.stdout.write("\n");
    return c;
  };
  try {
    const ad = (await rl.question("Varsayılan kullanıcı adı: ")).trim();
    const p1 = await gizli(`Ortak parola (≥${VARSAYILAN_PAROLA_MIN}, ekrana basılmaz): `);
    const p2 = await gizli("Ortak parola (tekrar): ");
    const r = await ozetUret(ad, p1, p2);
    if (!r.ok) {
      console.error(`❌ ${r.hata}`);
      return 1;
    }
    sirDosyasiYaz(SIR_DOSYASI, r.json);
    console.log(`\n✅ Özet yazıldı (0600): ${SIR_DOSYASI}`);
    console.log("GitHub sırrını kurmak için:");
    console.log(`  gh secret set TEKSERP_VARSAYILAN_SA < ${SIR_DOSYASI}`);
    return 0;
  } finally {
    rl.close();
  }
}

if (require.main === module) {
  main()
    .catch((e) => {
      console.error("HATA:", e instanceof Error ? e.message : e);
      return 1;
    })
    .then((k) => process.exit(k));
}
