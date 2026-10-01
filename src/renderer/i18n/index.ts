import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './locales/en.json';
import ko from './locales/ko.json';

export const DEFAULT_LOCALE = 'ko' as const;
export const SUPPORTED_LOCALES = ['ko', 'en'] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

void i18next.use(initReactI18next).init({
  resources: {
    ko: { translation: ko },
    en: { translation: en },
  },
  lng: DEFAULT_LOCALE,
  fallbackLng: DEFAULT_LOCALE,
  interpolation: { escapeValue: false },
  returnNull: false,
});

export { i18next };
