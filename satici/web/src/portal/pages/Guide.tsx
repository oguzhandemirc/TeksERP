// KILAVUZ — anahtarlar, parolalar ve yıllık tören, bilmeyenin anlayacağı dille. Sayfada HİÇBİR sır yok: yalnız
// ne işe yaradıkları ve nerede durdukları. Sıradaki tören tarihi anahtar künyesinden (`GET /anahtarlar`) CANLI
// türetilir; seçim sunucunun süre uyarısıyla aynıdır (notifications/key-expiry.ts) — bekçi: test/guide.test.tsx.
import { Link } from "react-router-dom";
import { fmtDate } from "../../shared/format";
import { useGet } from "../../shared/hooks";
import { KEY_KIND_LABEL, label } from "../../shared/labels";
import { useCan } from "../../shared/session";
import type { KeyStatus } from "../../shared/types";
import { Badge, PageTitle, QueryState, Section, Table } from "../../shared/ui";

/** Tören günü: en erken biten sertifikanın bitişinden bu kadar gün önce (tören aracındaki örtüşme = ilk uyarı eşiği). */
export const CEREMONY_LEAD_DAYS = 30;
/** Satıcının `ANAHTAR_SURESI_BITIYOR` eşikleri — sunucu `KEY_EXPIRY_WARNING_DAYS` aynası. */
export const KEY_EXPIRY_WARNING_DAYS = [30, 15, 7, 1] as const;
/** Törenle yenilenen kullanımlar — sunucu `ExpiringKeyUsage` aynası. */
export const CEREMONY_USAGES = ["ALT", "ARA", "INDIRME"] as const;
const DAY_MS = 86_400_000;

type KeyRow = KeyStatus["anahtarlar"][number];

export interface CeremonyPlan {
  /** Önce bitecek kullanımın en yeni sertifikası. */
  readonly tur: string;
  readonly kid: string;
  readonly endMs: number;
  readonly ceremonyMs: number;
  /** Bu kullanımlarda yüklü anahtar yok (künye uyarısı ayrıca Anahtarlar sayfasında). */
  readonly missing: readonly string[];
}

/**
 * Kullanım başına (ALT · ara imzacı · İNDİRME) yüklü, aktif en geç biten sertifika; bunların EN ERKENİ sıradaki
 * törenin bitişidir, tören günü ondan {@link CEREMONY_LEAD_DAYS} gün öncedir. Hiç anahtar yoksa null.
 */
export function nextCeremony(rows: readonly KeyRow[]): CeremonyPlan | null {
  const latest = new Map<string, { kid: string; endMs: number }>();
  for (const r of rows) {
    if (!(CEREMONY_USAGES as readonly string[]).includes(r.tur) || !r.yuklu || r.durum !== "AKTIF" || !r.bitis) continue;
    const endMs = Date.parse(r.bitis);
    const cur = latest.get(r.tur);
    if (Number.isFinite(endMs) && (!cur || endMs > cur.endMs)) latest.set(r.tur, { kid: r.kid, endMs });
  }
  let first: { tur: string; kid: string; endMs: number } | null = null;
  for (const [tur, v] of latest) if (!first || v.endMs < first.endMs) first = { tur, ...v };
  if (!first) return null;
  return {
    ...first,
    ceremonyMs: first.endMs - CEREMONY_LEAD_DAYS * DAY_MS,
    missing: CEREMONY_USAGES.filter((u) => !latest.has(u)),
  };
}

