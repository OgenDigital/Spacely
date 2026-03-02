# SpaceLy Demo App

A working smart parking management demo based on the provided SpaceLy specification.

## What is implemented

- Driver app pages:
  - Home (map + live lot availability)
  - Parking Lot Details
  - Active Parking (timer, navigation, manual exit, issue report)
  - My Vehicles (add vehicle, default vehicle)
  - Payment History
  - Notifications
  - Payment Summary
  - Reserve Parking
- Admin app pages:
  - Dashboard (occupancy, sessions, issues, revenue)
  - Parking Lots management
  - Parking Map with spot status updates
  - Issues management
  - Users + role updates
  - Audit Log
  - Settings
  - Edit Floor (add spots)
- Core processes:
  - Simulated LPR entry/exit
  - Spot allocation algorithm (filter + sort by distance/floor/row)
  - Assignment timeout handling
  - Reservations with reserved statuses
  - Issue reporting + alternative spot suggestion
  - Payment flow (success/failure/debt)
  - Notifications + audit events
- Persistence:
  - Full demo state persisted in browser `localStorage`

## Run locally

Use any static file server from project root:

```bash
python3 -m http.server 8080
```

Then open:

- http://localhost:8080

## Deploy to web (quick options)

### Option 1: Vercel (recommended)

```bash
npm i -g vercel
vercel --prod
```

### Option 2: Netlify Drop

Upload this folder directly in Netlify Drop UI:

- https://app.netlify.com/drop

### Option 3: GitHub Pages

Push this repository and enable Pages on the default branch root.

## Demo usage path

1. Driver mode: Home -> `Simulate LPR Entry` on a lot.
2. Active Parking: click `I Arrived`.
3. Report an issue (`blocked` or `already_occupied`) to trigger alternative spot assignment.
4. Exit manually -> Payment Summary -> Pay.
5. Switch to Admin mode and review Dashboard, Issues, Audit Log.
6. Driver mode -> Notifications and Payment History.

## Notes

- This is a demo implementation with in-browser state.
- LPR, payments, and push notifications are simulated workflow events.
