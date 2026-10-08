// GÜNCELLEME DALGASI AYRINTISI (F1b): sayaçlar, kurulum başına sonuç (insan sabitlemesi ile dalga tavanı AYRI sütun),
// karar defteri, "sonraki aşamaya geç" / "aşamayı geri çek". Her karar gerekçelidir; ek onay gereğini sunucu bildirir
// (`ilerletmeEkOnayIster` ya da 400 IKINCI_ONAY_GEREKLI) ve arayüz onu ayrı, açık bir onay adımıyla sorar.
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../../shared/api";
import { useWrite } from "../../shared/attempt";
import { fmtDateTime } from "../../shared/format";
import { useGet } from "../../shared/hooks";
import { label } from "../../shared/labels";
import { useApi, useCan } from "../../shared/session";
import { installationName, type FleetRow, type UpdateWaveDetail, type WaveMember, type WaveStageChange, type WaveTally } from "../../shared/types";
import { Badge, Button, ErrorText, Field, KeyValues, Modal, ModalActions, PageTitle, QueryState, Section, Table } from "../../shared/ui";
import { groupName } from "../../shared/update-groups";
import { WAVES_KEY, groupTotal, stageBadge } from "./WavesPage";
import {
  SECOND_CONFIRMATION_CODE,
  WAVE_EVENT_LABEL,
  WAVE_MAX_STAGE,
  WAVE_REPORTED_MIN_PERCENT,
  WAVE_RESULT_LABEL,
  WAVE_RESULT_TONE,
  WAVE_SOURCE_LABEL,
  membersCrossing,
  stageText,
} from "./wave";

type Names = ReadonlyMap<string, FleetRow>;

function memberName(m: WaveMember, names: Names): string {
  const f = names.get(m.id);
  return f ? `${f.musteri} › ${f.tesis} › ${installationName(f)}` : `Kurulum ${m.kurulumId.slice(0, 8)}`;
}

/** Ek onayın nedeni — sunucunun sayaçlarından (eşik hükmü sunucuda). */
function confirmationReason(t: WaveTally): string {
  if (t.uyariAcik) return `Sorun eşiği aşıldı: ${t.hata} kurulum geri döndü ya da başarısız oldu.`;
  return `Dalgadaki kurulumların yalnız %${t.bildirimYuzdesi ?? 0}'i sonuç bildirdi (en az %${WAVE_REPORTED_MIN_PERCENT} beklenir).`;
}

