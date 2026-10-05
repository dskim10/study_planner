import type { PlannerState } from '../types';

export interface PlannerAccount {
  uid: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
}

export interface RemotePlanner {
  data: PlannerState;
  revision: number;
}

export interface PlannerBackend {
  observeAuth: (next: (account: PlannerAccount | null) => void, error: (error: unknown) => void) => () => void;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  load: (uid: string) => Promise<RemotePlanner | null>;
  /** Revision 0 creates a document only if it does not exist. */
  save: (uid: string, data: PlannerState, expectedRevision: number) => Promise<RemotePlanner>;
}

export interface FirebaseConnection {
  backend: PlannerBackend | null;
  configurationError: string;
  emulator: boolean;
}

export class CloudError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = 'CloudError'; }
}

export function cloudErrorMessage(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  switch (code) {
    case 'auth/popup-closed-by-user': case 'auth/cancelled-popup-request': return '로그인을 취소했어요. 다시 시도할 수 있어요.';
    case 'auth/popup-blocked': return '브라우저에서 팝업을 허용한 뒤 다시 로그인해 주세요.';
    case 'auth/unauthorized-domain': return '현재 앱 주소에서 로그인을 사용할 수 없어요. Firebase의 승인된 도메인 설정을 확인해 주세요.';
    case 'auth/operation-not-allowed': return 'Google 로그인이 활성화되지 않았어요. Firebase의 로그인 제공자 설정을 확인해 주세요.';
    case 'auth/network-request-failed': case 'unavailable': case 'deadline-exceeded': return '서버에 연결하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.';
    case 'permission-denied': return '계정 데이터를 읽거나 저장할 권한이 없어요. 다시 로그인하거나 Firebase 보안 규칙을 확인해 주세요.';
    case 'cloud/conflict': return '다른 창이나 기기에서 변경된 데이터가 있어요. 현재 내용을 백업하고 서버 데이터를 불러와 주세요.';
    case 'cloud/invalid-data': return '서버 데이터 형식을 확인할 수 없어 자동 저장을 멈췄어요. 현재 데이터를 백업해 주세요.';
    case 'cloud/too-large': return '저장할 데이터가 너무 많아요. 백업한 뒤 오래된 일정을 정리해 주세요.';
    default: return '계정 연결 또는 저장을 완료하지 못했어요. 잠시 후 다시 시도해 주세요.';
  }
}
