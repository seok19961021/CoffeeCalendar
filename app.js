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
let backgroundLoading = false;
let lastRefresh = 0;
let editGeneration = 0;
const dirtyForms = new Set();

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
  if (/^#[0-9a-f]{6}$/i.test(data?.memberColors?.[id] || "")) return data.memberColors[id];

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
  'https://coffee-calendar-api.s-eok96.workers.dev/';


/* GitHub PWA → Cloudflare → Apps Script. 읽기만 한 번 재시도한다. */
async function rpc(method, ...args) {
  const attempts = (method === 'getData' || method === 'ping') ? 2 : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 35000);
    try {
      if (navigator.onLine === false) throw new Error('OFFLINE');
      const response = await fetch(API_URL, {
        method: 'POST', mode: 'cors', redirect: 'error',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ method, args }), credentials: 'omit',
        cache: 'no-store', signal: controller.signal
      });
      const text = await response.text();
      let payload;
      try { payload = JSON.parse(text); } catch (_) {
        const error = new Error('서버가 올바른 응답을 보내지 않았습니다. 잠시 후 새로고침해 주세요. (HTTP ' + response.status + ')');
        error.retryable = response.status >= 500; throw error;
      }
      if (!response.ok || !payload || payload.ok !== true) {
        const error = new Error(payload && payload.error || '서버 응답 오류 (HTTP ' + response.status + ')');
        error.retryable = response.status >= 500; throw error;
      }
      return payload.data;
    } catch (error) {
      const networkFailure = error.name === 'AbortError' || error instanceof TypeError;
      if (attempt + 1 < attempts && navigator.onLine !== false && (networkFailure || error.retryable)) {
        message('연결을 다시 확인하고 있습니다.');
        continue;
      }
      if (error.message === 'OFFLINE' || navigator.onLine === false) {
        throw new Error('인터넷 연결이 없습니다. Wi-Fi 또는 모바일 데이터를 연결한 뒤 새로고침해 주세요.');
      }
      if (networkFailure) {
        throw new Error((error.name === 'AbortError' ? '서버 응답 시간이 초과되었습니다.' : '서버에 연결하지 못했습니다.') +
          (attempts === 1 ? ' 처리 여부가 불확실하므로 새로고침하여 결과를 확인한 뒤 다시 시도해 주세요.' : ' 연결을 확인하고 새로고침해 주세요. 계속 실패하면 Wi-Fi와 모바일 데이터를 바꾸어 확인해 주세요.'));
      }
      throw error;
    } finally { clearTimeout(timer); }
  }
}

/* =========================================================
   접근 화면 제어
   ========================================================= */

