package io.github.juanbonastre.boni

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.webkit.ConsoleMessage
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
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
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit

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

    /** The page waiting for files («Subir un archivo»): the phone's own picker answers it, with none if cancelled. */
    private var choosing: ValueCallback<Array<Uri>>? = null
    private val pickFiles = registerForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        choosing?.onReceiveValue(if (uris.isEmpty()) null else uris.toTypedArray())
        choosing = null
    }

    /**
     * «Adjuntar» in the conversation (task 114): the phone's picker, asked by the bridge off the UI thread, which
     * waits for what Juan chose (none if he cancels); what he chose waits in [chosen] for the page to send it.
     */
    val chosen by lazy { Chosen(contentResolver) }
    private var attaching: CompletableFuture<List<Uri>>? = null
    private val attachPicker = registerForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        attaching?.complete(uris)
        attaching = null
    }

    fun chooseFiles(): JSONArray {
        val answer = CompletableFuture<List<Uri>>()
        main.post {
            attaching?.complete(emptyList())
            attaching = answer
            try {
                attachPicker.launch(arrayOf("*/*"))
            } catch (e: Exception) {
                attaching = null
                answer.complete(emptyList())
            }
        }
        val uris = try {
            answer.get(1, TimeUnit.HOURS)
        } catch (e: Exception) {
            emptyList()
        }
        return chosen.add(uris)
    }

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
        // The test copy's page can be read by a test on the laptop (apps/boni-android/phone-test); the real app's never.
        if (resources.getBoolean(R.bool.test_copy)) WebView.setWebContentsDebuggingEnabled(true)
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

            // A file input in the page (the + button's «Subir un archivo»): the system's picker, its files to the page.
            override fun onShowFileChooser(
                view: WebView,
                callback: ValueCallback<Array<Uri>>,
                params: FileChooserParams,
            ): Boolean {
                choosing?.onReceiveValue(null)
                choosing = callback
                val types = params.acceptTypes.filter { it.isNotBlank() }.ifEmpty { listOf("*/*") }
                return try {
                    pickFiles.launch(types.toTypedArray())
                    true
                } catch (e: Exception) {
                    choosing = null
                    false
                }
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
        // Boni's notices reach the phone with the app closed (task 62): its address, once per start with a session.
        // Not in the test copy (the debug build, beside the real app): it never asks for the permission nor registers.
        if (shell.configured() && !resources.getBoolean(R.bool.test_copy)) Notices.start(this)

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

    /** Android 13 and later ask before an app notifies: once, the first time there may be a notice (Boni Calendar's way). */
    fun askNotificationPermission() {
        val prefs = getSharedPreferences("notices", MODE_PRIVATE)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED &&
            !prefs.getBoolean("asked", false)
        ) {
            prefs.edit().putBoolean("asked", true).apply()
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        }
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

    override fun onDestroy() {
        // A picker still open answers none: the bridge's thread never waits for a window that is gone.
        attaching?.complete(emptyList())
        attaching = null
        super.onDestroy()
    }

    override fun onStop() {
        super.onStop()
        Shell.foreground = false
        main.removeCallbacks(tick)
        shell.live.stop()
        shell.emit = null
        // A job before onStop returns, after which the system may end the app at once: whatever the page left in the
        // queue and what was typed and kept unsent (task 109) go from it, with the network, even if the app is
        // closed. Always, as the page keeps its list just after this (its hide notice) and then only asks for a job
        // behind this one: on a phone, the job asked for then was not there when the app was ended.
        if (shell.configured()) QueueWorker.schedule(this, QueueWorker.HIDDEN_MS, wait = true)
        Log.i(TAG, "stop")
    }

    companion object {
        const val TAG = "Boni"
    }
}
