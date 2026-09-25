package com.bigcalc.app;

import android.os.Bundle;
import android.view.View;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        View content = findViewById(android.R.id.content);
        ViewCompat.setOnApplyWindowInsetsListener(content, (view, windowInsets) -> {
            int handledTypes = WindowInsetsCompat.Type.systemBars()
                    | WindowInsetsCompat.Type.displayCutout()
                    | WindowInsetsCompat.Type.ime();
            Insets insets = windowInsets.getInsets(handledTypes);
            view.setPadding(insets.left, insets.top, insets.right, insets.bottom);
            // The WebView is inside the padded content area. Forward zeroed insets
            // so CSS and the visual viewport do not apply the same area twice.
            return new WindowInsetsCompat.Builder(windowInsets)
                    .setInsets(handledTypes, Insets.NONE)
                    .build();
        });
        ViewCompat.requestApplyInsets(content);
    }
}
