# Mada's own ADS-B receivers in Riyadh and Jeddah

A plain guide for setting up two small receivers, one in Riyadh and one in Jeddah, that listen to aircraft and share
what they hear with **adsb.lol**. That is where Mada Trips gets its live aircraft positions.

## Why we need them

Every airliner broadcasts its position about twice a second on **1090 MHz** (this is called ADS-B). Anyone with a cheap
radio receiver can hear it, and volunteers around the world share what they hear with sites like adsb.lol. Mada Trips
reads adsb.lol to put the plane on the map.

The problem is that **almost nobody shares from Saudi Arabia**. Our check on 11 October 2026 found:

| Around (60 nautical miles) | Aircraft adsb.lol could see |
|---|---|
| Riyadh (RUH) | 0 |
| Jeddah (JED) | 0 |
| Madinah (MED) | 0 |
| Dammam (DMM) | 15 (heard from Bahrain and the Gulf) |
| Istanbul (IST) | 17 |
| Dubai (DXB) | 25 |

So a Saudia flight from Riyadh is invisible from the gate until it reaches covered airspace, often an hour or more
later. Until then the app shows an **estimated** position, worked out from the airline's times, and says so. One
receiver on a Riyadh roof and one on a Jeddah roof would let us see departures from the runway, for our travellers and
for everyone else using adsb.lol.

A receiver only listens. It sends nothing to aircraft.

## Shopping list (for each city)

Prices are rough Saudi retail prices in late 2026 (Amazon.sa, Noon, local electronics shops, or imported). Check before
buying; they move.

