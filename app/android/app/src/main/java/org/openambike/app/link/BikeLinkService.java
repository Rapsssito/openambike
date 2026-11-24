package org.openambike.app.link;

import android.app.Notification;
import android.app.PendingIntent;
import android.app.Service;
import android.bluetooth.BluetoothManager;
import android.bluetooth.le.ScanSettings;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.os.Binder;
import android.os.IBinder;
import android.os.SystemClock;
import android.view.View;
import android.widget.RemoteViews;
import androidx.core.app.NotificationChannelCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;
import java.io.File;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.openambike.app.MainActivity;
import org.openambike.app.R;

/**
 * The service that holds the Bluetooth link to the bike. Bound by the app's screen, it lives as long as the screen;
 * with auto-connect on, it also runs as a foreground service, with its notification, so that {@link AutoConnect} goes
 * on with the app closed and after the phone restarts. Everything it does with the link runs on the link's thread.
 */
@SuppressWarnings("MissingPermission")
public final class BikeLinkService extends Service implements BikeLink.Listener, AutoConnect.Actions {
    /** Given to the code bound to the service. */
    final class LocalBinder extends Binder {
        BikeLinkService service() {
            return BikeLinkService.this;
        }
    }

    /**
     * What auto-connect is doing, in every state: Android's lowest importance, one folded line at the bottom of the
     * notification shade, with no sound and no icon in the status bar, so that it never bothers the rider.
     */
    private static final String QUIET_CHANNEL = "auto-connect-quiet";
    /** Only the warning that the bike may be unlocked asks for attention. */
    private static final String ALERT_CHANNEL = "auto-connect-alerts";
    /**
     * The ride being recorded, with its time and distance and a button that pauses or resumes it: Android's low
     * importance, silent and with no pop-up, but with an icon in the status bar and shown on the lock screen.
     */
    private static final String RIDE_CHANNEL = "ride";
    /** What the ride notification's button asks: pause the ride if it records, resume it if paused. */
    private static final String ACTION_TOGGLE_RIDE = "org.openambike.app.TOGGLE_RIDE";
    /** The ride notification shows a new distance at most this often. */
    private static final long RIDE_NOTIFY_MS = 5_000;
    /** The channel of earlier versions, removed. */
    private static final String OLD_STATUS_CHANNEL = "auto-connect";
    private static final int STATUS_NOTIFICATION = 1;
    private static final int ALERT_NOTIFICATION = 2;
    private static final long TICK_MS = 500;
    /** Android turns a scan of more than 30 minutes into one that hears only what others hear: it is renewed before. */
    private static final long SCAN_RENEW_MS = 25 * 60_000;
    private static final long AUTH_TIMEOUT_MS = 5_000;

    private final LocalBinder binder = new LocalBinder();
    private BikeLink link;
    private BikeLink.Listener listener;
    private SecretStore store;
    private AutoConnectConfig config;
    /**
     * The settings kept, as saved: they stay when a newer version of the app cannot read them, so that auto-connect shows
     * as on until the app's next connection sends them in the new form.
     */
    private String savedConfig;
    private AutoConnect auto;
    /** Auto-ride, while auto-connect runs with it on. */
    private AutoRide autoRide;
    private final AutoRide.Actions autoRideActions = new AutoRide.Actions() {
        @Override
        public void startRide() {
            if (config == null || config.ride == null) return;
            try {
                beginRide(config.ride, true);
            } catch (JSONException unreadable) {
                // Not started: the configuration comes again with the app's next connection.
            }
        }

        @Override
        public void stopRide(long lastMoved) {
            endRide(System.currentTimeMillis() - (now() - lastMoved));
        }
    };
    private volatile boolean appOnScreen;
    /**
     * Whether auto-connect let the bike go, the rider having left: the app then connects only when the rider asks, not
     * by itself, until auto-connect connects again.
     */
    private volatile boolean letGo;
    private AutoConnect.Status status = AutoConnect.Status.LOOKING;
    /** The bike's lock as last read or notified on this connection, for the notification; null when not known. */
    private Boolean bikeLocked;
    /** Whether the pause came from the bike standing near for long, which the quiet notification then says. */
    private boolean pausedParked;
    /** The bike whose link the bike accepted the key on, whoever authenticated it; null when none. */
    private String authenticated;
    private boolean authenticating;
    private boolean rssiPending;
    private Boolean scanFast;
    private long scanStartedAt;
    /** The ride being recorded, if any. */
    private RideRecorder ride;
    /** What src/rides/ prepared for the ride being recorded, with its identifier; kept until it stops. */
    private JSONObject rideConfig;
    /** The time and distance of the ride being recorded, for its notification; kept in {@link #rideConfig}. */
    private RideFigures figures;
    /** The distance the ride notification shows, and when it was last shown, in {@link SystemClock#elapsedRealtime}. */
    private String rideShownDistance;
    private long rideNotifiedAt;
    private SharedPreferences prefs;
    /**
     * What auto-connect keeps apart from its settings, in the backup: the automatic options as the rider set them,
     * without the key, so that a restored phone turns them on again, and whether the rider's lock holds.
     */
    private SharedPreferences autoPrefs;
    private final Runnable tick = this::onTick;
    private final Runnable authTimeout = this::authFailed;

