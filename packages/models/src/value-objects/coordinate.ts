/**
 * A position in the companion's world model.
 *
 * Right-handed, Y-up, metres — Unity's convention, chosen because it is the
 * first client and gratuitous divergence would put a conversion in every
 * message forever.
 *
 * **This type never reaches a client.** `LookAction` carries a semantic target
 * (`'user' | 'away' | 'ahead'`), not a coordinate, because a backend that
 * emitted world-space positions would have to know the client's tracking frame
 * and origin — exactly the coupling ADR-001 exists to prevent. Coordinates are
 * for what the companion *understands* about a space; how that space is
 * rendered belongs to the client.
 */
export interface Coordinate {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * The frame a coordinate is expressed in.
 *
 * Recorded rather than assumed. AR sessions relocalise, and a position captured
 * before relocalisation means something different afterwards. A coordinate
 * without its frame is a number triple that was true once.
 */
export type SpatialFrame = 'session' | 'anchor' | 'world';

/** A coordinate together with the frame that makes it interpretable. */
export interface SpatialPosition {
  readonly frame: SpatialFrame;
  readonly coordinate: Coordinate;
  /**
   * The anchor this position is relative to, when `frame` is `'anchor'`.
   *
   * Anchor-relative positions survive relocalisation; session-relative ones do
   * not. Persisting anything long-lived in session space is a bug that only
   * appears after the user walks out of the room and comes back.
   */
  readonly anchorId: string | null;
}

/** Straight-line distance in metres. Frame compatibility is the caller's to establish. */
export const distance = (a: Coordinate, b: Coordinate): number =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

export const ORIGIN: Coordinate = { x: 0, y: 0, z: 0 };
