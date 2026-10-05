# Photos located off their route

Open data issue from step 6 ("Photo stops") of
`docs/superpowers/specs/2026-10-01-website-improvements.md`.

A photo whose `lat`/`lon` in the post's `images:` front matter lies more than
300 m from the route GeoJSON gets no km/altitude line in its caption and no tick
on the elevation profile (`OFF_TRACK_KM` in `src/lib/hikes/photo-stops.ts`), but
its marker still shows on the 2D/3D maps, away from the route. Most are
commute or home shots, or phone GPS that is kilometres off.

**131 photos across 35 posts** (generated 2026-10-04; the spec counted 124,
and 7 of the photos here are within 330 m, right at the threshold).
15 are on recorded hikes (GPX with timestamps); the rest are on planned routes.
None are `located: track`; those are placed on the track by construction.

| Distance off route | Photos |
|---|---|
| 0.3–1 km | 48 |
| 1–5 km | 38 |
| 5–50 km | 39 |
| over 50 km | 6 |

## How to resolve each photo

- **Photo GPS is wrong, but the caption says where on the route it was taken.**
  Replace `lat`/`lon` with the right spot, or drop them (and `demEle`).
- **Photo is off the hike (commute, train, home, a different day).** Drop
  `lat`/`lon`/`demEle` so it no longer appears on the maps.
- **Photo is a real side trip or viewpoint off the route.** Leave it as is.
  The marker is correct; it just gets no km line.
- **The route GeoJSON is wrong** (planned route differs from what was walked).
  Fix the route rather than the photo.

Notes on making the edits stick:

- `deploy.sh` runs `scripts/backfill_time.py` on every deploy. On a **recorded**
  hike, a photo with no `lat`/`lon` but a believable `taken` gets placed on
  the track at that time (`located: track`). Dropping wrong GPS there usually
  puts the photo back on the route automatically. On a **planned** hike it
  just leaves the maps.
- The original `lat`/`lon` come from Immich via the match reports
  (`scripts/matches/hikes/*.json`). `scripts/matches/optimize.py` rebuilds a
  post's whole `images:` map from its match report, so re-running the
  optimizer on a post brings the wrong GPS back. Fix the location in Immich, or
  don't re-run the optimizer on a post you've already curated.

Columns: **Off** is the distance from the photo to the nearest point on the route.
**Taken** is the vetted `taken` timestamp (blank when `backfill_time.py` rejected or found none).

## Photos by post

### 2024-08-31-aiplspitz (planned, 8)

| Photo | Off | Taken | lat, lon | Caption | Resolution |
|---|---|---|---|---|---|
| `2024-08-31-06.jpg` | 9.4 km | 2024-08-31 12:56 | 47.74712, 11.84290 | The ridge towards Aiplspitz (1759 m) | |
| `2024-08-31-09.jpg` | 9.4 km | 2024-08-31 13:02 | 47.74712, 11.84290 | Looking over the Aiplspitz (1759 m) ridge towards Rotwand (1884 m) | |
| `2024-08-31-10.jpg` | 9.4 km | 2024-08-31 13:02 | 47.74712, 11.84290 | View from Aiplspitz (1759 m) ridge towards Kleinmiesing (1666 m) | |
| `2024-08-31-11.jpg` | 9.4 km | 2024-08-31 13:15 | 47.74712, 11.84290 | Maksym enjoying a snack near the top of Aiplspitz (1759 m) while looking at Jägerkamp (1746 m) | |
| `2024-08-31-12.jpg` | 9.4 km | 2024-08-31 13:28 | 47.74712, 11.84290 | The cross at Aiplspitz (1759 m) | |
| `2024-08-31-14.jpg` | 2.8 km | 2024-08-31 13:45 | 47.65750, 11.84928 | Trail towards Benzingspitz (1735 m) | |
| `2024-08-31-16.jpg` | 13.3 km | 2024-08-31 14:24 | 47.80962, 11.99206 | View from Benzingspitz (1735 m) towards Wilde Fräulein (1615 m) | |
| `2024-08-31-18.jpg` | 22.6 km | 2024-08-31 14:50 | 47.45876, 11.88029 | View from Schönfeldhütte (1410 m) towards Jägerkamp (1746 m) | |

