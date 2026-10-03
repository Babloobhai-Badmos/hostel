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
/** Real rounds need this many players. Debug rooms (?debug=1) fill the gap with bots. */
export const MIN_PLAYERS_TO_START = 5;
/** Debug rooms fill up to this many players with bots unless ?bots=N says otherwise. */
export const DEBUG_DEFAULT_BOT_FILL = 5;

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

// ---------- Roles (who gets what at round start) ----------
/** 15+ players: all four player killers. */
export const ROLES_BIG_ROOM_MIN = 15;
export const KILLERS_BIG_ROOM = 4;
/** 10–14 players: three random killers, and the Gujju Rapper NPC appears. */
export const ROLES_MID_ROOM_MIN = 10;
export const KILLERS_MID_ROOM = 3;
/** Under 10: two random killers, no Gujju Rapper. */
export const KILLERS_SMALL_ROOM = 2;
/** The Gujju Rapper NPC shows up from this many players. */
export const GUJJU_MIN_PLAYERS = ROLES_MID_ROOM_MIN;
/** The role-reveal screen lasts this long; nobody can move during it. */
export const ROLE_REVEAL_SECONDS = 4;

// ---------- Combat ----------
/** Nobody can be killed for this long after the round starts. */
export const SPAWN_PROTECTION_SECONDS = 5;
/** A normal swing hits the closest target inside this cone in front of the killer. */
export const ATTACK_ARC_DEG = 120;
/**
 * Extra reach the server allows on top of attackRange, because the killer
 * sees other players ~100 ms in the past (interpolation delay).
 */
export const ATTACK_REACH_TOLERANCE_TILES = 0.35;
/** Killers can search one hiding spot this often. A hider found inside is killed. */
export const SEARCH_COOLDOWN_SECONDS = 10;

// ---------- Vents (killers only) ----------
export const VENT_RANGE_TILES = 1.1;
/** Time spent "inside the pipes" between the two grates. */
export const VENT_TRAVEL_MS = 1000;
export const VENT_COOLDOWN_SECONDS = 8;

// ---------- Ghosts ----------
/** Ghosts float through walls at this multiple of base speed. */
export const GHOST_SPEED_MULTIPLIER = 1.2;

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

// ---------- Vision ----------
/** Living crew see this far. */
export const VISION_RADIUS_TILES = 6;
/** Killers see this fraction of the crew radius. */
export const KILLER_VISION_MULTIPLIER = 0.5;
/** During the lights-out event everyone's radius drops to this (phase 7). */
export const LIGHTS_OUT_RADIUS_TILES = 2;
/** Rays cast per frame to build the vision shape. More = smoother edges, more CPU. */
export const VISION_RAYS = 240;
/** Rays go this far past the point where they hit a wall, so wall faces are lit. */
export const VISION_WALL_PEEK_PX = 10;
/** Darkness outside your vision (1 = pitch black). */
export const FOG_ALPHA = 0.94;

// ---------- Tasks ----------
/** Each regular player gets this many tasks, picked at random from tasks.json. */
export const TASKS_PER_PLAYER = 6;
/** How close (centre to centre) you must be to a task station to open or finish it. */
export const TASK_RANGE_TILES = 1.3;
/**
 * The server refuses a task finished faster than this after opening it.
 * Real minigames take 3–15 s; this only stops scripted instant completions.
 */
export const TASK_MIN_SECONDS = 2;
/** Debug bots tick off one of their tasks this often (they don't play minigames). */
export const DEBUG_BOT_TASK_SECONDS = 25;

// ---------- Round end ----------
export const KILL_FEED_SECONDS = 6;
/** After the winning condition is met, the round keeps running this long (so the last kill plays out). */
export const ROUND_END_DELAY_MS = 2500;

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
