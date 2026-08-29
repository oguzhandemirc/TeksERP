// =============================================================================
// VERİ ONARIM ARACI — 2026-08-29 denetiminin ölçtüğü tutarsızlıklar
// Çalıştır: npx tsx scripts/fix_denetim_onarim.ts            (KURU KOŞUM — yazmaz)
//           npx tsx scripts/fix_denetim_onarim.ts --apply --kalem=O-12 --onay=<sayı>
// =============================================================================
// VARSAYILAN KURU KOŞUM (CLAUDE.md kuralı): hiçbir şey yazılmaz, yalnız
// "ne düzeltilecekti" kayıt kayıt listelenir. Yazma üç kapıdan geçer:
//   1. `--apply`             — niyet beyanı
//   2. `--kalem=O-XX`        — TEK kalem; "hepsini düzelt" yolu bilerek YOK
//   3. `--onay=<sayı>`       — kuru koşumda görülen satır sayısı; tutmazsa DURUR
// Üçüncüsü "listeyi okumadan uygulama" kazasını kapatır: sayı değişmişse veri
// değişmiş demektir ve karar yeniden verilmelidir.
//
// ⚠️ BU SCRIPT SAHADA KOŞAR. Geliştirme veritabanı sahadakinin GERİSİNDE
// (kullanıcı beyanı, 2026-08-29) — burada koşan bir onarım fabrikadaki veriyi
// düzeltmez; buradaki kuru koşum yalnız script'in kendisini sınar.
//
// KAPSAM — yalnız TÜRETİLEBİLİR ve KAYIPSIZ kalemlerde yazma yolu vardır:
//   O-12  traveler_cards.printedAt: hiç basılmamış kartın sahte "basım tarihi"
//   O-11  SWATCH etiket bağlam varsayılanı (eksik tek satır)
// Diğer 14 kalem YALNIZ SAYILIR ve listelenir — hepsi iş kararı ister
// (hangi rakam doğru, hangi mal kimin, hangi yetki kimde kalacak).
// Gerekçeler ve ölçümler: audit/RAPOR-2026-08-29.md §11.
// =============================================================================
import "dotenv/config";
import prisma, { pool } from "../src/lib/prisma";

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const KALEM = (argv.find((a) => a.startsWith("--kalem=")) ?? "").split("=")[1] ?? "";
const ONAY = Number((argv.find((a) => a.startsWith("--onay=")) ?? "").split("=")[1] ?? NaN);

function baslik(s: string): void {
  console.log(`\n${"─".repeat(78)}\n${s}\n${"─".repeat(78)}`);
}

interface Kalem {
  id: string;
  ad: string;
  bulgular: string;
  karar: "TURETILEBILIR" | "IS_KARARI";
  say: () => Promise<{ adet: number; ornek: string[] }>;
  uygula?: () => Promise<number>;
}