### 2024-09-07-simetsberg (planned, 3)

| Photo | Off | Taken | lat, lon | Caption | Resolution |
|---|---|---|---|---|---|
| `2024-09-07-04.jpg` | 6.4 km | 2024-09-07 13:11 | 47.50086, 11.27601 | View from the slope of Simetsberg (1836 m) towards Soiernspitze (2257 m) and Hoher Kranzberg (1391 m) | |
| `2024-09-07-05.jpg` | 35.4 km | 2024-09-07 13:38 | 47.88399, 11.39752 | View from the summit of Simetsberg (1836 m) towards Soiernspitze (2257 m) and Hoher Kranzberg (1391 m) | |
| `2024-09-07-06.jpg` | 7.1 km | 2024-09-07 13:52 | 47.49611, 11.26124 | View from Simetsberg (1836 m) towards Krottenkopf (2086 m) | |

### 2024-09-21-rosskopf (planned, 12)

| Photo | Off | Taken | lat, lon | Caption | Resolution |
|---|---|---|---|---|---|
| `2024-09-21-00.jpg` | 479 m | 2024-09-21 09:39 | 47.66609, 11.88641 | View from Spitzingsee deeper in the mountains near Albert-Link-Hütte (1053 m) | |
| `2024-09-21-01.jpg` | 906 m | 2024-09-21 10:26 | 47.66469, 11.86702 | Untere Haushamer Alm with Rotwand (1884 m) in the background | |
| `2024-09-21-02.jpg` | 858 m | 2024-09-21 11:10 | 47.65833, 11.87414 | Walking up to Stolzenberg (1609 m) | |
| `2024-09-21-03.jpg` | 858 m | 2024-09-21 11:11 | 47.65833, 11.87414 | View from Stolzenberg (1609 m) towards Auerspitz (1811 m) | |
| `2024-09-21-04.jpg` | 906 m | 2024-09-21 11:28 | 47.66469, 11.86702 | A sign at the top of Stolzenberg (1609 m) | |
| `2024-09-21-05.jpg` | 551 m | 2024-09-21 11:49 | 47.66433, 11.89424 | View from Stolzenberg (1609 m) towards Rotkopf (1602 m) | |
| `2024-09-21-06.jpg` | 1.0 km | 2024-09-21 12:01 | 47.66609, 11.87455 | View from Rotkopf (1602 m) towards Brecherspitz (1685 m) and Spitzingsee | |
| `2024-09-21-07.jpg` | 1.4 km | 2024-09-21 12:50 | 47.65345, 11.84023 | A mushroom on the way | |
| `2024-09-21-08.jpg` | 858 m | 2024-09-21 13:04 | 47.65833, 11.87414 | Walking towards Roßkopf (1579 m) | |
| `2024-09-21-10.jpg` | 858 m | 2024-09-21 13:05 | 47.65833, 11.87414 | View from Roßkopf (1579 m) towards Jägerkamp (1746 m) | |
| `2024-09-21-11.jpg` | 858 m | 2024-09-21 13:11 | 47.65833, 11.87414 | Descending from Roßkopf (1579 m) towards Jagahütt'n (1506 m) | |
| `2024-09-21-12.jpg` | 1.4 km | 2024-09-21 14:01 | 47.65345, 11.84023 | View from Jagahütt'n (1506 m) towards Risserkogel (1826 m) and Setzberg (1706 m) | |

### 2024-09-29-rotwand (planned, 1)

| Photo | Off | Taken | lat, lon | Caption | Resolution |
|---|---|---|---|---|---|
| `2024-09-29-05.jpg` | 29.6 km | 2024-09-29 13:26 | 47.89296, 11.67908 | View towards Rotwandhaus (1737 m) | |

