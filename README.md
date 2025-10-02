# Canvas Wars – Local (Socket.IO)

A **fully local** real-time MVP of the pixel-canvas game. No Firebase or external
services needed. Great for classroom demos when the university network blocks
cloud domains, or if you just want to test everything locally first.

## What it does
- Run a local Node.js server (Express + Socket.IO).
- Players open the site (e.g., http://localhost:3000 or http://YOUR_LAN_IP:3000).
- Join by **PIN**, enter **name**, choose **team** (A/B/C).
- Host can **Create Session**, **Start**, **Stop**, **Reset**, set optional **Timer**.
- While running, each player can place **one pixel per cooldown** (client-side enforced).
- **Last write wins** per cell. Real-time updates broadcast to everyone in the session.
- In-memory state (resets when server restarts). Perfectly fine for one-off sessions.

## Prerequisites
- Node.js 18+ (https://nodejs.org/)
- A shared network (for multiple devices), or just run several browser tabs on your machine.

## Quick start
```bash
# 1) Install dependencies
npm install

# 2) Start the local server
npm start

# 3) Open in your browser
# On the same machine:
http://localhost:3000
# On another device in the same LAN:
# find your local IP (e.g., 192.168.1.42) and open:
http://192.168.1.42:3000
```

## Controls / Flow
1) Enter a **PIN** (e.g., 123456), your **name**, and a **team**.
2) If you're the instructor, tick **Host mode** and click **Join**.
3) In the **Host Panel**:
   - Set `Grid Size` (e.g., 50, 100), `Cooldown (sec)` (5–10), `Round Timer (min)` (0 = no timer).
   - Click **Create Session** to (re)initialize settings for that PIN.
   - Click **Start** to start the round. **Stop** to end the round. **Reset Grid** to clear.
4) Click the canvas to place pixels (cooldown enforced **on client**, as agreed).
5) Optional: **Export PNG** from the browser (button provided).

## Notes
- No persistence: if the server restarts, sessions are cleared.
- Security is minimal (PIN + host toggle). This is by design for low-stakes, friends-only play.
- You can adjust defaults at the top of `public/client.js`.
