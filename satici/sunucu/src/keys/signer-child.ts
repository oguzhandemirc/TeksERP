// İMZA ALT SÜRECİ — kök, bayi ya da HAK ara imzacısı anahtarı YALNIZ bu kısa ömürlü süreçte açılır.
// Girdi stdin'den: ilk satır JSON istek, kalan baytlar parola. Parola argv'ye ya da env'e
// ASLA girmez (paylaşımlı makinede süreç listesinden okunur); açılan anahtar Buffer'ı ve
// parola Buffer'ı iş bitince sıfırlanır. Çıktı stdout'a tek JSON satırı.
import { z } from "zod";
import {
  CertificateSchema,
  EntitlementSchema,
  ExemptionSchema,
  PackageRevocationSchema,
  RevocationSchema,
  TYP,
  TYP_GECICI,
  TempOpeningSchema,
  decodeDocument,
  offlineHorizonCeilingDays,
  signDocument,
  type EntitlementDoc,
  type EntitlementSignerKind,
  type ExemptionDoc,
  type LicenseClass,
} from "../lisans-protokol";
import { KeyFileError, privateKeyFromRaw, readWrappedKeyFile, unwrapPrivateKey, type WrappedKeyFile } from "./key-files";

const SignRequestSchema = z.strictObject({
  anahtarDosyasi: z.string().min(1),
  typ: z.enum([TYP.HAK, TYP.SERTIFIKA, TYP.IPTAL, TYP.PAKET_IPTAL, TYP.MUAFIYET, TYP_GECICI]),
  yuk: z.record(z.string(), z.unknown()),
});

const SIGNER_OF: Readonly<Record<WrappedKeyFile["tur"], EntitlementSignerKind>> = {
  "tekserp-kok-anahtar": "KOK",
  "tekserp-bayi-anahtar": "BAYI",
  "tekserp-ara-anahtar": "ARA",
};

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
  if (request.typ === TYP_GECICI) {
    // Geçici açılış kodu sertifika taşıyamaz: fabrika yalnız gömülü kökü tanır — ara ve bayi anahtarı ASLA.
    if (file.tur !== "tekserp-kok-anahtar") return { ok: false, kod: "YETKISIZ", mesaj: "Geçici açılış kodunu yalnız kök imzalar" };
    const doc = decodeDocument(TempOpeningSchema, request.yuk);
    if (!doc.ok) return { ok: false, kod: "BICIM", mesaj: doc.message };
  } else if (request.typ === TYP.SERTIFIKA || request.typ === TYP.IPTAL || request.typ === TYP.PAKET_IPTAL) {
    // Sertifika, iptal ve dağıtım iptali YALNIZ kökün işidir: ara/bayi anahtarı kendi kuşağını basamaz, iptal edemez.
    if (file.tur !== "tekserp-kok-anahtar") return { ok: false, kod: "YETKISIZ", mesaj: "Sertifikayı ve iptal belgesini yalnız kök imzalar" };
    if (request.typ === TYP.SERTIFIKA) {
      const cert = decodeDocument(CertificateSchema, request.yuk);
      if (!cert.ok) return { ok: false, kod: "BICIM", mesaj: cert.message };
      if (!isSubset(cert.value.siniflar, file.siniflar)) {
        return { ok: false, kod: "YETKISIZ", mesaj: `Kök ${file.kid} bu sınıflara sertifika veremez` };
      }
    } else {
      const doc = request.typ === TYP.IPTAL ? decodeDocument(RevocationSchema, request.yuk) : decodeDocument(PackageRevocationSchema, request.yuk);
      if (!doc.ok) return { ok: false, kod: "BICIM", mesaj: doc.message };
    }
  } else if (request.typ === TYP.MUAFIYET) {
    const doc = decodeDocument(ExemptionSchema, request.yuk);
    if (!doc.ok) return { ok: false, kod: "BICIM", mesaj: doc.message };
    const refused = exemptionRefusal(file, doc.value);
    if (refused) return { ok: false, kod: "YETKISIZ", mesaj: refused };
  } else {
    const hak = decodeDocument(EntitlementSchema, request.yuk);
    if (!hak.ok) return { ok: false, kod: "BICIM", mesaj: hak.message };
    const refused = entitlementRefusal(file, hak.value);
    if (refused) return { ok: false, kod: "YETKISIZ", mesaj: refused };
  }
  const raw = await unwrapPrivateKey(file, password);
  password.fill(0);
  let belge: string;
  try {
    const privateKey = privateKeyFromRaw(raw);
    const key = { kid: file.kid, privateKey };
    belge =
      request.typ === TYP.SERTIFIKA
        ? signDocument({ typ: TYP.SERTIFIKA, schema: CertificateSchema, payload: request.yuk as never, key })
        : request.typ === TYP.IPTAL
          ? signDocument({ typ: TYP.IPTAL, schema: RevocationSchema, payload: request.yuk as never, key })
          : request.typ === TYP.PAKET_IPTAL
            ? signDocument({ typ: TYP.PAKET_IPTAL, schema: PackageRevocationSchema, payload: request.yuk as never, key })
            : request.typ === TYP.MUAFIYET
              ? signDocument({ typ: TYP.MUAFIYET, schema: ExemptionSchema, payload: request.yuk as never, key })
              : request.typ === TYP_GECICI
                ? signDocument({ typ: TYP_GECICI, schema: TempOpeningSchema, payload: request.yuk as never, key })
                : signDocument({ typ: TYP.HAK, schema: EntitlementSchema, payload: request.yuk as never, key });
  } finally {
    raw.fill(0);
  }
  return { ok: true, belge };
}

