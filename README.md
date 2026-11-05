# CampusLoop (Seller Rating and Reputation System)

## Deploy on Render
1. Push this folder to a GitHub repository.
2. In Render choose New > Blueprint and select the repo. `render.yaml` creates the PostgreSQL database and web service.
3. Wait for the build. It creates tables, adds the 1-10 CHECK constraints and loads demo data.

Manual setup instead: create a PostgreSQL database and a Web Service with Build Command `npm install && npm run build`, Start Command `npm start`, and env vars `DATABASE_URL` and `JWT_SECRET`.

## Demo accounts (password `password123`)
rahul@campusloop.test (seller), anurag@campusloop.test, priya@campusloop.test, meera@campusloop.test

## Try the flow
Log in as anurag, open a listing by Rahul, Request to buy. Log in as rahul, Dashboard, Accept, then Mark completed. Log back in as anurag and tap Rate Seller.
