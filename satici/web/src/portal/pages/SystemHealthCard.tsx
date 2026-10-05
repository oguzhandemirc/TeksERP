import { useGet } from "../../shared/hooks";
import { fmtDuration } from "../../shared/format";
import type { SystemHealth } from "../../shared/types";
import { Badge, KeyValues, QueryState, Section } from "../../shared/ui";

const JWKS_AGE_LABEL: Record<string, { text: string; tone: "ok" | "warn" | "danger" }> = {
  TAZE: { text: "Taze", tone: "ok" },
  UYARI: { text: "Yaşlanıyor", tone: "warn" },
  ASILDI: { text: "Tavanı aştı (internet portalı kapalı)", tone: "danger" },
};

function Tone({ ok, yes, no }: { ok: boolean; yes: string; no: string }) {
  return <Badge tone={ok ? "ok" : "danger"}>{ok ? yes : no}</Badge>;
}

function CountTone({ n, zeroText }: { n: number; zeroText: string }) {
  return <Badge tone={n === 0 ? "ok" : "warn"}>{n === 0 ? zeroText : String(n)}</Badge>;
}

export function SystemHealthCard() {
  const q = useGet<SystemHealth>(["saglik"], "/saglik");
  const h = q.data;
  return (
    <Section title="Sistem sağlığı">
      <QueryState isLoading={q.isLoading} error={q.error} />
      {h ? (
        <div className="cards">
          <div className="card">
            <div className="muted">Anahtarlar</div>
            <KeyValues
              items={[
                ["Güven çapası", h.anahtarlar.capa === "dosya" ? "Dosyadan" : "Gömülü"],
                ["Geçerli alt sertifika", String(h.anahtarlar.altGecerli)],
                ["İndirme anahtarı", <Tone key="i" ok={h.anahtarlar.indirmeVar} yes="Var" no="Yok" />],
                ["Anahtar uyarısı", <CountTone key="u" n={h.anahtarlar.uyariSayisi} zeroText="Yok" />],
              ]}
            />
          </div>
          <div className="card">
            <div className="muted">Bildirim zili</div>
            <KeyValues
              items={[
                ["Dinleme", <Tone key="d" ok={h.zil.dinliyor} yes="Açık" no="Kapalı" />],
                ["Abone", String(h.zil.abone)],
                ["Teslim edilen", String(h.zil.teslim)],
              ]}
            />
          </div>
          <div className="card">
            <div className="muted">Denetim kaydı</div>
            <KeyValues items={[["Yazma hatası", <CountTone key="a" n={h.denetimYazmaHatasi} zeroText="Yok" />]]} />
          </div>
          <div className="card">
            <div className="muted">İnternet portalı (Access)</div>
            {h.erisim.kip === "kapali" ? (
              <KeyValues items={[["Durum", <Badge key="k" tone="warn">Kapalı</Badge>]]} />
            ) : (
              <KeyValues
                items={[
                  ["Durum", <Badge key="k" tone="ok">Açık</Badge>],
                  ["Kimlik anahtarı kümesi", <Tone key="j" ok={h.erisim.jwks.dolu} yes={`${h.erisim.jwks.anahtarSayisi} anahtar`} no="Dolmadı" />],
                  ["Dosya yaşı", fmtDuration(h.erisim.jwks.dosyaYasiSn)],
                  ["Yaş durumu", h.erisim.jwks.yasDurumu ? <Badge key="y" tone={JWKS_AGE_LABEL[h.erisim.jwks.yasDurumu]!.tone}>{JWKS_AGE_LABEL[h.erisim.jwks.yasDurumu]!.text}</Badge> : "—"],
                  ["Azami yaş", fmtDuration(h.erisim.jwks.azamiYasSn)],
                  ["Son okuma hatası", h.erisim.jwks.sonHata ?? "Yok"],
                ]}
              />
            )}
          </div>
        </div>
      ) : null}
    </Section>
  );
}
