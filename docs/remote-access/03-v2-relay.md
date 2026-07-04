# 03 - v2: Relay (What We Know Today)

**Status:** v2. Not built in v1. This captures the design intent so v1 doesn't
foreclose it.

The v1 design (doc 02) solves remote access for households that can get a
**direct** connection: port-forward/UPnP on IPv4, or - the bigger win - IPv6,
which rescues most CGNAT users because CGNAT ISPs almost always provide working
IPv6. The relay exists only for the residual set: **CGNAT with no usable IPv6 on
either end.** For those users there is no direct path, and the only fix is to
route traffic through a box with a public address.

## Why it's a separate version

Relay is where **cost and bandwidth** enter. v1's cloud is a tiny control plane
(pennies/month). A relay carries video, and video is expensive on the wrong host.
Keeping relay out of v1 keeps v1 cheap, shippable, and free of unbounded
bandwidth liability. Relay becomes an **opt-in, paid, bitrate-capped** add-on.

## It is a relay, not store-and-forward

Important correction from the design discussion: a relay stores **nothing**. It's
a real-time dumb pipe:

```
app --TLS--> relay <--TLS-- backend (outbound tunnel it already holds)
                 relay copies encrypted bytes between the two sockets
```

No disk, no queue, no buffering infrastructure - only bandwidth and open sockets.
That also makes relays **stateless and horizontally trivial**: to scale, add
another box and have the cloud point new sessions at the least-loaded one. This
is exactly what Plex and Syncthing run. The backend already maintains a
persistent outbound connection to the cloud (doc 02 section 3); relay reuses that
outbound-connection property so it works behind CGNAT.

## Economics (the reason for the cap and the paid tier)

Ballpark to size decisions, not exact:

- A 2-hour stream at 8 Mbps ~ 7 GB. A heavy remote household ~ 100+ GB/month.
- **Hyperscaler egress** (Azure/AWS ~ $0.08-0.09/GB): that household ~ $8-9/mo in
  egress alone - fatal for a cheap service.
- **Bandwidth-priced hosts** (Hetzner/OVH-class, ~5 EUR/mo including ~20 TB): 20 TB
  ~ 60 Mbps sustained 24/7 - on the order of a couple hundred CGNAT households at
  realistic duty cycles, for a few euros.

So the pattern: **control plane on Azure** (doc 02), **relay egress on
cheap-bandwidth VPS hosts.** Never relay video from a hyperscaler.

Three levers keep relay bounded:

1. **Cap the bitrate.** Plex caps relay at 2 Mbps. The backend already controls
   transcode quality via the media servers, so when a session arrives *through
   the relay*, force a quality ceiling. Predictable worst-case per stream; also
   preserves the user's incentive to fix direct access.
2. **Charge for exactly this.** Discovery, invites, pairing, and direct
   connections stay free (they cost pennies). Relay is the paid tier. The people
   who need it have no alternative, it's a legible thing to pay for, and a few
   dollars/month covers a capped stream on Hetzner-class bandwidth. Essentially
   Plex's model, except the cap can be a paid feature rather than a loss leader.
3. **Prefer direct always.** Relay is the last candidate, only used when LAN,
   IPv4-direct, and IPv6 all fail the race (doc 02 section 2).

## Technical shape (provisional)

- **Data plane:** mux client<->backend over the backend's existing outbound tunnel
  to a relay node (ngrok/frp model). Options to evaluate: build in Node
  (HTTP/2 or yamux-style multiplexing over the WSS already in place), or adopt an
  existing data plane like `rathole`/`frp` with our own control plane on top.
- **Encryption / privacy:** the relay must be a **dumb pipe for ciphertext** - it
  forwards without decrypting, like Tailscale DERP and Syncthing relays. v1's
  per-server TLS (doc 02 section 7) sets this up: terminate TLS on the **user's
  backend** via SNI passthrough so the relay never holds the cert or sees
  plaintext. (A simpler v2.0 could terminate TLS at the relay to ship faster, with
  SNI passthrough as the privacy-preserving follow-up - decide based on how much
  we want "we can't see your streams" as a guarantee.)
- **Node selection:** cloud assigns the least-loaded relay geographically near
  the backend; hands the relay URL to the app as the lowest-priority candidate.
- **Session accounting:** meter per-account relay bytes for the paid tier and to
  enforce fair-use.

## What v1 must not foreclose

- The backend's persistent outbound connection (doc 02 section 3) is the relay's
  future data path - keep it a clean, framed, muxable channel, not just a
  heartbeat socket.
- The candidate model (doc 02 section 2) must accept a `kind: 'relay'` entry with
  lowest priority without client changes.
- Per-server TLS with SNI passthrough (doc 02 section 7) is what makes an
  end-to-end-encrypted relay possible later - don't design the cert flow in a way
  that assumes TLS always terminates at the backend's own listener only.

## Non-goals (still, in v2)

- No store-and-forward, no transcoding on the relay, no caching of media on the
  relay. It forwards live bytes and nothing else.
- The cloud/relay never becomes a required dependency for LAN or direct use.
