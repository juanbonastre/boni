package io.github.juanbonastre.boni

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews

/**
 * Boni's circle as a home-screen widget (task 115, F9): the desktop's circle, alone on the home screen. A tap opens
 * Boni on the conversation (the page's `chat` target: the last conversation, over whatever was open). It shows
 * nothing of Juan's, so it never needs a refresh.
 */
class ChatWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        for (id in ids) manager.updateAppWidget(id, views(context))
    }

    companion object {
        /** The action of the widget's intent: its own, so its PendingIntent never stands in for a chart widget's. */
        const val ACTION = "io.github.juanbonastre.boni.CHAT"

        /** The intent a tap sends: Boni, on the conversation. */
        fun intent(context: Context): Intent =
            Intent(context, MainActivity::class.java)
                .setAction(ACTION)
                .putExtra(Launcher.EXTRA_TARGET, Launcher.CHAT)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)

        private fun views(context: Context): RemoteViews =
            RemoteViews(context.packageName, R.layout.widget_chat).apply {
                setOnClickPendingIntent(
                    R.id.chat_widget_root,
                    PendingIntent.getActivity(
                        context,
                        0,
                        intent(context),
                        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                    ),
                )
            }
    }
}
