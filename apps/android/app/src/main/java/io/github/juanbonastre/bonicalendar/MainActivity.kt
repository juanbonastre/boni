package io.github.juanbonastre.bonicalendar

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
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
import androidx.activity.result.contract.ActivityResultContracts
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

    private var onVaultPicked: ((Uri?) -> Unit)? = null
    private val pickTree = registerForActivityResult(ActivityResultContracts.OpenDocumentTree()) { tree ->
        if (tree != null) {
            // Keep the access across restarts.
            contentResolver.takePersistableUriPermission(
                tree,
                Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION,
            )
        }
        onVaultPicked?.invoke(tree)
        onVaultPicked = null
    }

    /** Asks for the vault's folder (once: the access is kept). */
    fun pickVault(done: (Uri?) -> Unit) {
        onVaultPicked = done
        pickTree.launch(null)
    }

    /** Coming back to the app: the calendar checks the vault for changes (Syncthing may have brought some). */
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
