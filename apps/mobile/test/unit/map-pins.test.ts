import { describe, expect, it } from 'vitest';
import { groupPins, lowestOf, type MapPoint } from '../../src/components/maps/types';

// A flat projection: 1 degree = 10 000 px, so 0.001° is 10 px.
const at = (p: { lat: number; lng: number }) => ({ x: p.lng * 10_000, y: -p.lat * 10_000 });
const pin = (id: string, lat: number, lng: number, price: number, selected = false): MapPoint => ({ id, lat, lng, label: `SAR ${price.toLocaleString('en')}`, price, selected });

describe('the stays map: pins that would overlap become one group', () => {
  it('keeps pins with room apart, each with its own price', () => {
    const g = groupPins([pin('a', 0, 0, 1000), pin('b', 0, 0.02, 1200), pin('c', 0.02, 0, 900)], at);
    expect(g.map((x) => x.members.length)).toEqual([1, 1, 1]);
  });
  it('groups pins whose pills touch, and says the lowest price', () => {
    const g = groupPins([pin('a', 0, 0, 3365), pin('b', 0.0005, 0.001, 1903), pin('c', 0.001, 0.002, 2500), pin('far', 0.05, 0.05, 800)], at);
    const group = g.find((x) => x.members.length > 1)!;
    expect(group.members.map((m) => m.id).sort()).toEqual(['a', 'b', 'c']);
    expect(lowestOf(group.members).id).toBe('b');
    expect(group.stack).toBe(false);
    expect(g.find((x) => x.id === 'far')!.members).toHaveLength(1);
  });
  it('never groups the chosen place', () => {
    const g = groupPins([pin('a', 0, 0, 1000), pin('b', 0, 0.001, 1100, true), pin('c', 0.0005, 0.0005, 1200)], at);
    expect(g.find((x) => x.id === 'b')!.members).toHaveLength(1);
    expect(g.filter((x) => x.members.some((m) => m.id === 'b'))).toHaveLength(1);
    // What sits under the chosen pin moves up, out from under it.
    expect(g.find((x) => x.members.some((m) => m.id === 'a'))!.dy).toBeLessThan(0);
    expect(groupPins([pin('a', 0, 0, 1000), pin('far', 0.05, 0.05, 900, true)], at)[0]!.dy).toBe(0);
  });
  it('stacks places at the same spot instead of a group that zooming can never split', () => {
    const g = groupPins([pin('a', 51.5, -0.1, 1000), pin('b', 51.50001, -0.1, 1100)], at);
    expect(g).toHaveLength(1);
    expect(g[0]!.stack).toBe(true);
  });
});
