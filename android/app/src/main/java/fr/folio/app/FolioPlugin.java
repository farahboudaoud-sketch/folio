package fr.folio.app;

import android.app.Activity;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Parcelable;
import android.provider.OpenableColumns;
import android.view.WindowManager;

import androidx.activity.result.ActivityResult;
import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKeys;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.List;
import java.util.Properties;

import javax.activation.DataHandler;
import javax.activation.FileDataSource;
import javax.mail.AuthenticationFailedException;
import javax.mail.Message;
import javax.mail.MessagingException;
import javax.mail.Multipart;
import javax.mail.PasswordAuthentication;
import javax.mail.Session;
import javax.mail.Transport;
import javax.mail.internet.InternetAddress;
import javax.mail.internet.MimeBodyPart;
import javax.mail.internet.MimeMessage;
import javax.mail.internet.MimeMultipart;
import javax.mail.internet.MimeUtility;

/**
 * Fonctions natives de Folio : import des EPUB (sélecteur de fichiers et « Ouvrir avec »),
 * envoi vers la Kindle par e-mail, mot de passe chiffré, luminosité, écran allumé,
 * boutons de volume, fichiers de sauvegarde et partage.
 */
@CapacitorPlugin(name = "Folio")
public class FolioPlugin extends Plugin {

    static volatile boolean volumeKeysEnabled = false;
    private static FolioPlugin instance;
    private SharedPreferences securePrefs;
    private String pendingSaveContent;

    @Override
    public void load() {
        instance = this;
        Intent intent = getActivity().getIntent();
        if (intent != null) handleIncoming(intent);
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        handleIncoming(intent);
    }

    static void onVolumeKey(String direction) {
        FolioPlugin p = instance;
        if (p == null) return;
        JSObject data = new JSObject();
        data.put("direction", direction);
        p.notifyListeners("volumeKey", data);
    }

    // ---------- Livres reçus via « Ouvrir avec » ou le partage ----------

    private void handleIncoming(Intent intent) {
        String action = intent.getAction();
        if (FolioWidget.ACTION_OPEN_BOOK.equals(action)) {
            String bookId = intent.getStringExtra("bookId");
            getActivity().setIntent(new Intent(Intent.ACTION_MAIN));
            if (bookId != null && !bookId.isEmpty()) {
                JSObject data = new JSObject();
                data.put("id", bookId);
                notifyListeners("openBook", data, true);
            }
            return;
        }
        Uri uri = null;
        if (Intent.ACTION_VIEW.equals(action)) {
            uri = intent.getData();
        } else if (Intent.ACTION_SEND.equals(action)) {
            Parcelable p = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (p instanceof Uri) uri = (Uri) p;
        }
        if (uri == null) return;
        // L'intention est traitée une seule fois, même si l'activité est recréée
        getActivity().setIntent(new Intent(Intent.ACTION_MAIN));
        final Uri source = uri;
        new Thread(() -> {
            JSObject data;
            try {
                data = copyBook(source);
            } catch (Exception e) {
                data = new JSObject();
                data.put("error", e.getMessage() == null ? "Fichier illisible" : e.getMessage());
            }
            notifyListeners("incomingBook", data, true);
        }).start();
    }

    // ---------- Choisir des livres dans le gestionnaire de fichiers ----------

