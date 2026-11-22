import en from './en.json' with { type: 'json' };
import es from './es.json' with { type: 'json' };
import { pickLanguage, t } from './i18n.js';

describe('translations', () => {
    test('every language has every English text, and no other', () => {
        expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
    });

    test('the first preferred language with a translation wins, with English as the fallback', () => {
        expect(pickLanguage(['es-ES', 'en'])).toBe('es');
        expect(pickLanguage(['fr-FR', 'es'])).toBe('es');
        expect(pickLanguage(['fr-FR'])).toBe('en');
        expect(pickLanguage([])).toBe('en');
    });

    test('values replace their placeholders, and a missing one is left as written', () => {
        expect(t('dashboard.mode', { n: 2 })).toBe(en['dashboard.mode'].replace('{n}', '2'));
        expect(t('assist.mode', {})).toBe(en['assist.mode']);
    });
});
