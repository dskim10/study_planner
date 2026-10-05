import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { getFirebaseConnection } from '../lib/firebase';
import { PlannerStore } from '../lib/planner-store';

// Accessing localStorage itself can throw when browser persistence is disabled.
function browserStorage(): Storage {
  try { return window.localStorage; }
  catch {
    const unavailable = () => { throw new Error('Browser storage is unavailable'); };
    return { get length() { return 0; }, clear: unavailable, getItem: unavailable, key: unavailable, removeItem: unavailable, setItem: unavailable };
  }
}

export function usePlanner() {
  const connection = useMemo(() => getFirebaseConnection(), []);
  const store = useMemo(() => new PlannerStore({ backend: connection.backend, storage: browserStorage() }), [connection]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useEffect(() => store.start(), [store]);
  useEffect(() => {
    const online = () => { void store.retry(); };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (store.getSnapshot().dirty) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('online', online);
    window.addEventListener('beforeunload', beforeUnload);
    return () => { window.removeEventListener('online', online); window.removeEventListener('beforeunload', beforeUnload); };
  }, [store]);
  return {
    ...snapshot,
    configured: !!connection.backend,
    configurationError: connection.configurationError,
    emulator: connection.emulator,
    setData: store.setData,
    resetData: store.resetData,
    login: store.login,
    logout: store.logout,
    retry: store.retry,
    importGuest: store.importGuest,
    useCloudVersion: store.useCloudVersion,
  };
}
