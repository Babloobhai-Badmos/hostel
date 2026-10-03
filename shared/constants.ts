// All gameplay and networking tunables live here. Server and client both
// import this file, so a change here applies to both sides.

// ---------- Networking ----------
export const SERVER_PORT = 3000;
export const SERVER_HOST = "0.0.0.0";
export const ROOM_NAME = "hostel";

/** Server simulation rate (ticks per second). */
export const TICK_RATE = 20;
export const TICK_MS = 1000 / TICK_RATE;
/** Seconds of simulated time per tick (and per movement input). */
export const TICK_DT = 1 / TICK_RATE;

/** Clients send movement input at this rate. Must match TICK_RATE so one input = one tick of movement. */
export const INPUT_SEND_RATE = TICK_RATE;
export const INPUT_SEND_MS = 1000 / INPUT_SEND_RATE;

/** Remote players are rendered this far in the past so there are always two snapshots to blend between. */
export const INTERPOLATION_DELAY_MS = 100;
/** How many snapshots to keep per remote player. */
export const SNAPSHOT_BUFFER_SIZE = 30;

/**
 * Anti speed-hack: each player earns 1 input credit per tick, banked up to this
 * many. A client flooding inputs can only move as fast as the tick rate allows;
 * the small bank absorbs network jitter (inputs arriving in clumps).
 */
export const INPUT_BUDGET_MAX = 3;
/** Inputs queued beyond this are dropped (the oldest first). */
export const INPUT_QUEUE_MAX = 10;

/** A disconnected player keeps their slot this long. */
export const RECONNECT_SECONDS = 30;

// ---------- Room ----------
export const MIN_PLAYERS = 1;
export const MAX_PLAYERS = 20;
/**
 * Phase 1: the host can start with just themselves so you can test with any
 * number of devices. Phase 3 raises this to 5 when roles exist.
 */
export const MIN_PLAYERS_TO_START = 1;

export const NAME_MAX_LENGTH = 16;
export const NAME_FALLBACK = "Hosteller";

// ---------- World ----------
export const TILE_SIZE = 32;

/** Corridors must be exactly this wide (the map builder rejects anything else). */
export const CORRIDOR_WIDTH_TILES = 3;
/** Every door gap is this wide. */
export const DOOR_WIDTH_TILES = 2;
/** Distance between spawn markers (the grid size itself is in layout.json). */
export const SPAWN_GRID_SPACING_TILES = 1.5;

// ---------- Interactions (USE button) ----------
/** How close (centre to centre) you must be to a hiding spot to get in. */
export const HIDE_RANGE_TILES = 1.1;
/** After taking the stairs you can't take them again for this long (stops double-tap bouncing). */
export const STAIR_COOLDOWN_MS = 800;

// ---------- Players ----------
/** Base walking speed in tiles per second. Character speed multipliers scale this. */
export const BASE_SPEED_TILES_PER_SEC = 4.5;
export const BASE_SPEED_PX_PER_SEC = BASE_SPEED_TILES_PER_SEC * TILE_SIZE;
/** Collision radius of a player body in pixels. */
export const PLAYER_RADIUS_PX = 12;

/**
 * Role-neutral body colours handed out in join order. Every player gets a
 * colour from this list regardless of role, so colour never reveals a killer.
 */
export const PLAYER_COLORS: readonly number[] = [
  0xe6194b, 0x3cb44b, 0xffe119, 0x4363d8, 0xf58231,
  0x911eb4, 0x46f0f0, 0xf032e6, 0xbcf60c, 0xfabebe,
  0x008080, 0xe6beff, 0x9a6324, 0xfffac8, 0x800000,
  0xaaffc3, 0x808000, 0xffd8b1, 0x000075, 0xffffff,
];

// ---------- Vision (used from phase 3) ----------
/** Living crew see this far. */
export const VISION_RADIUS_TILES = 6;
/** Killers see this fraction of the crew radius. */
export const KILLER_VISION_MULTIPLIER = 0.5;
/** During the lights-out event everyone's radius drops to this. */
export const LIGHTS_OUT_RADIUS_TILES = 2;

// ---------- Client view ----------
/** The camera zooms so roughly this many tiles fit across the screen on any device. */
export const VIEW_WIDTH_TILES = 22;
/** ...but never fewer than this many tiles vertically (keeps phones in landscape fair). */
export const VIEW_MIN_HEIGHT_TILES = 11;

// ---------- Touch controls ----------
/** Joystick radius as a fraction of the screen height. */
export const JOYSTICK_RADIUS_FRAC = 0.14;
/** Below this fraction of the radius, the stick reads as zero. */
export const JOYSTICK_DEAD_ZONE = 0.15;
/** Action-button radius as a fraction of the screen height. */
export const ACTION_BUTTON_RADIUS_FRAC = 0.09;
