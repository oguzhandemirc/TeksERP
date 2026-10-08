// DENETİM DEFTERİ (portal kullanıcılarının ayak izi; sunucuda süzülür, imleçli) ve ANAHTARLAR
// (yalnız AÇIK yarı + kid + tür + geçerlilik + çapa bilgisi — özel anahtar ve parolası hiçbir
// yanıtta yoktur).
import { useState } from "react";
import { Link } from "react-router-dom";
import { fmtDateTime } from "../../shared/format";
import { useGet, usePaged } from "../../shared/hooks";
import { CLASS_LABEL, KEY_KIND_LABEL, KEY_STATUS_LABEL, OPEN_CERT_USAGE_LABEL, label } from "../../shared/labels";
import type { AuditRow, KeyStatus } from "../../shared/types";
import { Badge, KeyValues, LoadMore, PageTitle, QueryState, Section, Table, type Column } from "../../shared/ui";

function summaryText(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v !== "object") return String(v);
  return Object.entries(v as Record<string, unknown>)
    .map(([k, x]) => `${k}: ${typeof x === "object" ? JSON.stringify(x) : String(x)}`)
    .join(" · ");
}

export function AuditPage() {
  const [entity, setEntity] = useState("");
  const [entityId, setEntityId] = useState("");
  const [event, setEvent] = useState("");
  const list = usePaged<AuditRow>(["denetim"], "/denetim", { varlik: entity.trim() || undefined, varlikId: entityId.trim() || undefined, olay: event.trim() || undefined });
  return (
    <>
      <PageTitle title="Denetim defteri" sub="Portal kullanıcılarının eylemleri ve girişleri. Başarısız giriş satırları 90 gün, diğerleri 2 yıl saklanır." />
      <Section title="Kayıtlar">
        <div className="toolbar">
          <input placeholder="Varlık (ör. Kurulum)" aria-label="Varlık" value={entity} onChange={(e) => setEntity(e.target.value)} />
          <input placeholder="Varlık kimliği" aria-label="Varlık kimliği" value={entityId} onChange={(e) => setEntityId(e.target.value)} />
          <input placeholder="Olay (ör. YAPTIRIM_K4)" aria-label="Olay" value={event} onChange={(e) => setEvent(e.target.value)} />
        </div>
        <QueryState isLoading={list.isLoading} error={list.error} />
        <Table
          rows={list.rows}
          rowKey={(r) => r.id}
          columns={[
            { header: "Zaman", render: (r) => fmtDateTime(r.createdAt) },
            { header: "Olay", render: (r) => r.olay },
            { header: "Varlık", render: (r) => r.varlik },
            { header: "Kimlik", render: (r) => (r.varlikId ? <code>{r.varlikId.slice(0, 8)}</code> : "—") },
            { header: "Yapan", render: (r) => r.yapan },
            { header: "Özet", render: (r) => <span className="small">{summaryText(r.ozet)}</span> },
          ]}
        />
        <LoadMore hasMore={list.hasMore} loading={list.loadingMore} onClick={list.loadMore} />
      </Section>
    </>
  );
}

type KeyRow = KeyStatus["anahtarlar"][number];

/** Sertifikalı anahtarda (ALT · İNDİRME · ARA) kalan gün ≤ 30 ise tören uyarısı (`ANAHTAR_SURESI_BITIYOR` ile aynı eşik). */
function daysLeft(r: KeyRow, nowMs: number): number | null {
  if (!r.bitis || r.durum !== "AKTIF") return null;
  return Math.ceil((Date.parse(r.bitis) - nowMs) / 86_400_000);
}

function keyColumns(nowMs: number, retired: boolean): Column<KeyRow>[] {
  return [
    { header: "Kid", render: (r) => <code>{r.kid}</code> },
    { header: "Tür", render: (r) => label(KEY_KIND_LABEL, r.tur) },
    { header: "Açık anahtar", render: (r) => <code>{r.acikAnahtar.slice(0, 16)}…</code> },
    { header: "Sınıflar", render: (r) => r.siniflar.map((c) => label(CLASS_LABEL, c)).join(", ") || "—" },
    { header: "Sertifika", render: (r) => (r.sertifikaVeren ? `kök imzalı (${r.sertifikaVeren})` : "—") },
    {
      header: "Geçerlilik",
      render: (r) => {
        const left = daysLeft(r, nowMs);
        return (
          <>
            {`${fmtDateTime(r.baslangic)} → ${fmtDateTime(r.bitis)}`} {left !== null && left <= 30 && left >= 0 ? <Badge tone="warn">{`${left} gün kaldı — dönem töreni`}</Badge> : null}
          </>
        );
      },
    },
    ...(retired
      ? []
      : [
          { header: "Durum", render: (r: KeyRow) => label(KEY_STATUS_LABEL, r.durum) },
          {
            header: "Yükleme",
            render: (r: KeyRow) => (
              <>
                {r.yuklu ? (
                  <Badge tone="ok">Yüklü</Badge>
                ) : r.tur === "KOK" && r.capada ? (
                  <Badge tone="ok">Bu sunucuda değil — kök Mac'te (beklenen)</Badge>
                ) : (
                  <Badge>Yüklü değil</Badge>
                )}{" "}
                {r.suresiDoldu ? <Badge tone="danger">Süresi doldu</Badge> : null}{" "}
                {r.capada === false ? <Badge tone="danger">Çapada yok</Badge> : null}
              </>
            ),
          },
        ]),
    { header: "Son değişim", render: (r) => fmtDateTime(r.updatedAt) },
  ];
}

