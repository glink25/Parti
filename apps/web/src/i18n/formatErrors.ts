import type { IntlShape } from 'react-intl';
import { ImportRoomError } from '@/lib/importRoom';
import { MarketError } from '@/lib/market';
import type { FetchPackageError } from '@/lib/fetchPackageOverPeer';
import type { LobbyStatusKey } from '@/lib/lobbyApi';
import type { UserNameValidationError } from '@/lib/localUser';
import { PackageSourceNotFoundError } from '@/lib/rooms';
import { RoomSnapshotNotFoundError } from '@/lib/customRooms';

export function formatLobbyStatus(intl: IntlShape, status: LobbyStatusKey): string {
  return intl.formatMessage({ id: `lobby.status.${status}` });
}

export function formatImportError(intl: IntlShape, error: ImportRoomError): string {
  const { code, path } = error;
  if (code === 'UI_ENTRY_MISSING' || code === 'WORKER_ENTRY_MISSING') {
    return intl.formatMessage({ id: `import.error.${code}` }, { path: path ?? '' });
  }
  if (code === 'GITHUB_DIR_READ_FAILED' || code === 'DOWNLOAD_FAILED') {
    return intl.formatMessage({ id: `import.error.${code}` }, { status: error.status ?? '', path: path ?? '' });
  }
  return intl.formatMessage({ id: `import.error.${code}` });
}

export function formatFetchPackageError(intl: IntlShape, error: FetchPackageError): string {
  return intl.formatMessage({ id: `peer.fetchPackage.${error.code}` });
}

export function formatUserNameError(intl: IntlShape, error: UserNameValidationError): string {
  if (error.code === 'tooLong') {
    return intl.formatMessage({ id: 'user.validation.tooLong' }, { max: error.maxLength });
  }
  return intl.formatMessage({ id: 'user.validation.empty' });
}

export function formatTemplateFallback(intl: IntlShape, key: 'customRoom' | 'importedTemplate'): string {
  return intl.formatMessage({ id: `template.fallback.${key}` });
}

export function formatRoomError(intl: IntlShape, message: string): string {
  if (/peer|connect|network|socket/i.test(message)) {
    return intl.formatMessage({ id: 'peer.error.connectionFailed' });
  }
  return message;
}

export function formatResolveError(intl: IntlShape, reason: unknown): string {
  if (reason instanceof PackageSourceNotFoundError) {
    return intl.formatMessage({ id: 'rooms.unknown' }, { id: reason.sourceId });
  }
  if (reason instanceof RoomSnapshotNotFoundError) {
    return intl.formatMessage({ id: 'rooms.unknown' }, { id: reason.roomId });
  }
  if (reason instanceof ImportRoomError) return formatImportError(intl, reason);
  if (reason instanceof MarketError) {
    return intl.formatMessage(
      { id: `market.error.${reason.code}` },
      { status: reason.status ?? '', path: reason.path ?? '' },
    );
  }
  return reason instanceof Error ? reason.message : String(reason);
}

export function templateDescription(
  intl: IntlShape,
  template: { description: string; descriptionFallback?: 'importedTemplate' | 'customRoom' },
): string {
  if (template.description) return template.description;
  if (template.descriptionFallback) {
    return formatTemplateFallback(intl, template.descriptionFallback);
  }
  return '';
}
