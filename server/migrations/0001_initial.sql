CREATE TABLE staff (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL,
  default_first_facility TEXT CHECK (default_first_facility IN ('A', 'B')),
  default_second_facility TEXT CHECK (default_second_facility IN ('C', 'D')),
  default_work_times TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(default_work_times) AND json_type(default_work_times) = 'object'),
  default_roles TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(default_roles) AND json_type(default_roles) = 'array'),
  employment_status TEXT NOT NULL CHECK (employment_status IN ('active', 'leave', 'retired')),
  leave_start_date TEXT,
  leave_expected_end_date TEXT,
  retirement_date TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1)
) STRICT;

CREATE TABLE periods (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL CHECK (end_date >= start_date),
  request_deadline_date TEXT,
  request_url_key TEXT NOT NULL UNIQUE,
  first_published_at TEXT,
  second_published_at TEXT,
  first_last_distributed_at TEXT,
  second_last_distributed_at TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1)
, requests_closed_at TEXT, request_change_number INTEGER NOT NULL DEFAULT 0) STRICT;

CREATE TABLE coverage_requirements (
  period_id TEXT NOT NULL REFERENCES periods(id),
  facility TEXT NOT NULL CHECK (facility IN ('A', 'B', 'C', 'D')),
  total_required INTEGER NOT NULL CHECK (total_required >= 0),
  PRIMARY KEY (period_id, facility)
) STRICT;

CREATE TABLE building_days (
  building INTEGER NOT NULL CHECK (building IN (1, 2)),
  date TEXT NOT NULL,
  entries TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(entries) AND json_type(entries) = 'array'),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  PRIMARY KEY (date, building)
) STRICT;

CREATE TABLE opening_rules (
  fiscal_year INTEGER NOT NULL,
  facility TEXT NOT NULL CHECK (facility IN ('A', 'B', 'C', 'D')),
  normal_start_time TEXT NOT NULL,
  normal_end_time TEXT NOT NULL,
  peak_start_time TEXT NOT NULL,
  peak_end_time TEXT NOT NULL,
  saturday_start_time TEXT NOT NULL,
  saturday_end_time TEXT NOT NULL,
  arrival_end_mode TEXT NOT NULL CHECK (arrival_end_mode IN ('fixed_time', 'duration')),
  arrival_end_time TEXT,
  arrival_duration_minutes INTEGER,
  CHECK (
    (arrival_end_mode = 'fixed_time' AND arrival_end_time IS NOT NULL AND arrival_duration_minutes IS NULL)
    OR (arrival_end_mode = 'duration' AND arrival_end_time IS NULL AND arrival_duration_minutes > 0 AND arrival_duration_minutes IS NOT NULL)
  ),
  PRIMARY KEY (fiscal_year, facility)
) STRICT;

CREATE TABLE peaks (
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL CHECK (end_date >= start_date),
  name TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (start_date, end_date)
) STRICT;

CREATE TABLE annual_closures (
  start_month INTEGER NOT NULL CHECK (start_month BETWEEN 1 AND 12),
  start_day INTEGER NOT NULL CHECK (start_day BETWEEN 1 AND 31),
  end_month INTEGER NOT NULL CHECK (end_month BETWEEN 1 AND 12),
  end_day INTEGER NOT NULL CHECK (end_day BETWEEN 1 AND 31),
  name TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (start_month, start_day, end_month, end_day)
) STRICT;

CREATE TABLE work_slots (
  staff_id TEXT NOT NULL REFERENCES staff(id),
  date TEXT NOT NULL,
  building INTEGER NOT NULL CHECK (building IN (1, 2)),
  first_start_time TEXT NOT NULL,
  first_end_time TEXT NOT NULL,
  first_facility TEXT NOT NULL,
  second_start_time TEXT,
  second_end_time TEXT,
  second_facility TEXT,
  first_is_office INTEGER NOT NULL DEFAULT 0 CHECK (first_is_office IN (0, 1)),
  second_is_office INTEGER NOT NULL DEFAULT 0 CHECK (second_is_office IN (0, 1)
    AND (second_start_time IS NOT NULL OR second_is_office = 0)),
  last_changed_by TEXT NOT NULL,
  last_changed_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  CHECK ((building = 1 AND first_facility IN ('A', 'B')) OR (building = 2 AND first_facility IN ('C', 'D'))),
  CHECK (
    (second_start_time IS NULL AND second_end_time IS NULL AND second_facility IS NULL)
    OR (second_start_time IS NOT NULL AND second_end_time IS NOT NULL AND second_facility IS NOT NULL
      AND ((building = 1 AND second_facility IN ('A', 'B')) OR (building = 2 AND second_facility IN ('C', 'D'))))
  ),
  PRIMARY KEY (staff_id, date, building)
) STRICT;

