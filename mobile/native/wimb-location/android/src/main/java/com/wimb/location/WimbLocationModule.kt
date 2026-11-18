package com.wimb.location

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import android.os.Build
import android.os.SystemClock
import android.provider.Settings
import androidx.core.content.ContextCompat
import androidx.core.location.LocationManagerCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.google.android.gms.common.api.ResolvableApiException
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.LocationSettingsRequest
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource

/**
 * Location for Where Is My Bus: status, one-off fixes, trip tracking in a foreground
 * service, and stop-alarm notifications. Permissions are requested from JavaScript with
 * PermissionsAndroid. Cell-tower data is not read directly: Android only gives it with
 * the same permission as GPS, and the fused provider already uses towers and Wi-Fi.
 */
class WimbLocationModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {

  init {
    current = this
  }

  override fun getName(): String = NAME

  override fun invalidate() {
    if (current === this) current = null
    super.invalidate()
  }

  private fun granted(permission: String) =
    ContextCompat.checkSelfPermission(ctx, permission) == PackageManager.PERMISSION_GRANTED

  private fun status(): WritableMap {
    val manager = ctx.getSystemService(Context.LOCATION_SERVICE) as LocationManager
    val fine = granted(Manifest.permission.ACCESS_FINE_LOCATION)
    val any = fine || granted(Manifest.permission.ACCESS_COARSE_LOCATION)
    return Arguments.createMap().apply {
      putBoolean("servicesEnabled", LocationManagerCompat.isLocationEnabled(manager))
      putString("authorization", if (any) "whenInUse" else "notDetermined")
      putBoolean("precise", fine)
    }
  }

  @ReactMethod
  fun getStatus(promise: Promise) {
    promise.resolve(status())
  }

  // On Android these are asked from JavaScript; the methods keep the API the same as iOS.
  @ReactMethod
  fun requestPermission(promise: Promise) {
    promise.resolve(status())
  }

  @ReactMethod
  fun requestTemporaryPrecise(promise: Promise) {
    promise.resolve(status())
  }

  @ReactMethod
  fun requestNotificationPermission(promise: Promise) {
    promise.resolve(true)
  }

  @SuppressLint("MissingPermission")
  @ReactMethod
  fun getCurrentPosition(highAccuracy: Boolean, promise: Promise) {
    val fine = granted(Manifest.permission.ACCESS_FINE_LOCATION)
    if (!fine && !granted(Manifest.permission.ACCESS_COARSE_LOCATION)) {
      promise.resolve(null)
      return
    }
    val client = LocationServices.getFusedLocationProviderClient(ctx)
    val priority = if (highAccuracy && fine) Priority.PRIORITY_HIGH_ACCURACY else Priority.PRIORITY_BALANCED_POWER_ACCURACY
    client.getCurrentLocation(priority, CancellationTokenSource().token)
      .addOnSuccessListener { location: Location? ->
        if (location != null) {
          promise.resolve(toMap(location))
        } else {
          client.lastLocation
            .addOnSuccessListener { last: Location? -> promise.resolve(last?.let { toMap(it) }) }
            .addOnFailureListener { promise.resolve(null) }
        }
      }
      .addOnFailureListener { promise.resolve(null) }
  }

  @ReactMethod
  fun startTrip(options: ReadableMap, promise: Promise) {
    if (!granted(Manifest.permission.ACCESS_FINE_LOCATION) && !granted(Manifest.permission.ACCESS_COARSE_LOCATION)) {
      promise.reject("no_permission", "Location permission is needed to track the trip.")
      return
    }
    val intent = Intent(ctx, TripLocationService::class.java).apply {
      putExtra(TripLocationService.EXTRA_TITLE, options.stringOr("title", "Sharing bus location"))
      putExtra(TripLocationService.EXTRA_TEXT, options.stringOr("text", ""))
      putExtra(TripLocationService.EXTRA_INTERVAL_MS, options.numberOr("intervalMs", 10_000.0).toLong())
      putExtra(TripLocationService.EXTRA_MIN_DISTANCE_M, options.numberOr("minDistanceM", 20.0).toFloat())
    }
    try {
      // Started while the app is on screen, so it counts as while-in-use location access.
      ContextCompat.startForegroundService(ctx, intent)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("start_failed", e.message ?: "Trip tracking could not start.", e)
    }
  }

