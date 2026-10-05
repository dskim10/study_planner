import { getApps, initializeApp } from 'firebase/app';
import type { FirebaseOptions } from 'firebase/app';
import {
  browserLocalPersistence, browserPopupRedirectResolver, connectAuthEmulator,
  getAuth, GoogleAuthProvider, initializeAuth, onAuthStateChanged, signInWithPopup, signOut,
} from 'firebase/auth';
import type { Auth } from 'firebase/auth';
import {
  connectFirestoreEmulator, doc, getDocFromServer, getFirestore, initializeFirestore,
  memoryLocalCache, runTransaction, serverTimestamp, Timestamp,
} from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { CloudError } from './cloud';
import type { FirebaseConnection, PlannerBackend, RemotePlanner } from './cloud';
import { readPlannerState } from './storage';
import type { PlannerState } from '../types';

const MAX_PLANNER_BYTES = 900_000;
const APP_NAME = 'rocky-web';
let connection: FirebaseConnection | undefined;

function assertOwner(auth: Auth, uid: string): void {
  if (!uid || uid.includes('/') || auth.currentUser?.uid !== uid) {
    throw new CloudError('permission-denied', '현재 로그인한 계정의 데이터만 사용할 수 있습니다.');
  }
}

function readRemote(value: unknown, uid: string): RemotePlanner {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CloudError('cloud/invalid-data', '저장된 플래너 형식이 올바르지 않습니다.');
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  const data = readPlannerState(record.data);
  if (
    keys.length !== 4 || !keys.every(key => ['ownerId', 'revision', 'data', 'updatedAt'].includes(key)) ||
    record.ownerId !== uid || !Number.isSafeInteger(record.revision) || (record.revision as number) < 1 ||
    !(record.updatedAt instanceof Timestamp) || !data
  ) {
    throw new CloudError('cloud/invalid-data', '저장된 플래너 형식이 올바르지 않습니다.');
  }
  return { data, revision: record.revision as number };
}

function prepareData(value: PlannerState): PlannerState {
  const validated = readPlannerState(value);
  if (!validated) throw new CloudError('cloud/invalid-data', '저장할 플래너 형식이 올바르지 않습니다.');
  // Firestore rejects undefined fields. JSON also takes a snapshot so edits made
  // during an in-flight save cannot change the transaction's payload.
  let serialized: string;
  try {
    serialized = JSON.stringify(validated);
  } catch {
    throw new CloudError('cloud/invalid-data', '저장할 플래너를 변환하지 못했습니다.');
  }
  if (new TextEncoder().encode(serialized).byteLength > MAX_PLANNER_BYTES) {
    throw new CloudError('cloud/too-large', '플래너가 저장 가능한 크기를 초과했습니다.');
  }
  const data = readPlannerState(JSON.parse(serialized));
  if (!data) throw new CloudError('cloud/invalid-data', '저장할 플래너 형식이 올바르지 않습니다.');
  return data;
}

/** Accept explicit SDK instances so the same adapter can be tested against emulators. */
export function createFirebaseBackend(auth: Auth, db: Firestore): PlannerBackend {
  return {
    observeAuth(next, error) {
      return onAuthStateChanged(auth, user => next(user ? {
        uid: user.uid, displayName: user.displayName, email: user.email, photoURL: user.photoURL,
      } : null), error);
    },
    async login() {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      // Start the popup directly in the click handler; do not await persistence first.
      await signInWithPopup(auth, provider, browserPopupRedirectResolver);
    },
    async logout() {
      // Signing out changes only authentication. It never removes the planner.
      await signOut(auth);
    },
    async load(uid) {
      assertOwner(auth, uid);
      const snapshot = await getDocFromServer(doc(db, 'users', uid, 'planner', 'main'));
      assertOwner(auth, uid);
      return snapshot.exists() ? readRemote(snapshot.data(), uid) : null;
    },
    async save(uid, value, expectedRevision) {
      assertOwner(auth, uid);
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision >= Number.MAX_SAFE_INTEGER) {
        throw new CloudError('cloud/invalid-data', '저장 버전이 올바르지 않습니다.');
      }
      const data = prepareData(value);
      const reference = doc(db, 'users', uid, 'planner', 'main');
      const result = await runTransaction(db, async transaction => {
        assertOwner(auth, uid);
        const snapshot = await transaction.get(reference);
        assertOwner(auth, uid);
        const current = snapshot.exists() ? readRemote(snapshot.data(), uid) : null;
        if ((current?.revision ?? 0) !== expectedRevision) {
          throw new CloudError('cloud/conflict', '다른 기기에서 플래너가 변경되었습니다.');
        }
        const revision = expectedRevision + 1;
        transaction.set(reference, { ownerId: uid, revision, data, updatedAt: serverTimestamp() });
        return { data, revision };
      });
      assertOwner(auth, uid);
      return result;
    },
  };
}

