// İPTAL BELGELERİ (lisans v2 · G4 §2.3): satıcı iptal belgesini BASMAZ — dönem töreninin paketinden içe aktarır; defter
// ekleme-yalnızdır. Dağıtım kapısı: bir HAK'ı ya da hâlâ yüklü bir anahtarı geçersiz kılacak belge, HAK ara imzacıyla
// yeniden basılıp anahtar emekliye ayrılmadan fabrikalara gitmez; o güne dek bir önceki belge dağıtılır. Engelli HAK'ları
// TOPLU yeniden basma ara imzacı parolası ister; düğme her dinleyicide görünür.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../../shared/api";
import { useWrite } from "../../shared/attempt";
import { fmtDateTime } from "../../shared/format";
import { useGet } from "../../shared/hooks";
import { REISSUE_STATUS_LABEL, REVOCATION_BLOCKER_LABEL, label } from "../../shared/labels";
import { useApi, useCan } from "../../shared/session";
import type { ReissueResponse, RevocationBlocker, RevocationStatus } from "../../shared/types";
import { Badge, Button, ErrorText, Field, KeyValues, Modal, ModalActions, PageTitle, QueryState, Section, Table } from "../../shared/ui";

type HakBlocker = Extract<RevocationBlocker, { tur: "HAK" }>;

/** Engelli HAK'lar (aynı HAK'ın iki sürümü tek satır — yeniden basım HAK başına). */
function hakBlockers(status: RevocationStatus): HakBlocker[] {
  const out: HakBlocker[] = [];
  for (const b of status.bekleyen?.engeller ?? []) if (b.tur === "HAK" && !out.some((x) => x.hakId === b.hakId)) out.push(b);
  return out;
}

function blockerTarget(b: RevocationBlocker): string {
  return b.tur === "HAK" ? `${b.lisansNo} — sürüm ${b.surum} (${b.kid})` : `anahtar ${b.kid}`;
}

function ReissueModal({ blockers, onClose, onDone }: { blockers: readonly HakBlocker[]; onClose: () => void; onDone: () => void }) {
  const api = useApi();
  const [selected, setSelected] = useState<string[]>(blockers.map((b) => b.hakId));
  const [reason, setReason] = useState("");
  const [password, setPassword] = useState("");
  const [result, setResult] = useState<ReissueResponse | null>(null);
  const write = useWrite<ReissueResponse>((body) => api.post("/haklar/toplu-yeniden-bas", body));
  const nameOf = (hakId: string) => blockers.find((b) => b.hakId === hakId)?.lisansNo ?? hakId.slice(0, 8);
  const submit = async () => {
    const r = await write.run({ hakIdleri: selected, sebep: reason.trim(), imzaParolasi: password });
    setPassword("");
    if (r.ok) setResult(r.data);
  };
  const err = write.error instanceof ApiError ? write.error : null;
  if (result) {
    return (
      <Modal title="Toplu yeniden basım sonucu" onClose={onDone} wide>
        <Table
          rows={result.sonuclar}
          rowKey={(r) => r.hakId}
          columns={[
            { header: "Lisans", render: (r) => nameOf(r.hakId) },
            { header: "Sonuç", render: (r) => <Badge tone={r.durum === "IMZALANACAK" ? "ok" : "warn"}>{label(REISSUE_STATUS_LABEL, r.durum)}</Badge> },
            { header: "Yeni sürüm", render: (r) => result.basilan.find((b) => b.hakId === r.hakId)?.surum ?? "—", className: "num-col" },
            { header: "Neden", render: (r) => r.neden ?? "—" },
          ]}
        />
        <ModalActions>
          <Button variant="primary" onClick={onDone}>
            Kapat
          </Button>
        </ModalActions>
      </Modal>
    );
  }
  return (
    <Modal title="Engelli HAK'ları ara imzacıyla yeniden bas" onClose={onClose} busy={write.pending} wide>
      <p>Seçilen HAK'lar değişiklik OLMADAN ara imzacıyla yeniden basılır; ara imzalı HAK'ı tanımayan kurulumlar atlanır (sonuçta nedeniyle görünür).</p>
      <div className="field">
        <span className="field-label">Etkilenen kayıtlar ({selected.length})</span>
        <div className="checks">
          {blockers.map((b) => (
            <label key={b.hakId} className="check">
              <input type="checkbox" checked={selected.includes(b.hakId)} onChange={() => setSelected((v) => (v.includes(b.hakId) ? v.filter((x) => x !== b.hakId) : [...v, b.hakId]))} />
              {blockerTarget(b)}
            </label>
          ))}
        </div>
      </div>
      <Field label="Sebep (zorunlu, deftere yazılır)">
        <textarea value={reason} maxLength={500} rows={2} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <Field label="Ara imzacı parolası" hint="Yalnız bu basım için kullanılır; kaydedilmez.">
        <input type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      {err?.code === "IMZA_PAROLASI_HATALI" ? <p className="error">Parola hatalı. Art arda hatalı denemede imza bir süre kilitlenir.</p> : <ErrorText error={write.error} />}
      <ModalActions>
        <Button onClick={onClose} disabled={write.pending}>
          Vazgeç
        </Button>
        <Button variant="primary" onClick={submit} disabled={write.pending || selected.length === 0 || !reason.trim() || !password}>
          {write.pending ? "Basılıyor…" : "Yeniden bas"}
        </Button>
      </ModalActions>
    </Modal>
  );
}

