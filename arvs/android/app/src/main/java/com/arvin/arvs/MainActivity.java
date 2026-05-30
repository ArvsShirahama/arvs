package com.arvin.arvs;

import android.app.PictureInPictureParams;
import android.os.Build;
import android.util.Log;
import android.util.Rational;
import android.os.Bundle;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import androidx.annotation.NonNull;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "MainActivity";
    private static boolean isCallActive = false;
    private OnBackPressedCallback backPressedCallback;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // IMPORTANT: registerPlugin MUST be called BEFORE super.onCreate()
        // so the Capacitor bridge discovers the plugin during initialization.
        registerPlugin(AndroidPiP.class);
        super.onCreate(savedInstanceState);

        // Modern back button gesture handling using OnBackPressedDispatcher
        backPressedCallback = new OnBackPressedCallback(false) { // Initially disabled
            @Override
            public void handleOnBackPressed() {
                Log.d(TAG, "handleOnBackPressed: call is active, entering PiP");
                enterPiPIfCallActive();
            }
        };
        getOnBackPressedDispatcher().addCallback(this, backPressedCallback);
    }

    @Override
    protected void onUserLeaveHint() {
        super.onUserLeaveHint();
        Log.d(TAG, "onUserLeaveHint called, isCallActive=" + isCallActive);
        enterPiPIfCallActive();
    }

    @Override
    public void onPause() {
        super.onPause();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && isInPictureInPictureMode()) {
            WebView webView = getBridge().getWebView();
            if (webView != null) {
                webView.onResume();
                Log.d(TAG, "onPause: App is in PiP, resumed WebView to keep video call running");
            }
        }
    }

    private void enterPiPIfCallActive() {
        if (!isCallActive) return;
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;

        try {
            PictureInPictureParams.Builder builder = new PictureInPictureParams.Builder();
            Rational aspect = new Rational(9, 16);
            builder.setAspectRatio(aspect);

            // Android 12+ (API 31): setAutoEnterEnabled makes PiP trigger
            // automatically on Home press without needing onUserLeaveHint
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                builder.setAutoEnterEnabled(true);
                builder.setSeamlessResizeEnabled(false);
            }

            enterPictureInPictureMode(builder.build());
            Log.d(TAG, "Entered PiP mode successfully");
        } catch (Exception e) {
            Log.e(TAG, "Failed to enter PiP mode", e);
        }
    }

    /**
     * Update PiP params whenever call state changes.
     * On Android 12+, this sets autoEnterEnabled so the OS
     * automatically enters PiP on Home/Recents gestures.
     */
    private void updatePiPParams() {
        if (backPressedCallback != null) {
            backPressedCallback.setEnabled(isCallActive);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            try {
                PictureInPictureParams.Builder builder = new PictureInPictureParams.Builder();
                builder.setAspectRatio(new Rational(9, 16));
                builder.setAutoEnterEnabled(isCallActive);
                builder.setSeamlessResizeEnabled(false);
                setPictureInPictureParams(builder.build());
                Log.d(TAG, "Updated PiP params, autoEnter=" + isCallActive);
            } catch (Exception e) {
                Log.e(TAG, "Failed to update PiP params", e);
            }
        }
    }

    @Override
    public void onPictureInPictureModeChanged(boolean isInPictureInPictureMode, @NonNull android.content.res.Configuration newConfig) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig);
        Log.d(TAG, "onPictureInPictureModeChanged: " + isInPictureInPictureMode);

        // Keep the WebView rendering while in PiP
        WebView webView = getBridge().getWebView();
        if (webView != null) {
            webView.setKeepScreenOn(isInPictureInPictureMode);
            if (isInPictureInPictureMode) {
                // Resume the WebView timer/rendering in PiP
                webView.onResume();
            }
        }

        AndroidPiP.sendPiPChange(isInPictureInPictureMode);
    }

    @CapacitorPlugin(name = "AndroidPiP")
    public static class AndroidPiP extends Plugin {
        private static AndroidPiP instance;

        @Override
        public void load() {
            instance = this;
            Log.d(TAG, "AndroidPiP plugin loaded");
        }

        @PluginMethod
        public void setCallActive(PluginCall call) {
            Boolean active = call.getBoolean("active", false);
            isCallActive = active != null && active;
            Log.d(TAG, "setCallActive: " + isCallActive);

            // Update PiP params on the main thread
            getActivity().runOnUiThread(() -> {
                if (getActivity() instanceof MainActivity) {
                    ((MainActivity) getActivity()).updatePiPParams();
                }
            });

            call.resolve();
        }

        @PluginMethod
        public void enterPiP(PluginCall call) {
            Log.d(TAG, "enterPiP called manually from JS");
            getActivity().runOnUiThread(() -> {
                if (getActivity() instanceof MainActivity) {
                    ((MainActivity) getActivity()).enterPiPIfCallActive();
                }
            });
            call.resolve();
        }

        public static void sendPiPChange(boolean inPiP) {
            if (instance != null) {
                com.getcapacitor.JSObject data = new com.getcapacitor.JSObject();
                data.put("inPiP", inPiP);
                instance.notifyListeners("pipModeChanged", data);
                Log.d(TAG, "Sent pipModeChanged event: inPiP=" + inPiP);
            }
        }
    }
}
