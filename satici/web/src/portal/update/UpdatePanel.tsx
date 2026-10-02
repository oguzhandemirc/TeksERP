// GÜNCELLEME (Dağıtım v2 — docs/design/GUNCELLEYICI.md §2 · §3.1): kurulumun politikası (kip · pencere ·
// sabitleme), fabrikanın son raporu ve politika/sonuç geçmişi. Politika değişimi deftere yazan eylemdir:
// kaydı adıyla gösterir, sebep ister; yeni politika sonraki kirayla fabrikaya ulaşır. K1 her kipi ezer.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ConfirmAction } from "../../shared/ConfirmAction";
import { fmtDateTime } from "../../shared/format";
import { useGet } from "../../shared/hooks";
import { label } from "../../shared/labels";
import { useApi, useCan } from "../../shared/session";
import { installationName, type InstallationDetail, type InstallationUpdateView, type UpdateHistoryRow, type UpdateMode, type UpdatePolicy } from "../../shared/types";
import { Badge, Button, Field, KeyValues, QueryState, Section, Table } from "../../shared/ui";
import {
  RELEASE_VERSION_PATTERN,
  UPDATE_DECISION_LABEL,
  UPDATE_EVENT_LABEL,
  UPDATE_MODE_HINT,
  UPDATE_MODE_LABEL,
  UPDATE_POLICY_EVENT,
  UPDATE_REASON_LABEL,
  UPDATE_RESULT_CODE_LABEL,
  UPDATE_RESULT_LABEL,
  UPDATER_STATE_LABEL,
  WEEKDAYS,
  WINDOW_END_PATTERN,
  WINDOW_START_PATTERN,
  policyText,
  windowText,
} from "./labels";

const MODES: readonly UpdateMode[] = ["ONAYLI", "OTOMATIK", "DONDUR"];

interface Draft {
  readonly mode: UpdateMode;
  readonly windowOn: boolean;
  readonly start: string;
  readonly end: string;
  readonly days: readonly number[];
  readonly target: string;
}

function draftOf(p: UpdatePolicy): Draft {
  return {
    mode: p.kip,
    windowOn: p.pencere !== null,
    start: p.pencere?.baslangic ?? "02:00",
    end: p.pencere?.bitis ?? "05:00",
    days: p.pencere?.gunler ?? [1, 2, 3, 4, 5, 6, 7],
    target: p.hedefSurum ?? "",
  };
}

/** Formdan sunucu gövdesi (sebep/clientToken hariç) — gün listesi artan sıralı. */
export function policyBody(d: Draft): UpdatePolicy {
  return {
    kip: d.mode,
    pencere: d.windowOn ? { baslangic: d.start.trim(), bitis: d.end.trim(), gunler: [...d.days].sort((a, b) => a - b) } : null,
    hedefSurum: d.target.trim() || null,
  };
}

/** Ön doğrulama (sunucu aynı kuralı protokol şemasıyla uygular): null = geçerli, yoksa neden. */
export function draftProblem(d: Draft): string | null {
  if (d.mode === "OTOMATIK" && !d.windowOn) return "Otomatik kip bir güncelleme penceresi ister.";
  if (d.windowOn) {
    if (!WINDOW_START_PATTERN.test(d.start.trim())) return "Başlangıç SS:DD biçiminde olmalı (00:00–23:59).";
    if (!WINDOW_END_PATTERN.test(d.end.trim())) return "Bitiş SS:DD biçiminde olmalı (24:00 = gün sonu).";
    if (d.start.trim() === d.end.trim()) return "Başlangıç ile bitiş aynı olamaz.";
    if (d.days.length === 0) return "En az bir gün seçin.";
  }
  if (d.target.trim() && !RELEASE_VERSION_PATTERN.test(d.target.trim())) return "Sabitlenen sürüm biçimi geçersiz (ör. 2.14.0).";
  return null;
}

