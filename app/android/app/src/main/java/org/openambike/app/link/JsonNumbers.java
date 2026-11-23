package org.openambike.app.link;

/**
 * Numbers the app sends in a plugin call, read whatever type JSON gave them: a small one comes as an Integer, a large one
 * as a Long, which Capacitor's getLong and getInt each refuse for the other.
 */
final class JsonNumbers {
    private JsonNumbers() {}

    /** The value as a long, or null if it is no whole number. */
    static Long asLong(Object value) {
        if (value instanceof Integer || value instanceof Long) return ((Number) value).longValue();
        if (value instanceof Double && (Double) value == Math.rint((Double) value)) return ((Double) value).longValue();
        return null;
    }
}
