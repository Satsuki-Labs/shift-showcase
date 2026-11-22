import { AppError } from '../../../shared/app-error';
import { MAX_STAFF_NAME_LENGTH } from '../../../shared/limits';
import type { ContactNames } from '../../../shared/protocol';
import { readContactNames } from '../reads/first-load';
import type { SaveOperation } from './operations';

export function parseContactNames(value: unknown): Partial<ContactNames> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new AppError('E-32', 'contactNames');
  const entries = Object.entries(value);
  if (!entries.length || entries.some(([site]) => site !== 'first' && site !== 'second'))
    throw new AppError('E-32', 'contactNames');
  return Object.fromEntries(
    entries.map(([site, name]) => {
      if (typeof name !== 'string' || name.trim().length > MAX_STAFF_NAME_LENGTH)
        throw new AppError('E-32', site);
      return [site, name.trim()];
    }),
  );
}
export const settingsOperations: Record<string, SaveOperation> = {
  'settings.contact-names.save': {
    validate(value) {
      parseContactNames(value);
    },
    targets: (value) =>
      Object.keys(parseContactNames(value)).map((site) => ({
        unit: 'contact-name',
        site: site as keyof ContactNames,
      })),
    write({ sql }, value) {
      const changes = parseContactNames(value);
      for (const [site, name] of Object.entries(changes))
        sql.exec('UPDATE contact_names SET name = ? WHERE site = ?', name, site);
      return { ...readContactNames(sql) };
    },
  },
};
