package com.example.donnacho

import com.stripe.stripeterminal.external.callable.ConnectionTokenCallback
import com.stripe.stripeterminal.external.callable.ConnectionTokenProvider
import com.stripe.stripeterminal.external.models.ConnectionTokenException
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

class BackendTokenProvider : ConnectionTokenProvider {
    private val client = OkHttpClient()

    override fun fetchConnectionToken(callback: ConnectionTokenCallback) {
        try {
            val request = Request.Builder()
                .url("${Config.BACKEND_URL}/connection_token")
                .post(ByteArray(0).toRequestBody(null))
                .build()
            client.newCall(request).execute().use { response ->
                val body = response.body?.string() ?: ""
                val secret = JSONObject(body).getString("secret")
                callback.onSuccess(secret)
            }
        } catch (e: Exception) {
            callback.onFailure(ConnectionTokenException("No se pudo obtener el connection token", e))
        }
    }
}
