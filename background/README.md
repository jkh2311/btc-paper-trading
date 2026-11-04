# Background paper trading: deployment required

This is a PRELIMINARY server implementation, NOT a currently running service.

It runs the unchanged GitHub Pages BTC paper-trading application in a persistent Chromium browser on Railway. It uses only the paper trading localStorage keys, never the encrypted Binance API key. It never calls Binance order endpoints.

Setup: connect Railway, deploy this repository, attach a persistent Volume to /data, set a private BACKGROUND_TOKEN of at least 32 random characters, enable a public HTTPS domain and verify /health. Railway supplies RAILWAY_VOLUME_MOUNT_PATH.

Authenticated API: GET /api/status, POST /api/start, POST /api/stop, GET /api/snapshot. Send Authorization: Bearer (secret). First POST /api/start needs snapshot containing paper, settings and signals values from the phone's THREE paper-only localStorage keys. The server starts OFF. /api/stop prevents new entries but leaves existing paper stop/TP monitoring on. Restarting the server restores the user's explicitly armed server setting.

IMPORTANT: The phone app is NOT YET wired to the server endpoints; separate frontend connectivity and state synchronization are still required. Do not treat code publication as live screen-off trading. Do not run phone AUTO and server AUTO together. Not yet end-to-end tested on Railway. Hosting fees, sleep, connectivity failures or exchange outages may stop this service. No live money or real futures orders.
