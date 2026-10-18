/** Form drafts remember the last external values, so Undo cannot revive an earlier pending edit. */
export interface FieldDraft<T extends Record<string, string>> { source: T; values: T }

export function createFieldDraft<T extends Record<string, string>>(source: T): FieldDraft<T> {
  return { source: { ...source }, values: { ...source } };
}

/** External changes replace only their own fields; unrelated pending edits keep their focus and values. */
export function reconcileFieldDraft<T extends Record<string, string>>(draft: FieldDraft<T>, source: T): FieldDraft<T> {
  const fields = Object.keys(source) as (keyof T)[];
  if (fields.length === Object.keys(draft.source).length && fields.every((field) => source[field] === draft.source[field])) return draft;
  const values = { ...source };
  for (const field of fields) if (Object.hasOwn(draft.source, field) && source[field] === draft.source[field]) values[field] = draft.values[field];
  return { source: { ...source }, values };
}
