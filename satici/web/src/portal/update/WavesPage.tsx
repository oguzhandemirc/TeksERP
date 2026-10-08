// GÜNCELLEME DALGALARI (F1b — docs/design/GUNCELLEYICI-SAGLAMLIK.md §6.2): sürüm × grup başına aşama ve sonuç sayaçları,
// yeni dalga açma. Aşamayı yalnız insan ilerletir (AK-2); uyarı yayılımı durdurmaz. Yazma `guncelleme:dalga`, karar sunucuda.
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useWrite } from "../../shared/attempt";
import { fmtDateTime } from "../../shared/format";
import { useGet } from "../../shared/hooks";
import { useApi, useCan } from "../../shared/session";
import type { UpdateWave, UpdateWaveRow } from "../../shared/types";
import { Badge, Button, ErrorText, Field, Modal, ModalActions, PageTitle, QueryState, Section, Table } from "../../shared/ui";
import { groupName } from "../../shared/update-groups";
import { RELEASE_VERSION_PATTERN } from "./labels";
import { WAVE_GROUPS, stageText } from "./wave";

/** Liste ve ayrıntı sorgularının ortak öneki (yazmadan sonra ikisi birlikte tazelenir). */
export const WAVES_KEY = ["guncelleme-dalgalari"] as const;

export function stageBadge(stage: number) {
  return <Badge tone={stage === 0 ? "warn" : "info"}>{`Aşama ${stageText(stage)}`}</Badge>;
}

export function WavesPage() {
  const canWave = useCan("guncelleme:dalga");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const q = useGet<UpdateWave[]>(["guncelleme-dalgalari"], "/guncelleme-dalgalari");
  const [creating, setCreating] = useState(false);
  return (
    <>
      <PageTitle
        title="Güncelleme dalgaları"
        sub="Yeni backend sürümü grupta kademeli yayılır: aşama 0 durdu · 1 kurulumların %10'u · 2 %50'si · 3 hepsi. Aşamayı yalnız siz ilerletirsiniz; sorun eşiği aşılırsa uyarı gelir ama yayılım kendiliğinden durmaz."
        actions={canWave ? <Button variant="primary" onClick={() => setCreating(true)}>Yeni dalga</Button> : null}
      />
      <Section title="Dalgalar">
        <QueryState isLoading={q.isLoading} error={q.error} />
        {q.data ? (
          <Table
            rows={q.data}
            rowKey={(r) => r.id}
            empty="Henüz dalga yok — grup sürümleri dalgasız yayılıyor"
            columns={[
              { header: "Grup", render: (r) => groupName(r.kanalKodu) },
              {
                header: "Sürüm",
                render: (r) => (
                  <Link to={`/guncelleme-dalgalari/${r.id}`}>
                    {r.oncekiSurum} → {r.surum}
                  </Link>
                ),
              },
              { header: "Aşama", render: (r) => stageBadge(r.asama) },
              { header: "Yürürlük", render: (r) => (r.yururlukte ? <Badge tone="ok">Yürürlükte</Badge> : <Badge>Yerini yeni dalgaya bıraktı</Badge>) },
              { header: "Dalgada", render: (r) => `${r.sayac.dalgada.kurulum} / ${groupTotal(r)}`, className: "num-col" },
              { header: "Tamamlandı", render: (r) => r.sayac.dalgada.TAMAMLANDI, className: "num-col" },
              { header: "Geri döndü", render: (r) => r.sayac.dalgada.GERI_DONDU, className: "num-col" },
              { header: "Başarısız", render: (r) => r.sayac.dalgada.BASARISIZ, className: "num-col" },
              { header: "Bekliyor", render: (r) => r.sayac.dalgada.BEKLIYOR, className: "num-col" },
              { header: "Uyarı", render: (r) => (r.sayac.uyariAcik ? <Badge tone="danger">{`Uyarı · ${r.sayac.hata} sorunlu`}</Badge> : "—") },
              { header: "Açılış", render: (r) => fmtDateTime(r.createdAt) },
            ]}
          />
        ) : null}
      </Section>
      {creating ? (
        <WaveCreateModal
          onClose={() => setCreating(false)}
          onSaved={(w) => {
            setCreating(false);
            void queryClient.invalidateQueries({ queryKey: WAVES_KEY });
            navigate(`/guncelleme-dalgalari/${w.id}`);
          }}
        />
      ) : null}
    </>
  );
}

