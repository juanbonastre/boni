/**
 * A field that opens with text in it takes the focus with the caret after that text (task 97): Juan goes on writing
 * where he left off. Chromium focuses a textarea React has just made with its caret at the start, so a draft read back
 * after a restart took what he typed in front of it.
 */
type Field = HTMLInputElement | HTMLTextAreaElement;

/**
 * Focuses `el` with its caret at the end. Called again while it already has the focus (a ref runs on every render),
 * it leaves the caret where Juan put it.
 */
export function focusAtEnd(el: Field | null | undefined, options?: FocusOptions): void {
  if (!el || el.ownerDocument.activeElement === el) return;
  el.focus(options);
  const end = el.value.length;
  el.setSelectionRange(end, end);
}
