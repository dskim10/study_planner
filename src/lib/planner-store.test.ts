import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlannerState } from '../types';
import type { PlannerAccount, PlannerBackend, RemotePlanner } from './cloud';
import { CloudError } from './cloud';
import { createDemoState, createEmptyState } from './planner';
import { ACCOUNT_STORAGE_PREFIX, PlannerStore } from './planner-store';
import { STORAGE_KEY } from './storage';

class MemoryStorage implements Storage {
  values = new Map<string, string>();
  failWrites = false;
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { if (this.failWrites) throw new Error('Quota exceeded'); this.values.set(key, value); }
}
const account = (uid: string): PlannerAccount => ({ uid, displayName: uid, email: `${uid}@example.test`, photoURL: null });
function plan(title: string): PlannerState {
  return { ...createEmptyState(), events: [{ id: 'event', title, type: 'school', date: '2026-10-05', startTime: '09:00', endTime: '10:00', allDay: false, recurrence: 'none', weekdays: [] }] };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
class FakeBackend implements PlannerBackend {
  documents = new Map<string, RemotePlanner>();
  auth: ((account: PlannerAccount | null) => void) | null = null;
  observeAuth = vi.fn((next: (account: PlannerAccount | null) => void) => { this.auth = next; return () => { if (this.auth === next) this.auth = null; }; });
  emit(uid: string | null) { this.auth?.(uid === null ? null : account(uid)); }
  login = vi.fn(async () => {});
  logout = vi.fn(async () => { this.emit(null); });
  load = vi.fn(async (uid: string): Promise<RemotePlanner | null> => this.documents.get(uid) ?? null);
  save = vi.fn(async (uid: string, data: PlannerState, expectedRevision: number): Promise<RemotePlanner> => {
    if ((this.documents.get(uid)?.revision ?? 0) !== expectedRevision) throw new CloudError('cloud/conflict', 'Conflict');
    const remote = { data: structuredClone(data), revision: expectedRevision + 1 };
    this.documents.set(uid, remote);
    return remote;
  });
}
const cleanups: (() => void)[] = [];
function setup(storage = new MemoryStorage(), backend: FakeBackend | null = new FakeBackend()) {
  const store = new PlannerStore({ storage, backend, debounceMs: 60_000, now: () => new Date('2026-10-06T12:00:00') });
  cleanups.push(store.start());
  return { store, storage, backend: backend! };
}
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); });

