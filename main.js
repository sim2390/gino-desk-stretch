'use strict';
// Gino: a desk stretch coach that lives in the tray (Windows) or menu bar (macOS).

const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { app, BrowserWindow, Tray, Menu, screen, powerMonitor, ipcMain, nativeImage } = require('electron');
const { Scheduler } = require('./src/scheduler');
const { cardBounds } = require('./src/placement');
const EXERCISES = require('./src/exercises');

// `npm run fast` turns minutes into seconds so you can watch a full cycle quickly.
const FAST = process.argv.includes('--fast') || process.env.GINO_FAST === '1';
const MIN = FAST ? 1000 : 60 * 1000;
const REAL_MIN = 60 * 1000;
const TICK_MS = FAST ? 1000 : 15 * 1000;
const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

const WIN_W = 440; // card 404 + shadow room
const WIN_H = 214;
const EDGE = 8; // gap to the screen edge

const DEFAULT_SETTINGS = {
  intervalMin: 20, // active screen time between stretches
  snoozeMin: 10,
  idleResetMin: 5, // idle this long counts as a break and restarts the timer
  autoSnoozeMin: 4, // an ignored card snoozes itself
  waitWhenBusy: true, // Windows: hold reminders during calls and full-screen apps
  cardPos: null, // where you last dragged the card, { x, bottom }; null = corner of the main screen
  welcomed: false,
};
const DEFAULT_STATS = { days: {}, reminders: 0, cycle: 0 };

let settings;
let stats;
let sched;
let tray = null;
let cardWin = null;
let cardReady = null;
let cardVisible = false;
let placedAt = null; // where we last put the card, to tell our own moves from your drags
let moveTimer = null;
let waiting = null; // reason a due stretch is being held back
let checking = false;
let lastCheck = 0;
let lastTick = Date.now();
let showAfterClose = false;

// ---------- storage ----------

const storePath = (name) => path.join(app.getPath('userData'), name);

function readJson(name, fallback) {
  try {
    return { ...fallback, ...JSON.parse(fs.readFileSync(storePath(name), 'utf8')) };
  } catch {
    return JSON.parse(JSON.stringify(fallback));
  }
}

function writeJson(name, data) {
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(storePath(name), JSON.stringify(data, null, 2));
  } catch (e) {
    console.error(`Could not save ${name}: ${e.message}`);
  }
}

const saveSettings = () => writeJson('settings.json', settings);
const saveStats = () => writeJson('stats.json', stats);

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const todayCount = () => stats.days[today()] || 0;

function addDone() {
  stats.days[today()] = todayCount() + 1;
  const keep = Object.keys(stats.days).sort().slice(-90); // about three months
  stats.days = Object.fromEntries(keep.map((k) => [k, stats.days[k]]));
  saveStats();
}

// Every third reminder is the walkaround; the rest rotate through the stretches.
function pickNext() {
  const walk = EXERCISES.find((e) => e.walk);
  const others = EXERCISES.filter((e) => !e.walk);
  const n = stats.reminders || 0;
  stats.reminders = n + 1;
  let ex;
  if (walk && n % 3 === 2) {
    ex = walk;
  } else {
    ex = others[(stats.cycle || 0) % others.length];
    stats.cycle = (stats.cycle || 0) + 1;
  }
  saveStats();
  return ex;
}

// ---------- "is now a bad moment?" (Windows) ----------

// SHQueryUserNotificationState is what Windows itself uses to hold back
// notifications during full-screen apps and presentations. The registry check
// looks for any app that currently has the microphone open, i.e. a call.
const QUIET_PS = `
$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'
$state = -1
try {
  Add-Type -Namespace Gino -Name Native -MemberDefinition '[DllImport("shell32.dll")] public static extern int SHQueryUserNotificationState(out int state);'
  $s = 0
  [void][Gino.Native]::SHQueryUserNotificationState([ref]$s)
  $state = $s
} catch {}
$mic = $false
$base = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone'
Get-ChildItem -Path $base -Recurse | ForEach-Object {
  $p = Get-ItemProperty -Path $_.PSPath
  if ($p.LastUsedTimeStart -and ($p.LastUsedTimeStop -eq 0)) { $mic = $true }
}
Write-Output ('{"state":' + $state + ',"mic":' + $mic.ToString().ToLower() + '}')
`;

