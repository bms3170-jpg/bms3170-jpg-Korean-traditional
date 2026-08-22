철원민통선한과 공식 홈페이지 + 예약판매 시스템

고객용:
- / 공식 홈페이지
- /about/ 소개
- /products/ 상품
- /guide/ 이용안내
- /order/ 예약주문
- /lookup/ 주문조회
고객 화면에는 관리자 링크가 없습니다.

관리:
- /owner-app/ 실제 운영자 2명용. Galaxy Chrome에서 홈 화면에 추가하면 설치형 PWA로 사용 가능
- /maintenance/ 유지보수용 웹. 평소 주문관리가 아니라 오류/설정 점검용

지금 해야 할 일
1. Supabase SQL Editor에서 sql/UPGRADE_EXISTING_PROJECT.sql 전체 실행
2. 현재 유지보수 계정을 maintenance로 바꾸려면:
   update public.admin_users set role='maintenance'
   where user_id='5306bd32-2771-490a-ae85-7ed6a81bbdc5';
3. 실제 운영자 2명을 Authentication > Users에서 새로 생성
4. 각 UID를 owner로 등록:
   insert into public.admin_users(user_id,role,display_name)
   values('운영자1_UUID','owner','운영자1');
   insert into public.admin_users(user_id,role,display_name)
   values('운영자2_UUID','owner','운영자2');
5. /owner-app/에서 실제 은행, 계좌번호, 예금주, 전화번호, 예약기간, 배송비, 가격, 재고 입력
6. ZIP을 풀어 GitHub 저장소 최상단에 폴더 구조 그대로 업로드
7. GitHub Pages에서 고객 홈페이지, 주문, 주문조회 테스트
8. Galaxy 운영자 2명은 /owner-app/ 접속 > Chrome 메뉴 > 홈 화면에 추가/앱 설치
9. SMS 실제 발송은 문자 업체 API가 필요함. notification_outbox까지는 자동 생성됨.
10. 관리자 푸시는 FCM 등 푸시서비스 키가 필요함. 설정 후 supabase/functions/dispatch-notifications를 연결.
11. privacy/와 terms/는 기본 문구이므로 실제 사업자/개인정보/환불 규정에 맞게 공개 전 최종 검토.

중요
- supabase-config.js의 publishable key는 브라우저용
- Secret/service_role/SMS/FCM 비밀키는 GitHub에 절대 업로드 금지
- 사진은 assets/1.JPG ~ assets/9.JPG 로 지정한 순서 그대로 포함
- 실제 .APK 직접배포는 Android 앱 서명/빌드가 별도 필요. 지금 owner-app은 Galaxy에 설치 가능한 PWA 버전

공개 전 필수 테스트
- 픽업 주문
- 배송 주문
- 주문 성공 알림
- 주문조회
- 마지막 재고 동시주문
- 주문 취소 후 재고 복구
- 입금확인
- 배송중+송장
- 픽업준비완료
- 환불대기/환불완료
- 예약판매 즉시 종료/해제
- owner 2명 로그인
- maintenance 로그인
- iPhone Safari / Galaxy Chrome
