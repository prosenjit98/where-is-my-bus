// Data model for the bus network. Kept close to GTFS ideas (stops, routes, patterns)
// so it can be exported to GTFS later, but simple enough to edit by hand in the admin panel.

export type LatLng = { lat: number; lng: number };

/** "HH:MM" in Indian Standard Time, 24-hour clock. */
export type ClockTime = string;

export type Stop = {
  id: string;
  name: string;
  /** Name in Bengali script, shown under the English name and searchable. */
  nameBn?: string;
  /** Other spellings and local names people type: "Dharmatala", "Dhakuriya", "8B". */
  aliases?: string[];
  lat: number;
  lng: number;
};

/** Hospitals, colleges, malls: places people search for that are not bus stops. */
export type Landmark = {
  id: string;
  name: string;
  nameBn?: string;
  aliases?: string[];
  lat: number;
  lng: number;
};

export type OperatorType = 'private' | 'govt' | 'mini' | 'other';

/**
 * How the route runs. Buses are tracked and shared; the Metro, local trains and ferries are
 * planned from their timetable frequencies, so journeys can combine them with buses.
 */
export type TransitMode = 'bus' | 'metro' | 'train' | 'ferry';

/** A Metro line's or a ferry service's own colour, shown on its board instead of the bus stripe. */
export type LineColor = 'blue' | 'green' | 'purple' | 'orange' | 'pink' | 'yellow' | 'red' | 'teal';

export type HeadwayBand = { from: ClockTime; to: ClockTime; minutes: number };

export type TimeWindow = { from: ClockTime; to: ClockTime };

/**
 * One way a route runs: a direction, or a variant of a direction.
 * Variants cover Kolkata specifics such as roads whose one-way direction
 * flips at 1 pm, and temporary diversions (Durga Puja, bridge repairs).
 */
export type Pattern = {
  id: string;
  direction: 'UP' | 'DOWN';
  /** Where the bus is heading, shown to riders: "Garia". */
  headsign: string;
  stopIds: string[];
  /** Road path as [lat, lng] pairs. Without it, straight lines between stops are used (rough). */
  shape?: [number, number][];
  /** Runs only inside these daily windows. Empty or missing means all day. */
  activeWindows?: TimeWindow[];
  /** Temporary pattern: only valid between these dates (YYYY-MM-DD, inclusive). */
  validFrom?: string;
  validTo?: string;
  /** While this temporary pattern is valid, the pattern with this id is switched off. */
  replaces?: string;
};

export type Route = {
  id: string;
  /** Number painted on the bus: "12C/2", "S-9", "AC-37". */
  number: string;
  name?: string;
  operator: OperatorType;
  /** Buses when missing. */
  mode?: TransitMode;
  color?: LineColor;
  firstBus: ClockTime;
  lastBus: ClockTime;
  /** Usual minutes between buses. */
  defaultHeadwayMin: number;
  /** Busy-hour or quiet-hour frequencies that override the default. */
  headways?: HeadwayBand[];
  patterns: Pattern[];
};

/** Credit a data source's licence requires, shown wherever its data is: "© OpenStreetMap contributors, ODbL". */
export type Attribution = { text: string; url?: string };

export type Network = {
  version: number;
  updatedAt: string;
  region: string;
  notice?: string;
  /** Credits for where the stops, routes and times came from, as their licences require. */
  attribution?: Attribution[];
  stops: Stop[];
  landmarks?: Landmark[];
  routes: Route[];
};