export function WaveDetailPage() {
  const { id = "" } = useParams();
  const canWave = useCan("guncelleme:dalga");
  const queryClient = useQueryClient();
  const q = useGet<UpdateWaveDetail>(["guncelleme-dalgalari", id], `/guncelleme-dalgalari/${id}`);
  const fleet = useGet<FleetRow[]>(["filo"], "/filo");
  const [action, setAction] = useState<"advance" | "retreat" | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const names: Names = new Map((fleet.data ?? []).map((f) => [f.id, f]));
  const w = q.data;
  const finish = (r: WaveStageChange) => {
    setAction(null);
    setDone(`Aşama ${stageText(r.dalga.asama)} oldu. Tavanı değişen ${r.zil} kuruluma hemen haber verildi; diğerleri bir sonraki yoklamada (en geç 1 saat) görür.`);
    void queryClient.invalidateQueries({ queryKey: WAVES_KEY });
  };
  return (
    <>
      <PageTitle
        title={w ? `${groupName(w.kanalKodu)} · ${w.surum}` : "Güncelleme dalgası"}
        sub={<Link to="/guncelleme-dalgalari">Tüm dalgalar</Link>}
        actions={
          w && canWave ? (
            <>
              <Button variant="primary" onClick={() => setAction("advance")} disabled={w.asama >= WAVE_MAX_STAGE}>
                Sonraki aşamaya geç
              </Button>
              <Button variant="danger" onClick={() => setAction("retreat")} disabled={w.asama <= 0}>
                Aşamayı geri çek
              </Button>
            </>
          ) : null
        }
      />
      <QueryState isLoading={q.isLoading} error={q.error} />
      {done ? (
        <p className="ok-box" role="status">
          {done}
        </p>
      ) : null}
      {w ? (
        <>
          {w.sayac.uyariAcik ? (
            <p className="warn-box" role="alert">
              {`Uyarı: ${w.sayac.hata} kurulum geri döndü ya da başarısız oldu. Yayılım kendiliğinden DURMAZ — gerekirse aşamayı geri çekin.`}
            </p>
          ) : null}
          {!w.yururlukte ? <p className="warn-box">Bu dalga yürürlükte değil: grupta daha yeni sürümlü bir dalga var ve kiraya yalnız onun tavanı gider.</p> : null}
          <Section title="Özet">
            <KeyValues
              items={[
                ["Grup", groupName(w.kanalKodu)],
                ["Yayılan sürüm", w.surum],
                ["Dalgaya girmemiş kurulumlar", `${w.oncekiSurum} sürümünde kalır`],
                ["Aşama", stageBadge(w.asama)],
                ["Dalgada", `${w.sayac.dalgada.kurulum} / ${groupTotal(w)} kurulum`],
                ["Sonuç bildiren", w.sayac.bildirimYuzdesi === null ? "—" : `%${w.sayac.bildirimYuzdesi}`],
                ["Sorunlu", w.sayac.hata],
                ["Açılış", fmtDateTime(w.createdAt)],
              ]}
            />
          </Section>
          <Section title="Aşama başına sonuçlar">
            <Table
              rows={w.sayac.asamalar}
              rowKey={(r) => String(r.asama)}
              columns={[
                { header: "Girdiği aşama", render: (r) => stageText(r.asama) },
                { header: "Kurulum", render: (r) => r.kurulum, className: "num-col" },
                { header: "Tamamlandı", render: (r) => r.TAMAMLANDI, className: "num-col" },
                { header: "Geri döndü", render: (r) => r.GERI_DONDU, className: "num-col" },
                { header: "Başarısız", render: (r) => r.BASARISIZ, className: "num-col" },
                { header: "Bekliyor", render: (r) => r.BEKLIYOR, className: "num-col" },
              ]}
            />
          </Section>
          <Section title={`Kurulumlar (${w.uyeler.length})`}>
            <p className="muted small">Kiraya insan sabitlemesi ile dalga tavanının KÜÇÜĞÜ gider; ikisi ayrı gösterilir.</p>
            <Table
              rows={w.uyeler}
              rowKey={(m) => m.id}
              empty="Grupta etkin kurulum yok"
              columns={[
                { header: "Kurulum", render: (m) => <Link to={`/kurulumlar/${m.id}`}>{memberName(m, names)}</Link> },
                { header: "Girdiği aşama", render: (m) => stageText(m.girisAsamasi) },
                { header: "Dalgada", render: (m) => (m.dalgada ? <Badge tone="info">Evet</Badge> : <Badge>Hayır</Badge>) },
                { header: "Kurulu", render: (m) => m.kuruluSurum ?? "—" },
                { header: "Sonuç", render: (m) => <Badge tone={WAVE_RESULT_TONE[m.sonuc] ?? "neutral"}>{label(WAVE_RESULT_LABEL, m.sonuc)}</Badge> },
                { header: "Kaynak", render: (m) => (m.kaynak ? label(WAVE_SOURCE_LABEL, m.kaynak) : "—") },
                { header: "İnsan sabitlemesi", render: (m) => names.get(m.id)?.politika.hedefSurum ?? "Yok" },
                { header: "Dalga tavanı", render: (m) => (m.dalgada ? w.surum : w.oncekiSurum) },
              ]}
            />
          </Section>
          <Section title="Karar geçmişi">
            <Table
              rows={w.gecmis}
              rowKey={(r) => r.id}
              empty="Kayıt yok"
              columns={[
                { header: "Zaman", render: (r) => fmtDateTime(r.createdAt) },
                { header: "Karar", render: (r) => label(WAVE_EVENT_LABEL, r.olay) },
                { header: "Aşama", render: (r) => (r.oncekiAsama === null ? stageText(r.yeniAsama) : `${stageText(r.oncekiAsama)} → ${stageText(r.yeniAsama)}`) },
                { header: "Ek onay", render: (r) => (r.ekOnay ? <Badge tone="warn">Uyarıya rağmen</Badge> : "—") },
                { header: "Sebep", render: (r) => r.sebep },
                { header: "Yapan", render: (r) => r.yapan },
              ]}
            />
          </Section>
          {action === "advance" ? <AdvanceModal wave={w} names={names} onClose={() => setAction(null)} onDone={finish} onStale={() => void q.refetch()} /> : null}
          {action === "retreat" ? <RetreatModal wave={w} names={names} onClose={() => setAction(null)} onDone={finish} /> : null}
        </>
      ) : null}
    </>
  );
}

interface StageModalProps {
  readonly wave: UpdateWaveDetail;
  readonly names: Names;
  readonly onClose: () => void;
  readonly onDone: (r: WaveStageChange) => void;
}

