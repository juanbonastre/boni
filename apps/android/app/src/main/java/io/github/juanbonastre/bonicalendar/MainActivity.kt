package io.github.juanbonastre.bonicalendar

import android.annotation.SuppressLint
import android.os.Bundle
import android.util.Log
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import java.io.File

/**
 * The Android host of Boni Calendar: the same web app as the desktop shell (built into
 * `assets/web/`), in a WebView. The page is served from https://appassets.androidplatform.net so
 * localStorage and IndexedDB work as on any site; nothing is loaded from the network.
 *
 * Launch extras (development): `query`, appended to the page's URL (e.g. "bench=auto&now=...").
 */
class MainActivity : ComponentActivity() {
    private lateinit var web: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val assets = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
        web = WebView(this)
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            // The calendar zooms its hours itself; the page must not be zoomed by the WebView.
            setSupportZoom(false)
            builtInZoomControls = false
        }
        web.webViewClient = object : WebViewClientCompat() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                assets.shouldInterceptRequest(request.url)

            // Links never navigate the calendar away.
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                request.url.host != "appassets.androidplatform.net"
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                Log.i(TAG, message.message())
                return true
            }
        }
        web.addJavascriptInterface(HostBridge(), "hostBridge")
        setContentView(web)

        val query = intent.getStringExtra("query")?.let { "?$it" } ?: ""
        web.loadUrl("https://appassets.androidplatform.net/assets/web/index.html$query")

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            // Back is Escape for the calendar (closes what is open); with nothing open the app goes to the background.
            override fun handleOnBackPressed() {
                web.evaluateJavascript(BACK_JS) { handled ->
                    if (handled != "true") moveTaskToBack(true)
                }
            }
        })
    }

    /** What the page can ask of the app (the same names as the desktop shell's `hostBridge`). */
    inner class HostBridge {
        /** The smoothness benchmark's result: logged and kept in the app's files (adb reads it). */
        @JavascriptInterface
        fun saveBench(json: String) {
            Log.i(TAG, "BENCH_RESULT $json")
            File(filesDir, "bench.json").writeText(json)
        }
    }

    companion object {
        const val TAG = "BoniCalendar"

        /** True when something was open (and Escape closed it): then Back stays in the app. */
        private const val BACK_JS = """(() => {
            const s = window.__app?.getState();
            const open = !!s && !!(s.popoverId || s.settingsOpen || s.paletteOpen || s.helpOpen ||
                s.schemaCalendarId || s.scopePrompt || s.ctxMenu || s.selectedIds.length);
            if (open) window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
            return open;
        })()"""
    }
}
