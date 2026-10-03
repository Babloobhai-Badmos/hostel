// `npm run tunnel` — prints how to expose the game through a Cloudflare quick
// tunnel when the WiFi blocks device-to-device traffic (client isolation).

const port = Number(process.env.PORT) || 3000;

console.log(`
  TUNNEL FALLBACK (when friends can't open the LAN URL)

  Hostel/college WiFi often has "client isolation": phones can reach the
  internet but not each other. A Cloudflare quick tunnel gives you a public
  https URL that forwards to your laptop. No account needed.

  1. Install cloudflared (one time):
       Windows:  winget install --id Cloudflare.cloudflared
       macOS:    brew install cloudflared
       Linux:    https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
       Android (Termux): pkg install cloudflared

  2. Keep the game server running in one terminal:
       npm start

  3. In a second terminal run:
       cloudflared tunnel --url http://localhost:${port}

  4. cloudflared prints a line like:
       https://some-random-words.trycloudflare.com
     Send that URL to everyone. It works on any network, including mobile data.

  Notes:
   - Traffic goes through the internet, so expect a bit more lag than LAN.
   - The URL changes every time you restart cloudflared.
   - Stop the tunnel with Ctrl+C when you're done; nobody can join after that.
`);
