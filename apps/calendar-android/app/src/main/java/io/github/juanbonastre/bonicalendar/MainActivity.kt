package io.github.juanbonastre.bonicalendar

import android.Manifest
import android.annotation.SuppressLint
import android.content.pm.PackageManager
import android.os.Build
import org.json.JSONObject
import android.content.Intent
import android.os.Bundle
import android.util.Log
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.webkit.WebView
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
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
        web.addJavascriptInterface(AndroidBridge(this, web), "boniAndroid")
        // The calendar stays clear of the status bar, the navigation bar, the camera cut-out and the
        // keyboard: the window draws edge to edge, so a frame around the page takes their space.
        val frame = FrameLayout(this).apply {
            setBackgroundColor(getColor(R.color.bg))
            addView(web, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
        }
        ViewCompat.setOnApplyWindowInsetsListener(frame) { v, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or
                    WindowInsetsCompat.Type.ime(),
            )
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            WindowInsetsCompat.CONSUMED
        }
        setContentView(frame)
        // Light icons on the graphite bars.
        WindowCompat.getInsetsController(window, frame).isAppearanceLightStatusBars = false

        pendingOpen = intent.getStringExtra(EXTRA_OPEN_EVENT)
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

    /** The event of the notification that opened the app, until the page asks for it. */
    @Volatile private var pendingOpen: String? = null

    fun takeOpenEvent(): String? = pendingOpen.also { pendingOpen = null }

    /** A notification tapped while the app was running: the page shows that event. */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        val id = intent.getStringExtra(EXTRA_OPEN_EVENT) ?: return
        web.evaluateJavascript(
            "window.__boniOpenNotice ? (window.__boniOpenNotice(${JSONObject.quote(id)}), true) : false",
        ) { done -> if (done != "true") pendingOpen = id }
    }

    /** Notifications need the user's yes since Android 13 (asked once, when there is something to remind). */
    fun askNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED &&
            !getSharedPreferences("notices", MODE_PRIVATE).getBoolean("asked", false)
        ) {
            getSharedPreferences("notices", MODE_PRIVATE).edit().putBoolean("asked", true).apply()
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        }
    }

    /** Coming back to the app: the page looks for changes (the server's, when the stream was cut). */
    override fun onResume() {
        super.onResume()
        if (::web.isInitialized) web.evaluateJavascript("window.dispatchEvent(new Event('focus'))", null)
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
        const val EXTRA_OPEN_EVENT = "openEvent"

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
