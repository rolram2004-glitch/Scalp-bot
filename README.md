# SCALP.BOT

This repository contains a lightweight scalping bot prototype with a local dashboard and deployment support for always-on execution.

## Run locally

1. Install dependencies:
   - `npm install`
   - `cd frontend && npm install`
2. Build the frontend:
   - `npm run build`
3. Start the server:
   - `npm start`
4. Open `http://localhost:3000/`

## Always-on execution with PM2

PM2 keeps the bot running and restarts it automatically if it crashes.

- `npm run pm2:start`
- `npm run pm2:stop`
- `npm run pm2:restart`

## Docker deployment

1. Build the image:
   - `docker build -t scalp-bot .`
2. Run the container:
   - `docker run -d -p 3000:3000 --name scalp-bot scalp-bot`

This setup lets you move the bot to a remote host or cloud VM so it can remain online even when your local PC is turned off.

## Notes

- The bot currently runs in simulation/fallback mode unless valid OANDA credentials are provided.
- Add credentials in a `.env` file based on `.env.example` when connecting to a live account.
