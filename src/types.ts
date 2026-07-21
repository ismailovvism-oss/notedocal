// Доменные типы приложения notedocal (заметки + задачи + календарь)

/** Вложение (файл), загруженное в Firebase Storage. В записи храним только
 *  метаданные и ссылку; сами байты лежат в облачном хранилище. */
export interface Attachment {
  id: string;
  /** Имя файла для показа. */
  name: string;
  /** Размер в байтах. */
  size: number;
  /** MIME-тип (image/png, application/pdf …). */
  type: string;
  /** Публичная ссылка на скачивание (getDownloadURL). */
  url: string;
  /** Путь в Storage — нужен для удаления. */
  path: string;
  createdAt: number;
}

/** Задача из списка дел. */
export interface Task {
  id: string;
  title: string;
  done: boolean;
  /** Дата выполнения в формате YYYY-MM-DD (григорианская) либо null. */
  due: string | null;
  priority: 'low' | 'normal' | 'high';
  createdAt: number;
  /** Время последнего изменения — для слияния при синхронизации. */
  updatedAt: number;
  /** Мягкое удаление (надгробие) — чтобы удаление доезжало до других устройств. */
  deleted?: boolean;
}

/** Способ связи в карточке персоны. */
export type ContactType = 'phone' | 'whatsapp' | 'telegram' | 'email' | 'other';

/** Один контакт: тип + значение (номер/ник/почта) + необязательная подпись. */
export interface ContactMethod {
  type: ContactType;
  value: string;
  label?: string;
}

/** Роль заметки в системе организации. Любая заметка — это Note; роль задаётся
 *  типом, а не отдельной сущностью. Person/location — карточки контактов и мест. */
export type NoteType =
  | 'note'
  | 'folder'
  | 'tag'
  | 'moc'
  | 'concept'
  | 'source'
  | 'person'
  | 'location'
  | 'document'
  | 'credential';

/** Текстовая заметка (универсальная единица знаний). */
export interface Note {
  id: string;
  title: string;
  body: string;
  /** Роль заметки. Для старых заметок без поля — считается 'note'. */
  type?: NoteType;
  /** Необязательная привязка к дню (YYYY-MM-DD). */
  date: string | null;
  /** Время HH:mm (для записей дневника здоровья и др.). */
  time?: string;
  /** Если задано — заметка является записью дневника здоровья (её вид). */
  health?: HealthKind;
  /** Телефон (устаревшее одиночное поле; заменено на contacts). */
  phone?: string;
  /** Список способов связи (телефоны, мессенджеры, почта) для персоны. */
  contacts?: ContactMethod[];
  /** Адрес свободным текстом (для персоны или локации). */
  address?: string;
  /** Привязка адреса персоны к локации (id заметки типа location). */
  locationId?: string | null;
  /** Категория (локация) или вид документа (Паспорт/ВНЖ/ИНН…). */
  category?: string;
  /** Номер документа. */
  docNumber?: string;
  /** Срок действия документа (YYYY-MM-DD). */
  expires?: string;
  /** Логин (для типа credential — пароля). */
  login?: string;
  /** Секрет: для credential — ЗАШИФРОВАННЫЙ пароль (мастер-паролем, E2E). */
  secret?: string;
  /** Прикреплённые файлы (Firebase Storage). */
  attachments?: Attachment[];
  createdAt: number;
  updatedAt: number;
  /** Мягкое удаление (надгробие) — чтобы удаление доезжало до других устройств. */
  deleted?: boolean;
}

/** Тип связи между заметками:
 *  'child' — подзаметка/иерархия (заменяет папки);
 *  'tag'   — заметка помечена другой заметкой-тегом (даёт обычные и иерарх. теги);
 *  'link'  — обычная смысловая ссылка. */
export type RelationType = 'child' | 'tag' | 'link';

/** Связь между двумя заметками (отдельная сущность). */
export interface Relation {
  id: string;
  /** id заметки-источника. */
  from: string;
  /** id заметки-цели. */
  to: string;
  type: RelationType;
  /** Порядок среди однотипных связей (для сортировки подзаметок). */
  position?: number;
  createdAt: number;
  updatedAt: number;
  /** Мягкое удаление (надгробие) — для синхронизации. */
  deleted?: boolean;
}

/** Запись с идентификатором и временем изменения — основа для слияния. */
export interface Syncable {
  id: string;
  updatedAt: number;
  deleted?: boolean;
}

/** Способ фиксации начала месяца:
 *  'sighting' — виден молодой месяц (хиляль) вечером накануне;
 *  'count'    — молодой месяц не виден, предыдущий месяц досчитан до 30 (хадис). */
export type SightingMethod = 'sighting' | 'count';

/**
 * Фиксация начала хиджра-месяца.
 *
 * `startDate` — григорианская дата 1-го числа месяца:
 *  - для 'sighting' это вечер наблюдения + 1 день;
 *  - для 'count' это день после 30-го (последнего) дня предыдущего месяца.
 * В обоих случаях в форме выбирается «этот день», а 1-е число = выбранный + 1.
 */
