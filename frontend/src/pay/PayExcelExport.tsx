import { useState } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import type { PeriodSummary } from '../../../shared/protocol';
import { japanToday } from '../../../shared/staff';
import { payExcelFileName } from '../format/labels';
import { ExcelExportHeading, ExcelExportPopup } from '../parts/ExcelExport';
import { FieldGroup } from '../parts/FieldGroup';
import './PayExcelExport.css';

export function PayExcelExport({
  period,
  target,
  disabled,
  busy = false,
  output,
}: {
  period: PeriodSummary;
  target: string;
  disabled: boolean;
  busy?: boolean;
  output: (outputDate: string) => void;
}) {
  const [outputDate, setOutputDate] = useState(japanToday);
  const rows = [
    ['対象', target],
    ['ファイル名', payExcelFileName(period.name, target, outputDate)],
  ];
  return (
    <ExcelExportPopup
      disabled={disabled}
      busy={busy}
      placement="reveal-below"
      className="pay-excel-popup"
      onOpen={() => setOutputDate(japanToday())}
    >
      {(close) => (
        <>
          <ExcelExportHeading
            periodName={period.name}
            startDate={period.start_date}
            endDate={period.end_date}
          />
          <FieldGroup className="pay-excel-group">
            <div className="pay-excel-facts">
              {rows.map(([name, value]) => (
                <div className="kv" key={name}>
                  <span className="k">{name}</span>
                  <span className="v">{value}</span>
                </div>
              ))}
            </div>
            <div className="pay-excel-actions">
              <button
                type="button"
                className="btn btn-main"
                disabled={disabled || busy}
                onClick={() => {
                  close();
                  output(outputDate);
                }}
              >
                <FileSpreadsheet size={22} strokeWidth={2.4} />
                出力する
              </button>
            </div>
          </FieldGroup>
        </>
      )}
    </ExcelExportPopup>
  );
}
