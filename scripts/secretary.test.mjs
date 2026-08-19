// Тесты чистой логики секретаря: разбор аргументов, дат, дерева задач.
// Запуск: node --test scripts/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseArgs,
  parseDate,
  parseTime,
  toKey,
  fromKey,
  flatten,
  treeUpdate,
  treeRemove,
  treeRemoveMany,
  collectPurge,
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
  parseSite,
  parseSiteLevel,
  findMetric,
  metricStatus,
  courseStateOf,
  INBOX_TITLE,
} from './secretary.mjs';

const today = new Date();
const shift = (n) => {
  const d = new Date(today);
  d.setDate(d.getDate() + n);
  return toKey(d);
};

test('parseArgs делит позиционные и флаги', () => {
  const { positional, flags } = parseArgs(['task', 'add', 'Купить хлеб', '--date', 'завтра', '--json']);
  assert.deepEqual(positional, ['task', 'add', 'Купить хлеб']);
  assert.equal(flags.date, 'завтра');
  assert.equal(flags.json, true);
});

test('parseDate понимает относительные даты', () => {
  assert.equal(parseDate('сегодня'), shift(0));
  assert.equal(parseDate('today'), shift(0));
  assert.equal(parseDate('завтра'), shift(1));
  assert.equal(parseDate('послезавтра'), shift(2));
  assert.equal(parseDate('+5'), shift(5));
  assert.equal(parseDate('2026-08-14'), '2026-08-14');
});

test('parseDate: пустая дата — null, мусор — ошибка', () => {
  assert.equal(parseDate(undefined), null);
  assert.equal(parseDate('none'), null);
  assert.equal(parseDate(true), null);
  assert.throws(() => parseDate('когда-нибудь'), /не понял дату/);
});

test('parseDate: день недели даёт ближайший будущий', () => {
  for (const [name, want] of [['пн', 1], ['чт', 4], ['вс', 0]]) {
    const key = parseDate(name);
    assert.equal(fromKey(key).getDay(), want, `${name} → ${key}`);
    assert.ok(key > shift(0), `${name} должен быть в будущем`);
    assert.ok(key <= shift(7), `${name} — в пределах недели`);
  }
});

test('parseDate: 14.08 без года не уходит в прошлое', () => {
  const key = parseDate('14.08');
  assert.match(key, /^\d{4}-08-14$/);
  assert.ok(key >= shift(0));
});

test('parseTime нормализует и отбраковывает', () => {
  assert.equal(parseTime('9:05'), '09:05');
  assert.equal(parseTime('15:00'), '15:00');
  assert.equal(parseTime('7'), '07:00');
  assert.equal(parseTime(undefined), undefined);
  assert.throws(() => parseTime('25:00'), /не понял время/);
  assert.throws(() => parseTime('вечером'), /не понял время/);
});

test('fromKey читает ключ как локальную дату', () => {
  const d = fromKey('2026-08-14');
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 7);
  assert.equal(d.getDate(), 14);
  assert.equal(toKey(d), '2026-08-14');
});

// --- Дерево задач ---

const lists = () => [
  {
    id: 'L1',
    title: '',
    date: '2026-08-14',
    items: [
      { id: 'a', text: 'Смета', done: false, subitems: [{ id: 'a1', text: 'Уточнить цены', done: false }] },
      { id: 'b', text: 'Фильтр для воды', done: true },
    ],
  },
  {
    id: 'L2',
    title: 'Работа',
    date: null,
    items: [
      { id: 'c', text: 'Созвон', done: false },
      { id: 'd', text: 'Продлить визу', done: false, date: '2026-09-11' },
    ],
  },
  { id: 'L3', title: 'Удалённый', date: null, items: [{ id: 'z', text: 'Призрак', done: false }], deleted: true },
];