/** Gruptaki uygun kurulum sayısı = aşama satırlarının toplamı (her kurulum tek bir giriş aşamasında sayılır). */
export function groupTotal(w: UpdateWave): number {
  return w.sayac.asamalar.reduce((s, a) => s + a.kurulum, 0);
}

function WaveCreateModal({ onClose, onSaved }: { onClose: () => void; onSaved: (w: UpdateWaveRow) => void }) {
  const api = useApi();
  const [group, setGroup] = useState(WAVE_GROUPS[0] ?? "");
  const [version, setVersion] = useState("");
  const [previous, setPrevious] = useState("");
  const [reason, setReason] = useState("");
  const write = useWrite<UpdateWaveRow>((b) => api.post("/guncelleme-dalgalari", b));
  const versionOk = RELEASE_VERSION_PATTERN.test(version.trim());
  const previousOk = previous.trim() === "" || RELEASE_VERSION_PATTERN.test(previous.trim());
  const ok = group !== "" && versionOk && previousOk && reason.trim() !== "";
  const submit = async () => {
    // Boş önceki sürüm gövdeye girmez: sunucu grubun yerleşik sürümünü kendisi bulur.
    const body = { kanalKodu: group, surum: version.trim(), ...(previous.trim() ? { oncekiSurum: previous.trim() } : {}), sebep: reason.trim() };
    const r = await write.run(body);
    if (r.ok) onSaved(r.data);
  };
  return (
    <Modal title="Yeni güncelleme dalgası" onClose={onClose} busy={write.pending}>
      <p className="muted">Dalga aşama 0'da (durdu) açılır: gruptaki kurulumlar yeni sürümü siz aşamayı ilerletene kadar almaz.</p>
      <Field label="Güncelleme grubu" hint="Öncü ve test gruplarında dalga yoktur; sürüm orada hemen yayılır.">
        <select value={group} onChange={(e) => setGroup(e.target.value)}>
          {WAVE_GROUPS.map((g) => (
            <option key={g} value={g}>
              {groupName(g)}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Yayılacak backend sürümü">
        <input value={version} placeholder="X.Y.Z" maxLength={40} spellCheck={false} onChange={(e) => setVersion(e.target.value)} />
      </Field>
      <Field label="Önceki sürüm (isteğe bağlı)" hint="Dalgaya henüz girmemiş kurulumlar bu sürümde kalır. Boş bırakılırsa grubun yerleşik sürümü kullanılır.">
        <input value={previous} placeholder="X.Y.Z" maxLength={40} spellCheck={false} onChange={(e) => setPrevious(e.target.value)} />
      </Field>
      {version.trim() !== "" && !versionOk ? <p className="error">Sürüm X.Y.Z biçiminde olmalı (ör. 2.11.2).</p> : null}
      {!previousOk ? <p className="error">Önceki sürüm X.Y.Z biçiminde olmalı.</p> : null}
      <Field label="Sebep (zorunlu, deftere yazılır)">
        <textarea value={reason} maxLength={500} rows={2} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <ErrorText error={write.error} />
      <ModalActions>
        <Button onClick={onClose} disabled={write.pending}>
          Vazgeç
        </Button>
        <Button variant="primary" onClick={submit} disabled={!ok || write.pending}>
          {write.pending ? "İşleniyor…" : "Dalgayı aç"}
        </Button>
      </ModalActions>
    </Modal>
  );
}
