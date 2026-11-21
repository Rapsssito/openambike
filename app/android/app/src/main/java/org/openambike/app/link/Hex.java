package org.openambike.app.link;

/** Bytes as hexadecimal text, as they cross between the JavaScript and the native link. */
final class Hex {
    private static final char[] DIGITS = "0123456789abcdef".toCharArray();

    private Hex() {}

    /** Bytes as lowercase hexadecimal, two digits each, with no separator. */
    static String encode(byte[] bytes) {
        char[] text = new char[bytes.length * 2];
        for (int i = 0; i < bytes.length; i++) {
            text[i * 2] = DIGITS[(bytes[i] >> 4) & 0x0f];
            text[i * 2 + 1] = DIGITS[bytes[i] & 0x0f];
        }
        return new String(text);
    }

    /**
     * Hexadecimal text as bytes; spaces are ignored.
     *
     * @throws IllegalArgumentException if the text has an odd number of digits or a character that is not one
     */
    static byte[] decode(String text) {
        String digits = text.replace(" ", "");
        if (digits.length() % 2 != 0) throw new IllegalArgumentException("Odd number of hexadecimal digits.");
        byte[] bytes = new byte[digits.length() / 2];
        for (int i = 0; i < bytes.length; i++) {
            int high = Character.digit(digits.charAt(i * 2), 16);
            int low = Character.digit(digits.charAt(i * 2 + 1), 16);
            if (high < 0 || low < 0) throw new IllegalArgumentException("Not a hexadecimal digit.");
            bytes[i] = (byte) ((high << 4) | low);
        }
        return bytes;
    }
}