function NextCeremony() {
  const canRead = useCan("anahtar:oku");
  const q = useGet<KeyStatus>(["anahtarlar"], "/anahtarlar", undefined, canRead);
  if (!canRead) return <p className="muted">Anahtar bilgisini görme izniniz yok; tarihi yöneticiye sorun.</p>;
  if (!q.data) return <QueryState isLoading={q.isLoading} error={q.error} />;
  const plan = nextCeremony(q.data.anahtarlar);
  if (!plan) return <p className="warn-box">Yüklü anahtar bulunamadı — Anahtarlar sayfasına bakın ve Claude'a haber verin.</p>;
  const nowMs = Date.now();
  const toCeremony = Math.ceil((plan.ceremonyMs - nowMs) / DAY_MS);
  const toEnd = Math.ceil((plan.endMs - nowMs) / DAY_MS);
  const who = `${label(KEY_KIND_LABEL, plan.tur)} · ${plan.kid}`;
  return (
    <>
      <p data-testid="sonraki-toren">
        <strong>Sıradaki tören: {fmtDate(new Date(plan.ceremonyMs).toISOString())}</strong>{" "}
        {toEnd <= 0 ? (
          <Badge tone="danger">Süre doldu — tören hemen yapılmalı</Badge>
        ) : toCeremony <= 0 ? (
          <Badge tone="warn">{`Tören zamanı geldi — bitişe ${toEnd} gün`}</Badge>
        ) : (
          <Badge tone="ok">{`${toCeremony} gün kaldı`}</Badge>
        )}
      </p>
      <p className="muted small">
        İlk bitecek anahtar: {who} ({fmtDate(new Date(plan.endMs).toISOString())}). Tören bu bitişten {CEREMONY_LEAD_DAYS} gün önce yapılır; yeni anahtarlar bir yıl +{" "}
        {CEREMONY_LEAD_DAYS} gün geçerlidir, eskileriyle {CEREMONY_LEAD_DAYS} gün birlikte çalışır.
      </p>
      {plan.missing.length > 0 ? (
        <p className="warn-box">{`Yüklü anahtarı olmayan tür: ${plan.missing.map((u) => label(KEY_KIND_LABEL, u)).join(", ")} — Anahtarlar sayfasına bakın.`}</p>
      ) : null}
    </>
  );
}

interface Item {
  readonly ad: string;
  readonly ne: string;
  readonly nerede: string;
}

const ITEMS: readonly Item[] = [
  {
    ad: "Kök anahtar",
    ne: "Bütün imzaların en üstü. Yalnız yılda bir törende ara anahtarları (aşağıdakiler) ve iptal belgesini, nadiren de tek tek lisansları imzalar.",
    nerede: "Mac'te parolalı dosya (~/.tekserp/satici-uretim) ve Drive'daki kurtarma arşivinin içinde. Sunucuda DURMAZ.",
  },
  {
    ad: "Kök parolası",
    ne: "Kök anahtarı açar. Yalnız törende, sizin Terminal pencerenizde bir kez yazılır.",
    nerede: "Yalnız kâğıtta (kasada). Hiçbir dosyada, mesajda, sohbette yok.",
  },
  {
    ad: "Ara imzacı",
    ne: "Portalda lisansları (HAK) imzalar; kök her gün gerekmesin diye vardır. Yılda bir yenilenir.",
    nerede: "Satıcı sunucusunda parolalı dosya; Mac'teki tören klasöründe kopyası.",
  },
  {
    ad: "Ara imzacı parolası",
    ne: "Portalda lisans imzalarken (sürüm formu) yazılır. Kök parolasından farklıdır.",
    nerede: "Parola yöneticisinde \"TeksERP ara-2026-1\" kaydı (her törende yeni ad: ara-<yıl>-<sıra>).",
  },
  {
    ad: "Kira anahtarı (ALT)",
    ne: "Fabrikalara süreli kira imzalar; kendiliğinden çalışır, parolası yok. Yılda bir yenilenir.",
    nerede: "Satıcı sunucusunda; Mac'teki tören klasöründe kopyası.",
  },
  {
    ad: "İndirme anahtarı",
    ne: "Güncelleme indirme izni imzalar; açık yarısı Cloudflare'deki indirme kapısında durur. Yılda bir yenilenir.",
    nerede: "Satıcı sunucusunda; Mac'teki tören klasöründe kopyası.",
  },
  {
    ad: "Kurtarma klasörü",
    ne: "Mac kaybolursa her şeyi geri getirir (kurtarma arşivi + kurtarma anahtarı + künye). Açmak için kâğıttaki kök parolası gerekir.",
    nerede: "Google Drive'da \"TeksERP-Drive-Yedek\" klasörü.",
  },
];

