import { layoutRect, layoutValue } from '../parts/viewport';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
} from 'react';
import { ArrowDown, ArrowUp, Check, Menu } from 'lucide-react';
import type { CurrentRevision, FirstLoadResponse, Staff } from '../../../shared/protocol';
import { currentEmploymentStatus, japanToday } from '../../../shared/staff';
import { useAppFrame } from '../app/context';
import { SaveConflictNotice } from '../parts/Dialog';
import { SaveConflictDialog } from '../parts/SaveConflictDialog';
import { conflictRows } from '../parts/save-conflict';
import { useSave } from '../saving/useSave';

function StaffReorderActions({
  order,
  revision,
  conflict,
  checkingOther,
  close,
  setSaving,
  conflicted,
}: {
  order: Staff[];
  revision: number | null;
  conflict: boolean;
  checkingOther: boolean;
  close: () => void;
  setSaving: (saving: boolean) => void;
  conflicted: (conflicts: CurrentRevision[]) => void;
}) {
  const { save, saving, showSpinner, outcome } = useSave();
  useLayoutEffect(() => {
    setSaving(saving);
  }, [saving, setSaving]);
  useEffect(() => {
    if (outcome?.kind === 'saved') close();
    if (outcome?.kind === 'conflict') conflicted(outcome.conflicts);
  }, [outcome, close, conflicted]);
  return (
    <>
      <button className="btn staff-reorder-cancel" type="button" onClick={close}>
        キャンセル
      </button>
      <button
        className="btn staff-reorder-save"
        type="button"
        disabled={showSpinner || checkingOther || revision == null}
        onClick={() => {
          if (!saving)
            void save({
              operation: 'staff.reorder',
              revisions: [{ target: { unit: 'staff-order' }, revision }],
              data: order.map((person) => person.id),
              label: 'スタッフの並び順',
            });
        }}
      >
        {showSpinner ? <span className="spinner dark" /> : <Check size={22} strokeWidth={2.4} />}
        {conflict ? '保存し直す' : '順番を保存する'}
      </button>
    </>
  );
}
export function useStaffReorder(staff: Staff[]) {
  const { loading, refresh, setNavigationLocked } = useAppFrame();
  const [enabled, setEnabled] = useState(false);
  const [order, setOrder] = useState<Staff[]>([]);
  const [revision, setRevision] = useState<number | null>(null);
  const [conflict, setConflict] = useState(false);
  const [comparison, setComparison] = useState<FirstLoadResponse | null>(null);
  const [checkingOther, setCheckingOther] = useState(false);
  const [saving, setSaving] = useState(false);
  const close = useCallback(() => {
    setEnabled(false);
    setSaving(false);
  }, []);
  const begin = () => {
    setRevision(loading.kind === 'ready' ? loading.data.staffOrderRevision : null);
    setConflict(false);
    setComparison(null);
    const active = staff.filter(
      (person) => currentEmploymentStatus(person, japanToday()) !== 'retired',
    );
    orderRef.current = active;
    setOrder(active);
    setEnabled(true);
  };
  const orderRef = useRef(order);
  const rows = useRef(new Map<string, HTMLDivElement>()),
    root = useRef<HTMLDivElement>(null);
  const before = useRef<Map<string, number> | null>(null);
  const drag = useRef<{ staffId: string; pointerId: number; grab: number; y: number } | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const conflicted = useCallback((conflicts: CurrentRevision[]) => {
    setConflict(true);
    setRevision(conflicts.find((item) => item.target.unit === 'staff-order')?.revision ?? null);
  }, []);
  useLayoutEffect(() => {
    if (!enabled) return;
    setNavigationLocked(true);
    return () => setNavigationLocked(false);
  }, [enabled, setNavigationLocked]);
  useEffect(() => {
    if (!enabled) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [enabled]);
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

  const follow = () => {
    const moving = drag.current,
      container = root.current;
    if (!moving || !container) return;
    const row = rows.current.get(moving.staffId)!;
    row.style.transform = `translateY(${moving.y - moving.grab - (layoutRect(row.offsetParent!).top + row.offsetTop)}px)`;
  };
  const move = (from: number, to: number) => {
    if (saving || from === to || to < 0 || to >= orderRef.current.length) return;
    before.current = new Map([...rows.current].map(([id, row]) => [id, layoutRect(row).top]));
    const next = [...orderRef.current],
      [person] = next.splice(from, 1);
    next.splice(to, 0, person);
    orderRef.current = next;
    setOrder(next);
  };
  useLayoutEffect(() => {
    const positions = before.current;
    if (!positions) return;
    // Reveal commits the reordered keyed rows in its layout effect. Animate the
    // table rows after that commit, before the browser paints the new order.
    queueMicrotask(() => {
      before.current = null;
      rows.current.forEach((row, id) => {
        if (id === drag.current?.staffId) return;
        row.style.transition = 'none';
        row.style.transform = '';
        const delta = positions.get(id)! - layoutRect(row).top;
        row.style.transform = `translateY(${delta}px)`;
        void row.offsetHeight;
        row.style.transition = '';
        row.style.transform = '';
      });
      if (drag.current) {
        // React moves the existing row; restore capture after moving it in the DOM.
        rows.current.get(drag.current.staffId)!.setPointerCapture(drag.current.pointerId);
        follow();
      }
    });
  }, [order]);
  const start = (event: PointerEvent<HTMLDivElement>, staffId: string) => {
    if (saving || event.button !== 0 || (event.target as Element).closest('button')) return;
    event.preventDefault();
    const row = event.currentTarget;
    row.setPointerCapture(event.pointerId);
    row.style.transition = '';
    drag.current = {
      staffId,
      pointerId: event.pointerId,
      grab: layoutValue(event.clientY) - layoutRect(row).top,
      y: layoutValue(event.clientY),
    };
    setDraggedId(staffId);
  };
  const dragMove = (event: PointerEvent<HTMLDivElement>) => {
    const moving = drag.current,
      container = root.current;
    if (!moving || moving.pointerId !== event.pointerId || !container) return;
    moving.y = layoutValue(event.clientY);
    follow();
    const row = rows.current.get(moving.staffId)!,
      middle = moving.y - moving.grab + row.offsetHeight / 2;
    const to = orderRef.current
      .filter((person) => person.id !== moving.staffId)
      .filter((person) => {
        const other = rows.current.get(person.id)!;
        return (
          middle > layoutRect(other.offsetParent!).top + other.offsetTop + other.offsetHeight / 2
        );
      }).length;
    move(
      orderRef.current.findIndex((person) => person.id === moving.staffId),
      to,
    );
  };
  const drop = (event: PointerEvent<HTMLDivElement>) => {
    const moving = drag.current;
    if (!moving || moving.pointerId !== event.pointerId) return;
    const row = rows.current.get(moving.staffId)!;
    drag.current = null;
    setDraggedId(null);
    row.classList.remove('dragging');
    row.style.transform = '';
    if (row.hasPointerCapture(event.pointerId)) row.releasePointerCapture(event.pointerId);
  };
  return {
    enabled,
    begin,
    close,
    order,
    root,
    notice: conflict ? (
      <SaveConflictNotice
        disabled={saving || checkingOther}
        confirmLabel="変更内容を確認"
        confirm={() => {
          void confirmOther();
        }}
      />
    ) : null,
    comparison: comparison ? (
      <SaveConflictDialog
        target="スタッフの並び順"
        rows={conflictRows([
          {
            label: 'スタッフの並び順',
            yours: order.map((person) => person.name).join('\n'),
            theirs: comparison.staff
              .filter((person) => currentEmploymentStatus(person, japanToday()) !== 'retired')
              .map((person) => person.name)
              .join('\n'),
          },
        ])}
        close={() => setComparison(null)}
        keep={() => {
          const active = comparison.staff.filter(
            (person) => currentEmploymentStatus(person, japanToday()) !== 'retired',
          );
          const next = [
            ...order.flatMap((person) => active.filter((item) => item.id === person.id)),
            ...active.filter((person) => !order.some((item) => item.id === person.id)),
          ];
          orderRef.current = next;
          setOrder(next);
          setRevision(comparison.staffOrderRevision);
          setComparison(null);
        }}
        take={() => {
          const next = comparison.staff.filter(
            (person) => currentEmploymentStatus(person, japanToday()) !== 'retired',
          );
          orderRef.current = next;
          setOrder(next);
          setRevision(comparison.staffOrderRevision);
          setConflict(false);
          setComparison(null);
        }}
      />
    ) : null,
    actions: enabled ? (
      <StaffReorderActions
        order={order}
        revision={revision}
        conflict={conflict}
        checkingOther={checkingOther}
        close={close}
        setSaving={setSaving}
        conflicted={conflicted}
      />
    ) : null,
    row: (person: Staff, index: number) => ({
      ref: (node: HTMLDivElement | null) => {
        if (node) rows.current.set(person.id, node);
        else rows.current.delete(person.id);
      },
      className: person.id === draggedId ? ' dragging' : '',
      onPointerDown: (event: PointerEvent<HTMLDivElement>) => start(event, person.id),
      onPointerMove: dragMove,
      onPointerUp: drop,
      onPointerCancel: drop,
      lead: (
        <span className="staff-reorder-lead">
          <span className="staff-reorder-number">{index + 1}</span>
          <span className="staff-reorder-grip" title="つかんで動かす">
            <Menu size={20} strokeWidth={2.4} />
          </span>
        </span>
      ),
      arrows: (
        <span className="staff-reorder-arrows">
          <button
            className="icon-button"
            type="button"
            disabled={saving || index === 0}
            onClick={() => move(index, index - 1)}
          >
            <ArrowUp size={22} strokeWidth={2.6} />
          </button>
          <button
            className="icon-button"
            type="button"
            disabled={saving || index === order.length - 1}
            onClick={() => move(index, index + 1)}
          >
            <ArrowDown size={22} strokeWidth={2.6} />
          </button>
        </span>
      ),
    }),
  };
}
export type StaffReorder = ReturnType<typeof useStaffReorder>;
