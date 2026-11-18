import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { Button, Note, Screen } from '../components/ui';
import { nearestStops } from '../core';
import { formatDistance } from '../format';
import { nameOf, tr } from '../i18n';
import { addRecent } from '../services/recents';
import { useApp, type Field, type Place } from '../state/AppState';
import { font, usePalette } from '../theme';

// For people who keep location off: tap the place instead.
export function MapPickScreen({ field }: { field: Field }) {
  const app = useApp();
  const c = usePalette();
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const net = app.net;
  const near = useMemo(() => (net && pin ? nearestStops(net, pin, 3) : []), [net, pin]);
  const center = net?.center ?? { lat: 22.5726, lng: 88.3639 };

  const choose = (p: Place) => {
    app.setPlace(field, p);
    void addRecent(p);
    app.reset();
  };

  return (
    <Screen
      title={tr('Pick on the map')}
      onBack={app.pop}
      footer={
        pin ? (
          <View style={styles.footer}>
            <Text style={[font('semibold'), { color: c.ink, fontSize: 15 }]}>{tr('Nearest stops')}</Text>
            <View style={styles.chips}>
              {near.map((n) => (
                <Pressable
                  key={n.stop.id}
                  accessibilityRole="button"
                  onPress={() => choose({ kind: 'stop', stopId: n.stop.id, name: n.stop.name })}
                  style={[styles.chip, { borderColor: c.line, backgroundColor: c.surface }, c.shadow1]}
                >
                  <Text style={[font('semibold'), { color: c.ink }]}>{nameOf(n.stop)}</Text>
                  <Text style={[font(), { color: c.inkSoft, fontSize: 12 }]}>{formatDistance(n.distM)}</Text>
                </Pressable>
              ))}
            </View>
            <Button label={tr('Use this spot')} icon="map-pin" onPress={() => choose({ kind: 'point', lat: pin.lat, lng: pin.lng, name: 'Pinned place' })} />
          </View>
        ) : (
          <Note>{tr('Tap the map where you are or where you are going.')}</Note>
        )
      }
    >
      <MapView
        style={styles.map}
        toolbarEnabled={false}
        initialRegion={{ latitude: center.lat, longitude: center.lng, latitudeDelta: 0.12, longitudeDelta: 0.12 }}
        onPress={(e) => {
          const { latitude, longitude } = e.nativeEvent.coordinate;
          setPin({ lat: latitude, lng: longitude });
        }}
      >
        {pin ? <Marker coordinate={{ latitude: pin.lat, longitude: pin.lng }} title={tr('Pinned place')} /> : null}
        {near.map((n) => (
          <Marker key={n.stop.id} coordinate={{ latitude: n.stop.lat, longitude: n.stop.lng }} pinColor={c.blue} title={nameOf(n.stop)} />
        ))}
      </MapView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  map: { flex: 1 },
  footer: { gap: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 13, paddingVertical: 9 },
});
