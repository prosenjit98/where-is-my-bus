package com.wimb.location

import android.Manifest
import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

/** The ongoing trip notification, the stop alarm, and quieter trip updates. */
object TripNotifications {
  const val TRIP_ID = 4201
  private const val TRIP_CHANNEL = "wimb_trip"
  private const val ALARM_CHANNEL = "wimb_stop_alarm"
  private const val NOTICE_CHANNEL = "wimb_notice"
  private val ALARM_PATTERN = longArrayOf(0, 600, 300, 600, 300, 600)
  private var nextId = 5000

  // Uses built-in Android icons so the module works as is. Replace them with your own
  // monochrome notification icon before release.
  private val TRIP_ICON = android.R.drawable.ic_menu_mylocation
  private val ALARM_ICON = android.R.drawable.ic_lock_idle_alarm

  private fun ensureChannels(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(NotificationManager::class.java) ?: return
    manager.createNotificationChannel(
      NotificationChannel(TRIP_CHANNEL, "Trip in progress", NotificationManager.IMPORTANCE_LOW).apply {
        description = "Shown while a trip is being tracked."
      },
    )
    manager.createNotificationChannel(
      NotificationChannel(ALARM_CHANNEL, "Stop alarm", NotificationManager.IMPORTANCE_HIGH).apply {
        description = "Wakes you before your stop."
        enableVibration(true)
        vibrationPattern = ALARM_PATTERN
      },
    )
    manager.createNotificationChannel(
      NotificationChannel(NOTICE_CHANNEL, "Trip updates", NotificationManager.IMPORTANCE_DEFAULT).apply {
        description = "Tells you when a trip ends by itself."
      },
    )
  }

  private fun openApp(context: Context): PendingIntent? {
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
    return PendingIntent.getActivity(context, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  fun trip(context: Context, title: String, text: String): Notification {
    ensureChannels(context)
    return NotificationCompat.Builder(context, TRIP_CHANNEL)
      .setSmallIcon(TRIP_ICON)
      .setContentTitle(title)
      .setContentText(text)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setCategory(NotificationCompat.CATEGORY_NAVIGATION)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
      .setContentIntent(openApp(context))
      .build()
  }

  @SuppressLint("MissingPermission")
  fun updateTrip(context: Context, title: String, text: String) {
    if (!TripLocationService.running || !canNotify(context)) return
    NotificationManagerCompat.from(context).notify(TRIP_ID, trip(context, title, text))
  }

  @SuppressLint("MissingPermission")
  fun show(context: Context, title: String, text: String, loud: Boolean): Boolean {
    if (!canNotify(context)) return false
    ensureChannels(context)
    val builder = NotificationCompat.Builder(context, if (loud) ALARM_CHANNEL else NOTICE_CHANNEL)
      .setSmallIcon(if (loud) ALARM_ICON else TRIP_ICON)
      .setContentTitle(title)
      .setContentText(text)
      .setPriority(if (loud) NotificationCompat.PRIORITY_HIGH else NotificationCompat.PRIORITY_DEFAULT)
      .setCategory(if (loud) NotificationCompat.CATEGORY_ALARM else NotificationCompat.CATEGORY_STATUS)
      .setAutoCancel(true)
      .setContentIntent(openApp(context))
    if (loud) builder.setVibrate(ALARM_PATTERN)
    NotificationManagerCompat.from(context).notify(nextId++, builder.build())
    return true
  }

  private fun canNotify(context: Context): Boolean =
    Build.VERSION.SDK_INT < 33 ||
      ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
}