export function RevocationsPage() {
  const queryClient = useQueryClient();
  const q = useGet<RevocationStatus>(["iptal-belgeleri"], "/iptal-belgeleri");
  const canWrite = useCan("hak:yaz");
  const [reissue, setReissue] = useState(false);
  const s = q.data;
  const blockers = s ? hakBlockers(s) : [];
  const stateOf = (sira: number) => (sira === s?.dagitilanSira ? <Badge tone="ok">Dağıtılıyor</Badge> : sira === s?.bekleyen?.sira ? <Badge tone="warn">Kapıda bekliyor</Badge> : "—");
  return (
    <>
      <PageTitle
        title="İptal belgeleri"
        sub="Kök imzalı iptal belgeleri dönem töreninin paketinden içe aktarılır (satıcı basmaz). Bir HAK'ı ya da hâlâ yüklü bir anahtarı geçersiz kılacak belge, engeller kalkana dek fabrikalara gitmez; o güne dek önceki belge dağıtılır."
      />
      <QueryState isLoading={q.isLoading} error={q.error} />
      {s ? (
        <>
          <Section title="Dağıtım">
            <KeyValues
              items={[
                ["Fabrikalara giden sıra", s.dagitilanSira === null ? "Henüz yok" : String(s.dagitilanSira)],
                ["Kapıda bekleyen", s.bekleyen ? <Badge tone="warn">{`Sıra ${s.bekleyen.sira} — ${s.bekleyen.engeller.length} engel`}</Badge> : "Yok"],
              ]}
            />
          </Section>
          {s.bekleyen ? (
            <Section
              title={`Bekleyen belgenin engelleri (sıra ${s.bekleyen.sira})`}
              actions={canWrite && blockers.length > 0 ? <Button onClick={() => setReissue(true)}>Engelli HAK'ları yeniden bas…</Button> : null}
            >
              <Table
                rows={s.bekleyen.engeller}
                rowKey={(b) => (b.tur === "HAK" ? `${b.hakId}:${b.surum}` : `k:${b.kid}`)}
                columns={[
                  { header: "Engel", render: (b) => label(REVOCATION_BLOCKER_LABEL, b.tur) },
                  { header: "Kayıt", render: (b) => blockerTarget(b) },
                  {
                    header: "Ne yapılır",
                    render: (b) =>
                      b.tur === "HAK" ? (
                        "Ara imzacıyla yeniden bas"
                      ) : (
                        <>
                          Emekliye ayır — VDS'te <code>anahtar.js emekliye-ayir</code> (runbook §8 adım 7)
                        </>
                      ),
                  },
                ]}
              />
            </Section>
          ) : null}
          <Section title="Defter">
            <Table
              rows={s.belgeler}
              rowKey={(r) => r.id}
              empty="İçe aktarılmış iptal belgesi yok"
              columns={[
                { header: "Sıra", render: (r) => r.sira, className: "num-col" },
                { header: "Durum", render: (r) => stateOf(r.sira) },
                { header: "İptal edilen anahtarlar", render: (r) => r.kidler.join(", ") || "—" },
                { header: "İmzalayan kök", render: (r) => <code>{r.imzalayanKid}</code> },
                { header: "Veriliş", render: (r) => fmtDateTime(r.verilis) },
                { header: "İçe aktaran", render: (r) => `${r.yukleyen} · ${fmtDateTime(r.createdAt)}` },
              ]}
            />
          </Section>
        </>
      ) : null}
      {reissue && s ? (
        <ReissueModal
          blockers={blockers}
          onClose={() => setReissue(false)}
          onDone={() => {
            setReissue(false);
            void queryClient.invalidateQueries({ queryKey: ["iptal-belgeleri"] });
            void queryClient.invalidateQueries({ queryKey: ["kurulum"] });
          }}
        />
      ) : null}
    </>
  );
}
