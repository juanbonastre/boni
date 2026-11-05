package io.github.juanbonastre.boni

import android.util.Log
import org.unifiedpush.android.connector.FailedReason
import org.unifiedpush.android.connector.PushService
import org.unifiedpush.android.connector.data.PushEndpoint
import org.unifiedpush.android.connector.data.PushMessage

/**
 * UnifiedPush (task 62): the distributor (the ntfy app) gives this device an address, which the server learns with
 * the Web Push keys the connector made; a notice of Boni's arrives sealed for those keys alone, the connector opens it,
 * and it shows as a system notification with the app closed. A message it could not open shows nothing.
 */
class BoniPushService : PushService() {
    override fun onNewEndpoint(endpoint: PushEndpoint, instance: String) = Notices.endpoint(this, endpoint)

    override fun onMessage(message: PushMessage, instance: String) {
        val notice = NoticeRules.parse(message.content, message.decrypted) ?: return
        Notices.show(this, notice)
    }

    override fun onRegistrationFailed(reason: FailedReason, instance: String) {
        Log.w(MainActivity.TAG, "push registration failed: $reason")
    }

    override fun onUnregistered(instance: String) {
        Log.i(MainActivity.TAG, "push unregistered")
    }
}
