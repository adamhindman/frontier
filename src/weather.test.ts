import { describe, it, expect } from 'vitest';
import {
  getSeasonLabel,
  weatherLabel,
  getWeatherEffects,
  resolveWeatherForTemp,
  createWeatherSystem,
  type WeatherEvent,
} from './weather';

function ev(type: WeatherEvent['type'], intensity: 1 | 2 | 3 = 1): WeatherEvent {
  return { type, intensity, durationHours: 8, startDays: 0 };
}

describe('getSeasonLabel', () => {
  it('labels day 0 as Early Spring', () => {
    expect(getSeasonLabel(0)).toBe('Early Spring');
  });

  it('labels the last day of a month phase before rollover', () => {
    expect(getSeasonLabel(29)).toBe('Early Spring');
    expect(getSeasonLabel(30)).toBe('Mid Spring');
  });

  it('rolls over from Late Spring into Summer at day 90', () => {
    expect(getSeasonLabel(89)).toBe('Late Spring');
    expect(getSeasonLabel(90)).toBe('Early Summer');
  });

  it('wraps the year at day 360', () => {
    expect(getSeasonLabel(359)).toBe('Late Winter');
    expect(getSeasonLabel(360)).toBe('Early Spring');
  });

  it('covers all four seasons across a year', () => {
    expect(getSeasonLabel(90)).toBe('Early Summer');
    expect(getSeasonLabel(180)).toBe('Early Fall');
    expect(getSeasonLabel(270)).toBe('Early Winter');
  });
});

describe('weatherLabel', () => {
  it('labels clear and overcast without intensity variation', () => {
    expect(weatherLabel(ev('clear', 1))).toBe('Clear');
    expect(weatherLabel(ev('overcast', 3))).toBe('Overcast');
  });

  it('labels rain by intensity', () => {
    expect(weatherLabel(ev('rain', 1))).toBe('Light Rain');
    expect(weatherLabel(ev('rain', 2))).toBe('Rain');
    expect(weatherLabel(ev('rain', 3))).toBe('Heavy Rain');
  });

  it('labels thunderstorm by intensity', () => {
    expect(weatherLabel(ev('thunderstorm', 1))).toBe('Light Storm');
    expect(weatherLabel(ev('thunderstorm', 2))).toBe('Storm');
    expect(weatherLabel(ev('thunderstorm', 3))).toBe('Heavy Storm');
  });

  it('labels blizzard by intensity', () => {
    expect(weatherLabel(ev('blizzard', 1))).toBe('Light Blizzard');
    expect(weatherLabel(ev('blizzard', 2))).toBe('Blizzard');
    expect(weatherLabel(ev('blizzard', 3))).toBe('Heavy Blizzard');
  });

  it('labels fog as Dense Fog only at intensity 3', () => {
    expect(weatherLabel(ev('fog', 1))).toBe('Fog');
    expect(weatherLabel(ev('fog', 2))).toBe('Fog');
    expect(weatherLabel(ev('fog', 3))).toBe('Dense Fog');
  });
});

