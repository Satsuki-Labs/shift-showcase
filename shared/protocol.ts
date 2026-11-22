import type { ErrorCode } from './error-codes';
import type { DayRole, DefaultStaffRole, DefaultWorkTimes } from './staff';
import type { PeriodSnapshot } from './period-snapshot';

declare const __APP_VERSION__: string;
export const APP_VERSION = __APP_VERSION__;

export type Role = 'first' | 'second' | 'maintenance';
export interface Identity {
  email: string;
  role: Role;
}
export interface ResponseMetadata {
  appVersion: string;
  dataGeneration: string | null;
  requestId: string;
}
export interface ErrorResponse {
  code: ErrorCode;
  requestId: string;
  field?: string;
}

interface JsonObject {
  [key: string]: JsonValue;
}
interface JsonArray extends Array<JsonValue> {}
export type JsonValue = null | boolean | number | string | JsonArray | JsonObject;
export type RevisionTarget =
  | { unit: 'staff' | 'period'; id: string }
  | { unit: 'staff-order' }
  | { unit: 'contact-name'; site: 'first' | 'second' }
  | { unit: 'peak'; startDate: string; endDate: string }
  | {
      unit: 'annual-closure';
      startMonth: number;
      startDay: number;
      endMonth: number;
      endDay: number;
    }
  | { unit: 'opening-rule'; fiscalYear: number; facility: 'A' | 'B' | 'C' | 'D' }
  | { unit: 'day-state' | 'daily-request'; staffId: string; date: string }
  | { unit: 'work-slot'; staffId: string; date: string; building: 1 | 2 }
  | { unit: 'facility-day'; facility: 'A' | 'B' | 'C' | 'D'; date: string }
  | { unit: 'building-day'; building: 1 | 2; date: string }
  | { unit: 'no-request'; staffId: string; periodId: string };
// null means that the target row does not exist (including a new or deleted row).
export interface Revision {
  target: RevisionTarget;
  revision: number | null;
}
export interface CurrentRevision extends Revision {
  data: JsonValue;
}
export interface SaveRequest {
  operationId: string;
  operation: string;
  revisions: Revision[];
  data: JsonValue;
  dataGeneration: string;
  saveShapeVersion: number;
}
export interface SaveSuccess {
  ok: true;
  revisions: Revision[];
  data: JsonValue;
  dataChangeNumber: number;
}
export interface SaveConflict {
  code: 'E-33';
  conflicts: CurrentRevision[];
}
export interface SaveConflictResponse extends SaveConflict {
  requestId: string;
}
export type SaveResponse = SaveSuccess | SaveConflictResponse | ErrorResponse;

