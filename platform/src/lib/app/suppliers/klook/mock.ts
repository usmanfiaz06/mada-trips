import type { ActivitiesSupplier } from "../activities-types";
import fixtures from "./fixtures.json";
import { parseKlook } from "./klook";

/** Mock Klook: the fixture activities for the city (by name), through the same parser as the live answers. */
export const mockKlook: ActivitiesSupplier = {
  name: "klook",
  async search(q) {
    const list = (fixtures.cities as Record<string, unknown[]>)[q.city.trim().toLowerCase()] ?? [];
    const youngest = q.ages.length ? Math.min(...q.ages) : 30;
    return parseKlook({ result: { activities: list } }, q.limit).filter((e) => e.minAge === null || youngest >= e.minAge);
  },
};
