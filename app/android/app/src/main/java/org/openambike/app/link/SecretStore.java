package org.openambike.app.link;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyStore;
import java.util.Arrays;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * One text kept in a file of the app's own, outside backups, encrypted with AES-GCM under a key of the Android
 * Keystore, which never leaves it: what auto-connect needs after the phone restarts, the owner key among it.
 */
final class SecretStore {
    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final int IV_LENGTH = 12;
    private static final int TAG_BITS = 128;

    private final File file;
    private final String alias;

    SecretStore(Context context, String name) {
        file = new File(context.getNoBackupFilesDir(), name);
        alias = "openambike-" + name;
    }

    void save(String text) throws GeneralSecurityException, IOException {
        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        cipher.init(Cipher.ENCRYPT_MODE, key());
        byte[] sealed = cipher.doFinal(text.getBytes(StandardCharsets.UTF_8));
        byte[] iv = cipher.getIV();
        try (FileOutputStream out = new FileOutputStream(file)) {
            out.write(iv);
            out.write(sealed);
        }
    }

    /** The text kept, or null if there is none or it cannot be read. */
    String load() {
        if (!file.exists()) return null;
        try {
            byte[] bytes = readAll(file);
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(
                Cipher.DECRYPT_MODE,
                key(),
                new GCMParameterSpec(TAG_BITS, Arrays.copyOfRange(bytes, 0, IV_LENGTH))
            );
            return new String(cipher.doFinal(bytes, IV_LENGTH, bytes.length - IV_LENGTH), StandardCharsets.UTF_8);
        } catch (GeneralSecurityException | IOException | RuntimeException error) {
            return null;
        }
    }

    private static byte[] readAll(File file) throws IOException {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (FileInputStream in = new FileInputStream(file)) {
            byte[] buffer = new byte[4096];
            for (int read; (read = in.read(buffer)) > 0; ) bytes.write(buffer, 0, read);
        }
        return bytes.toByteArray();
    }

    void delete() {
        //noinspection ResultOfMethodCallIgnored
        file.delete();
    }

    private SecretKey key() throws GeneralSecurityException, IOException {
        KeyStore store = KeyStore.getInstance(KEYSTORE);
        store.load(null);
        if (store.containsAlias(alias)) return (SecretKey) store.getKey(alias, null);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
        generator.init(
            new KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        );
        return generator.generateKey();
    }
}
