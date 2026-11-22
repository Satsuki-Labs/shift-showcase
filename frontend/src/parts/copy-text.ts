export async function copyText(address: HTMLElement): Promise<boolean> {
  const text = address.textContent ?? '';
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // 閉じた小窓や、作り直す前のURLには、焦点や選択を戻さない。
    if (!address.isConnected || address.textContent !== text) return false;
  }

  const previousFocus = document.activeElement;
  const input = document.createElement('textarea');
  input.className = 'copy-code-input';
  input.value = text;
  input.readOnly = true;
  input.tabIndex = -1;
  let copied = false;
  try {
    address.parentElement!.append(input);
    input.focus({ preventScroll: true });
    input.select();
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  } finally {
    input.remove();
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
      previousFocus.focus({ preventScroll: true });
  }

  if (!copied) {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(address);
    selection?.removeAllRanges();
    selection?.addRange(range);
  }
  return copied;
}
