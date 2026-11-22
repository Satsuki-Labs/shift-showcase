import './staff.css';
import { useCallback, useLayoutEffect, useState } from 'react';
import { ArrowUpDown, CalendarClock, Plus, UserRound } from 'lucide-react';
import type { Staff } from '../../../shared/protocol';
import { staffAssignments, currentEmploymentStatus, japanToday } from '../../../shared/staff';
import { StaffEditor, staffViews, type StaffView, type StaffEditorExit } from './StaffEditor';
import { StaffTable } from './StaffTable';
import { useStaffReorder } from './StaffReorder';
import { RaisedPanel } from '../parts/RaisedPanel';
import { Segmented } from '../parts/Segmented';
import { NumberUnits } from '../parts/NumberUnits';

export function StaffTab({
  staff,
  initialStaffId,
  finishBulkEdit,
}: {
  staff: Staff[];
  initialStaffId?: string;
  finishBulkEdit?: (reopen: boolean) => void;
}) {
  const [editing, setEditing] = useState<Staff | null | undefined>(() =>
    staff.find((person) => person.id === initialStaffId),
  );
  const [view, setView] = useState<StaffView>(initialStaffId ? '既定のシフト' : '基本情報');
  const [editorTransition, setEditorTransition] = useState(!initialStaffId);
  const [listReturning, setListReturning] = useState(false);
  const [focusStaffId, setFocusStaffId] = useState<string>();
  const close = useCallback(
    (reason: StaffEditorExit) => {
      if (initialStaffId) finishBulkEdit?.(reason === 'saved' || reason === 'cancelled');
      setEditorTransition(true);
      setListReturning(true);
      setEditing(undefined);
      window.scrollTo(0, 0);
    },
    [initialStaffId, finishBulkEdit],
  );
  const edit = useCallback((person: Staff | null) => {
    setFocusStaffId(person?.id);
    setEditorTransition(true);
    setListReturning(false);
    setView('基本情報');
    setEditing(person);
    window.scrollTo(0, 0);
  }, []);
  useLayoutEffect(() => {
    if (initialStaffId) window.scrollTo(0, 0);
  }, [initialStaffId]);
  const editor = editing !== undefined;
  const reorder = useStaffReorder(staff);
  const today = japanToday();
  const active = staff.filter((person) => currentEmploymentStatus(person, today) !== 'retired');
  return (
    <div className="staff-tab">
      <div className="toolbar">
        <h1>スタッフ管理</h1>
      </div>
      <RaisedPanel
        className="staff-panel"
        data-editing={editor}
        data-list-return={listReturning}
        data-editor-transition={editorTransition}
        data-reordering={reorder.enabled}
        raised="navy"
        back={editor}
        animateBack={editorTransition}
        padding={false}
        bandSelector=".staff-list > .band"
        left={
          editor ? (
            <Segmented
              options={staffViews}
              value={view}
              onChange={setView}
              prefix={(option) =>
                option === '基本情報' ? (
                  <UserRound size={20} strokeWidth={2.2} />
                ) : (
                  <CalendarClock size={20} strokeWidth={2.2} />
                )
              }
            />
          ) : (
            <div className="cards">
              <div className="cardk">
                <small>在籍</small>
                <b>
                  <NumberUnits>{`${active.length}人`}</NumberUnits>
                </b>
              </div>
              <div className="cardk">
                <small>
                  <span className="dot c1" />
                  第一
                </small>
                <b>
                  <NumberUnits>{`${active.filter((person) => staffAssignments(person).first).length}人`}</NumberUnits>
                </b>
              </div>
              <div className="cardk">
                <small>
                  <span className="dot c2" />
                  第二
                </small>
                <b>
                  <NumberUnits>{`${active.filter((person) => staffAssignments(person).second).length}人`}</NumberUnits>
                </b>
              </div>
            </div>
          )
        }
        actions={
          editor ? null : reorder.enabled ? (
            reorder.actions
          ) : (
            <>
              <button
                className="btn"
                type="button"
                disabled={active.length < 2}
                onClick={reorder.begin}
              >
                <ArrowUpDown size={22} strokeWidth={2.2} />
                並び替え
              </button>
              <button className="btn" type="button" onClick={() => edit(null)}>
                <Plus size={22} strokeWidth={2.4} />
                新規追加
              </button>
            </>
          )
        }
      >
        {editor ? (
          <section className="staff-list staff-editor-list">
            <header className="band nv">
              <UserRound size={22} strokeWidth={2.4} />
              <b key={editing?.id ?? 'new'}>{editing?.name ?? '新しいスタッフ'}</b>
            </header>
            <StaffEditor
              key={editing?.id ?? 'new'}
              staff={
                editing ? (staff.find((person) => person.id === editing.id) ?? editing) : undefined
              }
              missing={Boolean(editing && !staff.some((person) => person.id === editing.id))}
              close={close}
              view={view}
              fromBulkEdit={Boolean(initialStaffId)}
            />
          </section>
        ) : (
          <StaffTable
            staff={staff}
            edit={edit}
            reorder={reorder}
            focusStaffId={listReturning ? focusStaffId : undefined}
          />
        )}
      </RaisedPanel>
    </div>
  );
}