const KALEMLER: Kalem[] = [
  {
    id: "O-12",
    ad: "Hiç basılmamış kartın 'basım tarihi' (printedAt = createdAt)",
    bulgular: "BULGU-T2-024",
    karar: "TURETILEBILIR",
    say: async () => {
      const r = await prisma.$queryRaw<Array<{ id: string; no: string | null }>>`
        SELECT id, "cardNumber" AS no FROM traveler_cards
        WHERE "printedAt" IS NOT NULL
          AND abs(EXTRACT(EPOCH FROM ("printedAt" - "createdAt"))) < 1
        ORDER BY "createdAt" DESC`;
      return { adet: r.length, ornek: r.slice(0, 5).map((x) => `${x.no ?? x.id.slice(0, 8)}`) };
    },
    uygula: async () => {
      // KAYIPSIZ: değer zaten bilgi taşımıyor (kart doğuşunda damgalanmış).
      const r = await prisma.$executeRaw`
        UPDATE traveler_cards SET "printedAt" = NULL
        WHERE "printedAt" IS NOT NULL
          AND abs(EXTRACT(EPOCH FROM ("printedAt" - "createdAt"))) < 1`;
      return r;
    },
  },
  {
    id: "O-11",
    ad: "SWATCH etiket bağlam varsayılanı eksik",
    bulgular: "BULGU-T1-096",
    karar: "TURETILEBILIR",
    say: async () => {
      const r = await prisma.$queryRaw<Array<{ kind: string }>>`
        SELECT lt.kind::text AS kind
        FROM label_templates lt
        WHERE lt."isDefault" = true AND lt."isActive" = true
          AND NOT EXISTS (
            SELECT 1 FROM label_context_defaults d WHERE d.kind = lt.kind
          )
        GROUP BY lt.kind`;
      return { adet: r.length, ornek: r.map((x) => x.kind) };
    },
    // Yazma yolu BİLİNÇLİ OLARAK YOK: tablo/kolon adları saha şemasında
    // doğrulanamadı (bu oturumda DB erişimi yoktu). Sayım da şema hatası
    // verirse kalem "ölçülemedi" olarak raporlanır — uydurma INSERT yazmaktansa.
  },
  { id: "O-1", ad: "Sipariş defterine yazılmayan sevkiyat", bulgular: "T2-001, T3-002", karar: "IS_KARARI",
    say: async () => {
      const r = await prisma.$queryRaw<Array<{ no: string }>>`
        SELECT s."shipmentNumber" AS no
        FROM shipments s
        WHERE s.status = 'DISPATCHED'
          AND NOT EXISTS (SELECT 1 FROM sack_allocations a WHERE a."shipmentId" = s.id)
        ORDER BY s."dispatchedAt" DESC`;
      return { adet: r.length, ornek: r.slice(0, 5).map((x) => x.no) };
    } },
  { id: "O-3", ad: "currentQty > initialQty satırları", bulgular: "T1-044", karar: "IS_KARARI",
    say: async () => {
      const r = await prisma.$queryRaw<Array<{ b: string | null; c: string; i: string }>>`
        SELECT barcode AS b, "currentQty"::text AS c, "initialQty"::text AS i
        FROM rolls WHERE "currentQty" > "initialQty" ORDER BY "updatedAt" DESC`;
      return { adet: r.length, ornek: r.slice(0, 5).map((x) => `${x.b ?? "?"} ${x.i}→${x.c}`) };
    } },
  { id: "O-5", ad: "0 metrajlı hayalet toplar", bulgular: "T1-039", karar: "IS_KARARI",
    say: async () => {
      const r = await prisma.$queryRaw<Array<{ b: string | null }>>`
        SELECT barcode AS b FROM rolls
        WHERE status IN ('WAREHOUSE','A1_STOCK','STOCK') AND "currentQty" = 0`;
      return { adet: r.length, ornek: r.slice(0, 5).map((x) => x.b ?? "?") };
    } },
  { id: "O-7", ad: "İzsiz iptaller (cancelledAt / preCancelStatus / sebep kodu boş)", bulgular: "T1-033", karar: "IS_KARARI",
    say: async () => {
      const r = await prisma.$queryRaw<Array<{ n: bigint }>>`
        SELECT count(*) AS n FROM rolls
        WHERE status = 'CANCELLED' AND ("cancelledAt" IS NULL OR "cancelReasonCode" IS NULL)`;
      return { adet: Number(r[0]?.n ?? 0), ornek: [] };
    } },
  { id: "O-13", ad: "Kaynağı bilinmeyen yetkiler (grantedById NULL)", bulgular: "T2-012", karar: "IS_KARARI",
    say: async () => {
      const r = await prisma.$queryRaw<Array<{ n: bigint }>>`
        SELECT count(*) AS n FROM user_permissions WHERE "grantedById" IS NULL`;
      return { adet: Number(r[0]?.n ?? 0), ornek: [] };
    } },
  { id: "O-14", ad: "Yönetici hesaplarındaki PIN", bulgular: "T1-014", karar: "IS_KARARI",
    say: async () => {
      const r = await prisma.$queryRaw<Array<{ u: string }>>`
        SELECT u.username AS u FROM users u
        WHERE u."isActive" = true AND u."quickPin" IS NOT NULL`;
      return { adet: r.length, ornek: r.slice(0, 8).map((x) => x.u) };
    } },
];