test('flatten обходит подзадачи и пропускает удалённые списки', () => {
  const flat = flatten(lists());
  assert.deepEqual(flat.map((t) => t.item.id), ['a', 'a1', 'b', 'c', 'd']);
  assert.equal(flat.find((t) => t.item.id === 'a1').path, 'Смета / Уточнить цены');
  assert.equal(flat.find((t) => t.item.id === 'c').listTitle, 'Работа');
});

// Правило приложения (DashboardView): eff = it.date ?? c.date — дата пункта
// главнее даты списка. Задача в недатированной категории может иметь свой день.
test('flatten: день задачи — дата пункта, иначе дата списка', () => {
  const flat = flatten(lists());
  const by = (id) => flat.find((t) => t.item.id === id);
  assert.equal(by('a').date, '2026-08-14', 'нет своей даты → берётся дата списка');
  assert.equal(by('a1').date, '2026-08-14', 'подзадача тоже наследует день списка');
  assert.equal(by('d').date, '2026-09-11', 'своя дата пункта главнее');
  assert.equal(by('c').date, null, 'ни у пункта, ни у списка даты нет');
});

test('treeUpdate меняет вложенный пункт, не трогая соседей', () => {
  const items = treeUpdate(lists()[0].items, 'a1', (it) => ({ ...it, done: true }));
  assert.equal(items[0].subitems[0].done, true);
  assert.equal(items[0].done, false);
  assert.equal(items[1].done, true);
});

test('treeRemove удаляет вложенный пункт', () => {
  const items = treeRemove(lists()[0].items, 'a1');
  assert.equal(items[0].subitems.length, 0);
  assert.equal(items.length, 2);
});

// --- Очистка выполненного (task purge) ---

// Дерево, где выполненное перемешано с живым: закрытый родитель с открытым
// подпунктом, закрытый родитель с закрытым подпунктом, датированное закрытое.
const purgeLists = () => [
  {
    id: 'L1',
    title: 'Дом',
    date: null,
    items: [
      { id: 'p1', text: 'Ремонт', done: true, subitems: [{ id: 'p1a', text: 'Позвонить мастеру', done: false }] },
      { id: 'p2', text: 'Кран', done: true, subitems: [{ id: 'p2a', text: 'Прокладка', done: true }] },
      { id: 'p3', text: 'Открытая', done: false, subitems: [{ id: 'p3a', text: 'Закрытая внутри', done: true }] },
    ],
  },
  {
    id: 'L2',
    title: 'Работа',
    date: '2026-01-10',
    items: [
      { id: 'p4', text: 'Старый отчёт', done: true },
      { id: 'p5', text: 'Свежая', done: true, date: '2026-08-17' },
    ],
  },
  { id: 'L3', title: 'Удалённый', date: null, items: [{ id: 'pz', text: 'Призрак', done: true }], deleted: true },
];

test('collectPurge берёт выполненные и не трогает открытые', () => {
  const { gone } = collectPurge(purgeLists(), { today: '2026-08-18' });
  assert.deepEqual(gone.map((t) => t.item.id), ['p2', 'p3a', 'p4', 'p5']);
});

test('collectPurge не сносит закрытого родителя с незакрытым подпунктом', () => {
  const { gone, kept } = collectPurge(purgeLists(), { today: '2026-08-18' });
  assert.equal(gone.some((t) => t.item.id === 'p1'), false);
  assert.deepEqual(kept.map((t) => t.item.id), ['p1']);
});

test('collectPurge не считает подпункты удаляемого родителя дважды', () => {
  const { gone } = collectPurge(purgeLists(), { today: '2026-08-18' });
  assert.equal(gone.some((t) => t.item.id === 'p2a'), false, 'уедет вместе с p2');
  assert.equal(gone.find((t) => t.item.id === 'p3a').path, 'Открытая / Закрытая внутри');
});

test('collectPurge: --list сужает до одной сферы, удалённые списки мимо', () => {
  const { gone } = collectPurge(purgeLists(), { list: 'Работа', today: '2026-08-18' });
  assert.deepEqual(gone.map((t) => t.item.id), ['p4', 'p5']);
  assert.equal(gone.some((t) => t.item.id === 'pz'), false);
});

