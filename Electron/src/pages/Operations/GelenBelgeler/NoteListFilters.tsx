// Süzgeç şeridi: durum düğmeleri (sayılar sunucu özetinden) + sahip/gönderen seçici (doğrudan modal) + arama + geliş tarihi.
import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { CustomerPickerField } from "@/components/forms/CustomerPickerField";
import { DateRangeInput } from "@/components/forms/DateRangeInput";
import { NOTE_STATUS_LABEL } from "./noteStatus";
import { NOTE_STATUSES, type DeliveryNoteListResponse } from "./types";
import type { NoteListFilter } from "./useNoteList";

interface Props {
  filter: NoteListFilter;
  onChange: (f: NoteListFilter) => void;
  summary: DeliveryNoteListResponse["summary"] | null;
  /** Arama satırının sağı — tablo araçları (Sütunlar), Kumaş Stoğu araç satırı emsali. */
  trailing?: ReactNode;
}

export function NoteListFilters({ filter, onChange, summary, trailing }: Props) {
  const set = (patch: Partial<NoteListFilter>) => onChange({ ...filter, ...patch });
  return (
    <div className="flex shrink-0 flex-col gap-2 border-b px-4 py-2">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Durum süzgeci">
        <Button size="sm" variant={filter.status === null ? "default" : "outline"} onClick={() => set({ status: null })}>
          Tümü{summary ? ` (${summary.total})` : ""}
        </Button>
        {NOTE_STATUSES.map((s) => (
          <Button key={s} size="sm" variant={filter.status === s ? "default" : "outline"} onClick={() => set({ status: s })}>
            {NOTE_STATUS_LABEL[s]}
            {summary ? ` (${summary[s]})` : ""}
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={filter.q}
          onChange={(e) => set({ q: e.target.value })}
          placeholder="No, belge no, gönderen ara…"
          className="w-full sm:max-w-xs"
          aria-label="Ara"
        />
        <div className="w-full sm:w-56">
          <CustomerPickerField value={filter.ownerCustomerId} onChange={(id) => set({ ownerCustomerId: id })} placeholder="Sahip (tümü)" clearable />
        </div>
        <div className="w-full sm:w-56">
          <CustomerPickerField value={filter.senderCustomerId} onChange={(id) => set({ senderCustomerId: id })} placeholder="Gönderen (tümü)" clearable />
        </div>
        <DateRangeInput from={filter.from} to={filter.to} onFrom={(v) => set({ from: v })} onTo={(v) => set({ to: v })} fromLabel="Kayıt başlangıç" toLabel="Kayıt bitiş" inputClassName="h-9" />
        {trailing && <div className="ml-auto flex items-center gap-2">{trailing}</div>}
      </div>
    </div>
  );
}
