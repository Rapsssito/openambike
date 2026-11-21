package org.openambike.app.link;

import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.BluetoothStatusCodes;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanFilter;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import androidx.core.content.ContextCompat;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.UUID;

/**
 * The Bluetooth link to one bike: scanning, bonding, connecting, and one GATT operation at a time. It knows nothing of
 * the bike's protocol: it moves the bytes it is given, and hands over what the bike notifies. Everything runs on its
 * own thread, so its state needs no locks; callers get their answers on that thread.
 */
@SuppressLint("MissingPermission")
final class BikeLink {
    /** What the link reports without being asked. */
    interface Listener {
        void onNotification(String address, UUID service, UUID characteristic, byte[] value);

        /** After every disconnection, asked for or not, as the Bluetooth plugin it replaces reports them. */
        void onDisconnected(String address);

        void onScanResult(String address, String name, int rssi);

        /** A value read, whoever asked for it. */
        void onRead(String address, UUID service, UUID characteristic, byte[] value);
    }

    /** The answer to a request: the value read, if any, or an error message. */
    interface Callback {
        void done(byte[] value, String error);
    }

    static final UUID CLIENT_CHARACTERISTIC_CONFIG = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");
    static final long CONNECT_TIMEOUT_MS = 10000;
    static final long OPERATION_TIMEOUT_MS = 5000;
    /** Bonding waits for the rider to type the code the bike shows. */
    static final long BOND_TIMEOUT_MS = 60000;
    /** The largest MTU asked for; the bike's IoT state comes in notifications of up to 50 bytes. */
    private static final int REQUEST_MTU = 512;

    private enum Kind {
        READ,
        WRITE,
        DESCRIPTOR,
        RSSI,
    }

    private static final class Operation {
        final Kind kind;
        final UUID service;
        final UUID characteristic;
        final byte[] value;
        final boolean enable;
        final Callback callback;

        Operation(Kind kind, UUID service, UUID characteristic, byte[] value, boolean enable, Callback callback) {
            this.kind = kind;
            this.service = service;
            this.characteristic = characteristic;
            this.value = value;
            this.enable = enable;
            this.callback = callback;
        }
    }

    private final Context context;
    private final BluetoothAdapter adapter;
    private final Listener listener;
    private final HandlerThread thread = new HandlerThread("bike-link");
    private final Handler handler;

    private BluetoothGatt gatt;
    private String address;
    private boolean ready;
    /** Every caller waiting for the connection under way; empty when none is. */
    private final List<Callback> connecting = new ArrayList<>();
    private Callback disconnecting;
    private final ArrayDeque<Operation> queue = new ArrayDeque<>();
    private Operation current;
    private final Runnable connectTimeout = this::onConnectTimeout;
    private final Runnable operationTimeout = () -> finish(current, null, "Operation timeout.");
    private final Runnable disconnectTimeout = this::onDisconnectTimeout;
    private ScanCallback scan;

    BikeLink(Context context, BluetoothAdapter adapter, Listener listener) {
        this.context = context.getApplicationContext();
        this.adapter = adapter;
        this.listener = listener;
        thread.start();
        handler = new Handler(thread.getLooper());
    }

    /** The link's thread, for what must run on it, such as GPS updates during a ride. */
    android.os.Looper looper() {
        return thread.getLooper();
    }

    /** Runs {@code action} on the link's thread. */
    void post(Runnable action) {
        handler.post(action);
    }

    void postDelayed(Runnable action, long delayMs) {
        handler.postDelayed(action, delayMs);
    }

    void removeCallbacks(Runnable action) {
        handler.removeCallbacks(action);
    }

    /** Whether the link is connected, with its services discovered, to this address. */
    boolean isReady(String address) {
        return ready && address.equals(this.address);
    }

    /** Ends the connection and the scan, and stops the link's thread. */
    void close() {
        handler.post(() -> {
            stopScanNow();
            if (gatt != null) gatt.close();
            gatt = null;
            ready = false;
            failAll("Disconnected.");
            thread.quitSafely();
        });
    }

