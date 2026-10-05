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
import { removeCategory } from '../src/lib/categories.ts';

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
  data.events.push({
    id: 'custom-repeating-event', title: '함께 읽기', type: 'custom-reading', date: '2026-10-05',
    startTime: '17:00', endTime: '18:00', allDay: false, recurrence: 'custom', weekdays: [1, 3],
    customRecurrence: { interval: 2, unit: 'week', weekdays: [1, 3], monthPattern: 'dayOfMonth', end: { type: 'count', count: 10 } },
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
      { isDemo: 'false' }, { hiddenCategoryIds: {} }, { activityHours: {} },
    ]) {
      await assertFails(setDoc(reference, record('owner', 2, { ...completePlanner(), ...change })));
    }
  });

  it('allows zero categories only when no schedules remain', async () => {
    const reference = await seedOwner();
    const data = { ...completePlanner(), categories: [], events: [], hiddenCategoryIds: [] };
    await assertSucceeds(setDoc(reference, record('owner', 2, data)));
    assert.deepEqual((await getDocFromServer(reference)).data().data, data);
    await assertFails(setDoc(reference, record('owner', 3, { ...data, events: completePlanner().events })));
  });

  it('restores category transfers and deleting the last category on another device', async () => {
    const subject = `google-categories-${runId}`;
    const first = await makeClient(subject);
    const uid = first.auth.currentUser.uid;
    const original = completePlanner();
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
