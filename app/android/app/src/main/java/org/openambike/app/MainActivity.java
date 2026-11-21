package org.openambike.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import org.openambike.app.link.BikeLinkPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // The app's own plugins are registered before the bridge starts.
        registerPlugin(BikeLinkPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
