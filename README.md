# 희윤이 한국사 24주 준비보드

초4에서 초5로 올라가기 전, 한국사 수업을 위한 24주 준비용 모바일 웹앱입니다.

## 포함 기능
- 24주 한국사 커리큘럼
- 주차별 완료 체크
- 이야기 / 한자어 / 5분대화 세부 체크
- 전체 진행률 표시
- 월별 필터
- 체크 상태 자동 저장(localStorage)
- 홈 화면 추가용 PWA 설정
- 기본 오프라인 캐시

## 가장 쉬운 배포 방법

### 1. GitHub 저장소 만들기
1. GitHub에서 `New repository` 선택
2. 저장소 이름 예: `heeyoon-history`
3. `Public` 또는 `Private` 선택
4. 저장소 생성
5. 이 ZIP을 압축 해제한 뒤 파일 전체를 업로드
   - index.html
   - manifest.json
   - sw.js
   - icons 폴더
   - README.md

### 2. Vercel 배포
1. Vercel 로그인
2. `Add New` → `Project`
3. GitHub의 `heeyoon-history` 저장소 선택
4. Framework Preset은 `Other`
5. Build Command는 비워둠
6. Output Directory도 비워둠
7. Deploy 클릭

배포가 끝나면 `https://프로젝트이름.vercel.app` 형태의 주소가 생깁니다.

## 휴대폰 홈 화면에 추가

### Android / Chrome
메뉴(⋮) → `홈 화면에 추가` 또는 `앱 설치`

### iPhone / Safari
공유 버튼 → `홈 화면에 추가`

## 저장 방식
현재 버전은 체크 상태를 **각 기기의 브라우저 내부(localStorage)** 에 저장합니다.

따라서 같은 주소라도
- 아빠 휴대폰
- 아이 태블릿
- PC

의 체크 상태는 서로 다릅니다.

여러 기기에서 동일한 체크 상태를 공유하려면 다음 단계에서 Supabase를 연결하면 됩니다.