CREATE INDEX work_slots_date ON work_slots(date);

CREATE TABLE daily_requests (
  staff_id TEXT NOT NULL REFERENCES staff(id),
  date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('unavailable', 'am_unavailable', 'pm_unavailable', 'time_unavailable', 'available')),
  start_time TEXT,
  end_time TEXT,
  memo TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1), replaced_shift TEXT,
  PRIMARY KEY (staff_id, date)
) STRICT;

CREATE TABLE no_requests (
  staff_id TEXT NOT NULL REFERENCES staff(id),
  period_id TEXT NOT NULL REFERENCES periods(id),
  pressed_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  PRIMARY KEY (staff_id, period_id)
) STRICT;

CREATE TABLE operation_receipts (
  operation_id TEXT PRIMARY KEY NOT NULL,
  content_summary TEXT NOT NULL,
  result TEXT NOT NULL CHECK (json_valid(result)),
  received_at TEXT NOT NULL
) STRICT;

CREATE TABLE fatal_errors (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL,
  reason TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  account TEXT,
  operation TEXT
) STRICT;

CREATE TABLE backup_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_success_at TEXT,
  data_change_number INTEGER NOT NULL CHECK (data_change_number >= 0)
, failed_nights INTEGER NOT NULL DEFAULT 0 CHECK (failed_nights >= 0), sent_change_number INTEGER NOT NULL DEFAULT 0 CHECK (sent_change_number >= 0), last_failure_code TEXT) STRICT;

CREATE TABLE data_version (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
  generation TEXT NOT NULL
, restored_to TEXT, finished_restore_ids TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(finished_restore_ids) AND json_type(finished_restore_ids) = 'array'), pending_restore_ids TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(pending_restore_ids) AND json_type(pending_restore_ids) = 'array')) STRICT;

CREATE TABLE scheduled_tasks (
  task TEXT PRIMARY KEY NOT NULL,
  scheduled_at TEXT NOT NULL
) STRICT;

CREATE TABLE "day_states" (
  staff_id TEXT NOT NULL REFERENCES staff(id),
  date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('none', 'paid_leave', 'empty')),
  roles TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(roles) AND json_type(roles) = 'array'),
  special_care INTEGER NOT NULL DEFAULT 0 CHECK (special_care IN (0, 1)),
  last_changed_by TEXT NOT NULL,
  last_changed_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  PRIMARY KEY (staff_id, date)
) STRICT;

CREATE INDEX day_states_date ON day_states(date);

CREATE INDEX day_states_status_date ON day_states(status, date);

CREATE TABLE period_snapshots (
  period_id TEXT PRIMARY KEY NOT NULL REFERENCES periods(id) ON DELETE CASCADE,
  staff TEXT NOT NULL CHECK (json_valid(staff) AND json_type(staff) = 'array'),
  annual_closures TEXT NOT NULL CHECK (json_valid(annual_closures) AND json_type(annual_closures) = 'array'),
  captured_at TEXT NOT NULL
) STRICT;

CREATE INDEX daily_requests_date ON daily_requests(date);

CREATE TABLE "staff_history" (
  staff_id TEXT NOT NULL REFERENCES staff(id),
  since TEXT NOT NULL,
  quarter_hour_pay REAL NOT NULL CHECK (quarter_hour_pay >= 0),
  employment_type TEXT NOT NULL CHECK (employment_type IN ('full_time', 'part_time', 'casual')),
  qualification TEXT NOT NULL CHECK (qualification IN ('certified', 'assistant', 'none')),
  budget REAL NOT NULL CHECK (budget >= 0),
  PRIMARY KEY (staff_id, since)
) STRICT;