function AffectedList({ title, members, names, note }: { title: string; members: readonly WaveMember[]; names: Names; note: (m: WaveMember) => string }) {
  return (
    <div className="affected">
      <span className="field-label">{`${title} (${members.length})`}</span>
      {members.length === 0 ? (
        <p className="muted small">Tavanı değişen kurulum yok.</p>
      ) : (
        <ul>
          {members.map((m) => (
            <li key={m.id}>
              <strong>{memberName(m, names)}</strong> <span className="muted small">— {note(m)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AdvanceModal({ wave, names, onClose, onDone, onStale }: StageModalProps & { readonly onStale: () => void }) {
  const api = useApi();
  // Karar pencerenin açıldığı aşamaya dayanır: arka planda tazelenen veri beklenen aşamayı sessizce değiştirmez (sunucu 409).
  const [stage] = useState(wave.asama);
  const next = stage + 1;
  const [reason, setReason] = useState("");
  // Ek onay adımı: sunucunun sayacı istiyorsa baştan; sunucu sonradan 400 IKINCI_ONAY_GEREKLI derse o anda açılır.
  const [needsConfirm, setNeedsConfirm] = useState(wave.sayac.ilerletmeEkOnayIster);
  const [serverReason, setServerReason] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const write = useWrite<WaveStageChange>((b) =>
    api.post<WaveStageChange>(`/guncelleme-dalgalari/${wave.id}/ilerlet`, b).catch((err: unknown) => {
      if (err instanceof ApiError && err.code === SECOND_CONFIRMATION_CODE) {
        setNeedsConfirm(true);
        setServerReason(err.message);
        setConfirmed(false);
        onStale();
      }
      throw err;
    }),
  );
  const secondStep = write.error instanceof ApiError && write.error.code === SECOND_CONFIRMATION_CODE;
  const ok = reason.trim() !== "" && (!needsConfirm || confirmed);
  const submit = async () => {
    const r = await write.run({ beklenenAsama: stage, sebep: reason.trim(), ...(needsConfirm && confirmed ? { onay: true } : {}) });
    if (r.ok) onDone(r.data);
  };
  const entering = membersCrossing(wave.uyeler, stage, next);
  return (
    <Modal title={`Sonraki aşamaya geç: ${stageText(stage)} → ${stageText(next)}`} onClose={onClose} busy={write.pending} wide>
      <p>
        {groupName(wave.kanalKodu)} grubunda <strong>{wave.surum}</strong> sürümü daha çok kuruluma açılır. Kurulumlar yeni sürümü kendi güncelleme
        politikalarına göre (pencere / onay) kurar.
      </p>
      <AffectedList title="Yeni sürümü alabilecek kurulumlar" members={entering} names={names} note={(m) => (m.kuruluSurum ? `şu an ${m.kuruluSurum}` : "kurulu sürüm bilinmiyor")} />
      {needsConfirm ? (
        <div className="warn-box" role="alert">
          <p>
            <strong>Ek onay gerekiyor.</strong> {serverReason ?? confirmationReason(wave.sayac)}
          </p>
          <label className="check">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            Uyarıyı okudum; yine de sonraki aşamaya geçmek istiyorum
          </label>
        </div>
      ) : null}
      <Field label="Sebep (zorunlu, deftere yazılır)">
        <textarea value={reason} maxLength={500} rows={2} onChange={(e) => setReason(e.target.value)} />
      </Field>
      {secondStep ? null : <ErrorText error={write.error} />}
      <ModalActions>
        <Button onClick={onClose} disabled={write.pending}>
          Vazgeç
        </Button>
        <Button variant="primary" onClick={submit} disabled={!ok || write.pending}>
          {write.pending ? "İşleniyor…" : needsConfirm ? "Onaylıyorum, ilerlet" : "İlerlet"}
        </Button>
      </ModalActions>
    </Modal>
  );
}

function RetreatModal({ wave, names, onClose, onDone }: StageModalProps) {
  const api = useApi();
  const [stage] = useState(wave.asama);
  const [target, setTarget] = useState(stage - 1);
  const [reason, setReason] = useState("");
  const write = useWrite<WaveStageChange>((b) => api.post(`/guncelleme-dalgalari/${wave.id}/geri-cek`, b));
  const leaving = membersCrossing(wave.uyeler, target, stage);
  const submit = async () => {
    const r = await write.run({ beklenenAsama: stage, hedefAsama: target, sebep: reason.trim() });
    if (r.ok) onDone(r.data);
  };
  const choices = Array.from({ length: stage }, (_, i) => stage - 1 - i);
  return (
    <Modal title={`Aşamayı geri çek: ${groupName(wave.kanalKodu)} · ${wave.surum}`} onClose={onClose} busy={write.pending} wide>
      <p>
        Dalgadan çıkan kurulumlar <strong>{wave.surum}</strong> sürümüne bundan sonra GEÇMEZ; tavanları {wave.oncekiSurum} olur. Başlamış bir güncelleme kendi
        sonucuna kadar sürer, zaten güncellenmiş kurulum geri inmez.
      </p>
      <Field label="Yeni aşama">
        <select value={target} onChange={(e) => setTarget(Number(e.target.value))}>
          {choices.map((s) => (
            <option key={s} value={s}>
              {s === 0 ? "0 · durdur (hiçbir kurulum yeni sürüme geçmez)" : stageText(s)}
            </option>
          ))}
        </select>
      </Field>
      <AffectedList
        title="Dalgadan çıkan kurulumlar"
        members={leaving}
        names={names}
        note={(m) => (m.sonuc === "TAMAMLANDI" ? "zaten güncellendi, geri inmez" : "yeni sürüme geçmez")}
      />
      <Field label="Sebep (zorunlu, deftere yazılır)">
        <textarea value={reason} maxLength={500} rows={2} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <ErrorText error={write.error} />
      <ModalActions>
        <Button onClick={onClose} disabled={write.pending}>
          Vazgeç
        </Button>
        <Button variant="danger" onClick={submit} disabled={reason.trim() === "" || write.pending}>
          {write.pending ? "İşleniyor…" : "Aşamayı geri çek"}
        </Button>
      </ModalActions>
    </Modal>
  );
}
