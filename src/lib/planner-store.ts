import type { PlannerState } from '../types';
import type { PlannerAccount, PlannerBackend, RemotePlanner } from './cloud';
import { CloudError, cloudErrorMessage } from './cloud';
import { createDemoState, createEmptyState, toDateKey } from './planner';
import { readPlannerState, STORAGE_KEY } from './storage';

export const ACCOUNT_STORAGE_PREFIX = 'rocky-planner-account:';
export type PlannerStatus = 'local' | 'auth-loading' | 'loading' | 'ready' | 'saving' | 'offline' | 'error' | 'conflict';
export interface PlannerSnapshot {
  data: PlannerState;
  account: PlannerAccount | null;
  status: PlannerStatus;
  error: string;
  storageBlocked: boolean;
  readOnly: boolean;
  authBusy: boolean;
  dirty: boolean;
  canImportGuest: boolean;
}
interface AccountCache { data: PlannerState; revision: number; dirty: boolean }
interface CacheRead { cache: AccountCache | null; blocked: boolean }
interface StoreOptions {
  backend: PlannerBackend | null;
  storage: Storage;
  now?: () => Date;
  debounceMs?: number;
}
const storageError = '저장된 데이터를 읽을 수 없어요. 기존 데이터 보호를 위해 자동 저장을 멈췄습니다. 데이터를 백업하거나 데이터 관리에서 새 플래너를 시작해 주세요.';
const writeError = '이 브라우저에 데이터를 저장하지 못했어요. 저장 공간과 브라우저 설정을 확인하고 창을 닫기 전에 현재 데이터를 백업해 주세요.';

function errorCode(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
}
function failureStatus(error: unknown): PlannerStatus {
  return errorCode(error) === 'cloud/conflict' ? 'conflict' : ['unavailable', 'deadline-exceeded', 'auth/network-request-failed'].includes(errorCode(error)) ? 'offline' : 'error';
}
function isEmpty(data: PlannerState): boolean {
  const empty = createEmptyState();
  const current = readPlannerState(data);
  return current !== null && !current.isDemo && !current.events.length && !current.goals.length && !current.calendarPrintRange && !(current.hiddenCategoryIds?.length) && JSON.stringify(current.categories) === JSON.stringify(empty.categories) && JSON.stringify(current.subjects) === JSON.stringify(empty.subjects);
}
function checkedRemote(remote: RemotePlanner | null): RemotePlanner | null {
  if (remote === null) return null;
  const data = readPlannerState(remote.data);
  if (!data || !Number.isSafeInteger(remote.revision) || remote.revision < 1) throw new CloudError('cloud/invalid-data', 'Invalid remote planner');
  return { data, revision: remote.revision };
}

/** Account documents are never copied into the guest key. Every asynchronous operation
 * captures both the account and a generation so late responses cannot change a new session. */
export class PlannerStore {
  private readonly backend: PlannerBackend | null;
  private readonly storage: Storage;
  private readonly now: () => Date;
  private readonly debounceMs: number;
  private snapshot: PlannerSnapshot;
  private listeners = new Set<() => void>();
  private active = false;
  private lifecycle = 0;
  private generation = 0;
  private unsubscribeAuth: (() => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private savePromise: Promise<void> | null = null;
  private revision = 0;
  private editVersion = 0;
  private serverLoaded = false;
  private serverEmpty = false;
  private localDurable = true;

  constructor(options: StoreOptions) {
    this.backend = options.backend;
    this.storage = options.storage;
    this.now = options.now ?? (() => new Date());
    this.debounceMs = options.debounceMs ?? 400;
    this.snapshot = { data: createEmptyState(), account: null, status: this.backend ? 'auth-loading' : 'local', error: '', storageBlocked: false, readOnly: !!this.backend, authBusy: false, dirty: false, canImportGuest: false };
    if (!this.backend) this.restoreGuest();
  }

  getSnapshot = (): PlannerSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };

  private update(patch: Partial<PlannerSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach(listener => listener());
  }
  private current(uid: string, generation: number): boolean {
    return this.active && this.generation === generation && this.snapshot.account?.uid === uid;
  }
  private clearTimer(): void { if (this.timer !== null) clearTimeout(this.timer); this.timer = null; }

  start = (): (() => void) => {
    if (this.active) return () => {};
    this.active = true;
    const lifecycle = ++this.lifecycle;
    if (this.backend) {
      this.update({ status: 'auth-loading', readOnly: true });
      this.unsubscribeAuth = this.backend.observeAuth(account => {
        if (this.active && this.lifecycle === lifecycle) this.changeAccount(account);
      }, error => {
        if (this.active && this.lifecycle === lifecycle) this.update({ status: 'error', error: cloudErrorMessage(error), readOnly: true, authBusy: false });
      });
    } else if (!this.snapshot.storageBlocked) this.persistGuest();
    return () => {
      if (this.lifecycle !== lifecycle) return;
      this.active = false;
      ++this.generation;
      this.clearTimer();
      this.unsubscribeAuth?.();
      this.unsubscribeAuth = null;
      this.savePromise = null;
    };
  };

  private guest(): { data: PlannerState; blocked: boolean } {
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (raw === null) return { data: createDemoState(toDateKey(this.now())), blocked: false };
      const data = readPlannerState(JSON.parse(raw));
      if (!data) throw new Error('Invalid guest data');
      return { data, blocked: false };
    } catch { return { data: createEmptyState(), blocked: true }; }
  }
  private restoreGuest(): void {
    const guest = this.guest();
    this.localDurable = !guest.blocked;
    this.update({ data: guest.data, account: null, status: 'local', error: guest.blocked ? storageError : '', storageBlocked: guest.blocked, readOnly: guest.blocked, authBusy: false, dirty: false, canImportGuest: false });
  }
  private readCache(uid: string): CacheRead {
    try {
      const raw = this.storage.getItem(ACCOUNT_STORAGE_PREFIX + uid);
      if (raw === null) return { cache: null, blocked: false };
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || !('data' in parsed) || !('revision' in parsed) || !('dirty' in parsed)) throw new Error('Invalid account cache');
      const data = readPlannerState(parsed.data);
      if (!data || typeof parsed.revision !== 'number' || !Number.isSafeInteger(parsed.revision) || parsed.revision < 0 || typeof parsed.dirty !== 'boolean') throw new Error('Invalid account cache');
      return { cache: { data, revision: parsed.revision, dirty: parsed.dirty }, blocked: false };
    } catch { return { cache: null, blocked: true }; }
  }
  private persistGuest(): boolean {
    if (this.snapshot.storageBlocked) return false;
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.snapshot.data));
      this.localDurable = true;
      this.update({ dirty: false, status: 'local', error: '' });
      return true;
    } catch {
      this.localDurable = false;
      this.update({ dirty: true, error: writeError, status: 'error' });
      return false;
    }
  }
  private persistAccount(): boolean {
    if (!this.snapshot.account || this.snapshot.storageBlocked) return false;
    try {
      const envelope: AccountCache = { data: this.snapshot.data, revision: this.revision, dirty: this.snapshot.dirty };
      this.storage.setItem(ACCOUNT_STORAGE_PREFIX + this.snapshot.account.uid, JSON.stringify(envelope));
      this.localDurable = true;
      return true;
    } catch { this.localDurable = false; return false; }
  }
  private importAvailable(): boolean {
    if (!this.snapshot.account || !this.serverLoaded || !this.serverEmpty || this.snapshot.dirty || this.snapshot.readOnly || !isEmpty(this.snapshot.data)) return false;
    const guest = this.guest();
    return !guest.blocked && !guest.data.isDemo && !isEmpty(guest.data);
  }

  private changeAccount(account: PlannerAccount | null): void {
    if (account && account.uid === this.snapshot.account?.uid && this.snapshot.status !== 'auth-loading') {
      this.update({ account });
      return;
    }
    this.clearTimer();
    const generation = ++this.generation;
    this.savePromise = null;
    this.editVersion = 0;
    this.revision = 0;
    this.serverLoaded = false;
    this.serverEmpty = false;
    if (!account) { this.restoreGuest(); if (!this.snapshot.storageBlocked) this.persistGuest(); return; }
    this.update({ data: createEmptyState(), account, status: 'loading', error: '', storageBlocked: false, readOnly: true, authBusy: false, dirty: false, canImportGuest: false });
    const cached = this.readCache(account.uid);
    this.localDurable = !cached.blocked;
    if (cached.cache) this.revision = cached.cache.revision;
    void this.loadAccount(account.uid, generation, cached);
  }

  private async loadAccount(uid: string, generation: number, cached: CacheRead): Promise<void> {
    if (!this.backend) return;
    try {
      const remote = checkedRemote(await this.backend.load(uid));
      if (!this.current(uid, generation)) return;
      this.serverLoaded = true;
      this.serverEmpty = !remote || isEmpty(remote.data);
      this.revision = remote?.revision ?? 0;
      if (cached.blocked) {
        this.update({ data: remote?.data ?? createEmptyState(), status: 'error', error: storageError, storageBlocked: true, readOnly: true, dirty: false });
        return;
      }
      if (cached.cache?.dirty) {
        if (remote && JSON.stringify(remote.data) === JSON.stringify(cached.cache.data)) {
          // A previous request may have committed before the browser received its response.
          this.update({ data: remote.data, dirty: false, status: 'ready', error: '', readOnly: false, storageBlocked: false });
          if (!this.persistAccount()) this.update({ error: writeError });
          this.update({ canImportGuest: this.importAvailable() });
          return;
        }
        this.revision = cached.cache.revision;
        const conflict = cached.cache.revision !== (remote?.revision ?? 0);
        this.update({ data: cached.cache.data, dirty: true, status: conflict ? 'conflict' : 'ready', error: conflict ? cloudErrorMessage(new CloudError('cloud/conflict', 'Revision mismatch')) : '', readOnly: conflict, storageBlocked: false, canImportGuest: false });
        if (!conflict) this.scheduleSave();
        return;
      }
      this.update({ data: remote?.data ?? createEmptyState(), dirty: false, status: 'ready', error: '', readOnly: false, storageBlocked: false });
      if (!this.persistAccount()) this.update({ error: writeError });
      this.update({ canImportGuest: this.importAvailable() });
    } catch (error) {
      if (!this.current(uid, generation)) return;
      this.serverLoaded = false;
      const invalid = errorCode(error) === 'cloud/invalid-data';
      this.update({ data: cached.cache?.data ?? createEmptyState(), dirty: cached.cache?.dirty ?? false, status: failureStatus(error), error: cached.blocked ? storageError : cloudErrorMessage(error), storageBlocked: cached.blocked, readOnly: cached.blocked || !cached.cache || invalid, canImportGuest: false });
    }
  }

  setData = (next: PlannerState | ((previous: PlannerState) => PlannerState)): boolean => {
    if (this.snapshot.readOnly) return false;
    const value = typeof next === 'function' ? next(this.snapshot.data) : next;
    const data = readPlannerState(value);
    if (!data) { this.update({ error: '입력한 데이터 형식을 확인할 수 없어 저장하지 않았어요.' }); return false; }
    ++this.editVersion;
    this.update({ data, dirty: true, canImportGuest: false });
    if (!this.snapshot.account) { this.persistGuest(); return true; }
    const durable = this.persistAccount();
    this.update({ error: durable ? '' : writeError });
    this.scheduleSave();
    return true;
  };

  resetData = (data: PlannerState): boolean => {
    if (!readPlannerState(data)) return false;
    if (this.snapshot.account && (!this.serverLoaded || this.snapshot.status === 'conflict' || this.snapshot.authBusy)) return false;
    if (this.snapshot.status === 'auth-loading' || this.snapshot.status === 'loading') return false;
    // Clearing schedules or loading examples keeps the last explicit print preference.
    const calendarPrintRange = data.calendarPrintRange ?? this.snapshot.data.calendarPrintRange;
    this.update({ storageBlocked: false, readOnly: false });
    return this.setData(calendarPrintRange ? { ...data, calendarPrintRange } : data);
  };

  private scheduleSave(): void {
    this.clearTimer();
    if (!this.active || !this.backend || !this.snapshot.account || !this.serverLoaded || !this.snapshot.dirty || this.snapshot.readOnly || this.savePromise) return;
    this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, this.debounceMs);
  }
  private async flush(): Promise<void> {
    this.clearTimer();
    if (this.savePromise) { await this.savePromise; return; }
    const uid = this.snapshot.account?.uid;
    if (!this.backend || !uid || !this.serverLoaded || this.snapshot.readOnly || !this.snapshot.dirty) return;
    const generation = this.generation;
    const backend = this.backend;
    const operation = (async () => {
      while (this.current(uid, generation) && this.snapshot.dirty && !this.snapshot.readOnly) {
        const version = this.editVersion;
        const sent = this.snapshot.data;
        const expectedRevision = this.revision;
        this.update({ status: 'saving' });
        try {
          const remote = checkedRemote(await backend.save(uid, sent, expectedRevision));
          if (!this.current(uid, generation)) return;
          if (!remote || remote.revision !== expectedRevision + 1) throw new CloudError('cloud/invalid-data', 'Invalid saved revision');
          this.revision = remote.revision;
          this.serverEmpty = isEmpty(remote.data);
          const dirty = version !== this.editVersion;
          this.update({ ...(dirty ? {} : { data: remote.data }), dirty, status: dirty ? 'saving' : 'ready', error: '' });
          if (!this.persistAccount()) this.update({ error: writeError });
          this.update({ canImportGuest: this.importAvailable() });
        } catch (error) {
          if (!this.current(uid, generation)) return;
          const status = failureStatus(error);
          this.update({ status, error: cloudErrorMessage(error), readOnly: status === 'conflict' || errorCode(error) === 'cloud/invalid-data', canImportGuest: false });
          return;
        }
      }
    })();
    this.savePromise = operation;
    try { await operation; } finally { if (this.savePromise === operation) this.savePromise = null; }
  }

  login = async (): Promise<void> => {
    if (!this.backend || this.snapshot.authBusy) return;
    if (!this.snapshot.account && this.snapshot.dirty && !this.localDurable && !this.persistGuest()) {
      this.update({ error: '아직 이 브라우저에 저장되지 않은 변경 내용이 있어요. 현재 데이터를 백업하고 저장을 다시 시도한 뒤 로그인해 주세요.' });
      return;
    }
    const generation = this.generation;
    const readOnly = this.snapshot.readOnly;
    this.update({ authBusy: true, readOnly: true, error: '' });
    try { await this.backend.login(); }
    catch (error) { if (this.active && this.generation === generation) this.update({ error: cloudErrorMessage(error) }); }
    finally { if (this.active && this.generation === generation) this.update({ authBusy: false, readOnly }); }
  };

  logout = async (): Promise<void> => {
    if (!this.backend || this.snapshot.authBusy) return;
    const uid = this.snapshot.account?.uid;
    const generation = this.generation;
    this.update({ authBusy: true });
    await this.flush();
    if (uid && !this.current(uid, generation)) return;
    if (uid && this.snapshot.dirty && !this.persistAccount()) {
      // Another tab or browser storage cleanup may have replaced the earlier backup.
      // A remembered successful write alone is not enough to permit discarding memory.
      const backup = this.readCache(uid).cache;
      if (!backup?.dirty || backup.revision !== this.revision || JSON.stringify(backup.data) !== JSON.stringify(this.snapshot.data)) {
        this.update({ authBusy: false, error: '아직 저장되지 않은 변경 내용이 있어 로그아웃을 멈췄어요. 현재 데이터를 백업하고 저장을 다시 시도해 주세요.' });
        return;
      }
    }
    const previous = this.snapshot;
    this.update({ data: createEmptyState(), status: 'loading', readOnly: true, canImportGuest: false });
    try { await this.backend.logout(); }
    catch (error) { if (!uid || this.current(uid, generation)) this.update({ ...previous, authBusy: false, error: cloudErrorMessage(error) }); }
    finally { if (!uid || this.current(uid, generation)) this.update({ authBusy: false }); }
  };

  retry = async (): Promise<void> => {
    if (!this.active) return;
    const uid = this.snapshot.account?.uid;
    if (!uid) { if (!this.snapshot.storageBlocked && this.snapshot.status !== 'auth-loading') this.persistGuest(); return; }
    if (this.snapshot.authBusy || this.snapshot.status === 'loading') return;
    if (this.serverLoaded && !this.snapshot.readOnly && this.snapshot.dirty) { await this.flush(); return; }
    const cached: CacheRead = this.snapshot.dirty || (this.serverLoaded && !this.snapshot.storageBlocked) ? { cache: { data: this.snapshot.data, revision: this.revision, dirty: this.snapshot.dirty }, blocked: this.snapshot.storageBlocked } : this.readCache(uid);
    this.update({ status: 'loading', readOnly: true, error: '' });
    await this.loadAccount(uid, this.generation, cached);
    if (!this.snapshot.readOnly) await this.flush();
  };

  importGuest = async (): Promise<void> => {
    if (!this.importAvailable()) return;
    const guest = this.guest();
    if (guest.blocked || guest.data.isDemo || isEmpty(guest.data)) return;
    if (this.setData(guest.data)) await this.flush();
  };

  /** The UI must ask before this explicit replacement of pending changes. */
  useCloudVersion = async (): Promise<void> => {
    const uid = this.snapshot.account?.uid;
    if (!uid || !this.backend || this.snapshot.authBusy || this.snapshot.status === 'loading' || this.snapshot.status === 'saving') return;
    const generation = this.generation;
    this.clearTimer();
    const previous = this.snapshot;
    this.update({ status: 'loading', readOnly: true, canImportGuest: false });
    try {
      const remote = checkedRemote(await this.backend.load(uid));
      if (!this.current(uid, generation)) return;
      if (previous.dirty || previous.storageBlocked) {
        // Retain a recovery copy before replacing a corrupt or conflicting cache.
        const backup = previous.storageBlocked ? this.storage.getItem(ACCOUNT_STORAGE_PREFIX + uid) : JSON.stringify({ data: previous.data, revision: this.revision, dirty: previous.dirty });
        if (backup !== null) this.storage.setItem(`${ACCOUNT_STORAGE_PREFIX}${uid}:backup:${this.now().getTime()}`, backup);
      }
      this.revision = remote?.revision ?? 0;
      this.serverLoaded = true;
      this.serverEmpty = !remote || isEmpty(remote.data);
      this.update({ data: remote?.data ?? createEmptyState(), status: 'ready', error: '', dirty: false, readOnly: false, storageBlocked: false });
      if (!this.persistAccount()) this.update({ error: writeError });
      this.update({ canImportGuest: this.importAvailable() });
    } catch (error) {
      if (this.current(uid, generation)) this.update({ ...previous, error: errorCode(error) ? cloudErrorMessage(error) : '현재 변경 내용을 보관하지 못해 서버 데이터로 교체하지 않았어요. 먼저 데이터를 파일로 백업해 주세요.' });
    }
  };
}