### 2024-10-03-bockerlbahnweg (planned, 2)

| Photo | Off | Taken | lat, lon | Caption | Resolution |
|---|---|---|---|---|---|
| `2024-10-03-00.jpg` | 449 m | 2024-10-03 11:30 | 47.66639, 11.88653 | Starting the hike at Spitzingsee | |
| `2024-10-03-07.jpg` | 2.8 km | 2024-10-03 13:44 | 47.73013, 11.85906 | Brecherspitz (1685 m) from below | |

### 2024-10-12-auerspitz (planned, 1)

| Photo | Off | Taken | lat, lon | Caption | Resolution |
|---|---|---|---|---|---|
| `2024-10-12-12.jpg` | 3.6 km | 2024-10-12 17:45 | 47.68156, 12.01207 | Gliders at Segelflugplatz LSC Schliersee | |

### 2024-10-20-kruen (planned, 5)

| Photo | Off | Taken | lat, lon | Caption | Resolution |
|---|---|---|---|---|---|
| `2024-10-20-00.jpg` | 329 m | 2024-10-20 12:27 | 47.50893, 11.27602 | View from Barmsee towards Klausenkopf (1181 m) | |
| `2024-10-20-01.jpg` | 948 m | 2024-10-20 12:29 | 47.51465, 11.27791 | A hut near Barmsee | |
| `2024-10-20-03.jpg` | 1.8 km | 2024-10-20 12:42 | 47.47381, 11.21058 | View from Geroldsee hills towards Zugspitze (2962 m) | |
| `2024-10-20-04.jpg` | 8.2 km | 2024-10-20 12:52 | 47.49358, 11.10411 | A view towards Bletschertalkopf (1369 m) | |
| `2024-10-20-06.jpg` | 18.3 km | 2024-10-20 15:34 | 47.65766, 11.37212 | Houses near the Kochel train station | |

### 2024-10-27-nebelhorn (planned, 3)

| Photo | Off | Taken | lat, lon | Caption | Resolution |
|---|---|---|---|---|---|
| `2024-10-27-07.jpg` | 8.9 km | 2024-10-27 15:44 | 47.35785, 10.18580 | The view from Nebelhorn (2224 m) onto Entschenkopf (2043 m) | |
| `2024-10-27-10.jpg` | 8.9 km | 2024-10-27 15:56 | 47.35785, 10.18580 | Sunset at Nebelhorn (2224 m) | |
| `2024-10-27-12.jpg` | 323 m | 2024-10-27 17:39 | 47.40446, 10.29541 | Oberstdorf at dusk | |

### 2024-11-17-hirschberg (planned, 5)

| Photo | Off | Taken | lat, lon | Caption | Resolution |
|---|---|---|---|---|---|
| `2024-11-17-06.jpg` | 6.1 km | 2024-11-17 12:16 | 47.73597, 11.72172 | View from the slope towards Tegernsee | |
| `2024-11-17-07.jpg` | 6.1 km | 2024-11-17 12:29 | 47.73597, 11.72172 | View towards Tegernsee from the hilltop | |
| `2024-11-17-12.jpg` | 6.4 km | 2024-11-17 13:14 | 47.74022, 11.72594 | Our group at the top of Hirschberg (1668 m) | |
| `2024-11-17-13.jpg` | 3.5 km | 2024-11-17 14:17 | 47.71292, 11.73333 | View from Kratzer (1545 m) towards Hirschberg (1668 m) | |
| `2024-11-17-14.jpg` | 6.1 km | 2024-11-17 14:19 | 47.73597, 11.72172 | Descending from Kratzer (1545 m) | |

### 2024-12-14-spitzingsee_schlittenfahrt (planned, 1)

| Photo | Off | Taken | lat, lon | Caption | Resolution |
|---|---|---|---|---|---|
| `2024-12-14-03.jpg` | 710 m | 2024-12-14 12:23 | 47.65869, 11.84081 | View over the ridge towards Risserkogel (1826 m) | |

