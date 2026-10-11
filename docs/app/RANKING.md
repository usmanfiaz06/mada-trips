# How Mada orders stays, and why it says what it says

Plain words for the owner. The code is `packages/shared/src/schemas/stay-fit.ts` (`tripShape`, `stayFit`, `rankStays`)
and `stay-wishes.ts` (what people ask for in chat). Both run on the server for every search and in the app when a
wish is added. There is no randomness and no model in it: the same travellers and the same hotels always give the
same order, and a tie goes to the cheaper stay (then the name, so the order never wobbles).

## 1. Who is going: the trip's shape

From the travellers picked in "Who's staying?" (the household in the profile), their relation and their age on the
check-in day (from the date of birth on the passport or profile). Never from a guess.

| Shape | When |
|---|---|
| Family | A child under 12 on the trip, or two generations or more (a parent with a grown child, a grandparent). |
| Solo | You alone (a helper travelling along changes nothing). |
| Couple | You and your spouse. |
| Group | Several adults otherwise (friends, colleagues). |
| Pilgrimage | Umrah, or a wish for the Haram / the Prophet's Mosque. |

The search answer says which shape it ranked for, and why ("2 children under 12").

## 2. How well a stay fits: a score from 0 to 100

Every stay gets points for five things, weighted by the shape:

| | Family | Couple | Solo | Group | Pilgrimage |
|---|---|---|---|---|---|
| Stars (1 star = 0, 5 stars = full) | 0.30 | 0.45 | 0.25 | 0.30 | 0.18 |
| Value (cheapest = full, 60% above the middle price = 0) | 0.28 | 0.20 | 0.40 | 0.38 | 0.20 |
| Where it is (centre, or the place asked for, or the Haram) | 0.17 | 0.28 | 0.28 | 0.24 | **0.55** |
| Free cancellation | 0.04 | 0.04 | 0.04 | 0.04 | 0.04 |
| Breakfast included | 0.06 | 0.03 | 0.03 | 0.04 | 0.03 |

Then amenities add, only when the hotel's own Hotelbeds content lists them (its facility names and description, kept
in our database): for a family connecting rooms and family rooms (+0.08 each), a pool and a kids' club (+0.06),
a beach (+0.03); for a couple a spa; for a group connecting rooms and parking; for a pilgrimage step-free access.
A hotel whose content we don't hold yet gets nothing for amenities (and we never say it has them).

"Where it is" is the straight-line distance: full points in the middle, nothing at the edge of the city (8 km), or
3 km from a place the traveller asked for and from the Haram.

**Best for you** is the highest score at 3 stars and up. **Lowest price** is the cheapest. Every other stay has no
badge. The first screen shows three picks: the best fit, the lowest price that is still 3 stars and up, and the
closest to the landmark the traveller measures from, each with one line of reasons.

## 3. Reasons are the facts that scored

The line under a pick ("Best for the 4 of you: connecting rooms, pool, 2.1 km to Dubai Mall") lists the facts that
added to that stay's score, most telling first for the shape. If the facts are thin it says something plain
("well placed and well priced"). The reasons are stored with each offer (`fit` on the offer in `app_offers`), so the
desk and support can see why it was suggested.

## 4. Wishes said in chat

"A sea view", "closer to Burj Khalifa", "quiet, for kids", "under SAR 600 a night", "breakfast", "free
cancellation", "5 stars", in English or Arabic. Each wish is judged on facts: yes (with the evidence shown on the
card), no, or can't tell. A view or a "quiet" the content doesn't mention is "can't tell", never "no", and Mada says
so and offers to ask the desk. Places that fit every wish come first (nearest first when a place was asked for,
cheapest first for a price); when nothing fits, the closest matches are shown under a plain "Nothing here has all of
that".

## 5. Learning later (not built)

Once there is real traffic, the weights in the table above can be tuned from what people do: which pick they open,
which they book, which wishes they add after seeing the list, and which bookings are cancelled. The way to do it is
to log, per search, the shape, the list shown with each stay's facts and score, and what was tapped and booked; then
fit the weights per shape (a simple ranking model, checked on a held-out month) and ship them as a new table, still
deterministic and still explained. Nothing is personalised per person until that data exists and the privacy notice
says so.
