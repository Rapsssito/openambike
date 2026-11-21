package org.openambike.app.link;

import android.Manifest;
import android.bluetooth.le.ScanSettings;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.content.pm.PackageManager;
import android.os.Build;
import android.net.Uri;
import android.os.IBinder;
import androidx.core.content.FileProvider;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * The app's bridge to {@link BikeLinkService}: the methods of the Bluetooth client that src/ble/native-client.js
 * offers to src/ble/bike.js, and the events it listens to. Bytes cross as hexadecimal text.
 */
@CapacitorPlugin(
    name = "BikeLink",
    permissions = {
        @Permission(alias = "bluetooth", strings = { Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT }),
        @Permission(
            alias = "location",
            strings = { Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION }
        ),
        @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }),
        @Permission(
            alias = "rideLocation",
            strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }
        ),
        @Permission(alias = "backgroundLocation", strings = { Manifest.permission.ACCESS_BACKGROUND_LOCATION }),
    }
)
public final class BikeLinkPlugin extends Plugin implements BikeLink.Listener {
    /** Set on the main thread when the service is bound; read on the thread that runs the plugin's calls. */
    private volatile BikeLinkService service;
    /** Whether the app's screen is showing; the plugin loads while it opens. */
    private volatile boolean onScreen = true;
    /** Calls that came before the service was bound, run once it is; guarded by itself. */
    private final List<Runnable> waiting = new ArrayList<>();