### 2025-01-19-soiernspitze (planned, 1)

| Photo | Off | Taken | lat, lon | Caption | Resolution |
|---|---|---|---|---|---|
| `2025-01-19-16.jpg` | 95.8 km |  | 48.31854, 11.66161 | My injured arm | |

### 2025-02-09-rampoldplatte (planned, 3)

| Photo | Off | Taken | lat, lon | Caption | Resolution |
|---|---|---|---|---|---|
| `2025-02-09-00.jpg` | 58.1 km | 2025-02-09 08:46 | 48.12927, 11.53443 | Charging with Prime before the hike (disgusting) | |
| `2025-02-09-02.jpg` | 5.6 km | 2025-02-09 12:52 | 47.78986, 12.08686 | View from Rampoldplatte (1422 m) towards Wendelstein (1838 m) | |
| `2025-02-09-04.jpg` | 22.1 km | 2025-02-09 14:02 | 47.93461, 12.01582 | View from Rampoldplatte (1422 m) towards Kranzhorn (1368 m) | |

### 2025-03-02-seekarkreuz (planned, 1)

| Photo | Off | Taken | lat, lon | Caption | Resolution |
|---|---|---|---|---|---|
| `2025-03-02-07.jpg` | 1.6 km | 2025-03-02 17:37 | 47.65266, 11.58824 | Sunset near Lenggries | |

### 2025-03-09-hochstaufen (planned, 2)

| Photo | Off | Taken | lat, lon | Caption | Resolution |
|---|---|---|---|---|---|
| `2025-03-09-04.jpg` | 24.5 km | 2025-03-09 17:14 | 47.83068, 12.52993 | Gate at the top of Hochstaufen (1771 m) | |
| `2025-03-09-05.jpg` | 24.5 km | 2025-03-09 17:07 | 47.83068, 12.52993 | Way down from Hochstaufen (1771 m) | |

### 2025-03-16-riedenburg_kelheim (planned, 2)

| Photo | Off | Taken | lat, lon | Caption | Resolution |
|---|---|---|---|---|---|
| `2025-03-16-00.jpg` | 304 m | 2025-03-16 12:33 | 48.95469, 11.68056 | A view of Riedenburg and beyond | |
| `2025-03-16-04.jpg` | 619 m | 2025-03-16 17:51 | 48.91860, 11.84475 | The holes in the cliff near Kanu-Club Kelheim | |

### 2025-04-04-caldeirao_verde (planned, 5)

| Photo | Off | Taken | lat, lon | Caption | Resolution |
|---|---|---|---|---|---|
| `2025-04-04-00.jpg` | 972 m | 2025-04-04 14:40 | 32.79486, -16.90948 | Giant trees of the PR9 route | |
| `2025-04-04-01.jpg` | 3.6 km | 2025-04-04 15:00 | 32.81772, -16.89768 | Unnamed waterfall along PR9 at 32.7828182, -16.9135953 | |
| `2025-04-04-02.jpg` | 3.0 km | 2025-04-04 15:11 | 32.81113, -16.89584 | Greenery below the trail covering the landscape view | |
| `2025-04-04-03.jpg` | 1.4 km | 2025-04-04 16:02 | 32.78577, -16.89104 | Narrow trail along the canal | |
| `2025-04-04-04.jpg` | 2.5 km | 2025-04-04 16:03 | 32.79637, -16.88366 | Entrance to a canal tunnel | |

### 2025-04-06-sao_lourenco_partial (planned, 2)

| Photo | Off | Taken | lat, lon | Caption | Resolution |
|---|---|---|---|---|---|
| `2025-04-06-00.jpg` | 14.5 km | 2025-04-06 16:46 | 32.78080, -16.85010 | Veiw from Miradouro de São Lourenço | |
| `2025-04-06-01.jpg` | 14.8 km | 2025-04-06 17:44 | 32.78613, -16.85121 | Veiw on the way back | |

