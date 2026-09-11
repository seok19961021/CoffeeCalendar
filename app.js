'use strict';
// Safari의 저장소 제한 환경에서도 로그인 화면 자체는 정상 동작한다.
const memoryStorage = Object.create(null);
const safeStorage = {
  getItem(key) { try { return localStorage.getItem(key) || memoryStorage[key] || null; } catch (_) { return memoryStorage[key] || null; } },
  setItem(key, value) { memoryStorage[key] = String(value); try { localStorage.setItem(key, value); } catch (_) {} },
  removeItem(key) { delete memoryStorage[key]; try { localStorage.removeItem(key); } catch (_) {} }
};



/* =========================================================
   기본 변수
   ========================================================= */

const $ =
  id =>
    document.getElementById(id);


/* Coffee Member Colors */
const colors = [
  '#5D4037',
  '#8D6E63',
  '#A1887F',
  '#6D4C41',
  '#C1875A',
  '#9A6850'
];


let data = null;

let busy = false;

let selectedDay = '';

let queueDraft = [];

let loadNumber = 0;

let adminUnlocked = false;


/*
 * 개인 로그인 토큰
 * 해당 브라우저 localStorage에 저장
 */
let sessionToken =
  safeStorage.getItem(
    'coffeeSession'
  ) || '';


const initial =
  new Intl.DateTimeFormat(
    'en-CA',
    {
      timeZone:
        'Asia/Seoul',

      year:
        'numeric',

      month:
        '2-digit',

      day:
        '2-digit'
    }
  ).formatToParts(
    new Date()
  );


const part =
  t =>
    initial.find(
      p =>
        p.type === t
    ).value;


let year =
  Number(
    part('year')
  );

let month =
  Number(
    part('month')
  );


/* =========================================================
   공통 함수
   ========================================================= */

function node(
  tag,
  text,
  cls
) {

  const n =
    document.createElement(
      tag
    );

  if (
    text !== undefined
  ) {
    n.textContent =
      text;
  }

  if (cls) {
    n.className =
      cls;
  }

  return n;
}


function message(
  text,
  error = false
) {

  if ($('formMessage')) { $('formMessage').textContent = error ? text : ''; }
  $('message').textContent =
    text;

  $('message')
    .classList
    .toggle(
      'error',
      error
    );
}


function button(
  text,
  fn,
  cls = 'secondary'
) {

  const b =
    node(
      'button',
      text,
      cls
    );

  b.type =
    'button';

  b.onclick =
    fn;

  return b;
}


function name(
  id,
  day
) {

  return (
    (
      day &&
      day.names &&
      day.names[id]
    ) ||
    (
      data &&
      data.names &&
      data.names[id]
    ) ||
    '미지정'
  );
}


function names(
  ids,
  day
) {

  return (
    (ids || [])
      .map(
        id =>
          name(
            id,
            day
          )
      )
      .join(' → ') ||
    '없음'
  );
}


function color(id) {

  if (!data) {
    return colors[0];
  }

  const index =
    data.members.findIndex(
      m =>
        m.id === id
    );

  return colors[
    Math.max(
      0,
      index
    ) %
    colors.length
  ];
}


function options(
  select,
  items,
  blank
) {

  const previous =
    select.value;

  select.replaceChildren();

  if (
    blank !== undefined
  ) {

    const o =
      node(
        'option',
        blank
      );

    o.value =
      '';

    select.append(o);
  }

  items.forEach(
    m => {

      const o =
        node(
          'option',
          m.name
        );

      o.value =
        m.id;

      select.append(o);
    }
  );

  if (
    [
      ...select.options
    ].some(
      o =>
        o.value ===
        previous
    )
  ) {
    select.value =
      previous;
  }
}


function lockUI(value) {

  busy =
    value;

  document
    .querySelectorAll(
      'button'
    )
    .forEach(
      b =>
        b.disabled =
          value
    );
  ['year','month'].forEach(id => { if ($(id)) $(id).disabled = value; });
  if (!value && data && data.authRequired) updatePinStatus();
}


const API_URL =
  'https://script.google.com/macros/s/AKfycbyGgPJjkr9LsyHF058WmgaACphjN_IlV7PPZs66D2kRWBHHSqD-_L0ZEa2WW2N8LMc/exec';


/*
 * GitHub Pages → Apps Script HTTP API
 *
 * text/plain을 사용해 CORS preflight를 피한다.
 * Apps Script의 302 redirect는 follow로 처리한다.
 */