const BUSY_STATES = {
  1: 'screen locked',
  2: 'full-screen app',
  3: 'full-screen game',
  4: 'presentation mode',
  7: 'full-screen app',
};

function quietCheck() {
  if (!IS_WIN || !settings.waitWhenBusy) return Promise.resolve({ busy: false });
  const encoded = Buffer.from(QUIET_PS, 'utf16le').toString('base64');
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true, timeout: 10000 },
      (err, stdout) => {
        if (err) return resolve({ busy: false }); // if the check fails, don't block reminders
        try {
          const line = String(stdout).trim().split(/\r?\n/).pop();
          const r = JSON.parse(line);
          if (r.mic) return resolve({ busy: true, reason: 'you seem to be on a call' });
          if (BUSY_STATES[r.state]) return resolve({ busy: true, reason: BUSY_STATES[r.state] });
          resolve({ busy: false });
        } catch {
          resolve({ busy: false });
        }
      }
    );
  });
}

// ---------- the card window ----------

function createCard() {
  cardWin = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    // Windows: never take keyboard focus, so you can't accidentally type into it.
    // macOS: shown inactive, and the first click goes straight to the button.
    focusable: !IS_WIN,
    acceptFirstMouse: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  cardWin.setAlwaysOnTop(true, 'screen-saver');
  if (IS_MAC) cardWin.setVisibleOnAllWorkspaces(true);
  cardReady = cardWin.loadFile(path.join(__dirname, 'src', 'card.html'));
  cardWin.on('closed', () => {
    cardWin = null;
    cardVisible = false;
  });
  // The card is dragged by its body (see card.css); remember where you drop it.
  // macOS reports moves all through a drag (Windows once, at the end), so save once it settles.
  cardWin.on('moved', () => {
    clearTimeout(moveTimer);
    moveTimer = setTimeout(rememberCardPos, 300);
  });
  // Windows offers Move/Close on right-clicking a drag area; the card doesn't need that menu.
  cardWin.on('system-context-menu', (e) => e.preventDefault());
}

function placeCard(height) {
  if (!cardWin) return;
  placedAt = cardBounds({
    primary: screen.getPrimaryDisplay().workArea,
    displays: screen.getAllDisplays(),
    saved: settings.cardPos,
    width: WIN_W,
    height,
    edge: EDGE,
  });
  cardWin.setBounds(placedAt);
}

function rememberCardPos() {
  if (!cardWin || cardWin.isDestroyed()) return;
  const b = cardWin.getBounds();
  // macOS reports our own setBounds as a move too; only a real drag lands somewhere new.
  if (placedAt && Math.abs(b.x - placedAt.x) <= 2 && Math.abs(b.y - placedAt.y) <= 2) return;
  settings.cardPos = { x: b.x, bottom: b.y + b.height };
  placedAt = b;
  saveSettings();
}

function resetCardPos() {
  settings.cardPos = null;
  saveSettings();
  if (cardVisible && cardWin) placeCard(cardWin.getBounds().height);
}

async function showCard(exercise, mode = 'stretch') {
  if (!cardWin) createCard();
  try {
    await cardReady;
  } catch (e) {
    console.error(`Card failed to load: ${e.message}`);
    return;
  }
  placeCard(WIN_H);
  cardWin.webContents.send('show', {
    mode,
    exercise,
    todayCount: todayCount(),
    snoozeMin: settings.snoozeMin,
    intervalMin: settings.intervalMin,
    autoSnoozeMin: settings.autoSnoozeMin,
  });
  cardWin.showInactive();
  cardVisible = true;
  waiting = null;
  updateTray();
}

function hideCard() {
  if (cardWin && !cardWin.isDestroyed()) cardWin.hide();
  cardVisible = false;
  updateTray();
  if (showAfterClose) {
    showAfterClose = false;
    setTimeout(() => showCard(pickNext()), 300);
  }
}

