import { useEffect, useState } from 'react';
import { Dialog, getOpenDialogCount, useOpenDialogCount } from '../parts/Dialog';
import type { SaveWindow } from '../saving/window';
import { WarningMark } from '../parts/icons';

function shouldShowUpdateNotice(newAppVersion: string | null, otherDialogs: number) {
  return newAppVersion !== null && otherDialogs === 0;
}
export function updateApplication(
  saving: Pick<SaveWindow, 'suppressBeforeUnloadForReload'> | null,
  reload = () => window.location.reload(),
) {
  saving?.suppressBeforeUnloadForReload();
  reload();
}
export function UpdateNotice({
  newAppVersion,
  saving,
}: {
  newAppVersion: string | null;
  saving: SaveWindow | null;
}) {
  const count = useOpenDialogCount();
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (shouldShowUpdateNotice(newAppVersion, getOpenDialogCount())) setShown(true);
  }, [newAppVersion, count]);
  // Once shown, this dialog remains open until the page reloads, including its own registration.
  if (!shown || newAppVersion === null) return null;
  return (
    <Dialog
      title="新しいバージョンがあります"
      icon={<WarningMark size={26} />}
      className="update-notice"
      hideClose
      dismissible={false}
      close={() => {}}
      footer={
        <button className="btn btn-main" type="button" onClick={() => updateApplication(saving)}>
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 12a9 9 0 1 1-2.64-6.36" />
            <path d="M21 3v6h-6" />
          </svg>
          更新する
        </button>
      }
    >
      {null}
    </Dialog>
  );
}
