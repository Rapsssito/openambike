package org.openambike.app.link;

import java.util.UUID;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * What auto-connect needs, as src/auto-connect.js prepares it from src/ble/protocol.js and the translation files: the
 * service moves these bytes and shows these texts, and knows nothing of the protocol or the languages.
 */
final class AutoConnectConfig {
    /** A characteristic and the bytes written to it or expected from it. */
    static final class Exchange {
        final UUID service;
        final UUID characteristic;
        final byte[] value;
        final byte[] reply;

        Exchange(JSONObject json) throws JSONException {
            service = UUID.fromString(json.getString("service"));
            characteristic = UUID.fromString(json.getString("characteristic"));
            value = Hex.decode(json.optString("value", ""));
            reply = Hex.decode(json.optString("reply", ""));
        }
    }

    final String json;
    final String address;
    final Exchange auth;
    final Exchange lock;
    final Exchange unlock;
    /** The characteristic whose notifications say the bike moves, when a byte of [from, to) is not zero. */
    final Exchange movement;
    final int movementFrom;
    final int movementTo;
    /**
     * Where the movement characteristic holds two unsigned 16-bit little-endian values whose product is the rider's
     * power: the bike is pedalled when both are not zero. Empty in a configuration from before it, which then never
     * says the bike is pedalled, until the app's next connection sends it.
     */
    final int[] pedalled;
    final AutoConnect.Settings settings = new AutoConnect.Settings();
    final JSONObject texts;
    /** With auto-ride on, what src/rides/ prepares for a ride, as for one started by hand; null with it off. */
    final String ride;

    AutoConnectConfig(String json) throws JSONException {
        this.json = json;
        JSONObject root = new JSONObject(json);
        address = root.getString("address");
        auth = new Exchange(root.getJSONObject("auth"));
        lock = new Exchange(root.getJSONObject("lock"));
        unlock = new Exchange(root.getJSONObject("unlock"));
        JSONObject movementJson = root.getJSONObject("movement");
        movement = new Exchange(movementJson);
        movementFrom = movementJson.getInt("from");
        movementTo = movementJson.getInt("to");
        org.json.JSONArray pedalledJson = movementJson.optJSONArray("pedalled");
        pedalled = new int[pedalledJson == null ? 0 : pedalledJson.length()];
        for (int i = 0; i < pedalled.length; i++) pedalled[i] = pedalledJson.getInt(i);
        JSONObject thresholds = root.getJSONObject("thresholds");
        settings.nearDbm = thresholds.getInt("nearDbm");
        settings.nearMs = thresholds.getLong("nearMs");
        settings.farDbm = thresholds.getInt("farDbm");
        settings.farMs = thresholds.getLong("farMs");
        settings.parkedMs = thresholds.getLong("parkedMs");
        settings.rideGuardMs = thresholds.getLong("rideGuardMs");
        settings.awayMs = thresholds.optLong("awayMs", settings.awayMs);
        settings.autoLock = root.getBoolean("autoLock");
        settings.autoUnlock = settings.autoLock && root.optBoolean("autoUnlock", false);
        texts = root.getJSONObject("texts");
        JSONObject rideJson = root.optBoolean("autoRide", false) ? root.optJSONObject("ride") : null;
        ride = rideJson != null ? rideJson.toString() : null;
    }

    String text(String key) {
        return texts.optString(key, "");
    }

    /** Whether the bike's answer on auth accepts the key: the reply, up to a zero byte, as src/ble/protocol.js reads it. */
    boolean accepts(byte[] value) {
        int end = 0;
        while (end < value.length && value[end] != 0) end++;
        return java.util.Arrays.equals(java.util.Arrays.copyOf(value, end), auth.reply);
    }

    /** Whether a notification of the movement characteristic says the bike moves. */
    boolean moves(byte[] value) {
        for (int i = movementFrom; i < Math.min(movementTo, value.length); i++) {
            if (value[i] != 0) return true;
        }
        return false;
    }

    /** Whether a notification of the movement characteristic says the rider pedals. */
    boolean pedalled(byte[] value) {
        if (pedalled.length == 0) return false;
        for (int offset : pedalled) {
            if (offset + 1 >= value.length || (value[offset] == 0 && value[offset + 1] == 0)) return false;
        }
        return true;
    }
}
