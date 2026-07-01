function legacyCopy(text: string): boolean {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '0';
  textarea.style.left = '0';
  textarea.style.width = '2em';
  textarea.style.height = '2em';
  textarea.style.padding = '0';
  textarea.style.border = 'none';
  textarea.style.outline = 'none';
  textarea.style.boxShadow = 'none';
  textarea.style.background = 'transparent';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } finally {
    document.body.removeChild(textarea);
  }
  return ok;
}

/** 复制文本到剪贴板；安全上下文优先 Clipboard API，否则回退 execCommand。 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) return false;

  if (typeof window !== 'undefined' && window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return legacyCopy(text);
    }
  }

  return legacyCopy(text);
}

/** 从剪贴板读取文本；安全上下文优先 Clipboard API，失败时返回 null。 */
export async function readTextFromClipboard(): Promise<string | null> {
  if (typeof window === 'undefined' || !window.isSecureContext || !navigator.clipboard?.readText) {
    return null;
  }
  try {
    const text = await navigator.clipboard.readText();
    return text || null;
  } catch {
    return null;
  }
}