// --older считает по дате задачи (своей или списка) — времени выполнения в
// данных нет, поэтому недатированное под срез не попадает.
test('collectPurge: --older отбирает по дате, недатированные оставляет', () => {
  const { gone } = collectPurge(purgeLists(), { older: 30, today: '2026-08-18' });
  assert.deepEqual(gone.map((t) => t.item.id), ['p4'], 'p5 свежая, p2/p3a без даты');
});

test('treeRemoveMany удаляет пачкой на разной глубине', () => {
  const items = treeRemoveMany(purgeLists()[0].items, new Set(['p2', 'p3a']));
  assert.deepEqual(items.map((it) => it.id), ['p1', 'p3']);
  assert.equal(items[1].subitems.length, 0);
});

test('findTasks ищет по id и по подстроке', () => {
  assert.equal(findTasks(lists(), 'a1').length, 1);
  assert.equal(findTasks(lists(), 'фильтр')[0].item.id, 'b');
  assert.equal(findTasks(lists(), 'СМЕТА')[0].item.id, 'a');
  assert.equal(findTasks(lists(), 'ничего').length, 0);
});

test('findTasks возвращает несколько при неоднозначности', () => {
  const amb = [{ id: 'L', title: '', date: null, items: [
    { id: '1', text: 'Позвонить маме' },
    { id: '2', text: 'Позвонить в банк' },
  ] }];
  assert.equal(findTasks(amb, 'позвонить').length, 2);
});

// --- Повторы событий ---

test('eventOnDay: разовое событие только в свой день', () => {
  const ev = { date: '2026-08-14' };
  assert.equal(eventOnDay(ev, '2026-08-14'), true);
  assert.equal(eventOnDay(ev, '2026-08-15'), false);
});

test('eventOnDay: еженедельное держит день недели и не идёт в прошлое', () => {
  const ev = { date: '2026-08-14', repeat: 'weekly' };
  assert.equal(eventOnDay(ev, '2026-08-21'), true);
  assert.equal(eventOnDay(ev, '2026-08-20'), false);
  assert.equal(eventOnDay(ev, '2026-08-07'), false);
});

test('eventOnDay: repeatUntil обрывает повтор', () => {
  const ev = { date: '2026-08-14', repeat: 'daily', repeatUntil: '2026-08-16' };
  assert.equal(eventOnDay(ev, '2026-08-16'), true);
  assert.equal(eventOnDay(ev, '2026-08-17'), false);
});

test('eventOnDay: месячное и годовое', () => {
  assert.equal(eventOnDay({ date: '2026-08-14', repeat: 'monthly' }, '2026-09-14'), true);
  assert.equal(eventOnDay({ date: '2026-08-14', repeat: 'monthly' }, '2026-09-15'), false);
  assert.equal(eventOnDay({ date: '2026-08-14', repeat: 'yearly' }, '2027-08-14'), true);
  assert.equal(eventOnDay({ date: '2026-08-14', repeat: 'yearly' }, '2027-09-14'), false);
});

// --- Финансы (те же знаки, что в src/lib/finance.ts) ---

test('debtSign: кто кому должен', () => {
  assert.equal(debtSign('lent'), 1, 'дал в долг → мне должны');
  assert.equal(debtSign('return_out'), 1, 'я вернул чужой долг → баланс в плюс');
  assert.equal(debtSign('borrowed'), -1, 'взял в долг → я должен');
  assert.equal(debtSign('return_in'), -1, 'мне вернули → долг уменьшился');
  assert.equal(debtSign('expense'), 0, 'расход в долги не входит');
  assert.equal(debtSign('income'), 0);
});