async function rpc(
  method,
  ...args
) {

  let response;

  try {
    response = await fetch(
      API_URL,
      {
        method: 'POST',
        redirect: 'follow',

        /*
         * application/json 사용 시 브라우저가 OPTIONS
         * preflight를 발생시킬 수 있으므로 text/plain 사용.
         */
        headers: {
          'Content-Type':
            'text/plain;charset=utf-8'
        },

        body: JSON.stringify({
          method: method,
          args: args
        }),

        /*
         * Apps Script API는 자체 PIN/세션 토큰으로 인증하므로
         * Google 제3자 쿠키에 의존하지 않는다.
         */
        credentials: 'omit',

        cache: 'no-store'
      }
    );

  } catch (networkError) {

    throw new Error(
      '서버 연결에 실패했습니다. 인터넷 연결 또는 Apps Script 배포 상태를 확인하세요.'
    );
  }


  if (!response.ok) {
    throw new Error(
      '서버 응답 오류 (' +
      response.status +
      '). Apps Script 웹앱 배포 권한을 확인하세요.'
    );
  }


  let payload;

  try {
    payload =
      await response.json();

  } catch (parseError) {

    throw new Error(
      '서버 응답을 해석하지 못했습니다. Apps Script를 새 버전으로 다시 배포했는지 확인하세요.'
    );
  }


  if (
    !payload ||
    payload.ok !== true
  ) {

    throw new Error(
      payload &&
      payload.error
        ? payload.error
        : '서버 처리 중 오류가 발생했습니다.'
    );
  }


  return payload.data;
}


/* =========================================================
   접근 화면 제어
   ========================================================= */

function hideApplication() {

  document
    .querySelector('nav')
    .hidden =
      true;

  document
    .querySelectorAll(
      '.page'
    )
    .forEach(
      p =>
        p.hidden =
          true
    );

  $('logout').hidden =
    true;

  $('loginUser')
    .textContent =
      '';
}


function showIdentityGate(
  result
) {

  data =
    result;

  hideApplication();

  $('accessGate').hidden =
    true;

  $('identityGate').hidden =
    false;


  options(
    $('loginMember'),
    result.members || []
  );


  updatePinStatus();


  /*
   * 저장되어 있던 세션이 만료된 경우 삭제
   */
  if (sessionToken) {

    sessionToken =
      '';

    safeStorage.removeItem(
      'coffeeSession'
    );
  }
}


function updatePinStatus() {

  if (
    !data ||
    !data.members
  ) {
    return;
  }

  const member =
    data.members.find(
      m =>
        m.id ===
        $('loginMember').value
    );

  if (!member) {

    $('pinStatus')
      .textContent =
        '';

    return;
  }

  if (
    member.pinConfigured
  ) {

    $('pinStatus')
      .textContent =
        'PIN이 설정된 사용자입니다. 기존 PIN으로 로그인하세요.';

    $('memberRegister')
      .disabled =
        true;

  } else {

    $('pinStatus')
      .textContent =
        '아직 PIN이 없습니다. 최초 PIN 설정을 눌러 등록하세요.';

    $('memberRegister')
      .disabled =
        false;
  }
}


/* =========================================================
   데이터 Load
   ========================================================= */

async function load() {

  if (busy) {
    return;
  }

  const sequence =
    ++loadNumber;

  lockUI(true);

  message(
    '일정을 불러오는 중입니다.'
  );

  try {

    const result =
      await rpc(
        'getData',
        year,
        month,
        $('accessCode').value,
        sessionToken
      );


    if (
      sequence !==
      loadNumber
    ) {
      return;
    }


    /*
     * 개인 사용자 인증 필요
     */
    if (
      result.authRequired
    ) {

      showIdentityGate(
        result
      );

      message('');

      return;
    }


    data =
      result;


    $('accessGate').hidden =
      true;

    $('identityGate').hidden =
      true;

    document
      .querySelector('nav')
      .hidden =
        false;


    $('loginUser')
      .textContent =
        data.currentUser.name +
        ' 님';


    $('logout').hidden =
      false;


    render();


    if (
      document
        .querySelectorAll(
          '.page:not([hidden])'
        ).length === 0
    ) {

      show('today');
    }


    message('');


  } catch (e) {

    const msg =
      e.message ||
      String(e);


    if (
      msg.includes(
        'ACCESS_REQUIRED'
      )
    ) {

      hideApplication();

      $('identityGate')
        .hidden =
          true;

      $('accessGate')
        .hidden =
          false;
    }


    if (
      msg.includes(
        'USER_AUTH_REQUIRED'
      )
    ) {

      sessionToken =
        '';

      safeStorage.removeItem(
        'coffeeSession'
      );
    }


    message(
      msg,
      true
    );


  } finally {

    lockUI(false);
  }
}


/* =========================================================
   변경 요청
   ========================================================= */

