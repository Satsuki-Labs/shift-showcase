export function dismissUnchangedDialog(
  dismissible: boolean,
  changed: boolean,
  blocked: () => boolean,
  close: () => void,
) {
  if (dismissible && !changed && !blocked()) close();
}