function historyDetail(r: UpdateHistoryRow): string {
  const a = r.ayrinti ?? {};
  if (r.olay === UPDATE_POLICY_EVENT) {
    const before = a.onceki as UpdatePolicy | undefined;
    const after = a.yeni as UpdatePolicy | undefined;
    const reason = typeof a.sebep === "string" ? ` — ${a.sebep}` : "";
    return `${before ? policyText(before) : "—"} → ${after ? policyText(after) : "—"}${reason}`;
  }
  const code = typeof a.kod === "string" ? ` · ${label(UPDATE_RESULT_CODE_LABEL, a.kod)}` : "";
  const restored = a.veriGeriYuklendi === true ? " · veri yedekten geri yüklendi" : "";
  return `${typeof a.kaynakSurum === "string" ? a.kaynakSurum : "—"} → ${typeof a.hedefSurum === "string" ? a.hedefSurum : "—"}${code}${restored}`;
}

function eventTone(olay: string): "ok" | "warn" | "danger" | "info" {
  if (olay === "GUNCELLEME_BASARILI") return "ok";
  if (olay === "GUNCELLEME_GERI_DONDU") return "warn";
  if (olay === "GUNCELLEME_BASARISIZ") return "danger";
  return "info";
}

function PolicyForm({ draft, set }: { draft: Draft; set: (patch: Partial<Draft>) => void }) {
  const toggleDay = (d: number) => set({ days: draft.days.includes(d) ? draft.days.filter((x) => x !== d) : [...draft.days, d] });
  return (
    <>
      <Field label="Kip" hint={UPDATE_MODE_HINT[draft.mode]}>
        <select value={draft.mode} onChange={(e) => set({ mode: e.target.value as UpdateMode })}>
          {MODES.map((m) => (
            <option key={m} value={m}>
              {UPDATE_MODE_LABEL[m]}
            </option>
          ))}
        </select>
      </Field>
      <label className="check">
        <input type="checkbox" checked={draft.windowOn} onChange={(e) => set({ windowOn: e.target.checked })} />
        Güncelleme penceresi (fabrika saatiyle)
      </label>
      {draft.windowOn ? (
        <>
          <Field label="Pencere başlangıcı" hint="SS:DD">
            <input value={draft.start} maxLength={5} onChange={(e) => set({ start: e.target.value })} />
          </Field>
          <Field label="Pencere bitişi" hint="SS:DD · 24:00 = gün sonu · başlangıçtan küçükse ertesi güne taşar">
            <input value={draft.end} maxLength={5} onChange={(e) => set({ end: e.target.value })} />
          </Field>
          <div className="field">
            <span className="field-label">Günler (pencerenin BAŞLADIĞI gün)</span>
            <div className="checks">
              {WEEKDAYS.map(([d, n]) => (
                <label key={d} className="check">
                  <input type="checkbox" checked={draft.days.includes(d)} onChange={() => toggleDay(d)} />
                  {n}
                </label>
              ))}
            </div>
          </div>
        </>
      ) : null}
      <Field label="Sabitlenen sürüm (isteğe bağlı)" hint="Boş = kanalın en yenisi. Kurulu sürüm daha yeniyse geri inilmez.">
        <input value={draft.target} maxLength={40} spellCheck={false} onChange={(e) => set({ target: e.target.value })} />
      </Field>
    </>
  );
}

