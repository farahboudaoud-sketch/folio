package fr.folio.app;

import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.RadioGroup;
import android.widget.Switch;

/**
 * Personnalisation d'un widget Folio : s'ouvre à l'ajout du widget (anciens Android)
 * ou par appui long sur le widget › Paramètres (Android 12 et plus).
 */
public class WidgetConfigActivity extends Activity {

    private int widgetId = AppWidgetManager.INVALID_APPWIDGET_ID;
    private RadioGroup themeGroup;
    private RadioGroup bgGroup;
    private Switch coverSwitch;
    private Switch todaySwitch;
    private FrameLayout preview;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Bundle extras = getIntent().getExtras();
        if (extras != null) {
            widgetId = extras.getInt(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
        }
        // Par défaut « annulé » : si on quitte sans enregistrer à l'ajout, le widget n'est pas posé
        Intent result = new Intent();
        result.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
        setResult(RESULT_CANCELED, result);
        if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) {
            finish();
            return;
        }

        setContentView(R.layout.widget_config);
        themeGroup = findViewById(R.id.cfg_theme);
        bgGroup = findViewById(R.id.cfg_bg);
        coverSwitch = findViewById(R.id.cfg_cover);
        todaySwitch = findViewById(R.id.cfg_today);
        preview = findViewById(R.id.cfg_preview);

        String theme = FolioWidget.theme(this, widgetId);
        themeGroup.check("bordeaux".equals(theme) ? R.id.cfg_theme_bordeaux
                : "sombre".equals(theme) ? R.id.cfg_theme_sombre : R.id.cfg_theme_creme);
        bgGroup.check(FolioWidget.semi(this, widgetId) ? R.id.cfg_bg_semi : R.id.cfg_bg_opaque);
        coverSwitch.setChecked(FolioWidget.showCover(this, widgetId));
        todaySwitch.setChecked(FolioWidget.showToday(this, widgetId));

        themeGroup.setOnCheckedChangeListener((g, id) -> refreshPreview());
        bgGroup.setOnCheckedChangeListener((g, id) -> refreshPreview());
        coverSwitch.setOnCheckedChangeListener((b, on) -> refreshPreview());
        todaySwitch.setOnCheckedChangeListener((b, on) -> refreshPreview());

        Button cancel = findViewById(R.id.cfg_cancel);
        Button save = findViewById(R.id.cfg_save);
        cancel.setOnClickListener(v -> finish());
        save.setOnClickListener(v -> {
            FolioWidget.saveSettings(this, widgetId, selectedTheme(), isSemi(), coverSwitch.isChecked(), todaySwitch.isChecked());
            AppWidgetManager.getInstance(this).updateAppWidget(widgetId, FolioWidget.build(this, widgetId));
            Intent ok = new Intent();
            ok.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
            setResult(RESULT_OK, ok);
            finish();
        });
        refreshPreview();
    }

    private String selectedTheme() {
        int id = themeGroup.getCheckedRadioButtonId();
        if (id == R.id.cfg_theme_bordeaux) return "bordeaux";
        if (id == R.id.cfg_theme_sombre) return "sombre";
        return "creme";
    }

    private boolean isSemi() {
        return bgGroup.getCheckedRadioButtonId() == R.id.cfg_bg_semi;
    }

    /** Aperçu en direct : le vrai rendu du widget avec les réglages choisis. */
    private void refreshPreview() {
        try {
            preview.removeAllViews();
            View v = FolioWidget.build(this, selectedTheme(), isSemi(), coverSwitch.isChecked(), todaySwitch.isChecked())
                    .apply(this, preview);
            preview.addView(v);
        } catch (Exception ignored) {
            // l'aperçu est facultatif
        }
    }
}