describe('getWeatherEffects', () => {
  it('clear has no penalties', () => {
    const e = getWeatherEffects(ev('clear'));
    expect(e).toEqual({ moveMult: 1.0, warmthDrainMult: 1.0, forageMult: 1.0, moraleDrainPerDay: 0, surveyVisibilityMult: 1.0 });
  });

  it('blizzard effects scale exactly with intensity', () => {
    expect(getWeatherEffects(ev('blizzard', 1))).toEqual({
      moveMult: 0.70, warmthDrainMult: 1.80, forageMult: 0.60, moraleDrainPerDay: 8, surveyVisibilityMult: 0.50,
    });
    expect(getWeatherEffects(ev('blizzard', 2))).toEqual({
      moveMult: 0.50, warmthDrainMult: 2.50, forageMult: 0.40, moraleDrainPerDay: 14, surveyVisibilityMult: 0.30,
    });
    expect(getWeatherEffects(ev('blizzard', 3))).toEqual({
      moveMult: 0.30, warmthDrainMult: 3.50, forageMult: 0.25, moraleDrainPerDay: 20, surveyVisibilityMult: 0.15,
    });
  });

  it('fog visibility drops sharply with intensity', () => {
    expect(getWeatherEffects(ev('fog', 1)).surveyVisibilityMult).toBeCloseTo(0.10);
    expect(getWeatherEffects(ev('fog', 2)).surveyVisibilityMult).toBeCloseTo(0.05);
    expect(getWeatherEffects(ev('fog', 3)).surveyVisibilityMult).toBeCloseTo(0.02);
  });

  it('thunderstorm has the highest morale drain of the storm types at matching intensity', () => {
    const rain = getWeatherEffects(ev('rain', 2));
    const storm = getWeatherEffects(ev('thunderstorm', 2));
    expect(storm.moraleDrainPerDay).toBeGreaterThan(rain.moraleDrainPerDay);
  });
});

describe('resolveWeatherForTemp', () => {
  it('leaves clear weather untouched and returns the same reference', () => {
    const e = ev('clear');
    expect(resolveWeatherForTemp(e, 10)).toBe(e);
  });

  it('converts blizzard to rain at exactly 35F and above, keeps blizzard just below', () => {
    const e = ev('blizzard', 2);
    expect(resolveWeatherForTemp(e, 34.9).type).toBe('blizzard');
    expect(resolveWeatherForTemp(e, 35).type).toBe('rain');
    expect(resolveWeatherForTemp(e, 35).intensity).toBe(2);
  });

  it('converts thunderstorm to blizzard below 35F and to rain between 35 and 40F', () => {
    const e = ev('thunderstorm', 2);
    expect(resolveWeatherForTemp(e, 34.9).type).toBe('blizzard');
    expect(resolveWeatherForTemp(e, 35).type).toBe('rain');
    expect(resolveWeatherForTemp(e, 39.9).type).toBe('rain');
    expect(resolveWeatherForTemp(e, 40).type).toBe('thunderstorm');
  });

  it('converts rain to light blizzard below 32F, clamping intensity to 1', () => {
    const e = ev('rain', 3);
    const resolved = resolveWeatherForTemp(e, 31.9);
    expect(resolved.type).toBe('blizzard');
    expect(resolved.intensity).toBe(1);
    expect(resolveWeatherForTemp(e, 32).type).toBe('rain');
  });

  it('returns the original reference when type and intensity are unchanged', () => {
    const e = ev('rain', 1);
    expect(resolveWeatherForTemp(e, 50)).toBe(e);
  });
});

describe('createWeatherSystem', () => {
  it('starts with a clear event at day 0', () => {
    const sys = createWeatherSystem(12345);
    const first = sys.getCurrentEvent(0);
    expect(first.type).toBe('clear');
    expect(first.startDays).toBe(0);
  });

  it('is deterministic for a given seed', () => {
    const a = createWeatherSystem(999);
    const b = createWeatherSystem(999);
    expect(a.getCurrentEvent(10)).toEqual(b.getCurrentEvent(10));
    expect(a.getForecast(5, 4)).toEqual(b.getForecast(5, 4));
  });

  it('getForecast returns events strictly after the given day, in order', () => {
    const sys = createWeatherSystem(42);
    const forecast = sys.getForecast(0, 5);
    expect(forecast.length).toBeGreaterThan(0);
    for (const e of forecast) expect(e.startDays).toBeGreaterThan(0);
    for (let i = 1; i < forecast.length; i++) {
      expect(forecast[i].startDays).toBeGreaterThanOrEqual(forecast[i - 1].startDays);
    }
  });

  it('getCurrentEvent returns an event whose startDays does not exceed the query day', () => {
    const sys = createWeatherSystem(7);
    const current = sys.getCurrentEvent(15.5);
    expect(current.startDays).toBeLessThanOrEqual(15.5);
  });
});
