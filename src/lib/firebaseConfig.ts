// Веб-конфиг Firebase проекта notedocal.
//
// ВАЖНО: эти значения НЕ являются секретом. Веб-конфиг Firebase публичен в
// любом клиентском приложении (он всё равно попадает в собранный JS, видимый
// в браузере). Доступ к данным ограничивают ПРАВИЛА Firestore и список
// авторизованных доменов в Firebase Authentication — а не сокрытие этих ключей.
// Поэтому конфиг можно безопасно хранить прямо в репозитории.
//
// Приоритет у переменных окружения VITE_FIREBASE_* (если заданы) — удобно,
// чтобы для разработки подключить отдельный проект, не трогая этот файл.

const fallback = {
  apiKey: 'AIzaSyD_FjytSXTvcLzASg7XgH7ghfTZhuvK0lM',
  authDomain: 'notedocal.firebaseapp.com',
  projectId: 'notedocal',
  storageBucket: 'notedocal.firebasestorage.app',
  messagingSenderId: '363952375141',
  appId: '1:363952375141:web:2e51c924c06091c9c24d8c',
  measurementId: 'G-RWRGK1XF7R',
};

export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? fallback.apiKey,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? fallback.authDomain,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? fallback.projectId,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? fallback.storageBucket,
  messagingSenderId:
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? fallback.messagingSenderId,
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? fallback.appId,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID ?? fallback.measurementId,
};
