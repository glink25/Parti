const KNOWN_DATABASES = ['parti', 'parti-replays'] as const;

function deleteIndexedDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error(`Failed to delete IndexedDB: ${name}`));
    request.onblocked = () => resolve();
  });
}

async function deleteAllIndexedDatabases(): Promise<void> {
  if (typeof indexedDB.databases === 'function') {
    const databases = await indexedDB.databases();
    const names = databases.map((db) => db.name).filter((name): name is string => Boolean(name));
    await Promise.all(names.map((name) => deleteIndexedDatabase(name)));
    return;
  }
  await Promise.all(KNOWN_DATABASES.map((name) => deleteIndexedDatabase(name)));
}

export async function clearAllBrowserStorage(): Promise<void> {
  try {
    localStorage.clear();
  } catch {
    // ignore
  }
  try {
    sessionStorage.clear();
  } catch {
    // ignore
  }
  await deleteAllIndexedDatabases();
  if ('caches' in globalThis) {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith('parti-package-')).map((name) => caches.delete(name)));
  }
}