    // Scanning.

    /**
     * Reports every advertisement whose name starts with {@code namePrefix}, until {@link #stopScan}.
     *
     * @param scanMode one of {@link ScanSettings}' scan modes
     * @param address only this device, filtered by the Bluetooth chip, which Android requires for a scan that goes on
     *     with the screen off; or null for any
     */
    void startScan(String namePrefix, int scanMode, String address, Callback callback) {
        handler.post(() -> {
            if (!adapter.isEnabled()) {
                callback.done(null, "Bluetooth is not enabled.");
                return;
            }
            BluetoothLeScanner scanner = adapter.getBluetoothLeScanner();
            if (scanner == null) {
                callback.done(null, "Bluetooth is not enabled.");
                return;
            }
            stopScanNow();
            scan = new ScanCallback() {
                @Override
                public void onScanResult(int callbackType, ScanResult result) {
                    String name = result.getScanRecord() != null ? result.getScanRecord().getDeviceName() : null;
                    if (name == null) name = result.getDevice().getName();
                    // Filtered by address, the bike may come with no name: its name is only in its scan response.
                    if (address == null && (name == null || !name.startsWith(namePrefix))) return;
                    if (name == null) name = namePrefix;
                    String found = name;
                    handler.post(() -> listener.onScanResult(result.getDevice().getAddress(), found, result.getRssi()));
                }

                @Override
                public void onScanFailed(int errorCode) {
                    handler.post(() -> scan = null);
                }
            };
            ScanSettings settings = new ScanSettings.Builder().setScanMode(scanMode).build();
            List<ScanFilter> filters = address == null
                ? null
                : Collections.singletonList(new ScanFilter.Builder().setDeviceAddress(address).build());
            scanner.startScan(filters, settings, scan);
            callback.done(null, null);
        });
    }

    void stopScan(Callback callback) {
        handler.post(() -> {
            stopScanNow();
            callback.done(null, null);
        });
    }

    private void stopScanNow() {
        if (scan == null) return;
        BluetoothLeScanner scanner = adapter.getBluetoothLeScanner();
        if (scanner != null && adapter.isEnabled()) scanner.stopScan(scan);
        scan = null;
    }

    // Bonding.

    boolean isBonded(String address) {
        return adapter.getRemoteDevice(address).getBondState() == BluetoothDevice.BOND_BONDED;
    }

    /** Bonds with the device: the system asks the rider for the code the bike shows. */
    void createBond(String address, Callback callback) {
        handler.post(() -> {
            BluetoothDevice device = adapter.getRemoteDevice(address);
            if (device.getBondState() == BluetoothDevice.BOND_BONDED) {
                callback.done(null, null);
                return;
            }
            Callback[] pending = { callback };
            BroadcastReceiver receiver = new BroadcastReceiver() {
                @Override
                public void onReceive(Context context, Intent intent) {
                    BluetoothDevice changed = intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
                    if (changed == null || !address.equals(changed.getAddress())) return;
                    int state = intent.getIntExtra(BluetoothDevice.EXTRA_BOND_STATE, BluetoothDevice.ERROR);
                    if (state == BluetoothDevice.BOND_BONDED) settle(this, pending, null);
                    else if (state == BluetoothDevice.BOND_NONE) settle(this, pending, "Creating bond failed.");
                }
            };
            ContextCompat.registerReceiver(
                context,
                receiver,
                new IntentFilter(BluetoothDevice.ACTION_BOND_STATE_CHANGED),
                null,
                handler,
                ContextCompat.RECEIVER_EXPORTED
            );
            handler.postDelayed(() -> settle(receiver, pending, "Bonding timeout."), BOND_TIMEOUT_MS);
            if (!device.createBond()) settle(receiver, pending, "Creating bond failed.");
        });
    }

