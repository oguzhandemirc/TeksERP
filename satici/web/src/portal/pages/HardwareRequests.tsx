// DONANIM / ZAYIF TANIMA ONAY EKRANI (lisans v2 K8): güçlü etkenleri (F2 · F3 · F4) tutmayan donanım bildirimi ve
// etkinleştirmede zayıf tanınan kurulum burada onaylanır ya da reddedilir. Karar sunucudadır: liste tuzlu özet değil etken
// etken karşılaştırma taşır; onay bildirilen kümeyi kabul edilen küme yapar (fabrika zil üzerine yeni kirayı alır),
// zayıf tanıma onayı aynı makinenin aynı kodla etkinleşmesine izin verir. Her karar sebep ister.
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ConfirmAction } from "../../shared/ConfirmAction";
import { fmtDateTime } from "../../shared/format";
import { usePaged } from "../../shared/hooks";
import { FACTOR_STATE_LABEL, FINGERPRINT_FACTOR_LABEL, HARDWARE_REQUEST_KIND_LABEL, HARDWARE_REQUEST_STATUS_LABEL, label } from "../../shared/labels";
import { useApi, useCan } from "../../shared/session";
import type { HardwareRequest } from "../../shared/types";
import { Badge, Button, LoadMore, PageTitle, QueryState, Section, Table } from "../../shared/ui";

const FACTORS = ["f1", "f2", "f3", "f4", "f5"] as const;

function factorTone(state: string | undefined): "ok" | "warn" | "danger" | "neutral" {
  if (state === "AYNI") return "ok";
  if (state === "FARKLI") return "danger";
  if (state === "KAYIP") return "warn";
  return "neutral";
}

/** Etken etken karşılaştırma; güçlü etkenler (F2 · F3 · F4) kalın. */
export function FactorComparison({ r }: { r: HardwareRequest }) {
  return (
    <span className="section-actions">
      {FACTORS.map((f) => {
        const state = r.karsilastirma.etkenler[f];
        const text = `${FINGERPRINT_FACTOR_LABEL[f]}: ${label(FACTOR_STATE_LABEL, state)}`;
        return (
          <Badge key={f} tone={factorTone(state)}>
            {r.karsilastirma.guclu.includes(f) ? <strong>{text}</strong> : text}
          </Badge>
        );
      })}
    </span>
  );
}

function summary(r: HardwareRequest): string {
  const where = `${r.kurulum.tesis.musteri.ad} › ${r.kurulum.tesis.ad} › ${r.kurulum.ad ?? r.kurulum.kurulumId.slice(0, 8)}`;
  return `${label(HARDWARE_REQUEST_KIND_LABEL, r.tur)} — ${where} — tutan güçlü etken ${r.karsilastirma.tutanGuclu}/3`;
}

export function HardwareRequestsPage() {
  const api = useApi();
  const queryClient = useQueryClient();
  const canManage = useCan("kurulum:yonet");
  const [status, setStatus] = useState("BEKLIYOR");
  const [kind, setKind] = useState("");
  const [decide, setDecide] = useState<{ r: HardwareRequest; d: "onayla" | "reddet" } | null>(null);
  const list = usePaged<HardwareRequest>(["donanim-talepleri"], "/donanim-talepleri", { durum: status || undefined, tur: kind || undefined });
  return (
    <>
      <PageTitle
        title="Donanım ve zayıf tanıma onayları"
        sub="Güçlü etkenlerden (SMBIOS UUID · sistem diski · anakart) en az ikisi tutan değişiklik kendiliğinden öğrenilir; buradakiler insan kararı ister. Onay, bildirilen kümeyi kabul edilen küme yapar."
      />
      <Section title="Liste">
        <div className="toolbar">
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Durum">
            <option value="">Tümü</option>
            {Object.entries(HARDWARE_REQUEST_STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Tür">
            <option value="">Her tür</option>
            {Object.entries(HARDWARE_REQUEST_KIND_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <QueryState isLoading={list.isLoading} error={list.error} />
        <Table
          rows={list.rows}
          rowKey={(r) => r.id}
          empty="Talep yok"
          columns={[
            { header: "Son bildirim", render: (r) => fmtDateTime(r.sonBildirim) },
            {
              header: "Kurulum",
              render: (r) => <Link to={`/kurulumlar/${r.kurulumId}`}>{`${r.kurulum.tesis.musteri.ad} › ${r.kurulum.tesis.ad} › ${r.kurulum.ad ?? r.kurulum.kurulumId.slice(0, 8)}`}</Link>,
            },
            { header: "Tür", render: (r) => label(HARDWARE_REQUEST_KIND_LABEL, r.tur) },
            { header: "Etkenler", render: (r) => <FactorComparison r={r} /> },
            {
              header: "Değerlendirme",
              render: (r) =>
                r.karsilastirma.zayif ? (
                  <Badge tone="warn">Zayıf tanıma: güçlü şartı sağlanamıyor</Badge>
                ) : r.karsilastirma.ogrenilebilir ? (
                  <Badge tone="ok">Güçlü etkenler tutuyor</Badge>
                ) : (
                  <Badge tone="danger">{`Güçlü etken ${r.karsilastirma.tutanGuclu}/3 — kopya olabilir`}</Badge>
                ),
            },
            { header: "Gerekçe", render: (r) => r.gerekce ?? "—" },
            { header: "Bildirim", render: (r) => r.bildirimSayisi, className: "num-col" },
            {
              header: "Durum",
              render: (r) => `${label(HARDWARE_REQUEST_STATUS_LABEL, r.durum)}${r.otomatik ? " (kendiliğinden)" : ""}${r.kararSebebi ? ` — ${r.kararSebebi}` : ""}`,
            },
            {
              header: "",
              render: (r) =>
                canManage && r.durum === "BEKLIYOR" ? (
                  <span className="section-actions">
                    <Button variant="ghost" onClick={() => setDecide({ r, d: "onayla" })}>
                      Onayla
                    </Button>
                    <Button variant="ghost" onClick={() => setDecide({ r, d: "reddet" })}>
                      Reddet
                    </Button>
                  </span>
                ) : null,
            },
          ]}
        />
        <LoadMore hasMore={list.hasMore} loading={list.loadingMore} onClick={list.loadMore} />
      </Section>
      {decide ? (
        <ConfirmAction
          title={decide.d === "onayla" ? "Talebi onayla" : "Talebi reddet"}
          description={
            decide.d === "onayla"
              ? decide.r.tur === "DONANIM"
                ? "Bildirilen küme kabul edilen küme olur; fabrika bir sonraki yoklamada yeni kümeyi taşıyan kirayı alır. Müşteriyle değişikliği doğrulayın."
                : "Bu makine (anahtar) zayıf tanımayla etkinleşebilir; kira zayıf kuralı taşır. Müşteriyle sanal/konteyner kurulumu doğrulayın."
              : "Talep reddedilir; kabul edilen küme değişmez. Fabrika yeniden bildirirse yeni talep açılır."
          }
          targets={[summary(decide.r)]}
          confirmLabel={decide.d === "onayla" ? "Onayla" : "Reddet"}
          danger={decide.d === "reddet"}
          send={(b) => (decide.d === "onayla" ? api.post(`/donanim-talepleri/${decide.r.id}/onayla`, b) : api.post(`/donanim-talepleri/${decide.r.id}/reddet`, b))}
          onDone={() => {
            setDecide(null);
            void queryClient.invalidateQueries({ queryKey: ["donanim-talepleri"] });
          }}
          onClose={() => setDecide(null)}
        />
      ) : null}
    </>
  );
}
