import { AuthenticationError } from '../ble/bike.js';
import { t } from '../i18n/i18n.js';
import { InterruptedError, NotConfirmedError } from '../session.js';
import { describeError } from './errors.js';

describe('errors', () => {
    test('a refused key, Bluetooth off and a timeout each have their sentence', () => {
        expect(describeError(new AuthenticationError('The bike refused the owner key.'))).toBe(t('error.refused'));
        expect(describeError(new Error('Bluetooth not enabled'))).toBe(t('error.bluetoothOff'));
        expect(describeError(new Error('Connection timeout'))).toBe(t('error.timeout'));
        expect(describeError(Object.assign(new Error('GATT Server is disconnected.'), { name: 'NetworkError' }))).toBe(
            t('error.lost')
        );
    });

    test('a command the bike did not confirm, or one the lost link interrupted, says so', () => {
        expect(describeError(new NotConfirmedError('lights'))).toBe(t('error.notConfirmed'));
        expect(describeError(new InterruptedError())).toBe(t('error.lost'));
    });

    test('a cancelled chooser shows nothing', () => {
        const cancelled = Object.assign(new Error('User cancelled the requestDevice() chooser.'), {
            name: 'NotFoundError',
        });
        expect(describeError(cancelled)).toBeNull();
        expect(describeError(new Error('requestDevice cancelled'))).toBeNull();
    });

    test('anything else keeps its own message', () => {
        expect(describeError(new Error('Something odd'))).toBe(t('error.generic', { error: 'Something odd' }));
    });
});