async function main(): Promise<void> {
  console.log("VERİ ONARIM ARACI — denetim 2026-08-29");
  console.log(APPLY ? `MOD: UYGULAMA (kalem=${KALEM}, onay=${ONAY})` : "MOD: KURU KOŞUM — hiçbir şey yazılmaz");

  const db = await prisma.$queryRaw<Array<{ d: string }>>`SELECT current_database() AS d`;
  console.log(`Veritabanı: ${db[0]?.d ?? "?"}`);

  baslik("SAYIM");
  const sonuc = new Map<string, { adet: number; ornek: string[]; hata?: string }>();
  for (const k of KALEMLER) {
    try {
      const s = await k.say();
      sonuc.set(k.id, s);
      const etiket = k.karar === "TURETILEBILIR" ? "türetilebilir" : "İŞ KARARI";
      console.log(
        `${k.id.padEnd(5)} ${String(s.adet).padStart(5)} satır  [${etiket}]  ${k.ad}` +
          (s.ornek.length ? `\n         örnek: ${s.ornek.join(", ")}` : ""),
      );
    } catch (e) {
      const msg = (e as Error).message.split("\n")[0].slice(0, 120);
      sonuc.set(k.id, { adet: -1, ornek: [], hata: msg });
      console.log(`${k.id.padEnd(5)} ÖLÇÜLEMEDİ  ${k.ad}\n         sebep: ${msg}`);
    }
  }

  if (!APPLY) {
    baslik("SONRAKİ ADIM");
    console.log("Kayıpsız kalemleri uygulamak için (TEK kalem, sayı doğrulamalı):");
    for (const k of KALEMLER.filter((x) => x.uygula)) {
      const s = sonuc.get(k.id);
      if (s && s.adet > 0) console.log(`  npx tsx scripts/fix_denetim_onarim.ts --apply --kalem=${k.id} --onay=${s.adet}`);
    }
    console.log("\nİŞ KARARI isteyen kalemler bu araçla YAZILMAZ — rapor §11'deki");
    console.log("karar tablosuna göre ilgili birim (satış/muhasebe/üretim) onaylamalıdır.");
    await kapat(0);
    return;
  }

  // ── UYGULAMA ──────────────────────────────────────────────────────────────
  const kalem = KALEMLER.find((k) => k.id === KALEM);
  if (!kalem) return kapat(1, `--kalem=${KALEM} tanınmadı. Geçerli: ${KALEMLER.map((k) => k.id).join(", ")}`);
  if (!kalem.uygula) return kapat(1, `${kalem.id} bu araçla YAZILMAZ (iş kararı ister ya da yazma yolu yok).`);
  const s = sonuc.get(kalem.id);
  if (!s || s.adet < 0) return kapat(1, `${kalem.id} sayılamadı — uygulama yapılmadı.`);
  if (!Number.isFinite(ONAY)) return kapat(1, "--onay=<sayı> zorunlu (kuru koşumda görülen satır sayısı).");
  if (ONAY !== s.adet) {
    return kapat(1, `ONAY UYUŞMUYOR: kuru koşum ${s.adet} satır görüyor, --onay=${ONAY} verildi.\n` +
      "Veri değişmiş olabilir — listeyi yeniden okuyup kararı tazeleyin.");
  }

  baslik(`UYGULANIYOR — ${kalem.id}`);
  const yazilan = await kalem.uygula();
  console.log(`${yazilan} satır güncellendi.`);
  const tekrar = await kalem.say();
  console.log(`Kalan: ${tekrar.adet} satır (0 bekleniyor).`);
  await kapat(tekrar.adet === 0 ? 0 : 1);
}

async function kapat(kod: number, mesaj?: string): Promise<void> {
  if (mesaj) console.error(`\n⛔ ${mesaj}`);
  await prisma.$disconnect();
  await pool.end();
  process.exitCode = kod;
}

main().catch(async (e) => {
  console.error("BEKLENMEYEN HATA:", e);
  await kapat(1);
});
