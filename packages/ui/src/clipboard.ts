/**
 * Puts text on the clipboard. Where the clipboard API is refused (a frame without focus or without
 * the permission), copies from a hidden field, then gives the selection and the focus back.
 */
export async function writeClipboard(text: string, doc: Document = document): Promise<boolean> {
  try {
    await doc.defaultView!.navigator.clipboard.writeText(text);
    return true;
  } catch {
    return copyFromHiddenField(text, doc);
  }
}

function copyFromHiddenField(text: string, doc: Document): boolean {
  const selection = doc.getSelection();
  const kept = selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
  const focused = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
  const box = doc.createElement("textarea");
  box.value = text;
  box.setAttribute("aria-hidden", "true");
  box.style.cssText = "position:fixed;opacity:0;top:0;left:0";
  doc.body.append(box);
  box.select();
  let copied = false;
  try {
    copied = doc.execCommand?.("copy") ?? false;
  } catch {
    copied = false;
  }
  box.remove();
  focused?.focus({ preventScroll: true });
  if (kept && selection) {
    selection.removeAllRanges();
    selection.addRange(kept);
  }
  return copied;
}
