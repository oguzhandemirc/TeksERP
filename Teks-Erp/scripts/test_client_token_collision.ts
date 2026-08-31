// =============================================================================
// BEKÇİ — "AYNI TOKEN, FARKLI GÖVDE" (BULGU-T4-003)
// Çalıştır: npx tsx scripts/test_client_token_collision.ts
// =============================================================================
// Bir `clientToken`ın anlamı "bu MANTIKSAL denemeyi bir kez uygula"dır. Token
// eşleşince mevcut kaydı döndürmek ancak gelen gövde ÖZDEŞSE doğrudur; değilse
// sunucunun "başarılı" demesi operatörün DÜZELTMESİNİ sessizce yutar:
//
//   40 m kesilir → istek zaman aşımına uğrar (ama COMMIT olmuştur) → operatör
//   yeniden ölçüp 25 m yazar → aynı token gider → sunucu ilk kesimin 40 m'lik
//   çocuğunu "Kesim zaten kaydedilmiş" diye döndürür. 25 m HİÇ yazılmaz.
//
// §1 SAF KARAR      — yardımcının kendisi (Decimal tuzağı, null denkliği, boş liste)
// §2 ENVANTER       — token'la replay okuyan HER servis ya kapıdan geçer ya
//                     gerekçeli muaftır (İKİ YÖNLÜ: ölü/hayalet muaf da kırmızı)
// §3 UÇTAN UCA      — çuval açma: aynı token + FARKLI müşteri → 409;
//                     aynı token + AYNI müşteri → 200 (bugünkü davranış korunur)
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { Prisma } from "@prisma/client";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import {
  assertReplayPayloadMatches,
  replayAlaniAyni,
} from "../src/services/helpers/idempotent-replay.helper";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
function hataKodu(fn: () => void): string {
  try {
    fn();
    return "(hata yok)";
  } catch (e) {
    return String((e as { details?: { code?: string } }).details?.code ?? (e as Error).message);
  }
}

/**
 * Token'la replay OKUYAN servisler ve her birinin gövde kapısı durumu.
 * ⚠️ Muaf "kapı gerekmiyor" demektir — "gerekli ama geçsin" DEĞİL.
 */
const MUAFLAR: Record<string, string> = {
  "tambur-manual.service.ts":
    "token yalnız 'bu deneme İPTAL edilmiş mi' (T1-006) sorusu için okunuyor; yanlış-durum hâlini FAZ 2 atomik claim'i zaten 409'luyor",
  "import.service.ts":
    "token bir ÇALIŞMA claim'i (ImportRun); farklı gövde hâli finishedAt/IMPORT_IN_PROGRESS ile kapalı (T1-008)",
  "subcontractor.service.ts":
    "⚠️ AÇIK BORÇ — fason kabulünde sunucu tarafı gövde kıyaslamıyor. İstemci tarafı 2026-08-31'de parmak izi + 10 dk penceresiyle kapatıldı (BULGU-T2-007); sunucu kapısı AYRI iş (kimlik = returns kümesi + receivedQty'ler, kısmi teslimatta meşruen tekrar eden top kümesiyle çakışmamalı)",
};
/** Kendi satır-içi F117 kopyasını taşıyanlar — ortaklaştırma ayrı iş. */
const KENDI_KONTROLU = ["workorder.service.ts", "order.service.ts", "kartela.service.ts"];

