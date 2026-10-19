package io.github.juanbonastre.boni

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * The session token, encrypted with a key that lives in the Android Keystore (it never leaves it, and is lost with
 * the app). Only the ciphertext is in the app's preferences; the page never sees the token.
 */
class TokenVault(context: Context) {
    private val prefs = context.getSharedPreferences("token", Context.MODE_PRIVATE)
    @Volatile private var cached: String? = null
    @Volatile private var loaded = false

    @Synchronized
    fun read(): String? {
        if (loaded) return cached
        val data = prefs.getString("data", null)
        val iv = prefs.getString("iv", null)
        cached = if (data == null || iv == null) null else try {
            val c = Cipher.getInstance(TRANSFORMATION)
            c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)))
            String(c.doFinal(Base64.decode(data, Base64.NO_WRAP)), Charsets.UTF_8)
        } catch (e: Exception) {
            null // the key is gone (restored data, a new phone): log in again
        }
        loaded = true
        return cached
    }

    @Synchronized
    fun write(token: String?) {
        if (token == null) {
            prefs.edit().remove("data").remove("iv").apply()
        } else {
            val c = Cipher.getInstance(TRANSFORMATION)
            c.init(Cipher.ENCRYPT_MODE, key())
            val data = c.doFinal(token.toByteArray(Charsets.UTF_8))
            prefs.edit()
                .putString("data", Base64.encodeToString(data, Base64.NO_WRAP))
                .putString("iv", Base64.encodeToString(c.iv, Base64.NO_WRAP))
                .apply()
        }
        cached = token
        loaded = true
    }

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (ks.getKey(ALIAS, null) as SecretKey?)?.let { return it }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        gen.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return gen.generateKey()
    }

    companion object {
        private const val KEYSTORE = "AndroidKeyStore"
        private const val ALIAS = "boni-session"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
    }
}
