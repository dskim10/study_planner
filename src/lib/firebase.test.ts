import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Auth } from 'firebase/auth';
import { Timestamp } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { createDemoState, createEmptyState } from './planner';

const sdk = vi.hoisted(() => ({
  auth: { currentUser: { uid: 'alpha', displayName: '학생', email: 'student@example.test', photoURL: null } as { uid: string; displayName: string | null; email: string | null; photoURL: string | null } | null, languageCode: null as string | null },
  getApps: vi.fn(() => []),
  initializeApp: vi.fn(() => ({})),
  initializeAuth: vi.fn(),
  connectAuthEmulator: vi.fn(),
  connectFirestoreEmulator: vi.fn(),
  onAuthStateChanged: vi.fn(),
  signInWithPopup: vi.fn(),
  signOut: vi.fn(),
  getDocFromServer: vi.fn(),
  runTransaction: vi.fn(),
  transactionGet: vi.fn(),
  transactionSet: vi.fn(),
}));

vi.mock('firebase/app', () => ({ getApps: sdk.getApps, initializeApp: sdk.initializeApp }));
vi.mock('firebase/auth', async () => {
  const actual = await vi.importActual<typeof import('firebase/auth')>('firebase/auth');
  return {
    ...actual,
    getAuth: () => sdk.auth,
    initializeAuth: sdk.initializeAuth,
    connectAuthEmulator: sdk.connectAuthEmulator,
    onAuthStateChanged: sdk.onAuthStateChanged,
    signInWithPopup: sdk.signInWithPopup,
    signOut: sdk.signOut,
  };
});
vi.mock('firebase/firestore', async () => {
  const actual = await vi.importActual<typeof import('firebase/firestore')>('firebase/firestore');
  return {
    ...actual,
    getFirestore: () => ({}), initializeFirestore: () => ({}), memoryLocalCache: () => ({}),
    connectFirestoreEmulator: sdk.connectFirestoreEmulator,
    doc: (_db: unknown, ...parts: string[]) => parts.join('/'),
    getDocFromServer: sdk.getDocFromServer,
    runTransaction: sdk.runTransaction,
    serverTimestamp: () => 'SERVER_TIMESTAMP',
  };
});

const snapshot = (data?: unknown) => ({ exists: () => data !== undefined, data: () => data });
const envelope = (revision = 1) => ({ ownerId: 'alpha', revision, data: createEmptyState(), updatedAt: Timestamp.fromMillis(1) });
async function backend() {
  return (await import('./firebase')).createFirebaseBackend(sdk.auth as unknown as Auth, {} as Firestore);
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv('DEV', true);
  for (const key of ['API_KEY', 'AUTH_DOMAIN', 'PROJECT_ID', 'APP_ID', 'STORAGE_BUCKET', 'MESSAGING_SENDER_ID', 'USE_EMULATORS']) {
    vi.stubEnv(`VITE_FIREBASE_${key}`, '');
  }
  sdk.auth.currentUser = { uid: 'alpha', displayName: '학생', email: 'student@example.test', photoURL: null };
  sdk.initializeAuth.mockReturnValue(sdk.auth);
  sdk.getDocFromServer.mockResolvedValue(snapshot());
  sdk.transactionGet.mockResolvedValue(snapshot());
  sdk.runTransaction.mockImplementation(async (_db, callback) => callback({ get: sdk.transactionGet, set: sdk.transactionSet }));
});
afterEach(() => vi.unstubAllEnvs());

describe('Firebase connection setup', () => {
  it('leaves guest mode available without contacting Firebase when settings are missing', async () => {
    const connection = (await import('./firebase')).getFirebaseConnection();
    expect(connection.backend).toBeNull();
    expect(connection.configurationError).toContain('.env.local');
    expect(sdk.initializeApp).not.toHaveBeenCalled();
  });

  it('initializes production configuration once and uses local auth persistence', async () => {
    vi.stubEnv('VITE_FIREBASE_API_KEY', 'public-web-key');
    vi.stubEnv('VITE_FIREBASE_AUTH_DOMAIN', 'rocky-test.firebaseapp.com');
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'rocky-test');
    vi.stubEnv('VITE_FIREBASE_APP_ID', 'web-app-id');
    const { getFirebaseConnection } = await import('./firebase');
    const first = getFirebaseConnection();
    expect(first.backend).not.toBeNull();
    expect(first.emulator).toBe(false);
    expect(getFirebaseConnection()).toBe(first);
    expect(sdk.initializeApp).toHaveBeenCalledOnce();
    expect(sdk.initializeAuth.mock.calls[0][1]).toHaveProperty('persistence');
    expect(sdk.auth.languageCode).toBe('ko');
    expect(sdk.connectAuthEmulator).not.toHaveBeenCalled();
  });

  it('allows explicit demo-rocky emulators in development only', async () => {
    vi.stubEnv('VITE_FIREBASE_USE_EMULATORS', 'true');
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'demo-rocky');
    const connection = (await import('./firebase')).getFirebaseConnection();
    expect(connection.backend).not.toBeNull();
    expect(connection.emulator).toBe(true);
    expect(sdk.connectAuthEmulator).toHaveBeenCalledWith(sdk.auth, 'http://127.0.0.1:9099');
    expect(sdk.connectFirestoreEmulator).toHaveBeenCalledWith({}, '127.0.0.1', 8080);
  });

  it.each([
    [false, 'demo-rocky', 'true'], [true, 'real-project', 'true'], [true, 'demo-rocky', 'false'],
  ])('rejects unsafe emulator settings (DEV=%s, project=%s, enabled=%s)', async (dev, project, enabled) => {
    vi.stubEnv('DEV', dev);
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', project);
    vi.stubEnv('VITE_FIREBASE_USE_EMULATORS', enabled);
    const connection = (await import('./firebase')).getFirebaseConnection();
    expect(connection.backend).toBeNull();
    expect(connection.configurationError).not.toBe('');
    expect(sdk.initializeApp).not.toHaveBeenCalled();
  });
});

