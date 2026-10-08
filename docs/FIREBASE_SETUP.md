# Eddie Firebase 연결 안내

2026-10-06 기준 실제 Firebase 프로젝트 연결, 백엔드 및 Firebase Hosting 배포를 완료했습니다.

| 항목 | 연결 상태 |
| --- | --- |
| Firebase 프로젝트 | [`rocky-study-planner-6c82f1`](https://console.firebase.google.com/project/rocky-study-planner-6c82f1/overview) |
| Hosting | [Eddie 앱](https://eddie-planner.web.app), 사이트 `eddie-planner` · 배포 대상 `rocky` |
| 웹 앱 ID | `1:1046063414578:web:6d37dadc38baebc435ab2b` |
| Firestore | `(default)`, Standard edition, 서울 `asia-northeast3` |
| 인증 | Google 공급자 활성화, `localhost`·`127.0.0.1`·프로젝트 기본 도메인·새 Hosting 도메인 승인 |
| 보안 규칙·인덱스 | 이 저장소의 설정 배포 완료 |
| 현재 작업 폴더 | `.env.local`에 실제 웹 앱 설정 적용 |

이 작업에서 결제 계정은 연결하지 않았습니다. 실제 Google 로그인 화면으로 이동하는 것까지 확인했으며, 사용자의 실제 계정으로 로그인 완료 후 저장·로그아웃·복원하는 최종 확인은 남아 있습니다. 단위 테스트, 브라우저 테스트, 실제 로컬 Firebase SDK·보안 규칙 테스트 및 계정 브라우저 테스트를 통과했습니다.

`.env.local`은 Git에서 제외되어 있으므로 새로 복제한 작업 폴더에는 포함되지 않습니다. 기존 프로젝트를 계속 사용하려면 Console에서 웹 앱 설정을 복사해 환경 파일을 준비하면 됩니다. 아래는 다른 Firebase 프로젝트를 새로 연결할 때도 사용할 수 있는 전체 절차입니다. 설정이 없으면 게스트 모드가 유지되며, 로컬 에뮬레이터는 실제 프로젝트 없이 실행할 수 있습니다.

## 새 프로젝트와 웹 앱 만들기

1. [Firebase Console](https://console.firebase.google.com/)에 로그인하고 새 프로젝트를 만듭니다. 프로젝트 이름은 `Eddie` 등으로 정하고 **프로젝트 ID**를 기록합니다. Google Analytics는 현재 앱 기능에 필요하지 않으므로 선택 사항입니다.
2. 프로젝트 개요에서 웹 앱 아이콘 `</>`을 선택하고 `Eddie Web` 등의 이름으로 등록합니다.
3. 프로젝트 설정 → 일반 → 내 앱 → 웹 앱의 **SDK 설정 및 구성**에서 `firebaseConfig`를 확인합니다. 여기에 표시된 `apiKey`, `authDomain`, `projectId`, `appId`를 사용합니다. [Firebase 웹 앱 등록 안내](https://firebase.google.com/docs/web/setup)

프로젝트 폴더에서 예시 환경 파일을 복사합니다. 이미 `.env.local`이 있다면 필요한 항목만 편집합니다.

```powershell
Copy-Item .env.example .env.local
```

`.env.local`의 네 필수 값을 Console에서 복사한 값으로 채웁니다.

```dotenv
VITE_FIREBASE_API_KEY=웹_앱의_apiKey
VITE_FIREBASE_AUTH_DOMAIN=웹_앱의_authDomain
VITE_FIREBASE_PROJECT_ID=웹_앱의_projectId
VITE_FIREBASE_APP_ID=웹_앱의_appId
VITE_FIREBASE_USE_EMULATORS=false
```

`VITE_FIREBASE_STORAGE_BUCKET`과 `VITE_FIREBASE_MESSAGING_SENDER_ID`는 선택 항목입니다. 현재 플래너 저장에 Cloud Storage나 메시징을 사용하지 않습니다. 환경 파일을 바꾼 뒤에는 개발 서버를 재시작해야 합니다. 배포용 빌드를 만들 때도 같은 웹 설정을 빌드 환경에 제공해야 합니다.

Firebase 웹 `apiKey`는 클라이언트에서 공개되는 프로젝트 설정입니다. 데이터 접근은 인증과 Firestore 보안 규칙으로 제한합니다. `.env.local`은 Git에서 제외되어 있으며, **서비스 계정 JSON 키나 비공개 키를 앱·환경 파일에 넣을 필요가 없습니다.** [Firebase API 키 설명](https://firebase.google.com/docs/projects/api-keys)

## Google 로그인 활성화

1. Console의 **Authentication → 로그인 방법(Sign-in method)**에서 **Google** 공급자를 선택해 활성화합니다.
2. 프로젝트 지원 이메일을 선택하고 저장합니다.
3. **Authentication → 설정 → 승인된 도메인(Authorized domains)**에서 개발에 사용하는 `localhost`와 `127.0.0.1`을 등록합니다. 실제 사이트를 배포하면 그 사이트의 도메인도 등록합니다. 도메인에는 `http://`나 포트를 넣지 않습니다.

새 프로젝트에서는 `localhost`가 기본 승인 목록에 없을 수 있으므로 직접 확인합니다. 앱은 Google 계정 선택 팝업을 사용하며 Google Calendar 접근 권한은 요청하지 않습니다. [Google 로그인 설정](https://firebase.google.com/docs/auth/web/google-signin), [승인 도메인 관련 안내](https://firebase.google.com/docs/auth/faq-and-troubleshooting)

### 선택 사항: CLI로 Google 공급자 설정

Firebase CLI로도 Google 로그인 공급자를 준비할 수 있습니다. 이 프로젝트의 실제 연결에는 이 방식을 사용했습니다. 기존 `firebase.json`을 `firebase.local.json`으로 복사하고 기존 Firestore·에뮬레이터 설정을 유지한 채 다음 `auth` 항목을 추가합니다. 지원 이메일은 Firebase 프로젝트를 관리하는 계정의 이메일로 바꿉니다.

```json
{
  "auth": {
    "providers": {
      "googleSignIn": {
        "oAuthBrandDisplayName": "Eddie",
        "supportEmail": "프로젝트_관리자_이메일",
        "authorizedRedirectUris": []
      }
    }
  }
}
```

위 JSON은 추가할 항목의 예시입니다. `firebase.local.json`은 지원 이메일이 소스에 포함되지 않도록 Git에서 제외합니다. Firebase가 프로젝트의 기본 인증 콜백 URI를 자동으로 추가하므로 `authorizedRedirectUris`는 빈 배열로 두며, 기본 `firebaseapp.com/__/auth/handler` URI를 중복해서 넣지 않습니다.

```sh
npx firebase login
npx firebase deploy --only auth --config firebase.local.json --project YOUR_PROJECT_ID
```

CLI가 OAuth 브랜드와 Google 공급자 설정을 준비하므로 클라이언트 비밀키를 앱에 넣을 필요가 없습니다. 승인 도메인 목록은 앞의 Console 설정에서 별도로 확인합니다. [공식 CLI 인증 공급자 설정 안내](https://firebase.google.com/docs/auth/configure-providers-cli)

## Firestore 만들고 보안 규칙 배포

1. Console의 **Firestore Database → 데이터베이스 만들기**에서 Cloud Firestore **Standard edition** 데이터베이스를 만듭니다. 데이터베이스 ID는 **`(default)`**를 사용합니다.
2. 보안 규칙은 **프로덕션 모드**로 시작합니다.
3. 데이터베이스 위치는 사용자와 가까운 아시아 지역 등을 검토하여 직접 선택합니다. 선택한 위치는 이후 변경할 수 없으므로 생성 전에 확인합니다. [Firestore 시작 안내](https://firebase.google.com/docs/firestore/quickstart)

프로젝트 폴더에서 Firebase CLI에 로그인한 뒤 이 저장소의 규칙과 인덱스 설정을 배포합니다. `YOUR_PROJECT_ID`를 새 프로젝트의 실제 ID로 바꿉니다.

```sh
npx firebase login
npx firebase deploy --only firestore --project YOUR_PROJECT_ID
```

이 명령은 `firebase.json`에 지정된 `firestore.rules`와 `firestore.indexes.json`을 사용합니다. `firebase init`으로 기존 설정을 다시 만들 필요는 없습니다. 규칙이 배포되면 로그인한 사용자만 자신의 플래너를 읽고 저장할 수 있습니다. 이 명령은 웹 사이트나 Google 로그인 공급자 설정을 배포하지 않으므로 앞 단계도 완료해야 합니다. [보안 규칙 배포 안내](https://firebase.google.com/docs/firestore/security/get-started)

## Firebase Hosting 배포

2026-10-09 후속 배포(`a13f7f5e694b5f0b`)로 인쇄 표의 별도 완료 열을 제거하고 각 학습 범위 텍스트 앞에 완료 체크박스를 배치했습니다. 과목·학습 자료·학습 범위의 세 열, 기존 완료 상태와 과목 셀 병합을 유지합니다. 운영 빌드와 인쇄 브라우저 테스트 4개가 통과했고, 공개 주소의 PC·모바일 미리보기와 실제 A4 PDF 3장에서 체크박스 위치·원본 보존·페이지 분할 및 Google 로그인 팝업의 Firebase 인증 핸들러 연결을 확인했습니다. Hosting만 갱신했습니다.

2026-10-09 후속 배포(`a3c91bec8ace4adc`)로 인쇄 표의 같은 과목 셀을 페이지 안에서 세로로 병합하고 과목명을 중앙에 표시했습니다. 과목이 다음 장에 이어지면 새 병합 셀에 과목명을 다시 표시하며, 완료 체크 칸·학습 자료·학습 범위는 목표별로 유지합니다. 단위 테스트 195개와 인쇄·과목 순서 브라우저 테스트 8개가 통과했습니다. 긴 과목명·여러 페이지의 병합 경계·실제 A4 PDF의 누락과 빈 페이지 여부를 검증했고, 공개 주소에서도 가상 목표 36개의 PC·모바일 미리보기 및 PDF 3장, 저장 자료 보존과 Google 로그인 팝업의 Firebase 인증 핸들러 연결을 확인했습니다. Hosting만 갱신했습니다.

2026-10-09 후속 배포(`1e232d50134b551a`)로 ‘이번 주 학습 목표’의 과목 카드 순서 이동을 추가했습니다. 손잡이를 마우스·터치로 끌거나 키보드로 이동하며 확정할 때만 공통 `subjects` 순서를 저장합니다. 모든 주의 카드·과목 선택·인쇄 순서에 반영하고 필터로 숨긴 과목과 목표·일정·종류·시간 계산을 보존합니다. 단위 테스트 195개, 전체 브라우저 테스트 45개, Firebase 에뮬레이터 통합 테스트 23개와 계정 UI 테스트 3개가 통과했습니다. 공개 주소에서 PC 드래그·키보드 이동·취소, 모바일 터치 드래그, 새로고침 복원과 인쇄 순서 및 Google 로그인 팝업의 Firebase 인증 핸들러 연결을 가상 게스트 자료로 확인했습니다. 계정 전환·재로그인·새 기기의 순서 복원은 에뮬레이터에서 검증했으며, 데이터 형식·보안 규칙 변경 없이 Hosting만 갱신했습니다.

2026-10-09 후속 배포(`13f17cf8e518fabd`)로 ‘이번 주 학습 목표’의 A4 인쇄 미리보기를 추가했습니다. 선택한 주의 전체 목표를 과목별로 묶어 완료 체크 칸·과목·학습 자료·학습 범위를 출력하며, ‘인쇄하기’를 눌렀을 때만 브라우저 인쇄 창을 엽니다. 단위 테스트 189개와 전체 브라우저 테스트 41개가 통과했고, 미리보기 스크롤 조정 후 인쇄 검사 3개를 다시 통과했습니다. 최대 길이의 가상 목표 60개를 실제 A4 PDF 15장으로 내보내 누락·중복·빈 페이지가 없음을 검증했습니다. 공개 주소에서도 가상 목표 36개의 PC·모바일 미리보기와 A4 PDF 3장, 저장 데이터 보존, 명시적 인쇄 호출, Google 로그인 팝업의 Firebase 인증 핸들러 HTTP 200 연결을 확인했습니다. 실제 프린터 출력이나 운영 계정 로그인·데이터 변경은 수행하지 않았으며, 데이터 형식·보안 규칙 변경 없이 Hosting만 갱신했습니다.

2026-10-09 후속 배포(`84ab50ef96b7d19c`)로 주간 시간표의 15분 단위 클릭·드래그 입력과 ‘(제목 없음)’ 시간 구간 미리보기를 반영하고 시간별 호버 + 표시를 제거했습니다. 단위 테스트 180개와 전체 브라우저 테스트 38개가 통과했습니다. 최종 취소 처리 보완 후 클릭·드래그·경계·취소·키보드 검사를 다시 통과했으며, 모바일 검사는 관성 스크롤 종료를 기다리도록 수정한 뒤 3회 반복 통과했습니다. 공개 주소에서 09:37 클릭→09:30 시작, 18:30–20:30 드래그 미리보기·저장·새로고침 복원, Escape 취소, 모바일 탭과 Google 로그인 입력 화면 연결을 가상 게스트 자료로 확인했습니다. 데이터 형식·보안 규칙 변경 없이 Hosting만 갱신했습니다.

2026-10-09 배포(`d1f8cbf323e03ca9`)로 일정 종류의 점 세 개 옵션 메뉴와 색상 변경을 반영했습니다. 과목에 연결된 종류도 색상은 바꿀 수 있고, 삭제 항목은 일반 종류에만 표시됩니다. 단위 테스트 175개, 브라우저 테스트 33개, Firebase 통합 테스트 22개와 계정 UI 테스트 3개가 통과했습니다. 공개 주소에서 PC·모바일 팔레트·사용자 지정 색상, 삭제 제한·취소, 새로고침 복원·월간 색상 반영과 Google 로그인 입력 화면 연결을 가상 게스트 자료로 확인했습니다. 계정의 색상 저장·새 기기 복원은 에뮬레이터에서 검증했으며, 운영 계정 데이터는 변경하지 않았습니다. 스키마와 보안 규칙 변경 없이 Hosting만 갱신했습니다.

2026-10-08 후속 배포(`d8969b856154358c`)로 현재 과목의 일정 종류 자동 생성·연결, 캘린더 종류 수정·삭제 잠금, 과목 이름 변경 시 기존 일정 보존을 반영했습니다. 단위 테스트 169개, 브라우저 테스트 30개, Firebase 통합 테스트 22개와 계정 UI 테스트 3개가 통과했습니다. 공개 주소에서 PC·모바일의 자동 연결과 잠금, 과목 추가 후 일정 선택·저장, 시간 합산·새로고침 복원, Google 로그인 입력 화면 연결을 확인했습니다. 가상 게스트 자료만 사용했고 실제 계정 자료는 변경하지 않았습니다. 기존 저장 필드를 사용하므로 이번 후속 배포에서는 Hosting만 갱신했습니다.

2026-10-08에 과목 목록을 허용하고 구버전 클라이언트의 목록 삭제를 막는 Firestore 규칙을 먼저 운영 배포한 뒤, 과목 관리·캘린더 기반 학습 시간 합산 앱을 배포했습니다. 단위 테스트 154개, 브라우저 테스트 28개, Firebase 에뮬레이터 통합 테스트 21개와 계정 UI 테스트 3개가 통과했습니다. 공개 주소에서도 PC·모바일의 전체·과목별 겹침 제외 합계, 과목 선택, 예상 시간 없는 목표 저장과 새로고침 복원, Google 로그인 입력 화면 연결을 확인했습니다. 공개 주소 검증은 격리된 브라우저의 가상 게스트 데이터로 수행했고 실제 계정 로그인·서버 데이터 변경은 하지 않았습니다.

기본 서비스 주소는 **https://eddie-planner.web.app**이며, 보조 주소 **https://eddie-planner.firebaseapp.com**에서도 같은 앱을 제공합니다. 두 호스트 모두 Authentication 승인 도메인에 등록했습니다.

앱 표시 이름은 Eddie입니다. 기존 데이터와의 호환성을 위해 Firebase 프로젝트·앱 ID, 배포 대상과 브라우저 저장 키는 유지합니다. 이번 표시 이름 변경에는 Firebase 프로젝트와 Google OAuth의 원격 표시 이름 설정 변경이 포함되지 않습니다.

Hosting 사이트 `eddie-planner`는 기존 프로젝트 `rocky-study-planner-6c82f1` 안에 있습니다. `firebase.json`의 `hosting.target`은 `rocky`이며, `.firebaserc`에서 이 대상을 사이트 `eddie-planner`로 연결합니다. 프로젝트 ID와 웹 앱, `.env.local`, 인증용 `authDomain`인 `rocky-study-planner-6c82f1.firebaseapp.com`, Firestore 데이터베이스·문서·규칙은 그대로 사용합니다. Hosting 주소가 바뀌었다고 `authDomain`을 새 사이트 이름으로 바꾸지 않습니다.

새 주소 배포 후 데스크톱·모바일에서 HTTP 200, 캘린더, 주간 계획 이동·새로고침, 모바일 가로 넘침 없음과 Google 로그인 화면 연결을 확인했습니다. 처리되지 않은 JavaScript 예외와 실패한 네트워크 요청은 없었습니다. 로그인 팝업 확인 중에는 `Cross-Origin-Opener-Policy policy would block the window.closed call.` 콘솔 메시지가 발생하여 콘솔 오류가 전혀 없음을 요구하는 자동 검사는 실패했습니다. 추가 확인에서는 Google 응답의 `Cross-Origin-Opener-Policy-Report-Only` 헤더와 실제 로그인 입력란 표시를 확인했습니다. 실제 Google 계정 선택·로그인 완료는 수행하지 않았으며 계정 저장·복원은 기존 Firebase 백엔드를 사용합니다.

웹 설정이 들어 있는 `.env.local`을 준비하고 `VITE_FIREBASE_USE_EMULATORS=false`를 확인한 뒤 배포합니다.

```sh
npx firebase deploy --only hosting:rocky --project rocky-study-planner-6c82f1
```

`firebase.json`의 Hosting 배포 전 명령이 `npm run build`를 실행합니다. TypeScript 검사와 Vite 빌드가 성공하면 `dist/` 안의 파일을 게시합니다. `.env.local`, 소스 파일, 테스트 데이터는 Hosting에 업로드하지 않습니다. 브라우저에 필요한 Firebase 웹 설정은 빌드 결과물에 포함됩니다.

Hosting은 앱 경로를 `index.html`로 연결합니다. 시작 페이지는 `no-cache`로 최신 버전을 확인하고, 파일명에 해시가 있는 `/assets/`는 장기 캐시합니다. 앱의 주간 학습 계획 주소는 `/#plan`입니다. [Firebase Hosting 설정 안내](https://firebase.google.com/docs/hosting/full-config)

이 명령은 `eddie-planner` 사이트의 웹 앱만 배포합니다. Firestore 규칙을 바꾼 경우에는 앞의 규칙 배포 명령도 별도로 실행합니다.

기존 **https://my-rocky.web.app**과 **https://my-rocky.firebaseapp.com**, 프로젝트 기본 주소인 **https://rocky-study-planner-6c82f1.web.app**과 **https://rocky-study-planner-6c82f1.firebaseapp.com**은 게스트 자료에 접근할 수 있도록 기존 배포를 그대로 유지합니다. 새 주소로 자동 리디렉션하지 않으며, 위의 `hosting:rocky` 배포 명령은 기존 사이트를 갱신하지 않습니다.

로컬·기존 Hosting·새 Hosting 주소는 각각 다른 호스트이므로 게스트 데이터와 계정 캐시를 담은 `localStorage`가 자동으로 이동하지 않습니다. 기존 주소에서 직접 작성한 게스트 플래너를 옮기려면 그 주소의 앱에서 Google 로그인 후 **브라우저 데이터 가져오기**를 선택하고 서버 저장 완료를 확인합니다. 가져오기는 계정 플래너가 비어 있을 때만 제공됩니다. 이미 로그인해 작성한 내용도 서버 저장 완료를 확인한 뒤 이동하세요. 새 주소에서 같은 Google 계정으로 로그인하면 같은 Firestore의 저장된 플래너를 불러옵니다. 로컬 앱의 자료도 같은 절차로 옮길 수 있습니다.

## 실제 연결 확인

```sh
npm run dev
```

1. `http://127.0.0.1:5173`에서 **Google 로그인 → Google로 계속하기**를 누릅니다.
2. 계정을 선택한 뒤 일정과 학습 목표를 입력하고 저장 완료 표시를 확인합니다.
3. 계정 메뉴에서 로그아웃한 뒤 같은 Google 계정으로 다시 로그인합니다. 저장한 일정·목표·일정 종류·체크 상태가 복원되는지 확인합니다.
4. 다른 브라우저나 기기에서 같은 앱과 Google 계정으로 로그인해 서버 데이터가 표시되는지 확인합니다.

새 계정은 빈 플래너를 사용합니다. 기존 게스트 데이터가 직접 작성한 내용이고 계정이 비어 있으면 **브라우저 데이터 가져오기**를 선택할 수 있습니다. 가져오기는 명시적으로 실행해야 하며 기존 게스트 데이터도 유지됩니다.

## 저장과 동기화 방식

- 과목 목록은 version 3의 선택적 `subjects` 배열로 저장합니다. 과목 목록이 없는 기존 데이터는 기본 과목과 기존 목표의 과목을 추가하며, 명시적인 빈 목록은 유지합니다. 목표의 기존 `estimatedMinutes`는 보존하되 새 목표에는 저장하지 않습니다. 계획 시간은 과목 이름과 같은 일정 종류의 캘린더 일정에서 계산합니다. 새 웹 앱을 배포하기 전에 `subjects`를 허용하는 Firestore 규칙을 먼저 배포해야 합니다.
- 서버에 `subjects`가 저장된 뒤에는 이 필드를 생략한 업데이트를 규칙에서 거부합니다. 기존 호스팅 주소나 오래 열린 구버전 탭에서 과목 목록을 지우는 저장을 방지합니다. 과목 기능을 사용한 계정은 최신 `eddie-planner.web.app`에서 계속 사용합니다.
- 과목에 해당하는 일정 종류가 없으면 앱에서 데이터를 검증한 뒤 기존 `categories` 배열에 추가합니다. 기존 이름이 일치하는 종류의 ID·색상·필터를 유지하고, 새 종류는 같은 원본에 대해 항상 동일한 ID를 사용하므로 계정 캐시와 서버 자료 비교도 일관됩니다. 별도 필드나 추가 보안 규칙은 필요하지 않습니다. 과목 이름 수정은 연결 종류와 일정에 반영하고, 과목 삭제는 종류와 일정을 남겨 일반 종류로 전환합니다.

- 게스트 데이터는 기존 `chagok-planner-v1` localStorage 키에 남습니다. 로그인하거나 로그아웃해도 다른 저장 영역으로 자동 복사하지 않습니다.
- 계정 데이터는 Firestore의 `users/{uid}/planner/main`에 저장합니다. 문서에는 `ownerId`, `revision`, `data`, `updatedAt`이 있으며 `data`는 일정·목표·종류·표시 설정을 담은 version 3 플래너입니다.
- 계정의 미저장 변경사항과 캐시는 `rocky-planner-account:{uid}`에 분리해 보관합니다. 로그아웃은 서버 데이터를 지우지 않으며, 같은 계정으로 돌아오면 남은 저장을 재시도합니다. 기기에서만 남아 있는 변경사항은 다른 기기에 아직 보이지 않으므로 저장 상태를 확인합니다.
- 서버 데이터는 로그인, 새로고침, 계정 메뉴의 **지금 동기화**에서 읽습니다. 현재 구현에는 다른 기기의 변경사항을 실시간으로 수신하는 기능이 없습니다.
- 다른 기기에서 먼저 저장했다면 리비전 충돌로 자동 저장을 멈춥니다. 현재 내용을 JSON으로 백업한 뒤 **서버 데이터 불러오기**를 선택해 최신 내용을 불러옵니다. 변경사항을 자동 병합하지 않습니다.
- Firestore의 지속 디스크 캐시는 사용하지 않습니다. 앱이 관리하는 계정별 localStorage 캐시는 별도로 남으므로, 브라우저 저장 데이터를 삭제하면 아직 서버에 저장되지 않은 변경사항은 사라질 수 있습니다.
- 플래너 전체를 한 문서로 저장하며 앱의 JSON 크기 상한은 **900,000바이트**입니다. 한도를 넘으면 오류를 표시하고 기존 서버 데이터를 유지합니다. 백업 후 오래된 일정 등을 정리할 수 있습니다.

## 로컬 에뮬레이터와 테스트

Node.js 22.12 이상, npm, **Java 21 이상**을 준비합니다. Java가 `PATH`에 있으면 바로 사용할 수 있습니다. 프로젝트 전용 런타임은 `.tools/java/<런타임 디렉터리>/bin/java` 또는 `java.exe`에 있으면 실행 스크립트가 자동으로 찾습니다. 최초 실행에는 에뮬레이터 다운로드를 위한 인터넷 연결이 필요합니다.

터미널 하나에서 Firebase 에뮬레이터를 실행합니다.

```sh
npm run emulators
```

다른 터미널에서 테스트용 앱을 실행합니다.

```sh
npm run dev:emulator
```

| 기능 | 주소 |
| --- | --- |
| Eddie 에뮬레이터 앱 | `http://127.0.0.1:5174` |
| Firebase 에뮬레이터 UI | `http://127.0.0.1:4000` |
| Authentication | `127.0.0.1:9099` |
| Firestore | `127.0.0.1:8080` |

테스트 앱의 로그인은 실제 Google OAuth 대신 로컬 테스트 계정 팝업을 표시합니다. 에뮬레이터 계정은 실제 Google 계정과 연결되지 않습니다. 앱에서도 로컬 테스트임을 표시합니다.

두 명령은 `demo-rocky` 프로젝트를 사용하며 `.env.local` 없이 실행할 수 있습니다. 에뮬레이터 모드는 개발 빌드에서만 허용합니다. 일반 앱의 5173번 주소와 분리하여 로컬 테스트의 브라우저 저장도 구분합니다. `npm run emulators`를 정상 종료하면 `.emulator-data`에 인증·Firestore 데이터를 내보내며 다음 실행에서 다시 불러옵니다.

자동 검증은 수동 에뮬레이터와 테스트용 앱을 종료한 뒤 실행합니다.

```sh
npm test
npm run test:e2e
npm run test:firebase
npm run build
```

`npm run test:firebase`는 임시 Authentication·Firestore 에뮬레이터를 시작하고 보안 규칙·SDK 통합 테스트와 계정 브라우저 테스트를 실행한 뒤 종료합니다. 수동 실행의 `.emulator-data`는 가져오거나 덮어쓰지 않습니다. 실제 Google OAuth 팝업이나 운영 프로젝트 배포를 검증하는 테스트는 아니므로, 실제 연결은 앞의 확인 절차로 별도 점검합니다. [Firebase 인증 에뮬레이터 안내](https://firebase.google.com/docs/emulator-suite/connect_auth)

## 연결이 안 될 때

| 증상 | 확인할 내용 |
| --- | --- |
| 로그인 버튼이 비활성화됨 | `.env.local`의 필수 네 값과 개발 서버 재시작 여부 |
| `auth/operation-not-allowed` | Google 공급자 활성화와 지원 이메일 저장 여부 |
| `auth/unauthorized-domain` | 현재 접속한 호스트가 승인된 도메인에 등록되어 있는지 |
| 팝업이 차단됨 | 브라우저에서 현재 사이트의 팝업 허용 여부 |
| Firestore `permission-denied` | 환경 변수와 규칙 배포의 프로젝트 ID가 같은지, `(default)` DB에 규칙을 배포했는지 |
| Java를 찾지 못하거나 버전 오류가 남 | Java 21 이상을 PATH 또는 위의 프로젝트 전용 경로에 준비했는지 |
| 에뮬레이터 포트가 사용 중임 | 수동 에뮬레이터·테스트 앱을 종료한 뒤 자동 테스트를 다시 실행 |

프로젝트 설정이나 규칙을 바꿨다면 실제 앱에서 로그인과 저장을 다시 확인합니다. 저장 실패·손상 데이터·충돌 안내가 보이면 현재 내용을 백업하고 원인을 해결한 뒤 재시도합니다.