### 2025-04-21-schweinsberg (planned, 4)

| Photo | Off | Taken | lat, lon | Caption | Resolution |
|---|---|---|---|---|---|
| `2025-04-21-00.jpg` | 3.7 km | 2025-04-21 12:08 | 47.70228, 11.91675 | Veiw from the slope onto Rotwand (1884 m) | |
| `2025-04-21-01.jpg` | 66.6 km | 2025-04-21 13:25 | 48.31019, 11.84935 | Veiw from Türkenköpfl (1512 m) at Elbacher Kreuz (1510 m) and onto Schweinsberg (1514 m) | |
| `2025-04-21-02.jpg` | 2.2 km | 2025-04-21 13:05 | 47.70706, 11.93609 | View from Elbach Alm at Zettler-Hütte | |
| `2025-04-21-03.jpg` | 2.2 km | 2025-04-21 13:51 | 47.70706, 11.93609 | White crocus flowers on the way to Schweinsberg (1514 m) | |

### 2025-04-27-laber_hauptgipfel (planned, 3)

| Photo | Off | Taken | lat, lon | Caption | Resolution |
|---|---|---|---|---|---|
| `2025-04-27-00.jpg` | 382 m | 2025-04-27 11:22 | 47.59454, 11.06921 | Foggy forest on the way up | |
| `2025-04-27-01.jpg` | 472 m | 2025-04-27 12:19 | 47.59432, 11.06511 | Veiw from the slope onto Notkarspitze (1888 m) | |
| `2025-04-27-04.jpg` | 2.5 km | 2025-04-27 14:50 | 47.56168, 11.10648 | Soldanella on the Laber (1682 m) mountainside | |

### 2025-05-11-buchstein (planned, 2)

| Photo | Off | Taken | lat, lon | Caption | Resolution |
|---|---|---|---|---|---|
| `2025-05-11-04.jpg` | 844 m | 2025-05-11 16:57 | 47.65277, 11.73881 | Spring gentian on the side of Buchstein (1701 m) | |
| `2025-05-11-06.jpg` | 969 m | 2025-05-11 20:36 | 47.65639, 11.59749 | Sunset near Lenggries | |

### 2025-05-18-breitenstein_wendelstein (planned, 9)

| Photo | Off | Taken | lat, lon | Caption | Resolution |
|---|---|---|---|---|---|
| `2025-05-18-00.jpg` | 391 m | 2025-05-18 09:13 | 47.71570, 11.94358 | Stone ruins near Wolfsee | |
| `2025-05-18-02.jpg` | 599 m | 2025-05-18 09:30 | 47.71641, 11.95112 | Lunaria rediviva | |
| `2025-05-18-03.jpg` | 2.1 km | 2025-05-18 09:51 | 47.73107, 11.94834 | Unnamed waterfall near Birkenstein | |
| `2025-05-18-04.jpg` | 433 m | 2025-05-18 10:42 | 47.70674, 11.92735 | Gentiana clusii, flower of the sweet-lady | |
| `2025-05-18-05.jpg` | 433 m | 2025-05-18 11:04 | 47.70674, 11.92735 | Gnome near the top of Breitenstein (1622 m) | |
| `2025-05-18-06.jpg` | 13.1 km | 2025-05-18 11:15 | 47.82840, 11.90882 | Spring gentians on the way down from Breitenstein (1622 m) | |
| `2025-05-18-07.jpg` | 13.1 km | 2025-05-18 11:16 | 47.82840, 11.90882 | Meadow buttercup further down Breitenstein (1622 m) | |
| `2025-05-18-08.jpg` | 11.8 km | 2025-05-18 11:26 | 47.80021, 12.09255 | View from Breitenstein (1622 m) onto Wendelstein (1838 m) | |
| `2025-05-18-14.jpg` | 967 m | 2025-05-18 17:05 | 47.68397, 12.02171 | Mountain goats on Wendelstein (1838 m) | |