    @PluginMethod
    public void pickBooks(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{
                "application/epub+zip", "application/octet-stream", "application/zip"});
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        startActivityForResult(call, intent, "pickBooksResult");
    }

    @ActivityCallback
    private void pickBooksResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            JSObject ret = new JSObject();
            ret.put("books", new JSArray());
            call.resolve(ret);
            return;
        }
        Intent data = result.getData();
        final List<Uri> uris = new ArrayList<>();
        ClipData clip = data.getClipData();
        if (clip != null) {
            for (int i = 0; i < clip.getItemCount(); i++) uris.add(clip.getItemAt(i).getUri());
        } else if (data.getData() != null) {
            uris.add(data.getData());
        }
        new Thread(() -> {
            JSArray books = new JSArray();
            for (Uri u : uris) {
                try {
                    books.put(copyBook(u));
                } catch (Exception e) {
                    JSObject err = new JSObject();
                    err.put("error", e.getMessage() == null ? "Fichier illisible" : e.getMessage());
                    err.put("name", displayName(u));
                    books.put(err);
                }
            }
            JSObject ret = new JSObject();
            ret.put("books", books);
            call.resolve(ret);
        }).start();
    }

    /** Copie le fichier dans le stockage de l'appli ; son empreinte SHA-256 sert d'identifiant. */
    private JSObject copyBook(Uri uri) throws Exception {
        Context ctx = getContext();
        File dir = new File(ctx.getFilesDir(), "books");
        if (!dir.exists() && !dir.mkdirs()) throw new Exception("Stockage indisponible");
        File tmp = new File(dir, "import-" + System.nanoTime() + ".tmp");
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        long size = 0;
        byte[] head = new byte[2];
        int headLen = 0;
        try (InputStream in = ctx.getContentResolver().openInputStream(uri);
             OutputStream out = new FileOutputStream(tmp)) {
            if (in == null) throw new Exception("Fichier introuvable");
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) > 0) {
                if (headLen < 2) {
                    for (int i = 0; i < n && headLen < 2; i++) head[headLen++] = buf[i];
                }
                md.update(buf, 0, n);
                out.write(buf, 0, n);
                size += n;
            }
        }
        if (headLen < 2 || head[0] != 'P' || head[1] != 'K') {
            //noinspection ResultOfMethodCallIgnored
            tmp.delete();
            throw new Exception("Ce fichier n'est pas un EPUB");
        }
        byte[] digest = md.digest();
        StringBuilder hex = new StringBuilder();
        for (int i = 0; i < 16; i++) hex.append(String.format("%02x", digest[i]));
        String id = hex.toString();
        File dest = new File(dir, id + ".epub");
        if (dest.exists()) {
            //noinspection ResultOfMethodCallIgnored
            tmp.delete();
        } else if (!tmp.renameTo(dest)) {
            throw new Exception("Impossible d'enregistrer le livre");
        }
        JSObject ret = new JSObject();
        ret.put("id", id);
        ret.put("path", dest.getAbsolutePath());
        ret.put("name", displayName(uri));
        ret.put("size", size);
        return ret;
    }

    private String displayName(Uri uri) {
        String name = null;
        try (Cursor c = getContext().getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst()) name = c.getString(0);
        } catch (Exception ignored) {
        }
        if (name == null) name = uri.getLastPathSegment();
        return name == null ? "livre.epub" : name;
    }

    @PluginMethod
    public void deleteBook(PluginCall call) {
        String path = call.getString("path", "");
        File f = new File(path);
        File books = new File(getContext().getFilesDir(), "books");
        if (f.getParentFile() != null && f.getParentFile().getAbsolutePath().equals(books.getAbsolutePath())) {
            //noinspection ResultOfMethodCallIgnored
            f.delete();
        }
        call.resolve();
    }

    // ---------- Envoi vers la Kindle ----------

    private synchronized SharedPreferences secure() throws Exception {
        if (securePrefs != null) return securePrefs;
        Context ctx = getContext();
        String alias = MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC);
        try {
            securePrefs = EncryptedSharedPreferences.create("folio_secure", alias, ctx,
                    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM);
        } catch (Exception e) {
            // Fichier illisible (clé perdue) : on repart de zéro
            ctx.getSharedPreferences("folio_secure", Context.MODE_PRIVATE).edit().clear().commit();
            securePrefs = EncryptedSharedPreferences.create("folio_secure", alias, ctx,
                    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM);
        }
        return securePrefs;
    }

    @PluginMethod
    public void setPassword(PluginCall call) {
        String value = call.getString("value", "");
        try {
            SharedPreferences.Editor ed = secure().edit();
            if (value == null || value.isEmpty()) ed.remove("smtpPassword");
            else ed.putString("smtpPassword", value.replace(" ", ""));
            ed.apply();
            call.resolve();
        } catch (Exception e) {
            call.reject("Impossible d'enregistrer le mot de passe", "storage");
        }
    }

    @PluginMethod
    public void hasPassword(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            ret.put("value", secure().contains("smtpPassword"));
        } catch (Exception e) {
            ret.put("value", false);
        }
        call.resolve(ret);
    }

    private Session mailSession(String host, int port, final String user, final String password) {
        Properties props = new Properties();
        props.put("mail.smtp.auth", "true");
        props.put("mail.smtp.host", host);
        props.put("mail.smtp.port", String.valueOf(port));
        if (port == 465) {
            props.put("mail.smtp.ssl.enable", "true");
        } else {
            props.put("mail.smtp.starttls.enable", "true");
            props.put("mail.smtp.starttls.required", "true");
        }
        props.put("mail.smtp.ssl.checkserveridentity", "true");
        props.put("mail.smtp.connectiontimeout", "20000");
        props.put("mail.smtp.timeout", "120000");
        props.put("mail.smtp.writetimeout", "120000");
        return Session.getInstance(props, new javax.mail.Authenticator() {
            @Override
            protected PasswordAuthentication getPasswordAuthentication() {
                return new PasswordAuthentication(user, password);
            }
        });
    }

    private void rejectMail(PluginCall call, Exception e) {
        Throwable t = e;
        while (t != null) {
            if (t instanceof AuthenticationFailedException) {
                call.reject("Identifiants refusés : vérifie l'adresse d'envoi et le mot de passe d'application.", "auth");
                return;
            }
            if (t instanceof UnknownHostException) {
                call.reject("Pas de connexion internet (ou serveur introuvable).", "network");
                return;
            }
            t = t.getCause();
        }
        String msg = e.getMessage();
        call.reject(msg == null ? "L'envoi a échoué." : "L'envoi a échoué : " + msg, "send");
    }

    @PluginMethod
    public void testMail(PluginCall call) {
        final String from = call.getString("from", "");
        final String host = call.getString("host", "smtp.gmail.com");
        final int port = call.getInt("port", 587);
        new Thread(() -> {
            try {
                String pw = secure().getString("smtpPassword", null);
                if (pw == null) {
                    call.reject("Aucun mot de passe enregistré.", "nopassword");
                    return;
                }
                Session s = mailSession(host, port, from, pw);
                Transport tr = s.getTransport("smtp");
                tr.connect(host, port, from, pw);
                tr.close();
                call.resolve();
            } catch (Exception e) {
                rejectMail(call, e);
            }
        }).start();
    }

    @PluginMethod
    public void sendToKindle(PluginCall call) {
        final String path = call.getString("path", "");
        final String to = call.getString("to", "");
        final String from = call.getString("from", "");
        final String host = call.getString("host", "smtp.gmail.com");
        final int port = call.getInt("port", 587);
        final String title = call.getString("title", "Livre");
        final String filename = call.getString("filename", "livre.epub");
        new Thread(() -> {
            try {
                String pw = secure().getString("smtpPassword", null);
                if (pw == null) {
                    call.reject("Aucun mot de passe enregistré.", "nopassword");
                    return;
                }
                File file = new File(path);
                if (!file.exists()) {
                    call.reject("Le fichier du livre est introuvable.", "file");
                    return;
                }
                Session s = mailSession(host, port, from, pw);
                MimeMessage msg = new MimeMessage(s);
                msg.setFrom(new InternetAddress(from));
                msg.setRecipients(Message.RecipientType.TO, InternetAddress.parse(to));
                msg.setSubject(title, "UTF-8");
                MimeBodyPart text = new MimeBodyPart();
                text.setText("Envoyé depuis Folio.", "UTF-8");
                MimeBodyPart att = new MimeBodyPart();
                att.setDataHandler(new DataHandler(new FileDataSource(file)));
                att.setFileName(MimeUtility.encodeText(filename, "UTF-8", null));
                att.setHeader("Content-Type", "application/epub+zip");
                Multipart mp = new MimeMultipart();
                mp.addBodyPart(text);
                mp.addBodyPart(att);
                msg.setContent(mp);
                Transport.send(msg);
                call.resolve();
            } catch (MessagingException e) {
                rejectMail(call, e);
            } catch (Exception e) {
                rejectMail(call, e);
            }
        }).start();
    }

    // ---------- Écran ----------

    @PluginMethod
    public void keepAwake(PluginCall call) {
        final boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        getActivity().runOnUiThread(() -> {
            if (on) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            call.resolve();
        });
    }

    // Luminosité : Folio règle la luminosité du téléphone lui-même (permission « Modifier les paramètres
    // système »), sans bloquer le curseur du volet de notifications.
    private boolean canWriteSettings() {
        return Build.VERSION.SDK_INT < 23 || android.provider.Settings.System.canWrite(getContext());
    }

    private void clearWindowOverride() {
        getActivity().runOnUiThread(() -> {
            WindowManager.LayoutParams lp = getActivity().getWindow().getAttributes();
            if (lp.screenBrightness != WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE) {
                lp.screenBrightness = WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE;
                getActivity().getWindow().setAttributes(lp);
            }
        });
    }

    @PluginMethod
    public void getBrightness(PluginCall call) {
        JSObject ret = new JSObject();
        android.content.ContentResolver cr = getContext().getContentResolver();
        int value = 128;
        boolean auto = false;
        try { value = android.provider.Settings.System.getInt(cr, android.provider.Settings.System.SCREEN_BRIGHTNESS); } catch (Exception ignored) { }
        try { auto = android.provider.Settings.System.getInt(cr, android.provider.Settings.System.SCREEN_BRIGHTNESS_MODE) == android.provider.Settings.System.SCREEN_BRIGHTNESS_MODE_AUTOMATIC; } catch (Exception ignored) { }
        ret.put("value", Math.max(0.0, Math.min(1.0, value / 255.0)));
        ret.put("auto", auto);
        ret.put("allowed", canWriteSettings());
        call.resolve(ret);
    }

    @PluginMethod
    public void setBrightness(PluginCall call) {
        final double value = call.getDouble("value", -1.0);
        clearWindowOverride();
        JSObject ret = new JSObject();
        if (value < 0) { ret.put("ok", true); call.resolve(ret); return; }
        if (!canWriteSettings()) { ret.put("ok", false); call.resolve(ret); return; }
        try {
            android.content.ContentResolver cr = getContext().getContentResolver();
            android.provider.Settings.System.putInt(cr, android.provider.Settings.System.SCREEN_BRIGHTNESS_MODE, android.provider.Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL);
            int v = (int) Math.round(Math.max(0.01, Math.min(1.0, value)) * 255);
            android.provider.Settings.System.putInt(cr, android.provider.Settings.System.SCREEN_BRIGHTNESS, Math.max(1, v));
            ret.put("ok", true);
        } catch (Exception e) {
            ret.put("ok", false);
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void setAutoBrightness(PluginCall call) {
        final boolean on = Boolean.TRUE.equals(call.getBoolean("on", true));
        clearWindowOverride();
        JSObject ret = new JSObject();
        if (!canWriteSettings()) { ret.put("ok", false); call.resolve(ret); return; }
        try {
            android.provider.Settings.System.putInt(getContext().getContentResolver(), android.provider.Settings.System.SCREEN_BRIGHTNESS_MODE,
                    on ? android.provider.Settings.System.SCREEN_BRIGHTNESS_MODE_AUTOMATIC : android.provider.Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL);
            ret.put("ok", true);
        } catch (Exception e) {
            ret.put("ok", false);
        }
        call.resolve(ret);
    }

    /** Ouvre l'écran Android « Modifier les paramètres système » pour Folio. */
    @PluginMethod
    public void openBrightnessPermission(PluginCall call) {
        try {
            Intent i = new Intent(android.provider.Settings.ACTION_MANAGE_WRITE_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
        } catch (Exception e) {
            Intent i = new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
        }
        call.resolve();
    }

    @PluginMethod
    public void setVolumeKeys(PluginCall call) {
        volumeKeysEnabled = Boolean.TRUE.equals(call.getBoolean("on", false));
        call.resolve();
    }

    // ---------- Sauvegarde, import, partage ----------

    @PluginMethod
    public void saveTextFile(PluginCall call) {
        pendingSaveContent = call.getString("content", "");
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(call.getString("mime", "text/plain"));
        intent.putExtra(Intent.EXTRA_TITLE, call.getString("filename", "folio.txt"));
        startActivityForResult(call, intent, "saveTextFileResult");
    }

    @ActivityCallback
    private void saveTextFileResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject ret = new JSObject();
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            ret.put("saved", false);
            call.resolve(ret);
            return;
        }
        final Uri uri = result.getData().getData();
        final String content = pendingSaveContent == null ? "" : pendingSaveContent;
        pendingSaveContent = null;
        new Thread(() -> {
            try (OutputStream out = getContext().getContentResolver().openOutputStream(uri, "wt")) {
                if (out == null) throw new Exception("Fichier inaccessible");
                out.write(content.getBytes(StandardCharsets.UTF_8));
                ret.put("saved", true);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Impossible d'enregistrer le fichier.", "write");
            }
        }).start();
    }

    @PluginMethod
    public void openTextFile(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        startActivityForResult(call, intent, "openTextFileResult");
    }

    @ActivityCallback
    private void openTextFileResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            JSObject ret = new JSObject();
            ret.put("content", null);
            call.resolve(ret);
            return;
        }
        final Uri uri = result.getData().getData();
        new Thread(() -> {
            try (InputStream in = getContext().getContentResolver().openInputStream(uri)) {
                if (in == null) throw new Exception("Fichier inaccessible");
                BufferedReader r = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8));
                StringBuilder sb = new StringBuilder();
                char[] buf = new char[8192];
                int n;
                while ((n = r.read(buf)) > 0) sb.append(buf, 0, n);
                JSObject ret = new JSObject();
                ret.put("content", sb.toString());
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Impossible de lire le fichier.", "read");
            }
        }).start();
    }

    @PluginMethod
    public void shareText(PluginCall call) {
        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType("text/plain");
        send.putExtra(Intent.EXTRA_TEXT, call.getString("text", ""));
        Intent chooser = Intent.createChooser(send, "Partager");
        chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(chooser);
        call.resolve();
    }


    // ---------- Widget de l'écran d'accueil ----------

    @PluginMethod
    public void updateWidget(PluginCall call) {
        final String bookId = call.getString("id", "");
        final String title = call.getString("title", "");
        final int pct = call.getInt("pct", 0);
        final String today = call.getString("today", "");
        final String cover = call.getString("cover", null);
        new Thread(() -> {
            Context ctx = getContext();
            SharedPreferences.Editor ed = ctx.getSharedPreferences(FolioWidget.PREFS, Context.MODE_PRIVATE).edit();
            ed.putString("bookId", bookId).putString("title", title).putInt("pct", pct).putString("today", today);
            if (cover != null) {
                try {
                    String b64 = cover.substring(cover.indexOf(',') + 1);
                    byte[] bytes = android.util.Base64.decode(b64, android.util.Base64.DEFAULT);
                    try (FileOutputStream out = new FileOutputStream(FolioWidget.coverFile(ctx))) { out.write(bytes); }
                    ed.putString("coverId", bookId);
                } catch (Exception e) {
                    ed.putString("coverId", "");
                }
            } else if (call.getBoolean("noCover", false)) {
                ed.putString("coverId", "");
            }
            ed.apply();
            FolioWidget.refreshAll(ctx);
            call.resolve();
        }).start();
    }

    @PluginMethod
    public void sdkInfo(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("sdk", Build.VERSION.SDK_INT);
        call.resolve(ret);
    }
}
