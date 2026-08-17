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
import { getStorage } from 'firebase-admin/storage';

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

/** Бакет Storage совпадает с тем, что зашит в src/lib/firebaseConfig.ts. */
const STORAGE_BUCKET = 'notedocal.firebasestorage.app';

function connect() {
  initializeApp({ credential: cert(loadKey()), storageBucket: STORAGE_BUCKET });
  return { db: getFirestore(), auth: getAuth(), bucket: getStorage().bucket() };
}

/**
 * Скачивает картинку по ссылке и кладёт в Storage как вложение — тем же путём
 * и с той же ссылкой, что делает приложение (`users/{uid}/files/{id}-{имя}`
 * плюс токен скачивания), иначе картинка не откроется в карточке.
 */
async function uploadPhotoFromUrl(bucket, uid, url, name = 'photo.jpg') {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`не скачать фото (${res.status})`);
  const type = res.headers.get('content-type') || 'image/jpeg';
  if (!type.startsWith('image/')) throw new Error(`по ссылке не картинка (${type})`);
  const bytes = Buffer.from(await res.arrayBuffer());

  const id = randomUUID();
  // Кириллица и пробелы вычищаются целиком, поэтому проверяем, что осталось
  // осмысленное имя, а не строка из подчёркиваний.
  const cleaned = name.replace(/[^\w.-]+/g, '_').slice(-60);
  const safe = /[a-z0-9]/i.test(cleaned) ? cleaned : 'photo.jpg';
  const path = `users/${uid}/files/${id}-${safe}`;
  const token = randomUUID();
  await bucket.file(path).save(bytes, {
    contentType: type,
    metadata: { metadata: { firebaseStorageDownloadTokens: token } },
  });
  return {
    id,
    name: safe,
    size: bytes.length,
    type,
    url: `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`,
    path,
    createdAt: Date.now(),
  };
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

/** Список-свалка: сюда падает надиктованное, пока не разобрано (INBOX_TITLE
 *  в src/lib/tasks.ts). */
const INBOX_TITLE = 'Входящие';

const TASK_STATUSES = ['active', 'someday', 'waiting'];
const TASK_PRIORITIES = ['low', 'normal', 'high'];

/** Синонимы, чтобы диктовать по-русски: `--status жду`, `--priority важно`. */
const STATUS_ALIASES = {
  active: 'active', активная: 'active', вработе: 'active',
  someday: 'someday', 'когда-нибудь': 'someday', замысел: 'someday', идея: 'someday',
  waiting: 'waiting', жду: 'waiting', ожидание: 'waiting',
};
const PRIORITY_ALIASES = {
  high: 'high', важно: 'high', важное: 'high', срочно: 'high',
  normal: 'normal', обычно: 'normal', обычное: 'normal',
  low: 'low', низкий: 'low', 'не-горит': 'low',
};

function parseStatus(raw) {
  if (typeof raw !== 'string') return undefined;
  const v = STATUS_ALIASES[raw.trim().toLowerCase()];
  if (!v) throw new Error(`состояние — одно из: ${TASK_STATUSES.join(', ')} (или жду / когда-нибудь)`);
  return v === 'active' ? undefined : v; // active — значение по умолчанию, не храним
}

function parsePriority(raw) {
  if (typeof raw !== 'string') return undefined;
  const v = PRIORITY_ALIASES[raw.trim().toLowerCase()];
  if (!v) throw new Error(`важность — одно из: ${TASK_PRIORITIES.join(', ')} (или важно / не-горит)`);
  return v === 'normal' ? undefined : v;
}

/** Размер задачи в минутах: «15», «15м», «1ч». */
function parseSize(raw) {
  if (raw === undefined || raw === true) return undefined;
  const s = String(raw).trim().toLowerCase();
  const m = /^(\d+)\s*(м|мин|m|ч|h)?$/.exec(s);
  if (!m) throw new Error('размер — число минут: --size 15 (или 1ч)');
  const n = Number(m[1]);
  return m[2] === 'ч' || m[2] === 'h' ? n * 60 : n;
}

const normTag = (raw) => String(raw).trim().replace(/^#/, '').toLowerCase();

/** `--tag купить,позвонить` → ['купить','позвонить']. */
function parseTags(raw) {
  if (typeof raw !== 'string') return [];
  return raw
    .split(',')
    .map(normTag)
    .filter(Boolean);
}

/** Вынимает «#теги» из текста (тот же разбор, что в src/lib/tasks.ts). */
function extractTags(text) {
  const tags = [];
  const cleaned = String(text)
    .replace(/(^|\s)#([^\s#]+)/g, (_m, space, tag) => {
      const t = normTag(tag);
      if (t && !tags.includes(t)) tags.push(t);
      return space;
    })
    .replace(/\s{2,}/g, ' ')
    .trim();
  return { text: cleaned, tags };
}

