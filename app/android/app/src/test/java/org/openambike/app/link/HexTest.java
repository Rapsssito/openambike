package org.openambike.app.link;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;

import org.junit.Test;

public class HexTest {
    @Test
    public void bytesBecomeLowercaseHexadecimalAndBack() {
        byte[] bytes = { 0x00, 0x0a, (byte) 0xff, 0x7f };
        assertEquals("000aff7f", Hex.encode(bytes));
        assertArrayEquals(bytes, Hex.decode("000aff7f"));
        assertArrayEquals(bytes, Hex.decode("00 0A FF 7F"));
        assertArrayEquals(new byte[0], Hex.decode(""));
    }

    @Test
    public void textThatIsNotHexadecimalIsRefused() {
        assertThrows(IllegalArgumentException.class, () -> Hex.decode("abc"));
        assertThrows(IllegalArgumentException.class, () -> Hex.decode("zz"));
    }
}
