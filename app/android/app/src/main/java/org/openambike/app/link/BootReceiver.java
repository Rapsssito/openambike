package org.openambike.app.link;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import androidx.core.content.ContextCompat;

/** After the phone restarts, starts auto-connect again if it was on and its settings are of this version. */
public final class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) return;
        String saved = new SecretStore(context, "auto-connect").load();
        if (saved == null) return;
        try {
            new AutoConnectConfig(saved);
        } catch (org.json.JSONException | IllegalArgumentException olderVersion) {
            // Saved by an earlier version: auto-connect waits for the app to send it again.
            return;
        }
        ContextCompat.startForegroundService(context, new Intent(context, BikeLinkService.class));
    }
}
