package org.openambike.app.link;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import androidx.core.content.ContextCompat;

/**
 * After the phone restarts, or the app is updated, which stops it, starts the service again: for auto-connect, if it was
 * on and its settings are of this version, and for a ride being recorded. Android allows a foreground service to start
 * from both.
 */
public final class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action) && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) return;
        boolean riding = context.getSharedPreferences("rides", Context.MODE_PRIVATE).getString("active", null) != null;
        if (!riding && !autoConnectOn(context)) return;
        ContextCompat.startForegroundService(context, new Intent(context, BikeLinkService.class));
    }

    private static boolean autoConnectOn(Context context) {
        String saved = new SecretStore(context, "auto-connect").load();
        if (saved == null) return false;
        try {
            new AutoConnectConfig(saved);
            return true;
        } catch (org.json.JSONException | IllegalArgumentException olderVersion) {
            // Saved by an earlier version: auto-connect waits for the app to send it again.
            return false;
        }
    }
}
