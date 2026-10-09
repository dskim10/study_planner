import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteApp, initializeApp } from 'firebase/app';
import { connectAuthEmulator, GoogleAuthProvider, initializeAuth, inMemoryPersistence, signInWithCredential } from 'firebase/auth';
import {
  collection, connectFirestoreEmulator, deleteDoc, doc, getDocFromServer, getDocs,
  initializeFirestore, memoryLocalCache, serverTimestamp, setDoc, setLogLevel, terminate, Timestamp,
} from 'firebase/firestore';
import { createFirebaseBackend } from '../src/lib/firebase.ts';
import { createEmptyState } from '../src/lib/planner.ts';
import { deleteEvent, saveEvent } from '../src/lib/event-occurrences.ts';
import { occursOn } from '../src/lib/recurrence.ts';
import { removeCategory, updateCategoryColor } from '../src/lib/categories.ts';
import { addSubject, moveSubject, renameSubject, removeSubject, syncSubjectCategories } from '../src/lib/subjects.ts';
import { DEFAULT_EVENT_CATEGORIES, DEFAULT_SUBJECTS } from '../src/types.ts';

const projectId = 'demo-rocky';
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
assert.match(firestoreHost ?? '', /^(127\.0\.0\.1|localhost):8080$/, 'Run with the local Firestore emulator: npm run test:firebase');
assert.match(authHost ?? '', /^(127\.0\.0\.1|localhost):9099$/, 'Run with the local Authentication emulator: npm run test:firebase');
setLogLevel('error');

let environment;
const clients = [];
const runId = randomUUID();

function completePlanner() {
  const data = createEmptyState();
  data.categories.push({ id: 'custom-reading', label: '독서 모임', color: '#3A7DAA' });
  data.hiddenCategoryIds = ['custom-reading'];
  data.calendarPrintRange = { startMinute: 480, endMinute: 1320 };
  data.events.push({
    id: 'custom-repeating-event', title: '함께 읽기', type: 'custom-reading', date: '2026-10-05',
    startTime: '17:00', endTime: '18:00', allDay: false, recurrence: 'custom', weekdays: [1, 3],
    customRecurrence: { interval: 2, unit: 'week', weekdays: [1, 3], monthPattern: 'dayOfMonth', end: { type: 'count', count: 10 } },
    excludedDates: ['2026-10-07'],
  });
  data.goals.push({
    id: 'goal-math', weekStart: '2026-10-05', subject: '수학', material: '수학 개념서', range: '수열 1–20번',
    estimatedMinutes: 120, completed: true,
  });
  return data;
}

function record(uid, revision = 1, data = completePlanner()) {
  return { ownerId: uid, revision, data, updatedAt: serverTimestamp() };
}

function plannerReference(context, uid = 'owner') {
  return doc(context.firestore(), 'users', uid, 'planner', 'main');
}

async function seedOwner() {
  const context = environment.authenticatedContext('owner');
  const reference = plannerReference(context);
  await assertSucceeds(setDoc(reference, record('owner')));
  return reference;
}

function unsignedGoogleToken(subject) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const issuedAt = Math.floor(Date.now() / 1000);
  // Mock credentials are accepted only by the explicitly connected Auth emulator.
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({
    iss: 'https://accounts.google.com', aud: projectId, sub: subject,
    email: `${subject}@example.test`, email_verified: true, name: '테스트 학생', iat: issuedAt, exp: issuedAt + 3600,
  })}.`;
}

async function makeClient(subject) {
  const app = initializeApp({
    projectId, apiKey: 'demo-rocky-integration-key', authDomain: 'demo-rocky.firebaseapp.com', appId: 'demo-rocky-integration',
  }, `integration-${randomUUID()}`);
  const auth = initializeAuth(app, { persistence: inMemoryPersistence });
  connectAuthEmulator(auth, `http://${authHost}`, { disableWarnings: true });
  const db = initializeFirestore(app, { localCache: memoryLocalCache() });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  const client = { app, auth, db, backend: createFirebaseBackend(auth, db) };
  clients.push(client);
  await signInWithCredential(auth, GoogleAuthProvider.credential(unsignedGoogleToken(subject)));
  return client;
}