test('personBalances суммирует по контрагенту и держит последнюю дату', () => {
  const entries = [
    { kind: 'lent', amount: 700, person: 'Серзод', date: '2026-07-09' },
    { kind: 'lent', amount: 250, person: 'Серзод', date: '2026-07-01' },
    { kind: 'return_in', amount: 200, person: 'Серзод', date: '2026-08-01' },
    { kind: 'borrowed', amount: 500, person: 'Имран', date: '2026-06-15' },
    { kind: 'expense', amount: 90, category: 'Еда', date: '2026-08-02' },
  ];
  const b = personBalances(entries);
  assert.deepEqual(b.map((x) => x.person), ['Имран', 'Серзод']);
  assert.equal(b.find((x) => x.person === 'Серзод').net, 750, '700 + 250 − 200');
  assert.equal(b.find((x) => x.person === 'Серзод').last, '2026-08-01');
  assert.equal(b.find((x) => x.person === 'Имран').net, -500, 'я должен Имрану');
});

// --- Ключ доступа из переменной окружения (облачная среда, CI) ---

const FAKE_KEY = { project_id: 'notedocal', private_key: '-----BEGIN PRIVATE KEY-----\nx\n' };

test('parseKeyMaterial принимает и JSON, и base64', () => {
  const json = JSON.stringify(FAKE_KEY);
  assert.deepEqual(parseKeyMaterial(json), FAKE_KEY);
  assert.deepEqual(parseKeyMaterial(`  ${json}  `), FAKE_KEY, 'пробелы по краям не мешают');
  assert.deepEqual(parseKeyMaterial(Buffer.from(json).toString('base64')), FAKE_KEY);
});

test('parseKeyMaterial отбраковывает мусор и чужой JSON', () => {
  assert.throws(() => parseKeyMaterial('не ключ'), /не разобрать/);
  assert.throws(() => parseKeyMaterial('{"a":1}'), /не похож на ключ/);
  assert.throws(
    () => parseKeyMaterial(Buffer.from('{"a":1}').toString('base64')),
    /не похож на ключ/,
  );
});

test('money убирает хвосты двоичной дроби', () => {
  assert.equal(money(653.4799999999996), '653.48');
  assert.equal(money(600), '600');
  assert.equal(money(-0), '0');
});

test('personBalances пропускает записи без контрагента', () => {
  assert.deepEqual(personBalances([{ kind: 'lent', amount: 100, date: '2026-08-01' }]), []);
});

test('parseRepeat принимает известные виды и отбраковывает прочие', () => {
  assert.equal(parseRepeat('weekly'), 'weekly');
  assert.equal(parseRepeat(' Monthly '), 'monthly', 'регистр и пробелы не мешают');
  assert.equal(parseRepeat(undefined), undefined, 'не задан — не трогаем поле');
  assert.equal(parseRepeat(true), undefined, 'флаг без значения не считается видом');
  assert.throws(() => parseRepeat('еженедельно'), /повтор — одно из/);
});

// ---------- Измерения задачи: теги, состояние, важность, размер ----------

test('parseStatus понимает русские синонимы, active не хранит', () => {
  assert.equal(parseStatus('жду'), 'waiting');
  assert.equal(parseStatus(' Когда-нибудь '), 'someday');
  assert.equal(parseStatus('active'), undefined, 'значение по умолчанию не пишем в запись');
  assert.equal(parseStatus(undefined), undefined);
  assert.throws(() => parseStatus('потом'), /состояние — одно из/);
});

test('parsePriority: normal не хранится, синонимы работают', () => {
  assert.equal(parsePriority('важно'), 'high');
  assert.equal(parsePriority('не-горит'), 'low');
  assert.equal(parsePriority('обычно'), undefined);
  assert.throws(() => parsePriority('среднее'), /важность — одно из/);
});

test('parseSize принимает минуты и часы', () => {
  assert.equal(parseSize('15'), 15);
  assert.equal(parseSize('15м'), 15);
  assert.equal(parseSize('1ч'), 60);
  assert.equal(parseSize(true), undefined, 'флаг без значения — не размер');
  assert.throws(() => parseSize('немного'), /размер — число минут/);
});