### 2025-06-01-blauberge (planned, 2)

| Photo | Off | Taken | lat, lon | Caption | Resolution |
|---|---|---|---|---|---|
| `2025-06-01-07.jpg` | 3.0 km | 2025-06-01 12:39 | 47.65419, 11.74918 | Meadow near Blaubergalm (1540 m) | |
| `2025-06-01-08.jpg` | 8.6 km | 2025-06-01 13:11 | 47.70574, 11.75441 | View from Halserspitze (1863 m) onto Guffert (2194 m) | |

### 2025-06-10-wendelstein (planned, 1)

| Photo | Off | Taken | lat, lon | Caption | Resolution |
|---|---|---|---|---|---|
| `2025-06-10-00.jpg` | 954 m | 2025-06-10 11:41 | 47.68337, 12.02146 | View from the asphalt road onto Bayrischzell | |

### 2025-06-21-zugspitze_reintal (planned, 6)

| Photo | Off | Taken | lat, lon | Caption | Resolution |
|---|---|---|---|---|---|
| `2025-06-21-01.jpg` | 101.3 km |  | 48.31850, 11.66155 | Food for the hike | |
| `2025-06-21-09.jpg` | 330 m | 2025-06-21 15:06 | 47.41113, 10.99861 | A look at the station on top of Zugspitze (2962 m) | |
| `2025-06-21-14.jpg` | 2.3 km | 2025-06-21 17:29 | 47.44143, 10.98968 | The peak and cross of Zugspitze (2962 m) | |
| `2025-06-21-19.jpg` | 315 m | 2025-06-21 21:43 | 47.41034, 10.98115 | Back at Knorrhütte (2052 m) | |
| `2025-06-21-20.jpg` | 315 m | 2025-06-21 22:33 | 47.41034, 10.98115 | Back down to Reintalangerhütte (1366 m) | |
| `2025-06-21-24.png` | 80.1 km |  | 48.14237, 11.55268 | Mykola sleeping on the train | |

### 2025-07-06-bruennstein (planned, 8)

| Photo | Off | Taken | lat, lon | Caption | Resolution |
|---|---|---|---|---|---|
| `2025-07-06-00.jpg` | 474 m | 2025-07-06 10:45 | 47.67071, 12.09066 | A butterfly sitting on David's backpack | |
| `2025-07-06-14.jpg` | 12.9 km | 2025-07-06 15:22 | 47.53066, 12.20187 | View westwards from Brünnsteinhaus (1342 m) | |
| `2025-07-06-16.jpg` | 1.6 km | 2025-07-06 16:49 | 47.63508, 12.18444 | Martagon lily aka Turk's cap lily in the forest | |
| `2025-07-06-18.jpg` | 3.1 km | 2025-07-06 18:38 | 47.63932, 12.21175 | Exiting the forest | |
| `2025-07-06-19.jpg` | 7.0 km | 2025-07-06 18:39 | 47.64688, 12.26889 | The top station of the ski resort | |
| `2025-07-06-20.jpg` | 9.0 km | 2025-07-06 18:46 | 47.64198, 12.29391 | The cable car guarding the ski lift | |
| `2025-07-06-21.jpg` | 861 m | 2025-07-06 18:49 | 47.65420, 12.18657 | The ski lift going to Oberaudorf | |
| `2025-07-06-22.jpg` | 1.6 km | 2025-07-06 19:11 | 47.66722, 12.17866 | Local sheep ignoring the rainbow | |

### 2025-07-20-breitensteinfensterl (planned, 17)

