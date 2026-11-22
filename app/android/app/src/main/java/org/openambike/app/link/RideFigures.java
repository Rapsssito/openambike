package org.openambike.app.link;

import java.util.Locale;
import java.util.UUID;

/**
 * The figures the ride's notification shows while it is recorded: its time, from its start less the rider's pauses, and
 * its distance, the rise of the bike's odometer while connected, counted as src/rides/ride.js counts it. Where the
 * odometer sits in the bike's notifications comes from src/rides/, prepared from src/ble/protocol.js, so that this class
 * knows nothing of the protocol. It has no Android code, so that it is tested on its own; the service keeps its state
 * with the ride, so that the figures survive Android restarting the service.
 */
final class RideFigures {
    /** Where a notification of the bike holds the odometer: an unsigned 32-bit little-endian value. */
    static final class Odometer {
        final UUID characteristic;
        final int offset;
        /** The odometer's units in a kilometre. */
        final double perKm;

        Odometer(UUID characteristic, int offset, double perKm) {
            this.characteristic = characteristic;
            this.offset = offset;
            this.perKm = perKm;
        }
    }

    final long startedAt;
    private final Odometer odometer;
    private final double kmPerUnit;
    private final String unit;
    long pausedMs;
    /** When the rider paused, while paused; null otherwise. */
    Long pausedAt;
    double km;
    /** The odometer's last reading outside the rider's pauses, in kilometres; null before the first. */
    Double lastOdometerKm;

    /**
     * @param startedAt in milliseconds since 1970
     * @param odometer null for a ride with no odometer to read, as one started by an earlier version
     * @param kmPerUnit kilometres in the rider's unit of distance
     * @param unit the unit's symbol, as the app shows it
     */
    RideFigures(long startedAt, Odometer odometer, double kmPerUnit, String unit) {
        this.startedAt = startedAt;
        this.odometer = odometer;
        this.kmPerUnit = kmPerUnit;
        this.unit = unit;
    }

    boolean paused() {
        return pausedAt != null;
    }

    void pause(long now) {
        if (pausedAt == null) pausedAt = now;
    }

    void resume(long now) {
        if (pausedAt == null) return;
        pausedMs += Math.max(0, now - pausedAt);
        pausedAt = null;
    }

    /** The ride's time as of {@code now}, less the rider's pauses, in milliseconds. */
    long elapsedMs(long now) {
        long until = pausedAt != null ? pausedAt : now;
        return Math.max(0, until - startedAt - pausedMs);
    }

    /**
     * A notification of the bike: the odometer's rise counts if it is outside a pause, and less than a kilometre since
     * the reading before, as src/rides/ride.js counts it.
     *
     * @return whether it was a reading of the odometer
     */
    boolean frame(UUID characteristic, byte[] value) {
        if (odometer == null || !odometer.characteristic.equals(characteristic)) return false;
        if (value.length < odometer.offset + 4) return false;
        if (pausedAt != null) return true;
        int at = odometer.offset;
        long raw = (value[at] & 0xffL)
            | (value[at + 1] & 0xffL) << 8
            | (value[at + 2] & 0xffL) << 16
            | (value[at + 3] & 0xffL) << 24;
        double reading = raw / odometer.perKm;
        if (lastOdometerKm != null) {
            double step = reading - lastOdometerKm;
            if (step > 0 && step < 1) km += step;
        }
        lastOdometerKm = reading;
        return true;
    }

    /** The distance in the rider's units, with one decimal, once the bike has sent its odometer; null before. */
    String distance(Locale locale) {
        if (lastOdometerKm == null && km == 0) return null;
        return String.format(locale, "%.1f %s", km / kmPerUnit, unit);
    }
}