type OpenRow = NonNullable<KeyStatus["acikSertifikalar"]>[number];

function openStatus(r: OpenRow, nowMs: number) {
  if (r.iptalSira !== null) return <Badge tone="danger">{`İptal (dağıtım iptali sıra ${r.iptalSira})`}</Badge>;
  if (r.suresiDoldu) return <Badge tone="danger">Süresi doldu</Badge>;
  const ends = [Date.parse(r.bitis), ...r.otaYapraklari.map((l) => Date.parse(l.bitis))];
  const left = Math.ceil((Math.min(...ends) - nowMs) / 86_400_000);
  // Sertifika geçerli ama bağlı OTA yaprağı bitmiş: tablet güncellemesi imzalanamaz.
  if (left <= 0) return <Badge tone="danger">OTA yaprağının süresi doldu</Badge>;
  return left <= 30 ? <Badge tone="warn">{`${left} gün kaldı — dönem töreni`}</Badge> : <Badge tone="ok">Geçerli</Badge>;
}

const OPEN_COLUMNS = (nowMs: number): Column<OpenRow>[] => [
  { header: "Kid", render: (r) => <code>{r.kid}</code> },
  { header: "Kullanım", render: (r) => label(OPEN_CERT_USAGE_LABEL, r.kullanim) },
  { header: "Açık anahtar", render: (r) => <code>{r.acikAnahtar.slice(0, 16)}…</code> },
  { header: "Sertifika", render: (r) => (r.sertifikaVeren ? `kök imzalı (${r.sertifikaVeren})` : "—") },
  { header: "Geçerlilik", render: (r) => `${fmtDateTime(r.baslangic)} → ${fmtDateTime(r.bitis)}` },
  {
    header: "Tablet OTA yaprağı",
    render: (r) =>
      r.otaYapraklari.length === 0
        ? "—"
        : r.otaYapraklari.map((l) => (
            <div key={l.dosya} className="small">
              <code>{l.parmakIzi.slice(0, 23)}…</code> {`${fmtDateTime(l.baslangic)} → ${fmtDateTime(l.bitis)}`}
            </div>
          )),
  },
  { header: "Durum", render: (r) => openStatus(r, nowMs) },
];

export function KeysPage() {
  const q = useGet<KeyStatus>(["anahtarlar"], "/anahtarlar");
  const k = q.data;
  const nowMs = Date.now();
  const active = k?.anahtarlar.filter((r) => r.durum !== "EMEKLI") ?? [];
  const retired = k?.anahtarlar.filter((r) => r.durum === "EMEKLI") ?? [];
  return (
    <>
      <PageTitle
        title="Anahtarlar"
        sub="Yalnız açık yarılar ve künye; özel anahtarlar parolalı dosyalarda, bu ekrana hiç gelmez. Üretimde kök bu sunucuda durmaz: HAK'ı kök imzalı sertifikalı ara imzacı imzalar."
        actions={<Link to="/iptal-belgeleri">İptal belgeleri</Link>}
      />
      <QueryState isLoading={q.isLoading} error={q.error} />
      {k ? (
        <>
          <Section title="Durum">
            <KeyValues
              items={[
                ["Kira imzalanabilir", k.kiraImzalayabilir ? <Badge tone="ok">Evet</Badge> : <Badge tone="danger">Hayır — alt anahtar yüklü değil</Badge>],
                ["Etkin indirme anahtarı", k.indirmeAnahtari ? <code>{k.indirmeAnahtari}</code> : <Badge tone="warn">Yok</Badge>],
                ["Güven çapası kaynağı", k.capa.kaynak],
              ]}
            />
            {k.uyarilar.length > 0 ? (
              <ul className="warn-box">
                {k.uyarilar.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            ) : null}
          </Section>
          <Section title="Güven çapası (kök açık anahtarları)">
            <Table
              rows={k.capa.kokler}
              rowKey={(r) => r.kid}
              columns={[
                { header: "Kid", render: (r) => <code>{r.kid}</code> },
                { header: "Açık anahtar", render: (r) => <code>{r.x.slice(0, 16)}…</code> },
                { header: "Sınıflar", render: (r) => r.siniflar.map((c) => label(CLASS_LABEL, c)).join(", ") },
              ]}
            />
          </Section>
          <Section title="Anahtar künyesi">
            <Table rows={active} rowKey={(r) => r.kid} columns={keyColumns(nowMs, false)} />
          </Section>
          <Section title="İstemci ve paket sertifikaları (açık)">
            <p className="muted small">
              Satıcı bu anahtarları TUTMAZ: panel/tablet güncelleme imzası (birincil + yedek) ve paket imzası Mac'te ya da yedek biriminde durur; burada yalnız kök
              imzalı açık sertifikaları görünür (anahtar biriminin <code>istemci/</code> · <code>paket/</code> alt dizinleri) — süre uyarısı ve iptal durumu için.
            </p>
            <Table rows={k.acikSertifikalar ?? []} rowKey={(r) => r.kid} empty="Anahtar biriminde açık sertifika yok" columns={OPEN_COLUMNS(nowMs)} />
          </Section>
          <Section title="Emekli anahtarlar">
            <p className="muted small">Özel yarısı dönem töreninde silindi; açık yarı + sertifika yalnız eski imzaları doğrulamak için künyede kalır.</p>
            <Table rows={retired} rowKey={(r) => r.kid} empty="Emekli anahtar yok" columns={keyColumns(nowMs, true)} />
          </Section>
        </>
      ) : null}
    </>
  );
}