| Item | What to look for | About (SAR) |
|---|---|---|
| Small computer | **Raspberry Pi 4** (2 GB or 4 GB) or **Raspberry Pi 5** (4 GB). A Pi 3B+ also works. | 250 to 450 |
| Power supply | The **official** Raspberry Pi power supply for that model (USB-C, 5.1 V 3 A for a Pi 4, 5 V 5 A for a Pi 5). Cheap chargers cause odd faults. | 40 to 70 |
| Memory card | **32 GB microSD, "high endurance"** (made for cameras that write all day), e.g. SanDisk High Endurance or Samsung PRO Endurance | 40 to 70 |
| Radio receiver | **FlightAware Pro Stick Plus** (USB, has a built-in 1090 MHz filter and amplifier). The AirNav FlightStick is similar. | 150 to 250 |
| Antenna | A **1090 MHz outdoor antenna**, e.g. the FlightAware 66 cm (26") antenna. A small 5 dBi indoor antenna works for a first test by a window, but much less well. | 60 (indoor) to 300 (outdoor) |
| Cable | **Low-loss coax**, as short as you can (LMR-240 or LMR-400, 5 to 10 m), with the right ends (the Pro Stick has an SMA socket; outdoor antennas usually N-type) | 80 to 200 |
| Adapters | SMA to N adapter if needed; self-amalgamating tape to seal the outdoor joint from dust and rain | 20 to 50 |
| Mounting | A short mast or pole and U-bolt clamps for the roof or parapet | 50 to 150 |
| Case | A case for the Pi, with a fan or heat sinks (summer roof heat). If the Pi lives outdoors, a ventilated, shaded weatherproof box. | 30 to 120 |
| Network | An Ethernet cable to the building's router is best; Wi-Fi works too | 0 to 40 |

**Total per site: roughly SAR 900 to 1,400.** Optional: a small UPS or power bank so a short power cut doesn't
corrupt the memory card (SAR 100 to 250).

## Where to put it

- **On the roof, as high as you can**, with a clear view of the sky in every direction. Every metre higher and every
  wall or water tank out of the way adds range. A good roof site hears aircraft 200 to 300 km away.
- **Antenna outdoors, computer indoors** is the best arrangement: keep the cable short (under 10 m) and bring it in
  through a window seal or a cable gland.
- **Keep it cool and in shade.** A Raspberry Pi slows down above about 80 °C; a Riyadh roof in August is hotter than
  that in direct sun.
- **Away from other antennas and metal**: keep at least a metre from satellite dishes, mobile masts and big metal
  surfaces.
- Pick buildings near the airports if you can (for example north Riyadh for RUH, north Jeddah for JED), but height and
  a clear view matter more than distance.
- You need permission from the building owner, a power socket, and an internet connection.

## Setting it up (the easy way: the adsb.im image)

adsb.lol recommends the free **adsb.im** "feeder image" for new stations. It turns the Raspberry Pi into a receiver
you set up from a web page, with no typing of commands.

1. On a laptop, go to **https://adsb.im/howto** and download the image for your Raspberry Pi model.
2. Write it to the microSD card with **Raspberry Pi Imager** or **balenaEtcher** (both free).
3. Put the card in the Pi, plug in the Pro Stick (radio) with the antenna attached, plug in the Ethernet cable, then
   the power.
4. Wait about five minutes, then on a laptop or phone **on the same network** open **http://adsb-feeder.local**.
   (If that name doesn't open, find the Pi's address in the router's list of connected devices and open that.)
5. In the setup page:
   - Give the station a name, e.g. `mada-riyadh` or `mada-jeddah`.
   - Enter the **exact location and height** of the antenna (latitude, longitude, and height above sea level in metres;
     Google Maps gives the coordinates, https://www.freemaptools.com/elevation-finder.htm gives the ground height, then
     add the building height). This must be accurate for MLAT (below) to work.
   - Choose the time zone (Asia/Riyadh).
   - On the "aggregators" step, **tick adsb.lol**. You may tick others as well (airplanes.live, adsb.fi, and so on);
     they're also community sites and it costs nothing.
6. Save. The page shows aircraft being received within a minute or two if the antenna can see the sky.

### The other way (if you already have a receiver)

If a Raspberry Pi already runs `readsb` or `dump1090` (for example a FlightAware or Flightradar24 feeder), add adsb.lol
alongside it without disturbing anything:

```
curl -L -o /tmp/lol-feed.sh https://adsb.lol/feed.sh
sudo bash /tmp/lol-feed.sh
```

It asks for the location and height, then starts two services, `adsblol-feed` and `adsblol-mlat`.

## Checking that it feeds adsb.lol

- Open **https://adsb.lol** from a phone or laptop **on the receiver's network**: the page says you're feeding.
- Open **https://my.adsb.lol** from the same network: it takes you to your station's own map, showing only what your
  receiver hears. Save that link; it can be shared.
- **MLAT**: adsb.lol's MLAT sync map (https://www.adsb.lol/docs/feeders-only/mlat-map/) shows whether your station
  has found nearby stations to time signals with. MLAT also places older aircraft that don't send their position. With
  our two being among the first in the region it may say few or no peers at first; that's normal.
- On the adsb.im page (http://adsb-feeder.local) the status page lists each aggregator with a green tick when feeding.

## Seeing the difference in Mada Trips

From the project folder, run the coverage check before and after:

```
ADSB_CONTACT=ops@madatrips.sa npm run adsb:coverage
```

It prints how many aircraft adsb.lol sees around RUH, JED, DMM, MED, IST and DXB, and how many of those are below
10,000 ft (that is, near the airport). Today Riyadh and Jeddah read **0**. With a working receiver they should show
dozens, and "ok" in the last column. Run `npm run adsb:coverage -- 30 RUH JED` for a tighter circle around just
those two airports.

In the app, a Saudi departure's map will then switch from "estimated" to "In the air · 12,000 ft, seen just now" a few
minutes after take-off instead of an hour later.

## Looking after it

- **Monthly**: open the station's map (my.adsb.lol) and check it still shows aircraft. If it shows none, power it off
  and on again.
- **Summer**: check the Pi isn't overheating (the adsb.im status page shows the temperature). Add shade or a fan if it
  goes over 75 °C.
- **After storms or dust**: look at the antenna and the sealed cable joint.
- **Updates**: adsb.im updates itself from its web page (System → Update). For the script install:
  `curl -L -o /tmp/lol-update.sh https://raw.githubusercontent.com/adsblol/feed/master/update.sh && sudo bash /tmp/lol-update.sh`.
- **The memory card** is the part that wears out. Keep a spare card with the image on it; swapping takes ten minutes.
- If something won't work, adsb.lol's community chat is at https://adsblol.zulipchat.com.

## Rules to check in Saudi Arabia

A receiver like this only **listens** to signals aircraft broadcast openly; it transmits nothing. Receive-only ADS-B
stations are common worldwide and generally treated as passive listening equipment. **We have not confirmed how Saudi
rules treat them.** Before buying, please check with the **Communications, Space and Technology Commission (CST)**
(https://www.cst.gov.sa), and if unsure also the **General Authority of Civil Aviation (GACA)**, in particular:

- whether a receive-only 1090 MHz receiver needs any registration or type approval to import or use, and
- any rule about placing antennas on the chosen buildings (the building owner and the municipality may have their
  own).

Keep the receipts and product details (the Pro Stick is a USB radio receiver) in case customs ask. The data shared is
the same public broadcast that adsb.lol already publishes from other countries; it includes no personal data about
passengers.