async function change(
  action,
  payload
) {

  if (
    busy ||
    !data
  ) {
    return false;
  }


  lockUI(true);

  message(
    '변경사항을 저장하고 순번을 계산하고 있습니다.'
  );


  try {

    const result =
      await rpc(
        'mutate',
        {
          action:
            action,

          payload:
            payload,

          revision:
            data.settings.revision,

          year:
            year,

          month:
            month,

          password:
            $('adminPassword')
              .value,

          accessCode:
            $('accessCode')
              .value,

          sessionToken:
            sessionToken
        }
      );


    if (
      result.authRequired
    ) {

      sessionToken =
        '';

      safeStorage.removeItem(
        'coffeeSession'
      );

      showIdentityGate(
        result
      );

      message(
        '사용자 인증이 해제되었습니다. 다시 로그인하세요.'
      );

      return false;
    }


    data =
      result;


    render();


    message(data.calendarWarning || '저장되었습니다.', !!data.calendarWarning);


    return true;


  } catch (e) {

    message(
      e.message ||
      String(e),
      true
    );

    return false;


  } finally {

    lockUI(false);
  }
}


/* =========================================================
   Page
   ========================================================= */

function show(page) {

  document
    .querySelectorAll(
      '.page'
    )
    .forEach(
      s =>
        s.hidden =
          s.id !==
          page
    );


  document
    .querySelectorAll(
      'nav button'
    )
    .forEach(
      b =>
        b.classList.toggle(
          'selected',
          b.dataset.page ===
            page
        )
    );
}


document
  .querySelectorAll(
    '[data-page]'
  )
  .forEach(
    b =>
      b.onclick =
        () =>
          show(
            b.dataset.page
          )
  );


function formatDate(d) {

  return new Intl.DateTimeFormat(
    'ko-KR',
    {
      timeZone:
        'UTC',

      year:
        'numeric',

      month:
        'long',

      day:
        'numeric',

      weekday:
        'short'
    }
  ).format(
    new Date(
      d +
      'T00:00:00Z'
    )
  );
}


/* =========================================================
   일정 수정 권한
   ========================================================= */

function canEditAbsence(
  absence
) {

  if (
    !data ||
    !data.currentUser
  ) {
    return false;
  }

  /*
   * 본인 일정
   */
  if (
    absence.memberId ===
    data.currentUser.id
  ) {
    return true;
  }

  /*
   * 배포 소유자는 관리자
   */
  if (
    data.isOwner
  ) {
    return true;
  }

  /*
   * 관리자 인증 완료
   */
  if (
    adminUnlocked
  ) {
    return true;
  }

  return false;
}


/* =========================================================
   일정 목록
   ========================================================= */

function schedulesInto(
  target,
  day
) {

  target.replaceChildren();


  if (
    !day.schedules?.length
  ) {

    target.append(
      node(
        'p',
        '등록된 일정이 없습니다.',
        'muted'
      )
    );

    return;
  }


  day.schedules.forEach(
    a => {

      const row =
        node(
          'div',
          undefined,
          'row'
        );

      const body =
        node(
          'div'
        );


      body.append(

        node(
          'strong',
          name(
            a.memberId,
            day
          ) +
          ' · ' +
          a.type
        ),

        node(
          'p',
          (
            a.lunch
              ? '점심 참석'
              : '점심 불참'
          ) +
          (
            a.note
              ? ' · ' +
                a.note
              : ''
          )
        )
      );


      row.append(
        body
      );


      /*
       * 미래 일정 + 본인 일정
       * 또는 관리자일 때만 수정/삭제 표시
       */
      if (
        day.date >=
          data.today &&
        canEditAbsence(a)
      ) {

        row.append(

          button(
            '수정',
            () =>
              openAbsence(a)
          ),

          button(
            '삭제',
            async () => {

              if (
                confirm(
                  name(
                    a.memberId,
                    day
                  ) +
                  '님의 ' +
                  a.date +
                  ' 일정을 삭제할까요?'
                )
              ) {

                await change(
                  'deleteAbsence',
                  {
                    id:
                      a.id
                  }
                );
              }
            }
          )
        );
      }


      target.append(
        row
      );
    }
  );
}


/* =========================================================
   전체 Render
   ========================================================= */

