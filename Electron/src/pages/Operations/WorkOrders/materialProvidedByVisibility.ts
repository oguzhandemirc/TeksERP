// Fason F7b — belgeden İE kipinde (`docScan.noteId` dolu) gövde `docFormFill` + `workOrderFormFieldShape`ten
// geçer ve alanı TAŞIMAZ; seçim sessizce düşmesin diye düğme grubu o kipte gizlenir (bağlama gelen belge diliminde).
export function materialFieldVisible(docNoteId: string | null | undefined): boolean {
  return !docNoteId;
}
