import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlannerState } from '../types';
import type { PlannerAccount, PlannerBackend, RemotePlanner } from './cloud';
import { CloudError } from './cloud';
import { createDemoState, createEmptyState } from './planner';
import { ACCOUNT_STORAGE_PREFIX, PlannerStore } from './planner-store';
import { readPlannerState, STORAGE_KEY } from './storage';
import { moveSubject } from './subjects';
import { deleteEvent, saveEvent } from './event-occurrences';
import { occursOn } from './recurrence';
import { DEFAULT_EVENT_CATEGORIES } from '../types';

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
function recurringPlan(title: string): PlannerState {
  const data = plan(title);
  data.events[0] = { ...data.events[0], recurrence: 'weekly', weekdays: [1, 3] };
  return data;
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
  it('recognizes migrated default-only accounts as empty without automatically uploading new categories', async () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify(plan('guest')));
    const { store, backend } = setup(storage);
    const legacy = { ...createEmptyState(), categories: DEFAULT_EVENT_CATEGORIES.map((category) => ({ ...category })) };
    delete legacy.subjects;
    backend.documents.set('a', { data: legacy, revision: 2 });
    backend.emit('a'); await settle();
    expect(store.getSnapshot().data).toEqual(createEmptyState());
    expect(store.getSnapshot().canImportGuest).toBe(true);
    expect(backend.save).not.toHaveBeenCalled();
    expect(backend.documents.get('a')?.data).toEqual(legacy);
  });

  it('migrates independent old server and dirty cache copies identically without a false revision conflict', async () => {
    const storage = new MemoryStorage();
    const legacy = { ...plan('already committed'), categories: DEFAULT_EVENT_CATEGORIES.map((category) => ({ ...category })) };
    delete legacy.subjects;
    storage.setItem(ACCOUNT_STORAGE_PREFIX + 'a', JSON.stringify({ data: legacy, revision: 1, dirty: true }));
    const { store, backend } = setup(storage);
    backend.documents.set('a', { data: structuredClone(legacy), revision: 2 });
    backend.emit('a'); await settle();
    expect(store.getSnapshot()).toMatchObject({ status: 'ready', dirty: false, readOnly: false });
    expect(store.getSnapshot().data).toEqual(readPlannerState(legacy));
    expect(JSON.parse(storage.getItem(ACCOUNT_STORAGE_PREFIX + 'a')!)).toEqual({ data: readPlannerState(legacy), revision: 2, dirty: false });
    expect(backend.save).not.toHaveBeenCalled();
  });

  it('keeps guest plans compatible with the legacy key and persists edits immediately', () => {
    const { store, storage } = setup(new MemoryStorage(), null);
    expect(store.getSnapshot().data.isDemo).toBe(true);
    expect(store.setData(plan('guest edit'))).toBe(true);
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!).events[0].title).toBe('guest edit');
    expect(store.getSnapshot()).toMatchObject({ status: 'local', dirty: false, readOnly: false });
  });

  it('restores guest print preferences after reload and preserves corrupt preferences for recovery', () => {
    const { store, storage } = setup(new MemoryStorage(), null);
    const data = { ...plan('Guest schedule'), calendarPrintRange: { startMinute: 485, endMinute: 1380 } };
    expect(store.setData(data)).toBe(true);
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!)).toEqual(data);
    expect(setup(storage, null).store.getSnapshot().data).toEqual(data);

    const corrupt = JSON.stringify({ ...data, calendarPrintRange: { startMinute: 1380, endMinute: 485 } });
    const brokenStorage = new MemoryStorage();
    brokenStorage.setItem(STORAGE_KEY, corrupt);
    const blocked = setup(brokenStorage, null).store;
    expect(blocked.getSnapshot()).toMatchObject({ storageBlocked: true, readOnly: true });
    expect(blocked.setData(data)).toBe(false);
    expect(brokenStorage.getItem(STORAGE_KEY)).toBe(corrupt);
  });

  it('recovers unsaved account print preferences across logout and new devices without leaking them', async () => {
    const storage = new MemoryStorage();
    const guest = { ...plan('Guest schedule'), calendarPrintRange: { startMinute: 480, endMinute: 1260 } };
    const original = { ...recurringPlan('Account A schedule'), calendarPrintRange: { startMinute: 540, endMinute: 1320 } };
    const other = { ...plan('Account B schedule'), calendarPrintRange: { startMinute: 600, endMinute: 1200 } };
    storage.setItem(STORAGE_KEY, JSON.stringify(guest));
    const { store, backend } = setup(storage);
    backend.documents.set('a', { data: original, revision: 3 });
    backend.documents.set('b', { data: other, revision: 7 });
    backend.emit('a'); await settle();
    const expected = { ...original, calendarPrintRange: { startMinute: 420, endMinute: 1440 } };
    expect(store.setData(data => ({ ...data, calendarPrintRange: expected.calendarPrintRange }))).toBe(true);
    backend.save.mockRejectedValueOnce(new CloudError('unavailable', 'Offline'));
    await store.logout();
    expect(JSON.parse(storage.getItem(ACCOUNT_STORAGE_PREFIX + 'a')!)).toEqual({ data: expected, revision: 3, dirty: true });
    expect(backend.documents.get('a')).toEqual({ data: original, revision: 3 });
    expect(store.getSnapshot().data).toEqual(guest);
    backend.emit('b'); await settle();
    expect(store.getSnapshot().data).toEqual(other);
    backend.emit('a'); await settle();
    expect(store.getSnapshot()).toMatchObject({ data: expected, dirty: true });
    await store.retry();
    expect(backend.documents.get('a')).toEqual({ data: expected, revision: 4 });
    expect(JSON.parse(storage.getItem(ACCOUNT_STORAGE_PREFIX + 'a')!)).toEqual({ data: expected, revision: 4, dirty: false });
    expect(backend.documents.get('b')).toEqual({ data: other, revision: 7 });
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!)).toEqual(guest);

    const newBackend = new FakeBackend();
    newBackend.documents = backend.documents;
    const newDevice = setup(new MemoryStorage(), newBackend);
    newBackend.emit('a'); await settle();
    expect(newDevice.store.getSnapshot().data).toEqual(expected);
    expect(newDevice.storage.getItem(STORAGE_KEY)).toBeNull();
    expect(newBackend.save).not.toHaveBeenCalled();
  });

  it('imports settings-only guest data explicitly and preserves an account with its own print preference', async () => {
    const storage = new MemoryStorage();
    const guest = { ...createEmptyState(), calendarPrintRange: { startMinute: 480, endMinute: 1320 } };
    const existing = { ...createEmptyState(), calendarPrintRange: { startMinute: 600, endMinute: 1440 } };
    storage.setItem(STORAGE_KEY, JSON.stringify(guest));
    const { store, backend } = setup(storage);
    backend.documents.set('existing', { data: existing, revision: 2 });
    backend.emit('new'); await settle();
    expect(store.getSnapshot().canImportGuest).toBe(true);
    expect(backend.save).not.toHaveBeenCalled();
    await store.importGuest();
    expect(backend.documents.get('new')).toEqual({ data: guest, revision: 1 });
    backend.emit('existing'); await settle();
    expect(store.getSnapshot().canImportGuest).toBe(false);
    await store.importGuest();
    expect(store.getSnapshot().data).toEqual(existing);
    expect(backend.documents.get('existing')).toEqual({ data: existing, revision: 2 });
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!)).toEqual(guest);
    expect(backend.save).toHaveBeenCalledOnce();
  });

  it.each(['guest', 'account'])('keeps the %s print preference when clearing schedules or loading examples', async (mode) => {
    const storage = new MemoryStorage();
    const original = { ...plan('Schedule to clear'), calendarPrintRange: { startMinute: 480, endMinute: 1380 } };
    if (mode === 'guest') storage.setItem(STORAGE_KEY, JSON.stringify(original));
    const { store, backend } = setup(storage, mode === 'account' ? new FakeBackend() : null);
    if (mode === 'account') {
      backend.documents.set('a', { data: original, revision: 1 });
      backend.emit('a'); await settle();
    }
    let revision = 1;
    for (const replacement of [createEmptyState(), createDemoState('2026-10-05')]) {
      const expected = { ...replacement, calendarPrintRange: original.calendarPrintRange };
      expect(store.resetData(replacement)).toBe(true);
      expect(store.getSnapshot().data).toEqual(expected);
      expect(replacement).not.toHaveProperty('calendarPrintRange');
      if (mode === 'account') {
        await store.retry();
        expect(backend.documents.get('a')).toEqual({ data: expected, revision: ++revision });
      } else {
        expect(JSON.parse(storage.getItem(STORAGE_KEY)!)).toEqual(expected);
      }
    }
    const wholeDay = { startMinute: 0, endMinute: 1440 };
    expect(store.setData(data => ({ ...data, calendarPrintRange: wholeDay }))).toBe(true);
    expect(store.resetData(createEmptyState())).toBe(true);
    expect(store.getSnapshot().data).toEqual({ ...createEmptyState(), calendarPrintRange: wholeDay });
    if (mode === 'account') {
      await store.retry();
      expect(backend.documents.get('a')).toEqual({ data: store.getSnapshot().data, revision: ++revision });
      expect(storage.getItem(STORAGE_KEY)).toBeNull();
    } else {
      expect(JSON.parse(storage.getItem(STORAGE_KEY)!)).toEqual(store.getSnapshot().data);
    }
  });

  it('restores one-occurrence edits and deletions from the guest key after a reload', () => {
    const { store, storage } = setup(new MemoryStorage(), null);
    const original = recurringPlan('Guest series');
    const edited = saveEvent(original.events, { ...original.events[0], title: 'Moved occurrence', date: '2026-10-13' }, { eventId: 'event', date: '2026-10-12' });
    const expected = { ...original, events: deleteEvent(edited, 'event', '2026-10-14') };
    expect(store.setData(expected)).toBe(true);
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!)).toEqual(expected);

    const restored = setup(storage, null).store.getSnapshot().data;
    expect(restored).toEqual(expected);
    expect(restored.events[0].excludedDates).toEqual(['2026-10-12', '2026-10-14']);
    expect(occursOn(restored.events[0], '2026-10-12')).toBe(false);
    expect(occursOn(restored.events[0], '2026-10-14')).toBe(false);
    expect(occursOn(restored.events[0], '2026-10-19')).toBe(true);
    expect(restored.events[1]).toMatchObject({ title: 'Moved occurrence', date: '2026-10-13', recurrence: 'none' });
    expect(occursOn(restored.events[1], '2026-10-13')).toBe(true);
    expect([...storage.values.keys()]).toEqual([STORAGE_KEY]);
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

  it('preserves occurrence exceptions across account saves and fresh clients without changing guest or another account', async () => {
    const storage = new MemoryStorage();
    const guest = recurringPlan('Guest series');
    const original = recurringPlan('Account A series');
    const other = recurringPlan('Account B series');
    storage.setItem(STORAGE_KEY, JSON.stringify(guest));
    const { store, backend } = setup(storage);
    backend.documents.set('a', { data: original, revision: 3 });
    backend.documents.set('b', { data: other, revision: 7 });
    backend.emit('a'); await settle();
    const edited = saveEvent(original.events, { ...original.events[0], date: '2026-10-13', startTime: '15:00', endTime: '16:30' }, { eventId: 'event', date: '2026-10-12' });
    const expected = { ...original, events: deleteEvent(edited, 'event', '2026-10-14') };
    expect(store.setData(expected)).toBe(true);
    expect(JSON.parse(storage.getItem(ACCOUNT_STORAGE_PREFIX + 'a')!)).toEqual({ data: expected, revision: 3, dirty: true });
    await store.logout();
    expect(backend.documents.get('a')).toEqual({ data: expected, revision: 4 });
    expect(store.getSnapshot().data).toEqual(guest);
    backend.emit('b'); await settle();
    expect(store.getSnapshot().data).toEqual(other);
    backend.emit('a'); await settle();
    expect(store.getSnapshot()).toMatchObject({ data: expected, status: 'ready', dirty: false });
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!)).toEqual(guest);
    expect(backend.documents.get('b')).toEqual({ data: other, revision: 7 });

    const newBackend = new FakeBackend();
    newBackend.documents = backend.documents;
    const newDevice = setup(new MemoryStorage(), newBackend);
    newBackend.emit('a'); await settle();
    expect(newDevice.store.getSnapshot().data).toEqual(expected);
    expect(JSON.parse(newDevice.storage.getItem(ACCOUNT_STORAGE_PREFIX + 'a')!)).toEqual({ data: expected, revision: 4, dirty: false });
    expect(newDevice.storage.getItem(STORAGE_KEY)).toBeNull();
    expect(backend.save).toHaveBeenCalledOnce();
    expect(newBackend.save).not.toHaveBeenCalled();
  });

  it('flushes subject order on logout and restores it without changing guest or another account data', async () => {
    const storage = new MemoryStorage();
    const guest = moveSubject(plan('guest only'), '영어', '국어');
    storage.setItem(STORAGE_KEY, JSON.stringify(guest));
    const original = {
      ...plan('account A only'),
      hiddenCategoryIds: ['school'],
      goals: [{ id: 'math-goal', weekStart: '2026-10-05', subject: '수학', material: '수학 개념서', range: '수열 1–20번', completed: true }],
    };
    const originalCopy = structuredClone(original);
    const other = plan('account B only');
    const { store, backend } = setup(storage);
    backend.documents.set('a', { data: original, revision: 3 });
    backend.documents.set('b', { data: other, revision: 7 });
    backend.emit('a'); await settle();
    expect(store.setData(data => moveSubject(data, '한국사', '수학'))).toBe(true);
    const expected = { ...originalCopy, subjects: ['국어', '한국사', '수학', '영어', '과학', '사회'], isDemo: false };
    expect(store.getSnapshot().data).toEqual(expected);
    expect(JSON.parse(storage.getItem(ACCOUNT_STORAGE_PREFIX + 'a')!)).toEqual({ data: expected, revision: 3, dirty: true });
    expect(original).toEqual(originalCopy);

    await store.logout();
    expect(backend.documents.get('a')).toEqual({ data: expected, revision: 4 });
    expect(store.getSnapshot().data).toEqual(guest);
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!)).toEqual(guest);
    backend.emit('b'); await settle();
    expect(store.getSnapshot().data).toEqual(other);
    expect(JSON.parse(storage.getItem(ACCOUNT_STORAGE_PREFIX + 'b')!)).toEqual({ data: other, revision: 7, dirty: false });
    expect(backend.documents.get('b')).toEqual({ data: other, revision: 7 });
    backend.emit('a'); await settle();
    expect(store.getSnapshot()).toMatchObject({ data: expected, status: 'ready', dirty: false, readOnly: false });
    expect(JSON.parse(storage.getItem(ACCOUNT_STORAGE_PREFIX + 'a')!)).toEqual({ data: expected, revision: 4, dirty: false });
    expect(backend.save).toHaveBeenCalledTimes(1);
    expect(backend.save).toHaveBeenCalledWith('a', expected, 3);
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!)).toEqual(guest);
  });

  it('imports guest subject customizations into a new account, including an intentionally empty list', async () => {
    for (const subjects of [[], ['독서']]) {
      const storage = new MemoryStorage();
      const guest = { ...createEmptyState(), subjects };
      storage.setItem(STORAGE_KEY, JSON.stringify(guest));
      const { store, backend } = setup(storage);
      backend.emit('a'); await settle();
      expect(store.getSnapshot().canImportGuest).toBe(true);
      await store.importGuest();
      expect(backend.documents.get('a')).toEqual({ data: readPlannerState(guest), revision: 1 });
      expect(JSON.parse(storage.getItem(STORAGE_KEY)!)).toEqual(guest);
    }
  });

  it('does not replace an existing account with customized subjects through guest import', async () => {
    for (const subjects of [[], ['독서']]) {
      const storage = new MemoryStorage();
      storage.setItem(STORAGE_KEY, JSON.stringify(plan('guest')));
      const { store, backend } = setup(storage);
      const cloud = { ...createEmptyState(), subjects };
      backend.documents.set('a', { data: cloud, revision: 1 });
      backend.emit('a'); await settle();
      expect(store.getSnapshot().canImportGuest).toBe(false);
      await store.importGuest();
      expect(backend.documents.get('a')).toEqual({ data: cloud, revision: 1 });
      expect(backend.save).not.toHaveBeenCalled();
    }
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