/**
 * Автораскладка надиктованного: по ключевым словам угадывает список и тип
 * действия. Правило одно — угадали, кладём в сферу; не угадали, кладём во
 * «Входящие» и разбираем потом. Свалка должна быть осознанной, а не «Нужно»,
 * куда сыпется всё, что никуда не подошло.
 */
// ⚠️ Никаких \b в шаблонах: в JavaScript граница слова считается по ASCII
// (\w = [A-Za-z0-9_]), поэтому у кириллицы её просто нет — «карту » мимо
// /карт[ауы]\b/. Конец слова закрываем через (?![а-яё]).
const ROUTES = [
  { list: 'Купить', tags: ['купить'], re: /купить|батарей|помп|масл[оа]|продукт/i },
  { list: 'Ислам', tags: ['написать'], re: /стать[ьяю]|книг[ауи]|маджлис|хадис|тафсир|намаз|фатв/i },
  { list: 'Прог', tags: ['код'], re: /лендинг|сайт|приложени|скрипт|прог(а|у|и)?(?![а-яё])|верстк|бот(?![а-яё])/i },
  { list: 'Нужно', tags: ['оформить'], re: /виз[аыу]|икам|карт[ауы](?![а-яё])|номер|паспорт|документ|банк|страхов/i },
  { list: 'Нужно', tags: ['позвонить'], re: /позвонить|написать\s+(ему|ей|им)|связаться|уточнить у/i },
  { list: 'Дом', tags: ['оплатить'], re: /оплат|счёт|счет за|электрич|свет(?![а-яё])|вода(?![а-яё])|аренд|интернет|wifi|вайфай/i },
  { list: 'Семья', tags: [], re: /жен[еа](?![а-яё])|дет[ямис]|ханифа|аят(?![а-яё])|хаммад|ортодонт|подолог|школ/i },
];

function routeTask(text, tags = []) {
  for (const r of ROUTES) {
    if (r.re.test(text)) return { list: r.list, tags: r.tags };
  }
  // Тег задали руками — доверяем ему и не отправляем во «Входящие» вслепую.
  if (tags.length) return { list: INBOX_TITLE, tags: [] };
  return { list: INBOX_TITLE, tags: [] };
}

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
async function taskAdd(db, uid, rawText, flags) {
  const date = 'list-date' in flags ? parseDate(flags['list-date']) : null;
  const { text, tags: inlineTags } = extractTags(rawText);
  const given = [...new Set([...inlineTags, ...parseTags(flags.tag)])];
  const routed = routeTask(text, given);
  const listTitle =
    typeof flags.list === 'string' && flags.list.trim() ? flags.list.trim() : routed.list;
  const tags = [...new Set([...given, ...routed.tags])];

  const item = clean({
    id: randomUUID(),
    text,
    done: false,
    desc: typeof flags.desc === 'string' ? flags.desc : undefined,
    date: 'date' in flags ? parseDate(flags.date) : undefined,
    tags: tags.length ? tags : undefined,
    status: parseStatus(flags.status),
    waitingFor: typeof flags['waiting-for'] === 'string' ? flags['waiting-for'] : undefined,
    priority: parsePriority(flags.priority),
    sizeMin: parseSize(flags.size),
    repeat: 'repeat' in flags ? parseRepeat(flags.repeat) : undefined,
    repeatUntil: 'until' in flags ? parseDate(flags.until) : undefined,
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
          : treeUpdate(l.items, t.item.id, (it) =>
              action === 'done' ? completeTask(it) : { ...it, done: false },
            );
      return { ...l, items, updatedAt: now };
    });
    return { list, out: t };
  });
}

/**
 * Отметка «сделано» с учётом повтора (тот же расчёт, что toggleWithRepeat в
 * src/lib/tasks.ts): повторяющаяся задача не закрывается, а уезжает на
 * следующий срок — иначе её пришлось бы каждый раз заводить заново.
 */