describe('Firebase emulator integration', { concurrency: false, timeout: 120_000 }, () => {
  before(async () => {
    environment = await initializeTestEnvironment({
      projectId,
      firestore: { host: '127.0.0.1', port: 8080, rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8') },
    });
  });
  beforeEach(async () => { await environment.clearFirestore(); });
  afterEach(async () => {
    for (const client of clients.splice(0)) {
      await terminate(client.db);
      await deleteApp(client.app);
    }
  });
  after(async () => { await environment?.cleanup(); });

  it('allows the owner to create, read, and update the main planner', async () => {
    const reference = await seedOwner();
    const first = await assertSucceeds(getDocFromServer(reference));
    assert.equal(first.data().revision, 1);
    assert.deepEqual(first.data().data, completePlanner());
    const changed = completePlanner();
    changed.goals[0].completed = false;
    await assertSucceeds(setDoc(reference, record('owner', 2, changed)));
    const updated = await getDocFromServer(reference);
    assert.equal(updated.data().revision, 2);
    assert.equal(updated.data().data.goals[0].completed, false);
    assert.ok(updated.data().updatedAt instanceof Timestamp);
  });

  it('denies unauthenticated reads and writes', async () => {
    await seedOwner();
    const reference = plannerReference(environment.unauthenticatedContext());
    await assertFails(getDocFromServer(reference));
    await assertFails(setDoc(reference, record('owner', 2)));
  });

  it('denies another account access to an existing planner or creation for the owner', async () => {
    await seedOwner();
    const other = environment.authenticatedContext('other');
    const reference = plannerReference(other);
    await assertFails(getDocFromServer(reference));
    await assertFails(setDoc(reference, record('owner', 2)));
    await assertFails(setDoc(plannerReference(other, 'absent-owner'), record('absent-owner')));
  });

  it('denies collection listing and deleting even for the owner', async () => {
    const reference = await seedOwner();
    const owner = environment.authenticatedContext('owner');
    await assertFails(getDocs(collection(owner.firestore(), 'users', 'owner', 'planner')));
    await assertFails(deleteDoc(reference));
    assert.equal((await getDocFromServer(reference)).exists(), true);
  });

  it('denies alternate planner and unrelated document paths', async () => {
    const db = environment.authenticatedContext('owner').firestore();
    await assertFails(setDoc(doc(db, 'users', 'owner', 'planner', 'secondary'), record('owner')));
    await assertFails(setDoc(doc(db, 'users', 'owner'), { name: 'forbidden-profile' }));
  });

  it('requires revision 1 when a planner is first created', async () => {
    const reference = plannerReference(environment.authenticatedContext('owner'));
    for (const revision of [0, 2, 1.5, '1']) {
      await assertFails(setDoc(reference, record('owner', revision)));
    }
    await assertSucceeds(setDoc(reference, record('owner')));
  });

  it('requires exactly the next revision when updating', async () => {
    const reference = await seedOwner();
    for (const revision of [0, 1, 3, 2.5, '2']) {
      await assertFails(setDoc(reference, record('owner', revision)));
    }
    assert.equal((await getDocFromServer(reference)).data().revision, 1);
  });

  it('rejects an owner mismatch and additional envelope fields', async () => {
    const reference = await seedOwner();
    await assertFails(setDoc(reference, record('other', 2)));
    await assertFails(setDoc(reference, { ...record('owner', 2), extra: 'not allowed' }));
    const missingOwner = record('owner', 2);
    delete missingOwner.ownerId;
    await assertFails(setDoc(reference, missingOwner));
  });

  it('requires the server timestamp on create and update', async () => {
    const reference = plannerReference(environment.authenticatedContext('owner'));
    await assertFails(setDoc(reference, { ...record('owner'), updatedAt: Timestamp.fromMillis(0) }));
    await assertSucceeds(setDoc(reference, record('owner')));
    await assertFails(setDoc(reference, { ...record('owner', 2), updatedAt: Timestamp.fromMillis(0) }));
    const withoutTime = record('owner', 2);
    delete withoutTime.updatedAt;
    await assertFails(setDoc(reference, withoutTime));
  });

  it('rejects invalid top-level planner schema and unknown planner fields', async () => {
    const reference = await seedOwner();
    for (const change of [
      { version: 2 }, { categories: [] }, { events: {} }, { goals: 'bad' },
      { isDemo: 'false' }, { hiddenCategoryIds: {} }, { subjects: {} }, { subjects: '수학' },
      { subjects: null }, { activityHours: {} },
    ]) {
      await assertFails(setDoc(reference, record('owner', 2, { ...completePlanner(), ...change })));
    }
  });

  it('accepts legacy print settings and protects saved preferences from older clients', async () => {
    const reference = plannerReference(environment.authenticatedContext('owner'));
    const original = completePlanner();
    delete original.calendarPrintRange;
    await assertSucceeds(setDoc(reference, record('owner', 1, original)));
    assert.deepEqual((await getDocFromServer(reference)).data().data, original);
    let revision = 1;
    await assertSucceeds(setDoc(reference, record('owner', ++revision, original)));
    for (const calendarPrintRange of [
      { startMinute: 0, endMinute: 1440 }, { startMinute: 485, endMinute: 1325 }, { startMinute: 1439, endMinute: 1440 },
    ]) {
      const data = { ...original, calendarPrintRange };
      await assertSucceeds(setDoc(reference, record('owner', ++revision, data)));
      assert.deepEqual((await getDocFromServer(reference)).data().data, data);
    }
    await assertFails(setDoc(reference, record('owner', revision + 1, original)));
    assert.equal((await getDocFromServer(reference)).data().revision, revision);
    const defaults = { ...createEmptyState(), calendarPrintRange: { startMinute: 0, endMinute: 1440 } };
    await assertSucceeds(setDoc(reference, record('owner', ++revision, defaults)));
    assert.deepEqual((await getDocFromServer(reference)).data().data, defaults);
    await assertFails(setDoc(reference, record('owner', revision + 1, createEmptyState())));
  });

  it('rejects malformed print ranges without overwriting the saved preference', async () => {
    const reference = await seedOwner();
    for (const calendarPrintRange of [
      null, [], '08:00-22:00', {}, { startMinute: 0 }, { endMinute: 1440 },
      { startMinute: '0', endMinute: 1440 }, { startMinute: 0, endMinute: '1440' },
      { startMinute: -1, endMinute: 1440 }, { startMinute: 0, endMinute: 1441 },
      { startMinute: 1440, endMinute: 1440 }, { startMinute: 600, endMinute: 600 },
      { startMinute: 600, endMinute: 599 }, { startMinute: 0.5, endMinute: 1440 },
      { startMinute: 0, endMinute: 1439.5 }, { startMinute: 0, endMinute: 1440, extra: true },
    ]) {
      await assertFails(setDoc(reference, record('owner', 2, { ...completePlanner(), calendarPrintRange })));
    }
    const retained = await getDocFromServer(reference);
    assert.equal(retained.data().revision, 1);
    assert.deepEqual(retained.data().data, completePlanner());
  });

  it('allows zero categories only when no schedules remain', async () => {
    const reference = await seedOwner();
    const data = { ...completePlanner(), categories: [], events: [], hiddenCategoryIds: [] };
    await assertSucceeds(setDoc(reference, record('owner', 2, data)));
    assert.deepEqual((await getDocFromServer(reference)).data().data, data);
    await assertFails(setDoc(reference, record('owner', 3, { ...data, events: completePlanner().events })));
  });

  it('accepts legacy planners without a subjects field on create and update', async () => {
    const reference = plannerReference(environment.authenticatedContext('owner'));
    const legacy = completePlanner();
    delete legacy.subjects;
    await assertSucceeds(setDoc(reference, record('owner', 1, legacy)));
    assert.deepEqual((await getDocFromServer(reference)).data().data, legacy);
    legacy.goals[0].completed = false;
    await assertSucceeds(setDoc(reference, record('owner', 2, legacy)));
    assert.deepEqual((await getDocFromServer(reference)).data().data, legacy);
  });

  it('allows an explicit empty subjects list only when no goals remain', async () => {
    const reference = plannerReference(environment.authenticatedContext('owner'));
    const invalid = { ...completePlanner(), subjects: [] };
    await assertFails(setDoc(reference, record('owner', 1, invalid)));
    const empty = { ...invalid, goals: [] };
    await assertSucceeds(setDoc(reference, record('owner', 1, empty)));
    assert.deepEqual((await getDocFromServer(reference)).data().data, empty);
    await assertFails(setDoc(reference, record('owner', 2, invalid)));
    assert.equal((await getDocFromServer(reference)).data().revision, 1);
  });

  it('rejects older-client saves that would erase subjects after a legacy planner is upgraded', async () => {
    const reference = plannerReference(environment.authenticatedContext('owner'));
    const legacy = completePlanner();
    delete legacy.subjects;
    await assertSucceeds(setDoc(reference, record('owner', 1, legacy)));
    await assertSucceeds(setDoc(reference, record('owner', 2, legacy)));
    const upgraded = { ...legacy, subjects: ['수학', '독서'] };
    await assertSucceeds(setDoc(reference, record('owner', 3, upgraded)));
    await assertFails(setDoc(reference, record('owner', 4, legacy)));
    const retained = await getDocFromServer(reference);
    assert.equal(retained.data().revision, 3);
    assert.deepEqual(retained.data().data, upgraded);
    const changed = { ...upgraded, subjects: ['수학', '미술'] };
    await assertSucceeds(setDoc(reference, record('owner', 4, changed)));
    assert.deepEqual((await getDocFromServer(reference)).data().data, changed);
  });

  it('preserves an intentional empty subject list against an older-client save', async () => {
    const reference = plannerReference(environment.authenticatedContext('owner'));
    const empty = { ...createEmptyState(), subjects: [] };
    await assertSucceeds(setDoc(reference, record('owner', 1, empty)));
    const olderClient = { ...empty };
    delete olderClient.subjects;
    await assertFails(setDoc(reference, record('owner', 2, olderClient)));
    assert.deepEqual((await getDocFromServer(reference)).data().data, empty);
    const reset = createEmptyState();
    await assertSucceeds(setDoc(reference, record('owner', 2, reset)));
    assert.deepEqual((await getDocFromServer(reference)).data().data, reset);
  });

  it('restores subjects and goals without estimates after rename, transfer, and removing all subjects', async () => {
    const subject = `google-subjects-${runId}`;
    const first = await makeClient(subject);
    const uid = first.auth.currentUser.uid;
    let original = addSubject(createEmptyState(), '독서');
    assert.deepEqual(original.subjects, [...DEFAULT_SUBJECTS, '독서']);
    let mathCategory = original.categories.find((category) => category.label === '수학');
    const readingCategory = original.categories.find((category) => category.label === '독서');
    assert.ok(mathCategory && readingCategory);
    assert.throws(() => removeCategory(original, mathCategory.id), /과목/);
    original.hiddenCategoryIds = [mathCategory.id];
    original.events.push({
      id: 'subject-series', title: '수학 공부', type: mathCategory.id, date: '2026-10-05',
      startTime: '17:00', endTime: '18:00', allDay: false, recurrence: 'weekly', weekdays: [1, 3],
    });
    const beforeColor = original;
    original = updateCategoryColor(original, mathCategory.id, '#12AbCd');
    mathCategory = original.categories.find((category) => category.id === mathCategory.id);
    assert.equal(mathCategory.color, '#12abcd');
    assert.deepEqual(original.events, beforeColor.events);
    assert.deepEqual(original.hiddenCategoryIds, beforeColor.hiddenCategoryIds);
    original.goals.push(
      { id: 'math', weekStart: '2026-10-05', subject: '수학', material: '개념서', range: '1장', completed: false },
      { id: 'reading', weekStart: '2026-10-12', subject: '독서', material: '소설', range: '2장', completed: true },
    );
    await first.backend.save(uid, original, 0);
    const second = await makeClient(subject);
    const restored = await second.backend.load(uid);
    assert.deepEqual(restored, { data: original, revision: 1 });
    assert.ok(restored.data.goals.every((goal) => !Object.hasOwn(goal, 'estimatedMinutes')));

    const renamed = renameSubject(restored.data, '수학', '수학 심화');
    await second.backend.save(uid, renamed, 1);
    assert.deepEqual(await first.backend.load(uid), { data: renamed, revision: 2 });
    assert.equal(renamed.goals[0].subject, '수학 심화');
    assert.equal(renamed.subjects.includes('수학'), false);
    assert.deepEqual(renamed.categories.find((category) => category.id === mathCategory.id), { ...mathCategory, label: '수학 심화' });
    assert.deepEqual(renamed.events, original.events);
    assert.deepEqual(renamed.hiddenCategoryIds, original.hiddenCategoryIds);

    const moved = removeSubject(renamed, '독서', '수학 심화');
    await first.backend.save(uid, moved, 2);
    assert.deepEqual(await second.backend.load(uid), { data: moved, revision: 3 });
    assert.ok(moved.goals.every((goal) => goal.subject === '수학 심화'));
    assert.equal(moved.subjects.includes('독서'), false);
    assert.deepEqual(moved.categories.find((category) => category.id === readingCategory.id), readingCategory);
    assert.doesNotThrow(() => removeCategory(moved, readingCategory.id));

    const empty = moved.subjects.reduce((data, name) => removeSubject(data, name), moved);
    await second.backend.save(uid, empty, 3);
    await first.backend.logout();
    await signInWithCredential(first.auth, GoogleAuthProvider.credential(unsignedGoogleToken(subject)));
    assert.deepEqual(await first.backend.load(uid), { data: empty, revision: 4 });
    assert.deepEqual(empty.subjects, []);
    assert.deepEqual(empty.goals, []);
    assert.deepEqual(empty.events, original.events);
    assert.deepEqual(empty.categories, renamed.categories);
  });

  it('restores reordered subjects after account switching and on a new device without changing planner content', async () => {
    const ownerSubject = `google-subject-order-${runId}`;
    const otherSubject = `google-subject-order-other-${runId}`;
    const first = await makeClient(ownerSubject);
    const uid = first.auth.currentUser.uid;
    const other = await makeClient(otherSubject);
    const otherUid = other.auth.currentUser.uid;
    const original = completePlanner();
    const originalCopy = structuredClone(original);
    const otherData = completePlanner();
    otherData.events[0].title = '다른 계정의 독서 모임';
    otherData.goals[0].range = '다른 계정의 목표 범위';
    await first.backend.save(uid, original, 0);
    await other.backend.save(otherUid, otherData, 0);

    const reordered = moveSubject(original, '한국사', '수학');
    const expected = { ...originalCopy, subjects: ['국어', '한국사', '수학', '영어', '과학', '사회'], isDemo: false };
    assert.deepEqual(reordered, expected);
    assert.deepEqual(original, originalCopy);
    assert.deepEqual(await first.backend.save(uid, reordered, 1), { data: expected, revision: 2 });
    const stored = await getDocFromServer(doc(first.db, 'users', uid, 'planner', 'main'));
    assert.deepEqual(stored.data().data, expected);

    await first.backend.logout();
    assert.equal(first.auth.currentUser, null);
    await signInWithCredential(first.auth, GoogleAuthProvider.credential(unsignedGoogleToken(otherSubject)));
    assert.equal(first.auth.currentUser.uid, otherUid);
    assert.deepEqual(await first.backend.load(otherUid), { data: otherData, revision: 1 });
    await assert.rejects(first.backend.load(uid), { code: 'permission-denied' });
    await first.backend.logout();
    await signInWithCredential(first.auth, GoogleAuthProvider.credential(unsignedGoogleToken(ownerSubject)));
    assert.equal(first.auth.currentUser.uid, uid);
    assert.deepEqual(await first.backend.load(uid), { data: expected, revision: 2 });

    const newDevice = await makeClient(ownerSubject);
    assert.notEqual(newDevice.db, first.db);
    assert.deepEqual(await newDevice.backend.load(uid), { data: expected, revision: 2 });
    assert.deepEqual(await other.backend.load(otherUid), { data: otherData, revision: 1 });
  });

  it('repairs missing subject categories consistently across SDK instances and saves the same IDs and colors', async () => {
    const subject = `google-subject-migration-${runId}`;
    const first = await makeClient(subject);
    const second = await makeClient(subject);
    const uid = first.auth.currentUser.uid;
    const existing = { id: 'existing-math', label: '수학', color: '#123456' };
    const unsynced = {
      ...createEmptyState(),
      subjects: [...DEFAULT_SUBJECTS, '독서'],
      categories: [...DEFAULT_EVENT_CATEGORIES, existing],
      hiddenCategoryIds: [existing.id],
    };
    const reference = doc(first.db, 'users', uid, 'planner', 'main');
    await setDoc(reference, record(uid, 1, unsynced));
    const expected = syncSubjectCategories(unsynced);
    const firstRead = await first.backend.load(uid);
    const secondRead = await second.backend.load(uid);
    assert.deepEqual(firstRead, { data: expected, revision: 1 });
    assert.deepEqual(secondRead, firstRead);
    assert.equal(expected.categories.length, DEFAULT_EVENT_CATEGORIES.length + expected.subjects.length);
    assert.deepEqual(expected.categories.find((category) => category.label === '수학'), existing);
    for (const name of expected.subjects) {
      assert.equal(expected.categories.filter((category) => category.label === name).length, 1);
    }
    await first.backend.save(uid, firstRead.data, firstRead.revision);
    await second.backend.logout();
    await signInWithCredential(second.auth, GoogleAuthProvider.credential(unsignedGoogleToken(subject)));
    assert.deepEqual(await second.backend.load(uid), { data: expected, revision: 2 });
    assert.deepEqual((await getDocFromServer(reference)).data().data, expected);
  });

  it('restores category transfers and deleting the last category on another device', async () => {
    const subject = `google-categories-${runId}`;
    const first = await makeClient(subject);
    const uid = first.auth.currentUser.uid;
    const original = { ...completePlanner(), subjects: [], goals: [] };
    await first.backend.save(uid, original, 0);
    const moved = removeCategory(original, 'custom-reading', 'school');
    await first.backend.save(uid, moved, 1);
    const second = await makeClient(subject);
    assert.deepEqual(await second.backend.load(uid), { data: moved, revision: 2 });
    const empty = moved.categories.reduce((data, item) => removeCategory(data, item.id), moved);
    await second.backend.save(uid, empty, 2);
    await first.backend.logout();
    await signInWithCredential(first.auth, GoogleAuthProvider.credential(unsignedGoogleToken(subject)));
    assert.deepEqual(await first.backend.load(uid), { data: empty, revision: 3 });
    assert.deepEqual(empty.categories, []);
    assert.deepEqual(empty.events, []);
    assert.deepEqual(empty.hiddenCategoryIds, []);
    assert.deepEqual(empty.goals, original.goals);
  });

  it('restores all planner data after Google logout and login to the same account', async () => {
    const subject = `google-persist-${runId}`;
    const client = await makeClient(subject);
    const uid = client.auth.currentUser.uid;
    assert.equal(client.auth.currentUser.providerData[0].providerId, 'google.com');
    assert.equal(await client.backend.load(uid), null);
    const data = completePlanner();
    assert.deepEqual(await client.backend.save(uid, data, 0), { data, revision: 1 });
    await client.backend.logout();
    assert.equal(client.auth.currentUser, null);
    await assert.rejects(client.backend.load(uid), { code: 'permission-denied' });
    await signInWithCredential(client.auth, GoogleAuthProvider.credential(unsignedGoogleToken(subject)));
    assert.equal(client.auth.currentUser.uid, uid);
    assert.deepEqual(await client.backend.load(uid), { data, revision: 1 });
  });

  it('restores a moved occurrence and deleted occurrences after relogin and on another device', async () => {
    const subject = `google-occurrences-${runId}`;
    const client = await makeClient(subject);
    const uid = client.auth.currentUser.uid;
    const original = completePlanner();
    await client.backend.save(uid, original, 0);
    const series = original.events[0];
    const edited = saveEvent(original.events, { ...series, title: '이번 모임만 변경', date: '2026-10-20', startTime: '19:00', endTime: '20:30' }, { eventId: series.id, date: '2026-10-19' });
    const data = { ...original, events: deleteEvent(edited, series.id, '2026-10-21') };
    assert.deepEqual(data.events[0].excludedDates, ['2026-10-07', '2026-10-19', '2026-10-21']);
    await client.backend.save(uid, data, 1);
    const stored = await getDocFromServer(doc(client.db, 'users', uid, 'planner', 'main'));
    assert.deepEqual(stored.data().data, data);
    await client.backend.logout();
    await signInWithCredential(client.auth, GoogleAuthProvider.credential(unsignedGoogleToken(subject)));
    assert.deepEqual(await client.backend.load(uid), { data, revision: 2 });

    const second = await makeClient(subject);
    const restored = await second.backend.load(uid);
    assert.deepEqual(restored, { data, revision: 2 });
    for (const date of ['2026-10-07', '2026-10-19', '2026-10-21']) {
      assert.equal(occursOn(restored.data.events[0], date), false);
    }
    assert.equal(occursOn(restored.data.events[0], '2026-11-02'), true);
    assert.equal(occursOn(restored.data.events[1], '2026-10-20'), true);
    assert.equal(restored.data.events[1].recurrence, 'none');
    assert.notEqual(restored.data.events[1].id, series.id);
  });

  it('restores the server planner into an independent SDK instance with an empty memory cache', async () => {
    const subject = `google-device-${runId}`;
    const first = await makeClient(subject);
    const uid = first.auth.currentUser.uid;
    const data = completePlanner();
    await first.backend.save(uid, data, 0);
    await first.backend.logout();
    const second = await makeClient(subject);
    assert.notEqual(first.db, second.db);
    assert.equal(second.auth.currentUser.uid, uid);
    assert.deepEqual(await second.backend.load(uid), { data, revision: 1 });
  });

  it('syncs print preferences across relogin and devices while keeping another account isolated', async () => {
    const subject = `google-print-range-${runId}`;
    const otherSubject = `google-print-range-other-${runId}`;
    const first = await makeClient(subject);
    const uid = first.auth.currentUser.uid;
    const other = await makeClient(otherSubject);
    const otherUid = other.auth.currentUser.uid;
    const original = completePlanner();
    const otherData = { ...completePlanner(), calendarPrintRange: { startMinute: 600, endMinute: 1200 } };
    await first.backend.save(uid, original, 0);
    await other.backend.save(otherUid, otherData, 0);
    const updated = { ...original, calendarPrintRange: { startMinute: 420, endMinute: 1440 } };
    assert.deepEqual(await first.backend.save(uid, updated, 1), { data: updated, revision: 2 });
    assert.deepEqual((await getDocFromServer(doc(first.db, 'users', uid, 'planner', 'main'))).data().data, updated);

    await first.backend.logout();
    await signInWithCredential(first.auth, GoogleAuthProvider.credential(unsignedGoogleToken(otherSubject)));
    assert.equal(first.auth.currentUser.uid, otherUid);
    assert.deepEqual(await first.backend.load(otherUid), { data: otherData, revision: 1 });
    await assert.rejects(first.backend.load(uid), { code: 'permission-denied' });
    await first.backend.logout();
    await signInWithCredential(first.auth, GoogleAuthProvider.credential(unsignedGoogleToken(subject)));
    assert.deepEqual(await first.backend.load(uid), { data: updated, revision: 2 });
    const second = await makeClient(subject);
    assert.notEqual(second.db, first.db);
    assert.deepEqual(await second.backend.load(uid), { data: updated, revision: 2 });
    assert.deepEqual(await other.backend.load(otherUid), { data: otherData, revision: 1 });
  });

  it('detects stale revisions without overwriting the newer server planner', async () => {
    const subject = `google-conflict-${runId}`;
    const first = await makeClient(subject);
    const second = await makeClient(subject);
    const uid = first.auth.currentUser.uid;
    await first.backend.save(uid, completePlanner(), 0);
    const stale = await second.backend.load(uid);
    const latest = completePlanner();
    latest.goals[0].range = '수열 21–40번';
    await first.backend.save(uid, latest, 1);
    stale.data.goals[0].range = '오래된 창의 수정';
    await assert.rejects(second.backend.save(uid, stale.data, stale.revision), { code: 'cloud/conflict' });
    await assert.rejects(second.backend.save(uid, completePlanner(), 0), { code: 'cloud/conflict' });
    assert.deepEqual(await second.backend.load(uid), { data: latest, revision: 2 });
  });

  it('isolates two real Auth emulator accounts at both adapter and security-rule levels', async () => {
    const first = await makeClient(`google-owner-${runId}`);
    const second = await makeClient(`google-other-${runId}`);
    const ownerUid = first.auth.currentUser.uid;
    const otherUid = second.auth.currentUser.uid;
    assert.notEqual(ownerUid, otherUid);
    await first.backend.save(ownerUid, completePlanner(), 0);
    assert.equal(await second.backend.load(otherUid), null);
    await assert.rejects(second.backend.load(ownerUid), { code: 'permission-denied' });
    await assert.rejects(second.backend.save(ownerUid, completePlanner(), 1), { code: 'permission-denied' });
    const foreignReference = doc(second.db, 'users', ownerUid, 'planner', 'main');
    await assertFails(getDocFromServer(foreignReference));
    await assertFails(setDoc(foreignReference, record(ownerUid, 2)));
    assert.equal((await first.backend.load(ownerUid)).revision, 1);
  });
});