export function GuidePage() {
  return (
    <>
      <PageTitle title="Kılavuz" sub="Anahtarlar, parolalar ve yıllık tören — kısa ve sade. Bu sayfada hiçbir parola ya da gizli bilgi yoktur." />

      <Section title="Yıllık tören — ne zaman">
        <NextCeremony />
      </Section>

      <Section title="Neyi, nerede tutuyoruz">
        <Table
          rows={ITEMS}
          rowKey={(r) => r.ad}
          columns={[
            { header: "Ne", render: (r) => <strong>{r.ad}</strong> },
            { header: "Ne işe yarar", render: (r) => r.ne },
            { header: "Nerede durur", render: (r) => r.nerede },
          ]}
        />
      </Section>

      <Section title="Yıllık tören — nasıl">
        <ol>
          <li>Uyarı gelince (ya da yukarıdaki tarih yaklaşınca) Claude'a <strong>"dönem töreni yapalım"</strong> deyin.</li>
          <li>Claude komutları hazırlar: temiz bir kopya, sunucudan bekleyen işler, sonraki adımlar.</li>
          <li>Komutu <strong>kendi ayrı Terminal pencerenizde</strong> çalıştırırsınız: kök parolasını kâğıttan bir kez, yeni ara imzacı parolasını iki kez yazarsınız.</li>
          <li>Yeni ara imzacı parolasını hemen parola yöneticisine kaydedin (yeni ad: "TeksERP ara-&lt;yıl&gt;-&lt;sıra&gt;").</li>
          <li>Claude kalan adımları sizinle bitirir (indirme kapısı, sunucu). Sonunda <Link to="/anahtarlar">Anahtarlar</Link> sayfasında yeni anahtarlar "Yüklü" görünür.</li>
        </ol>
        <p className="muted small">
          Toplam yaklaşık yarım saat. Eski anahtarlar 30 gün daha çalışır, sonra emekliye ayrılır. Program paketinin imza anahtarı da ileride bu törene katılacak.
        </p>
      </Section>

      <Section title="Uyarılar nereden gelir">
        <p>
          Satıcı, ilk bitecek anahtarın bitişine {KEY_EXPIRY_WARNING_DAYS.join(" · ")} gün kala "Anahtar süresi bitiyor" bildirimi gönderir:{" "}
          <Link to="/bildirimler">Bildirimler</Link> sayfası ve açık bildirim kanalları (Telegram, e-posta). 30 gün kala gelen ilk uyarı tören günüdür.
          Anahtarlar sayfasında da "N gün kaldı" rozeti çıkar.
        </p>
        <p className="muted small">Tören kaçarsa fabrikalar hemen durmaz (ödenmiş tarihlerine dek çalışır), ama satıcı yeni kira, lisans ve indirme izni imzalayamaz.</p>
      </Section>

      <Section title="Kök imzası gereken nadir durumlar">
        <ul>
          <li>Bayi anahtarı ya da bayi/barındırılan sınıfı lisans.</li>
          <li>Ara imzacıyı tanımayan eski sürümdeki bir fabrikanın lisans değişikliği.</li>
          <li>Bir anahtarın iptali (iptal belgesi).</li>
        </ul>
        <p>
          Bunlar <Link to="/kok-kuyrugu">Kök imzası kuyruğu</Link>na düşer ve törende imzalanır. ACİL işaretli talep varsa tören beklenmez — Claude'a haber verin.
        </p>
      </Section>

      <Section title="Bir şey kaybolursa">
        <ul>
          <li>
            <strong>Mac kayboldu:</strong> Drive'daki "TeksERP-Drive-Yedek" klasörü + kâğıttaki kök parolası ile yeni Mac'e geri gelir (Claude'la birlikte).
          </li>
          <li>
            <strong>Ara imzacı parolası kayboldu:</strong> yeni bir tören yapılır, yeni ara imzacı çıkar; eskisi emekliye ayrılır. Fabrikalar etkilenmez.
          </li>
          <li>
            <strong>Kök parolası kayboldu:</strong> çok ciddi. Kök bir daha açılamaz; yeni kök gerekir ve bu, her fabrikaya yeni program sürümü ve bütün lisansların
            yeniden imzalanması demektir. Bu yüzden kâğıt kasada durur.
          </li>
        </ul>
      </Section>

      <Section title="Yapılmayacaklar">
        <ul>
          <li>Kök anahtar sunucuya (VDS) kalıcı olarak konmaz.</li>
          <li>Parolalar sohbete (Claude dahil), e-postaya, mesaja ya da ekran görüntüsüne yazılmaz.</li>
          <li>Kök parolası ile ara imzacı parolası aynı olmaz.</li>
        </ul>
      </Section>
    </>
  );
}