    @Override
    public void onCreate() {
        super.onCreate();
        store = new SecretStore(this, "auto-connect");
        prefs = getSharedPreferences("rides", MODE_PRIVATE);
        autoPrefs = getSharedPreferences("auto-connect", MODE_PRIVATE);
        String activeRide = prefs.getString("active", null);
        if (activeRide != null) {
            try {
                rideConfig = new JSONObject(activeRide);
                figures = figuresOf(rideConfig);
            } catch (JSONException unreadable) {
                prefs.edit().remove("active").apply();
            }
        }
        BluetoothManager manager = (BluetoothManager) getSystemService(Context.BLUETOOTH_SERVICE);
        if (manager != null && manager.getAdapter() != null) link = new BikeLink(this, manager.getAdapter(), this);
        savedConfig = store.load();
        if (savedConfig != null) {
            try {
                config = new AutoConnectConfig(savedConfig);
            } catch (JSONException | IllegalArgumentException olderVersion) {
                // Kept: the app sends them again in the new form on its next connection.
                config = null;
            }
        }
        // Created because the app opened and bound to it: with auto-connect on or a ride recorded, it runs as a
        // foreground service at once, whether the bike is connected or not, so that it goes on once the app is closed.
        if (link != null && (config != null || rideConfig != null)) {
            try {
                ContextCompat.startForegroundService(this, new Intent(this, BikeLinkService.class));
            } catch (IllegalStateException notAllowedNow) {
                // Bound from the background, which Android refuses to start from: the next start does it.
            }
        }
    }

    @Override
    public IBinder onBind(Intent intent) {
        return binder;
    }

