// BACKEND KURULUM GEÇMİŞİ (3d-2): fabrikanın `kur.ps1` kayıtları yoklamayla gelir ve kurulum kaydı
// defterinde `BACKEND_KURULDU` / `BACKEND_GERI_ALINDI` olarak durur; ayrıntı protokolün kayıt allowlist'idir.
import { fmtDateTime } from "../../shared/format";
import type { InstallationDetail, InstallationRecord } from "../../shared/types";
import { Badge, Section, Table } from "../../shared/ui";

export const INSTALL_HISTORY_EVENTS = ["BACKEND_KURULDU", "BACKEND_GERI_ALINDI"] as const;

interface InstallRecordDetail {
  readonly tarih?: string;
  readonly commit?: string | null;
  readonly oncekiSurum?: string | null;
  readonly yeniSurum?: string;
  readonly migrationSayisi?: number | null;
  readonly yeniMigrationSayisi?: number | null;
  readonly geriDonus?: { damga: string | null; kod: boolean; veri: boolean; veriSifreli: boolean };
}

const detailOf = (r: InstallationRecord): InstallRecordDetail => (r.ayrinti ?? {}) as InstallRecordDetail;

/** Geri dönüş noktası damgadan kurulur: kod `app.eski-<damga>`, veri `premigrate_<damga>` (şifreliyse `.tkenc`). */
export function recoveryText(g: InstallRecordDetail["geriDonus"]): string {
  if (!g || !g.damga) return "—";
  const parts: string[] = [];
  if (g.kod) parts.push(`kod: app.eski-${g.damga}`);
  if (g.veri) parts.push(`veri: premigrate_${g.damga}.dump${g.veriSifreli ? ".tkenc" : ""}`);
  return parts.length > 0 ? parts.join(" · ") : "—";
}

export function InstallHistoryPanel({ detail }: { detail: InstallationDetail }) {
  const rows = (detail.kurulumKaydi ?? []).filter((r) => (INSTALL_HISTORY_EVENTS as readonly string[]).includes(r.olay));
  return (
    <Section title="Backend kurulum geçmişi">
      <p className="muted small">Fabrikanın kurulum betiği her kurulumda ve geri almada bir kayıt düşer; kayıtlar yoklamayla gelir.</p>
      <Table
        rows={rows}
        rowKey={(r) => r.id}
        empty="Kurulum kaydı gelmedi"
        columns={[
          { header: "Kurulum zamanı", render: (r) => fmtDateTime(detailOf(r).tarih ?? r.createdAt) },
          {
            header: "Tür",
            render: (r) => (r.olay === "BACKEND_GERI_ALINDI" ? <Badge tone="warn">Geri alma</Badge> : <Badge tone="info">Kurulum</Badge>),
          },
          { header: "Sürüm", render: (r) => `${detailOf(r).oncekiSurum ?? "—"} → ${detailOf(r).yeniSurum ?? "—"}` },
          {
            header: "Migration",
            render: (r) => {
              const d = detailOf(r);
              if (d.migrationSayisi == null) return "—";
              return d.yeniMigrationSayisi == null ? String(d.migrationSayisi) : `${d.migrationSayisi} (+${d.yeniMigrationSayisi})`;
            },
          },
          { header: "Commit", render: (r) => (detailOf(r).commit ? <code>{detailOf(r).commit}</code> : "—") },
          { header: "Geri dönüş noktası", render: (r) => recoveryText(detailOf(r).geriDonus) },
        ]}
      />
    </Section>
  );
}