  @ReactMethod
  fun stopTrip(promise: Promise) {
    ctx.stopService(Intent(ctx, TripLocationService::class.java))
    promise.resolve(true)
  }

  @ReactMethod
  fun isTripRunning(promise: Promise) {
    promise.resolve(TripLocationService.running)
  }

  @ReactMethod
  fun updateTripNotification(title: String, text: String, promise: Promise) {
    TripNotifications.updateTrip(ctx, title, text)
    promise.resolve(true)
  }

  @ReactMethod
  fun notify(title: String, text: String, loud: Boolean, promise: Promise) {
    promise.resolve(TripNotifications.show(ctx, title, text, loud))
  }

  /** Google's "turn on location" dialog when available, otherwise the system settings screen. */
  @ReactMethod
  fun openLocationSettings(promise: Promise) {
    val activity = ctx.currentActivity
    val request = LocationSettingsRequest.Builder()
      .addLocationRequest(LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 10_000L).build())
      .build()
    LocationServices.getSettingsClient(ctx).checkLocationSettings(request)
      .addOnSuccessListener { promise.resolve(true) }
      .addOnFailureListener { error ->
        if (error is ResolvableApiException && activity != null) {
          try {
            error.startResolutionForResult(activity, RESOLVE_REQUEST_CODE)
            promise.resolve(true)
            return@addOnFailureListener
          } catch (e: Exception) {
            // Fall back to the settings screen below.
          }
        }
        try {
          ctx.startActivity(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
          promise.resolve(true)
        } catch (e: Exception) {
          promise.resolve(false)
        }
      }
  }

  // Required by NativeEventEmitter.
  @ReactMethod
  fun addListener(eventName: String) {
  }

  @ReactMethod
  fun removeListeners(count: Double) {
  }

  private fun emit(event: String, payload: WritableMap) {
    if (!ctx.hasActiveReactInstance()) return
    ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(event, payload)
  }

  companion object {
    const val NAME = "WimbLocation"
    private const val RESOLVE_REQUEST_CODE = 4911

    @Volatile
    private var current: WimbLocationModule? = null

    fun deliverLocation(location: Location) {
      current?.emit("WimbLocation:location", toMap(location))
    }

    fun deliverError(message: String) {
      current?.emit("WimbLocation:error", Arguments.createMap().apply { putString("message", message) })
    }

    fun toMap(location: Location): WritableMap = Arguments.createMap().apply {
      putDouble("lat", location.latitude)
      putDouble("lng", location.longitude)
      if (location.hasAccuracy()) putDouble("accuracy", location.accuracy.toDouble())
      if (location.hasSpeed()) putDouble("speed", location.speed.toDouble())
      if (location.hasBearing()) putDouble("heading", location.bearing.toDouble())
      // The fix time on the phone's own clock, the one Date.now() uses in JavaScript, so the
      // server can correct a phone whose clock is wrong. location.time may be satellite time.
      val ageMs = (SystemClock.elapsedRealtimeNanos() - location.elapsedRealtimeNanos) / 1_000_000
      putDouble("ts", (System.currentTimeMillis() - ageMs).toDouble())
      putBoolean("mock", isMock(location))
    }

    @Suppress("DEPRECATION")
    private fun isMock(location: Location): Boolean =
      if (Build.VERSION.SDK_INT >= 31) location.isMock else location.isFromMockProvider
  }
}

private fun ReadableMap.stringOr(key: String, fallback: String): String =
  if (hasKey(key) && !isNull(key)) getString(key) ?: fallback else fallback

private fun ReadableMap.numberOr(key: String, fallback: Double): Double =
  if (hasKey(key) && !isNull(key)) getDouble(key) else fallback
