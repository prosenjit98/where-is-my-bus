#import "WimbLocation.h"
#import <AudioToolbox/AudioToolbox.h>
#import <UIKit/UIKit.h>
#import <UserNotifications/UserNotifications.h>

static NSString *const kLocationEvent = @"WimbLocation:location";
static NSString *const kErrorEvent = @"WimbLocation:error";
static NSString *const kPurposeKey = @"TripTracking";

static NSString *AuthorizationName(CLAuthorizationStatus status)
{
  switch (status) {
    case kCLAuthorizationStatusRestricted: return @"restricted";
    case kCLAuthorizationStatusDenied: return @"denied";
    case kCLAuthorizationStatusAuthorizedAlways: return @"always";
    case kCLAuthorizationStatusAuthorizedWhenInUse: return @"whenInUse";
    default: return @"notDetermined";
  }
}

@implementation WimbLocation {
  CLLocationManager *_oneShot;
  CLLocationManager *_trip;
  NSMutableArray<RCTPromiseResolveBlock> *_fixWaiters;
  NSMutableArray<RCTPromiseResolveBlock> *_authWaiters;
  BOOL _tripRunning;
  BOOL _hasListeners;
}

RCT_EXPORT_MODULE(WimbLocation)

+ (BOOL)requiresMainQueueSetup
{
  return YES;
}

// CLLocationManager needs a thread with a run loop; the main queue has one.
- (dispatch_queue_t)methodQueue
{
  return dispatch_get_main_queue();
}

- (instancetype)init
{
  if ((self = [super init])) {
    _fixWaiters = [NSMutableArray new];
    _authWaiters = [NSMutableArray new];
  }
  return self;
}

- (NSArray<NSString *> *)supportedEvents
{
  return @[ kLocationEvent, kErrorEvent ];
}

- (void)startObserving
{
  _hasListeners = YES;
}

- (void)stopObserving
{
  _hasListeners = NO;
}

- (CLLocationManager *)oneShot
{
  if (!_oneShot) {
    _oneShot = [CLLocationManager new];
    _oneShot.delegate = self;
    _oneShot.desiredAccuracy = kCLLocationAccuracyNearestTenMeters;
  }
  return _oneShot;
}

- (BOOL)isAuthorized
{
  CLAuthorizationStatus s = [self oneShot].authorizationStatus;
  return s == kCLAuthorizationStatusAuthorizedWhenInUse || s == kCLAuthorizationStatusAuthorizedAlways;
}

- (NSDictionary *)statusWithServices:(BOOL)servicesEnabled
{
  CLLocationManager *m = [self oneShot];
  return @{
    @"servicesEnabled" : @(servicesEnabled),
    @"authorization" : AuthorizationName(m.authorizationStatus),
    @"precise" : @(m.accuracyAuthorization == CLAccuracyAuthorizationFullAccuracy),
  };
}

RCT_EXPORT_METHOD(getStatus : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject)
{
  // locationServicesEnabled can block, so it is asked off the main thread.
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    BOOL enabled = [CLLocationManager locationServicesEnabled];
    dispatch_async(dispatch_get_main_queue(), ^{
      resolve([self statusWithServices:enabled]);
    });
  });
}

RCT_EXPORT_METHOD(requestPermission : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject)
{
  CLLocationManager *m = [self oneShot];
  if (m.authorizationStatus != kCLAuthorizationStatusNotDetermined) {
    [self getStatus:resolve reject:reject];
    return;
  }
  [_authWaiters addObject:resolve];
  [m requestWhenInUseAuthorization];
}

// For someone who chose approximate location: asks for precise location for this session only.
RCT_EXPORT_METHOD(requestTemporaryPrecise : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject)
{
  CLLocationManager *m = [self oneShot];
  NSDictionary *purposes = [[NSBundle mainBundle] objectForInfoDictionaryKey:@"NSLocationTemporaryUsageDescriptionDictionary"];
  BOOL hasPurpose = [purposes isKindOfClass:[NSDictionary class]] && purposes[kPurposeKey] != nil;
  if (![self isAuthorized] || m.accuracyAuthorization == CLAccuracyAuthorizationFullAccuracy || !hasPurpose) {
    [self getStatus:resolve reject:reject];
    return;
  }
  [m requestTemporaryFullAccuracyAuthorizationWithPurposeKey:kPurposeKey
                                                  completion:^(NSError *_Nullable error) {
                                                    dispatch_async(dispatch_get_main_queue(), ^{
                                                      [self getStatus:resolve reject:reject];
                                                    });
                                                  }];
}

- (void)locationManagerDidChangeAuthorization:(CLLocationManager *)manager
{
  if (manager != _oneShot || manager.authorizationStatus == kCLAuthorizationStatusNotDetermined || _authWaiters.count == 0) {
    return;
  }
  NSArray<RCTPromiseResolveBlock> *waiting = [_authWaiters copy];
  [_authWaiters removeAllObjects];
  // The user just answered the prompt, so Location Services are on.
  NSDictionary *status = [self statusWithServices:YES];
  for (RCTPromiseResolveBlock resolve in waiting) {
    resolve(status);
  }
}

RCT_EXPORT_METHOD(getCurrentPosition : (BOOL)highAccuracy resolve : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject)
{
  if (![self isAuthorized]) {
    resolve([NSNull null]);
    return;
  }
  CLLocationManager *m = [self oneShot];
  m.desiredAccuracy = highAccuracy ? kCLLocationAccuracyNearestTenMeters : kCLLocationAccuracyHundredMeters;
  [_fixWaiters addObject:resolve];
  [m requestLocation];
}