// Put the card away from this side, without the card's own close flow.
function forceHideCard() {
  if (cardWin && !cardWin.isDestroyed()) cardWin.webContents.send('hide');
  showAfterClose = false;
  hideCard();
}

function welcomeCard() {
  const where = IS_MAC
    ? 'I live in the menu bar.'
    : 'I live in the tray by the clock. If you can\'t see me, I\'m under the ^ arrow: drag me out.';
  return {
    id: 'welcome',
    name: "Hi, I'm Gino",
    pose: 'wave',
    text: `Every ${settings.intervalMin} minutes of screen time I'll pop up with a short stretch. ${where}`,
    dose: '',
    howTo: [],
  };
}

// ---------- scheduling ----------

function tick() {
  const now = Date.now();
  const dt = now - lastTick;
  lastTick = now;
  let idleMs = 0;
  try {
    idleMs = powerMonitor.getSystemIdleTime() * 1000;
  } catch {
    idleMs = 0;
  }

  if (cardVisible) {
    // You walked away with a card up: put it away and start fresh.
    if (idleMs >= settings.idleResetMin * REAL_MIN) {
      forceHideCard();
      sched.reset();
    }
    updateTray();
    return;
  }

  const status = sched.tick(dt, idleMs);
  if (status === 'away') waiting = null;
  if (status === 'due') maybeShow();
  updateTray();
}

async function maybeShow() {
  if (checking || cardVisible) return;
  if (waiting && Date.now() - lastCheck < 60 * 1000) return; // re-check once a minute
  checking = true;
  const q = await quietCheck();
  checking = false;
  lastCheck = Date.now();
  if (cardVisible || sched.isPaused() || sched.msLeft() > 0) return;
  if (q.busy) {
    waiting = q.reason;
    updateTray();
    return;
  }
  showCard(pickNext());
}

function pauseFor(minutes) {
  sched.pause(minutes * REAL_MIN);
  waiting = null;
  updateTray();
}

function pauseUntilTomorrow() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(6, 0, 0, 0);
  sched.pauseUntil(d.getTime());
  waiting = null;
  updateTray();
}

function setIntervalMin(m) {
  settings.intervalMin = m;
  sched.setInterval(m * MIN);
  saveSettings();
  updateTray();
}

// ---------- tray / menu bar ----------

function fmtTime(ts) {
  const d = new Date(ts);
  const t = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? t : `tomorrow ${t}`;
}

function statusLine() {
  if (sched.isPaused()) return `Paused until ${fmtTime(sched.pausedUntil)}`;
  if (cardVisible) return 'Stretch on screen';
  if (waiting) return `Holding off: ${waiting}`;
  const left = Math.max(1, Math.ceil(sched.msLeft() / MIN));
  return `Next stretch in ${left} ${FAST ? 'sec' : 'min'}`;
}

function loginOptions() {
  // Running from source, Windows needs to know which folder to start.
  return app.isPackaged ? {} : { path: process.execPath, args: [app.getAppPath()] };
}

function loginMenuItem() {
  const label = IS_MAC ? 'Open at login' : 'Start with Windows';
  // On macOS this only works for the built app, not when running from source.
  const canToggle = IS_WIN || app.isPackaged;
  let on = false;
  try {
    on = canToggle && app.getLoginItemSettings(loginOptions()).openAtLogin;
  } catch {
    on = false;
  }
  return {
    label: canToggle ? label : `${label} (built app only)`,
    type: 'checkbox',
    checked: on,
    enabled: canToggle,
    click: (item) => {
      try {
        app.setLoginItemSettings({ openAtLogin: item.checked, ...loginOptions() });
      } catch (e) {
        console.error(`Could not change login item: ${e.message}`);
      }
    },
  };
}

