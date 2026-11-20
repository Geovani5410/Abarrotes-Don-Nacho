package com.example.donnacho

import android.Manifest
import android.annotation.SuppressLint
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.webkit.WebViewAssetLoader
import com.stripe.stripeterminal.Terminal
import com.stripe.stripeterminal.external.callable.TerminalListener
import com.stripe.stripeterminal.external.models.ConnectionStatus
import com.stripe.stripeterminal.external.models.LocaleConfig
import com.stripe.stripeterminal.external.models.PaymentStatus
import com.stripe.stripeterminal.log.LogLevel
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import org.json.JSONObject

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private val scope = CoroutineScope(Dispatchers.Main)

    private val requiredPermissions: Array<String>
        get() = arrayOf(
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION,
            Manifest.permission.CAMERA,
            Manifest.permission.RECORD_AUDIO,
        ) + if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            arrayOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT)
        } else {
            arrayOf(Manifest.permission.BLUETOOTH, Manifest.permission.BLUETOOTH_ADMIN)
        }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        requestNeededPermissions()
        initStripeTerminalIfNeeded()

        webView = findViewById(R.id.webview)
        WebView.setWebContentsDebuggingEnabled(true)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
        }

        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest
            ): WebResourceResponse? {
                return assetLoader.shouldInterceptRequest(request.url)
            }

            override fun onReceivedError(
                view: WebView,
                request: WebResourceRequest,
                error: WebResourceError
            ) {
                Log.e("DonNachoWeb", "Error cargando ${request.url}: ${error.description}")
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                runOnUiThread { request.grant(request.resources) }
            }
            override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                Log.d("DonNachoWeb", "${message.message()} -- línea ${message.lineNumber()}")
                return true
            }
        }

        webView.addJavascriptInterface(object {
            @JavascriptInterface
            fun startPayment(amountCents: Int) {
                scope.launch {
                    try {
                        val paymentIntent = TerminalPayments.chargeAmount(amountCents)
                        val safeId = JSONObject.quote(paymentIntent.id ?: "")
                        webView.evaluateJavascript(
                            "window.onPaymentResult({status:'succeeded', paymentIntentId:$safeId})",
                            null
                        )
                    } catch (e: Exception) {
                        Log.e("DonNachoPay", "Error al cobrar", e)
                        val safeMsg = JSONObject.quote(e.message ?: "Error desconocido al cobrar")
                        webView.evaluateJavascript(
                            "window.onPaymentResult({status:'error', message:$safeMsg})",
                            null
                        )
                    }
                }
            }
        }, "Android")

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack() else finish()
            }
        })

        webView.loadUrl("https://appassets.androidplatform.net/assets/index.html?api=https://populate-conductor-coastline.ngrok-free.dev")
    }

    private fun requestNeededPermissions() {
        val faltantes = requiredPermissions.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }
        if (faltantes.isNotEmpty()) {
            ActivityCompat.requestPermissions(this, faltantes.toTypedArray(), 100)
        }
    }

    private fun initStripeTerminalIfNeeded() {
        if (Terminal.isInitialized()) return
        val listener = object : TerminalListener {
            override fun onConnectionStatusChange(status: ConnectionStatus) {
                Log.d("DonNachoTerminal", "Conexión: $status")
            }
            override fun onPaymentStatusChange(status: PaymentStatus) {
                Log.d("DonNachoTerminal", "Pago: $status")
            }
        }
        Terminal.init(
            context = applicationContext,
            logLevel = LogLevel.VERBOSE,
            tokenProvider = BackendTokenProvider(),
            listener = listener,
            offlineListener = null,
            localeConfig = LocaleConfig.CardLanguagePreferenceIfAvailable,
        )
    }
}
