import { useEffect, useId, useState } from 'react';
import { FileSpreadsheet, LogOut, Mail, Settings, UserRound } from 'lucide-react';
import { MAX_STAFF_NAME_LENGTH } from '../../../shared/limits';
import type { ContactNames, FirstLoadResponse, Identity } from '../../../shared/protocol';
import { useAppFrame } from '../app/context';
import { Dialog, SaveButton, SaveConflictNotice } from '../parts/Dialog';
import { ConfirmDialog } from '../parts/ConfirmDialog';
import { SaveConflictDialog } from '../parts/SaveConflictDialog';
import { conflictRows } from '../parts/save-conflict';
import { Panel } from '../parts/Panel';
import { FieldGroup } from '../parts/FieldGroup';
import { CopyCode } from '../parts/CopyCode';
import { useSave } from '../saving/useSave';
import './SettingsDialog.css';

const roles = { first: '第一の担当者', second: '第二の担当者', maintenance: '保守担当' };
export function SettingsDialog({
  identity,
  contactNames,
  close,
}: {
  identity: Identity;
  contactNames: ContactNames;
  close: () => void;
}) {
  const { loading, refresh } = useAppFrame();
  const [before, setBefore] = useState(contactNames);
  const [names, setNames] = useState(contactNames);
  const [revisions, setRevisions] = useState(() =>
    loading.kind === 'ready' ? loading.data.contactNameRevisions : undefined,
  );
  const [conflict, setConflict] = useState(false);
  const [comparison, setComparison] = useState<FirstLoadResponse | null>(null);
  const [checkingOther, setCheckingOther] = useState(false);
  const [open, setOpen] = useState(true);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const id = useId();
  const { save, saving, showSpinner, outcome } = useSave();
  const changed = names.first !== before.first || names.second !== before.second;
  const changedSites = (['first', 'second'] as const).filter(
    (site) => names[site] !== before[site],
  );
  useEffect(() => {
    if (outcome?.kind === 'saved') setOpen(false);
    if (outcome?.kind === 'conflict') {
      setConflict(true);
      setRevisions((current) => {
        if (!current) return current;
        const next = { ...current };
        for (const item of outcome.conflicts)
          if (item.target.unit === 'contact-name' && item.revision !== null)
            next[item.target.site] = item.revision;
        return next;
      });
    }
  }, [outcome]);
  const confirmOther = async () => {
    if (saving || checkingOther) return;
    setCheckingOther(true);
    try {
      const result = await refresh();
      if (result.kind === 'ready') setComparison(result.data);
    } finally {
      setCheckingOther(false);
    }
  };
  const submit = () => {
    if (saving || checkingOther || !revisions) return;
    if (!changed) {
      setOpen(false);
      return;
    }
    const data = Object.fromEntries(changedSites.map((site) => [site, names[site]]));
    void save({
      operation: 'settings.contact-names.save',
      revisions: changedSites.map((site) => ({
        target: { unit: 'contact-name', site },
        revision: revisions[site],
      })),
      data,
      label: '担当者の名前',
    });
  };
  return (
    <>
      <Dialog
        title="設定"
        icon={<Settings size={24} strokeWidth={2.2} />}
        className="settings-dialog"
        close={close}
        open={open}
        changed={changed}
        notice={
          conflict ? (
            <SaveConflictNotice
              disabled={saving || checkingOther}
              confirmLabel="変更内容を確認"
              confirm={() => {
                void confirmOther();
              }}
            />
          ) : undefined
        }
        footer={
          <SaveButton
            disabled={saving || checkingOther || !revisions}
            showSpinner={showSpinner}
            conflict={conflict}
            submit={submit}
          />
        }
      >
        <Panel
          placement="inside"
          icon={<UserRound size={22} strokeWidth={2.2} />}
          title="ログイン"
          headingEnd={
            <button
              className="btn btn-danger btn-small settings-logout"
              type="button"
              onClick={() => setConfirmLogout(true)}
            >
              <LogOut size={18} strokeWidth={2} />
              ログアウト
            </button>
          }
        >
          <FieldGroup className="settings-login">
            <div className="kv">
              <span className="k">アドレス</span>
              <span className="v settings-login-address">{identity.email}</span>
            </div>
            <div className="kv">
              <span className="k">役割</span>
              <span className="v">{roles[identity.role]}</span>
            </div>
          </FieldGroup>
        </Panel>
        <Panel
          placement="inside"
          icon={<FileSpreadsheet size={22} strokeWidth={2.2} />}
          title="担当者の名前"
        >
          <FieldGroup>
            <div className="settings-name-fields">
              {(['first', 'second'] as const).map((site) => (
                <div key={site}>
                  <label className="lab" htmlFor={`${id}-${site}`}>
                    <span className={`dot ${site === 'first' ? 'c1' : 'c2'}`} />
                    {roles[site]}
                  </label>
                  <input
                    id={`${id}-${site}`}
                    className="field"
                    value={names[site]}
                    maxLength={MAX_STAFF_NAME_LENGTH}
                    onChange={(event) =>
                      setNames((current) => ({ ...current, [site]: event.target.value }))
                    }
                  />
                </div>
              ))}
            </div>
            <p className="settings-name-hint">Excelのシフト表の右上の注意書きに出ます。</p>
          </FieldGroup>
        </Panel>
        <Panel placement="inside" icon={<Mail size={22} strokeWidth={2.2} />} title="お問合せ先">
          <FieldGroup className="settings-contact">
            <CopyCode value="maintainer@example.com" codeClassName="settings-contact-address" />
          </FieldGroup>
        </Panel>
      </Dialog>
      {confirmLogout && (
        <ConfirmDialog
          title="ログアウトしますか？"
          subtitle=""
          icon={<LogOut size={24} strokeWidth={2.2} />}
          className="settings-logout-confirm"
          message="以下のアカウントからログアウトします。"
          detail={
            <>
              <p className="settings-logout-account">{identity.email}</p>
              <p>シフトアプリを使用するには、再度ログインする必要があります。</p>
            </>
          }
          open
          saving={false}
          cancelLabel="いいえ"
          confirmLabel="はい、ログアウトする"
          close={() => setConfirmLogout(false)}
          confirm={() => window.location.assign('/cdn-cgi/access/logout')}
        />
      )}
      {comparison && (
        <SaveConflictDialog
          target="担当者の名前"
          rows={conflictRows(
            changedSites.map((site) => ({
              label: roles[site],
              yours: names[site],
              theirs: comparison.contactNames[site],
            })),
          )}
          close={() => setComparison(null)}
          keep={() => {
            setNames({
              ...comparison.contactNames,
              ...Object.fromEntries(changedSites.map((site) => [site, names[site]])),
            });
            setBefore(comparison.contactNames);
            setRevisions(comparison.contactNameRevisions);
            setComparison(null);
          }}
          take={() => {
            setNames(comparison.contactNames);
            setBefore(comparison.contactNames);
            setRevisions(comparison.contactNameRevisions);
            setConflict(false);
            setComparison(null);
          }}
        />
      )}
    </>
  );
}
