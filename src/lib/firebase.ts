// Инициализация Firebase: вход через Google + Cloud Firestore.
//
// Конфиг — в ./firebaseConfig.ts (публичные веб-ключи; переменные окружения
// VITE_FIREBASE_* перекрывают их). Ключи Firebase не секретны: доступ к данным
// ограничивают правила Firestore и список авторизованных доменов, а не
// сокрытие этих ключей.

import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, type Auth } from 'firebase/auth';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore';
import { firebaseConfig as config } from './firebaseConfig';

/** Настроен ли Firebase (есть ли ключи конфига). */
export const firebaseEnabled = Boolean(config.apiKey && config.projectId);

let app: FirebaseApp | undefined;
let authInstance: Auth | undefined;
let dbInstance: Firestore | undefined;

if (firebaseEnabled) {
  app = initializeApp(config);
  authInstance = getAuth(app);
  // Локальный кэш Firestore: приложение работает офлайн и досинхронизируется,
  // когда сеть вернётся. persistentMultipleTabManager — корректная работа
  // при нескольких открытых вкладках.
  dbInstance = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
}

export const auth = authInstance;
export const db = dbInstance;
export const googleProvider = new GoogleAuthProvider();

/**
 * Email администратора. Его наблюдения молодого месяца пишутся в общий
 * («официальный») документ Firestore, который читают все пользователи.
 * Право записи в этот документ проверяется в правилах Firestore по email.
 */
export const ADMIN_EMAIL = 'ismailoffism@gmail.com';

/** Путь к общему документу с официальным календарём наблюдений. */
export const SHARED_DOC = { collection: 'shared', id: 'calendar' } as const;
