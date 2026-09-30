// SÖZLEŞME KABULLERİ (Ek-7): fabrikanın ilk kurulum kabulü etkinleştirme isteğiyle gelir ve kurulum kaydı defterinde
// `SOZLESME_KABUL_EDILDI` olarak durur (sunucu `activation.service.ts` ACCEPTANCE_EVENT); ayrıntı KURULUM imzalı kabul
// belgesinin alanlarıdır, imzalı belgenin kendisi `belge`de (kanıt).
import { fmtDateTime } from "../../shared/format";
import type { InstallationDetail, InstallationRecord } from "../../shared/types";
import { Section, Table } from "../../shared/ui";

export const ACCEPTANCE_EVENT = "SOZLESME_KABUL_EDILDI";

interface AcceptanceDetail {
  readonly metin?: { kimlik?: string; ozet?: string };
  readonly kutular?: string[];
  readonly kabulEden?: { ad?: string; unvan?: string };
  readonly zaman?: string;
  readonly istemci?: { surum?: string | null };
}

const detailOf = (r: InstallationRecord): AcceptanceDetail => (r.ayrinti ?? {}) as AcceptanceDetail;

export function AcceptancePanel({ detail }: { detail: InstallationDetail }) {
  const rows = (detail.kurulumKaydi ?? []).filter((r) => r.olay === ACCEPTANCE_EVENT);
  return (
    <Section title="Sözleşme kabulleri">
      <p className="muted small">İlk kurulumda panelde kabul edilen sözleşme metni; kabul, etkinleştirme isteğiyle kurulum anahtarı imzalı gelir. Kabulsüz etkinleştirme reddedilir.</p>
      <Table
        rows={rows}
        rowKey={(r) => r.id}
        empty="Kabul kaydı yok (kabul adımından önce etkinleşmiş kurulum)"
        columns={[
          { header: "Kabul zamanı (fabrika)", render: (r) => fmtDateTime(detailOf(r).zaman ?? r.createdAt) },
          { header: "Alındı", render: (r) => fmtDateTime(r.createdAt) },
          { header: "Kabul eden", render: (r) => `${detailOf(r).kabulEden?.ad ?? "—"} · ${detailOf(r).kabulEden?.unvan ?? "—"}` },
          {
            header: "Metin",
            render: (r) => (
              <code>
                {detailOf(r).metin?.kimlik ?? "—"} · {(detailOf(r).metin?.ozet ?? "").slice(0, 12)}…
              </code>
            ),
          },
          { header: "Kutular", render: (r) => (detailOf(r).kutular ?? []).join(", ") || "—" },
          { header: "Panel", render: (r) => detailOf(r).istemci?.surum ?? "—" },
          { header: "Anahtar", render: (r) => (r.anahtarKimligi ? <code>{r.anahtarKimligi}</code> : "—") },
        ]}
      />
    </Section>
  );
}
