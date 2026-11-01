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
        for (int id : ids) manager.updateAppWidget(id, build(context));
    }

    /** Redessine tous les widgets posés sur l'écran d'accueil. */
    static void refreshAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, FolioWidget.class));
        if (ids == null || ids.length == 0) return;
        RemoteViews views = build(context);
        for (int id : ids) manager.updateAppWidget(id, views);
    }

    static RemoteViews build(Context context) {
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
            v.setProgressBar(R.id.widget_bar, 1000, 0, false);
            v.setImageViewResource(R.id.widget_cover, R.mipmap.ic_launcher_foreground);
        } else {
            v.setTextViewText(R.id.widget_title, title);
            v.setTextViewText(R.id.widget_pct, pct + " %");
            v.setTextViewText(R.id.widget_kicker, context.getString(R.string.widget_kicker));
            v.setProgressBar(R.id.widget_bar, 1000, Math.max(0, Math.min(1000, pct * 10)), false);
            Bitmap cover = loadCover(context, bookId);
            if (cover != null) v.setImageViewBitmap(R.id.widget_cover, cover);
            else v.setImageViewResource(R.id.widget_cover, R.mipmap.ic_launcher_foreground);
        }
        v.setTextViewText(R.id.widget_today, today);
        v.setViewVisibility(R.id.widget_today, today.isEmpty() ? View.GONE : View.VISIBLE);
        return v;
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