function render() {

  if (
    !data ||
    data.authRequired
  ) {
    return;
  }


  $('year').value =
    year;

  $('month').value =
    month;


  $('myName')
    .textContent =
      data.currentUser.name;


  $('loginUser')
    .textContent =
      data.currentUser.name +
      ' 님';


  const active =
    data.members.filter(
      m =>
        m.active
    );


  options(
    $('absenceMember'),
    active
  );


  options(
    $('overrideMember'),
    active,
    '자동 순번으로 복원'
  );


  const day =
    data.todayInfo;


  $('todayDate')
    .textContent =
      formatDate(
        data.today
      );


  $('todayBuyer')
    .textContent =
      day.buyer
        ? name(
            day.buyer
          )
        : day.reason ||
          '담당 없음';


  $('todayReason')
    .textContent =
      data.today <
      data.settings.startDate
        ? formatDate(
            data.settings.startDate
          ) +
          '부터 시작합니다.'
        : (
            day.buyer
              ? '점심 커피를 부탁드려요.'
              : '오늘은 순번이 진행되지 않습니다.'
          );


  $('attending')
    .textContent =
      day.attending.length +
      '명';


  $('absent')
    .textContent =
      day.absent.length +
      '명';


  $('nextBuyer')
    .textContent =
      data.next
        ? formatDate(
            data.next.date
          ) +
          ' · ' +
          name(
            data.next.buyer
          )
        : '45일 이내 예정 담당이 없습니다.';


  schedulesInto(
    $('todaySchedules'),
    day
  );


  renderCalendar();

  renderMine();

  renderAdmin();
}


/* =========================================================
   Calendar
   ========================================================= */

function renderCalendar() {

  $('legend')
    .replaceChildren();


  data.members.forEach(
    m => {

      const item =
        node(
          'span',
          m.name +
          (
            m.active
              ? ''
              : ' (비활성)'
          )
        );

      item.style.setProperty(
        '--member',
        color(
          m.id
        )
      );

      $('legend').append(
        item
      );
    }
  );


  $('grid')
    .replaceChildren();


  const map =
    Object.fromEntries(
      data.days.map(
        d => [
          d.date,
          d
        ]
      )
    );


  data.calendar.cells.forEach(
    date => {

      if (!date) {

        $('grid').append(
          node('div')
        );

        return;
      }


      const day =
        map[date];


      const b =
        button(
          '',
          () => {

            selectedDay =
              date;

            renderCalendar();

            renderDetail(
              day
            );
          },
          'day'
        );


      b.classList.toggle(
        'closed',
        !!day.reason
      );

      b.classList.toggle(
        'current',
        date ===
          data.today
      );

      b.classList.toggle(
        'chosen',
        date ===
          selectedDay
      );


      b.setAttribute(
        'aria-label',
        formatDate(date) +
        ' ' +
        (
          day.buyer
            ? name(
                day.buyer,
                day
              )
            : day.reason
        )
      );


      b.style.setProperty(
        '--member',
        color(
          day.buyer
        )
      );


      b.append(
        node(
          'span',
          String(
            Number(
              date.slice(-2)
            )
          ),
          'date'
        )
      );


      b.append(
        node(
          'b',
          day.buyer
            ? name(
                day.buyer,
                day
              )
            : day.reason
        )
      );


      if (
        day.schedules.length
      ) {

        b.append(
          node(
            'small',
            day.schedules
              .map(
                a =>
                  name(
                    a.memberId,
                    day
                  ) +
                  ' ' +
                  a.type
              )
              .join(' · ')
          )
        );
      }


      if (
        day.manual
      ) {
        b.append(
          node(
            'small',
            '수동 지정'
          )
        );
      }


      if (
        day.frozen
      ) {
        b.append(
          node(
            'small',
            '확정'
          )
        );
      }


      $('grid').append(
        b
      );
    }
  );


  if (
    map[selectedDay]
  ) {

    renderDetail(
      map[selectedDay]
    );

  } else {

    $('detail')
      .replaceChildren(
        node(
          'h2',
          '날짜를 선택하세요'
        )
      );
  }
}


/* =========================================================
   날짜 상세
   ========================================================= */

function renderDetail(day) {

  const root =
    $('detail');


  root.replaceChildren(

    node(
      'h2',
      formatDate(
        day.date
      )
    ),

    node(
      'p',
      '커피 담당: ' +
      (
        day.buyer
          ? name(
              day.buyer,
              day
            )
          : day.reason
      )
    ),

    node(
      'p',
      '점심 참석: ' +
      names(
        day.attending,
        day
      )
    ),

    node(
      'p',
      '점심 불참: ' +
      names(
        day.absent,
        day
      )
    )
  );


  if (
    day.queueBefore?.length
  ) {

    root.append(

      node(
        'p',
        '배정 전: ' +
        names(
          day.queueBefore,
          day
        ),
        'muted'
      ),

      node(
        'p',
        '배정 후: ' +
        names(
          day.queueAfter,
          day
        ),
        'muted'
      )
    );
  }


  const list =
    node(
      'div'
    );


  schedulesInto(
    list,
    day
  );


  root.append(
    list
  );


  /*
   * 일정 등록은 항상 본인 일정으로 등록
   */
  if (
    day.date >=
    data.today
  ) {

    root.append(
      button(
        '이 날짜에 내 일정 등록',
        () =>
          openAbsence(
            null,
            day.date
          )
      )
    );
  }
}


