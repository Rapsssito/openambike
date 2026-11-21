package org.openambike.app.link;

import android.annotation.SuppressLint;
import android.content.Context;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Bundle;
import android.os.Looper;
import java.io.BufferedWriter;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.util.Set;
import java.util.UUID;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * One ride written to a file as it happens, one JSON object per line: the phone's GPS fixes, the bike's notifications
 * of the characteristics asked for, as they come and undecoded, and the rider's pauses. src/rides/ reads it, decoding
 * the bike's bytes with src/ble/protocol.js; this class knows nothing of the protocol. GPS comes from Android's own
 * location service, not Google's, which F-Droid refuses.
 */
@SuppressLint("MissingPermission")
final class RideRecorder implements LocationListener {
    /** How often a GPS fix is asked for. */
    static final long FIX_INTERVAL_MS = 1000;
    /** The version of the file's format, written in its first line. */
    static final int FORMAT = 1;
    /** From this speed, in metres per second, a fix says the phone moves, as src/rides/ride.js reads it. */
    static final float MOVING_MPS = 1;

    private final LocationManager locations;
    private final Set<UUID> characteristics;
    /** Told when a GPS fix says the phone moves. */
    private final Runnable onMoving;
    private final BufferedWriter out;
    final long id;
    private boolean paused;

    /**
     * Starts writing a new ride, or goes on with one whose file exists, after Android restarted the service.
     *
     * @param id the ride's identifier: when it started, in milliseconds since 1970, which also names its file
     */
    RideRecorder(Context context, File file, long id, Set<UUID> characteristics, Looper looper, Runnable onMoving)
        throws IOException {
        this.id = id;
        this.characteristics = characteristics;
        this.onMoving = onMoving;
        boolean resumed = file.exists();
        out = new BufferedWriter(new OutputStreamWriter(new FileOutputStream(file, true), StandardCharsets.UTF_8));
        write(event(resumed ? "restart" : "start").put("format", FORMAT));
        locations = (LocationManager) context.getSystemService(Context.LOCATION_SERVICE);
        if (locations != null) {
            // With GPS off, the ride is written all the same, with the bike's figures and no route, until it is on.
            if (!locations.isProviderEnabled(LocationManager.GPS_PROVIDER)) write(event("noGps"));
            try {
                locations.requestLocationUpdates(LocationManager.GPS_PROVIDER, FIX_INTERVAL_MS, 0, this, looper);
            } catch (SecurityException noLocation) {
                // Location refused, or not allowed with the app closed: the bike's figures are written all the same.
                write(event("noGps"));
            }
        }
    }

    boolean paused() {
        return paused;
    }

    /** A notification of the bike, written if it is of a characteristic asked for. */
    void frame(UUID characteristic, byte[] value) {
        if (!characteristics.contains(characteristic)) return;
        write(event("frame").put("c", characteristic.toString()).put("v", Hex.encode(value)));
    }

    void pause() {
        if (paused) return;
        paused = true;
        write(event("pause"));
    }

    void resume() {
        if (!paused) return;
        paused = false;
        write(event("resume"));
    }

    /**
     * Ends the ride and its file.
     *
     * @param end when the ride ended, in milliseconds since 1970, if before now: its last movement, for a ride auto-ride
     *     stopped; null for now
     */
    void stop(Long end) {
        if (locations != null) locations.removeUpdates(this);
        JsonLine stop = event("stop");
        if (end != null) stop.put("end", end);
        write(stop);
        try {
            out.close();
        } catch (IOException ignored) {
            // What was written stays.
        }
    }

    @Override
    public void onLocationChanged(Location location) {
        JsonLine fix = event("fix")
            .put("lat", location.getLatitude())
            .put("lon", location.getLongitude())
            .put("at", location.getTime());
        if (location.hasAltitude()) fix.put("alt", location.getAltitude());
        if (location.hasAccuracy()) fix.put("acc", location.getAccuracy());
        if (location.hasSpeed()) fix.put("speed", location.getSpeed());
        write(fix);
        if (location.hasSpeed() && location.getSpeed() >= MOVING_MPS) onMoving.run();
    }

    @Override
    public void onProviderEnabled(String provider) {
        write(event("gps"));
    }

    @Override
    public void onProviderDisabled(String provider) {
        write(event("noGps"));
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onStatusChanged(String provider, int status, Bundle extras) {}

    private JsonLine event(String type) {
        return new JsonLine().put("t", System.currentTimeMillis()).put("type", type);
    }

    /** Writes a line at once, so that a ride survives the app being stopped. */
    private void write(JsonLine line) {
        try {
            out.write(line.json.toString());
            out.write('\n');
            out.flush();
        } catch (IOException ignored) {
            // A line lost to a full storage: the rest of the ride goes on.
        }
    }

    /** A JSONObject whose put cannot fail for the plain values written here. */
    private static final class JsonLine {
        final JSONObject json = new JSONObject();

        JsonLine put(String key, Object value) {
            try {
                json.put(key, value);
            } catch (JSONException impossible) {
                throw new IllegalStateException(impossible);
            }
            return this;
        }
    }
}
