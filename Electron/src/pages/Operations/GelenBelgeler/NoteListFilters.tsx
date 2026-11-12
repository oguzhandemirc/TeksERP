// Süzgeç şeridi — panelin TEK SATIR çubuğu (`FilterRow`): [Ara][Durum][Kayıt tarihi][Sahip][Gönderen] … [Temizle][Sütunlar].
// Durum yerel (URL'siz) kalır; sayılar sunucu özetinden. Tarih kutusu pencere açar (`DayRangeFilter`).
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { CustomerPickerField } from "@/components/forms/CustomerPickerField";
import { FilterRow } from "@/components/data-table/filter-row/FilterRow";
import { DayRangeFilter } from "@/components/data-table/filter-row/DayRangeFilter";
import type { RowFilter } from "@/components/data-table/filter-row/row-filter";
import { NoteStatusFilter } from "./NoteStatusFilter";
import type { DeliveryNoteListResponse } from "./types";
import type { NoteListFilter } from "./useNoteList";

interface Props {
  filter: NoteListFilter;
  /** Güncelleyici biçimi ŞART: "Temizle" birden çok kutunun `onClear`ını art arda çağırır. */
  onChange: Dispatch<SetStateAction<NoteListFilter>>;
  summary: DeliveryNoteListResponse["summary"] | null;
  /** Çubuğun sağ ucu — tablo araçları (Sütunlar), Kumaş Stoğu araç satırı emsali. */
  trailing?: ReactNode;
}

const PICKER_TRIGGER = "h-7 border-0 bg-transparent px-2 text-xs shadow-none hover:bg-transparent";
type Patch = (p: Partial<NoteListFilter>) => void;

/** Yerel durumlu kutular: URL anahtarı yok, etkinliği/temizliği `active`/`onClear` söyler. */
function noteRowFilters(filter: NoteListFilter, set: Patch, summary: Props["summary"]): RowFilter[] {
  const local = (f: Omit<RowFilter, "keys" | "onClear">, clear: Partial<NoteListFilter>): RowFilter => ({ ...f, keys: [], onClear: () => set(clear) });
  return [
    local({ id: "durum", label: "Durum", active: filter.status !== null, render: ({ autoOpen }) => <NoteStatusFilter value={filter.status} onChange={(status) => set({ status })} summary={summary} autoOpen={autoOpen} /> }, { status: null }),
    local(
      { id: "tarih", label: "Kayıt tarihi", active: Boolean(filter.from || filter.to), render: ({ autoOpen }) => <DayRangeFilter label="Kayıt tarihi" from={filter.from} to={filter.to} onChange={set} idPrefix="gelen-belge-tarih" autoOpen={autoOpen} /> },
      { from: "", to: "" },
    ),
    local(
      { id: "sahip", label: "Sahip", active: filter.ownerCustomerId !== null, render: () => <CustomerPickerField value={filter.ownerCustomerId} onChange={(id) => set({ ownerCustomerId: id })} placeholder="Sahip (tümü)" triggerClassName={PICKER_TRIGGER} /> },
      { ownerCustomerId: null },
    ),
    local(
      { id: "gonderen", label: "Gönderen", active: filter.senderCustomerId !== null, render: () => <CustomerPickerField value={filter.senderCustomerId} onChange={(id) => set({ senderCustomerId: id })} placeholder="Gönderen (tümü)" triggerClassName={PICKER_TRIGGER} /> },
      { senderCustomerId: null },
    ),
  ];
}

export function NoteListFilters({ filter, onChange, summary, trailing }: Props) {
  const set: Patch = (patch) => onChange((f) => ({ ...f, ...patch }));
  return <FilterRow search={filter.q} onSearchChange={(q) => set({ q })} placeholder="No, belge no, gönderen, parti/sipariş no ara…" primary={noteRowFilters(filter, set, summary)} trailing={trailing} />;
}
