package io.github.juanbonastre.boni

import com.google.crypto.tink.apps.fixed_webpush.WebPushHybridDecrypt
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.util.Base64

/** Boni's notices by UnifiedPush (task 62, A-17): what shows, and that the phone opens what the server seals. */
class NoticesTest {
    private val b64 = Base64.getUrlDecoder()
    private fun bytes(s: String) = s.toByteArray(Charsets.UTF_8)

    /**
     * The server's `encrypt` (apps/server/src/webpush.test.ts, NOTICE_SEALED) with RFC 8291's example keys and salt,
     * opened here with the very decryption the UnifiedPush connector runs on the phone (Tink's fixed web push).
     */
    @Test
    fun opensWhatTheServerSealsWithTheConnectorsDecryption() {
        val decrypt = WebPushHybridDecrypt.Builder()
            .withAuthSecret(b64.decode("BTBZMqHH6r4Tts7J_aSIgg"))
            .withRecipientPublicKey(
                b64.decode("BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4"),
            )
            .withRecipientPrivateKey(b64.decode("q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94"))
            .build()
        val notice = NoticeRules.parse(decrypt.decrypt(b64.decode(SEALED), null), true)
        assertEquals(
            Notice("n-ejemplo", "Resumen de hoy: 3 tareas, la primera «Revisar el informe»", 1793862000000L),
            notice,
        )
    }

    @Test
    fun onlyAnOpenedNoticeWithATextShows() {
        val json = "{\"kind\":\"notice\",\"id\":\"n1\",\"text\":\"Sacar la basura\",\"at\":5}"
        assertEquals(Notice("n1", "Sacar la basura", 5L), NoticeRules.parse(bytes(json), true))
        // In the clear, or sealed for another device: the connector could not open it.
        assertNull(NoticeRules.parse(bytes(json), false))
        assertNull(NoticeRules.parse(bytes("reminders"), true))
        assertNull(NoticeRules.parse(bytes("{\"kind\":\"other\",\"text\":\"x\"}"), true))
        assertNull(NoticeRules.parse(bytes("{\"kind\":\"notice\",\"text\":\"  \"}"), true))
    }

    @Test
    fun theTextIsPlainAndCutAsTheServerCutsIt() {
        val long = "x".repeat(600)
        val n = NoticeRules.parse(bytes("{\"kind\":\"notice\",\"text\":\"$long\"}"), true)
        assertEquals(500, n?.text?.length)
        // Without an id, the text names it (one notification per notice).
        assertEquals(n?.text, n?.id)
        val ctl = NoticeRules.parse(bytes("{\"kind\":\"notice\",\"id\":\"a\",\"text\":\"una\\u0007 línea\\notra\"}"), true)
        assertEquals("una línea\notra", ctl?.text)
    }

    @Test
    fun registersForNoticesOnlyWithTheDevicesKeys() {
        val body = NoticeRules.registration("https://ntfy.example.com/upBoni?up=1", "BCVx", "BTBZ")
        assertEquals("notices", body?.getString("for"))
        assertEquals("https://ntfy.example.com/upBoni?up=1", body?.getString("endpoint"))
        assertEquals("BCVx", body?.getJSONObject("keys")?.getString("p256dh"))
        assertEquals("BTBZ", body?.getJSONObject("keys")?.getString("auth"))
        assertNull(NoticeRules.registration("https://ntfy.example.com/upBoni?up=1", null, null))
        assertNull(NoticeRules.registration("", "BCVx", "BTBZ"))
    }

    private companion object {
        const val SEALED =
            "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_" +
                "e3dBcDLa4LAPSvPoQuUAdsSftsfkPSMfI9nIZjKr8RLaTHCwmGHqYDEPAywzajV4XT-EdoQ28k_E1pouMezvpuXT1n8pDE7jOZqcmRD0IXCcHw2kT" +
                "obsFu9cQPgB0UdpzqUtj2ThrsnwfY5FqxlGiMX52mM1PG4CMxwG8831MaCK6sScffcsN_0zx"
    }
}
