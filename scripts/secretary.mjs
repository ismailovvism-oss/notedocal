#!/usr/bin/env node
// Секретарь: запись и чтение данных notedocal из командной строки.
//
// Приложение хранит данные там же, куда пишет этот скрипт, поэтому всё
// добавленное отсюда прилетает на телефон почти мгновенно (realtime-подписка
// в src/lib/sync.ts). Модель данных повторяет sync.ts:
//   users/{uid}          — документ с полями checklists[], events[], tasks[],
//                          sightings[] (слияние LWW по updatedAt);
//   users/{uid}/notes/*  — заметки, по документу на запись.
//
// Доступ — через service account (Admin SDK), правила Firestore он обходит.
// Ключ берётся из SECRETARY_KEY (JSON или base64 — для облачных сред, где
// файла в проекте нет), иначе из GOOGLE_APPLICATION_CREDENTIALS или
// ./service-account.json. Владелец данных — SECRETARY_EMAIL/SECRETARY_UID.
//
// Примеры:
//   node scripts/secretary.mjs who
//   node scripts/secretary.mjs task add "Купить фильтр" --date tomorrow
//   node scripts/secretary.mjs task list --open
//   node scripts/secretary.mjs task done "фильтр"
//   node scripts/secretary.mjs event add "Созвон" --date thu --start 15:00
//   node scripts/secretary.mjs agenda --days 7
//   node scripts/secretary.mjs batch дела.json

import { readFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cert, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

// ---------- Разбор аргументов ----------

/** Разбирает argv в позиционные аргументы и флаги (--key value, --flag). */
function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      positional.push(a);
      continue;
    }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      flags[key] = true;
    } else {
      flags[key] = next;
      i++;
    }
  }
  return { positional, flags };
}

// ---------- Даты ----------

const WEEKDAYS = {
  вс: 0, воскресенье: 0, sun: 0,
  пн: 1, понедельник: 1, mon: 1,
  вт: 2, вторник: 2, tue: 2,
  ср: 3, среда: 3, wed: 3,
  чт: 4, четверг: 4, thu: 4,
  пт: 5, пятница: 5, fri: 5,
  сб: 6, суббота: 6, sat: 6,
};

