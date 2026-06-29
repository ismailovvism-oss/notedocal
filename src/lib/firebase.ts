// Инициализация Firebase: вход через Google + Cloud Firestore.
//
// Конфиг берётся из переменных окружения Vite (файл .env, см. .env.example).
// Ключи веб-конфига Firebase НЕ являются секретом — это публичные
// идентификаторы проекта; доступ к данным ограничивается правилами Firestore,
// а не сокрытием этих ключей.

import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, type Auth } from 'firebase/auth';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore';

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

/** Настроен ли Firebase (заданы ли ключи в окружении). */
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
