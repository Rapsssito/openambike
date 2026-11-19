// The interface's texts, one translation file per language. A text missing from a language falls back to English.
import en from './en.json' with { type: 'json' };
import es from './es.json' with { type: 'json' };

/** @typedef {keyof typeof en} TextKey */

/** @type {Record<string, Partial<Record<TextKey, string>>>} */
const LANGUAGES = { en, es };

/**
 * The first of the browser's preferred languages that has a translation, or English.
 * @param {readonly string[]} preferred such as `navigator.languages`
 * @returns {string}
 */
export function pickLanguage(preferred) {
    for (const tag of preferred) {
        const base = tag.toLowerCase().split('-')[0];
        if (base in LANGUAGES) return base;
    }
    return 'en';
}

let language = 'en';

/** @param {string} code a language with a translation file */
export function setLanguage(code) {
    language = code in LANGUAGES ? code : 'en';
    document.documentElement.lang = language;
}

/**
 * The text of a key in the current language, with each `{name}` replaced by its value.
 * @param {TextKey} key
 * @param {Record<string, string | number>} [values]
 * @returns {string}
 */
export function t(key, values = {}) {
    const text = LANGUAGES[language][key] ?? en[key];
    return text.replace(/\{(\w+)\}/g, (match, name) => (name in values ? String(values[name]) : match));
}