/** Ключ дня YYYY-MM-DD по локальному времени (как в src/lib/dates.ts). */
function toKey(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function addDays(d, n) {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

/** YYYY-MM-DD → локальная дата. `new Date(key)` дал бы полночь UTC и в
 *  отрицательных часовых поясах съезжал бы на день назад. */
function fromKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Человеческая дата → YYYY-MM-DD.
 * Понимает: today/сегодня, tomorrow/завтра, послезавтра, +N, день недели
 * (ближайший будущий), готовый YYYY-MM-DD, а также none/null (без даты).
 */
function parseDate(input) {
  if (input === undefined || input === null || input === true) return null;
  const s = String(input).trim().toLowerCase();
  if (!s || s === 'none' || s === 'null' || s === 'без' || s === '-') return null;

  const today = new Date();
  if (s === 'today' || s === 'сегодня') return toKey(today);
  if (s === 'tomorrow' || s === 'завтра') return toKey(addDays(today, 1));
  if (s === 'послезавтра') return toKey(addDays(today, 2));

  if (/^\+\d+$/.test(s)) return toKey(addDays(today, Number(s.slice(1))));
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // Число месяца без года: 14 или 14.08
  const dm = s.match(/^(\d{1,2})[./](\d{1,2})$/);
  if (dm) {
    const d = new Date(today.getFullYear(), Number(dm[2]) - 1, Number(dm[1]));
    // Прошедшая дата означает следующий год.
    if (toKey(d) < toKey(today)) d.setFullYear(d.getFullYear() + 1);
    return toKey(d);
  }

  if (s in WEEKDAYS) {
    const want = WEEKDAYS[s];
    let d = addDays(today, 1);
    for (let i = 0; i < 7; i++) {
      if (d.getDay() === want) return toKey(d);
      d = addDays(d, 1);
    }
  }

  throw new Error(`не понял дату: "${input}"`);
}

/** HH:mm → проверка и нормализация. */
function parseTime(input) {
  if (input === undefined || input === true) return undefined;
  const s = String(input).trim();
  const m = s.match(/^(\d{1,2})[:.]?(\d{2})?$/);
  if (!m) throw new Error(`не понял время: "${input}"`);
  const h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (h > 23 || min > 59) throw new Error(`не понял время: "${input}"`);
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

// ---------- Подключение ----------

/** Путь к ключу service account. */
function keyPath() {
  const fromEnv = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (fromEnv) return resolve(fromEnv);
  return resolve(process.cwd(), 'service-account.json');
}

/**
 * Читает ключ, заданный строкой: сам JSON либо он же в base64.
 * Base64 удобен там, где секрет задаётся одной строкой переменной окружения
 * (облачная среда, CI) и переносы строк в приватном ключе ломают значение.
 */
function parseKeyMaterial(raw) {
  const s = String(raw).trim();
  const json = s.startsWith('{') ? s : Buffer.from(s, 'base64').toString('utf8');
  let key;
  try {
    key = JSON.parse(json);
  } catch {
    throw new Error('SECRETARY_KEY не разобрать: нужен JSON ключа service account или он же в base64');
  }
  if (!key.project_id || !key.private_key) {
    throw new Error('SECRETARY_KEY не похож на ключ service account (нет project_id/private_key)');
  }
  return key;
}

/**
 * Ключ доступа: сначала переменная SECRETARY_KEY (для сред без файловой
 * системы проекта — облако, CI), иначе файл service-account.json.
 */
function loadKey() {
  if (process.env.SECRETARY_KEY) return parseKeyMaterial(process.env.SECRETARY_KEY);
  const path = keyPath();
  if (!existsSync(path)) {
    throw new Error(
      `не найден ключ service account: ${path}\n` +
        'Firebase Console → Project settings → Service accounts → Generate new private key,\n' +
        'сохранить как service-account.json в корне проекта (он в .gitignore),\n' +
        'либо задать переменную SECRETARY_KEY (JSON ключа или он же в base64).',
    );
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

function connect() {
  initializeApp({ credential: cert(loadKey()) });
  return { db: getFirestore(), auth: getAuth() };
}

/** uid владельца данных: из SECRETARY_UID, либо по email из SECRETARY_EMAIL. */
async function resolveUid(auth) {
  if (process.env.SECRETARY_UID) return process.env.SECRETARY_UID;
  const email = process.env.SECRETARY_EMAIL;
  if (!email) {
    throw new Error(
      'не задан владелец данных: укажи SECRETARY_EMAIL (или SECRETARY_UID) в .env.\n' +
        'Посмотреть доступные аккаунты: node scripts/secretary.mjs who',
    );
  }
  const user = await auth.getUserByEmail(email);
  return user.uid;
}

/** Загружает .env в process.env (без зависимостей; уже заданное не трогаем). */
function loadEnv() {
  const path = resolve(process.cwd(), '.env');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trimStart().startsWith('#')) continue;
    const value = m[2].replace(/^['"]|['"]$/g, '');
    if (!(m[1] in process.env)) process.env[m[1]] = value;
  }
}

// ---------- Чтение и запись документа пользователя ----------

/** Читает поле-массив из users/{uid} (checklists, events, tasks…). */
async function readList(db, uid, field) {
  const snap = await db.doc(`users/${uid}`).get();
  const data = snap.data() ?? {};
  return Array.isArray(data[field]) ? data[field] : [];
}

/**
 * Атомарно меняет поле-массив в users/{uid}.
 * `fn` получает текущий массив и возвращает новый. Транзакция защищает от
 * гонки с приложением, если оно открыто и пишет в тот же момент.
 */
async function mutateList(db, uid, field, fn) {
  const ref = db.doc(`users/${uid}`);
  let result;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data() ?? {};
    const current = Array.isArray(data[field]) ? data[field] : [];
    const { list, out } = fn(current);
    result = out;
    tx.set(ref, { [field]: list, updatedAt: Date.now() }, { merge: true });
  });
  return result;
}

/** Убирает undefined — Firestore их не принимает. */
function clean(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

const visible = (list) => list.filter((it) => !it.deleted);

// ---------- Задачи (пункты чек-листов) ----------

/**
 * Добавляет задачу так же, как кнопка «быстрая задача» в приложении:
 * ищет список с пустым названием и дописывает в него, иначе создаёт новый
 * (см. ChecklistBoard.addQuickTask). С `--list` кладёт в список с таким
 * названием (создаёт при необходимости).
 *
 * `--date` ставит дату ПУНКТУ, а не списку: приложение считает день задачи
 * как `it.date ?? c.date` (DashboardView), а вкладка «Задачи» показывает
 * только недатированные списки. Датируй мы список — задача пропала бы из
 * своей категории и осталась видна лишь в календаре того дня.
 * Дата самого списка — редкий случай, для него `--list-date`.
 */
async function taskAdd(db, uid, text, flags) {
  const date = 'list-date' in flags ? parseDate(flags['list-date']) : null;
  const listTitle = typeof flags.list === 'string' ? flags.list.trim() : '';
  const item = clean({
    id: randomUUID(),
    text,
    done: false,
    desc: typeof flags.desc === 'string' ? flags.desc : undefined,
    date: 'date' in flags ? parseDate(flags.date) : undefined,
  });

  return mutateList(db, uid, 'checklists', (lists) => {
    const now = Date.now();
    const sameDay = lists.filter((l) => !l.deleted && (l.date ?? null) === date);
    const target = sameDay.find((l) =>
      listTitle ? (l.title ?? '').trim() === listTitle : !(l.title ?? '').trim(),
    );

    if (target) {
      const updated = { ...target, items: [...(target.items ?? []), item], updatedAt: now };
      return {
        list: lists.map((l) => (l.id === target.id ? updated : l)),
        out: { item, list: updated },
      };
    }
    const created = {
      id: randomUUID(),
      title: listTitle,
      date,
      items: [item],
      createdAt: now,
      updatedAt: now,
    };
    return { list: [created, ...lists], out: { item, list: created } };
  });
}

/**
 * Плоский обход дерева задач: {item, listId, listTitle, date, path}.
 * `date` — эффективный день задачи по правилу приложения: дата пункта, а если
 * её нет — дата списка (см. `it.date ?? c.date` в DashboardView).
 */
function flatten(lists) {
  const out = [];
  const walk = (items, list, prefix) => {
    for (const it of items ?? []) {
      out.push({
        item: it,
        listId: list.id,
        listTitle: (list.title ?? '').trim(),
        date: it.date ?? list.date ?? null,
        path: prefix ? `${prefix} / ${it.text}` : it.text,
      });
      if (it.subitems?.length) walk(it.subitems, list, prefix ? `${prefix} / ${it.text}` : it.text);
    }
  };
  for (const l of visible(lists)) walk(l.items, l, '');
  return out;
}

/** Меняет один пункт по id в дереве (рекурсивно). */
function treeUpdate(items, id, fn) {
  return (items ?? []).map((it) =>
    it.id === id
      ? fn(it)
      : it.subitems
        ? { ...it, subitems: treeUpdate(it.subitems, id, fn) }
        : it,
  );
}

function treeRemove(items, id) {
  return (items ?? [])
    .filter((it) => it.id !== id)
    .map((it) => (it.subitems ? { ...it, subitems: treeRemove(it.subitems, id) } : it));
}

/** Находит задачи по id или по подстроке текста (без учёта регистра). */
function findTasks(lists, query) {
  const all = flatten(lists);
  const exact = all.filter((t) => t.item.id === query);
  if (exact.length) return exact;
  const q = query.toLowerCase();
  return all.filter((t) => t.item.text.toLowerCase().includes(q));
}

/** Отмечает выполнение (или снимает отметку с --undo) / удаляет задачу. */
async function taskEdit(db, uid, query, action) {
  return mutateList(db, uid, 'checklists', (lists) => {
    const found = findTasks(lists, query).filter((t) =>
      action === 'done' ? !t.item.done : true,
    );
    if (found.length === 0) throw new Error(`не нашёл задачу по запросу: "${query}"`);
    if (found.length > 1) {
      const names = found.map((t) => `  · ${t.path}`).join('\n');
      throw new Error(`под запрос "${query}" подходит несколько задач:\n${names}`);
    }
    const t = found[0];
    const now = Date.now();
    const list = lists.map((l) => {
      if (l.id !== t.listId) return l;
      const items =
        action === 'rm'
          ? treeRemove(l.items, t.item.id)
          : treeUpdate(l.items, t.item.id, (it) => ({ ...it, done: action === 'done' }));
      return { ...l, items, updatedAt: now };
    });
    return { list, out: t };
  });
}

// ---------- События ----------

/** Виды повтора события (см. Repeat в types.ts). */
const REPEATS = ['none', 'daily', 'weekly', 'monthly', 'yearly'];

/** Проверяет значение --repeat; undefined означает «не задано». */
function parseRepeat(input) {
  if (typeof input !== 'string') return undefined;
  const s = input.trim().toLowerCase();
  if (!REPEATS.includes(s)) throw new Error(`повтор — одно из: ${REPEATS.join(', ')}`);
  return s;
}

async function eventAdd(db, uid, title, flags) {
  const ev = clean({
    id: randomUUID(),
    title,
    date: parseDate(flags.date ?? 'today') ?? toKey(new Date()),
    start: parseTime(flags.start),
    end: parseTime(flags.end),
    desc: typeof flags.desc === 'string' ? flags.desc : undefined,
    repeat: parseRepeat(flags.repeat),
    repeatUntil: 'until' in flags ? parseDate(flags.until) : undefined,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  await mutateList(db, uid, 'events', (list) => ({ list: [ev, ...list], out: ev }));
  return ev;
}

/** Ищет событие по id или подстроке названия среди живых записей. */
function findEvents(events, query) {
  const byId = visible(events).filter((e) => e.id === query);
  if (byId.length) return byId;
  const q = query.toLowerCase();
  return visible(events).filter((e) => (e.title ?? '').toLowerCase().includes(q));
}

/** Одно событие по запросу; ошибка, если не найдено или найдено несколько. */
function oneEvent(events, query) {
  const found = findEvents(events, query);
  if (found.length === 0) throw new Error(`не нашёл событие: "${query}"`);
  if (found.length > 1) {
    throw new Error(
      `подходит несколько событий:\n${found.map((e) => `  · ${e.title} (${e.date})`).join('\n')}`,
    );
  }
  return found[0];
}

/** Локация — заметка типа 'location' (см. lib/locations.ts). Ищет по названию. */
async function findLocation(db, uid, query) {
  const snap = await db.collection(`users/${uid}/notes`).get();
  const all = snap.docs.map((d) => d.data()).filter((n) => !n.deleted && n.type === 'location');
  const byId = all.filter((n) => n.id === query);
  if (byId.length) return byId[0];
  const q = query.toLowerCase();
  const hit = all.filter((n) => (n.title ?? '').toLowerCase().includes(q));
  if (hit.length === 0) throw new Error(`не нашёл локацию: "${query}"`);
  if (hit.length > 1) {
    throw new Error(`подходит несколько локаций:\n${hit.map((n) => `  · ${n.title}`).join('\n')}`);
  }
  return hit[0];
}

/** Повторы: попадает ли событие на день (упрощённая версия recurrence.ts). */
function eventOnDay(ev, key) {
  if (ev.date === key) return true;
  const repeat = ev.repeat ?? 'none';
  if (repeat === 'none') return false;
  if (key < ev.date) return false;
  if (ev.repeatUntil && key > ev.repeatUntil) return false;
  const a = fromKey(ev.date);
  const b = fromKey(key);
  if (repeat === 'daily') return true;
  if (repeat === 'weekly') return a.getDay() === b.getDay();
  if (repeat === 'monthly') return a.getDate() === b.getDate();
  if (repeat === 'yearly') return a.getDate() === b.getDate() && a.getMonth() === b.getMonth();
  return false;
}

// ---------- Финансы ----------
//
// Подколлекция users/{uid}/finance, по документу на запись (см. lib/finance.ts).
// Валюта в приложении одна на всё (localStorage `ndc.currency`), у записи
// своего поля валюты нет — если сумма в другой валюте, это пишется в note.
//
// Суммы храним целыми: приложение всё равно показывает их округлёнными
// (formatMoney), а дробные хвосты после пересчёта по курсу только мешают
// сверять учёт с записками контрагентов.

const FIN_KINDS = ['expense', 'income', 'lent', 'borrowed', 'return_in', 'return_out'];

/** Вклад записи в баланс: + мне должны, − я должен (как debtSign). */
function debtSign(kind) {
  if (kind === 'lent' || kind === 'return_out') return 1;
  if (kind === 'borrowed' || kind === 'return_in') return -1;
  return 0;
}

/** Деньги для вывода: до копеек, без хвостов двоичной дроби (653.47999… → 653.48). */
function money(n) {
  return String(Math.round(n * 100) / 100);
}

const FIN_LABEL = {
  expense: 'Расход',
  income: 'Доход',
  lent: 'Дал в долг',
  borrowed: 'Взял в долг',
  return_in: 'Мне вернули',
  return_out: 'Я вернул',
};

async function financeAdd(db, uid, flags) {
  const kind = String(flags.kind ?? 'lent');
  if (!FIN_KINDS.includes(kind)) {
    throw new Error(`вид записи — одно из: ${FIN_KINDS.join(', ')}`);
  }
  const amount = Math.round(Number(flags.amount));
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('нужна положительная сумма: --amount 200');
  }
  if (debtSign(kind) !== 0 && !flags.person) {
    throw new Error('для долга нужен контрагент: --person "Имя"');
  }
  const now = Date.now();
  const entry = clean({
    id: randomUUID(),
    kind,
    amount,
    date: parseDate(flags.date ?? 'today') ?? toKey(new Date()),
    person: typeof flags.person === 'string' ? flags.person : undefined,
    category: typeof flags.category === 'string' ? flags.category : '',
    note: typeof flags.note === 'string' ? flags.note : '',
    createdAt: now,
    updatedAt: now,
    deleted: false,
  });
  await db.doc(`users/${uid}/finance/${entry.id}`).set(entry);
  return entry;
}

/** Ищет запись финансов по id либо по подстроке в контрагенте/примечании. */
function findFinance(entries, query) {
  const byId = entries.filter((e) => e.id === query);
  if (byId.length) return byId;
  const q = query.toLowerCase();
  return entries.filter((e) =>
    `${e.person ?? ''} ${e.note ?? ''} ${e.amount}`.toLowerCase().includes(q),
  );
}

/** Правка записи финансов на месте: id и createdAt сохраняются. */
async function financeSet(db, uid, query, flags) {
  const found = findFinance(await financeAll(db, uid), query);
  if (found.length === 0) throw new Error(`не нашёл запись финансов: "${query}"`);
  if (found.length > 1) {
    const rows = found.map((e) => `  · ${e.date} ${e.person ?? ''} ${e.amount} ${e.note ?? ''}`);
    throw new Error(`подходит несколько записей:\n${rows.join('\n')}`);
  }
  const e = found[0];
  const patch = clean({
    amount: 'amount' in flags ? Math.round(Number(flags.amount)) : undefined,
    date: 'date' in flags ? parseDate(flags.date) : undefined,
    person: typeof flags.person === 'string' ? flags.person : undefined,
    note: typeof flags.note === 'string' ? flags.note : undefined,
    kind: typeof flags.kind === 'string' ? flags.kind : undefined,
    updatedAt: Date.now(),
  });
  if (patch.amount !== undefined && (!Number.isFinite(patch.amount) || patch.amount <= 0)) {
    throw new Error('сумма должна быть положительным числом');
  }
  if (patch.kind !== undefined && !FIN_KINDS.includes(patch.kind)) {
    throw new Error(`вид записи — одно из: ${FIN_KINDS.join(', ')}`);
  }
  if (Object.keys(patch).length === 1) {
    throw new Error('нечего менять: укажи --amount / --date / --note / --person / --kind');
  }
  await db.doc(`users/${uid}/finance/${e.id}`).set(patch, { merge: true });
  return { before: e, after: { ...e, ...patch } };
}

/** Мягкое удаление записи финансов (надгробие — чтобы дошло до устройств). */
async function financeRemove(db, uid, query) {
  const found = findFinance(await financeAll(db, uid), query);
  if (found.length === 0) throw new Error(`не нашёл запись финансов: "${query}"`);
  if (found.length > 1) {
    const rows = found.map((e) => `  · ${e.date} ${e.person ?? ''} ${e.amount} ${e.note ?? ''}`);
    throw new Error(`подходит несколько записей:\n${rows.join('\n')}`);
  }
  const e = found[0];
  await db.doc(`users/${uid}/finance/${e.id}`).set(
    { deleted: true, updatedAt: Date.now() },
    { merge: true },
  );
  return e;
}

async function financeAll(db, uid) {
  const snap = await db.collection(`users/${uid}/finance`).get();
  return snap.docs.map((d) => d.data()).filter((e) => !e.deleted);
}

/** Балансы по контрагентам: >0 — должны мне, <0 — должен я. */
function personBalances(entries) {
  const m = new Map();
  for (const e of entries) {
    if (!debtSign(e.kind) || !e.person) continue;
    const cur = m.get(e.person) ?? { net: 0, last: '' };
    cur.net += debtSign(e.kind) * e.amount;
    if (e.date > cur.last) cur.last = e.date;
    m.set(e.person, cur);
  }
  return [...m.entries()]
    .map(([person, v]) => ({ person, ...v }))
    .sort((a, b) => a.person.localeCompare(b.person));
}

// ---------- Заметки ----------

/** Виды записей дневника здоровья (см. HealthKind в types.ts). */
const HEALTH_KINDS = ['meal', 'med', 'other'];

/** Папка дневника здоровья: записи висят в ней связью child (lib/health.ts). */
const HEALTH_FOLDER_ID = 'health-folder';

/** Папка «Места»: локации висят в ней такой же связью (lib/locations.ts). */
const LOCATIONS_FOLDER_ID = 'places-folder';

/** Категории локаций — держать в согласии с LOCATION_CATEGORIES в lib/locations.ts. */
const LOCATION_CATEGORIES = [
  'Дом',
  'Работа',
  'Учёба',
  'Мечеть',
  'Магазин',
  'Рынок',
  'Аптека',
  'Клиника',
  'Больница',
  'Кафе',
  'Ресторан',
  'Заправка',
  'Банк',
  'Госуслуги',
  'Спорт',
  'Сервис',
  'Парковка',
  'Зиярат',
  'Транспорт',
  'Другое',
];

async function noteAdd(db, uid, title, flags) {
  const now = Date.now();
  const health = typeof flags.health === 'string' ? flags.health : undefined;
  if (health && !HEALTH_KINDS.includes(health)) {
    throw new Error(`вид записи здоровья — одно из: ${HEALTH_KINDS.join(', ')}`);
  }
  const type = typeof flags.type === 'string' ? flags.type : 'note';
  const isLocation = type === 'location';
  const category = typeof flags.category === 'string' ? flags.category : undefined;
  if (isLocation && category && !LOCATION_CATEGORIES.includes(category)) {
    throw new Error(`категория локации — одна из: ${LOCATION_CATEGORIES.join(', ')}`);
  }
  const note = clean({
    id: randomUUID(),
    title,
    body: typeof flags.body === 'string' ? flags.body : '',
    type,
    // Запись здоровья всегда привязана ко дню: без даты она не попадёт ни в
    // дневник, ни в сводку. Поэтому по умолчанию — сегодня.
    date: 'date' in flags ? parseDate(flags.date) : health ? toKey(new Date()) : null,
    time: 'time' in flags ? parseTime(flags.time) : undefined,
    health,
    // Адрес локации: ссылка на карту либо текст (см. mapLink в lib/locations.ts).
    address: typeof flags.address === 'string' ? flags.address : isLocation ? '' : undefined,
    category: category ?? (isLocation ? 'Другое' : undefined),
    createdAt: now,
    updatedAt: now,
  });
  await db.doc(`users/${uid}/notes/${note.id}`).set(note);

  // Записи здоровья и локации лежат в своих служебных папках — приложение
  // собирает их именно оттуда, без связи запись останется «бесхозной».
  const folder = health ? HEALTH_FOLDER_ID : isLocation ? LOCATIONS_FOLDER_ID : null;
  if (folder) {
    const rel = {
      id: randomUUID(),
      from: folder,
      to: note.id,
      type: 'child',
      createdAt: now,
      updatedAt: now,
    };
    await db.doc(`users/${uid}/relations/${rel.id}`).set(rel);
  }
  return note;
}

/** Ищет заметку по id или по подстроке заголовка. */
async function findNotes(db, uid, query) {
  const snap = await db.collection(`users/${uid}/notes`).get();
  const all = snap.docs.map((d) => d.data()).filter((n) => !n.deleted);
  const byId = all.filter((n) => n.id === query);
  if (byId.length) return byId;
  const q = query.toLowerCase();
  return all.filter((n) => (n.title ?? '').toLowerCase().includes(q));
}

/** Одна заметка по запросу; ошибка, если не найдена или найдено несколько. */
async function oneNote(db, uid, query) {
  const found = await findNotes(db, uid, query);
  if (found.length === 0) throw new Error(`не нашёл заметку: "${query}"`);
  if (found.length > 1) {
    const rows = found.map((n) => `  · ${n.title} (${n.type ?? 'note'}, id=${n.id})`);
    throw new Error(`подходит несколько заметок:\n${rows.join('\n')}`);
  }
  return found[0];
}

async function noteList(db, uid, limit) {
  const snap = await db.collection(`users/${uid}/notes`).get();
  return snap.docs
    .map((d) => d.data())
    .filter((n) => !n.deleted)
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    .slice(0, limit);
}

// ---------- Вывод ----------

const RU_DAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

function dayLabel(key) {
  const today = toKey(new Date());
  const wd = RU_DAYS[fromKey(key).getDay()];
  if (key === today) return `${key} (${wd}, сегодня)`;
  if (key === toKey(addDays(new Date(), 1))) return `${key} (${wd}, завтра)`;
  return `${key} (${wd})`;
}

function printTasks(tasks) {
  if (!tasks.length) {
    console.log('  (пусто)');
    return;
  }
  for (const t of tasks) {
    const mark = t.item.done ? '✓' : '·';
    const where = t.listTitle ? ` [${t.listTitle}]` : '';
    console.log(`  ${mark} ${t.path}${where}`);
  }
}

// ---------- Команды ----------

async function main() {
  loadEnv();
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const [group, action, ...rest] = positional;
  const json = !!flags.json;

  if (!group || group === 'help' || flags.help) {
    console.log(HELP);
    return;
  }

  const { db, auth } = connect();

  // who — список аккаунтов проекта (чтобы узнать uid/email владельца).
  if (group === 'who') {
    const users = await auth.listUsers(100);
    const rows = users.users.map((u) => ({
      uid: u.uid,
      email: u.email,
      lastSignIn: u.metadata.lastSignInTime,
    }));
    console.log(json ? JSON.stringify(rows, null, 2) : rows.map(fmtUser).join('\n'));
    return;
  }

  const uid = await resolveUid(auth);

  if (group === 'task') {
    if (action === 'add') {
      const text = rest.join(' ').trim();
      if (!text) throw new Error('нужен текст задачи: task add "..."');
      const { item, list } = await taskAdd(db, uid, text, flags);
      const when = list.date ? ` на ${list.date}` : ' (без даты)';
      console.log(json ? JSON.stringify(item) : `Добавил: ${item.text}${when}`);
      return;
    }
    if (action === 'list') {
      const lists = await readList(db, uid, 'checklists');
      let tasks = flatten(lists);
      if (flags.open) tasks = tasks.filter((t) => !t.item.done);
      if (flags.date) {
        const key = parseDate(flags.date);
        tasks = tasks.filter((t) => t.date === key);
      }
      if (json) {
        console.log(JSON.stringify(tasks, null, 2));
        return;
      }
      const byDate = new Map();
      for (const t of tasks) {
        const k = t.date ?? 'без даты';
        if (!byDate.has(k)) byDate.set(k, []);
        byDate.get(k).push(t);
      }
      for (const k of [...byDate.keys()].sort()) {
        console.log(k === 'без даты' ? '\nБез даты' : `\n${dayLabel(k)}`);
        printTasks(byDate.get(k));
      }
      if (!tasks.length) console.log('Задач нет.');
      return;
    }
    if (action === 'done' || action === 'undo' || action === 'rm') {
      const query = rest.join(' ').trim();
      if (!query) throw new Error(`нужен текст или id задачи: task ${action} "..."`);
      const t = await taskEdit(db, uid, query, action === 'undo' ? 'undone' : action);
      const verb = { done: 'Выполнено', undo: 'Снял отметку', rm: 'Удалил' }[action];
      console.log(json ? JSON.stringify(t) : `${verb}: ${t.path}`);
      return;
    }
    throw new Error(`не знаю команду task ${action ?? ''}`);
  }

  if (group === 'event') {
    if (action === 'add') {
      const title = rest.join(' ').trim();
      if (!title) throw new Error('нужно название события: event add "..."');
      const ev = await eventAdd(db, uid, title, flags);
      const time = ev.start ? ` в ${ev.start}${ev.end ? `–${ev.end}` : ''}` : '';
      console.log(json ? JSON.stringify(ev) : `Записал: ${ev.title} — ${ev.date}${time}`);
      return;
    }
    if (action === 'list') {
      const events = visible(await readList(db, uid, 'events'));
      if (json) {
        console.log(JSON.stringify(events, null, 2));
        return;
      }
      for (const ev of events.sort((a, b) => a.date.localeCompare(b.date))) {
        const time = ev.start ? ` ${ev.start}${ev.end ? `–${ev.end}` : ''}` : '';
        console.log(`  ${ev.date}${time}  ${ev.title}`);
      }
      if (!events.length) console.log('Событий нет.');
      return;
    }
    // Правка события: --location привязывает к месту из справочника (locationId).
    if (action === 'set') {
      const query = rest.join(' ').trim();
      if (!query) throw new Error('нужен id или подстрока: event set "..." --start 15:00');
      const location =
        typeof flags.location === 'string' ? await findLocation(db, uid, flags.location) : null;
      const patch = clean({
        title: typeof flags.title === 'string' ? flags.title : undefined,
        date: 'date' in flags ? parseDate(flags.date) : undefined,
        start: 'start' in flags ? parseTime(flags.start) : undefined,
        end: 'end' in flags ? parseTime(flags.end) : undefined,
        desc: typeof flags.desc === 'string' ? flags.desc : undefined,
        repeat: parseRepeat(flags.repeat),
        repeatUntil: 'until' in flags ? parseDate(flags.until) : undefined,
        locationId: location ? location.id : undefined,
        updatedAt: Date.now(),
      });
      if (Object.keys(patch).length === 1) {
        throw new Error(
          'нечего менять: укажи --title / --date / --start / --end / --desc / --repeat / --location',
        );
      }
      const updated = await mutateList(db, uid, 'events', (list) => {
        const ev = oneEvent(list, query);
        return {
          list: list.map((e) => (e.id === ev.id ? { ...e, ...patch } : e)),
          out: { ...ev, ...patch },
        };
      });
      const where = location ? `, место: ${location.title}` : '';
      console.log(json ? JSON.stringify(updated) : `Обновил: ${updated.title} (${updated.date})${where}`);
      return;
    }
    if (action === 'rm') {
      const query = rest.join(' ').trim();
      const removed = await mutateList(db, uid, 'events', (list) => {
        const ev = oneEvent(list, query);
        const now = Date.now();
        return {
          list: list.map((e) => (e.id === ev.id ? { ...e, deleted: true, updatedAt: now } : e)),
          out: ev,
        };
      });
      console.log(json ? JSON.stringify(removed) : `Удалил событие: ${removed.title}`);
      return;
    }
    throw new Error(`не знаю команду event ${action ?? ''}`);
  }

  if (group === 'finance') {
    if (action === 'add') {
      const entry = await financeAdd(db, uid, flags);
      const who = entry.person ? ` — ${entry.person}` : '';
      const note = entry.note ? ` (${entry.note})` : '';
      console.log(
        json
          ? JSON.stringify(entry)
          : `${FIN_LABEL[entry.kind]}${who}: ${entry.amount}${note}, ${entry.date}`,
      );
      return;
    }
    if (action === 'list') {
      let entries = await financeAll(db, uid);
      if (typeof flags.person === 'string') entries = entries.filter((e) => e.person === flags.person);
      entries.sort((a, b) => (a.date === b.date ? a.createdAt - b.createdAt : a.date < b.date ? -1 : 1));
      if (json) {
        console.log(JSON.stringify(entries, null, 2));
        return;
      }
      let run = 0;
      for (const e of entries) {
        run += debtSign(e.kind) * e.amount;
        const who = e.person ? ` ${e.person}` : '';
        const note = e.note ? ` — ${e.note}` : '';
        const total = debtSign(e.kind) ? `   итог ${money(run)}` : '';
        console.log(`  ${e.date}  ${FIN_LABEL[e.kind]}${who}: ${money(e.amount)}${note}${total}`);
      }
      if (!entries.length) console.log('Записей нет.');
      return;
    }
    if (action === 'balance' || action === undefined) {
      const balances = personBalances(await financeAll(db, uid));
      if (json) {
        console.log(JSON.stringify(balances, null, 2));
        return;
      }
      for (const b of balances) {
        const who = b.net > 0 ? 'должен мне' : 'я должен';
        console.log(`  ${b.person}: ${who} ${money(Math.abs(b.net))}   (посл. ${b.last})`);
      }
      if (!balances.length) console.log('Долгов нет.');
      return;
    }
    if (action === 'set') {
      const query = rest.join(' ').trim();
      if (!query) throw new Error('нужен id или подстрока: finance set "..." --amount N');
      const { before, after } = await financeSet(db, uid, query, flags);
      console.log(
        json
          ? JSON.stringify(after)
          : `Исправил: ${before.person ?? ''} ${money(before.amount)} → ${money(after.amount)} (${after.date})`,
      );
      return;
    }
    if (action === 'rm') {
      const query = rest.join(' ').trim();
      if (!query) throw new Error('нужен id или подстрока: finance rm "..."');
      const e = await financeRemove(db, uid, query);
      const who = e.person ? ` ${e.person}` : '';
      console.log(json ? JSON.stringify(e) : `Удалил из финансов:${who} ${e.amount} (${e.date})`);
      return;
    }
    throw new Error(`не знаю команду finance ${action ?? ''}`);
  }

  if (group === 'note') {
    if (action === 'add') {
      const title = rest.join(' ').trim();
      if (!title) throw new Error('нужен заголовок: note add "..."');
      const note = await noteAdd(db, uid, title, flags);
      console.log(json ? JSON.stringify(note) : `Заметка сохранена: ${note.title}`);
      return;
    }
    if (action === 'list') {
      const limit = Number(flags.limit ?? 20);
      const notes = await noteList(db, uid, limit);
      if (json) {
        console.log(JSON.stringify(notes, null, 2));
        return;
      }
      for (const n of notes) {
        const preview = (n.body ?? '').replace(/\s+/g, ' ').slice(0, 60);
        console.log(`  ${n.title || '(без заголовка)'}${preview ? ` — ${preview}` : ''}`);
      }
      if (!notes.length) console.log('Заметок нет.');
      return;
    }
    if (action === 'show') {
      const note = await oneNote(db, uid, rest.join(' ').trim());
      console.log(json ? JSON.stringify(note, null, 2) : `${note.title}\n\n${note.body ?? ''}`);
      return;
    }
    // Правка заметки: --body заменяет текст целиком, --title переименовывает.
    if (action === 'edit') {
      const note = await oneNote(db, uid, rest.join(' ').trim());
      const category = typeof flags.category === 'string' ? flags.category : undefined;
      if (category && note.type === 'location' && !LOCATION_CATEGORIES.includes(category)) {
        throw new Error(`категория локации — одна из: ${LOCATION_CATEGORIES.join(', ')}`);
      }
      const patch = clean({
        title: typeof flags.title === 'string' ? flags.title : undefined,
        body: typeof flags.body === 'string' ? flags.body : undefined,
        address: typeof flags.address === 'string' ? flags.address : undefined,
        category,
        updatedAt: Date.now(),
      });
      if (Object.keys(patch).length === 1) {
        throw new Error('нечего менять: укажи --title / --body / --address / --category');
      }
      await db.doc(`users/${uid}/notes/${note.id}`).set(patch, { merge: true });
      console.log(json ? JSON.stringify({ ...note, ...patch }) : `Заметка обновлена: ${patch.title ?? note.title}`);
      return;
    }
    if (action === 'rm') {
      const note = await oneNote(db, uid, rest.join(' ').trim());
      await db.doc(`users/${uid}/notes/${note.id}`).set(
        { deleted: true, updatedAt: Date.now() },
        { merge: true },
      );
      console.log(json ? JSON.stringify(note) : `Удалил заметку: ${note.title}`);
      return;
    }
    throw new Error(`не знаю команду note ${action ?? ''}`);
  }

  // agenda — сводка на несколько дней: события + невыполненные задачи.
  if (group === 'agenda') {
    const days = Number(flags.days ?? 3);
    const from = parseDate(flags.date ?? 'today') ?? toKey(new Date());
    const lists = await readList(db, uid, 'checklists');
    const events = visible(await readList(db, uid, 'events'));
    const tasks = flatten(lists).filter((t) => !t.item.done);

    const result = [];
    for (let i = 0; i < days; i++) {
      const key = toKey(addDays(fromKey(from), i));
      result.push({
        date: key,
        events: events.filter((e) => eventOnDay(e, key)),
        tasks: tasks.filter((t) => t.date === key),
      });
    }
    const overdue = tasks.filter((t) => t.date && t.date < from);
    const undated = tasks.filter((t) => !t.date);

    if (json) {
      console.log(JSON.stringify({ from, days, overdue, undated, agenda: result }, null, 2));
      return;
    }
    if (overdue.length) {
      console.log('Просрочено');
      printTasks(overdue);
    }
    for (const d of result) {
      if (!d.events.length && !d.tasks.length) continue;
      console.log(`\n${dayLabel(d.date)}`);
      for (const ev of d.events.sort((a, b) => (a.start ?? '').localeCompare(b.start ?? ''))) {
        const time = ev.start ? `${ev.start}${ev.end ? `–${ev.end}` : ''}` : '  —  ';
        console.log(`  ${time}  ${ev.title}`);
      }
      printTasks(d.tasks);
    }
    if (undated.length) {
      console.log('\nБез даты');
      printTasks(undated);
    }
    return;
  }

  // batch — пачка записей из JSON-файла (или stdin с "-").
  if (group === 'batch') {
    const src = action === '-' || !action ? 0 : action;
    const payload = JSON.parse(readFileSync(src, 'utf8'));
    const entries = Array.isArray(payload) ? payload : [payload];
    const done = [];
    for (const e of entries) {
      if (e.kind === 'task') {
        const { item } = await taskAdd(db, uid, e.text, e);
        done.push(`задача: ${item.text}`);
      } else if (e.kind === 'event') {
        const ev = await eventAdd(db, uid, e.title, e);
        done.push(`событие: ${ev.title} (${ev.date})`);
      } else if (e.kind === 'note') {
        const n = await noteAdd(db, uid, e.title, e);
        done.push(`заметка: ${n.title}`);
      } else {
        throw new Error(`неизвестный kind: ${JSON.stringify(e.kind)}`);
      }
    }
    console.log(json ? JSON.stringify(done) : `Добавлено ${done.length}:\n  ${done.join('\n  ')}`);
    return;
  }

  throw new Error(`не знаю команду "${group}". Подсказка: node scripts/secretary.mjs help`);
}

const fmtUser = (u) => `  ${u.email ?? '(без email)'}  uid=${u.uid}  вход: ${u.lastSignIn ?? '—'}`;

const HELP = `Секретарь notedocal — запись и чтение дел из командной строки.

  who                                 аккаунты проекта (найти свой uid/email)

  task add "текст" [--date D] [--list "Название"] [--desc "..."]
                   --date ставит день самой задаче, список остаётся в своей
                   категории. Датировать список целиком — --list-date D.
  task list [--open] [--date D]
  task done "текст или id"
  task undo "текст или id"
  task rm   "текст или id"

  event add "название" --date D [--start HH:mm] [--end HH:mm] [--desc "..."]
                       [--repeat daily|weekly|monthly|yearly] [--until D]
  event list
  event set "название или id" [--title "..."] [--date D] [--start HH:mm]
            [--end HH:mm] [--desc "..."] [--location "место из справочника"]
            [--repeat none|daily|weekly|monthly|yearly] [--until D]
  event rm "название или id"

  note add "заголовок" [--body "..."] [--date D]
                       [--health meal|med|other] [--time HH:mm]
                       с --health запись попадает в дневник здоровья
                       --type location [--address "ссылка/адрес"] [--category ...]
                       заводит место в справочнике («Места»)
  note list [--limit N]
  note show "заголовок или id"
  note edit "заголовок или id" [--title "..."] [--body "..."]
                               [--address "..."] [--category "..."]
  note rm   "заголовок или id"

  finance add --amount N [--kind lent|borrowed|return_in|return_out|expense|income]
              [--person "Имя"] [--date D] [--note "..."] [--category "..."]
              вид по умолчанию lent («дал в долг», мне должны)
  finance list [--person "Имя"]        хронология с нарастающим итогом
  finance balance                      кто сколько должен
  finance set "id или подстрока" [--amount N] [--date D] [--note "..."]
              [--person "Имя"] [--kind ...]      правка записи на месте
  finance rm "id или подстрока"

  agenda [--date D] [--days N]        сводка: события + открытые задачи

  batch файл.json                     пачка записей ([{kind:"task",text:…}, …])

Даты (D): сегодня | завтра | послезавтра | пн…вс | +3 | 14.08 | 2026-08-14 | none
Флаг --json у любой команды — машинный вывод.

Владелец данных: SECRETARY_EMAIL (или SECRETARY_UID) в .env.
Ключ доступа: SECRETARY_KEY (JSON или base64), иначе
GOOGLE_APPLICATION_CREDENTIALS или ./service-account.json`;

// Чистые функции вынесены наружу — чтобы их можно было проверить
// (scripts/secretary.test.mjs) без обращения к Firebase.
export {
  parseArgs,
  parseDate,
  parseTime,
  toKey,
  fromKey,
  flatten,
  treeUpdate,
  treeRemove,
  findTasks,
  eventOnDay,
  debtSign,
  personBalances,
  money,
  parseKeyMaterial,
  parseRepeat,
};

// Запуск как команда — только когда файл вызван напрямую, а не импортирован.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`Ошибка: ${err.message}`);
    process.exit(1);
  });
}
