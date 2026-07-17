import type { PackageSourceInfo } from './db';

export function isImportedTemplateSource(source: PackageSourceInfo): boolean {
  return source.type === 'zip'
    || source.type === 'github'
    || (source.type === 'editor' && source.basedOn === undefined);
}