describe('Firebase planner adapter', () => {
  it('loads only the signed-in user document from the server', async () => {
    const saved = envelope(4);
    sdk.getDocFromServer.mockResolvedValue(snapshot(saved));
    expect(await (await backend()).load('alpha')).toEqual({ data: saved.data, revision: 4 });
    expect(sdk.getDocFromServer).toHaveBeenCalledWith('users/alpha/planner/main');
  });

  it('distinguishes a missing document from an unavailable server', async () => {
    const service = await backend();
    expect(await service.load('alpha')).toBeNull();
    sdk.getDocFromServer.mockRejectedValue({ code: 'unavailable' });
    await expect(service.load('alpha')).rejects.toMatchObject({ code: 'unavailable' });
  });

  it.each([
    { ownerId: 'another-user' }, { revision: 0 }, { revision: 1.5 },
    { updatedAt: 'yesterday' }, { data: { version: 99 } }, { unexpected: true },
  ])('refuses a corrupt remote envelope: %j', async change => {
    sdk.getDocFromServer.mockResolvedValue(snapshot({ ...envelope(), ...change }));
    await expect((await backend()).load('alpha')).rejects.toMatchObject({ code: 'cloud/invalid-data' });
  });

  it('denies another user and rejects data returned after an account switch', async () => {
    const service = await backend();
    await expect(service.load('beta')).rejects.toMatchObject({ code: 'permission-denied' });
    expect(sdk.getDocFromServer).not.toHaveBeenCalled();
    sdk.getDocFromServer.mockImplementation(async () => {
      sdk.auth.currentUser = null;
      return snapshot(envelope());
    });
    await expect(service.load('alpha')).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('creates revision 1 atomically, stripping undefined optional fields', async () => {
    const data = createDemoState('2026-10-05');
    data.events[0].repeatUntil = undefined;
    const saved = await (await backend()).save('alpha', data, 0);
    expect(saved.revision).toBe(1);
    expect(saved.data.events[0]).not.toHaveProperty('repeatUntil');
    expect(sdk.transactionSet).toHaveBeenCalledWith('users/alpha/planner/main', {
      ownerId: 'alpha', revision: 1, data: saved.data, updatedAt: 'SERVER_TIMESTAMP',
    });
  });

  it('increments the server revision only after it matches the expected revision', async () => {
    sdk.transactionGet.mockResolvedValue(snapshot(envelope(7)));
    expect((await (await backend()).save('alpha', createEmptyState(), 7)).revision).toBe(8);
  });

  it.each([[0, 3], [2, 3], [2, 0]])('does not overwrite a conflicting revision (expected %s, actual %s)', async (expected, actual) => {
    sdk.transactionGet.mockResolvedValue(snapshot(actual ? envelope(actual) : undefined));
    await expect((await backend()).save('alpha', createEmptyState(), expected)).rejects.toMatchObject({ code: 'cloud/conflict' });
    expect(sdk.transactionSet).not.toHaveBeenCalled();
  });

  it('does not overwrite a corrupt document even if its revision matches', async () => {
    sdk.transactionGet.mockResolvedValue(snapshot({ ...envelope(2), data: null }));
    await expect((await backend()).save('alpha', createEmptyState(), 2)).rejects.toMatchObject({ code: 'cloud/invalid-data' });
    expect(sdk.transactionSet).not.toHaveBeenCalled();
  });

  it('refuses writes if the account changes while a transaction reads', async () => {
    sdk.transactionGet.mockImplementation(async () => {
      sdk.auth.currentUser = null;
      return snapshot();
    });
    await expect((await backend()).save('alpha', createEmptyState(), 0)).rejects.toMatchObject({ code: 'permission-denied' });
    expect(sdk.transactionSet).not.toHaveBeenCalled();
  });

  it('validates input and size before starting a transaction', async () => {
    const service = await backend();
    await expect(service.save('alpha', { ...createDemoState('2026-10-05'), categories: [] }, 0)).rejects.toMatchObject({ code: 'cloud/invalid-data' });
    await expect(service.save('alpha', createEmptyState(), -1)).rejects.toMatchObject({ code: 'cloud/invalid-data' });
    const large = createEmptyState();
    large.events = Array.from({ length: 5000 }, (_, index) => ({
      id: `event-${index}`, title: '공부'.repeat(40), type: 'school', date: '2026-10-05',
      startTime: '09:00', endTime: '10:00', allDay: false, recurrence: 'none', weekdays: [],
    }));
    await expect(service.save('alpha', large, 0)).rejects.toMatchObject({ code: 'cloud/too-large' });
    expect(sdk.runTransaction).not.toHaveBeenCalled();
  });

  it('signs out without deleting or changing stored data', async () => {
    await (await backend()).logout();
    expect(sdk.signOut).toHaveBeenCalledWith(sdk.auth);
    expect(sdk.runTransaction).not.toHaveBeenCalled();
    expect(sdk.transactionSet).not.toHaveBeenCalled();
  });
});