test('parseTags режет по запятой и нормализует', () => {
  assert.deepEqual(parseTags(' #Купить, позвонить ,'), ['купить', 'позвонить']);
  assert.deepEqual(parseTags(undefined), []);
});

test('extractTags вынимает #теги из текста', () => {
  const r = extractTags('Купить масло #купить #Дом');
  assert.equal(r.text, 'Купить масло');
  assert.deepEqual(r.tags, ['купить', 'дом']);
  assert.deepEqual(extractTags('Просто задача').tags, [], 'без решёток текст не меняется');
});

test('routeTask раскладывает по ключевым словам, остальное — во Входящие', () => {
  assert.equal(routeTask('Купить батарейки').list, 'Купить');
  assert.equal(routeTask('Статья о повестке').list, 'Ислам');
  assert.equal(routeTask('Лендинг для офиса').list, 'Прог');
  assert.equal(routeTask('Открыть карту в Саудии').list, 'Нужно');
  assert.equal(routeTask('Оплатить свет').list, 'Дом');
  assert.equal(routeTask('Посмотреть курс Айнура').list, INBOX_TITLE, 'непонятное — в свалку');
});

test('completeTask: обычная закрывается, повторяющаяся уезжает на срок', () => {
  assert.deepEqual(completeTask({ text: 'x', done: false }, '2026-08-16').done, true);

  const weekly = completeTask(
    { text: 'укол', done: false, date: '2026-08-20', repeat: 'weekly' },
    '2026-08-16',
  );
  assert.equal(weekly.done, false, 'повтор не закрывается');
  assert.equal(weekly.date, '2026-08-27');

  const past = completeTask(
    { text: 'свет', done: false, date: '2026-07-28', repeat: 'monthly' },
    '2026-08-16',
  );
  assert.equal(past.date, '2026-09-16', 'просроченный повтор считается от сегодня');

  const last = completeTask(
    { text: 'курс', done: false, date: '2026-08-20', repeat: 'weekly', repeatUntil: '2026-08-25' },
    '2026-08-16',
  );
  assert.equal(last.done, true, 'после repeatUntil задача закрывается');
});

test('nextTaskDate считает следующий срок по виду повтора', () => {
  assert.equal(nextTaskDate('2026-08-16', 'daily'), '2026-08-17');
  assert.equal(nextTaskDate('2026-08-16', 'weekly'), '2026-08-23');
  assert.equal(nextTaskDate('2026-08-16', 'monthly'), '2026-09-16');
  assert.equal(nextTaskDate('2026-08-16', 'yearly'), '2027-08-16');
  assert.equal(nextTaskDate('2026-01-31', 'monthly'), '2026-03-03', 'короткий месяц перетекает');
});

test('taskMatches: замыслы скрыты, срезы складываются', () => {
  const ref = (item, listTitle = 'Дом') => ({ item, listTitle });
  const plain = ref({ text: 'a', done: false });
  const someday = ref({ text: 'b', done: false, status: 'someday' });
  const small = ref({ text: 'c', done: false, sizeMin: 15, tags: ['купить'] });

  assert.equal(taskMatches(plain, {}), true);
  assert.equal(taskMatches(someday, {}), false, 'по умолчанию замыслы не показываем');
  assert.equal(taskMatches(someday, { all: true }), true);
  assert.equal(taskMatches(someday, { status: 'когда-нибудь' }), true);
  assert.equal(taskMatches(small, { size: '15' }), true);
  assert.equal(taskMatches(plain, { size: '15' }), false, 'без размера не влезает в срез');
  assert.equal(taskMatches(small, { tag: 'купить' }), true);
  assert.equal(taskMatches(small, { tag: 'купить,позвонить' }), false, 'теги — по И');
  assert.equal(taskMatches(small, { list: 'Работа' }), false);
});

// ---- Здоровье: показатели и курс препарата ----

