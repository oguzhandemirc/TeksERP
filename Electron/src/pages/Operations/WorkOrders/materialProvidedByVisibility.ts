// Fason F7b — belgeden İE kipinde alan form ucuyla İE'ye taşınır (`formEndpointExtras`). Ayrı onayda (SEPARATE) bu
// kayıt yalnız taslak yazar, İE burada açılmaz → seçim sessizce düşmesin diye düğme grubu o kipte gizlenir.
export function materialFieldVisible(docNoteId: string | null | undefined, approval?: string | null): boolean {
  return !docNoteId || approval === "WITH_WORK_ORDER";
}