    private final ServiceConnection connection = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName name, IBinder binder) {
            BikeLinkService bound = ((BikeLinkService.LocalBinder) binder).service();
            bound.setListener(BikeLinkPlugin.this);
            bound.setAppOnScreen(onScreen);
            List<Runnable> calls;
            synchronized (waiting) {
                service = bound;
                calls = new ArrayList<>(waiting);
                waiting.clear();
            }
            for (Runnable call : calls) call.run();
        }

        @Override
        public void onServiceDisconnected(ComponentName name) {
            service = null;
        }
    };

    @Override
    public void load() {
        Context context = getContext();
        context.bindService(new Intent(context, BikeLinkService.class), connection, Context.BIND_AUTO_CREATE);
    }

    // The app's screen on or off: auto-connect stands aside while it is on.

    @Override
    protected void handleOnResume() {
        onScreen = true;
        BikeLinkService bound = service;
        if (bound != null) bound.setAppOnScreen(true);
    }

    @Override
    protected void handleOnPause() {
        onScreen = false;
        BikeLinkService bound = service;
        if (bound != null) bound.setAppOnScreen(false);
    }

    @Override
    protected void handleOnDestroy() {
        if (service != null) {
            service.setAppOnScreen(false);
            service.setListener(null);
        }
        getContext().unbindService(connection);
        service = null;
    }

    /** Runs {@code action} with the link once the service is bound, or rejects the call on a phone with no Bluetooth. */
    private void withLink(PluginCall call, LinkAction action) {
        Runnable run = () -> {
            BikeLink link = service != null ? service.link() : null;
            if (link == null) call.reject("BLE is not available.");
            else action.run(link);
        };
        synchronized (waiting) {
            if (service == null) {
                waiting.add(run);
                return;
            }
        }
        run.run();
    }

    private interface LinkAction {
        void run(BikeLink link);
    }

    /** Resolves or rejects the call with the link's answer; a value read is resolved as {@code { value }}. */
    private static BikeLink.Callback answer(PluginCall call) {
        return (value, error) -> {
            if (error != null) {
                call.reject(error);
            } else if (value != null) {
                JSObject result = new JSObject();
                result.put("value", Hex.encode(value));
                call.resolve(result);
            } else {
                call.resolve();
            }
        };
    }

    private static UUID uuid(PluginCall call, String key) {
        String value = call.getString(key);
        return value != null ? UUID.fromString(value) : null;
    }

    // Permissions: from Android 12, Bluetooth only, as the app never derives location from a scan; before, location.

    private String permissionAlias() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? "bluetooth" : "location";
    }

    @PluginMethod
    public void initialize(PluginCall call) {
        if (getPermissionState(permissionAlias()) == PermissionState.GRANTED) {
            ready(call);
        } else {
            requestPermissionForAlias(permissionAlias(), call, "permissionAnswered");
        }
    }

    @PermissionCallback
    private void permissionAnswered(PluginCall call) {
        if (getPermissionState(permissionAlias()) == PermissionState.GRANTED) ready(call);
        else call.reject("Permission denied.");
    }

    private void ready(PluginCall call) {
        if (!getContext().getPackageManager().hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE)) {
            call.reject("BLE is not supported.");
            return;
        }
        withLink(call, (link) -> call.resolve());
    }

    // Scanning.

    @PluginMethod
    public void requestLEScan(PluginCall call) {
        String namePrefix = call.getString("namePrefix", "");
        int scanMode = call.getInt("scanMode", ScanSettings.SCAN_MODE_BALANCED);
        if (scanMode != ScanSettings.SCAN_MODE_BALANCED && scanMode != ScanSettings.SCAN_MODE_LOW_LATENCY) {
            call.reject("Invalid scan mode.");
            return;
        }
        withLink(call, (link) -> link.startScan(namePrefix, scanMode, null, answer(call)));
    }

    @PluginMethod
    public void stopLEScan(PluginCall call) {
        withLink(call, (link) -> link.stopScan(answer(call)));
    }

    // Bonding and connection.

    @PluginMethod
    public void isBonded(PluginCall call) {
        String address = call.getString("deviceId");
        if (address == null) {
            call.reject("deviceId required.");
            return;
        }
        withLink(call, (link) -> {
            JSObject result = new JSObject();
            result.put("value", link.isBonded(address));
            call.resolve(result);
        });
    }

    @PluginMethod
    public void createBond(PluginCall call) {
        String address = call.getString("deviceId");
        if (address == null) {
            call.reject("deviceId required.");
            return;
        }
        withLink(call, (link) -> link.createBond(address, answer(call)));
    }

    @PluginMethod
    public void connect(PluginCall call) {
        String address = call.getString("deviceId");
        if (address == null) {
            call.reject("deviceId required.");
            return;
        }
        withLink(call, (link) -> {
            // In the background with auto-connect on, the app only joins the link auto-connect holds.
            if (!service.appMayConnect(address)) {
                call.reject("Not connected.");
                return;
            }
            service.appConnecting();
            link.connect(address, answer(call));
        });
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        String address = call.getString("deviceId");
        if (address == null) {
            call.reject("deviceId required.");
            return;
        }
        withLink(call, (link) -> link.disconnect(address, answer(call)));
    }

    @PluginMethod
    public void readRssi(PluginCall call) {
        String address = call.getString("deviceId");
        if (address == null) {
            call.reject("deviceId required.");
            return;
        }
        withLink(call, (link) -> link.readRssi(address, (value, error) -> {
            if (error != null) {
                call.reject(error);
                return;
            }
            JSObject result = new JSObject();
            result.put("value", (int) value[0]);
            call.resolve(result);
        }));
    }

    // Auto-connect: what src/auto-connect.js prepared, kept and run by the service.

    @PluginMethod
    public void getAutoConnect(PluginCall call) {
        withLink(call, (link) -> {
            JSObject result = new JSObject();
            String config = service.autoConnect();
            result.put("enabled", config != null);
            if (config != null) result.put("config", config);
            String restored = service.restoredAutoConnect();
            if (restored != null) result.put("restored", restored);
            call.resolve(result);
        });
    }

    /** Turns auto-connect on with {@code config}, asking first to show notifications, or off without it. */
    @PluginMethod
    public void setAutoConnect(PluginCall call) {
        String config = call.getString("config");
        if (config != null
            && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "notificationsAnswered");
            return;
        }
        applyAutoConnect(call, config);
    }

    @PermissionCallback
    private void notificationsAnswered(PluginCall call) {
        if (getPermissionState("notifications") == PermissionState.GRANTED) applyAutoConnect(call, call.getString("config"));
        else call.reject("Permission denied.");
    }

    private void applyAutoConnect(PluginCall call, String config) {
        withLink(call, (link) -> {
            try {
                service.setAutoConnect(config);
                call.resolve();
            } catch (Exception error) {
                call.reject("Auto-connect could not be turned on: " + error.getMessage());
            }
        });
    }

    @PluginMethod
    public void pauseAutoConnect(PluginCall call) {
        withLink(call, (link) -> {
            service.pauseAutoConnect();
            call.resolve();
        });
    }

    // The owner key's copy for Android's backup (app/DEVELOPMENT.md, "Stack"): the Keystore's key never leaves the
    // phone, so the copy is plain text, in shared preferences that only the backup rules let out, and only into a backup
    // encrypted end to end.

    private android.content.SharedPreferences keyBackup() {
        return getContext().getSharedPreferences("owner-key-backup", android.content.Context.MODE_PRIVATE);
    }

    /** The owner key's copy for the backup, as {@code { key }}, without it when there is none. */
    @PluginMethod
    public void getKeyBackup(PluginCall call) {
        JSObject result = new JSObject();
        String key = keyBackup().getString("key", null);
        if (key != null) result.put("key", key);
        call.resolve(result);
    }

    /** Keeps {@code key} as the owner key's copy for the backup, or removes the copy without it. */
    @PluginMethod
    public void setKeyBackup(PluginCall call) {
        String key = call.getString("key");
        android.content.SharedPreferences.Editor editor = keyBackup().edit();
        if (key != null) editor.putString("key", key);
        else editor.remove("key");
        if (editor.commit()) call.resolve();
        else call.reject("The key's copy for the backup could not be kept.");
    }

    // Rides: recorded by the service, read and decoded by src/rides/.

    /**
     * Asks for location "all the time", which auto-ride needs for the route of a ride it starts with the app closed:
     * location while using the app first, as Android requires, then "all the time", which Android 11 and later ask for
     * in the system's settings. Answers {@code { granted }}; refused, auto-ride records the bike's figures alone.
     */
    @PluginMethod
    public void requestBackgroundLocation(PluginCall call) {
        if (getPermissionState("rideLocation") != PermissionState.GRANTED) {
            requestPermissionForAlias("rideLocation", call, "foregroundLocationAnswered");
            return;
        }
        foregroundLocationAnswered(call);
    }

    @PermissionCallback
    private void foregroundLocationAnswered(PluginCall call) {
        if (getPermissionState("rideLocation") != PermissionState.GRANTED) {
            answerBackgroundLocation(call);
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
            && getPermissionState("backgroundLocation") != PermissionState.GRANTED) {
            requestPermissionForAlias("backgroundLocation", call, "answerBackgroundLocation");
        } else {
            answerBackgroundLocation(call);
        }
    }

    @PermissionCallback
    private void answerBackgroundLocation(PluginCall call) {
        JSObject result = new JSObject();
        result.put("granted", hasBackgroundLocation());
        call.resolve(result);
    }

    /** Whether location "all the time" is granted, asking nothing: answers {@code { granted }}. */
    @PluginMethod
    public void getBackgroundLocation(PluginCall call) {
        JSObject result = new JSObject();
        result.put("granted", hasBackgroundLocation());
        call.resolve(result);
    }

    private boolean hasBackgroundLocation() {
        boolean foreground = getPermissionState("rideLocation") == PermissionState.GRANTED;
        boolean background = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
            || getPermissionState("backgroundLocation") == PermissionState.GRANTED;
        return foreground && background;
    }

    /** Starts a ride with what src/rides/ prepared, asking first for the phone's location. */
    @PluginMethod
    public void startRide(PluginCall call) {
        if (getPermissionState("rideLocation") != PermissionState.GRANTED) {
            requestPermissionForAlias("rideLocation", call, "rideLocationAnswered");
            return;
        }
        startRideNow(call);
    }

    @PermissionCallback
    private void rideLocationAnswered(PluginCall call) {
        if (getPermissionState("rideLocation") == PermissionState.GRANTED) startRideNow(call);
        else call.reject("Permission denied.");
    }

    private void startRideNow(PluginCall call) {
        String config = call.getString("config");
        if (config == null) {
            call.reject("config required.");
            return;
        }
        withLink(call, (link) -> {
            try {
                JSObject result = new JSObject();
                result.put("id", service.startRide(config));
                call.resolve(result);
            } catch (Exception error) {
                call.reject("The ride could not start: " + error.getMessage());
            }
        });
    }

    @PluginMethod
    public void stopRide(PluginCall call) {
        withLink(call, (link) -> service.stopRide((id) -> {
            JSObject result = new JSObject();
            if (id != null) result.put("id", id);
            call.resolve(result);
        }));
    }

    @PluginMethod
    public void pauseRide(PluginCall call) {
        withLink(call, (link) -> {
            service.setRidePaused(call.getBoolean("paused", true));
            call.resolve();
        });
    }

    /** The ride being recorded, as {@code { active, id?, paused? }}. */
    @PluginMethod
    public void getRide(PluginCall call) {
        withLink(call, (link) -> {
            try {
                JSONObject ride = service.activeRide();
                JSObject result = ride != null ? JSObject.fromJSONObject(ride) : new JSObject();
                result.put("active", ride != null);
                call.resolve(result);
            } catch (Exception error) {
                call.reject(error.getMessage());
            }
        });
    }

    @PluginMethod
    public void listRides(PluginCall call) {
        withLink(call, (link) -> {
            try {
                JSObject result = new JSObject();
                result.put("rides", service.rides());
                call.resolve(result);
            } catch (Exception error) {
                call.reject(error.getMessage());
            }
        });
    }

    @PluginMethod
    public void readRide(PluginCall call) {
        Long id = call.getLong("id");
        long from = call.getLong("from", 0L);
        if (id == null) {
            call.reject("id required.");
            return;
        }
        withLink(call, (link) -> {
            try {
                call.resolve(JSObject.fromJSONObject(service.readRide(id, from)));
            } catch (Exception error) {
                call.reject("The ride could not be read: " + error.getMessage());
            }
        });
    }

    /** The rider locked or unlocked the bike in the app ({@code held}): a lock by hand holds against auto-unlock. */
    @PluginMethod
    public void setLockHeld(PluginCall call) {
        Boolean held = call.getBoolean("held");
        if (held == null) {
            call.reject("held required.");
            return;
        }
        withLink(call, (link) -> {
            service.setLockHeld(held);
            call.resolve();
        });
    }

    @PluginMethod
    public void saveRideSummary(PluginCall call) {
        Long id = call.getLong("id");
        String summary = call.getString("summary");
        if (id == null || summary == null) {
            call.reject("id and summary required.");
            return;
        }
        withLink(call, (link) -> {
            try {
                service.saveRideSummary(id, summary);
                call.resolve();
            } catch (Exception error) {
                call.reject(error.getMessage());
            }
        });
    }

    @PluginMethod
    public void deleteRide(PluginCall call) {
        Long id = call.getLong("id");
        if (id == null) {
            call.reject("id required.");
            return;
        }
        withLink(call, (link) -> {
            if (service.deleteRide(id)) call.resolve();
            else call.reject("The ride could not be deleted.");
        });
    }

    /** Offers a text as a file through Android's share menu, as an export: written to the app's cache first. */
    @PluginMethod
    public void shareFile(PluginCall call) {
        String name = call.getString("name");
        String text = call.getString("text");
        String type = call.getString("type", "application/octet-stream");
        String title = call.getString("title", "");
        if (name == null || text == null || name.contains("/")) {
            call.reject("name and text required.");
            return;
        }
        try {
            File dir = new File(getContext().getCacheDir(), "exports");
            //noinspection ResultOfMethodCallIgnored
            dir.mkdirs();
            File file = new File(dir, name);
            try (FileOutputStream out = new FileOutputStream(file)) {
                out.write(text.getBytes(StandardCharsets.UTF_8));
            }
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
            Intent send = new Intent(Intent.ACTION_SEND)
                .setType(type)
                .putExtra(Intent.EXTRA_STREAM, uri)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(Intent.createChooser(send, title));
            call.resolve();
        } catch (Exception error) {
            call.reject("The file could not be shared: " + error.getMessage());
        }
    }

    // Reads, writes and notifications.

    @PluginMethod
    public void read(PluginCall call) {
        String address = call.getString("deviceId");
        UUID service = uuid(call, "service");
        UUID characteristic = uuid(call, "characteristic");
        if (address == null || service == null || characteristic == null) {
            call.reject("deviceId, service and characteristic required.");
            return;
        }
        withLink(call, (link) -> link.read(address, service, characteristic, answer(call)));
    }

    @PluginMethod
    public void write(PluginCall call) {
        String address = call.getString("deviceId");
        UUID service = uuid(call, "service");
        UUID characteristic = uuid(call, "characteristic");
        String value = call.getString("value");
        if (address == null || service == null || characteristic == null || value == null) {
            call.reject("deviceId, service, characteristic and value required.");
            return;
        }
        byte[] bytes;
        try {
            bytes = Hex.decode(value);
        } catch (IllegalArgumentException error) {
            call.reject(error.getMessage());
            return;
        }
        withLink(call, (link) -> link.write(address, service, characteristic, bytes, answer(call)));
    }

    @PluginMethod
    public void startNotifications(PluginCall call) {
        setNotifications(call, true);
    }

    @PluginMethod
    public void stopNotifications(PluginCall call) {
        setNotifications(call, false);
    }

    private void setNotifications(PluginCall call, boolean enable) {
        String address = call.getString("deviceId");
        UUID service = uuid(call, "service");
        UUID characteristic = uuid(call, "characteristic");
        if (address == null || service == null || characteristic == null) {
            call.reject("deviceId, service and characteristic required.");
            return;
        }
        withLink(call, (link) -> link.setNotifications(address, service, characteristic, enable, answer(call)));
    }

    // Events.

    @Override
    public void onNotification(String address, UUID service, UUID characteristic, byte[] value) {
        JSObject event = new JSObject();
        event.put("deviceId", address);
        event.put("service", service.toString());
        event.put("characteristic", characteristic.toString());
        event.put("value", Hex.encode(value));
        notifyListeners("notification", event);
    }

    @Override
    public void onDisconnected(String address) {
        JSObject event = new JSObject();
        event.put("deviceId", address);
        notifyListeners("disconnected", event);
    }

    @Override
    public void onRead(String address, UUID service, UUID characteristic, byte[] value) {}

    @Override
    public void onScanResult(String address, String name, int rssi) {
        JSObject event = new JSObject();
        event.put("deviceId", address);
        event.put("name", name);
        event.put("rssi", rssi);
        notifyListeners("scanResult", event);
    }
}