function completeTask(it, today = toKey(new Date())) {
  const repeat = it.repeat ?? 'none';
  if (repeat === 'none') return { ...it, done: true };
  const from = it.date && it.date >= today ? it.date : today;
  const next = nextTaskDate(from, repeat);
  if (it.repeatUntil && next > it.repeatUntil) return { ...it, done: true };
  return { ...it, done: false, date: next, remindAt: null };
}

/** Следующий срок повторяющейся задачи (YYYY-MM-DD). */
function nextTaskDate(dateKey, repeat) {
  const [y, m, d] = dateKey.split('-').map(Number);
  if (repeat === 'daily') return toKey(addDays(fromKey(dateKey), 1));
  if (repeat === 'weekly') return toKey(addDays(fromKey(dateKey), 7));
  if (repeat === 'monthly') return toKey(new Date(y, m, d));
  if (repeat === 'yearly') return toKey(new Date(y + 1, m - 1, d));
  return dateKey;
}

/** Правка полей задачи на месте; `--list` переносит её в другой список. */
async function taskSet(db, uid, query, flags) {
  const patch = clean({
    text: typeof flags.text === 'string' ? flags.text : undefined,
    desc: typeof flags.desc === 'string' ? flags.desc : undefined,
    date: 'date' in flags ? parseDate(flags.date) : undefined,
    status: 'status' in flags ? (parseStatus(flags.status) ?? null) : undefined,
    waitingFor: typeof flags['waiting-for'] === 'string' ? flags['waiting-for'] : undefined,
    priority: 'priority' in flags ? (parsePriority(flags.priority) ?? null) : undefined,
    sizeMin: 'size' in flags ? (parseSize(flags.size) ?? null) : undefined,
    repeat: 'repeat' in flags ? parseRepeat(flags.repeat) : undefined,
    repeatUntil: 'until' in flags ? parseDate(flags.until) : undefined,
  });
  const tags = parseTags(flags.tag);
  const moveTo = typeof flags.list === 'string' ? flags.list.trim() : '';
  if (!Object.keys(patch).length && !tags.length && !moveTo) {
    throw new Error('нечего менять: --text / --date / --tag / --status / --priority / --size / --repeat / --list');
  }

  return mutateList(db, uid, 'checklists', (lists) => {
    const found = findTasks(lists, query);
    if (found.length === 0) throw new Error(`не нашёл задачу по запросу: "${query}"`);
    if (found.length > 1) {
      const names = found.map((t) => `  · ${t.path}`).join('\n');
      throw new Error(`под запрос "${query}" подходит несколько задач:\n${names}`);
    }
    const t = found[0];
    const now = Date.now();
    // null в patch означает «сбросить поле» (например, --priority normal).
    const apply = (it) => {
      const next = { ...it, ...patch };
      if (tags.length) next.tags = [...new Set([...(it.tags ?? []), ...tags])];
      for (const [k, v] of Object.entries(patch)) if (v === null) delete next[k];
      return next;
    };

    if (!moveTo || moveTo === t.listTitle) {
      const list = lists.map((l) =>
        l.id === t.listId ? { ...l, items: treeUpdate(l.items, t.item.id, apply), updatedAt: now } : l,
      );
      return { list, out: { ...t, item: apply(t.item) } };
    }

    // Перенос: вынимаем из старого списка и кладём в целевой (создаём, если нет).
    const moved = apply(t.item);
    let list = lists.map((l) =>
      l.id === t.listId ? { ...l, items: treeRemove(l.items, t.item.id), updatedAt: now } : l,
    );
    const target = list.find((l) => !l.deleted && (l.title ?? '').trim() === moveTo && !l.date);
    if (target) {
      list = list.map((l) =>
        l.id === target.id ? { ...l, items: [...(l.items ?? []), moved], updatedAt: now } : l,
      );
    } else {
      list = [
        { id: randomUUID(), title: moveTo, date: null, items: [moved], createdAt: now, updatedAt: now },
        ...list,
      ];
    }
    return { list, out: { ...t, item: moved, listTitle: moveTo } };
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

/** Папка «Контакты»: персоны висят в ней связью child (lib/persons.ts). */
const CONTACTS_FOLDER_ID = 'contacts-folder';

/** Способы связи в карточке персоны (ContactType в types.ts). */
const CONTACT_TYPES = ['phone', 'whatsapp', 'telegram', 'email', 'other'];

/**
 * Заводит персону в справочнике: заметка типа 'person' плюс связь с папкой
 * «Контакты» — ровно как DirectoryView.addPerson в приложении. Без связи
 * карточка осталась бы «бесхозной» и в справочнике не показалась.
 *
 * Если персона с таким именем есть — дописывает недостающие контакты, а не
 * плодит вторую карточку (имена в финансах сходятся по строке).
 */
async function personAdd(db, uid, name, flags) {
  const wanted = [];
  for (const type of CONTACT_TYPES) {
    const raw = flags[type];
    if (typeof raw !== 'string') continue;
    for (const value of raw.split(',').map((v) => v.trim()).filter(Boolean)) {
      wanted.push({ type, value });
    }
  }
  const key = (c) => `${c.type}:${c.value.replace(/\s+/g, '').toLowerCase()}`;
  const now = Date.now();

  const snap = await db.collection(`users/${uid}/notes`).get();
  const notes = snap.docs.map((d) => d.data()).filter((n) => !n.deleted);
  const existing = notes.find(
    (n) => n.type === 'person' && (n.title ?? '').trim().toLowerCase() === name.trim().toLowerCase(),
  );

  if (!notes.some((n) => n.id === CONTACTS_FOLDER_ID)) {
    await db.doc(`users/${uid}/notes/${CONTACTS_FOLDER_ID}`).set({
      id: CONTACTS_FOLDER_ID,
      title: 'Контакты',
      body: '',
      type: 'folder',
      date: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  if (existing) {
    const contacts = [...(existing.contacts ?? [])];
    const have = new Set(contacts.map(key));
    const added = wanted.filter((c) => !have.has(key(c)));
    if (added.length) {
      contacts.push(...added);
      await db.doc(`users/${uid}/notes/${existing.id}`).set({ ...existing, contacts, updatedAt: now });
    }
    return { person: { ...existing, contacts }, added, created: false };
  }

  const person = clean({
    id: randomUUID(),
    title: name,
    body: typeof flags.body === 'string' ? flags.body : '',
    type: 'person',
    date: null,
    contacts: wanted.length ? wanted : undefined,
    createdAt: now,
    updatedAt: now,
  });
  await db.doc(`users/${uid}/notes/${person.id}`).set(person);
  const rel = {
    id: randomUUID(),
    from: CONTACTS_FOLDER_ID,
    to: person.id,
    type: 'child',
    position: 0,
    createdAt: now,
    updatedAt: now,
  };
  await db.doc(`users/${uid}/relations/${rel.id}`).set(rel);
  return { person, added: wanted, created: true };
}

/** Категории локаций — держать в согласии с CATEGORY_GROUPS в lib/locations.ts. */
const LOCATION_CATEGORIES = [
  'Кафе',
  'Ресторан',
  'Сладости',
  'Магазин',
  'Рынок',
  'Продукты',
  'Парк',
  'Пляж',
  'Аквапарк',
  'Развлечения',
  'Отдых',
  'Спорт',
  'Достопримечательность',
  'Музей',
  'Природа',
  'Отель',
  'Мечеть',
  'Зиярат',
  'Аптека',
  'Клиника',
  'Больница',
  'Банк',
  'Госуслуги',
  'Сервис',
  'Заправка',
  'Парковка',
  'Транспорт',
  'Дом',
  'Работа',
  'Учёба',
  'Другое',
];

async function noteAdd(db, uid, title, flags, bucket) {
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
    // Город: по нему справочник группирует места (locationsByCity).
    city: typeof flags.city === 'string' ? flags.city : isLocation ? '' : undefined,
    category: category ?? (isLocation ? 'Другое' : undefined),
    createdAt: now,
    updatedAt: now,
  });
  // Фото по ссылке: скачиваем и кладём в Storage, чтобы место сразу было с
  // обложкой (ссылка на чужой хост со временем протухает).
  if (typeof flags.photo === 'string' && bucket) {
    const att = await uploadPhotoFromUrl(bucket, uid, flags.photo, `${title}.jpg`);
    note.attachments = [att];
  }
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

/** Значки измерений в строке вывода: важность, состояние, размер, теги, повтор. */
function taskBadges(it) {
  const parts = [];
  if (it.priority === 'high') parts.push('‼️');
  if (it.priority === 'low') parts.push('↓');
  if (it.status === 'waiting') parts.push(it.waitingFor ? `⏳ждёт: ${it.waitingFor}` : '⏳жду');
  if (it.status === 'someday') parts.push('💭');
  if (it.sizeMin) parts.push(it.sizeMin < 60 ? `${it.sizeMin}м` : `${Math.round(it.sizeMin / 60)}ч`);
  if (it.repeat && it.repeat !== 'none') parts.push('🔁');
  for (const t of it.tags ?? []) parts.push(`#${t}`);
  return parts.length ? ` ${parts.join(' ')}` : '';
}

function printTasks(tasks) {
  if (!tasks.length) {
    console.log('  (пусто)');
    return;
  }
  for (const t of tasks) {
    const mark = t.item.done ? '✓' : '·';
    const where = t.listTitle ? ` [${t.listTitle}]` : '';
    console.log(`  ${mark} ${t.path}${where}${taskBadges(t.item)}`);
  }
}

/** Фильтр задач для `task list` (те же срезы, что в приложении). */
function taskMatches(t, flags) {
  const it = t.item;
  if (flags.open && it.done) return false;
  const status = it.status ?? 'active';
  if (typeof flags.status === 'string') {
    if (status !== parseStatusFilter(flags.status)) return false;
  } else if (status === 'someday' && !flags.all) {
    return false; // замыслы не мешаются, пока их не спросили
  }
  const tags = parseTags(flags.tag);
  if (tags.length && !tags.every((x) => (it.tags ?? []).includes(x))) return false;
  if (flags.priority && (it.priority ?? 'normal') !== parsePriority(flags.priority)) return false;
  const size = parseSize(flags.size);
  if (size && (it.sizeMin ?? Infinity) > size) return false;
  if (typeof flags.list === 'string' && t.listTitle !== flags.list.trim()) return false;
  return true;
}

/** `--status активная` тоже должно работать, поэтому 'active' не схлопываем. */
function parseStatusFilter(raw) {
  const v = STATUS_ALIASES[String(raw).trim().toLowerCase()];
  if (!v) throw new Error(`состояние — одно из: ${TASK_STATUSES.join(', ')}`);
  return v;
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

  const { db, auth, bucket } = connect();

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
      const when = item.date ? ` на ${item.date}` : list.date ? ` на ${list.date}` : '';
      const where = list.title ? ` [${list.title}]` : '';
      console.log(
        json ? JSON.stringify(item) : `Добавил: ${item.text}${where}${when}${taskBadges(item)}`,
      );
      return;
    }
    if (action === 'list') {
      const lists = await readList(db, uid, 'checklists');
      let tasks = flatten(lists).filter((t) => taskMatches(t, flags));
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
      const repeats = action === 'done' && t.item.repeat && t.item.repeat !== 'none';
      const tail = repeats ? ' (повтор — уедет на следующий срок)' : '';
      console.log(json ? JSON.stringify(t) : `${verb}: ${t.path}${tail}`);
      return;
    }
    if (action === 'set') {
      const query = rest.join(' ').trim();
      if (!query) throw new Error('нужен текст или id задачи: task set "..." --tag …');
      const t = await taskSet(db, uid, query, flags);
      console.log(
        json ? JSON.stringify(t) : `Поправил: ${t.item.text} [${t.listTitle}]${taskBadges(t.item)}`,
      );
      return;
    }
    // Разбор входящих: показать свалку, чтобы разложить её командой task set.
    if (action === 'triage') {
      const lists = await readList(db, uid, 'checklists');
      const tasks = flatten(lists).filter(
        (t) => !t.item.done && t.listTitle === INBOX_TITLE,
      );
      if (json) {
        console.log(JSON.stringify(tasks, null, 2));
        return;
      }
      console.log(`Входящие: ${tasks.length}`);
      printTasks(tasks);
      if (tasks.length) {
        console.log('\nРазложить: task set "текст" --list "Дом" --tag оплатить --size 15');
      }
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
      const note = await noteAdd(db, uid, title, flags, bucket);
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
        city: typeof flags.city === 'string' ? flags.city : undefined,
        category,
        updatedAt: Date.now(),
      });
      if (Object.keys(patch).length === 1) {
        throw new Error('нечего менять: укажи --title / --body / --address / --city / --category');
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
    // Замыслы («когда-нибудь») и ожидание не мешаются в сводке дел: первое —
    // бэклог идей, второе — не моя очередь ходить. Показываем их отдельно.
    const undated = tasks.filter((t) => !t.date && !t.item.status);
    const waiting = tasks.filter((t) => t.item.status === 'waiting');
    const someday = tasks.filter((t) => t.item.status === 'someday');

    if (json) {
      console.log(
        JSON.stringify({ from, days, overdue, undated, waiting, someday, agenda: result }, null, 2),
      );
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
    if (waiting.length) {
      console.log('\nЖду ответа');
      printTasks(waiting);
    }
    if (someday.length) {
      console.log(`\nКогда-нибудь: ${someday.length} (task list --status когда-нибудь)`);
    }
    return;
  }

  // batch — пачка записей из JSON-файла (или stdin с "-").
  if (group === 'person') {
    if (action === 'add') {
      const name = rest.join(' ').trim();
      if (!name) throw new Error('нужно имя: person add "Имя" --phone +966…');
      const { person, added, created } = await personAdd(db, uid, name, flags);
      const what = added.map((c) => `${c.type} ${c.value}`).join(', ');
      console.log(
        json
          ? JSON.stringify(person)
          : created
            ? `Завёл персону: ${person.title}${what ? ` — ${what}` : ''}`
            : added.length
              ? `Дописал в ${person.title}: ${what}`
              : `Уже есть, менять нечего: ${person.title}`,
      );
      return;
    }
    if (action === 'list') {
      const snap = await db.collection(`users/${uid}/notes`).get();
      const persons = snap.docs
        .map((d) => d.data())
        .filter((n) => !n.deleted && n.type === 'person')
        .sort((a, b) => (a.title ?? '').localeCompare(b.title ?? ''));
      if (json) {
        console.log(JSON.stringify(persons, null, 2));
        return;
      }
      for (const p of persons) {
        const contacts = (p.contacts ?? []).map((c) => `${c.type} ${c.value}`).join(', ');
        console.log(`  ${p.title}${contacts ? ` — ${contacts}` : ''}`);
      }
      if (!persons.length) console.log('  (пусто)');
      return;
    }
    throw new Error(`не знаю команду person ${action ?? ''}`);
  }

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
        const n = await noteAdd(db, uid, e.title, e, bucket);
        done.push(`заметка: ${n.title}`);
      } else if (e.kind === 'finance') {
        // Перенос книги из чужой таблицы — это десятки строк за раз; поштучно
        // они заняли бы столько же вызовов, сколько сама книга строк.
        const fin = await financeAdd(db, uid, e);
        done.push(`финансы: ${FIN_LABEL[fin.kind]} ${fin.person ?? ''} ${fin.amount} (${fin.date})`);
      } else if (e.kind === 'person') {
        const { person, added, created } = await personAdd(db, uid, e.title ?? e.name, e);
        done.push(
          `персона: ${person.title}${created ? '' : ' (уже была)'}${added.length ? ` +${added.length} контакт(ов)` : ''}`,
        );
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
                   [--tag купить,позвонить] [--status жду|когда-нибудь]
                   [--waiting-for "кого ждём"] [--priority важно|не-горит]
                   [--size 15] [--repeat weekly] [--until D]
                   --date ставит день самой задаче, список остаётся в своей
                   категории. Датировать список целиком — --list-date D.
                   Без --list список подбирается по ключевым словам, а что не
                   опознано — падает во «Входящие» (разобрать: task triage).
                   Теги можно писать в тексте: «Купить масло #купить».
  task list [--open] [--date D] [--tag ...] [--status ...] [--priority ...]
            [--size 15] [--list "Название"] [--all]
  task set  "текст или id" [--text ...] [--list ...] [--tag ...] [--date D]
            [--status ...] [--priority ...] [--size N] [--repeat ...] [--until D]
  task triage                         показать «Входящие» для разбора
  task done "текст или id"            повторяющаяся уедет на следующий срок
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
                       --type location [--address "ссылка/адрес"] [--city "Город"]
                       [--category ...] заводит место в справочнике («Места»)
  note list [--limit N]
  note show "заголовок или id"
  note edit "заголовок или id" [--title "..."] [--body "..."]
                               [--address "..."] [--city "..."] [--category "..."]
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

  person add "Имя" [--phone +966…] [--telegram @ник] [--whatsapp ...]
                   [--email ...] [--body "..."]   карточка в справочнике
                   несколько значений — через запятую; повторный вызов
                   дописывает контакты, а не плодит вторую карточку
  person list

  batch файл.json                     пачка записей: kind = task | event |
                                      note | finance | person (перенос книги
                                      из чужой таблицы — десятками строк)

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
  parseStatus,
  parsePriority,
  parseSize,
  parseTags,
  extractTags,
  routeTask,
  completeTask,
  nextTaskDate,
  taskMatches,
  INBOX_TITLE,
};

// Запуск как команда — только когда файл вызван напрямую, а не импортирован.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`Ошибка: ${err.message}`);
    process.exit(1);
  });
}
