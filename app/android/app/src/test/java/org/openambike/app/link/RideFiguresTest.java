package org.openambike.app.link;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.Locale;
import java.util.UUID;
import org.junit.Test;

public class RideFiguresTest {
    private static final UUID ASI = UUID.fromString("00000000-0000-0000-0000-0000000081b0");
    private static final UUID BATTERY = UUID.fromString("00000000-0000-0000-0000-0000000081b1");

    private static RideFigures figures(double kmPerUnit, String unit) {
        return new RideFigures(1_000_000, new RideFigures.Odometer(ASI, 0, 100), kmPerUnit, unit);
    }

    /** An ASI metrics frame with the odometer in hundredths of a kilometre, little-endian, and the rest zero. */
    private static byte[] odometer(long hundredths) {
        byte[] value = new byte[12];
        for (int i = 0; i < 4; i++) value[i] = (byte) (hundredths >> (8 * i));
        return value;
    }

    @Test
    public void timeLeavesOutTheRidersPauses() {
        RideFigures ride = figures(1, "km");
        assertEquals(60_000, ride.elapsedMs(1_060_000));
        ride.pause(1_060_000);
        assertTrue(ride.paused());
        assertEquals(60_000, ride.elapsedMs(1_200_000));
        ride.resume(1_200_000);
        assertFalse(ride.paused());
        assertEquals(90_000, ride.elapsedMs(1_230_000));
    }

    @Test
    public void distanceIsTheOdometersRiseOutsidePausesAndUnderAKilometreAStep() {
        RideFigures ride = figures(1, "km");
        assertNull(ride.distance(Locale.ROOT));
        assertTrue(ride.frame(ASI, odometer(377_423)));
        assertEquals("0.0 km", ride.distance(Locale.ROOT));
        ride.frame(ASI, odometer(377_473));
        assertEquals("0.5 km", ride.distance(Locale.ROOT));
        // While paused, readings are left out; the step across the pause counts if under a kilometre.
        ride.pause(2_000_000);
        assertTrue(ride.frame(ASI, odometer(377_900)));
        ride.resume(2_100_000);
        ride.frame(ASI, odometer(377_523));
        assertEquals("1.0 km", ride.distance(Locale.ROOT));
        // A jump of a kilometre or more, as after a long time disconnected, does not count.
        ride.frame(ASI, odometer(377_700));
        assertEquals("1.0 km", ride.distance(Locale.ROOT));
    }

    @Test
    public void distanceIsInTheRidersUnitsAndLocale() {
        RideFigures ride = figures(1.609344, "mi");
        ride.frame(ASI, odometer(0));
        ride.frame(ASI, odometer(90));
        ride.frame(ASI, odometer(180));
        ride.frame(ASI, odometer(260));
        assertEquals("1,6 mi", ride.distance(Locale.forLanguageTag("es")));
    }

    @Test
    public void otherCharacteristicsAndRidesWithNoOdometerAreLeftOut() {
        assertFalse(figures(1, "km").frame(BATTERY, odometer(100)));
        assertFalse(figures(1, "km").frame(ASI, new byte[2]));
        RideFigures older = new RideFigures(1_000_000, null, 1, "km");
        assertFalse(older.frame(ASI, odometer(100)));
        assertNull(older.distance(Locale.ROOT));
    }
}
