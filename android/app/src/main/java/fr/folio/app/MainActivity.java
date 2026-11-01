package fr.folio.app;

import android.os.Bundle;
import android.view.KeyEvent;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(FolioPlugin.class);
        super.onCreate(savedInstanceState);
    }

    // Boutons de volume pour tourner les pages (quand l'option est activée et qu'un livre est ouvert)
    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        int code = event.getKeyCode();
        if (FolioPlugin.volumeKeysEnabled
                && (code == KeyEvent.KEYCODE_VOLUME_UP || code == KeyEvent.KEYCODE_VOLUME_DOWN)) {
            if (event.getAction() == KeyEvent.ACTION_DOWN) {
                FolioPlugin.onVolumeKey(code == KeyEvent.KEYCODE_VOLUME_DOWN ? "next" : "prev");
            }
            return true;
        }
        return super.dispatchKeyEvent(event);
    }
}
