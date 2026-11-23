package org.openambike.app.link;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

public class JsonNumbersTest {
    @Test
    public void aNumberFromTheAppIsReadAsALongWhateverTypeJsonGaveIt() {
        // A small number, as the byte where a ride is read from, comes as an Integer, which Capacitor's getLong refuses.
        assertEquals(Long.valueOf(31_981), JsonNumbers.asLong(31_981));
        assertEquals(Long.valueOf(1_795_449_453_178L), JsonNumbers.asLong(1_795_449_453_178L));
        assertEquals(Long.valueOf(42), JsonNumbers.asLong(42.0));
    }

    @Test
    public void anythingElseIsNoNumber() {
        assertNull(JsonNumbers.asLong(null));
        assertNull(JsonNumbers.asLong("42"));
        assertNull(JsonNumbers.asLong(42.5));
    }
}
