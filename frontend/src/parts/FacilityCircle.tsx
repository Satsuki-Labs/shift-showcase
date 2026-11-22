import { staffAssignments } from '../../../shared/staff';
import './FacilityCircle.css';
import type { Staff } from '../../../shared/protocol';

export function FacilityCircle({ facility, building }: { facility: string; building: 1 | 2 }) {
  return (
    <span className={`fac c${building}`} data-fac={facility}>
      <span>{facility}</span>
    </span>
  );
}

function nameFacilities(staff: Pick<Staff, 'default_first_facility' | 'default_second_facility'>) {
  const facilities: { facility: string; building: 1 | 2 }[] = [];
  const buildings = [1, 2] as const;
  for (const building of buildings) {
    const facility = building === 1 ? staff.default_first_facility : staff.default_second_facility;
    if (staffAssignments(staff)[building === 1 ? 'first' : 'second'])
      facilities.push({ facility: facility!, building });
  }
  return facilities;
}

export function FacilityCircles({
  staff,
}: {
  staff: Pick<Staff, 'default_first_facility' | 'default_second_facility'>;
}) {
  return (
    <span className="facility-circles">
      {nameFacilities(staff).map(({ facility, building }) => (
        <span key={building}>
          <FacilityCircle facility={facility} building={building} />
        </span>
      ))}
    </span>
  );
}
