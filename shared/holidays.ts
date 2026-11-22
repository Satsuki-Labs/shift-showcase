/**
 * 出どころ：内閣府「国民の祝日」のCSV（文字の形式はShift_JIS）。
 * https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv
 * 翌年の分が公表されたら、その年の日付と名前をHOLIDAYSの末尾に足す。
 * 振替休日などの「休日」の行も全部含め、今ある行は変えない。
 * HOLIDAYS_END_DATEを、追加した年の12月31日に直す。
 * npm testとnpm run typecheckを通す。
 */
export const HOLIDAYS_END_DATE = '2027-12-31';
const HOLIDAYS = [
  { date: '2025-01-01', name: '元日' },
  { date: '2025-01-13', name: '成人の日' },
  { date: '2025-02-11', name: '建国記念の日' },
  { date: '2025-02-23', name: '天皇誕生日' },
  { date: '2025-02-24', name: '休日' },
  { date: '2025-03-20', name: '春分の日' },
  { date: '2025-04-29', name: '昭和の日' },
  { date: '2025-05-03', name: '憲法記念日' },
  { date: '2025-05-04', name: 'みどりの日' },
  { date: '2025-05-05', name: 'こどもの日' },
  { date: '2025-05-06', name: '休日' },
  { date: '2025-07-21', name: '海の日' },
  { date: '2025-08-11', name: '山の日' },
  { date: '2025-09-15', name: '敬老の日' },
  { date: '2025-09-23', name: '秋分の日' },
  { date: '2025-10-13', name: 'スポーツの日' },
  { date: '2025-11-03', name: '文化の日' },
  { date: '2025-11-23', name: '勤労感謝の日' },
  { date: '2025-11-24', name: '休日' },
  { date: '2026-01-01', name: '元日' },
  { date: '2026-01-12', name: '成人の日' },
  { date: '2026-02-11', name: '建国記念の日' },
  { date: '2026-02-23', name: '天皇誕生日' },
  { date: '2026-03-20', name: '春分の日' },
  { date: '2026-04-29', name: '昭和の日' },
  { date: '2026-05-03', name: '憲法記念日' },
  { date: '2026-05-04', name: 'みどりの日' },
  { date: '2026-05-05', name: 'こどもの日' },
  { date: '2026-05-06', name: '休日' },
  { date: '2026-07-20', name: '海の日' },
  { date: '2026-08-11', name: '山の日' },
  { date: '2026-09-21', name: '敬老の日' },
  { date: '2026-09-22', name: '休日' },
  { date: '2026-09-23', name: '秋分の日' },
  { date: '2026-10-12', name: 'スポーツの日' },
  { date: '2026-11-03', name: '文化の日' },
  { date: '2026-11-23', name: '勤労感謝の日' },
  { date: '2027-01-01', name: '元日' },
  { date: '2027-01-11', name: '成人の日' },
  { date: '2027-02-11', name: '建国記念の日' },
  { date: '2027-02-23', name: '天皇誕生日' },
  { date: '2027-03-21', name: '春分の日' },
  { date: '2027-03-22', name: '休日' },
  { date: '2027-04-29', name: '昭和の日' },
  { date: '2027-05-03', name: '憲法記念日' },
  { date: '2027-05-04', name: 'みどりの日' },
  { date: '2027-05-05', name: 'こどもの日' },
  { date: '2027-07-19', name: '海の日' },
  { date: '2027-08-11', name: '山の日' },
  { date: '2027-09-20', name: '敬老の日' },
  { date: '2027-09-23', name: '秋分の日' },
  { date: '2027-10-11', name: 'スポーツの日' },
  { date: '2027-11-03', name: '文化の日' },
  { date: '2027-11-23', name: '勤労感謝の日' },
] as const;

export function holidayName(date: string): string | undefined {
  return HOLIDAYS.find((holiday) => holiday.date === date)?.name;
}