/* =========================================================
   내 일정
   ========================================================= */

function renderMine() {

  const root =
    $('myList');


  root.replaceChildren();


  const id =
    data.currentUser.id;


  const rows =
    data.absences
      .filter(
        a =>
          a.memberId === id
      )
      .sort(
        (a, b) =>
          b.date.localeCompare(
            a.date
          )
      );


  if (
    !rows.length
  ) {

    root.append(
      node(
        'p',
        '등록한 일정이 없습니다.',
        'muted'
      )
    );

    return;
  }


  rows.forEach(
    a => {

      const card =
        node(
          'article'
        );


      card.append(
        node(
          'h2',
          formatDate(
            a.date
          )
        )
      );


      const list =
        node(
          'div'
        );


      schedulesInto(
        list,
        {
          date:
            a.date,

          schedules: [
            a
          ]
        }
      );


      card.append(
        list
      );


      root.append(
        card
      );
    }
  );
}


/* =========================================================
   Queue
   ========================================================= */

function renderQueue() {

  const root =
    $('queueList');


  root.replaceChildren();


  queueDraft.forEach(
    (
      id,
      i
    ) => {

      const li =
        node(
          'li',
          name(id),
          'queueRow'
        );


      if (i) {

        li.append(
          button(
            '↑',
            () => {

              [
                queueDraft[i - 1],
                queueDraft[i]
              ] = [
                queueDraft[i],
                queueDraft[i - 1]
              ];

              renderQueue();
            }
          )
        );
      }


      if (
        i <
        queueDraft.length -
          1
      ) {

        li.append(
          button(
            '↓',
            () => {

              [
                queueDraft[i + 1],
                queueDraft[i]
              ] = [
                queueDraft[i],
                queueDraft[i + 1]
              ];

              renderQueue();
            }
          )
        );
      }


      root.append(
        li
      );
    }
  );
}


/* =========================================================
   관리자 화면
   ========================================================= */

function renderAdmin() {

  queueDraft =
    data.queue.slice();


  renderQueue();


  $('startDate').value =
    data.settings.startDate;


  $('teamSetup').hidden =
    !data.isOwner;


  $('teamStatus')
    .textContent =
      data.teamConfigured
        ? '접속 암호가 설정되어 있습니다.'
        : '아직 접속 암호가 없습니다.';


  if (
    data.isOwner
  ) {

    adminUnlocked =
      true;

    $('ownerInfo')
      .textContent =
        '배포 소유자 계정으로 인증되었습니다.';

    $('adminAuthStatus')
      .textContent =
        '관리자 권한 사용 가능';

  } else {

    $('ownerInfo')
      .textContent =
        '관리 기능 사용 시 관리자 비밀번호 인증이 필요합니다.';

    $('adminAuthStatus')
      .textContent =
        adminUnlocked
          ? '관리자 인증 완료'
          : '관리자 인증 전';
  }


  /* 구성원 */
  const list =
    $('memberList');


  list.replaceChildren();


  data.members.forEach(
    m => {

      const row =
        node(
          'div',
          undefined,
          'row'
        );


      const body =
        node(
          'div'
        );


      body.append(

        node(
          'strong',
          m.name
        ),

        node(
          'p',
          m.pinConfigured
            ? '개인 PIN 설정됨'
            : '개인 PIN 미설정',
          'muted'
        )
      );


      const input =
        node(
          'input'
        );


      input.value =
        m.name;

      input.maxLength =
        30;


      const label =
        node(
          'label',
          '활성'
        );


      const check =
        node(
          'input'
        );


      check.type =
        'checkbox';

      check.checked =
        m.active;


      label.prepend(
        check
      );


      row.append(
        body,
        input,
        label,

        button(
          '저장',
          () =>
            change(
              'saveMember',
              {
                id:
                  m.id,

                name:
                  input.value,

                active:
                  check.checked
              }
            )
        ),

        button(
          'PIN 초기화',
          () => {

            if (
              confirm(
                m.name +
                '님의 PIN을 초기화할까요?\n\n' +
                '해당 사용자의 기존 로그인도 모두 해제됩니다.'
              )
            ) {

              change(
                'resetMemberPin',
                {
                  memberId:
                    m.id
                }
              );
            }
          }
        )
      );


      list.append(
        row
      );
    }
  );


  /* 휴무일 */
  $('holidayList')
    .replaceChildren();


  data.holidays
    .slice()
    .sort(
      (a, b) =>
        a.date.localeCompare(
          b.date
        )
    )
    .forEach(
      h => {

        const row =
          node(
            'div',
            undefined,
            'row'
          );


        row.append(
          node(
            'div',
            h.date +
            ' · ' +
            h.name
          )
        );


        if (
          h.date >=
          data.today
        ) {

          row.append(
            button(
              '삭제',
              () => {

                if (
                  confirm(
                    h.date +
                    ' 휴무일을 삭제할까요?'
                  )
                ) {

                  change(
                    'deleteHoliday',
                    {
                      date:
                        h.date
                    }
                  );
                }
              }
            )
          );
        }


        $('holidayList')
          .append(
            row
          );
      }
    );


  /* 수동 지정 */
  $('overrideList')
    .replaceChildren();


  data.overrides
    .filter(
      o =>
        o.date >=
        data.today
    )
    .forEach(
      o => {

        const row =
          node(
            'div',
            undefined,
            'row'
          );


        row.append(

          node(
            'div',
            o.date +
            ' · ' +
            name(
              o.memberId
            )
          ),

          button(
            '지정 해제',
            () =>
              change(
                'setOverride',
                {
                  date:
                    o.date,

                  memberId:
                    ''
                }
              )
          )
        );


        $('overrideList')
          .append(
            row
          );
      }
    );


  /* Audit */
  $('audit')
    .replaceChildren();


  const labels = {

    saveAbsence:
      '일정 저장',

    deleteAbsence:
      '일정 삭제',

    saveMember:
      '구성원 변경',

    resetMemberPin:
      'PIN 초기화',

    registerPin:
      'PIN 최초 등록',

    setQueue:
      '순번 변경',

    saveHoliday:
      '휴무일 저장',

    deleteHoliday:
      '휴무일 삭제',

    setOverride:
      '담당자 지정',

    setStartDate:
      '시작일 변경',

    undo:
      '변경 되돌리기'
  };


  data.audit.forEach(
    a =>

      $('audit')
        .append(

          node(
            'p',
            new Date(
              a.at
            )
            .toLocaleString(
              'ko-KR',
              {
                timeZone:
                  'Asia/Seoul'
              }
            ) +
            ' · ' +
            (
              labels[
                a.action
              ] ||
              a.action
            )
          )
        )
  );


  [
    'holidayDate',
    'overrideDate',
    'startDate',
    'absenceDate'
  ].forEach(
    id =>
      $(id).min =
        data.today
  );
}