describe('planner account persistence', () => {
  it('keeps guest plans compatible with the legacy key and persists edits immediately', () => {
    const { store, storage } = setup(new MemoryStorage(), null);
    expect(store.getSnapshot().data.isDemo).toBe(true);
    expect(store.setData(plan('guest edit'))).toBe(true);
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!).events[0].title).toBe('guest edit');
    expect(store.getSnapshot()).toMatchObject({ status: 'local', dirty: false, readOnly: false });
  });

  it('protects corrupt guest data until an explicit reset', () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEY, '{broken');
    const { store } = setup(storage, null);
    expect(store.getSnapshot()).toMatchObject({ storageBlocked: true, readOnly: true });
    expect(store.setData(plan('must not save'))).toBe(false);
    expect(storage.getItem(STORAGE_KEY)).toBe('{broken');
    expect(store.resetData(createEmptyState())).toBe(true);
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!)).toEqual(createEmptyState());
  });

  it('does not expose guest data while restoring auth and loads existing cloud data before writing', async () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify(plan('guest')));
    storage.setItem(ACCOUNT_STORAGE_PREFIX + 'a', JSON.stringify({ data: plan('old clean cache'), revision: 1, dirty: false }));
    const { store, backend } = setup(storage);
    backend.documents.set('a', { data: plan('cloud'), revision: 5 });
    expect(store.getSnapshot()).toMatchObject({ status: 'auth-loading', readOnly: true });
    expect(store.getSnapshot().data.events).toEqual([]);
    backend.emit('a');
    expect(store.getSnapshot()).toMatchObject({ status: 'loading', readOnly: true });
    expect(store.setData(plan('unsafe'))).toBe(false);
    await settle();
    expect(store.getSnapshot().data.events[0].title).toBe('cloud');
    expect(backend.save).not.toHaveBeenCalled();
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!).events[0].title).toBe('guest');
  });

  it('new accounts start empty and never automatically upload fictional examples', async () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify(createDemoState('2026-10-05')));
    const { store, backend } = setup(storage);
    backend.emit('a');
    await settle();
    expect(store.getSnapshot()).toMatchObject({ data: createEmptyState(), status: 'ready', canImportGuest: false });
    await store.importGuest();
    expect(backend.save).not.toHaveBeenCalled();
  });

  it('imports real guest data only into an empty account and preserves the guest copy', async () => {
    const storage = new MemoryStorage();
    const guest = plan('guest import');
    storage.setItem(STORAGE_KEY, JSON.stringify(guest));
    const { store, backend } = setup(storage);
    backend.emit('a');
    await settle();
    expect(store.getSnapshot().canImportGuest).toBe(true);
    await store.importGuest();
    expect(backend.documents.get('a')).toEqual({ data: guest, revision: 1 });
    expect(store.getSnapshot().canImportGuest).toBe(false);
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!)).toEqual(guest);
    backend.emit('b');
    backend.documents.set('b', { data: plan('existing'), revision: 1 });
    // A separate fresh authentication loads the existing document.
    backend.emit(null); backend.emit('b');
    await settle();
    await store.importGuest();
    expect(backend.documents.get('b')?.data.events[0].title).toBe('existing');
  });

  it('flushes edits on logout and restores them after login without leaking into the guest', async () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify(plan('guest')));
    const { store, backend } = setup(storage);
    backend.emit('a'); await settle();
    store.setData(plan('account edit'));
    expect(JSON.parse(storage.getItem(ACCOUNT_STORAGE_PREFIX + 'a')!).dirty).toBe(true);
    await store.logout();
    expect(store.getSnapshot()).toMatchObject({ account: null, status: 'local' });
    expect(store.getSnapshot().data.events[0].title).toBe('guest');
    expect(backend.documents.get('a')?.data.events[0].title).toBe('account edit');
    backend.emit('a'); await settle();
    expect(store.getSnapshot().data.events[0].title).toBe('account edit');
  });

  it('ignores a delayed load from another account and clears the previous account immediately', async () => {
    const { store, backend } = setup();
    const pending = deferred<RemotePlanner | null>();
    backend.load.mockImplementationOnce(() => pending.promise);
    backend.documents.set('b', { data: plan('B only'), revision: 2 });
    backend.emit('a');
    backend.emit('b');
    expect(store.getSnapshot().data.events).toEqual([]);
    await settle();
    pending.resolve({ data: plan('A private'), revision: 1 });
    await settle();
    expect(store.getSnapshot().account?.uid).toBe('b');
    expect(store.getSnapshot().data.events[0].title).toBe('B only');
  });

  it('does not apply an old save result to a new account or copy it into that account cache', async () => {
    const { store, backend, storage } = setup();
    backend.emit('a'); await settle();
    const pending = deferred<RemotePlanner>();
    backend.save.mockImplementationOnce(() => pending.promise);
    store.setData(plan('A private'));
    const saving = store.retry();
    backend.documents.set('b', { data: plan('B only'), revision: 7 });
    backend.emit('b'); await settle();
    pending.resolve({ data: plan('A private'), revision: 1 });
    await saving;
    expect(store.getSnapshot().data.events[0].title).toBe('B only');
    expect(JSON.parse(storage.getItem(ACCOUNT_STORAGE_PREFIX + 'b')!).data.events[0].title).toBe('B only');
  });

  it('serializes an edit made during saving without losing it or using the previous revision', async () => {
    const { store, backend } = setup();
    backend.emit('a'); await settle();
    const pending = deferred<RemotePlanner>();
    backend.save.mockImplementationOnce(() => pending.promise);
    store.setData(plan('first'));
    const saving = store.retry();
    store.setData(plan('second'));
    backend.documents.set('a', { data: plan('first'), revision: 1 });
    pending.resolve({ data: plan('first'), revision: 1 });
    await saving;
    expect(backend.save.mock.calls.map(call => call[2])).toEqual([0, 1]);
    expect(backend.documents.get('a')?.data.events[0].title).toBe('second');
    expect(store.getSnapshot()).toMatchObject({ dirty: false, status: 'ready' });
  });

  it('durably queues a failed save across logout and resumes only for the same account', async () => {
    const { store, backend, storage } = setup();
    backend.emit('a'); await settle();
    store.setData(plan('offline draft'));
    backend.save.mockRejectedValueOnce(new CloudError('unavailable', 'Offline'));
    await store.logout();
    expect(JSON.parse(storage.getItem(ACCOUNT_STORAGE_PREFIX + 'a')!)).toMatchObject({ dirty: true, revision: 0 });
    expect(store.getSnapshot().account).toBeNull();
    backend.emit('b'); await settle();
    expect(store.getSnapshot().data.events).toEqual([]);
    expect(backend.documents.has('b')).toBe(false);
    backend.emit('a'); await settle();
    expect(store.getSnapshot().data.events[0].title).toBe('offline draft');
    await store.retry();
    expect(backend.documents.get('a')?.data.events[0].title).toBe('offline draft');
    expect(store.getSnapshot().dirty).toBe(false);
  });

  it('keeps an offline initial load read-only when no trusted account cache exists', async () => {
    const { store, backend } = setup();
    backend.load.mockRejectedValueOnce(new CloudError('unavailable', 'Offline'));
    backend.emit('a'); await settle();
    expect(store.getSnapshot()).toMatchObject({ status: 'offline', readOnly: true });
    expect(store.setData(plan('unsafe new account'))).toBe(false);
    expect(backend.save).not.toHaveBeenCalled();
    await store.retry();
    expect(store.getSnapshot()).toMatchObject({ status: 'ready', readOnly: false });
  });

  it('allows cached offline edits but reloads and compares revisions before uploading', async () => {
    const storage = new MemoryStorage();
    storage.setItem(ACCOUNT_STORAGE_PREFIX + 'a', JSON.stringify({ data: plan('cached'), revision: 3, dirty: false }));
    const { store, backend } = setup(storage);
    backend.load.mockRejectedValueOnce(new CloudError('unavailable', 'Offline'));
    backend.emit('a'); await settle();
    expect(store.getSnapshot().readOnly).toBe(false);
    store.setData(plan('offline edit'));
    backend.documents.set('a', { data: plan('other device'), revision: 4 });
    await store.retry();
    expect(store.getSnapshot()).toMatchObject({ status: 'conflict', dirty: true, readOnly: true });
    expect(store.getSnapshot().data.events[0].title).toBe('offline edit');
    expect(backend.save).not.toHaveBeenCalled();
  });

  it('protects conflicting pending edits and backs them up before explicit cloud replacement', async () => {
    const storage = new MemoryStorage();
    storage.setItem(ACCOUNT_STORAGE_PREFIX + 'a', JSON.stringify({ data: plan('pending'), revision: 1, dirty: true }));
    const { store, backend } = setup(storage);
    backend.documents.set('a', { data: plan('new cloud'), revision: 2 });
    backend.emit('a'); await settle();
    expect(store.getSnapshot()).toMatchObject({ status: 'conflict', readOnly: true });
    expect(store.setData(plan('unsafe'))).toBe(false);
    expect(backend.save).not.toHaveBeenCalled();
    await store.useCloudVersion();
    expect(store.getSnapshot().data.events[0].title).toBe('new cloud');
    expect(store.getSnapshot().dirty).toBe(false);
    const backup = [...storage.values.keys()].find(key => key.startsWith(ACCOUNT_STORAGE_PREFIX + 'a:backup:'));
    expect(JSON.parse(storage.getItem(backup!)!).data.events[0].title).toBe('pending');
  });

  it('protects a corrupt account cache even after successfully reading the server', async () => {
    const storage = new MemoryStorage();
    storage.setItem(ACCOUNT_STORAGE_PREFIX + 'a', '{broken account');
    const { store, backend } = setup(storage);
    backend.documents.set('a', { data: plan('cloud safe'), revision: 1 });
    backend.emit('a'); await settle();
    expect(store.getSnapshot()).toMatchObject({ storageBlocked: true, readOnly: true });
    expect(storage.getItem(ACCOUNT_STORAGE_PREFIX + 'a')).toBe('{broken account');
    expect(backend.save).not.toHaveBeenCalled();
    await store.useCloudVersion();
    expect(store.getSnapshot()).toMatchObject({ storageBlocked: false, readOnly: false });
    const backup = [...storage.values.keys()].find(key => key.includes(':backup:'));
    expect(storage.getItem(backup!)).toBe('{broken account');
  });

  it('blocks logout when a pending edit cannot be saved locally or remotely', async () => {
    const { store, backend, storage } = setup();
    backend.emit('a'); await settle();
    storage.failWrites = true;
    store.setData(plan('only in memory'));
    backend.save.mockRejectedValueOnce(new CloudError('unavailable', 'Offline'));
    await store.logout();
    expect(backend.logout).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toMatchObject({ dirty: true, authBusy: false });
    expect(store.getSnapshot().account?.uid).toBe('a');
    expect(store.getSnapshot().data.events[0].title).toBe('only in memory');
    expect(store.getSnapshot().error).toContain('로그아웃을 멈췄어요');
  });

  it('starts and stops safely across StrictMode remounts, ignoring obsolete callbacks', async () => {
    const storage = new MemoryStorage();
    const backend = new FakeBackend();
    const store = new PlannerStore({ backend, storage });
    const stop = store.start();
    const oldAuth = backend.auth!;
    const pending = deferred<RemotePlanner | null>();
    backend.load.mockImplementationOnce(() => pending.promise);
    backend.emit('a'); stop();
    cleanups.push(store.start());
    backend.emit('b'); await settle();
    oldAuth(account('a'));
    pending.resolve({ data: plan('old private'), revision: 1 });
    await settle();
    expect(store.getSnapshot().account?.uid).toBe('b');
    expect(store.getSnapshot().data.events).toEqual([]);
  });

  it('does not reload an account and lose an unsaved in-memory edit on token refresh', async () => {
    const { store, backend, storage } = setup();
    backend.emit('a'); await settle();
    storage.failWrites = true;
    store.setData(plan('in memory'));
    backend.emit('a'); await settle();
    expect(store.getSnapshot().data.events[0].title).toBe('in memory');
    expect(backend.load).toHaveBeenCalledTimes(1);
  });

  it('fetches changes from another device when a clean account explicitly synchronizes', async () => {
    const { store, backend } = setup();
    backend.documents.set('a', { data: plan('original'), revision: 1 });
    backend.emit('a'); await settle();
    backend.documents.set('a', { data: plan('other device'), revision: 2 });
    const syncing = store.retry();
    expect(store.getSnapshot().readOnly).toBe(true);
    expect(store.setData(plan('mid-refresh edit'))).toBe(false);
    await syncing;
    expect(store.getSnapshot().data.events[0].title).toBe('other device');
    expect(backend.save).not.toHaveBeenCalled();
  });

  it('recovers a previously committed save whose response was lost without causing a false conflict', async () => {
    const storage = new MemoryStorage();
    const saved = plan('committed');
    storage.setItem(ACCOUNT_STORAGE_PREFIX + 'a', JSON.stringify({ data: saved, revision: 2, dirty: true }));
    const { store, backend } = setup(storage);
    backend.documents.set('a', { data: saved, revision: 3 });
    backend.emit('a'); await settle();
    expect(store.getSnapshot()).toMatchObject({ data: saved, dirty: false, status: 'ready', readOnly: false });
    expect(JSON.parse(storage.getItem(ACCOUNT_STORAGE_PREFIX + 'a')!)).toMatchObject({ revision: 3, dirty: false });
    expect(backend.save).not.toHaveBeenCalled();
  });

  it('does not start login when unsaved guest changes cannot be persisted', async () => {
    const { store, backend, storage } = setup();
    backend.emit(null);
    storage.failWrites = true;
    store.setData(plan('guest in memory'));
    await store.login();
    expect(backend.login).not.toHaveBeenCalled();
    expect(store.getSnapshot().data.events[0].title).toBe('guest in memory');
    expect(store.getSnapshot().dirty).toBe(true);
  });

  it('ignores a stale popup rejection after another account has already signed in', async () => {
    const { store, backend } = setup();
    backend.emit(null);
    const pending = deferred<void>();
    backend.login.mockImplementationOnce(() => pending.promise);
    const loggingIn = store.login();
    expect(store.getSnapshot().readOnly).toBe(true);
    backend.emit('b'); await settle();
    pending.reject(new CloudError('auth/popup-closed-by-user', 'Closed'));
    await loggingIn;
    expect(store.getSnapshot()).toMatchObject({ status: 'ready', error: '', authBusy: false, readOnly: false });
    expect(store.getSnapshot().account?.uid).toBe('b');
  });

  it('checks the actual pending backup again before logout if browser storage was cleared', async () => {
    const { store, backend, storage } = setup();
    backend.emit('a'); await settle();
    store.setData(plan('pending copy'));
    storage.removeItem(ACCOUNT_STORAGE_PREFIX + 'a');
    storage.failWrites = true;
    backend.save.mockRejectedValueOnce(new CloudError('unavailable', 'Offline'));
    await store.logout();
    expect(backend.logout).not.toHaveBeenCalled();
    expect(store.getSnapshot().data.events[0].title).toBe('pending copy');
    expect(store.getSnapshot().error).toContain('로그아웃을 멈췄어요');
  });

  it('permits offline logout when a failed backup rewrite still leaves an identical durable copy', async () => {
    const { store, backend, storage } = setup();
    backend.emit('a'); await settle();
    store.setData(plan('backed up'));
    storage.failWrites = true;
    backend.save.mockRejectedValueOnce(new CloudError('unavailable', 'Offline'));
    await store.logout();
    expect(backend.logout).toHaveBeenCalledOnce();
    expect(store.getSnapshot().account).toBeNull();
    expect(JSON.parse(storage.getItem(ACCOUNT_STORAGE_PREFIX + 'a')!).data.events[0].title).toBe('backed up');
  });
});
