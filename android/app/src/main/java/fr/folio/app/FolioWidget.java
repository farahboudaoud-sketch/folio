package fr.folio.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.view.View;
import android.widget.RemoteViews;

import java.io.File;

/** Widget 2×2 : le livre en cours (couverture, titre, progression) et le temps lu aujourd'hui. */
public class FolioWidget extends AppWidgetProvider {

    static final String PREFS = "folio_widget";
    static final String ACTION_OPEN_BOOK = "fr.folio.app.OPEN_BOOK";

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) manager.updateAppWidget(id, build(context, id));
    }

    @Override
    public void onDeleted(Context context, int[] ids) {
        SharedPreferences.Editor ed = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit();
        for (int id : ids) {
            ed.remove("w" + id + "_theme").remove("w" + id + "_semi").remove("w" + id + "_cover").remove("w" + id + "_today");
        }
        ed.apply();
    }

    // ---------- Réglages propres à chaque widget ----------
    static String theme(Context c, int id) { return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("w" + id + "_theme", "creme"); }
    static boolean semi(Context c, int id) { return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("w" + id + "_semi", false); }
    static boolean showCover(Context c, int id) { return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("w" + id + "_cover", true); }
    static boolean showToday(Context c, int id) { return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("w" + id + "_today", true); }

    static void saveSettings(Context c, int id, String theme, boolean semi, boolean cover, boolean today) {
        c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putString("w" + id + "_theme", theme).putBoolean("w" + id + "_semi", semi)
                .putBoolean("w" + id + "_cover", cover).putBoolean("w" + id + "_today", today).apply();
    }

    /** Redessine tous les widgets posés sur l'écran d'accueil. */
    static void refreshAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, FolioWidget.class));
        if (ids == null || ids.length == 0) return;
        for (int id : ids) manager.updateAppWidget(id, build(context, id));
    }

    static RemoteViews build(Context context, int widgetId) {
        return build(context, theme(context, widgetId), semi(context, widgetId), showCover(context, widgetId), showToday(context, widgetId));
    }

    static RemoteViews build(Context context, String theme, boolean semi, boolean withCover, boolean withToday) {
        SharedPreferences p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.folio_widget);
        String bookId = p.getString("bookId", "");
        String title = p.getString("title", "");
        int pct = p.getInt("pct", 0);
        String today = p.getString("today", "");

        Intent intent = new Intent(context, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (!bookId.isEmpty()) {
            intent.setAction(ACTION_OPEN_BOOK);
            intent.putExtra("bookId", bookId);
        } else {
            intent.setAction(Intent.ACTION_MAIN);
        }
        PendingIntent pi = PendingIntent.getActivity(context, 7, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        v.setOnClickPendingIntent(R.id.widget_root, pi);

        if (bookId.isEmpty()) {
            v.setTextViewText(R.id.widget_title, context.getString(R.string.widget_empty));
            v.setTextViewText(R.id.widget_pct, "—");
            v.setTextViewText(R.id.widget_kicker, "Folio");
            v.setImageViewResource(R.id.widget_cover, R.mipmap.ic_launcher_foreground);
        } else {
            v.setTextViewText(R.id.widget_title, title);
            v.setTextViewText(R.id.widget_pct, pct + " %");
            v.setTextViewText(R.id.widget_kicker, context.getString(R.string.widget_kicker));
            Bitmap cover = loadCover(context, bookId);
            if (cover != null) v.setImageViewBitmap(R.id.widget_cover, cover);
            else v.setImageViewResource(R.id.widget_cover, R.mipmap.ic_launcher_foreground);
        }
        v.setTextViewText(R.id.widget_today, today);
        v.setViewVisibility(R.id.widget_today, today.isEmpty() || !withToday ? View.GONE : View.VISIBLE);
        v.setViewVisibility(R.id.widget_cover, withCover ? View.VISIBLE : View.GONE);
        applyTheme(v, theme, semi, pct, !bookId.isEmpty());
        return v;
    }

    private static void applyTheme(RemoteViews v, String theme, boolean semi, int pct, boolean hasBook) {
        int bg; int title; int muted; int accent; int bar;
        switch (theme) {
            case "bordeaux":
                bg = semi ? R.drawable.widget_bg_bordeaux_semi : R.drawable.widget_bg_bordeaux;
                title = 0xFFF6F1E7; muted = 0xFFE3C9C0; accent = 0xFFF3CDBD; bar = R.id.widget_bar_bordeaux;
                break;
            case "sombre":
                bg = semi ? R.drawable.widget_bg_sombre_semi : R.drawable.widget_bg_sombre;
                title = 0xFFE6DFD2; muted = 0xFFA39C90; accent = 0xFFE0937F; bar = R.id.widget_bar_sombre;
                break;
            default:
                bg = semi ? R.drawable.widget_bg_creme_semi : R.drawable.widget_bg_creme;
                title = 0xFF2A2622; muted = 0xFF5E564C; accent = 0xFF4A1420; bar = R.id.widget_bar;
        }
        v.setInt(R.id.widget_root, "setBackgroundResource", bg);
        v.setTextColor(R.id.widget_title, title);
        v.setTextColor(R.id.widget_kicker, muted);
        v.setTextColor(R.id.widget_today, muted);
        v.setTextColor(R.id.widget_pct, accent);
        int[] bars = {R.id.widget_bar, R.id.widget_bar_bordeaux, R.id.widget_bar_sombre};
        for (int b : bars) {
            v.setViewVisibility(b, b == bar ? View.VISIBLE : View.GONE);
            v.setProgressBar(b, 1000, hasBook ? Math.max(0, Math.min(1000, pct * 10)) : 0, false);
        }
    }

    static File coverFile(Context context) {
        return new File(context.getFilesDir(), "widget-cover.jpg");
    }

    private static Bitmap loadCover(Context context, String bookId) {
        SharedPreferences p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (!bookId.equals(p.getString("coverId", ""))) return null;
        File f = coverFile(context);
        if (!f.exists()) return null;
        try {
            BitmapFactory.Options o = new BitmapFactory.Options();
            o.inJustDecodeBounds = true;
            BitmapFactory.decodeFile(f.getAbsolutePath(), o);
            int sample = 1;
            while (o.outHeight / sample > 260) sample *= 2;
            o = new BitmapFactory.Options();
            o.inSampleSize = sample;
            return BitmapFactory.decodeFile(f.getAbsolutePath(), o);
        } catch (Exception e) {
            return null;
        }
    }
}
