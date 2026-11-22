import { fiscalYearEnd, fiscalYearStart } from '../../../shared/calendar';
import type {
  BuildingDay,
  CalendarRows,
  FacilityDay,
  ResponseMetadata,
  YearLoadResponse,
} from '../../../shared/protocol';

export function readCalendarRows(sql: SqlStorage, start: string, end = start): CalendarRows {
  type StoredFacilityDay = Omit<FacilityDay, 'is_open'> & { is_open: number | null };
  type StoredBuildingDay = Omit<BuildingDay, 'entries'> & { entries: string };
  return {
    facilityDays: sql
      .exec<StoredFacilityDay>(
        'SELECT * FROM facility_days WHERE date BETWEEN ? AND ? ORDER BY date, facility',
        start,
        end,
      )
      .toArray()
      .map((row) => ({ ...row, is_open: row.is_open === null ? null : row.is_open === 1 })),
    buildingDays: sql
      .exec<StoredBuildingDay>(
        'SELECT * FROM building_days WHERE date BETWEEN ? AND ? ORDER BY date, building',
        start,
        end,
      )
      .toArray()
      .map((row) => ({ ...row, entries: JSON.parse(row.entries) as BuildingDay['entries'] })),
  };
}

export function readYearLoad(
  storage: DurableObjectStorage,
  year: number,
  metadata: ResponseMetadata,
): YearLoadResponse {
  return {
    ...metadata,
    ...readCalendarRows(storage.sql, fiscalYearStart(year), fiscalYearEnd(year)),
  };
}
