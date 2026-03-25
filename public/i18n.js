const i18n = (() => {
  let translations = {};
  let currentLang = 'en';

  function t(key, vars) {
    const keys = key.split('.');
    let val = translations;
    for (const k of keys) {
      val = val?.[k];
      if (val === undefined) return key;
    }
    if (typeof val !== 'string') return key;
    if (vars) {
      return val.replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? '');
    }
    return val;
  }

  function translatePage() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      el.textContent = t(el.dataset.i18n);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      el.placeholder = t(el.dataset.i18nPlaceholder);
    });
  }

  async function loadTranslations(lang) {
    const res = await fetch('/locales/' + lang + '.json');
    translations = await res.json();
  }

  async function setLanguage(lang) {
    currentLang = lang;
    localStorage.setItem('lang', lang);
    document.documentElement.lang = lang;
    await loadTranslations(lang);
    translatePage();
    document.querySelectorAll('.lang-label').forEach(el => {
      el.textContent = lang === 'zh' ? '中文' : 'EN';
    });
    window.dispatchEvent(new Event('languageChanged'));
  }

  async function init() {
    currentLang = localStorage.getItem('lang')
      || (navigator.language.startsWith('zh') ? 'zh' : 'en');
    document.documentElement.lang = currentLang;
    await loadTranslations(currentLang);
    translatePage();
    document.querySelectorAll('.lang-label').forEach(el => {
      el.textContent = currentLang === 'zh' ? '中文' : 'EN';
    });
  }

  return { init, t, setLanguage, translatePage, get lang() { return currentLang; } };
})();