function hideApplication() {
  $('memberColor').hidden = true;

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
    if (result.accessToken) {
      safeStorage.setItem('coffeeDeviceAccess', result.accessToken);
      $('accessCode').value = result.accessToken;
    }
    lastRefresh = Date.now();
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

      safeStorage.removeItem('coffeeDeviceAccess');
      $('accessCode').value = '';
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


  ++loadNumber;
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


    dirtyForms.clear();
    lastRefresh = Date.now();
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
  renderLunchRoulette();
  const subscription = data?.calendarSubscription;
  $('calendarAddLink').hidden = !subscription;
  $('calendarAddMissing').hidden = !!subscription;
  if (subscription) {
    $('calendarAddLink').href = subscription.url;
    $('calendarAccount').textContent = subscription.email ? '연결할 계정: ' + subscription.email : '본인 Google 계정으로 추가하세요.';
    $('calendarName').textContent = subscription.name;
  }

  if (data?.currentUser) { $('memberColor').hidden = false; $('memberColor').style.backgroundColor = color(data.currentUser.id); }


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
  const holidayStatus = data.holidayStatus || {};
  const statusElement = $('holidayStatus');
  if (statusElement) statusElement.textContent = holidayStatus.warning ||
    ((holidayStatus.years || []).includes(String(year))
      ? '대한민국 공휴일 자동 반영 · 원본 자료를 주기적으로 확인합니다'
      : '이 연도의 자동 공휴일 자료가 아직 없습니다. 필요한 날짜는 관리자 휴무일에서 추가해 주세요.');

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


      const holiday = (data.holidays || []).concat(data.autoHolidays || []).find(h => h.date === date);
      b.classList.toggle('holiday', !!holiday);
      if (holiday) b.title = holiday.name;

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
            : (holiday ? holiday.name : day.reason)
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
            : (holiday ? holiday.name : day.reason)
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


  if (data.lunchHistory?.[day.date]) root.append(node('p', '점심 식당: ' + data.lunchHistory[day.date].name, 'lunch-detail'));

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

safeStorage.removeItem('coffeeDeviceAccess');
$('accessCode').value = '';
load();


// 저장 중인 입력은 유지하고, 연결 상태만 안내한다.
function updateConnectionStatus() {
  const status = $('connectionStatus');
  status.hidden = navigator.onLine !== false;
  status.textContent = status.hidden ? '' : '오프라인입니다. 연결 후 새로고침해 주세요. 일정 저장은 인터넷 연결이 필요합니다.';
}
window.addEventListener('online', updateConnectionStatus);
window.addEventListener('offline', updateConnectionStatus);
updateConnectionStatus();

// 조회는 화면을 잠그지 않으며 편집/저장/화면 전환 중 도착한 응답은 적용하지 않는다.
function safeToRefresh() {
  return !busy && !document.hidden && navigator.onLine !== false && !dirtyForms.size &&
    !document.querySelector('dialog[open], #lunchRoulette[open]') && !document.activeElement?.matches('input,select,textarea') &&
    !document.querySelector('#admin:not([hidden])');
}
async function refreshQuietly() {
  if (!data?.currentUser || backgroundLoading || !safeToRefresh() || Date.now()-lastRefresh < 60000) return;
  backgroundLoading = true;
  const sequence = loadNumber, edit = editGeneration, y = year, m = month;
  try {
    const result = await rpc('getData', y, m, $('accessCode').value, sessionToken);
    if (sequence !== loadNumber || edit !== editGeneration || y !== year || m !== month || !safeToRefresh()) return;
    if (result.authRequired) { showIdentityGate(result); return; }
    data = result; lastRefresh = Date.now(); render();
  } catch (error) {
    lastRefresh = Date.now();
    if (String(error.message).includes('ACCESS_REQUIRED') && sequence === loadNumber && safeToRefresh()) {
      safeStorage.removeItem('coffeeDeviceAccess'); $('accessCode').value = '';
      hideApplication(); $('identityGate').hidden = true; $('accessGate').hidden = false;
      message('부서 접속 정보가 변경되었습니다. 암호를 다시 입력하세요.', true);
    }
  }
  finally { backgroundLoading = false; }
}
document.addEventListener('input', e => {
  ++editGeneration;
  if (e.target.form && !e.target.closest('#accessGate,#identityGate')) dirtyForms.add(e.target.form);
});
document.addEventListener('reset', e => dirtyForms.delete(e.target));
document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('close', () => {
  dialog.querySelectorAll('form').forEach(form => dirtyForms.delete(form));
}));
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshQuietly(); });
window.addEventListener('online', refreshQuietly);
setInterval(refreshQuietly, 120000);
const markerPalette = ['#5D4037','#A85D32','#D04C55','#B83C88','#8253B5','#435ECC','#1677B8','#00857A','#54852D','#967300'];
$('memberColor').onclick = () => {
  $('colorChoices').replaceChildren();
  markerPalette.forEach(value => {
    const choice = button('', async () => {
      if (await change('saveMemberColor', {color:value})) $('colorDialog').close();
    });
    choice.className='color-choice'; choice.style.backgroundColor=value;
    choice.setAttribute('aria-label','색상 '+value); choice.setAttribute('aria-pressed',String(value.toUpperCase()===color(data.currentUser.id).toUpperCase()));
    $('colorChoices').append(choice);
  });
  $('colorDialog').showModal();
};
$('closeColor').onclick = () => $('colorDialog').close();

$('addGoogleCalendar').onclick = () => $('calendarAddDialog').showModal();
$('closeCalendarAdd').onclick = () => $('calendarAddDialog').close();