/**
 * HAK'ı bu anahtar imzalayabilir mi (parola açılmadan ÖNCE; ret metni döner). İmzacı türü DOSYADAN: kök kendi adına
 * (gömülü sertifika yok), bayi yalnız bayi sertifikalı, ara imzacı yalnız KENDİ sertifikasını gömülü taşıyan HAK'ı
 * imzalar. Sınıf yetkisi ve çevrimdışı ufuk tavanı (K2) burada da uygulanır — doğrulayıcının reddedeceği belge basılmaz.
 */
function entitlementRefusal(file: WrappedKeyFile, hak: EntitlementDoc): string | null {
  const signer = SIGNER_OF[file.tur];
  if (!file.siniflar.includes(hak.sinif)) return `Anahtar ${file.kid} ${hak.sinif} sınıfını imzalayamaz`;
  if ((signer === "BAYI") !== Boolean(hak.bayiSertifikasi)) return "Bayi imzası yalnız bayi sertifikalı HAK'ta";
  if ((signer === "ARA") !== Boolean(hak.imzaciSertifikasi)) return "Ara imzacı imzası yalnız ara imzacı sertifikalı HAK'ta";
  if (signer === "ARA" && (!file.sertifika || hak.imzaciSertifikasi !== file.sertifika)) {
    return `HAK'taki ara imzacı sertifikası ${file.kid} anahtarınınki değil`;
  }
  const ceiling = offlineHorizonCeilingDays(hak.sinif, signer);
  const horizon = hak.cevrimdisiUfukGun;
  if (horizon !== undefined && ceiling !== null && (horizon === null || horizon > ceiling)) {
    return `${hak.sinif} HAK'ı (${signer}) en çok ${ceiling} günlük çevrimdışı ufuk taşıyabilir`;
  }
  return null;
}

/**
 * Muafiyeti (G2) yalnız kök ya da HAK ara imzacısı basar; bayi ASLA (kendi müşterisini lisanssız bırakamaz). Ara
 * imzacı yalnız KENDİ sertifikasını gömülü taşıyan belgeyi, kök yalnız sertifikasız belgeyi imzalar (fabrikanın
 * doğrulayıcısı imzacıyı gömülü sertifikadan seçer).
 */
function exemptionRefusal(file: WrappedKeyFile, doc: ExemptionDoc): string | null {
  const signer = SIGNER_OF[file.tur];
  if (signer === "BAYI") return "Muafiyeti bayi anahtarı imzalayamaz";
  if (signer === "KOK") return doc.imzaciSertifikasi === undefined ? null : "Kök, ara imzacı sertifikalı muafiyeti imzalamaz";
  if (!file.sertifika || doc.imzaciSertifikasi !== file.sertifika) return `Muafiyetteki ara imzacı sertifikası ${file.kid} anahtarınınki değil`;
  return null;
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