function buildMenu() {
  const n = todayCount();
  const items = [
    { label: statusLine(), enabled: false },
    { label: n === 0 ? 'No stretches yet today' : `Done today: ${n}`, enabled: false },
    { type: 'separator' },
    {
      label: 'Stretch now',
      enabled: !cardVisible,
      click: () => showCard(pickNext()),
    },
    sched.isPaused()
      ? {
          label: 'Resume',
          click: () => {
            sched.resume();
            updateTray();
          },
        }
      : {
          label: 'Pause',
          submenu: [
            { label: 'For 30 minutes', click: () => pauseFor(30) },
            { label: 'For 1 hour', click: () => pauseFor(60) },
            { label: 'For 2 hours', click: () => pauseFor(120) },
            { label: 'Until tomorrow', click: pauseUntilTomorrow },
          ],
        },
    { type: 'separator' },
    {
      label: 'Remind me every',
      submenu: [15, 20, 30, 45, 60].map((m) => ({
        label: `${m} minutes`,
        type: 'radio',
        checked: settings.intervalMin === m,
        click: () => setIntervalMin(m),
      })),
    },
  ];
  if (IS_WIN) {
    items.push({
      label: 'Hold off during calls and full-screen apps',
      type: 'checkbox',
      checked: settings.waitWhenBusy,
      click: (item) => {
        settings.waitWhenBusy = item.checked;
        waiting = null;
        saveSettings();
      },
    });
  }
  items.push(
    loginMenuItem(),
    { label: 'Reset card position', enabled: !!settings.cardPos, click: resetCardPos },
    { type: 'separator' },
    { label: 'Quit Gino', click: () => app.quit() }
  );
  return Menu.buildFromTemplate(items);
}

function openMenu() {
  if (tray) tray.popUpContextMenu(buildMenu());
}

function trayIcon() {
  const file = IS_MAC ? 'trayTemplate.png' : 'tray.png'; // @2x versions load automatically
  const img = nativeImage.createFromPath(path.join(__dirname, 'assets', file));
  if (IS_MAC) img.setTemplateImage(true);
  return img;
}

function updateTray() {
  if (tray) tray.setToolTip(`Gino: ${statusLine()}`);
}

// ---------- app ----------

function main() {
  app.on('second-instance', openMenu);
  app.on('window-all-closed', () => {}); // keep running in the tray

  ipcMain.handle('card:action', (_event, name) => {
    switch (name) {
      case 'done':
        addDone();
        sched.complete();
        return { todayCount: todayCount() };
      case 'skip':
      case 'stop':
        sched.complete();
        return {};
      case 'snooze':
        sched.snooze(settings.snoozeMin * MIN);
        return {};
      case 'trynow':
        showAfterClose = true;
        return {};
      default:
        return {};
    }
  });
  ipcMain.on('card:resize', (_event, h) => placeCard(Number(h) || WIN_H));
  ipcMain.on('card:closed', hideCard);

  app.whenReady().then(() => {
    if (IS_WIN) app.setAppUserModelId('com.gino.stretch');
    if (IS_MAC && app.dock) app.dock.hide();

    settings = readJson('settings.json', DEFAULT_SETTINGS);
    stats = readJson('stats.json', DEFAULT_STATS);
    sched = new Scheduler({
      intervalMs: settings.intervalMin * MIN,
      idleResetMs: settings.idleResetMin * REAL_MIN,
    });

    createCard();
    tray = new Tray(trayIcon());
    tray.on('click', openMenu);
    tray.on('right-click', openMenu);
    updateTray();

    const breakNow = () => {
      if (cardVisible) forceHideCard();
      sched.reset();
      waiting = null;
    };
    powerMonitor.on('lock-screen', breakNow);
    powerMonitor.on('suspend', breakNow);
    powerMonitor.on('resume', () => (lastTick = Date.now()));
    powerMonitor.on('unlock-screen', () => (lastTick = Date.now()));

    setInterval(tick, TICK_MS);

    if (!settings.welcomed) {
      settings.welcomed = true;
      saveSettings();
      showCard(welcomeCard(), 'welcome');
    }
    if (FAST) console.log('Gino fast mode: reminder minutes are seconds.');
  });
}

if (app.requestSingleInstanceLock()) {
  main();
} else {
  app.quit();
}
