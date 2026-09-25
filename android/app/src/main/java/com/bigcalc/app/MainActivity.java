package com.bigcalc.app;

import android.os.Bundle;
import android.content.Context;
import android.view.inputmethod.InputMethodManager;
import android.view.View;
import android.webkit.WebView;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private void suppressExpressionImeAfterForeground() {
        WebView webView = bridge == null ? null : bridge.getWebView();
        if (webView == null) return;
        // Android can restore an old input connection after inputmode=none was
        // applied. Only the calculator editor is exempt from the system IME;
        // Settings fields retain their normal keyboard behavior.
        webView.evaluateJavascript(
                "document.activeElement?.classList.contains('expression-input') === true",
                focused -> {
                    if (!"true".equals(focused)) return;
                    InputMethodManager imm = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
                    if (imm != null) imm.hideSoftInputFromWindow(webView.getWindowToken(), 0);
                });
    }

    @Override
    public void onResume() {
        super.onResume();
        View content = findViewById(android.R.id.content);
        if (content != null) {
            content.post(this::suppressExpressionImeAfterForeground);
            content.postDelayed(this::suppressExpressionImeAfterForeground, 150);
            content.postDelayed(this::suppressExpressionImeAfterForeground, 400);
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) suppressExpressionImeAfterForeground();
    }

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
