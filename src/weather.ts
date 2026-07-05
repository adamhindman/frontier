export type WeatherType = 'clear' | 'overcast' | 'rain' | 'thunderstorm' | 'blizzard' | 'fog';

export interface WeatherEvent {
  type: WeatherType;
  intensity: 1 | 2 | 3;
  durationHours: number;
  startDays: number;
}

export interface WeatherEffects {
  moveMult: number;
  warmthDrainMult: number;
  forageMult: number;
  moraleDrainPerDay: number;
  surveyVisibilityMult: number;
}

function mulberry32(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WEATHER_TYPES: WeatherType[] = ['clear', 'overcast', 'rain', 'thunderstorm', 'blizzard', 'fog'];

// Transition matrices per season — each row sums to 1.
// Order: clear, overcast, rain, thunderstorm, blizzard, fog
type TransitionTable = Record<WeatherType, number[]>;

const TRANSITIONS_SPRING: TransitionTable = {
  clear:        [0.35, 0.30, 0.18, 0.03, 0.02, 0.12],
  overcast:     [0.18, 0.25, 0.28, 0.10, 0.04, 0.15],
  rain:         [0.10, 0.25, 0.30, 0.22, 0.05, 0.08],
  thunderstorm: [0.08, 0.22, 0.32, 0.18, 0.06, 0.14],
  blizzard:     [0.10, 0.20, 0.18, 0.06, 0.32, 0.14],
  fog:          [0.28, 0.35, 0.22, 0.05, 0.02, 0.08],
};

const TRANSITIONS_SUMMER: TransitionTable = {
  clear:        [0.50, 0.25, 0.08, 0.07, 0.00, 0.10],
  overcast:     [0.32, 0.25, 0.18, 0.16, 0.00, 0.09],
  rain:         [0.15, 0.22, 0.25, 0.32, 0.00, 0.06],
  thunderstorm: [0.14, 0.22, 0.28, 0.24, 0.00, 0.12],
  blizzard:     [0.25, 0.28, 0.22, 0.12, 0.08, 0.05], // resolveWeatherForTemp converts to rain
  fog:          [0.38, 0.32, 0.18, 0.07, 0.00, 0.05],
};

const TRANSITIONS_FALL: TransitionTable = {
  clear:        [0.28, 0.35, 0.14, 0.02, 0.05, 0.16],
  overcast:     [0.14, 0.28, 0.24, 0.07, 0.10, 0.17],
  rain:         [0.08, 0.22, 0.30, 0.18, 0.12, 0.10],
  thunderstorm: [0.07, 0.20, 0.30, 0.14, 0.14, 0.15],
  blizzard:     [0.04, 0.14, 0.14, 0.04, 0.52, 0.12],
  fog:          [0.20, 0.32, 0.24, 0.05, 0.08, 0.11],
};

const TRANSITIONS_WINTER: TransitionTable = {
  clear:        [0.22, 0.40, 0.06, 0.00, 0.20, 0.12],
  overcast:     [0.08, 0.26, 0.12, 0.02, 0.38, 0.14],
  rain:         [0.05, 0.18, 0.18, 0.04, 0.44, 0.11],
  thunderstorm: [0.04, 0.18, 0.20, 0.04, 0.42, 0.12],
  blizzard:     [0.02, 0.10, 0.08, 0.02, 0.66, 0.12],
  fog:          [0.18, 0.30, 0.14, 0.02, 0.24, 0.12],
};

const SEASON_TRANSITIONS = [
  TRANSITIONS_SPRING,
  TRANSITIONS_SUMMER,
  TRANSITIONS_FALL,
  TRANSITIONS_WINTER,
];

const DAYS_PER_MONTH  = 30;
const MONTHS_PER_SEASON = 3;
const DAYS_PER_SEASON = DAYS_PER_MONTH * MONTHS_PER_SEASON; // 90
const DAYS_PER_YEAR   = DAYS_PER_SEASON * 4;               // 360

function seasonIndex(daysTraveled: number): number {
  return Math.floor((daysTraveled % DAYS_PER_YEAR) / DAYS_PER_SEASON);
}

export function getSeasonLabel(daysTraveled: number): string {
  const SEASON_NAMES = ['Spring', 'Summer', 'Fall', 'Winter'];
  const PHASE_NAMES  = ['Early', 'Mid', 'Late'];
  const dayOfYear    = daysTraveled % DAYS_PER_YEAR;
  const monthOfYear  = Math.floor(dayOfYear / DAYS_PER_MONTH);
  const season       = Math.floor(monthOfYear / MONTHS_PER_SEASON);
  const phase        = monthOfYear % MONTHS_PER_SEASON;
  return `${PHASE_NAMES[phase]} ${SEASON_NAMES[season]}`;
}

function pickTransition(probs: number[], rand: number): WeatherType {
  let sum = 0;
  for (let i = 0; i < probs.length; i++) {
    sum += probs[i];
    if (rand < sum) return WEATHER_TYPES[i];
  }
  return WEATHER_TYPES[WEATHER_TYPES.length - 1];
}

export function weatherLabel(event: WeatherEvent): string {
  switch (event.type) {
    case 'clear':        return 'Clear';
    case 'overcast':     return 'Overcast';
    case 'rain':         return event.intensity === 1 ? 'Light Rain' : event.intensity === 2 ? 'Rain' : 'Heavy Rain';
    case 'thunderstorm': return event.intensity === 1 ? 'Light Storm' : event.intensity === 2 ? 'Storm' : 'Heavy Storm';
    case 'blizzard':     return event.intensity === 1 ? 'Light Blizzard' : event.intensity === 2 ? 'Blizzard' : 'Heavy Blizzard';
    case 'fog':          return event.intensity === 3 ? 'Dense Fog' : 'Fog';
  }
}

export function getWeatherEffects(event: WeatherEvent): WeatherEffects {
  const i = event.intensity;
  switch (event.type) {
    case 'clear':
      return { moveMult: 1.0, warmthDrainMult: 1.0, forageMult: 1.0, moraleDrainPerDay: 0,    surveyVisibilityMult: 1.00 };
    case 'overcast':
      return { moveMult: 1.0, warmthDrainMult: 1.0, forageMult: 0.95, moraleDrainPerDay: 1,   surveyVisibilityMult: 0.80 };
    case 'fog':
      return { moveMult: 1.0, warmthDrainMult: 1.0 + i * 0.05, forageMult: 0.9, moraleDrainPerDay: i * 2,
               surveyVisibilityMult: i === 1 ? 0.35 : i === 2 ? 0.18 : 0.08 };
    case 'rain':
      return { moveMult: 1.0, warmthDrainMult: 1.0 + i * 0.4, forageMult: 1.0 - i * 0.15, moraleDrainPerDay: i * 3,
               surveyVisibilityMult: 1.0 - i * 0.15 };
    case 'thunderstorm':
      return { moveMult: 1.0, warmthDrainMult: 1.0 + i * 0.5, forageMult: 1.0 - i * 0.15, moraleDrainPerDay: i * 5,
               surveyVisibilityMult: 1.0 - i * 0.20 };
    case 'blizzard':
      return {
        moveMult:             i === 1 ? 0.70 : i === 2 ? 0.50 : 0.30,
        warmthDrainMult:      i === 1 ? 1.80 : i === 2 ? 2.50 : 3.50,
        forageMult:           i === 1 ? 0.60 : i === 2 ? 0.40 : 0.25,
        moraleDrainPerDay:    i === 1 ? 8    : i === 2 ? 14   : 20,
        surveyVisibilityMult: i === 1 ? 0.50 : i === 2 ? 0.30 : 0.15,
      };
  }
}

// Blizzards require freezing temperatures; thunderstorms require warm unstable air.
// This resolves an abstract weather event to what the player actually experiences
// given their local ambient temperature, so a "blizzard" event in a tropical biome
// becomes heavy rain, and a "thunderstorm" in sub-freezing air becomes a blizzard.
export function resolveWeatherForTemp(event: WeatherEvent, ambientTempF: number): WeatherEvent {
  let { type, intensity } = event;

  if (type === 'blizzard' && ambientTempF >= 35) {
    // Too warm for snow — blizzard becomes rain
    type = 'rain';
  } else if (type === 'thunderstorm' && ambientTempF < 40) {
    // Thunderstorms need warm convective air; cold air turns them into snow/blizzard
    type = ambientTempF < 35 ? 'blizzard' : 'rain';
  } else if (type === 'rain' && ambientTempF < 32) {
    // Freezing temperatures turn rain into light snow
    type = 'blizzard';
    intensity = Math.min(intensity, 1) as 1;
  }

  return type === event.type && intensity === event.intensity ? event : { ...event, type, intensity };
}

export function createWeatherSystem(weatherSeed: number) {
  const rng = mulberry32(weatherSeed);
  const events: WeatherEvent[] = [];
  let generatedUpToDays = 0;
  let lastType: WeatherType = 'clear';

  function generateNext() {
    const transitions = SEASON_TRANSITIONS[seasonIndex(generatedUpToDays)];
    const type: WeatherType = events.length === 0
      ? 'clear'
      : pickTransition(transitions[lastType], rng());
    const r = rng();
    const intensity: 1 | 2 | 3 = r < 0.55 ? 1 : r < 0.85 ? 2 : 3;
    const durationHours = 4 + Math.floor(rng() * 13);
    events.push({ type, intensity, durationHours, startDays: generatedUpToDays });
    generatedUpToDays += durationHours / 24;
    lastType = type;
  }

  function ensureCoverage(throughDays: number) {
    while (generatedUpToDays < throughDays + 2) generateNext();
  }

  function getCurrentEvent(daysTraveled: number): WeatherEvent {
    ensureCoverage(daysTraveled);
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].startDays <= daysTraveled) return events[i];
    }
    return events[0];
  }

  function getForecast(daysTraveled: number, count: number): WeatherEvent[] {
    ensureCoverage(daysTraveled + count * (16 / 24) + 2);
    const result: WeatherEvent[] = [];
    for (const ev of events) {
      if (ev.startDays > daysTraveled && result.length < count) result.push(ev);
    }
    return result;
  }

  return { getCurrentEvent, getForecast };
}