/* =========================================================
   일정 Dialog
   ========================================================= */

function openAbsence(
  a,
  date
) {

  if (
    !data ||
    busy
  ) {
    return;
  }


  /*
   * 다른 사람 일정 수정은
   * 관리자일 때만 허용
   */
  if (
    a &&
    !canEditAbsence(a)
  ) {

    message(
      '본인의 일정만 수정할 수 있습니다.',
      true
    );

    return;
  }


  $('absenceForm')
    .reset();


  $('absenceTitle')
    .textContent =
      a
        ? '일정 수정'
        : '일정 등록';


  $('absenceId')
    .value =
      a?.id || '';


  /*
   * 일반 사용자는 무조건 자기 자신
   */
  if (
    a
  ) {

    $('absenceMember')
      .value =
        a.memberId;

  } else {

    $('absenceMember')
      .value =
        data.currentUser.id;
  }


  const adminMode =
    data.isOwner ||
    adminUnlocked;


  $('absenceMember')
    .disabled =
      !adminMode;


  $('absenceOwnerMessage')
    .textContent =
      adminMode
        ? '관리자 권한으로 다른 구성원의 일정도 지정할 수 있습니다.'
        : data.currentUser.name +
          '님의 일정으로 자동 등록됩니다.';


  $('absenceDate')
    .value =
      a?.date ||
      date ||
      data.today;


  $('absenceType')
    .value =
      a?.type ||
      '연차';


  $('absenceLunch')
    .value =
      String(
        a?.lunch ??
        false
      );


  $('absenceNote')
    .value =
      a?.note ||
      '';


  $('absenceDialog')
    .showModal();
}


/* =========================================================
   일정 저장
   ========================================================= */

$('absenceForm')
  .onsubmit =
    async e => {

      e.preventDefault();


      /*
       * disabled select는 값 자체는 유지되므로
       * 직접 currentUser로 확정
       */
      const memberId =
        (
          data.isOwner ||
          adminUnlocked
        )
          ? $('absenceMember')
              .value
          : data.currentUser.id;


      const ok =
        await change(
          'saveAbsence',
          {
            id:
              $('absenceId')
                .value,

            memberId:
              memberId,

            date:
              $('absenceDate')
                .value,

            type:
              $('absenceType')
                .value,

            lunch:
              $('absenceLunch')
                .value ===
              'true',

            note:
              $('absenceNote')
                .value
          }
        );


      if (ok) {

        $('absenceDialog')
          .close();
      }
    };


