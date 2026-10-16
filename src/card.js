// The pop-up card. Driven by the main process through window.ginoApi (preload.js).
(function () {
  const api = window.ginoApi;
  const $ = (id) => document.getElementById(id);
  const card = $('card');
  const plate = $('plate');

  let payload = null;
  let ex = null;
  let timerId = 0;
  let autoSnoozeId = 0;
  let closeId = 0;
  let closing = false;
  let t0 = 0;
  let total = 0;
  let switched = false;

  const fmt = (sec) => {
    const s = Math.max(0, Math.ceil(sec));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  const countLabel = (n) => (n === 0 ? 'First one today' : `${n} today`);

  function setPose(pose) {
    plate.innerHTML = window.Gino.svg(pose);
  }

  function setState(state) {
    card.dataset.state = state;
    const prompt = state === 'prompt' || state === 'welcome';
    $('info').hidden = !prompt;
    $('timer').hidden = state !== 'active';
    $('actPrompt').hidden = !prompt;
    $('actActive').hidden = state !== 'active';
    $('note').hidden = !['done', 'snoozed', 'skipped'].includes(state);
  }

  // Tell the main process how tall the window needs to be (card + shadow room).
  function fit() {
    requestAnimationFrame(() => {
      if (api) api.resize(card.offsetHeight + 36);
    });
  }

  function clearTimers() {
    clearInterval(timerId);
    clearTimeout(autoSnoozeId);
    clearTimeout(closeId);
  }

  function setActions(buttons) {
    $('actPrompt').replaceChildren(
      ...buttons.map(([act, label, cls]) => {
        const b = document.createElement('button');
        b.dataset.act = act;
        b.className = cls;
        b.textContent = label;
        return b;
      })
    );
  }

  function show(p) {
    clearTimers();
    closing = false;
    payload = p;
    ex = p.exercise;
    const welcome = p.mode === 'welcome';

    $('title').textContent = ex.name;
    $('count').textContent = welcome ? '' : countLabel(p.todayCount);
    $('text').textContent = ex.text;
    $('dose').textContent = ex.dose || '';
    const steps = ex.howTo || [];
    $('howto').replaceChildren(
      ...steps.map((t) => {
        const li = document.createElement('li');
        li.textContent = t;
        return li;
      })
    );
    $('howto').hidden = true;
    $('howtoBtn').hidden = steps.length === 0;
    $('howtoBtn').setAttribute('aria-expanded', 'false');
    $('dose').parentElement.hidden = !ex.dose && steps.length === 0;

    setActions(
      welcome
        ? [
            ['trynow', 'Try one now', 'primary'],
            ['dismiss', 'Got it', 'secondary'],
          ]
        : [
            ['start', 'Start', 'primary'],
            ['snooze', `Snooze ${p.snoozeMin} min`, 'secondary'],
            ['skip', 'Skip', 'quiet'],
          ]
    );

    plate.classList.remove('mirror');
    setPose(ex.pose);
    setState(welcome ? 'welcome' : 'prompt');
    $('bar').style.width = '0';

    card.classList.remove('out', 'in', 'idle');
    void card.offsetWidth; // restart the entrance animation
    card.classList.add('in');
    fit();

    if (!welcome && p.autoSnoozeMin) {
      autoSnoozeId = setTimeout(() => snooze(true), p.autoSnoozeMin * 60 * 1000);
    }
  }

  function start() {
    clearTimeout(autoSnoozeId);
    total = Math.max(5, ex.seconds || 30);
    t0 = performance.now();
    switched = false;
    setState('active');
    updateTimer();
    timerId = setInterval(updateTimer, 200);
    fit();
    if (api) api.action('start', { id: ex.id });
  }

  function updateTimer() {
    const elapsed = (performance.now() - t0) / 1000;
    const left = total - elapsed;
    $('big').textContent = fmt(left);
    $('bar').style.width = `${Math.min(100, (elapsed / total) * 100)}%`;

    let sub = '';
    if (ex.reps) {
      const rep = Math.min(ex.reps, Math.floor(elapsed / (total / ex.reps)) + 1);
      sub = `Rep ${rep} of ${ex.reps}`;
    } else if (ex.sides) {
      if (!switched && elapsed >= total / 2) {
        switched = true;
        plate.classList.add('mirror');
      }
      sub = switched ? 'Other side' : 'First side';
    } else if (ex.walk) {
      sub = 'Off you go';
    }
    $('sub').textContent = sub;

    if (left <= 0) finish();
  }

  async function finish() {
    clearTimers();
    let res = {};
    try {
      res = (api && (await api.action('done', { id: ex.id }))) || {};
    } catch (e) {
      res = {};
    }
    const n = typeof res.todayCount === 'number' ? res.todayCount : payload.todayCount + 1;
    $('title').textContent = 'Nice.';
    $('count').textContent = '';
    $('note').textContent = n === 1 ? 'That was your first one today.' : `That's ${n} today.`;
    plate.classList.remove('mirror');
    setPose('celebrate');
    setState('done');
    fit();
    closeId = setTimeout(close, 2400);
  }

  function snooze(auto) {
    clearTimers();
    if (api) api.action('snooze', { auto: !!auto });
    if (auto) return close();
    $('note').textContent = `Snoozed. See you in ${payload.snoozeMin} minutes.`;
    setPose('wave');
    setState('snoozed');
    fit();
    closeId = setTimeout(close, 1800);
  }

  function skip(kind) {
    clearTimers();
    if (api) api.action(kind, { id: ex.id });
    const word = kind === 'stop' ? 'Stopped' : 'Skipped';
    $('note').textContent = `${word}. Next one in ${payload.intervalMin} minutes.`;
    plate.classList.remove('mirror');
    setPose('idle');
    setState('skipped');
    fit();
    closeId = setTimeout(close, 1800);
  }

  function toggleHowTo() {
    clearTimeout(autoSnoozeId); // you're reading it, so don't auto-snooze
    const list = $('howto');
    list.hidden = !list.hidden;
    $('howtoBtn').setAttribute('aria-expanded', String(!list.hidden));
    fit();
  }

  function close() {
    if (closing) return;
    closing = true;
    clearTimers();
    card.classList.remove('in');
    card.classList.add('out');
    setTimeout(() => {
      if (api) api.closed();
    }, 210);
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b || closing) return;
    switch (b.dataset.act) {
      case 'start': return start();
      case 'done': return finish();
      case 'stop': return skip('stop');
      case 'skip': return skip('skip');
      case 'snooze': return snooze(false);
      case 'howto': return toggleHowTo();
      case 'trynow':
        if (api) api.action('trynow');
        return close();
      case 'dismiss':
        if (api) api.action('dismiss');
        return close();
    }
  });

  if (api) {
    api.onShow(show);
    // The main process put the card away (you walked off, or the screen locked).
    api.onHide(() => {
      clearTimers();
      closing = true;
      card.classList.remove('in');
    });
  }

  // Hooks for dev/preview.html. Not used by the app.
  window.__card = {
    show,
    start,
    finish,
    snooze,
    skip,
    toggleHowTo,
    setElapsed(sec) {
      t0 = performance.now() - sec * 1000;
      updateTimer();
    },
  };
})();
