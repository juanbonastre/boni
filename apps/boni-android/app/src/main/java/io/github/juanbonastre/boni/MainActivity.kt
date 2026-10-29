package io.github.juanbonastre.boni

import android.annotation.SuppressLint
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import org.json.JSONObject

/**
 * The Android host of Boni: the same web app as the desktop shell (built into `assets/web/`), in a WebView, as Boni
 * Calendar's Android app. The page is served from https://appassets.androidplatform.net, so it opens without
 * network; everything it needs from the phone goes through `window.boniAndroid` (AndroidBridge, Shell).
 */
class MainActivity : ComponentActivity() {
    private lateinit var web: WebView
    private lateinit var shell: Shell
    private val main = Handler(Looper.getMainLooper())
    private var minute = 0

    /** The coordinator's minute (the desktop shell's tick): the page sends its offline queue, and reloads every
     *  15 minutes while there is no live connection. */
    private val tick = object : Runnable {
        override fun run() {
            minute++
            send(JSONObject().put("type", "tick").put("minute", minute))
            main.postDelayed(this, 60_000)
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        shell = Shell.get(this)
        val assets = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
        web = WebView(this)
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            setSupportZoom(false)
            builtInZoomControls = false
        }
        web.webViewClient = object : WebViewClientCompat() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                assets.shouldInterceptRequest(request.url)

            // Links never navigate the app away.
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                request.url.host != "appassets.androidplatform.net"
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                Log.i(TAG, message.message())
                return true
            }
        }
        web.addJavascriptInterface(AndroidBridge(this, web, shell, this), "boniAndroid")
        // The page stays clear of the status bar, the navigation bar, the camera cut-out and the keyboard: the
        // window draws edge to edge, so a frame around the page takes their space.
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
        WindowCompat.getInsetsController(window, frame).isAppearanceLightStatusBars = false
        pendingLaunch = intent.launchTarget()
        web.loadUrl("https://appassets.androidplatform.net/assets/web/index.html")

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            // Back closes what is open in the page (a sheet, a chart, the charts tab); with nothing open the app
            // goes to the background.
            override fun handleOnBackPressed() {
                web.evaluateJavascript("window.__boniBack ? window.__boniBack() : false") { handled ->
                    if (handled != "true") moveTaskToBack(true)
                }
            }
        })
    }

    /** What a home-screen shortcut or a link opened when it started the app, until the page asks for it. */
    @Volatile private var pendingLaunch: String? = null

    fun takeLaunch(): String? = pendingLaunch.also { pendingLaunch = null }

    /** A home-screen shortcut's target, or a link's (Boni Calendar's «Abrir en Boni»: `boni://note?id=`). */
    private fun Intent.launchTarget(): String? =
        getStringExtra(Launcher.EXTRA_TARGET)?.takeIf { Launcher.valid(it) } ?: Links.target(dataString)

    /** A home-screen shortcut tapped, or a link followed, while the app was running: the page opens it. */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        val target = intent.launchTarget() ?: return
        send(JSONObject().put("type", "navigate").put("screen", target))
    }

    /** One event for the page (`ShellEvent` in host.ts). */
    private fun send(event: JSONObject) {
        web.evaluateJavascript("window.__boniEvent && window.__boniEvent(${JSONObject.quote(event.toString())})", null)
    }

    override fun onStart() {
        super.onStart()
        Shell.foreground = true
        shell.emit = { e -> main.post { send(e) } }
        if (shell.configured()) shell.live.start()
        main.removeCallbacks(tick)
        main.postDelayed(tick, 60_000)
    }

    override fun onStop() {
        super.onStop()
        Shell.foreground = false
        main.removeCallbacks(tick)
        shell.live.stop()
        shell.emit = null
        // Whatever the page left in the queue goes from here, with the network, even if the app is closed.
        shell.storeRead(Shell.QUEUE_FILE)?.let { QueueWorker.scheduleFor(this, it) }
    }

    companion object {
        const val TAG = "Boni"
    }
}