async function main(): Promise<void> {
  // ═══ §1 — SAF KARAR ═══
  console.log("\n=== §1: yardımcının kendisi ===");
  check(
    "§1: Decimal'ler DEĞERCE karşılaştırılır",
    replayAlaniAyni(new Prisma.Decimal("40.000"), 40),
    "40.000 ≡ 40",
  );
  // ⚠️ Bu, yardımcının en kolay kaybedilen özelliği: `===` iki Decimal nesnesini
  // ASLA eşit saymaz → kapı her replay'i 409'a çevirir (koruma değil ARIZA).
  check(
    "§1: farklı Decimal değeri AYNI sayılmaz",
    !replayAlaniAyni(new Prisma.Decimal("40"), 25),
  );
  check("§1: null ile undefined AYNI ('alan yok' ≡ 'alan boş')", replayAlaniAyni(null, undefined));
  check("§1: null ile dolu değer FARKLI", !replayAlaniAyni(null, "x"));

  check(
    "§1: özdeş kimlikte hata YOK",
    hataKodu(() =>
      assertReplayPayloadMatches([{ ad: "a", mevcut: "1", gelen: "1" }], "m"),
    ) === "(hata yok)",
  );
  check(
    "§1: farklı kimlikte 409 CLIENT_TOKEN_COLLISION",
    hataKodu(() => assertReplayPayloadMatches([{ ad: "a", mevcut: "1", gelen: "2" }], "m")) ===
      "CLIENT_TOKEN_COLLISION",
  );
  // Boş liste = kapının vakumen açılması. Programlama hatası olarak patlamalı.
  check(
    "§1: BOŞ kimlik listesi hata verir (kapı sessizce açılamaz)",
    hataKodu(() => assertReplayPayloadMatches([], "m")).includes("boş olamaz"),
  );

  // ═══ §2 — ENVANTER (iki yönlü) ═══
  console.log("\n=== §2: token replay okuyan her servis ===");
  const dizin = join(__dirname, "../src/services");
  const dosyalar: string[] = [];
  const gez = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) gez(join(d, e.name));
      else if (e.name.endsWith(".service.ts")) dosyalar.push(join(d, e.name));
    }
  };
  gez(dizin);
  check("§2: servis dosyaları tarandı (körlük zemini)", dosyalar.length > 25, `${dosyalar.length} dosya`);

  const okuyucular: string[] = [];
  const kapisiz: string[] = [];
  for (const yol of dosyalar) {
    const src = readFileSync(yol, "utf8");
    // Yorumlar ayıklanır — "kodu değil yorumu eşlemek" bu turda iki kez ısırdı.
    const kod = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    if (!kod.includes("where: { clientToken")) continue;
    const ad = yol.split("/").pop() as string;
    okuyucular.push(ad);
    const kapili =
      kod.includes("assertReplayPayloadMatches(") || kod.includes("CLIENT_TOKEN_COLLISION");
    if (!kapili && !(ad in MUAFLAR)) kapisiz.push(ad);
  }
  check("§2: replay okuyucusu bulundu (körlük zemini)", okuyucular.length >= 8, okuyucular.join(", "));
  check(
    "§2a: gövde kapısı olmayan replay okuyucusu YOK",
    kapisiz.length === 0,
    kapisiz.join(", ") || "hepsi kapılı ya da gerekçeli muaf",
  );
  const oluMuaf = Object.keys(MUAFLAR).filter((m) => !okuyucular.includes(m));
  check("§2b: ölü muaf yok", oluMuaf.length === 0, oluMuaf.join(", ") || "muaf listesi güncel");
  // Kendi kopyasını taşıyanlar gerçekten taşıyor mu (borç kaydı bayatlamasın).
  const bozukBorc = KENDI_KONTROLU.filter(
    (m) => !okuyucular.includes(m) || !readFileSync(join(dizin, m), "utf8").includes("CLIENT_TOKEN_COLLISION"),
  );
  check(
    "§2c: 'kendi kontrolü var' listesi doğru",
    bozukBorc.length === 0,
    bozukBorc.join(", ") || KENDI_KONTROLU.join(", "),
  );

  // ═══ §3 — UÇTAN UCA (çuval açma) ═══
  console.log("\n=== §3: çuval açma — aynı token, farklı müşteri ===");
  const damga = `TEST-T4003-${Date.now().toString().slice(-8)}`;
  const olusan = { musteri: [] as string[], cuval: [] as string[] };
  try {
    const { ShippingService } = await import("../src/services/shipping.service");
    const svc = new ShippingService();
    const a = await prisma.customer.create({ data: { code: `${damga}-A`, name: `${damga} A` } });
    const b = await prisma.customer.create({ data: { code: `${damga}-B`, name: `${damga} B` } });
    olusan.musteri.push(a.id, b.id);

    const token = crypto.randomUUID();
    const ilk = (await svc.openSack({ customerId: a.id, clientToken: token })) as {
      data: { id: string; sackNo: string };
    };
    olusan.cuval.push(ilk.data.id);
    check("§3: ilk açılış başarılı", Boolean(ilk.data.id), ilk.data.sackNo);

    // ⭐ AYNI token, FARKLI müşteri → 409. Eskiden A'nın çuvalı "Çuval açıldı"
    // diye dönüyordu ve toplar YANLIŞ müşterinin çuvalına okutuluyordu.
    let kod = "(hata yok)";
    try {
      await svc.openSack({ customerId: b.id, clientToken: token });
    } catch (e) {
      kod = String((e as { details?: { code?: string } }).details?.code ?? (e as Error).message);
    }
    check("§3: FARKLI müşteri + aynı token → 409", kod === "CLIENT_TOKEN_COLLISION", kod);

    // Aynı gövde → bugünkü idempotent davranış BOZULMAMALI (regresyon sondası).
    const tekrar = (await svc.openSack({ customerId: a.id, clientToken: token })) as {
      data: { id: string };
    };
    check(
      "§3: AYNI müşteri + aynı token → aynı çuval (idempotent korunuyor)",
      tekrar.data.id === ilk.data.id,
      tekrar.data.id === ilk.data.id ? "aynı id" : "FARKLI id döndü",
    );
  } finally {
    await prisma.sack.deleteMany({ where: { id: { in: olusan.cuval } } }).catch(() => undefined);
    await prisma.customer.deleteMany({ where: { id: { in: olusan.musteri } } }).catch(() => undefined);
  }
}

main()
  .catch((e) => {
    console.error("Beklenmeyen hata:", e);
    fail++;
  })
  .finally(async () => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
