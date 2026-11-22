import { Check } from 'lucide-react';
import { Reveal } from '../parts/Reveal';
import { hasTime, type SlotDraft } from './cell-model';
import { shortTime } from '../format/time';
import './OfficeWorkSelector.css';

export function OfficeWorkSelector({
  slots,
  choose,
}: {
  slots: readonly SlotDraft[];
  choose: (id: number) => void;
}) {
  const populated = slots.filter(hasTime);
  return (
    <Reveal open={populated.some((slot) => slot.is_office) && populated.length >= 2}>
      <div className="shift-office-choice">
        <b>事務の勤務</b>
        {[...populated]
          .sort((a, b) => a.start_time.localeCompare(b.start_time))
          .map((slot) => (
            <button
              type="button"
              key={slot.id}
              className={slot.is_office ? 'on' : ''}
              onClick={() => choose(slot.id)}
            >
              {slot.is_office && <Check size={18} />}
              {shortTime(slot.start_time)}〜{shortTime(slot.end_time)}
            </button>
          ))}
      </div>
    </Reveal>
  );
}