    private void settle(BroadcastReceiver receiver, Callback[] pending, String error) {
        if (pending[0] == null) return;
        Callback callback = pending[0];
        pending[0] = null;
        try {
            context.unregisterReceiver(receiver);
        } catch (IllegalArgumentException alreadyUnregistered) {
            // Nothing to do.
        }
        callback.done(null, error);
    }

    // Connection.

    /** Connects, discovers the services and asks for a larger MTU; the callback runs once all are done. */
    void connect(String address, Callback callback) {
        handler.post(() -> {
            if (ready && address.equals(this.address)) {
                callback.done(null, null);
                return;
            }
            // A connection to the same bike already under way: wait for it rather than start another.
            if (!connecting.isEmpty() && address.equals(this.address)) {
                connecting.add(callback);
                return;
            }
            if (!adapter.isEnabled()) {
                callback.done(null, "Bluetooth is not enabled.");
                return;
            }
            if (gatt != null) gatt.close();
            failAll("Disconnected.");
            settleConnecting("Disconnected.");
            ready = false;
            this.address = address;
            connecting.add(callback);
            BluetoothDevice device = adapter.getRemoteDevice(address);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                gatt = device.connectGatt(
                    context,
                    false,
                    gattCallback,
                    BluetoothDevice.TRANSPORT_LE,
                    BluetoothDevice.PHY_LE_1M_MASK,
                    handler
                );
            } else {
                gatt = device.connectGatt(context, false, gattCallback, BluetoothDevice.TRANSPORT_LE);
            }
            handler.postDelayed(connectTimeout, CONNECT_TIMEOUT_MS);
        });
    }

    void disconnect(String address, Callback callback) {
        handler.post(() -> {
            if (gatt == null || !address.equals(this.address)) {
                callback.done(null, null);
                return;
            }
            disconnecting = callback;
            gatt.disconnect();
            handler.postDelayed(disconnectTimeout, OPERATION_TIMEOUT_MS);
        });
    }

    private void onConnectTimeout() {
        if (connecting.isEmpty()) return;
        if (gatt != null) {
            gatt.disconnect();
            gatt.close();
        }
        gatt = null;
        settleConnecting("Connection timeout.");
    }

    /** Answers everyone waiting for the connection under way. */
    private void settleConnecting(String error) {
        List<Callback> callbacks = new ArrayList<>(connecting);
        connecting.clear();
        for (Callback callback : callbacks) callback.done(null, error);
    }

    private void onDisconnectTimeout() {
        if (disconnecting == null) return;
        String gone = address;
        if (gatt != null) gatt.close();
        gatt = null;
        ready = false;
        failAll("Disconnected.");
        Callback callback = disconnecting;
        disconnecting = null;
        callback.done(null, null);
        listener.onDisconnected(gone);
    }

    private void connected() {
        handler.removeCallbacks(connectTimeout);
        ready = true;
        settleConnecting(null);
    }

    private void disconnected(int status) {
        String gone = address;
        handler.removeCallbacks(connectTimeout);
        handler.removeCallbacks(disconnectTimeout);
        if (gatt != null) gatt.close();
        gatt = null;
        ready = false;
        failAll("Disconnected.");
        if (!connecting.isEmpty()) settleConnecting("Connection failed with status " + status + ".");
        if (disconnecting != null) {
            Callback callback = disconnecting;
            disconnecting = null;
            callback.done(null, null);
        }
        listener.onDisconnected(gone);
    }

    // Operations, one at a time.

    void read(String address, UUID service, UUID characteristic, Callback callback) {
        enqueue(address, new Operation(Kind.READ, service, characteristic, null, false, callback));
    }

    /** Writes with response, as the bike's characteristics expect. */
    void write(String address, UUID service, UUID characteristic, byte[] value, Callback callback) {
        enqueue(address, new Operation(Kind.WRITE, service, characteristic, value, false, callback));
    }

    /** Reads the connection's signal strength; the callback gets it as one signed byte, in dBm. */
    void readRssi(String address, Callback callback) {
        enqueue(address, new Operation(Kind.RSSI, null, null, null, false, callback));
    }

    /** Turns notifications on or off; indications where the characteristic has no notifications. */
    void setNotifications(String address, UUID service, UUID characteristic, boolean enable, Callback callback) {
        enqueue(address, new Operation(Kind.DESCRIPTOR, service, characteristic, null, enable, callback));
    }

    private void enqueue(String address, Operation operation) {
        handler.post(() -> {
            if (!ready || !address.equals(this.address)) {
                operation.callback.done(null, "Not connected.");
                return;
            }
            queue.add(operation);
            next();
        });
    }

    private void next() {
        while (current == null && !queue.isEmpty()) {
            Operation operation = queue.poll();
            String error = start(operation);
            if (error == null) {
                current = operation;
                handler.postDelayed(operationTimeout, OPERATION_TIMEOUT_MS);
            } else {
                operation.callback.done(null, error);
            }
        }
    }

    /** Starts an operation; returns an error message, or null once the bike has been asked. */
    @SuppressWarnings("deprecation")
    private String start(Operation operation) {
        if (operation.kind == Kind.RSSI) return gatt.readRemoteRssi() ? null : "Reading RSSI failed.";
        BluetoothGattService service = gatt.getService(operation.service);
        BluetoothGattCharacteristic characteristic =
            service != null ? service.getCharacteristic(operation.characteristic) : null;
        if (characteristic == null) return "Characteristic not found.";
        switch (operation.kind) {
            case READ:
                return gatt.readCharacteristic(characteristic) ? null : "Reading characteristic failed.";
            case WRITE:
                int type = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    int status = gatt.writeCharacteristic(characteristic, operation.value, type);
                    return status == BluetoothStatusCodes.SUCCESS ? null : "Writing characteristic failed.";
                }
                characteristic.setWriteType(type);
                characteristic.setValue(operation.value);
                return gatt.writeCharacteristic(characteristic) ? null : "Writing characteristic failed.";
            default:
                if (!gatt.setCharacteristicNotification(characteristic, operation.enable)) {
                    return "Setting notification failed.";
                }
                BluetoothGattDescriptor descriptor = characteristic.getDescriptor(CLIENT_CHARACTERISTIC_CONFIG);
                if (descriptor == null) return "Setting notification failed.";
                byte[] value;
                if (!operation.enable) value = BluetoothGattDescriptor.DISABLE_NOTIFICATION_VALUE;
                else if ((characteristic.getProperties() & BluetoothGattCharacteristic.PROPERTY_NOTIFY) != 0) {
                    value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE;
                } else value = BluetoothGattDescriptor.ENABLE_INDICATION_VALUE;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    int status = gatt.writeDescriptor(descriptor, value);
                    return status == BluetoothStatusCodes.SUCCESS ? null : "Setting notification failed.";
                }
                descriptor.setValue(value);
                return gatt.writeDescriptor(descriptor) ? null : "Setting notification failed.";
        }
    }

    /** Ends the current operation if {@code operation} is it, and starts the next. */
    private void finish(Operation operation, byte[] value, String error) {
        if (operation == null || operation != current) return;
        handler.removeCallbacks(operationTimeout);
        current = null;
        operation.callback.done(value, error);
        next();
    }

    /** The current operation, if it is of this kind on this characteristic. */
    private Operation currentFor(Kind kind, UUID characteristic) {
        if (current == null || current.kind != kind) return null;
        if (kind == Kind.RSSI || current.characteristic.equals(characteristic)) return current;
        return null;
    }

    private void failAll(String error) {
        handler.removeCallbacks(operationTimeout);
        Operation operation = current;
        current = null;
        if (operation != null) operation.callback.done(null, error);
        while (!queue.isEmpty()) queue.poll().callback.done(null, error);
    }

    // GATT callbacks, moved onto the link's thread: before Android 8 they come on binder threads.

    private final BluetoothGattCallback gattCallback = new BluetoothGattCallback() {
        @Override
        public void onConnectionStateChange(BluetoothGatt changed, int status, int state) {
            handler.post(() -> {
                if (changed != gatt) return;
                if (state == BluetoothProfile.STATE_CONNECTED) {
                    if (!gatt.discoverServices()) disconnected(status);
                } else if (state == BluetoothProfile.STATE_DISCONNECTED) {
                    disconnected(status);
                }
            });
        }

        @Override
        public void onServicesDiscovered(BluetoothGatt changed, int status) {
            handler.post(() -> {
                if (changed != gatt) return;
                if (status != BluetoothGatt.GATT_SUCCESS) {
                    gatt.disconnect();
                    return;
                }
                // The largest MTU both support is chosen; without it, the connection goes on with the default one.
                if (!gatt.requestMtu(REQUEST_MTU)) connected();
            });
        }

        @Override
        public void onMtuChanged(BluetoothGatt changed, int mtu, int status) {
            handler.post(() -> {
                if (changed == gatt && !ready) connected();
            });
        }

        @Override
        @SuppressWarnings("deprecation")
        public void onCharacteristicRead(BluetoothGatt changed, BluetoothGattCharacteristic characteristic, int status) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) return;
            byte[] value = characteristic.getValue();
            read(characteristic, value != null ? value.clone() : new byte[0], status);
        }

        @Override
        public void onCharacteristicRead(
            BluetoothGatt changed,
            BluetoothGattCharacteristic characteristic,
            byte[] value,
            int status
        ) {
            read(characteristic, value, status);
        }

        private void read(BluetoothGattCharacteristic characteristic, byte[] value, int status) {
            UUID service = characteristic.getService().getUuid();
            UUID uuid = characteristic.getUuid();
            handler.post(() -> {
                boolean ok = status == BluetoothGatt.GATT_SUCCESS;
                if (ok && address != null) listener.onRead(address, service, uuid, value);
                finish(currentFor(Kind.READ, uuid), ok ? value : null, ok ? null : "Reading characteristic failed.");
            });
        }

        @Override
        public void onReadRemoteRssi(BluetoothGatt changed, int rssi, int status) {
            handler.post(() -> {
                boolean ok = status == BluetoothGatt.GATT_SUCCESS;
                finish(currentFor(Kind.RSSI, null), ok ? new byte[] { (byte) rssi } : null, ok ? null : "Reading RSSI failed.");
            });
        }

        @Override
        public void onCharacteristicWrite(BluetoothGatt changed, BluetoothGattCharacteristic characteristic, int status) {
            UUID uuid = characteristic.getUuid();
            handler.post(() -> {
                boolean ok = status == BluetoothGatt.GATT_SUCCESS;
                finish(currentFor(Kind.WRITE, uuid), null, ok ? null : "Writing characteristic failed.");
            });
        }

        @Override
        public void onDescriptorWrite(BluetoothGatt changed, BluetoothGattDescriptor descriptor, int status) {
            UUID uuid = descriptor.getCharacteristic().getUuid();
            handler.post(() -> {
                boolean ok = status == BluetoothGatt.GATT_SUCCESS;
                finish(currentFor(Kind.DESCRIPTOR, uuid), null, ok ? null : "Setting notification failed.");
            });
        }

        @Override
        @SuppressWarnings("deprecation")
        public void onCharacteristicChanged(BluetoothGatt changed, BluetoothGattCharacteristic characteristic) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) return;
            byte[] value = characteristic.getValue();
            notified(characteristic, value != null ? value.clone() : new byte[0]);
        }

        @Override
        public void onCharacteristicChanged(
            BluetoothGatt changed,
            BluetoothGattCharacteristic characteristic,
            byte[] value
        ) {
            notified(characteristic, value);
        }

        private void notified(BluetoothGattCharacteristic characteristic, byte[] value) {
            UUID service = characteristic.getService().getUuid();
            UUID uuid = characteristic.getUuid();
            handler.post(() -> {
                if (address != null) listener.onNotification(address, service, uuid, value);
            });
        }
    };
}