    /**
     * Started for auto-connect, when it is turned on and after the phone restarts, and for a ride, when it starts and
     * when Android restarts the service during one.
     */
    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (link == null || (config == null && rideConfig == null)) {
            stopSelf(startId);
            return START_NOT_STICKY;
        }
        createChannels();
        goForeground();
        link.post(() -> {
            if (config != null) startAuto();
            if (rideConfig != null && ride == null) startRecorder();
        });
        if (intent != null && ACTION_TOGGLE_RIDE.equals(intent.getAction())) link.post(this::toggleRidePaused);
        return START_STICKY;
    }

    /** Runs as a foreground service of the types what it does needs: the connected bike, and location for a ride. */
    // The service type is given from Android 10; ServiceCompat leaves it out before.
    @android.annotation.SuppressLint("InlinedApi")
    private void goForeground() {
        int types = ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE;
        boolean location = rideConfig != null && hasLocationPermission() && (appOnScreen || hasBackgroundLocation());
        try {
            ServiceCompat.startForeground(
                this,
                STATUS_NOTIFICATION,
                statusNotification(),
                location ? types | ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION : types
            );
        } catch (SecurityException notAllowedNow) {
            // Android refuses location to a service started with the app closed without "all the time": the ride
            // goes on with the bike's figures.
            ServiceCompat.startForeground(this, STATUS_NOTIFICATION, statusNotification(), types);
        }
    }

    private boolean hasLocationPermission() {
        return ContextCompat.checkSelfPermission(this, android.Manifest.permission.ACCESS_FINE_LOCATION)
            == PackageManager.PERMISSION_GRANTED;
    }

    /** Location "all the time", which a ride started with the app closed needs for its route; always before Android 10. */
    private boolean hasBackgroundLocation() {
        return android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.Q
            || ContextCompat.checkSelfPermission(this, android.Manifest.permission.ACCESS_BACKGROUND_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
    }

    @Override
    public void onDestroy() {
        if (link != null) {
            link.post(() -> {
                stopAuto();
                // The ride stays active: a restarted service goes on writing it.
                if (ride != null) ride.stop(null);
                ride = null;
            });
            link.close();
        }
        link = null;
        super.onDestroy();
    }

    /** The link, or null on a phone with no Bluetooth. */
    BikeLink link() {
        return link;
    }

    /** Who hears what the link reports: the app's screen, while it is bound. */
    void setListener(BikeLink.Listener listener) {
        this.listener = listener;
    }

    // What the app's screen tells it.

    /** Turns auto-connect on with what src/auto-connect.js prepared, or off with null. */
    void setAutoConnect(String json) throws Exception {
        if (json == null) {
            store.delete();
            savedConfig = null;
            autoPrefs.edit().remove("options").apply();
            config = null;
            if (link != null) link.post(this::stopAuto);
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
            stopSelf();
            return;
        }
        // The same configuration again, as at each connection of the app: auto-connect goes on, with its pause and events.
        if (json.equals(savedConfig) && config != null) {
            ContextCompat.startForegroundService(this, new Intent(this, BikeLinkService.class));
            return;
        }
        AutoConnectConfig next = new AutoConnectConfig(json);
        store.save(json);
        savedConfig = json;
        JSONObject root = new JSONObject(json);
        JSONObject options = new JSONObject()
            .put("autoLock", root.optBoolean("autoLock", false))
            .put("autoUnlock", root.optBoolean("autoUnlock", false))
            .put("autoRide", root.optBoolean("autoRide", false));
        autoPrefs.edit().putString("options", options.toString()).apply();
        boolean running = config != null;
        config = next;
        if (running && link != null) {
            // New texts or thresholds: auto-connect starts again with them.
            link.post(() -> {
                stopAuto();
                startAuto();
            });
        }
        ContextCompat.startForegroundService(this, new Intent(this, BikeLinkService.class));
    }

    /** The configuration auto-connect runs with, or waits to have sent again in the new form; null when it is off. */
    String autoConnect() {
        return savedConfig;
    }

    /**
     * What auto-connect does, for the app's Settings: whether it runs, the signal as last read, how long it still waits
     * for a dropped connection, and its events, newest first, each event with its time in milliseconds since 1970.
     * Called on the link's thread.
     */
    JSONObject autoConnectEvents() throws JSONException {
        JSONObject result = new JSONObject();
        if (auto == null) return result.put("running", false);
        long now = now();
        long wall = System.currentTimeMillis();
        AutoConnect.Preview preview = auto.preview(now);
        result.put("running", true).put("connected", preview.connected);
        if (preview.signalNowDbm != null) result.put("signalNowDbm", preview.signalNowDbm);
        if (preview.heardDbm != null) result.put("heardDbm", preview.heardDbm).put("heardAgoMs", preview.heardAgoMs);
        if (preview.dropLeftMs != null) result.put("dropLeftMs", preview.dropLeftMs);
        JSONArray events = new JSONArray();
        for (AutoConnect.Entry entry : auto.events()) {
            events.put(
                new JSONObject()
                    .put("at", wall - (now - entry.at))
                    .put("event", entry.event.name())
                    .put("value", entry.value)
                    .put("extra", entry.extra)
            );
        }
        return result.put("events", events);
    }


    /**
     * The automatic options a backup brought back, as {@code { autoLock, autoUnlock, autoRide }}, while auto-connect has
     * no settings of this phone: the app turns it on again with them at its next connection. Null otherwise.
     */
    String restoredAutoConnect() {
        return savedConfig == null ? autoPrefs.getString("options", null) : null;
    }

    void setAppOnScreen(boolean onScreen) {
        // Kept even before the link exists, as when the app opens: otherwise the service would take it for in the
        // background, and refuse its connections while auto-connect is on.
        appOnScreen = onScreen;
    }

    /** The rider asked the app to connect: that ends a pause, and lets the app connect after auto-connect let go. */
    void riderConnecting() {
        letGo = false;
        if (link == null) return;
        link.post(() -> {
            if (auto != null) auto.resume(now());
        });
    }

    /**
     * The rider disconnected in the app: auto-connect pauses until they connect again, and a ride auto-ride started
     * ends, since nothing would end it before the pause does.
     */
    void pauseAutoConnect() {
        if (link == null) return;
        link.post(() -> {
            if (auto != null) auto.userDisconnected(now());
            if (autoRide != null) autoRide.letGo();
        });
    }

    /** The rider locked or unlocked the bike in the app: kept, so that a lock by hand holds against auto-unlock. */
    void setLockHeld(boolean held) {
        autoPrefs.edit().putBoolean("lockHeld", held).apply();
        if (link == null) return;
        link.post(() -> {
            if (auto != null) auto.setLockHeld(held);
        });
    }

    /**
     * Whether the app may connect now: on screen, unless auto-connect let the bike go and the rider did not ask since; in
     * the background, only to the link auto-connect holds.
     */
    boolean hasLetGo() {
        return letGo;
    }

    boolean appMayConnect(String address) {
        if (config == null || link == null || link.isReady(address)) return true;
        return appOnScreen && !letGo;
    }

    // Rides.

    private File ridesDir() {
        File dir = new File(getFilesDir(), "rides");
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        return dir;
    }

    private File rideFile(long id) {
        return new File(ridesDir(), id + ".jsonl");
    }

    /** The summary src/rides/ made of a ride that ended, kept apart, so that the history reads no ride's file. */
    private File summaryFile(long id) {
        File dir = new File(getFilesDir(), "ride-summaries");
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        return new File(dir, id + ".json");
    }

    private static String readText(File file) throws IOException {
        try (RandomAccessFile in = new RandomAccessFile(file, "r")) {
            byte[] bytes = new byte[(int) in.length()];
            in.readFully(bytes);
            return new String(bytes, StandardCharsets.UTF_8);
        }
    }

    /** Keeps the summary of a ride, as src/rides/ made it. */
    void saveRideSummary(long id, String summary) throws IOException {
        if (!rideFile(id).exists()) return;
        File file = summaryFile(id);
        File next = new File(file.getPath() + ".new");
        try (java.io.FileOutputStream out = new java.io.FileOutputStream(next)) {
            out.write(summary.getBytes(StandardCharsets.UTF_8));
        }
        if (!next.renameTo(file)) throw new IOException("The summary could not be kept.");
    }

    /**
     * Starts recording a ride with what src/rides/ prepared: the characteristics whose notifications it keeps, and the
     * texts of its notification.
     *
     * @return the ride's identifier
     */
    long startRide(String json) throws JSONException {
        if (rideConfig != null) return rideConfig.getLong("id");
        long id = beginRide(json, false);
        if (link != null) {
            link.post(() -> {
                if (autoRide != null) autoRide.startedByHand(now());
            });
        }
        return id;
    }

    /** Starts a ride, by hand or by auto-ride, which then is the one to stop it. */
    private long beginRide(String json, boolean byAutoRide) throws JSONException {
        JSONObject next = new JSONObject(json);
        long id = System.currentTimeMillis();
        next.put("id", id);
        next.put("auto", byAutoRide);
        rideConfig = next;
        figures = figuresOf(next);
        prefs.edit().putString("active", next.toString()).apply();
        ContextCompat.startForegroundService(this, new Intent(this, BikeLinkService.class));
        return id;
    }

    private void startRecorder() {
        try {
            JSONArray list = rideConfig.getJSONArray("characteristics");
            Set<UUID> characteristics = new HashSet<>();
            for (int i = 0; i < list.length(); i++) characteristics.add(UUID.fromString(list.getString(i)));
            long id = rideConfig.getLong("id");
            ride = new RideRecorder(this, rideFile(id), id, characteristics, link.looper());
            if (rideConfig.optBoolean("paused", false)) ride.pause();
            showStatus();
        } catch (JSONException | IOException | IllegalArgumentException | SecurityException error) {
            rideConfig = null;
            figures = null;
            prefs.edit().remove("active").apply();
        }
    }

    /** The rider stops the ride; the callback gets its identifier, or null if none was being recorded. */
    void stopRide(java.util.function.Consumer<Long> done) {
        link.post(() -> {
            Long id = ride != null ? ride.id : null;
            if (autoRide != null && rideConfig != null) autoRide.stoppedByHand();
            endRide(null);
            done.accept(id);
        });
    }

    /** Ends the ride being recorded, on the link's thread, at {@code end} if given, otherwise now. */
    private void endRide(Long end) {
        if (ride != null) ride.stop(end);
        ride = null;
        rideConfig = null;
        figures = null;
        prefs.edit().remove("active").apply();
        if (config == null) {
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
            stopSelf();
        } else {
            goForeground();
            showStatus();
        }
    }

    /** Pauses or resumes the ride, as the rider asks in the app. */
    void setRidePaused(boolean paused) {
        link.post(() -> applyRidePaused(paused));
    }

    /** The ride notification's button: pauses the ride if it records, resumes it if paused. */
    private void toggleRidePaused() {
        if (ride != null) applyRidePaused(!ride.paused());
    }

    /** Pauses or resumes the ride, on the link's thread. */
    private void applyRidePaused(boolean paused) {
        if (ride == null) return;
        if (paused) ride.pause();
        else ride.resume();
        if (figures != null) {
            if (paused) figures.pause(System.currentTimeMillis());
            else figures.resume(System.currentTimeMillis());
        }
        try {
            rideConfig.put("paused", paused);
        } catch (JSONException ignored) {
            // The pause is in the ride's file all the same.
        }
        keepRide();
        showStatus();
    }

    /** Keeps the ride being recorded, with its figures, so that a restarted service goes on with it. */
    private void keepRide() {
        if (rideConfig == null) return;
        try {
            if (figures != null) {
                JSONObject kept = new JSONObject().put("pausedMs", figures.pausedMs).put("km", figures.km);
                if (figures.pausedAt != null) kept.put("pausedAt", figures.pausedAt);
                if (figures.lastOdometerKm != null) kept.put("lastOdometerKm", figures.lastOdometerKm);
                rideConfig.put("figures", kept);
            }
        } catch (JSONException ignored) {
            // Kept without its figures: the notification counts them again from there.
        }
        prefs.edit().putString("active", rideConfig.toString()).apply();
    }

    /**
     * The figures of a ride, from what src/rides/ prepared and what was kept of them; null if unreadable. A ride
     * started by an earlier version has no odometer to read, and its notification shows only its time.
     */
    private static RideFigures figuresOf(JSONObject ride) {
        try {
            JSONObject odometerJson = ride.optJSONObject("odometer");
            RideFigures.Odometer odometer = odometerJson == null
                ? null
                : new RideFigures.Odometer(
                    UUID.fromString(odometerJson.getString("characteristic")),
                    odometerJson.getInt("offset"),
                    odometerJson.getDouble("perKm")
                );
            JSONObject distance = ride.optJSONObject("distance");
            RideFigures result = new RideFigures(
                ride.getLong("id"),
                odometer,
                distance != null ? distance.getDouble("kmPerUnit") : 1,
                distance != null ? distance.getString("unit") : "km"
            );
            JSONObject kept = ride.optJSONObject("figures");
            if (kept != null) {
                result.pausedMs = kept.optLong("pausedMs", 0);
                result.pausedAt = kept.has("pausedAt") ? kept.getLong("pausedAt") : null;
                result.km = kept.optDouble("km", 0);
                result.lastOdometerKm = kept.has("lastOdometerKm") ? kept.getDouble("lastOdometerKm") : null;
            }
            if (ride.optBoolean("paused", false)) result.pause(System.currentTimeMillis());
            return result;
        } catch (JSONException | IllegalArgumentException unreadable) {
            return null;
        }
    }

    /** The ride being recorded, as {@code { id, paused }}, or null. */
    JSONObject activeRide() throws JSONException {
        if (rideConfig == null) return null;
        return new JSONObject().put("id", rideConfig.getLong("id")).put("paused", rideConfig.optBoolean("paused", false));
    }

    /** The rides kept, newest first, each as {@code { id, size, summary }}, with its summary if one was kept. */
    JSONArray rides() throws JSONException {
        File[] files = ridesDir().listFiles((dir, name) -> name.endsWith(".jsonl"));
        JSONArray list = new JSONArray();
        if (files == null) return list;
        Arrays.sort(files, (a, b) -> b.getName().compareTo(a.getName()));
        for (File file : files) {
            String name = file.getName();
            long id = Long.parseLong(name.substring(0, name.length() - 6));
            JSONObject ride = new JSONObject().put("id", id).put("size", file.length());
            File summary = summaryFile(id);
            if (summary.exists()) {
                try {
                    ride.put("summary", readText(summary));
                } catch (IOException unreadable) {
                    // Made again from the ride's file.
                }
            }
            list.put(ride);
        }
        return list;
    }

    /** A ride's file from byte {@code from}: the text up to its last whole line, and where the next read starts. */
    JSONObject readRide(long id, long from) throws IOException, JSONException {
        try (RandomAccessFile file = new RandomAccessFile(rideFile(id), "r")) {
            long length = file.length();
            int size = (int) Math.max(0, length - from);
            byte[] bytes = new byte[size];
            file.seek(from);
            file.readFully(bytes);
            int end = size;
            while (end > 0 && bytes[end - 1] != '\n') end--;
            return new JSONObject().put("text", new String(bytes, 0, end, StandardCharsets.UTF_8)).put("next", from + end);
        }
    }

    boolean deleteRide(long id) {
        if (rideConfig != null && rideConfig.optLong("id") == id) return false;
        //noinspection ResultOfMethodCallIgnored
        summaryFile(id).delete();
        return rideFile(id).delete();
    }

    // Auto-connect.

    private void startAuto() {
        if (auto != null || config == null) return;
        auto = new AutoConnect(this, config.settings);
        auto.setLockHeld(autoPrefs.getBoolean("lockHeld", false));
        // Started again with new settings, as at each connection of the app: the lock as last read or notified on this
        // connection goes on, since the bike notifies it only when it changes.
        if (bikeLocked != null) auto.lockState(bikeLocked);
        long now = now();
        if (config.ride != null) {
            autoRide = new AutoRide(autoRideActions, config.rideSettings);
            if (rideConfig != null) autoRide.rideGoingOn(rideConfig.optBoolean("auto", false), now);
        }
        if (link.isReady(config.address) && config.address.equals(authenticated)) auto.linkUp(now);
        auto.start(now);
        link.postDelayed(tick, TICK_MS);
    }

    private void stopAuto() {
        if (auto == null) return;
        auto.stop();
        auto = null;
        autoRide = null;
        link.removeCallbacks(tick);
        link.removeCallbacks(authTimeout);
        authenticating = false;
    }

    private void onTick() {
        if (auto == null) return;
        long now = now();
        auto.tick(now);
        if (autoRide != null) autoRide.tick(now);
        if (scanFast != null && now - scanStartedAt > SCAN_RENEW_MS) scan(scanFast);
        link.postDelayed(tick, TICK_MS);
    }

    private static long now() {
        return SystemClock.elapsedRealtime();
    }

    @Override
    public void scan(boolean fast) {
        scanFast = fast;
        scanStartedAt = now();
        int mode = fast ? ScanSettings.SCAN_MODE_LOW_LATENCY : ScanSettings.SCAN_MODE_LOW_POWER;
        link.startScan("", mode, config.address, (value, error) -> {});
    }

    @Override
    public void stopScan() {
        scanFast = null;
        link.stopScan((value, error) -> {});
    }

    @Override
    public void connect() {
        String address = config.address;
        link.connect(address, (value, error) -> {
            if (auto == null) return;
            if (error != null) auto.linkFailed(now());
            else authenticate(address);
        });
    }

    /** Writes the owner key, as src/ble/bike.js does, and waits for the bike's reply. */
    private void authenticate(String address) {
        AutoConnectConfig.Exchange auth = config.auth;
        authenticating = true;
        link.setNotifications(address, auth.service, auth.characteristic, true, (value, error) -> {
            if (error != null) {
                authFailed();
                return;
            }
            link.write(address, auth.service, auth.characteristic, auth.value, (written, writeError) -> {
                if (writeError != null) authFailed();
                else link.postDelayed(authTimeout, AUTH_TIMEOUT_MS);
            });
        });
    }

    private void authFailed() {
        if (!authenticating) return;
        authenticating = false;
        link.removeCallbacks(authTimeout);
        if (config != null) link.disconnect(config.address, (value, error) -> {});
    }

    /** The bike accepted the key auto-connect sent: it listens to the movement, the lock and, with auto-ride, the battery, then has the link. */
    private void authenticated(String address) {
        authenticating = false;
        link.removeCallbacks(authTimeout);
        AutoConnectConfig.Exchange auth = config.auth;
        AutoConnectConfig.Exchange movement = config.movement;
        AutoConnectConfig.Exchange lock = config.lock;
        BikeLink.Callback ignore = (value, error) -> {};
        link.setNotifications(address, auth.service, auth.characteristic, false, ignore);
        link.setNotifications(address, movement.service, movement.characteristic, true, ignore);
        link.setNotifications(address, lock.service, lock.characteristic, true, ignore);
        if (config.battery != null) {
            link.setNotifications(address, config.battery.service, config.battery.characteristic, true, ignore);
        }
        link.read(address, lock.service, lock.characteristic, (value, error) -> {
            if (auto != null) auto.linkUp(now());
        });
    }

    @Override
    public void readRssi() {
        if (rssiPending) return;
        rssiPending = true;
        link.readRssi(config.address, (value, error) -> {
            rssiPending = false;
            if (auto != null && error == null && value != null && value.length == 1) auto.rssi(value[0], now());
        });
    }

    @Override
    public void lock() {
        AutoConnectConfig.Exchange lock = config.lock;
        link.write(config.address, lock.service, lock.characteristic, lock.value, (value, error) -> {
            if (auto != null) auto.lockDone(error == null, now());
        });
    }

    @Override
    public void unlock() {
        AutoConnectConfig.Exchange unlock = config.unlock;
        link.write(config.address, unlock.service, unlock.characteristic, unlock.value, (value, error) -> {});
    }

    /** Auto-connect lets the bike go, the rider having left it: a ride auto-ride started ends. */
    @Override
    public void disconnect() {
        letGo = true;
        if (autoRide != null) autoRide.letGo();
        link.disconnect(config.address, (value, error) -> {});
    }

    @Override
    public void status(AutoConnect.Status status) {
        if (this.status == status) return;
        this.status = status;
        if (status != AutoConnect.Status.PAUSED) pausedParked = false;
        showStatus();
    }

    private void showStatus() {
        if ((config != null || rideConfig != null) && hasNotificationPermission()) {
            NotificationManagerCompat.from(this).notify(STATUS_NOTIFICATION, statusNotification());
        }
    }

    /** The bike's lock, read or notified: the notification says it while connected. */
    private void bikeLock(boolean locked) {
        if (auto != null) auto.lockState(locked);
        if (Boolean.valueOf(locked).equals(bikeLocked)) return;
        bikeLocked = locked;
        if (status == AutoConnect.Status.CONNECTED) showStatus();
    }

    /** A dropped connection did not come back: a ride auto-ride started ends, as when auto-connect lets the bike go. */
    @Override
    public void linkGone() {
        if (autoRide != null) autoRide.letGo();
    }

    /** The rider left the bike: the lock pressed by hand, kept for auto-unlock, is forgotten. */
    @Override
    public void lockHeldEnded() {
        autoPrefs.edit().putBoolean("lockHeld", false).apply();
    }

    @Override
    public void alert(AutoConnect.Alert alert) {
        if (config == null) return;
        if (alert == AutoConnect.Alert.PAUSED_PARKED) {
            // Not a notification of its own: the quiet one says why auto-connect paused.
            pausedParked = true;
            showStatus();
            return;
        }
        if (!hasNotificationPermission()) return;
        String text = config.text("mayBeUnlocked");
        Notification notification = new NotificationCompat.Builder(this, ALERT_CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_bike)
            .setContentTitle(config.text("title"))
            .setContentText(text)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
            .setContentIntent(openApp())
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .build();
        NotificationManagerCompat.from(this).notify(ALERT_NOTIFICATION, notification);
    }

    // Notifications.

    private boolean hasNotificationPermission() {
        return NotificationManagerCompat.from(this).areNotificationsEnabled();
    }

    private void createChannels() {
        NotificationManagerCompat manager = NotificationManagerCompat.from(this);
        manager.deleteNotificationChannel(OLD_STATUS_CHANNEL);
        createChannel(manager, QUIET_CHANNEL, NotificationManagerCompat.IMPORTANCE_MIN, "quietChannel", false);
        createChannel(manager, RIDE_CHANNEL, NotificationManagerCompat.IMPORTANCE_LOW, "rideChannel", false);
        createChannel(manager, ALERT_CHANNEL, NotificationManagerCompat.IMPORTANCE_DEFAULT, "alertChannel", true);
    }

    /**
     * Creates a channel, or renames it in the texts of now. Android refuses a channel with no name: with no text for
     * it, as in settings saved by an earlier version, a channel keeps the name it has, and a new one takes the app's.
     */
    private void createChannel(NotificationManagerCompat manager, String id, int importance, String key, boolean badge) {
        String name = text(key);
        if (name.isEmpty()) {
            if (manager.getNotificationChannelCompat(id) != null) return;
            name = getString(R.string.app_name);
        }
        manager.createNotificationChannel(
            new NotificationChannelCompat.Builder(id, importance).setName(name).setShowBadge(badge).build()
        );
    }

    /** A text of the notifications, from the ride's texts or auto-connect's, whichever has it. */
    private String text(String key) {
        if (rideConfig != null) {
            String value = rideConfig.optJSONObject("texts") != null ? rideConfig.optJSONObject("texts").optString(key, "") : "";
            if (!value.isEmpty()) return value;
        }
        return config != null ? config.text(key) : "";
    }

    private Notification statusNotification() {
        if (rideConfig != null) return rideNotification();
        String key;
        switch (status) {
            case CONNECTED:
                if (bikeLocked == null) key = "connected";
                else key = bikeLocked ? "connectedLocked" : "connectedUnlocked";
                break;
            case PAUSED:
                if (!pausedParked) key = "paused";
                else key = config.settings.autoLock ? "pausedParkedLocked" : "pausedParked";
                break;
            default:
                key = "looking";
                break;
        }
        return quietNotification(config.text(key));
    }

    private Notification quietNotification(String text) {
        return new NotificationCompat.Builder(this, QUIET_CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_bike)
            // The text once, with no title: Android names the app in the notification's header, and a long text
            // unfolds in full when the notification is expanded.
            .setContentText(text)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setShowWhen(false)
            .setContentIntent(openApp())
            .setOngoing(true)
            .setSilent(true)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build();
    }

    /** A new distance on the ride notification, at most every {@link #RIDE_NOTIFY_MS}; its time Android ticks itself. */
    private void rideFiguresChanged() {
        String distance = figures.distance(Locale.getDefault());
        if (Objects.equals(distance, rideShownDistance)) return;
        if (SystemClock.elapsedRealtime() - rideNotifiedAt < RIDE_NOTIFY_MS) return;
        keepRide();
        showStatus();
    }

    /**
     * The ride being recorded: whether it records or is paused, its time, which Android ticks while it records, its
     * distance once the bike has sent its odometer, and one button with an icon, pause while it records and resume
     * while paused. A ride started by an earlier version, with no texts for the button, still has it.
     */
    private Notification rideNotification() {
        boolean paused = rideConfig.optBoolean("paused", false);
        String status = text(paused ? "ridePaused" : "riding");
        RemoteViews views = new RemoteViews(getPackageName(), R.layout.notification_ride);
        views.setTextViewText(R.id.ride_status, status);
        if (figures != null) {
            long elapsed = figures.elapsedMs(System.currentTimeMillis());
            views.setChronometer(R.id.ride_time, SystemClock.elapsedRealtime() - elapsed, null, !paused);
            rideShownDistance = figures.distance(Locale.getDefault());
        } else {
            views.setViewVisibility(R.id.ride_time, View.GONE);
            rideShownDistance = null;
        }
        if (rideShownDistance != null) views.setTextViewText(R.id.ride_distance, rideShownDistance);
        views.setViewVisibility(R.id.ride_distance, rideShownDistance != null ? View.VISIBLE : View.GONE);
        views.setImageViewResource(R.id.ride_toggle, paused ? R.drawable.ic_ride_resume : R.drawable.ic_ride_pause);
        views.setContentDescription(R.id.ride_toggle, text(paused ? "resume" : "pause"));
        views.setOnClickPendingIntent(R.id.ride_toggle, toggleRide());
        rideNotifiedAt = SystemClock.elapsedRealtime();
        return new NotificationCompat.Builder(this, RIDE_CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_bike)
            // The texts, for where Android shows no custom view, and for screen readers.
            .setContentTitle(status)
            .setContentText(rideShownDistance)
            .setStyle(new NotificationCompat.DecoratedCustomViewStyle())
            .setCustomContentView(views)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setShowWhen(false)
            .setContentIntent(openApp())
            .setOngoing(true)
            .setSilent(true)
            .setOnlyAlertOnce(true)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build();
    }

    /** Sent by the ride notification's button to this service. */
    private PendingIntent toggleRide() {
        Intent intent = new Intent(this, BikeLinkService.class).setAction(ACTION_TOGGLE_RIDE);
        return PendingIntent.getService(this, 1, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private PendingIntent openApp() {
        Intent intent = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    // What the link reports, on its thread.

    @Override
    public void onNotification(String address, UUID service, UUID characteristic, byte[] value) {
        BikeLink.Listener current = listener;
        if (current != null) current.onNotification(address, service, characteristic, value);
        if (ride != null) ride.frame(characteristic, value);
        if (ride != null && figures != null && figures.frame(characteristic, value)) rideFiguresChanged();
        if (config == null || !address.equals(config.address)) return;
        if (characteristic.equals(config.auth.characteristic)) {
            if (config.accepts(value)) {
                authenticated = address;
                letGo = false;
                if (authenticating) authenticated(address);
                else if (auto != null) auto.linkUp(now());
            } else if (authenticating) {
                // The bike refused the key: auto-connect waits for the app rather than try it again and again.
                if (auto != null) auto.userDisconnected(now());
                authFailed();
            }
        } else if (auto != null && characteristic.equals(config.movement.characteristic)) {
            if (config.moves(value)) {
                auto.moved(now());
                if (autoRide != null) autoRide.bikeMoved(now(), config.pedalled(value));
            }
        } else if (characteristic.equals(config.lock.characteristic) && value.length > 0) {
            bikeLock(value[0] != 0);
        }
    }

    @Override
    public void onRead(String address, UUID service, UUID characteristic, byte[] value) {
        if (config == null || !address.equals(config.address)) return;
        if (characteristic.equals(config.lock.characteristic) && value.length > 0) bikeLock(value[0] != 0);
    }

    @Override
    public void onDisconnected(String address) {
        BikeLink.Listener current = listener;
        if (current != null) current.onDisconnected(address);
        authenticated = null;
        bikeLocked = null;
        rssiPending = false;
        if (authenticating) {
            authenticating = false;
            link.removeCallbacks(authTimeout);
        }
        if (auto != null && config != null && address.equals(config.address)) auto.linkDown(now());
    }

    @Override
    public void onScanResult(String address, String name, int rssi) {
        BikeLink.Listener current = listener;
        if (current != null) current.onScanResult(address, name, rssi);
        if (auto != null && config != null && address.equals(config.address)) auto.heard(rssi, now());
    }
}