export interface MoonSighting {
  id: string;
  /** Григорианская дата 1-го числа месяца (YYYY-MM-DD). */
  startDate: string;
  /** Номер хиджра-месяца, который начинается (1..12). */
  hijriMonth: number;
  /** Год хиджры. */
  hijriYear: number;
  /** Способ фиксации (по умолчанию 'sighting' для старых записей). */
  method?: SightingMethod;
  /** Необязательная заметка о фиксации (как именно зафиксировано). */
  note?: string;
  createdAt: number;
  updatedAt: number;
  /** Мягкое удаление (надгробие) — для синхронизации удалений. */
  deleted?: boolean;
}

/** Задача/пункт списка. Рекурсивна: подзадача — такая же задача.
 *  У любой задачи на любом уровне есть заголовок, описание, дата,
 *  напоминание, заметка и свои подзадачи. */
export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
  /** Описание/детали (многострочное), помимо заголовка. */
  desc?: string;
  /** Дата (YYYY-MM-DD). */
  date?: string | null;
  /** Напоминание (метка времени, мс). */
  remindAt?: number | null;
  /** Прицеплённая заметка (id из коллекции заметок). */
  noteId?: string | null;
  /** Прикреплённые файлы (Firebase Storage). */
  attachments?: Attachment[];
  /** Подзадачи (рекурсивно — той же сути, что и задача). */
  subitems?: ChecklistItem[];
}

/** Список задач (чек-лист), привязанный к дню. */
export interface Checklist {
  id: string;
  title: string;
  /** День (YYYY-MM-DD), к которому относится список. */
  date: string | null;
  items: ChecklistItem[];
  createdAt: number;
  updatedAt: number;
  /** Мягкое удаление (надгробие) — для синхронизации. */
  deleted?: boolean;
}

/** Как часто повторяется событие. 'none' — одноразовое. */
export type Repeat = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';

/** Событие календаря (со временем), в отличие от задачи — без «выполнено». */
export interface CalEvent {
  id: string;
  title: string;
  /** День первого (или единственного) повтора (YYYY-MM-DD) — «якорь». */
  date: string;
  /** Время начала HH:mm (необязательно). */
  start?: string;
  /** Время конца HH:mm (необязательно). */
  end?: string;
  desc?: string;
  /** Привязка к локации (id заметки типа location). */
  locationId?: string | null;
  /** Повтор события (по умолчанию 'none'). */
  repeat?: Repeat;
  /** Повторять до этой даты включительно (YYYY-MM-DD) либо без ограничения. */
  repeatUntil?: string | null;
  createdAt: number;
  updatedAt: number;
  deleted?: boolean;
}

/** Вид записи дневника здоровья (когда заметка — запись здоровья). */
export type HealthKind = 'meal' | 'med' | 'other';

/** Фаза помидоро-таймера: работа, короткий или длинный перерыв. */
export type PomodoroPhase = 'work' | 'short' | 'long';

/** Настройки помидоро-таймера (длительности в минутах). */
export interface PomodoroSettings {
  workMin: number;
  shortMin: number;
  longMin: number;
  /** Сколько рабочих циклов до длинного перерыва. */
  cyclesToLong: number;
}

/** Завершённая рабочая помидорка — запись журнала (синхронизируется). */
export interface PomodoroSession {
  id: string;
  /** День (YYYY-MM-DD). */
  date: string;
  /** Время начала HH:mm. */
  start: string;
  /** Продолжительность работы в минутах. */
  durationMin: number;
  /** Пункт чек-листа, над которым работал (id), либо null. */
  itemId?: string | null;
  /** Название задачи на момент сессии — чтобы история читалась и после её удаления. */
  itemText?: string;
  createdAt: number;
  updatedAt: number;
  /** Мягкое удаление (надгробие) — для синхронизации. */
  deleted?: boolean;
}

/** Вид финансовой записи:
 *  расход/доход — обычные траты и поступления;
 *  lent — я дал в долг (мне должны), borrowed — я взял в долг (я должен);
 *  return_in — мне вернули долг, return_out — я вернул долг. */
export type FinanceKind = 'expense' | 'income' | 'lent' | 'borrowed' | 'return_in' | 'return_out';

/** Запись домашней бухгалтерии. */
export interface FinanceEntry {
  id: string;
  kind: FinanceKind;
  /** Сумма (положительная); знак задаётся видом записи. */
  amount: number;
  /** Дата (YYYY-MM-DD). */
  date: string;
  /** Контрагент (для долгов). */
  person?: string;
  /** Категория (для расходов/доходов), напр. «Коммуналка». */
  category?: string;
  note?: string;
  createdAt: number;
  updatedAt: number;
  deleted?: boolean;
}

export type Tab =
  | 'dashboard'
  | 'calendar'
  | 'tasks'
  | 'notes'
  | 'finance'
  | 'directory'
  | 'months';