let lunchSpinning = false;
let lunchEdit = null;
const lunchFills = ['#E6C8A9','#D5DDBA','#C4DBE0','#E5C5CF','#D6C9E5','#E8DCA9'];
for (let n=2;n<=12;n++) { const option=document.createElement('option'); option.value=n; option.textContent=n+'칸'; $('lunchCount').append(option); }
function renderLunchRoulette() {
  if (!data?.currentUser) return;
  const lunch=data.lunchRoulette || {revision:0,slots:['','','',''],result:null};
  const current=lunch.result?.date===data.today ? lunch.result : (data.lunchHistory?.[data.today] || null);
  $('lunchToday').textContent=current ? current.name : '아직 선택하지 않았어요';
  if (lunchSpinning) return;
  $('lunchResult').textContent=current ? '오늘의 선택: '+current.name : '식당을 입력하고 룰렛을 돌려 보세요.';
  $('lunchCount').value=lunch.slots.length;
  const wheel=$('lunchWheel'); wheel.style.transform=''; wheel.replaceChildren();
  const svg=(tag,attrs)=>{const e=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,v);return e;};
  lunch.slots.forEach((name,index)=>{
    const step=2*Math.PI/lunch.slots.length, start=index*step-Math.PI/2-step/2,end=start+step, mid=(start+end)/2;
    const group=svg('g',{role:'button',tabindex:'0','aria-label':(index+1)+'번 칸: '+(name||'식당 입력')});
    const p=angle=>[160+150*Math.cos(angle),160+150*Math.sin(angle)];const p1=p(start),p2=p(end);
    group.append(svg('path',{d:`M160,160 L${p1} A150,150 0 0,1 ${p2} Z`,fill:lunchFills[index%lunchFills.length],stroke:'#fff','stroke-width':2}));
    const text=svg('text',{x:160+98*Math.cos(mid),y:164+98*Math.sin(mid),'text-anchor':'middle'});
    const limit=lunch.slots.length>8?3:6;
    text.style.fontSize=lunch.slots.length>8?'10px':'12px';
    text.textContent=name ? (name.length>limit?name.slice(0,limit)+'…':name) : (index+1)+'번 입력'; group.append(text);
    const title=svg('title',{});title.textContent=name||'식당 이름 입력';group.append(title);
    const edit=async()=>{
      if(busy||lunchSpinning)return;
      lunchEdit={index,revision:lunch.revision,slots:[...lunch.slots]};
      $('lunchEditTitle').textContent=(index+1)+'번 칸 식당 이름';
      $('lunchRestaurant').value=name;
      $('lunchEditDialog').showModal();
      $('lunchRestaurant').focus();
    };
    group.onclick=edit;group.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();edit();}};wheel.append(group);
  });
}
$('lunchCount').onchange=async()=>{
  if(busy||lunchSpinning){renderLunchRoulette();return;}
  const lunch=data.lunchRoulette||{revision:0,slots:['','','','']}, count=Number($('lunchCount').value);
  if(count<lunch.slots.length&&!confirm('줄어드는 칸의 식당 이름이 삭제됩니다. 계속할까요?')){renderLunchRoulette();return;}
  const slots=Array.from({length:count},(_,i)=>lunch.slots[i]||'');
  if(!await change('saveLunchRoulette',{revision:lunch.revision,slots}))renderLunchRoulette();
};
$('lunchEditForm').onsubmit=async e=>{
  e.preventDefault();
  if(!lunchEdit||busy)return;
  const slots=[...lunchEdit.slots];slots[lunchEdit.index]=$('lunchRestaurant').value.trim();
  if(await change('saveLunchRoulette',{revision:lunchEdit.revision,slots}))$('lunchEditDialog').close();
};
$('lunchEditCancel').onclick=()=>$('lunchEditDialog').close();
$('lunchReset').onclick=async()=>{
  if(busy||lunchSpinning||!confirm('룰렛의 식당 목록과 선택 상태를 초기화할까요? 캘린더의 날짜별 점심 기록은 유지됩니다.'))return;
  await change('resetLunchRoulette',{revision:data.lunchRoulette?.revision||0});
};
$('lunchSpin').onclick=async()=>{
  if(busy||lunchSpinning)return;
  const lunch=data.lunchRoulette||{revision:0,slots:[]};
  if(lunch.slots.length<2||lunch.slots.some(s=>!s.trim())){message('모든 칸에 식당 이름을 입력하세요.',true);return;}
  // 서버에서 한 번 선택/저장한 결과를 같은 칸에 멈추는 애니메이션으로 보여 준다.
  lunchSpinning=true;
  if(!await change('spinLunchRoulette',{revision:lunch.revision})){lunchSpinning=false;renderLunchRoulette();return;}
  $('lunchResult').textContent='오늘 점심을 고르는 중…';
  const result=data.lunchRoulette.result,rotation=1800-result.index*360/lunch.slots.length;
  $('lunchSpin').disabled=true;$('lunchCount').disabled=true;$('lunchReset').disabled=true;
  try {
    const animation=$('lunchWheel').animate([{transform:'rotate(0deg)'},{transform:`rotate(${rotation}deg)`}],{duration:matchMedia('(prefers-reduced-motion: reduce)').matches?0:3000,easing:'cubic-bezier(.12,.72,.13,1)',fill:'forwards'});
    await animation.finished;
    $('lunchWheel').style.transform=`rotate(${rotation%360}deg)`;animation.cancel();
  } finally {
    lunchSpinning=false;$('lunchSpin').disabled=false;$('lunchCount').disabled=false;$('lunchReset').disabled=false;
    $('lunchResult').textContent='오늘의 선택: '+result.name;
  }
};

