// İMZA ALT SÜRECİ — kök (ya da bayi) anahtarı YALNIZ bu kısa ömürlü süreçte açılır.
// Girdi stdin'den: ilk satır JSON istek, kalan baytlar parola. Parola argv'ye ya da env'e
// ASLA girmez (paylaşımlı makinede süreç listesinden okunur); açılan anahtar Buffer'ı ve
// parola Buffer'ı iş bitince sıfırlanır. Çıktı stdout'a tek JSON satırı.
import { z } from "zod";
import {
  CertificateSchema,
  EntitlementSchema,
  TYP,
  decodeDocument,
  signDocument,
  type LicenseClass,
} from "../lisans-protokol";
import { KeyFileError, privateKeyFromRaw, readWrappedKeyFile, unwrapPrivateKey } from "./key-files";

const SignRequestSchema = z.strictObject({
  anahtarDosyasi: z.string().min(1),
  typ: z.enum([TYP.HAK, TYP.SERTIFIKA]),
  yuk: z.record(z.string(), z.unknown()),
});

type SignerOutput = { ok: true; belge: string } | { ok: false; kod: string; mesaj: string };

function readStdin(): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (c: Buffer) => chunks.push(c));
    process.stdin.on("end", () => {
      const all = Buffer.concat(chunks);
      for (const c of chunks) c.fill(0);
      resolve(all);
    });
    process.stdin.on("error", reject);
  });
}

function write(out: SignerOutput): void {
  process.stdout.write(`${JSON.stringify(out)}\n`);
}

function isSubset(list: readonly LicenseClass[], of: readonly LicenseClass[]): boolean {
  return list.every((c) => of.includes(c));
}

async function sign(requestLine: Buffer, password: Buffer): Promise<SignerOutput> {
  const parsed = SignRequestSchema.safeParse(JSON.parse(requestLine.toString("utf8")));
  if (!parsed.success) return { ok: false, kod: "BICIM", mesaj: "İmza isteği tanınmıyor" };
  const request = parsed.data;
  const file = readWrappedKeyFile(request.anahtarDosyasi);
  if (request.typ === TYP.SERTIFIKA) {
    if (file.tur !== "tekserp-kok-anahtar") return { ok: false, kod: "YETKISIZ", mesaj: "Sertifikayı yalnız kök imzalar" };
    const cert = decodeDocument(CertificateSchema, request.yuk);
    if (!cert.ok) return { ok: false, kod: "BICIM", mesaj: cert.message };
    if (!isSubset(cert.value.siniflar, file.siniflar)) {
      return { ok: false, kod: "YETKISIZ", mesaj: `Kök ${file.kid} bu sınıflara sertifika veremez` };
    }
  } else {
    const hak = decodeDocument(EntitlementSchema, request.yuk);
    if (!hak.ok) return { ok: false, kod: "BICIM", mesaj: hak.message };
    if (!file.siniflar.includes(hak.value.sinif)) {
      return { ok: false, kod: "YETKISIZ", mesaj: `Anahtar ${file.kid} ${hak.value.sinif} sınıfını imzalayamaz` };
    }
    const dealerSigned = file.tur === "tekserp-bayi-anahtar";
    if (dealerSigned !== Boolean(hak.value.bayiSertifikasi)) {
      return { ok: false, kod: "YETKISIZ", mesaj: "Bayi imzası yalnız bayi sertifikalı HAK'ta" };
    }
  }
  const raw = await unwrapPrivateKey(file, password);
  password.fill(0);
  let belge: string;
  try {
    const privateKey = privateKeyFromRaw(raw);
    belge =
      request.typ === TYP.SERTIFIKA
        ? signDocument({ typ: TYP.SERTIFIKA, schema: CertificateSchema, payload: request.yuk as never, key: { kid: file.kid, privateKey } })
        : signDocument({ typ: TYP.HAK, schema: EntitlementSchema, payload: request.yuk as never, key: { kid: file.kid, privateKey } });
  } finally {
    raw.fill(0);
  }
  return { ok: true, belge };
}

async function main(): Promise<void> {
  const input = await readStdin();
  const newline = input.indexOf(0x0a);
  if (newline < 0) {
    input.fill(0);
    write({ ok: false, kod: "BICIM", mesaj: "İmza isteği eksik" });
    return;
  }
  const requestLine = Buffer.from(input.subarray(0, newline));
  const password = Buffer.from(input.subarray(newline + 1));
  input.fill(0);
  try {
    write(await sign(requestLine, password));
  } catch (err) {
    const kod = err instanceof KeyFileError ? err.kind : "HATA";
    // Mesaj sabit metinlerden gelir; parola hiçbir dala girmez.
    write({ ok: false, kod, mesaj: err instanceof KeyFileError ? err.message : "İmza başarısız" });
  } finally {
    password.fill(0);
    requestLine.fill(0);
  }
}

main().then(
  () => process.exit(0),
  () => process.exit(1),
);