$('closeDialog')
  .onclick =
    () =>
      $('absenceDialog')
        .close();


$('quickAdd')
  .onclick =
    () =>
      openAbsence();


$('mineAdd')
  .onclick =
    () =>
      openAbsence();


/* =========================================================
   사용자 인증
   ========================================================= */

$('loginMember')
  .onchange =
    updatePinStatus;


$('memberLogin')
  .onclick =
    async () => {

      if (busy) {
        return;
      }


      const memberId =
        $('loginMember')
          .value;


      const pin =
        $('loginPin')
          .value;


      if (
        !memberId
      ) {

        message(
          '사용자를 선택하세요.',
          true
        );

        return;
      }


      lockUI(true);


      try {

        const result =
          await rpc(
            'loginMember',
            memberId,
            pin,
            $('accessCode')
              .value
          );


        sessionToken =
          result.token;


        safeStorage.setItem(
          'coffeeSession',
          sessionToken
        );


        $('loginPin')
          .value =
            '';


        adminUnlocked =
          false;


        message(
          result.member.name +
          '님으로 로그인했습니다.'
        );


      } catch (e) {

        message(
          e.message ||
          String(e),
          true
        );


      } finally {

        lockUI(false);
      }


      if (
        sessionToken
      ) {
        load();
      }
    };


$('memberRegister')
  .onclick =
    async () => {

      if (busy) {
        return;
      }


      const memberId =
        $('loginMember')
          .value;


      const member =
        data.members.find(
          m =>
            m.id ===
            memberId
        );


      const pin =
        $('loginPin')
          .value;


      if (!member) {

        message(
          '사용자를 선택하세요.',
          true
        );

        return;
      }


      if (
        member.pinConfigured
      ) {

        message(
          '이미 PIN이 설정되어 있습니다.',
          true
        );

        return;
      }


      if (
        !/^\d{6}$/.test(
          pin
        )
      ) {

        message(
          'PIN은 숫자 6자리로 입력하세요.',
          true
        );

        return;
      }


      if (
        !confirm(
          member.name +
          '님의 개인 PIN을 이 번호로 설정할까요?\n\n' +
          '설정 후 잊어버리면 관리자에게 PIN 초기화를 요청해야 합니다.'
        )
      ) {
        return;
      }


      lockUI(true);


      try {

        const result =
          await rpc(
            'registerMemberPin',
            memberId,
            pin,
            $('accessCode')
              .value
          );


        sessionToken =
          result.token;


        safeStorage.setItem(
          'coffeeSession',
          sessionToken
        );


        $('loginPin')
          .value =
            '';


        message(
          result.member.name +
          '님의 PIN을 설정했습니다.'
        );


      } catch (e) {

        message(
          e.message ||
          String(e),
          true
        );


      } finally {

        lockUI(false);
      }


      if (
        sessionToken
      ) {
        load();
      }
    };


/* =========================================================
   Logout
   ========================================================= */

$('logout')
  .onclick =
    async () => {

      if (
        !confirm(
          '현재 사용자에서 로그아웃할까요?'
        )
      ) {
        return;
      }


      $('adminPassword').value = '';
      const oldToken =
        sessionToken;


      sessionToken =
        '';


      safeStorage.removeItem(
        'coffeeSession'
      );


      adminUnlocked =
        false;


      try {

        if (oldToken) {

          await rpc(
            'logoutMember',
            oldToken
          );
        }

      } catch (e) {
        /* 서버 로그아웃 실패해도 로컬 세션은 삭제 */
      }


      hideApplication();


      $('identityGate')
        .hidden =
          false;


      load();
    };


/* =========================================================
   관리자 인증
   ========================================================= */

$('adminLoginButton')
  .onclick =
    async () => {

      if (
        data.isOwner
      ) {

        adminUnlocked =
          true;

        $('adminAuthStatus')
          .textContent =
            '배포 소유자 계정 - 관리자 권한 사용 가능';

        render();

        return;
      }


      const password =
        $('adminPassword')
          .value;


      if (!password) {

        message(
          '관리자 비밀번호를 입력하세요.',
          true
        );

        return;
      }


      lockUI(true);


      try {

        await rpc(
          'checkAdmin',
          password,
          $('accessCode')
            .value
        );


        adminUnlocked =
          true;


        $('adminAuthStatus')
          .textContent =
            '관리자 인증 완료';


        message(
          '관리자 권한이 활성화되었습니다.'
        );


        render();


      } catch (e) {

        adminUnlocked =
          false;


        $('adminAuthStatus')
          .textContent =
            '관리자 인증 실패';


        message(
          e.message ||
          String(e),
          true
        );


      } finally {

        lockUI(false);
      }
    };