| Photo | Off | Taken | lat, lon | Caption | Resolution |
|---|---|---|---|---|---|
| `2025-07-20-02.jpg` | 1.3 km | 2025-07-20 13:20 | 47.72251, 11.94961 | A butterfly on my shorts | |
| `2025-07-20-03.jpg` | 1.3 km | 2025-07-20 13:23 | 47.72251, 11.94961 | Lady's smock aka cuckoo flower aka cardamine pratensis | |
| `2025-07-20-04.jpg` | 864 m | 2025-07-20 13:54 | 47.71883, 11.94887 | Me at the top of Breitensteinfensterl (1350 m) | |
| `2025-07-20-05.jpg` | 1.3 km | 2025-07-20 13:55 | 47.70235, 11.91680 | The view from Breitensteinfensterl (1350 m) | |
| `2025-07-20-06.jpg` | 1.3 km | 2025-07-20 14:32 | 47.72251, 11.94961 | Me drinking my last Prime (still disgusting) | |
| `2025-07-20-07.jpg` | 1.4 km | 2025-07-20 14:40 | 47.72404, 11.94986 | Another butterfly on my shirt | |
| `2025-07-20-08.jpg` | 1.4 km | 2025-07-20 14:53 | 47.72404, 11.94986 | Breitensteinfensterl (1350 m) from below | |
| `2025-07-20-09.jpg` | 9.8 km | 2025-07-20 15:02 | 47.80954, 11.99285 | Mountain cornflower aka bachelor's button | |
| `2025-07-20-10.jpg` | 386 m | 2025-07-20 15:05 | 47.70742, 11.92682 | Rocks on the way up | |
| `2025-07-20-12.jpg` | 9.8 km | 2025-07-20 15:37 | 47.80954, 11.99285 | The Breitenstein Westgipfel (1575 m) from below | |
| `2025-07-20-13.jpg` | 1.5 km | 2025-07-20 15:48 | 47.72434, 11.94998 | View down from Breitenstein Westgipfel (1575 m) | |
| `2025-07-20-14.jpg` | 386 m | 2025-07-20 15:48 | 47.70742, 11.92682 | View from Breitenstein Westgipfel (1575 m) towards Breitenstein (1622 m) and Wendelstein (1838 m) | |
| `2025-07-20-15.jpg` | 1.5 km | 2025-07-20 15:51 | 47.72502, 11.94945 | The cross at Breitenstein Westgipfel (1575 m) | |
| `2025-07-20-16.jpg` | 386 m | 2025-07-20 15:57 | 47.70742, 11.92682 | A puddle on the way | |
| `2025-07-20-18.jpg` | 1.2 km | 2025-07-20 16:06 | 47.70218, 11.91799 | View from Breitenstein (1622 m) towards Wendelstein (1838 m) | |
| `2025-07-20-19.jpg` | 864 m | 2025-07-20 16:38 | 47.71883, 11.94887 | Road down to Kesselalm (1278 m) | |
| `2025-07-20-21.jpg` | 1.4 km | 2025-07-20 17:31 | 47.72404, 11.94986 | The Easter egg hunting spot from the Schweinsberg (1514 m) hike | |

### 2025-07-26-hoehengluecksteig (planned, 4)

| Photo | Off | Taken | lat, lon | Caption | Resolution |
|---|---|---|---|---|---|
| `2025-07-26-00.jpg` | 6.7 km | 2025-07-26 10:36 | 49.50909, 11.43158 | A building in Hersbruck | |
| `2025-07-26-01.jpg` | 6.7 km | 2025-07-26 10:44 | 49.50909, 11.43158 | The Hersbruck castle | |
| `2025-07-26-04.jpg` | 4.9 km | 2025-07-26 18:27 | 49.57235, 11.60084 | The Höhenglücksteig via ferrata | |
| `2025-07-26-05.jpg` | 949 m | 2025-07-26 19:14 | 49.51954, 11.56819 | Going through the meadows | |

### 2025-08-03-hoehengluecksteig (planned, 2)

| Photo | Off | Taken | lat, lon | Caption | Resolution |
|---|---|---|---|---|---|
| `2025-08-03-03.jpg` | 4.9 km |  | 49.57235, 11.60084 | Veiw from Höhenglücksteig | |
| `2025-08-03-06.jpg` | 18.2 km | 2025-08-03 15:43 | 49.70753, 11.61535 | David climbing Höhenglücksteig | |