function unavailable(message: string): FirebaseConnection {
  return { backend: null, configurationError: message, emulator: false };
}

/** Initialization is lazy and synchronous; missing setup leaves guest mode available. */
export function getFirebaseConnection(): FirebaseConnection {
  if (connection) return connection;
  const env = import.meta.env;
  const emulatorRequested = env.VITE_FIREBASE_USE_EMULATORS === 'true';
  const projectId = env.VITE_FIREBASE_PROJECT_ID?.trim();
  if (emulatorRequested && (!env.DEV || projectId !== 'demo-rocky')) {
    return connection = unavailable('Firebase 에뮬레이터는 개발 모드의 demo-rocky 프로젝트에서만 사용할 수 있습니다.');
  }
  if (!emulatorRequested && projectId?.startsWith('demo-')) {
    return connection = unavailable('데모 프로젝트는 로컬 Firebase 에뮬레이터와 함께 사용해 주세요.');
  }
  const options: FirebaseOptions = emulatorRequested ? {
    apiKey: 'demo-rocky-local-key', authDomain: 'demo-rocky.firebaseapp.com',
    projectId: 'demo-rocky', appId: 'demo-rocky-web',
  } : {
    apiKey: env.VITE_FIREBASE_API_KEY?.trim(), authDomain: env.VITE_FIREBASE_AUTH_DOMAIN?.trim(),
    projectId, appId: env.VITE_FIREBASE_APP_ID?.trim(),
    ...(env.VITE_FIREBASE_STORAGE_BUCKET?.trim() ? { storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET.trim() } : {}),
    ...(env.VITE_FIREBASE_MESSAGING_SENDER_ID?.trim() ? { messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID.trim() } : {}),
  };
  if (!options.apiKey || !options.authDomain || !options.projectId || !options.appId) {
    return connection = unavailable('Google 로그인 준비 중입니다. Firebase 프로젝트를 만든 뒤 .env.local에 웹 앱 설정을 입력해 주세요.');
  }
  try {
    const existing = getApps().find(app => app.name === APP_NAME);
    if (existing && (['apiKey', 'authDomain', 'projectId', 'appId'] as const).some(key => existing.options[key] !== options[key])) {
      return connection = unavailable('Firebase 설정이 변경되었습니다. 페이지를 새로고침해 주세요.');
    }
    const app = existing ?? initializeApp(options, APP_NAME);
    const auth = existing ? getAuth(app) : initializeAuth(app, { persistence: browserLocalPersistence });
    if (existing && Boolean(auth.emulatorConfig) !== emulatorRequested) {
      return connection = unavailable('Firebase 실행 모드가 변경되었습니다. 페이지를 새로고침해 주세요.');
    }
    auth.languageCode = 'ko';
    // Keep account data out of a shared disk cache. All loads request the server.
    const db = existing ? getFirestore(app) : initializeFirestore(app, { localCache: memoryLocalCache() });
    if (emulatorRequested && !existing) {
      connectAuthEmulator(auth, 'http://127.0.0.1:9099');
      connectFirestoreEmulator(db, '127.0.0.1', 8080);
    }
    return connection = { backend: createFirebaseBackend(auth, db), configurationError: '', emulator: emulatorRequested };
  } catch {
    return connection = unavailable('Firebase를 시작하지 못했습니다. .env.local의 웹 앱 설정을 확인한 뒤 개발 서버를 다시 시작해 주세요.');
  }
}
