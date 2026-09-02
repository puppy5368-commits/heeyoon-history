
(() => {
  const curriculum = window.HISTORY_WEEKS || [];

  // V2.1부터 실제 학습 진도 저장용으로 고정.
  // 이후 업데이트에서는 이 STORAGE_KEY와 기존 필드를 보존합니다.
  const STORAGE_KEY = "heeyoon-history-progress";
  const DATA_VERSION = 1;

  const blankState = () => ({
    version: DATA_VERSION,
    days: {},
    day2Choice: {},
    quiz: {},
    visits: {}
  });

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return blankState();
      const parsed = JSON.parse(raw);
      return {
        version: DATA_VERSION,
        days: parsed.days || {},
        day2Choice: parsed.day2Choice || {},
        quiz: parsed.quiz || {},
        visits: parsed.visits || {}
      };
    } catch {
      return blankState();
    }
  }

  let state = loadState();
  const weeksEl = document.getElementById("weeks");

  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, ch => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  })[ch]);

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    updateGlobalStats();
  }

  function isDayDone(weekNum, day) {
    if (day === 2) return Boolean(state.day2Choice[weekNum]);
    return Boolean(state.days[`${weekNum}-${day}`]);
  }

  function weekDoneCount(weekNum) {
    return [1,2,3].filter(day => isDayDone(weekNum, day)).length;
  }

  function currentFilter() {
    return document.querySelector(".filter.active")?.dataset.filter || "all";
  }

  function applyFilter(value) {
    document.querySelectorAll(".week").forEach(card => {
      card.classList.toggle("hidden", !(value === "all" || card.dataset.month === value));
    });
  }

  function updateGlobalStats() {
    let completeWeeks = 0;
    let completeDays = 0;

    curriculum.forEach((_, idx) => {
      const n = idx + 1;
      const dayCount = weekDoneCount(n);
      completeDays += dayCount;
      if (dayCount === 3) completeWeeks++;
    });

    const pct = curriculum.length
      ? Math.round((completeWeeks / curriculum.length) * 100)
      : 0;

    document.getElementById("doneCount").textContent = completeWeeks;
    document.getElementById("todoCount").textContent = curriculum.length - completeWeeks;
    document.getElementById("dayCount").textContent = completeDays;
    document.getElementById("progressText").textContent =
      `${pct}% · ${completeWeeks}/${curriculum.length}주`;
    document.getElementById("progressBar").style.width = pct + "%";
  }

  function quizHtml(week, weekNum) {
    return week.quiz.map((item, qIndex) => {
      const key = `${weekNum}-${qIndex}`;
      const selected = state.quiz[key];

      const options = item[1].map((option, optionIndex) => {
        let cls = "opt";
        if (selected !== undefined) {
          if (optionIndex === item[2]) cls += " correct";
          else if (optionIndex === selected) cls += " wrong";
        }

        return `
          <button
            type="button"
            class="${cls}"
            data-qkey="${key}"
            data-option="${optionIndex}">
            ${optionIndex + 1}. ${escapeHtml(option)}
          </button>
        `;
      }).join("");

      let feedback = "";
      if (selected !== undefined) {
        feedback = selected === item[2]
          ? "정답이에요 ✓"
          : "괜찮아요. 초록색 답을 다시 읽어봐요.";
      }

      return `
        <div class="quiz-item">
          <div class="quiz-q">${qIndex + 1}. ${escapeHtml(item[0])}</div>
          <div class="opts">${options}</div>
          <div class="feedback">${feedback}</div>
        </div>
      `;
    }).join("");
  }

  function render() {
    const filter = currentFilter();
    weeksEl.innerHTML = "";

    curriculum.forEach((week, idx) => {
      const n = idx + 1;
      const day1 = isDayDone(n, 1);
      const day2 = isDayDone(n, 2);
      const day3 = isDayDone(n, 3);
      const count = weekDoneCount(n);
      const done = count === 3;
      const day2Choice = state.day2Choice[n] || "";

      const card = document.createElement("article");
      card.className = "week" + (done ? " done" : "");
      card.dataset.month = week.m;

      const vocab = week.words.map(word => `
        <div class="vocab">
          <strong>${escapeHtml(word[0])}</strong>
          <span class="hanja">${escapeHtml(word[1])}</span><br>
          ${escapeHtml(word[2])}
        </div>
      `).join("");

      const parentQuestions = week.q
        .map(q => `<li class="parent-q">${escapeHtml(q)}</li>`)
        .join("");

      card.innerHTML = `
        <div class="top">
          <button type="button" class="title-button" aria-expanded="false">
            <div class="week-no">${week.m}개월차 · ${n}주</div>
            <div class="title-line">
              <h3>${escapeHtml(week.title)}</h3>
              <span class="chev">▼</span>
            </div>
          </button>
        </div>

        <div class="week-summary">
          <div class="week-progress">
            <span style="width:${(count / 3) * 100}%"></span>
          </div>
          <div class="week-status">${count}/3 DAY 완료</div>
        </div>

        <div class="detail">
          <section class="day-panel ${day1 ? "complete" : ""}">
            <div class="day-head">
              <div class="day-head-left">
                <div class="day-kicker">DAY 1 · 만나기</div>
                <div class="day-title">이야기 + 핵심 한자어</div>
                <div class="day-desc">10~15분 · 처음 내용을 이해하는 날</div>
              </div>
              <div class="day-complete">${day1 ? "완료 ✓" : "미완료"}</div>
            </div>

            <div class="day-body">
              <div class="story">${escapeHtml(week.story)}</div>
              <div class="vocab-list">${vocab}</div>
              <div class="task-row">
                <input
                  id="d1-${n}"
                  class="day-check"
                  data-week="${n}"
                  data-day="1"
                  type="checkbox"
                  ${day1 ? "checked" : ""}>
                <label for="d1-${n}">오늘 이야기와 한자어를 함께 봤어요</label>
              </div>
            </div>
          </section>

          <section class="day-panel ${day2 ? "complete" : ""}">
            <div class="day-head">
              <div class="day-head-left">
                <div class="day-kicker">DAY 2 · 연결하기</div>
                <div class="day-title">책 또는 영상 중 하나</div>
                <div class="day-desc">10~15분 · 둘 다 하지 않아도 됩니다</div>
              </div>
              <div class="day-complete">${day2 ? "완료 ✓" : "미완료"}</div>
            </div>

            <div class="day-body resource-choice">
              <label class="resource ${day2Choice === "book" ? "selected" : ""}">
                <div class="resource-top">
                  <input
                    type="radio"
                    name="choice-${n}"
                    class="day2-choice"
                    data-week="${n}"
                    value="book"
                    ${day2Choice === "book" ? "checked" : ""}>
                  <div>
                    <div class="resource-name">📚 용선생 처음 한국사</div>
                    <div class="resource-desc">${escapeHtml(week.book)}</div>
                  </div>
                </div>
              </label>

              <div class="or-label">또는</div>

              <label class="resource ${day2Choice === "video" ? "selected" : ""}">
                <div class="resource-top">
                  <input
                    type="radio"
                    name="choice-${n}"
                    class="day2-choice"
                    data-week="${n}"
                    value="video"
                    ${day2Choice === "video" ? "checked" : ""}>
                  <div>
                    <div class="resource-name">🎬 EBS 역사 영상</div>
                    <div class="resource-desc">${escapeHtml(week.video)}</div>
                  </div>
                </div>
              </label>
            </div>
          </section>

          <section class="day-panel ${day3 ? "complete" : ""}">
            <div class="day-head">
              <div class="day-head-left">
                <div class="day-kicker">DAY 3 · 생각하기</div>
                <div class="day-title">대화 + 오늘의 한 줄 + 퀴즈</div>
                <div class="day-desc">10~15분 · 자기 말로 설명해 보는 날</div>
              </div>
              <div class="day-complete">${day3 ? "완료 ✓" : "미완료"}</div>
            </div>

            <div class="day-body">
              <ol>${parentQuestions}</ol>

              <div class="takeaway">
                <b>오늘의 한 줄</b><br>
                ${escapeHtml(week.take)}
              </div>

              <div class="quiz-note">
                퀴즈는 가볍게 확인만 해요. 점수보다 설명이 더 중요합니다.
              </div>

              <div class="quiz">${quizHtml(week, n)}</div>

              <div class="task-row">
                <input
                  id="d3-${n}"
                  class="day-check"
                  data-week="${n}"
                  data-day="3"
                  type="checkbox"
                  ${day3 ? "checked" : ""}>
                <label for="d3-${n}">대화와 퀴즈까지 마쳤어요</label>
              </div>
            </div>
          </section>

          <section class="fieldtrip-panel ${state.visits[n] ? "visited" : ""}">
            <div class="fieldtrip-head">
              <div>
                <div class="fieldtrip-kicker">WEEKEND BONUS · 현장탐방</div>
                <div class="fieldtrip-title">${escapeHtml(week.fieldTrip.place)}</div>
                <div class="fieldtrip-area">${escapeHtml(week.fieldTrip.area)} · 선택 활동 · 주간 진도에는 포함되지 않아요</div>
              </div>
              <div class="fieldtrip-status">${state.visits[n] ? "다녀옴 ✓" : "선택"}</div>
            </div>

            <div class="fieldtrip-why">${escapeHtml(week.fieldTrip.why)}</div>

            <div class="fieldtrip-grid">
              <div class="fieldtrip-card">
                <b>🔎 현장 한자 미션</b>
                <div>${escapeHtml(week.fieldTrip.hanja)}</div>
              </div>
              <div class="fieldtrip-card">
                <b>🎯 찾아보기</b>
                <div>${escapeHtml(week.fieldTrip.mission)}</div>
              </div>
            </div>

            <div class="fieldtrip-question">💬 ${escapeHtml(week.fieldTrip.question)}</div>

            <div class="fieldtrip-actions">
              <a
                class="map-link"
                target="_blank"
                rel="noopener"
                href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(week.fieldTrip.place)}">
                지도에서 찾기 ↗
              </a>

              <label class="visit-check-label">
                <input
                  type="checkbox"
                  class="visit-check"
                  data-week="${n}"
                  ${state.visits[n] ? "checked" : ""}>
                다녀왔어요
              </label>
            </div>
          </section>
        </div>
      `;

      card.querySelector(".title-button").addEventListener("click", event => {
        const open = card.classList.toggle("open");
        event.currentTarget.setAttribute("aria-expanded", String(open));
      });

      card.querySelectorAll(".day-check").forEach(cb => {
        cb.addEventListener("change", () => {
          const weekNum = Number(cb.dataset.week);
          const day = Number(cb.dataset.day);
          state.days[`${weekNum}-${day}`] = cb.checked;
          save();
          render();
          applyFilter(filter);
        });
      });

      card.querySelectorAll(".day2-choice").forEach(radio => {
        radio.addEventListener("change", () => {
          const weekNum = Number(radio.dataset.week);
          state.day2Choice[weekNum] = radio.value;
          save();
          render();
          applyFilter(filter);
        });
      });

      card.querySelectorAll(".opt").forEach(btn => {
        btn.addEventListener("click", () => {
          state.quiz[btn.dataset.qkey] = Number(btn.dataset.option);
          save();
          render();
          applyFilter(filter);
        });
      });

      const visitCheck = card.querySelector(".visit-check");
      if (visitCheck) {
        visitCheck.addEventListener("change", () => {
          state.visits[n] = visitCheck.checked;
          save();
          render();
          applyFilter(filter);
        });
      }

      weeksEl.appendChild(card);
    });

    applyFilter(filter);
    updateGlobalStats();
  }

  document.querySelectorAll(".filter").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".filter").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      applyFilter(btn.dataset.filter);
    });
  });

  document.getElementById("collapseBtn").addEventListener("click", () => {
    document.querySelectorAll(".week.open").forEach(card => {
      card.classList.remove("open");
      card.querySelector(".title-button")?.setAttribute("aria-expanded", "false");
    });
  });

  document.getElementById("resetBtn").addEventListener("click", () => {
    if (!confirm("24주 학습 기록을 모두 초기화할까요?")) return;
    state = blankState();
    save();
    render();
  });

  render();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    });
  }
})();