export function UpdatePanel({ detail }: { detail: InstallationDetail }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const inst = detail.kurulum;
  const canWrite = useCan("guncelleme:yaz");
  const q = useGet<InstallationUpdateView>(["kurulum-guncelleme", inst.id], `/kurulumlar/${inst.id}/guncelleme`);
  const [draft, setDraft] = useState<Draft | null>(null);
  const v = q.data;
  if (!v) return <QueryState isLoading={q.isLoading} error={q.error} />;
  const target = `${inst.tesis.musteri.ad} › ${inst.tesis.ad} › ${installationName(inst)}`;
  const report = v.rapor;
  const last = report?.son ?? null;
  const problem = draft ? draftProblem(draft) : null;
  const unchanged = draft ? JSON.stringify(policyBody(draft)) === JSON.stringify(v.politika) : true;
  const done = () => {
    setDraft(null);
    void queryClient.invalidateQueries({ queryKey: ["kurulum-guncelleme", inst.id] });
    void queryClient.invalidateQueries({ queryKey: ["filo"] });
  };
  return (
    <>
      <Section
        title="Güncelleme politikası"
        actions={canWrite && inst.durum !== "IPTAL" ? <Button onClick={() => setDraft(draftOf(v.politika))}>Değiştir…</Button> : null}
      >
        {detail.yaptirim?.guncellemeDonuk ? (
          <p className="warn-box">K1 güncelleme dondurma yürürlükte: kip ne olursa olsun hiçbir sürüm kurulmaz (fabrikadaki onay da açmaz).</p>
        ) : null}
        <KeyValues
          items={[
            ["Kip", <Badge key="k" tone={v.politika.kip === "DONDUR" ? "warn" : v.politika.kip === "OTOMATIK" ? "info" : "neutral"}>{label(UPDATE_MODE_LABEL, v.politika.kip)}</Badge>],
            ["Pencere", windowText(v.politika.pencere)],
            ["Saat dilimi", v.saatDilimiBildirildi ? `${v.saatDilimi} (fabrika bildirdi)` : `${v.saatDilimi} (varsayılan — fabrika henüz bildirmedi)`],
            ["Sabitlenen sürüm", v.politika.hedefSurum ?? "Yok (kanalın en yenisi)"],
          ]}
        />
        <p className="muted small">Politika bir sonraki kirayla fabrikaya ulaşır; değişiklik kurulumu yoklamaya çağırır. Pencere, fabrikanın saat dilimiyle kiranın ömrü boyunca mutlak aralıklara çevrilir.</p>
      </Section>
      <Section title="Fabrikanın son raporu">
        {report ? (
          <KeyValues
            items={[
              ["Güncelleyici", report.guncelleyici ? `${label(UPDATER_STATE_LABEL, report.guncelleyici.durum)}${report.guncelleyici.surum ? ` · ${report.guncelleyici.surum}` : ""}` : "—"],
              [
                "Bekleyen sürüm",
                report.bekleyen
                  ? `${report.bekleyen.surum} · ${label(UPDATE_DECISION_LABEL, report.bekleyen.karar)}${report.bekleyen.neden ? ` (${label(UPDATE_REASON_LABEL, report.bekleyen.neden)})` : ""}`
                  : "Yok",
              ],
              [
                "Son deneme",
                last ? (
                  <span key="s">
                    <Badge tone={last.sonuc === "BASARILI" ? "ok" : last.sonuc === "GERI_DONDU" ? "warn" : "danger"}>{label(UPDATE_RESULT_LABEL, last.sonuc)}</Badge> {last.kaynakSurum ?? "—"} → {last.hedefSurum}
                    {last.kod ? ` · ${label(UPDATE_RESULT_CODE_LABEL, last.kod)}` : ""} · {fmtDateTime(last.bitis)}
                  </span>
                ) : (
                  "Yok"
                ),
              ],
              ["Rapor zamanı", fmtDateTime(v.raporZamani)],
            ]}
          />
        ) : (
          <p className="muted">Güncelleyici henüz rapor vermedi (yoklama gelmedi ya da kurulum güncelleyiciden önceki bir sürümde).</p>
        )}
      </Section>
      <Section title="Güncelleme geçmişi">
        <Table
          rows={v.gecmis}
          rowKey={(r) => r.id}
          empty="Politika değişikliği ya da güncelleme denemesi yok"
          columns={[
            { header: "Zaman", render: (r) => fmtDateTime(r.createdAt) },
            { header: "Olay", render: (r) => <Badge tone={eventTone(r.olay)}>{label(UPDATE_EVENT_LABEL, r.olay)}</Badge> },
            { header: "Ayrıntı", render: historyDetail },
            { header: "Yapan", render: (r) => r.yapan },
          ]}
        />
      </Section>
      {draft ? (
        <ConfirmAction
          title="Güncelleme politikasını değiştir"
          description="Yeni politika sonraki kirayla fabrikaya ulaşır; değişiklik sebebiyle kurulum defterine yazılır."
          targets={[target]}
          confirmLabel="Kaydet"
          extra={
            <>
              <PolicyForm draft={draft} set={(patch) => setDraft((d) => (d ? { ...d, ...patch } : d))} />
              {problem ? <p className="error">{problem}</p> : unchanged ? <p className="muted small">Politika değişmedi.</p> : null}
            </>
          }
          extraValid={problem === null && !unchanged}
          send={(b) => api.post(`/kurulumlar/${inst.id}/guncelleme-politikasi`, { ...policyBody(draft), sebep: b.sebep, clientToken: b.clientToken })}
          onDone={done}
          onClose={() => setDraft(null)}
        />
      ) : null}
    </>
  );
}