export interface StaffHistory {
  staff_id: string;
  since: string;
  quarter_hour_pay: number;
  employment_type: 'full_time' | 'part_time' | 'casual';
  qualification: 'certified' | 'assistant' | 'none';
  budget: number;
}
export interface Staff {
  id: string;
  name: string;
  notes: string;
  sort_order: number;
  default_first_facility: string | null;
  default_second_facility: string | null;
  default_work_times: DefaultWorkTimes;
  default_roles: DefaultStaffRole[];
  employment_status: 'active' | 'leave' | 'retired';
  leave_start_date: string | null;
  leave_expected_end_date: string | null;
  retirement_date: string | null;
  revision: number;
  history: StaffHistory[];
  in_use: boolean;
}
export interface PeriodSummary {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  request_deadline_date: string | null;
  coverage: PeriodCoverage[];
  request_url_key: string;
  requests_closed_at: string | null;
  has_request_submissions: boolean;
  first_published_at: string | null;
  second_published_at: string | null;
  first_last_distributed_at: string | null;
  second_last_distributed_at: string | null;
  revision: number;
}
export interface PeriodsChangedData {
  periods: PeriodSummary[];
  staff: Staff[];
}
export interface PeriodCoverage {
  facility: 'A' | 'B' | 'C' | 'D';
  total_required: number;
}
export interface PeriodSaveInput {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  request_deadline_date: string | null;
  coverage: PeriodCoverage[];
}
export type PrintedCells = Record<string, Record<string, string>>;
export interface PeriodDistributeInput {
  id: string;
  site: 'first' | 'second';
  cells: PrintedCells;
}
export interface DistributedSheet {
  distributed_at: string;
  cells: PrintedCells;
}
export interface OpeningRule {
  fiscal_year: number;
  facility: string;
  normal_start_time: string;
  normal_end_time: string;
  peak_start_time: string;
  peak_end_time: string;
  saturday_start_time: string;
  saturday_end_time: string;
  arrival_end_mode: 'fixed_time' | 'duration';
  arrival_end_time: string | null;
  arrival_duration_minutes: number | null;
}
export interface AnnualRules {
  openingRules: OpeningRule[];
  peaks: { start_date: string; end_date: string; name: string }[];
  annualClosures: {
    start_month: number;
    start_day: number;
    end_month: number;
    end_day: number;
    name: string;
  }[];
}
export interface AnnualRulesChangedData {
  rules: AnnualRules;
  skipped: { date: string; staff_ids: string[] }[];
}
interface CalendarEvent {
  content: string;
  arrival_time: string | null;
}
export type BuildingEntry = ({ kind: 'event' } & CalendarEvent) | { kind: 'memo'; content: string };
export interface FacilityDay {
  facility: 'A' | 'B' | 'C' | 'D';
  date: string;
  is_open: boolean | null;
  start_time: string | null;
  end_time: string | null;
  revision: number;
}
export interface BuildingDay {
  building: 1 | 2;
  date: string;
  entries: BuildingEntry[];
  revision: number;
}
export interface CalendarRows {
  facilityDays: FacilityDay[];
  buildingDays: BuildingDay[];
}
export interface YearLoadResponse extends ResponseMetadata, CalendarRows {}
export interface DayState {
  staff_id: string;
  date: string;
  status: 'none' | 'paid_leave' | 'empty';
  roles: string[];
  special_care: boolean;
  last_changed_by: string;
  last_changed_at: string;
  revision: number;
}
export interface WorkSlotTime {
  start_time: string;
  end_time: string;
  facility: 'A' | 'B' | 'C' | 'D';
  is_office: boolean;
}
export interface WorkSlot {
  staff_id: string;
  date: string;
  building: 1 | 2;
  slots: [WorkSlotTime] | [WorkSlotTime, WorkSlotTime];
  last_changed_by: string;
  last_changed_at: string;
  revision: number;
}
export interface PeriodLoadResponse extends ResponseMetadata, CalendarRows {
  periodId: string;
  dayStates: DayState[];
  workSlots: WorkSlot[];
  distributedSheets?: Partial<Record<'first' | 'second', DistributedSheet>>;
  dailyRequests: PeriodDailyRequest[];
  noRequests: Pick<NoRequest, 'staff_id'>[];
  requestStaffIds: string[];
  paidLeaveDates: { staff_id: string; date: string }[];
  snapshot: PeriodSnapshot | null;
}
export interface ShiftCellSaveInput {
  staff_id: string;
  date: string;
  status: DayState['status'];
  roles: DayRole[];
  special_care: boolean;
  buildings: { building: 1 | 2; slots: [] | WorkSlot['slots'] }[];
  notes: string | null;
}
export interface ShiftCellCancelInput {
  staff_id: string;
  date: string;
  building: 1 | 2;
}
export interface ShiftCellChangedData {
  staff_id: string;
  date: string;
  dayState: DayState | null;
  workSlots: WorkSlot[];
  staff: Staff | null;
}
export interface ShiftBulkSaveInput {
  cells: ShiftCellSaveInput[];
}
export interface ShiftBulkChangedData {
  cells: ShiftCellChangedData[];
}
export interface CalendarDaySaveInput {
  confirmed: number | null;
  date: string;
  buildings: {
    building: 1 | 2;
    event: CalendarEvent | null;
    memo: string | null;
    // null means unchanged; supplied values are compared with this save's automatic values.
    facilities: Omit<FacilityDay, 'date' | 'revision'>[];
  }[];
}
export interface CalendarDaysSaveInput {
  days: Omit<CalendarDaySaveInput, 'confirmed'>[];
  confirmed: number | null;
}
export interface SavePreviewDay {
  date: string;
  closed: FacilityDay['facility'][];
  opened: FacilityDay['facility'][];
  remove: string[];
  add: string[];
  paid_leave: string[];
}
export interface SavePreviewResponse extends ResponseMetadata {
  dataChangeNumber: number;
  days: SavePreviewDay[];
  openingConflicts: OpeningConflict[];
}
export interface OpeningConflict {
  date: string;
  facility: FacilityDay['facility'];
  field: 'start_time' | 'end_time';
  time: string;
}
export interface ContactNames {
  first: string;
  second: string;
}
export interface FirstLoadResponse extends ResponseMetadata {
  identity: Identity;
  dataChangeNumber: number;
  contactNames: ContactNames;
  staffOrderRevision: number;
  contactNameRevisions: Record<keyof ContactNames, number>;
  staff: Staff[];
  periods: PeriodSummary[];
  annualRules: AnnualRules;
  annualRuleRevisions?: Revision[];
  notifications: (
    { kind: 'backup_failure'; code: ErrorCode } | { kind: 'schedule_stalled'; code: 'E-94' }
  )[];
}

export interface DailyRequest {
  staff_id: string;
  date: string;
  kind: 'unavailable' | 'am_unavailable' | 'pm_unavailable' | 'time_unavailable' | 'available';
  start_time: string | null;
  end_time: string | null;
  memo: string | null;
  revision: number;
}
export interface ReplacedShift {
  status: DayState['status'];
  roles: DayState['roles'];
  special_care: boolean;
  buildings: Pick<WorkSlot, 'building' | 'slots'>[];
}
export interface PeriodDailyRequest extends DailyRequest {
  replaced_shift: ReplacedShift | null;
}
export interface NoRequest {
  staff_id: string;
  period_id: string;
  pressed_at: string;
  revision: number;
}
export interface RequestSheetDailyRequest extends Omit<DailyRequest, 'memo'> {
  has_memo: boolean;
}
export type RequestDaySaveInput = Omit<DailyRequest, 'revision' | 'memo'> & {
  memo?: string | null;
};
export interface RequestSheetStaff {
  id: string;
  name: string;
  employment_type: StaffHistory['employment_type'];
}
export interface RequestSheetPeriod {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  request_deadline_date: string;
}
export interface RequestChangeNumberResponse {
  requestChangeNumber: number;
  requestsClosed: boolean;
}
export interface RequestRequestsResponse extends RequestChangeNumberResponse {
  dailyRequests: RequestSheetDailyRequest[];
  noRequests: NoRequest[];
}
export interface RequestSheetResponse extends ResponseMetadata, RequestRequestsResponse {
  period: RequestSheetPeriod;
  staff: RequestSheetStaff[];
  closedDates: string[];
  events: { date: string; building: 1 | 2; name: string }[];
}
