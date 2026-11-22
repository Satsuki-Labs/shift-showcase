import { Fragment } from 'react';
import { ArrowDown, CircleCheck, List, Pencil, Undo2, X } from 'lucide-react';
import { FieldGroup } from '../parts/FieldGroup';
import { Reveal } from '../parts/Reveal';
import { WarningMark } from '../parts/icons';
import { monthDay, slashMonthDay } from '../format/date';
import { shortTime } from '../format/time';
import { hasTime, type CellForm } from './cell-model';
import {
  bulkAttention,
  bulkBlockedDates,
  bulkClosedFacilities,
  bulkInputTarget,
  type BulkContext,
  type BulkKind,
  type BulkOptions,
  type BulkPreview,
  type BulkTarget,
} from './bulk-model';
import { ClosedFacilityNotice } from './ClosedFacilityNotice';
import { BulkCalendar, BulkLegend } from './BulkCalendar';
import type { SaveInput } from '../saving/types';
import './BulkReview.css';

const sites = ['第一', '第二'];
const kinds: Record<BulkKind, { label: string; className: string }> = {
  add: { label: '新しく入る', className: 'e1' },
  replace: { label: '入れ替え', className: 'e3' },
  cancel: { label: '取り消し', className: 'kd' },
  same: { label: 'そのまま', className: 'e2' },
};
export interface BulkReviewState {
  context: BulkContext;
  options: BulkOptions;
  preview: BulkPreview;
}
function BulkContent({
  form,
  target,
  old = false,
}: {
  form: CellForm;
  target: BulkTarget;
  old?: boolean;
}) {
  const slots = form.slots.filter((slot) => slot.building === target && hasTime(slot));
  const labels = {
    lead: '主',
    deputy: '副',
    closing: '閉',
    prep: '準備',
    temporary_absence: '抜',
    alpha: 'α',
    movement_first: 'Ⅰ',
    movement_second: 'Ⅱ',
  };
  return (
    <div className={`rv-row${old ? ' other-shift-before' : ''}`}>
      {form.status === 'paid_leave' || form.status === 'empty' ? (
        <span
          className={`bulk-state ${form.status === 'paid_leave' ? 'paid' : 'empty'}${old ? ' old' : ''}`}
        >
          {form.status === 'paid_leave' ? '有給' : '空'}
        </span>
      ) : slots.length ? (
        slots.map((slot) => (
          <span key={slot.id} className={`other-shift-band c${slot.building}`}>
            <span className="daily-area">{slot.facility}</span>
            <span>
              {shortTime(slot.start_time)}〜
              {form.specialCare ? <u>{shortTime(slot.end_time)}</u> : shortTime(slot.end_time)}
            </span>
            {slot.is_office && <span className="daily-role y">Y</span>}
          </span>
        ))
      ) : (
        <span className="other-shift-none">なし</span>
      )}
      <div className={`rc${old ? ' old' : ''}`}>
        {form.roles.length ? (
          form.roles.map((role) => <i key={role}>{labels[role]}</i>)
        ) : (
          <em>—</em>
        )}
      </div>
    </div>
  );
}
export function BulkReview({
  review,
  done,
  skipped,
  blocked,
  undo,
  restore,
  excludeGroup,
  dates,
}: {
  review: BulkReviewState;
  done: 'saved' | 'undone' | null;
  skipped: readonly string[];
  blocked: boolean;
  undo: SaveInput | null;
  restore: () => void;
  excludeGroup: (dates: readonly string[], excluded: boolean) => void;
  dates: readonly string[];
}) {
  const { context, options } = review,
    operation = options.operation;
  const reviewTarget = bulkInputTarget(options),
    changes = review.preview.days.filter((day) => day.input).length;
  const changeGroups = review.preview.groups.filter((group) => group.kind !== 'same');
  const sameGroups = review.preview.groups.filter((group) => group.kind === 'same');
  const operations = [
    { value: 'insert', label: '入れる' },
    { value: 'cancel', label: '取り消す' },
  ];
  return (
    <div className="rv">
      <section className="sec rv-top">
        <p className="sec-t">
          <List size={22} />
          <span>変更内容を確かめる</span>
          <span className="rv-pk">
            {sites[reviewTarget - 1]} ／ {operations.find((row) => row.value === operation)!.label}
          </span>
        </p>
        <FieldGroup className="rv-summary">
          <div className="rv-sum">
            <b className="big">
              {changes}
              <small>日間が変わります</small>
            </b>
            <div className="br">
              {(['add', 'replace', 'cancel', 'same'] as const).map((kind) => {
                const count = review.preview.days.filter(
                  (day) => day.kind === kind && (kind === 'same' || day.input),
                ).length;
                return (
                  count > 0 && (
                    <span key={kind} className={`pill ${kinds[kind].className}`}>
                      {kind === 'replace' && <WarningMark size={18} />}
                      {kinds[kind].label}
                      <b>{count}日間</b>
                    </span>
                  )
                );
              })}
            </div>
            <Reveal
              className="bulk-result"
              items={[
                {
                  key: done ?? 'pending',
                  content: done ? (
                    <div className="rv-tot">
                      <span className="rv-ok">
                        <CircleCheck size={26} />
                        {context.person.name}さんの一括入力を
                        {done === 'undone' ? '元に戻しました' : '保存しました'}
                      </span>
                      {done === 'saved' && undo && (
                        <button
                          className="btn btn-sub btn-small"
                          type="button"
                          onClick={() => {
                            restore();
                          }}
                        >
                          <Undo2 size={20} />
                          元に戻す
                        </button>
                      )}
                    </div>
                  ) : (
                    <span className="rv-note">保存するまで、シフトは変わりません</span>
                  ),
                },
              ]}
            />
          </div>
          <Reveal open={skipped.length > 0}>
            <div className="bulk-skipped">
              <div className="notice warn">
                <WarningMark size={22} />
                <div>
                  {skipped.map((date) => monthDay(date)).join('、')}
                  は、ほかの担当者が直したので戻していません
                </div>
              </div>
            </div>
          </Reveal>
        </FieldGroup>
      </section>
      {changeGroups.map((group, index, groups) => {
        const attention = done
          ? { lines: [], dates: [] }
          : bulkAttention(review.context, review.options, group);
        const closed = done
          ? []
          : bulkClosedFacilities(
              review.context,
              review.options,
              review.preview.days.filter((day) => group.dates.includes(day.date)),
            );
        return (
          <Fragment key={group.dates.join(',')}>
            {(index === 0 || groups[index - 1].kind !== group.kind) && (
              <div className="rv-kind-heading">
                <span className={`pill ${kinds[group.kind].className}`}>
                  {group.kind === 'replace' && <WarningMark size={18} />}
                  {kinds[group.kind].label}
                </span>
              </div>
            )}
            <Reveal
              items={[
                {
                  key: group.excluded ? 'excluded' : 'change',
                  content: group.excluded ? (
                    <div className="bulk-gone">
                      変更 {index + 1}（{kinds[group.kind].label}・{group.dates.length}
                      日間）を、外しました。この日は変更されません。
                      {!done && (
                        <button
                          type="button"
                          className="btn btn-sub btn-small"
                          disabled={blocked}
                          onClick={() => excludeGroup(group.dates, false)}
                        >
                          <Undo2 size={20} />
                          戻す
                        </button>
                      )}
                    </div>
                  ) : (
                    <section className={`rv-one k-${kinds[group.kind].className}`}>
                      <BulkCalendar
                        legend={<BulkLegend review changeLabel={kinds[group.kind].label} />}
                        dates={dates}
                        blocked={bulkBlockedDates(review.context)}
                        selected={group.dates}
                      />
                      <div className="rv-card">
                        <div className="bulk-change-heading">
                          <p className="sec-t">
                            <Pencil size={22} />
                            <span>
                              変更 {index + 1} ／ {groups.length}
                            </span>
                          </p>
                          {!done && (
                            <button
                              type="button"
                              className="btn btn-danger btn-small rm"
                              disabled={blocked}
                              onClick={() => excludeGroup(group.dates, true)}
                            >
                              <X size={20} />
                              外す
                            </button>
                          )}
                        </div>
                        {(attention.lines.length > 0 || closed.length > 0) && (
                          <ClosedFacilityNotice days={closed} className="bulk-attn">
                            {attention.lines.map((line, index) => (
                              <div
                                key={line}
                                className={
                                  attention.dates.length > 0 && index === attention.lines.length - 1
                                    ? 'close-names'
                                    : undefined
                                }
                              >
                                <b>{line}</b>
                                {index === attention.lines.length - 1 &&
                                  attention.dates.map((date) => <span key={date}>{date}</span>)}
                              </div>
                            ))}
                          </ClosedFacilityNotice>
                        )}
                        <div className="rv-h">
                          <div className="rv-st">
                            <span className="lab">変更前</span>
                            <BulkContent form={group.before} target={reviewTarget} old />
                          </div>
                          <div className="rv-rt">
                            <ArrowDown size={22} />
                            <span>
                              <b>{group.dates.length}</b>日間
                            </span>
                          </div>
                          <div className="rv-st af">
                            <span className="lab">変更後</span>
                            <BulkContent form={group.after} target={reviewTarget} />
                          </div>
                        </div>
                      </div>
                    </section>
                  ),
                },
              ]}
            />
          </Fragment>
        );
      })}
      {sameGroups.length > 0 && (
        <section className="rv-unchanged">
          <div className="rv-kind-heading">
            <span className={`pill ${kinds.same.className}`}>{kinds.same.label}</span>
          </div>
          <div className="rv-same-panel">
            {sameGroups.map((group, index) => (
              <div className="rv-same" key={index}>
                <BulkContent form={group.before} target={reviewTarget} />
                <span className="rv-dt">{group.dates.map(slashMonthDay).join('、')}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