### 2025-10-26-auer_berg (planned, 1)

| Photo | Off | Taken | lat, lon | Caption | Resolution |
|---|---|---|---|---|---|
| `2025-10-26-14.jpg` | 48.2 km | 2025-10-26 18:11 | 48.14119, 11.55950 | Doo-doo water with extra sugar | |

### 2026-02-15-oberammergau_sonnenberg (recorded, 2)

| Photo | Off | Taken | lat, lon | Caption | Resolution |
|---|---|---|---|---|---|
| `2026-02-15-21.jpg` | 2.3 km |  | 47.60778, 11.01780 | Riding a snowmobile down | |
| `2026-02-15-22.jpg` | 91.6 km |  | 48.31854, 11.66136 | A tiny glimpse into my scratches and bruises | |

### 2026-03-07-geisswand (recorded, 1)

| Photo | Off | Taken | lat, lon | Caption | Resolution |
|---|---|---|---|---|---|
| `2026-03-07-16.jpg` | 6.8 km |  | 47.91558, 13.79394 | Lakeside view of the mountains | |

### 2026-05-10-teufelstaettkopf (recorded, 1)

| Photo | Off | Taken | lat, lon | Caption | Resolution |
|---|---|---|---|---|---|
| `2026-05-10-29.jpg` | 1.1 km |  | 47.62310, 11.01017 | The road Bohdan took towards Unterammergau | |

### 2026-05-23-nebelhorn (recorded, 8)

| Photo | Off | Taken | lat, lon | Caption | Resolution |
|---|---|---|---|---|---|
| `2026-05-23-00.jpg` | 466 m | 2026-05-23 10:18 | 47.40129, 10.29304 | Walking on the road near Oberstdorf | |
| `2026-05-23-09.jpg` | 918 m |  | 47.42172, 10.34260 | Nebelhorn (2224 m) slope | |
| `2026-05-23-10.jpg` | 918 m |  | 47.42172, 10.34260 | View from Nebelhorn (2224 m) back onto the ridge | |
| `2026-05-23-11.jpg` | 918 m |  | 47.42172, 10.34260 | An eagle on Nebelhorn (2224 m) | |
| `2026-05-23-12.jpg` | 971 m |  | 47.42203, 10.34183 | View from Nebelhorn (2224 m) towards Western Wengenkopf (2235 m) | |
| `2026-05-23-13.jpg` | 974 m |  | 47.42204, 10.34180 | View from Nebelhorn (2224 m) towards Entschenkopf (2043 m) | |
| `2026-05-23-14.jpg` | 937 m |  | 47.42183, 10.34231 | Mykola and Pavlo on Nebelhorn (2224 m) | |
| `2026-05-23-15.jpg` | 920 m |  | 47.42167, 10.34233 | Celebrating the climb onto Nebelhorn (2224 m) | |

### 2026-07-19-schneefernerkopf (recorded, 2)

| Photo | Off | Taken | lat, lon | Caption | Resolution |
|---|---|---|---|---|---|
| `2026-07-19-29.jpg` | 655 m |  | 47.42131, 10.98589 | The peak of Zugspitze (2962 m) we visited on the way back | |
| `2026-07-19-30.jpg` | 3.6 km |  | 47.44837, 10.99067 | The cable car from Zugspitze (2962 m) towards Eibsee | |

### 2026-08-13-omis_duce (recorded, 1)

| Photo | Off | Taken | lat, lon | Caption | Resolution |
|---|---|---|---|---|---|
| `2026-08-13-17.jpg` | 323 m |  | 43.44084, 16.68568 | The fire brigade plane in action | |

## Regenerating

The list was produced by a throwaway script that, for each post, loads the route
GeoJSON (front-matter `filePath`, else `geojson/<slug>.json`), computes each located
photo's distance to the LineString with the same flat projection as
`photo-stops.ts`, and keeps those over 300 m.