RCT_EXPORT_METHOD(startTrip : (NSDictionary *)options resolve : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject)
{
  if (![self isAuthorized]) {
    reject(@"no_permission", @"Location permission is needed to track the trip.", nil);
    return;
  }
  if (!_trip) {
    _trip = [CLLocationManager new];
    _trip.delegate = self;
  }
  NSNumber *minDistance = options[@"minDistanceM"];
  _trip.desiredAccuracy = kCLLocationAccuracyBest;
  _trip.distanceFilter = [minDistance isKindOfClass:[NSNumber class]] ? minDistance.doubleValue : 20;
  _trip.activityType = CLActivityTypeAutomotiveNavigation;
  _trip.pausesLocationUpdatesAutomatically = NO;
  // Keeps tracking with the screen locked. Needs "location" in UIBackgroundModes;
  // without it, setting this would crash, so it is checked first.
  NSArray *modes = [[NSBundle mainBundle] objectForInfoDictionaryKey:@"UIBackgroundModes"];
  if ([modes isKindOfClass:[NSArray class]] && [modes containsObject:@"location"]) {
    _trip.allowsBackgroundLocationUpdates = YES;
    _trip.showsBackgroundLocationIndicator = YES;
  }
  [_trip startUpdatingLocation];
  _tripRunning = YES;
  resolve(@YES);
}

RCT_EXPORT_METHOD(stopTrip : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject)
{
  [_trip stopUpdatingLocation];
  _trip.allowsBackgroundLocationUpdates = NO;
  _tripRunning = NO;
  resolve(@YES);
}

RCT_EXPORT_METHOD(isTripRunning : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject)
{
  resolve(@(_tripRunning));
}

// iOS shows its own location indicator instead of an app notification.
RCT_EXPORT_METHOD(updateTripNotification : (NSString *)title text : (NSString *)text resolve : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject)
{
  resolve(@YES);
}

RCT_EXPORT_METHOD(requestNotificationPermission : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject)
{
  UNAuthorizationOptions options = UNAuthorizationOptionAlert | UNAuthorizationOptionSound;
  [[UNUserNotificationCenter currentNotificationCenter] requestAuthorizationWithOptions:options
                                                                      completionHandler:^(BOOL granted, NSError *_Nullable error) {
                                                                        resolve(@(granted));
                                                                      }];
}

RCT_EXPORT_METHOD(notify : (NSString *)title text : (NSString *)text loud : (BOOL)loud resolve : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject)
{
  UNMutableNotificationContent *content = [UNMutableNotificationContent new];
  content.title = title;
  content.body = text;
  content.sound = [UNNotificationSound defaultSound];
  UNNotificationRequest *request = [UNNotificationRequest requestWithIdentifier:[[NSUUID UUID] UUIDString] content:content trigger:nil];
  [[UNUserNotificationCenter currentNotificationCenter] addNotificationRequest:request
                                                         withCompletionHandler:^(NSError *_Nullable error) {
                                                           resolve(@(error == nil));
                                                         }];
  if (loud) {
    AudioServicesPlaySystemSound(kSystemSoundID_Vibrate);
  }
}

// iOS cannot open the Location Services switch directly; this opens the app's settings.
RCT_EXPORT_METHOD(openLocationSettings : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject)
{
  NSURL *url = [NSURL URLWithString:UIApplicationOpenSettingsURLString];
  [[UIApplication sharedApplication] openURL:url
                                     options:@{}
                           completionHandler:^(BOOL success) {
                             resolve(@(success));
                           }];
}

- (NSDictionary *)toDictionary:(CLLocation *)location
{
  NSMutableDictionary *d = [@{
    @"lat" : @(location.coordinate.latitude),
    @"lng" : @(location.coordinate.longitude),
    @"accuracy" : @(location.horizontalAccuracy),
    @"ts" : @([location.timestamp timeIntervalSince1970] * 1000.0),
  } mutableCopy];
  if (location.speed >= 0) d[@"speed"] = @(location.speed);
  if (location.course >= 0) d[@"heading"] = @(location.course);
  if (@available(iOS 15.0, *)) {
    d[@"mock"] = @(location.sourceInformation.isSimulatedBySoftware);
  }
  return d;
}

- (void)locationManager:(CLLocationManager *)manager didUpdateLocations:(NSArray<CLLocation *> *)locations
{
  if (manager == _oneShot) {
    CLLocation *last = locations.lastObject;
    NSArray<RCTPromiseResolveBlock> *waiting = [_fixWaiters copy];
    [_fixWaiters removeAllObjects];
    for (RCTPromiseResolveBlock resolve in waiting) {
      resolve(last ? [self toDictionary:last] : [NSNull null]);
    }
    return;
  }
  if (manager == _trip && _hasListeners) {
    for (CLLocation *location in locations) {
      [self sendEventWithName:kLocationEvent body:[self toDictionary:location]];
    }
  }
}

- (void)locationManager:(CLLocationManager *)manager didFailWithError:(NSError *)error
{
  if (manager == _oneShot) {
    NSArray<RCTPromiseResolveBlock> *waiting = [_fixWaiters copy];
    [_fixWaiters removeAllObjects];
    for (RCTPromiseResolveBlock resolve in waiting) {
      resolve([NSNull null]);
    }
    return;
  }
  // "Location unknown" is temporary (for example in a tunnel); keep tracking.
  if (manager == _trip && _hasListeners && error.code != kCLErrorLocationUnknown) {
    [self sendEventWithName:kErrorEvent body:@{ @"message" : error.localizedDescription ?: @"Location stopped." }];
  }
}

@end
