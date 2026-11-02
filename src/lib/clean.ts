// Запись к виду, который принимает Firestore (без undefined), — общая для приложения
// (src/lib/sync.ts) и окна «База» на компьютере (src/desktop/), которое пишет через мост.

import type { Attachment, Note, Relation } from '../types';

export function cleanAttachment(a: Attachment): Attachment {
  return {
    id: a.id,
    name: a.name ?? '',
    size: a.size ?? 0,
    type: a.type ?? 'application/octet-stream',
    url: a.url ?? '',
    path: a.path ?? '',
    createdAt: a.createdAt ?? 0,
  };
}

/** Убрать поля со значением undefined (Firestore их не принимает); null оставляем. */
export function withoutUndefined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

/** Заметка к записи. Начинаем со всех полей, а не с перечня: запись идёт целиком
 *  (`set` без слияния), и поле, о котором здесь не знают, стёрлось бы. Так терялись
 *  версии быстрых заметок (`versions`, окно ~/projects/apps/zametki), `usedIn` у номеров,
 *  числа замеров здоровья (исправлено 02.11.2026). */
export function cleanNote(n: Note): Note {
  return {
    ...withoutUndefined(n),
    ...(n.request ? { request: withoutUndefined(n.request) } : {}),
    id: n.id,
    title: n.title,
    body: n.body,
    type: n.type ?? 'note',
    date: n.date ?? null,
    time: n.time ?? '',
    ...(n.health ? { health: n.health } : {}),
    phone: n.phone ?? '',
    contacts: (n.contacts ?? []).map((c) => ({
      type: c.type,
      value: c.value ?? '',
      label: c.label ?? '',
    })),
    address: n.address ?? '',
    locationId: n.locationId ?? null,
    category: n.category ?? '',
    docNumber: n.docNumber ?? '',
    expires: n.expires ?? '',
    login: n.login ?? '',
    secret: n.secret ?? '',
    attachments: (n.attachments ?? []).map(cleanAttachment),
    createdAt: n.createdAt,
    updatedAt: n.updatedAt ?? n.createdAt ?? 0,
    deleted: n.deleted ?? false,
  };
}

export function cleanRelation(r: Relation): Relation {
  return {
    id: r.id,
    from: r.from,
    to: r.to,
    type: r.type,
    position: r.position ?? 0,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt ?? r.createdAt ?? 0,
    deleted: r.deleted ?? false,
  };
}
