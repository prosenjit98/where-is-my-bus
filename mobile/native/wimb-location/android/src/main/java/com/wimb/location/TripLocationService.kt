package com.wimb.location

import android.annotation.SuppressLint
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.Looper
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority

/**
 * Keeps trip tracking going with the screen off. A foreground service of type "location"
 * started from a button tap counts as while-in-use access, so the app never asks for
 * ACCESS_BACKGROUND_LOCATION. It stops when the app is swiped away.
 */
class TripLocationService : Service() {
  private var client: FusedLocationProviderClient? = null

  private val callback = object : LocationCallback() {
    override fun onLocationResult(result: LocationResult) {
      for (location in result.locations) WimbLocationModule.deliverLocation(location)
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  @SuppressLint("MissingPermission")
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val title = intent?.getStringExtra(EXTRA_TITLE) ?: "Sharing bus location"
    val text = intent?.getStringExtra(EXTRA_TEXT) ?: ""
    val intervalMs = intent?.getLongExtra(EXTRA_INTERVAL_MS, 10_000L) ?: 10_000L
    val minDistanceM = intent?.getFloatExtra(EXTRA_MIN_DISTANCE_M, 20f) ?: 20f

    val notification = TripNotifications.trip(this, title, text)
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        startForeground(TripNotifications.TRIP_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
      } else {
        startForeground(TripNotifications.TRIP_ID, notification)
      }
    } catch (e: Exception) {
      WimbLocationModule.deliverError(e.message ?: "Trip tracking could not start.")
      stopSelf()
      return START_NOT_STICKY
    }

    val fused = client ?: LocationServices.getFusedLocationProviderClient(this).also { client = it }
    fused.removeLocationUpdates(callback)
    val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, intervalMs)
      .setMinUpdateIntervalMillis(intervalMs / 2)
      .setMinUpdateDistanceMeters(minDistanceM)
      .build()
    try {
      fused.requestLocationUpdates(request, callback, Looper.getMainLooper())
      running = true
    } catch (e: SecurityException) {
      WimbLocationModule.deliverError("Location permission was turned off.")
      stopSelf()
    }
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    client?.removeLocationUpdates(callback)
    running = false
    stopForeground(STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }

  companion object {
    const val EXTRA_TITLE = "title"
    const val EXTRA_TEXT = "text"
    const val EXTRA_INTERVAL_MS = "intervalMs"
    const val EXTRA_MIN_DISTANCE_M = "minDistanceM"

    @Volatile
    var running = false
      private set
  }
}