/* =========================================================
   관리자 기능
   ========================================================= */

$('memberForm')
  .onsubmit =
    async e => {

      e.preventDefault();

      if (
        await change(
          'saveMember',
          {
            name:
              $('newName')
                .value,

            active:
              true
          }
        )
      ) {

        $('newName')
          .value =
            '';
      }
    };


$('holidayForm')
  .onsubmit =
    e => {

      e.preventDefault();

      change(
        'saveHoliday',
        {
          date:
            $('holidayDate')
              .value,

          name:
            $('holidayName')
              .value
        }
      );
    };


$('overrideForm')
  .onsubmit =
    e => {

      e.preventDefault();

      change(
        'setOverride',
        {
          date:
            $('overrideDate')
              .value,

          memberId:
            $('overrideMember')
              .value
        }
      );
    };


$('startForm')
  .onsubmit =
    e => {

      e.preventDefault();

      if (
        confirm(
          '최초 운영 시작일을 변경할까요?'
        )
      ) {

        change(
          'setStartDate',
          {
            date:
              $('startDate')
                .value
          }
        );
      }
    };


$('saveQueue')
  .onclick =
    () => {

      if (
        confirm(
          '표시된 순서를 오늘 배정 전 순번으로 적용할까요?\n중복된 이름을 줄이면 누적 미수행 횟수도 줄어듭니다.'
        )
      ) {

        change(
          'setQueue',
          {
            queue:
              queueDraft
          }
        );
      }
    };


$('resetQueue')
  .onclick =
    () => {

      queueDraft =
        data.members
          .filter(
            m =>
              m.active
          )
          .sort(
            (a, b) =>
              a.order -
              b.order
          )
          .map(
            m =>
              m.id
          );


      renderQueue();


      message(
        '기본 순서로 정렬했습니다. 적용하면 누적 미수행 횟수도 초기화됩니다.'
      );
    };


$('undo')
  .onclick =
    () => {

      if (
        confirm(
          '부서 전체의 마지막 변경 1건을 되돌릴까요?'
        )
      ) {

        change(
          'undo',
          {}
        );
      }
    };


/* =========================================================
   Calendar Navigation
   ========================================================= */

function navigate(delta) {

  if (busy) {
    return;
  }


  month +=
    delta;


  if (
    month < 1
  ) {

    month =
      12;

    year--;
  }


  if (
    month > 12
  ) {

    month =
      1;

    year++;
  }


  if (
    year < 1900 ||
    year > 2200
  ) {

    year =
      Math.max(
        1900,
        Math.min(
          2200,
          year
        )
      );

    return;
  }


  load();
}


$('prev')
  .onclick =
    () =>
      navigate(-1);


$('next')
  .onclick =
    () =>
      navigate(1);


$('year')
  .onchange =
    () => {

      const value =
        Number(
          $('year')
            .value
        );


      if (
        Number.isInteger(
          value
        ) &&
        value >= 1900 &&
        value <= 2200
      ) {

        year =
          value;

        load();

      } else {

        message(
          '연도는 1900~2200으로 입력하세요.',
          true
        );
      }
    };


$('month')
  .onchange =
    () => {

      month =
        Number(
          $('month')
            .value
        );

      load();
    };


$('thisMonth')
  .onclick =
    () => {

      if (!data) {
        return;
      }


      year =
        Number(
          data.today.slice(
            0,
            4
          )
        );


      month =
        Number(
          data.today.slice(
            5,
            7
          )
        );


      selectedDay =
        data.today;


      load();
    };


$('refresh')
  .onclick =
    load;


/* =========================================================
   부서 암호
   ========================================================= */

$('accessForm')
  .onsubmit =
    e => {

      e.preventDefault();

      load();
    };


$('teamForm')
  .onsubmit =
    async e => {

      e.preventDefault();


      if (busy) {
        return;
      }


      lockUI(true);


      try {

        await rpc(
          'configureTeamAccess',
          $('teamPassword')
            .value
        );


        $('teamPassword')
          .value =
            '';


        data.teamConfigured =
          true;


        renderAdmin();


        message(
          '부서 접속 암호를 설정했습니다.'
        );


      } catch (err) {

        message(
          err.message ||
          String(err),
          true
        );


      } finally {

        lockUI(false);
      }
    };


/* =========================================================
   월 Select 초기화
   ========================================================= */

for (
  let m = 1;
  m <= 12;
  m++
) {

  const o =
    node(
      'option',
      m + '월'
    );

  o.value =
    m;

  $('month')
    .append(o);
}


/* =========================================================
   최초 실행
   ========================================================= */

load();
