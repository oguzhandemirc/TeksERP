// DENETİM DEFTERİ (portal kullanıcılarının ayak izi; sunucuda süzülür, imleçli) ve ANAHTARLAR
// (yalnız AÇIK yarı + kid + tür + geçerlilik + çapa bilgisi — özel anahtar ve parolası hiçbir
// yanıtta yoktur).
import { useState } from "react";
import { fmtDateTime } from "../../shared/format";
import { useGet, usePaged } from "../../shared/hooks";
import { CLASS_LABEL, label } from "../../shared/labels";
import type { AuditRow, KeyStatus } from "../../shared/types";
import { Badge, KeyValues, LoadMore, PageTitle, QueryState, Section, Table } from "../../shared/ui";

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

const KEY_KIND_LABEL: Record<string, string> = { KOK: "Kök", HAZIRLIK_KOK: "Hazırlık kökü", ALT: "Alt (kira imzası)", INDIRME: "İndirme belirteci", BAYI: "Bayi" };
const KEY_STATUS_LABEL: Record<string, string> = { AKTIF: "Aktif", EMEKLI: "Emekli", IPTAL: "İptal" };

export function KeysPage() {
  const q = useGet<KeyStatus>(["anahtarlar"], "/anahtarlar");
  const k = q.data;
  return (
    <>
      <PageTitle title="Anahtarlar" sub="Yalnız açık yarılar ve künye; özel anahtarlar parolalı dosyalarda, bu ekrana hiç gelmez." />
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
            <Table
              rows={k.anahtarlar}
              rowKey={(r) => r.kid}
              columns={[
                { header: "Kid", render: (r) => <code>{r.kid}</code> },
                { header: "Tür", render: (r) => label(KEY_KIND_LABEL, r.tur) },
                { header: "Açık anahtar", render: (r) => <code>{r.acikAnahtar.slice(0, 16)}…</code> },
                { header: "Sınıflar", render: (r) => r.siniflar.map((c) => label(CLASS_LABEL, c)).join(", ") || "—" },
                { header: "Geçerlilik", render: (r) => `${fmtDateTime(r.baslangic)} → ${fmtDateTime(r.bitis)}` },
                { header: "Durum", render: (r) => label(KEY_STATUS_LABEL, r.durum) },
                {
                  header: "Yükleme",
                  render: (r) => (
                    <>
                      {r.yuklu ? <Badge tone="ok">Yüklü</Badge> : <Badge>Yüklü değil</Badge>} {r.suresiDoldu ? <Badge tone="danger">Süresi doldu</Badge> : null}{" "}
                      {r.capada === false ? <Badge tone="danger">Çapada yok</Badge> : null}
                    </>
                  ),
                },
                { header: "Son değişim", render: (r) => fmtDateTime(r.updatedAt) },
              ]}
            />
          </Section>
        </>
      ) : null}
    </>
  );
}
