import { useEffect, useState } from 'react';
import { Cloud, LogOut, RefreshCw, UserRound } from 'lucide-react';
import type { usePlanner } from '../hooks/usePlanner';
import Modal from './Modal';
import './account.css';

export default function AccountMenu({ planner }: { planner: ReturnType<typeof usePlanner> }) {
  const [open, setOpen] = useState(false);
  const { account, authBusy, configured, status, error, dirty } = planner;
  useEffect(() => setOpen(false), [account?.uid]);
  const busy = authBusy || status === 'auth-loading' || status === 'loading';
  return <>
    <button type="button" className="account-trigger" onClick={() => setOpen(true)} aria-label={account ? '내 계정' : 'Google 로그인'}>
      {account ? <span className="account-initial">{(account.displayName || account.email || '나').slice(0, 1)}</span> : <UserRound size={16} />}
      <span>{account ? account.displayName || '내 계정' : 'Google 로그인'}</span>
    </button>
    {open && <Modal title={account ? '내 계정' : 'Google 계정으로 시작하기'} onClose={() => setOpen(false)}>
      <div className="modal-body account-dialog">
        {account ? <>
          <div className="account-profile"><span className="account-initial">{(account.displayName || '나').slice(0, 1)}</span><div><strong>{account.displayName || '나의 계정'}</strong><p>{account.email}</p></div></div>
          <p className="form-hint">일정과 학습 목표는 내 계정에 저장됩니다. 로그아웃해도 삭제되지 않으며, 같은 Google 계정으로 다시 로그인하면 불러올 수 있어요.</p>
          {dirty && <p className="account-notice">아직 서버에 저장하지 못한 변경사항이 있어요. 이 기기에 저장된 내용은 같은 계정으로 다시 로그인하면 동기화를 재시도합니다.</p>}
          <div className="account-actions"><button type="button" className="button button-secondary" disabled={busy || status === 'saving' || status === 'conflict'} onClick={() => void planner.retry()}><RefreshCw size={15} />지금 동기화</button><button type="button" className="button button-secondary" disabled={busy} onClick={() => void planner.logout()}><LogOut size={15} />로그아웃</button></div>
        </> : <>
          <div className="account-intro"><Cloud size={28} /><p>로그인하면 일정과 학습 목표를 계정에 보관하고, 다시 로그인하거나 다른 기기에서도 불러올 수 있어요.</p></div>
          <p className="form-hint">현재 브라우저의 데이터는 그대로 유지됩니다. 새 계정으로 로그인한 후 ‘브라우저 데이터 가져오기’를 선택해 옮길 수 있어요.</p>
          {!configured && <p className="account-notice">Google 로그인 연결을 준비 중이에요. 현재는 이 브라우저에 저장하며 사용할 수 있습니다.</p>}
          <button type="button" className="button google-login-button" disabled={!configured || busy} onClick={() => void planner.login()}><UserRound size={18} />{authBusy ? '로그인 중…' : 'Google로 계속하기'}</button>
        </>}
        {error && <p className="form-error" role="alert">{error}</p>}
        {planner.emulator && <p className="account-emulator">로컬 테스트 계정 · 실제 Google 계정과 연결되지 않습니다.</p>}
      </div>
      <div className="modal-footer"><button type="button" className="button button-secondary footer-actions" onClick={() => setOpen(false)}>닫기</button></div>
    </Modal>}
  </>;
}
