#import <CoreLocation/CoreLocation.h>
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

// Location for Where Is My Bus on iOS: permission and accuracy status, one-off fixes,
// trip tracking that keeps running with the screen locked, and stop-alarm notifications.
@interface WimbLocation : RCTEventEmitter <RCTBridgeModule, CLLocationManagerDelegate>
@end