test('findMetric: код, синоним и начало названия', () => {
  assert.equal(findMetric('ldl').code, 'ldl');
  assert.equal(findMetric('вес').code, 'weight');
  assert.equal(findMetric('липаза').code, 'lipase');
  assert.equal(findMetric('витамин').code, 'vitd');
  assert.equal(findMetric('неттакого'), null);
});

test('metricStatus: цель жёстче нормы, без цели судим по норме', () => {
  const ldl = findMetric('ldl'); // норма <100, цель <70
  assert.equal(metricStatus(ldl, 60), 'ok');
  assert.equal(metricStatus(ldl, 85), 'warn', 'в норме, но мимо цели');
  assert.equal(metricStatus(ldl, 190), 'bad');

  const hba1c = findMetric('hba1c'); // норма <5.6, цель <6.5
  assert.equal(metricStatus(hba1c, 5.7), 'warn', 'выше нормы, но в цели — не красный');

  const vitd = findMetric('vitd'); // цели нет
  assert.equal(metricStatus(vitd, 12), 'bad');
  assert.equal(metricStatus(vitd, 45), 'ok');

  const hdl = findMetric('hdl'); // норма >40, цель >60
  assert.equal(metricStatus(hdl, 49.2), 'warn');
  assert.equal(metricStatus(hdl, 30), 'bad');
});

test('courseStateOf: счётчик доз и дата покупки новой упаковки', () => {
  const course = {
    code: 'mounjaro',
    everyDays: 7,
    dosesPerPen: 4,
    penStart: '2026-08-13',
  };
  const shot = (date) => ({ health: 'med', code: 'mounjaro', date });

  const start = courseStateOf([shot('2026-08-13')], course, '2026-08-19');
  assert.equal(start.taken, 1);
  assert.equal(start.left, 3);
  assert.equal(start.nextDate, '2026-08-20');
  assert.equal(start.buyBy, '2026-09-10', 'после 4-й дозы 03.09 следующий укол 10.09');
  assert.equal(start.overdue, false);

  const late = courseStateOf([shot('2026-08-13')], course, '2026-08-22');
  assert.equal(late.overdue, true, 'укол 20.08 не отмечен — просрочен');

  // Уколы до текущей упаковки в счёт не идут.
  const old = courseStateOf([shot('2026-07-01'), shot('2026-08-13')], course, '2026-08-19');
  assert.equal(old.taken, 1);

  const empty = courseStateOf([], course, '2026-08-13');
  assert.equal(empty.taken, 0);
  assert.equal(empty.nextDate, '2026-08-13', 'первый укол — в день старта упаковки');
});

// ---- Локация боли ----

test('parseSite: код в заголовок, слова — врачу', () => {
  const a = parseSite('л сп д+3');
  assert.equal(a.code, 'Л-СП-Д+3');
  assert.equal(a.words, 'слева, по средней подмышечной линии, на 3 см выше рёберной дуги');

  assert.equal(parseSite('л-сп-д+3').code, 'Л-СП-Д+3', 'через дефис — тот же код');
  assert.match(parseSite('право ск п-4').words, /справа, по среднеключичной линии, на 4 см ниже пупка/);
  assert.match(parseSite('л зп р10').words, /на уровне 10-го ребра/);

  assert.throws(() => parseSite('л хх д+3'), /Линии/, 'неизвестная линия — подсказка, а не молчание');
  assert.throws(() => parseSite('вверх сп'), /Стороны/);
});

test('parseSiteLevel: якоря — дуга, пупок, ребро', () => {
  assert.equal(parseSiteLevel('д+3'), 'на 3 см выше рёберной дуги');
  assert.equal(parseSiteLevel('д−2'), 'на 2 см ниже рёберной дуги', 'минус-тире тоже понимаем');
  assert.equal(parseSiteLevel('п+5'), 'на 5 см выше пупка');
  assert.equal(parseSiteLevel('р9'), 'на уровне 9-го ребра');
  assert.equal(parseSiteLevel('чтото'), null);
});