CREATE INDEX no_requests_period ON no_requests(period_id);

CREATE TABLE distributed_sheets (
  period_id TEXT NOT NULL REFERENCES periods(id) ON DELETE CASCADE,
  site TEXT NOT NULL CHECK (site IN ('first', 'second')),
  distributed_at TEXT NOT NULL,
  cells TEXT NOT NULL CHECK (json_valid(cells)),
  PRIMARY KEY (period_id, site)
) STRICT;

CREATE TABLE mail_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  fatal_error_mailed_id INTEGER NOT NULL CHECK (fatal_error_mailed_id >= 0),
  backup_failure_mailed_on TEXT,
  annual_task_mailed_on TEXT,
  stall_mailed_on TEXT
) STRICT;

CREATE TABLE "facility_days" (
  facility TEXT NOT NULL CHECK (facility IN ('A', 'B', 'C', 'D')),
  date TEXT NOT NULL,
  is_open INTEGER CHECK (is_open IN (0, 1)),
  start_time TEXT,
  end_time TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  PRIMARY KEY (date, facility)
) STRICT;

CREATE TABLE contact_names (
  site TEXT PRIMARY KEY CHECK (site IN ('first', 'second')),
  name TEXT NOT NULL
) STRICT;

INSERT INTO "annual_closures" ("start_month", "start_day", "end_month", "end_day", "name") VALUES (5, 3, 5, 5, 'GW');

INSERT INTO "annual_closures" ("start_month", "start_day", "end_month", "end_day", "name") VALUES (8, 13, 8, 15, 'お盆');

INSERT INTO "annual_closures" ("start_month", "start_day", "end_month", "end_day", "name") VALUES (12, 29, 1, 3, '年末年始');

INSERT INTO "backup_state" ("id", "last_success_at", "data_change_number", "failed_nights", "sent_change_number", "last_failure_code") VALUES (1, NULL, 0, 0, 0, NULL);

INSERT INTO "contact_names" ("site", "name") VALUES ('first', '');

INSERT INTO "contact_names" ("site", "name") VALUES ('second', '');

INSERT INTO "mail_state" ("id", "fatal_error_mailed_id", "backup_failure_mailed_on", "annual_task_mailed_on", "stall_mailed_on") VALUES (1, 0, NULL, NULL, NULL);

INSERT INTO "opening_rules" ("fiscal_year", "facility", "normal_start_time", "normal_end_time", "peak_start_time", "peak_end_time", "saturday_start_time", "saturday_end_time", "arrival_end_mode", "arrival_end_time", "arrival_duration_minutes") VALUES (2025, 'A', '09:00', '18:00', '08:00', '20:00', '09:00', '17:00', 'fixed_time', '18:00', NULL);

INSERT INTO "opening_rules" ("fiscal_year", "facility", "normal_start_time", "normal_end_time", "peak_start_time", "peak_end_time", "saturday_start_time", "saturday_end_time", "arrival_end_mode", "arrival_end_time", "arrival_duration_minutes") VALUES (2025, 'B', '10:00', '19:00', '08:00', '20:00', '09:00', '17:00', 'duration', NULL, 240);

INSERT INTO "opening_rules" ("fiscal_year", "facility", "normal_start_time", "normal_end_time", "peak_start_time", "peak_end_time", "saturday_start_time", "saturday_end_time", "arrival_end_mode", "arrival_end_time", "arrival_duration_minutes") VALUES (2025, 'C', '09:00', '18:00', '08:00', '20:00', '09:00', '17:00', 'fixed_time', '18:00', NULL);

INSERT INTO "opening_rules" ("fiscal_year", "facility", "normal_start_time", "normal_end_time", "peak_start_time", "peak_end_time", "saturday_start_time", "saturday_end_time", "arrival_end_mode", "arrival_end_time", "arrival_duration_minutes") VALUES (2025, 'D', '10:00', '19:00', '08:00', '20:00', '09:00', '17:00', 'duration', NULL, 240);
