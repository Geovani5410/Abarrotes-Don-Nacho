package com.example.donnacho

import com.stripe.stripeterminal.Terminal
import com.stripe.stripeterminal.external.callable.Callback
import com.stripe.stripeterminal.external.callable.DiscoveryListener
import com.stripe.stripeterminal.external.callable.MobileReaderListener
import com.stripe.stripeterminal.external.callable.PaymentIntentCallback
import com.stripe.stripeterminal.external.callable.ReaderCallback
import com.stripe.stripeterminal.external.models.ConnectionConfiguration
import com.stripe.stripeterminal.external.models.DiscoveryConfiguration
import com.stripe.stripeterminal.external.models.PaymentIntent
import com.stripe.stripeterminal.external.models.Reader
import com.stripe.stripeterminal.external.models.TerminalException
import com.stripe.stripeterminal.ktx.processPaymentIntent
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

object TerminalPayments {
    private val client = OkHttpClient()
    private var connectedReader: Reader? = null

    private suspend fun connectSimulatedReader(): Reader {
        connectedReader?.let { return it }
        return suspendCancellableCoroutine { cont ->
            Terminal.getInstance().discoverReaders(
                DiscoveryConfiguration.BluetoothDiscoveryConfiguration(isSimulated = true),
                object : DiscoveryListener {
                    override fun onUpdateDiscoveredReaders(readers: List<Reader>) {
                        val reader = readers.firstOrNull() ?: return
                        val config = ConnectionConfiguration.BluetoothConnectionConfiguration(
                            locationId = reader.location?.id.orEmpty(),
                            autoReconnectOnUnexpectedDisconnect = true,
                            bluetoothReaderListener = object : MobileReaderListener {},
                        )
                        Terminal.getInstance().connectReader(
                            reader,
                            config,
                            object : ReaderCallback {
                                override fun onSuccess(reader: Reader) {
                                    connectedReader = reader
                                    if (cont.isActive) cont.resume(reader)
                                }
                                override fun onFailure(e: TerminalException) {
                                    if (cont.isActive) cont.resumeWithException(e)
                                }
                            }
                        )
                    }
                },
                object : Callback {
                    override fun onSuccess() {}
                    override fun onFailure(e: TerminalException) {
                        if (cont.isActive) cont.resumeWithException(e)
                    }
                }
            )
        }
    }

    private suspend fun createPaymentIntentOnBackend(amountCents: Int): String =
        withContext(Dispatchers.IO) {
            val body = JSONObject().put("amount", amountCents).toString()
                .toRequestBody("application/json".toMediaTypeOrNull())
            val request = Request.Builder()
                .url("${Config.BACKEND_URL}/create_payment_intent")
                .post(body)
                .build()
            client.newCall(request).execute().use { response ->
                val responseBody = response.body?.string() ?: throw Exception("Respuesta vacía del backend")
                JSONObject(responseBody).getString("client_secret")
            }
        }

    private suspend fun retrievePaymentIntent(clientSecret: String): PaymentIntent =
        suspendCancellableCoroutine { cont ->
            Terminal.getInstance().retrievePaymentIntent(
                clientSecret,
                object : PaymentIntentCallback {
                    override fun onSuccess(paymentIntent: PaymentIntent) {
                        if (cont.isActive) cont.resume(paymentIntent)
                    }
                    override fun onFailure(e: TerminalException) {
                        if (cont.isActive) cont.resumeWithException(e)
                    }
                }
            )
        }

    suspend fun chargeAmount(amountCents: Int): PaymentIntent {
        connectSimulatedReader()
        val clientSecret = createPaymentIntentOnBackend(amountCents)
        val paymentIntent = retrievePaymentIntent(clientSecret)
        return Terminal.getInstance().processPaymentIntent(paymentIntent)
    }
}
